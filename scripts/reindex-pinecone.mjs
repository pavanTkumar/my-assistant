/**
 * Re-index Pinecone with Gemini embeddings (768 dims)
 * Run: node scripts/reindex-pinecone.mjs
 *
 * This script:
 *  1. Deletes & recreates the Pinecone index with 768 dims (Gemini text-embedding-004)
 *  2. Re-uploads bio.txt and upload.json using Gemini embeddings
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Load .env.local ──────────────────────────────────────────────────────────
const envPath = path.resolve(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const m = line.match(/^([^#=][^=]*)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^"(.*)"$/, '$1');
  }
  console.log('✓ Loaded .env.local');
}

const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_INDEX   = process.env.PINECONE_INDEX || 'myassistant';
const GEMINI_API_KEY   = process.env.GOOGLE_GEMINI_API_KEY;

if (!PINECONE_API_KEY || !GEMINI_API_KEY) {
  console.error('❌ Missing PINECONE_API_KEY or GOOGLE_GEMINI_API_KEY in .env.local');
  process.exit(1);
}

// ── Gemini embedding ─────────────────────────────────────────────────────────
async function embed(text) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { parts: [{ text }] }, outputDimensionality: 768 }),
    }
  );
  if (!res.ok) throw new Error(`Gemini embed error: ${await res.text()}`);
  const data = await res.json();
  return data.embedding.values; // 768-dim float array
}

// ── Pinecone helpers ─────────────────────────────────────────────────────────
const PC_BASE = 'https://api.pinecone.io';
const pcHeaders = { 'Api-Key': PINECONE_API_KEY, 'Content-Type': 'application/json', 'X-Pinecone-API-Version': '2024-07' };

async function pc(method, path, body) {
  const res = await fetch(`${PC_BASE}${path}`, { method, headers: pcHeaders, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // 1. Check / delete existing index
  console.log(`\n📋 Checking index "${PINECONE_INDEX}"...`);
  const indexes = await pc('GET', '/indexes');
  const existing = indexes?.indexes?.find(i => i.name === PINECONE_INDEX);

  if (existing) {
    if (existing.dimension === 768) {
      console.log('✓ Index already has 768 dims — skipping recreation');
    } else {
      console.log(`⚠️  Index exists with ${existing.dimension} dims — deleting and recreating with 768...`);
      await pc('DELETE', `/indexes/${PINECONE_INDEX}`);
      console.log('✓ Deleted old index');
      await new Promise(r => setTimeout(r, 5000)); // wait for deletion
    }
  }

  if (!existing || existing.dimension !== 768) {
    console.log('📦 Creating new index with 768 dims (Gemini text-embedding-004)...');
    await pc('POST', '/indexes', {
      name: PINECONE_INDEX,
      dimension: 768,
      metric: 'cosine',
      spec: { serverless: { cloud: 'aws', region: 'us-east-1' } },
    });
    // Wait for index to be ready
    let ready = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const info = await pc('GET', `/indexes/${PINECONE_INDEX}`);
      if (info?.status?.ready) { ready = true; break; }
      process.stdout.write('.');
    }
    if (!ready) { console.log('\n⚠️  Index not ready yet — wait a minute and re-run'); process.exit(1); }
    console.log('\n✓ Index ready');
  }

  // Get the index host
  const indexInfo = await pc('GET', `/indexes/${PINECONE_INDEX}`);
  const host = indexInfo?.host;
  if (!host) { console.error('❌ Could not get index host'); process.exit(1); }

  const upsert = async (vectors) => {
    const res = await fetch(`https://${host}/vectors/upsert`, {
      method: 'POST',
      headers: { 'Api-Key': PINECONE_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ vectors }),
    });
    return res.json();
  };

  // 2. Upload bio.txt
  const bioPath = path.resolve(__dirname, 'bio.txt');
  if (fs.existsSync(bioPath)) {
    console.log('\n📄 Uploading bio.txt...');
    const content = fs.readFileSync(bioPath, 'utf-8');
    // Split into ~2000 char chunks with overlap
    const chunks = [];
    let i = 0;
    while (i < content.length) {
      chunks.push(content.slice(i, i + 2000));
      i += 1800;
    }
    for (let j = 0; j < chunks.length; j++) {
      const values = await embed(chunks[j]);
      await upsert([{ id: `bio-${j}`, values, metadata: { text: chunks[j], source: 'bio.txt', type: 'bio' } }]);
      console.log(`  ✓ Chunk ${j + 1}/${chunks.length}`);
    }
  }

  // 3. Upload upload.json
  const uploadPath = path.resolve(__dirname, '../upload.json');
  if (fs.existsSync(uploadPath)) {
    console.log('\n📄 Uploading upload.json...');
    const raw = fs.readFileSync(uploadPath, 'utf-8').trim();
    const items = raw.startsWith('[') ? JSON.parse(raw) : [JSON.parse(raw)];
    for (let j = 0; j < items.length; j++) {
      const item = items[j];
      const text = item.content || item.text || JSON.stringify(item);
      const values = await embed(text);
      await upsert([{ id: `upload-${j}`, values, metadata: { text, source: item.source || 'upload.json', type: item.type || 'doc' } }]);
      console.log(`  ✓ Item ${j + 1}/${items.length}`);
    }
  }

  console.log('\n🎉 Done! Pinecone index re-indexed with Gemini embeddings.');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
