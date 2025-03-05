// src/app/api/pinecone/upload/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { addDocument } from '@/lib/pinecone';
import { OpenAIEmbeddings } from '@langchain/openai';

export async function POST(request: NextRequest) {
  try {
    // Get the request data
    const body = await request.json();
    const { content, type, source } = body;
    
    if (!content) {
      return NextResponse.json({ error: 'No content provided' }, { status: 400 });
    }
    
    // Metadata
    const metadata = {
      type: type || 'document',
      source: source || 'api',
      timestamp: new Date().toISOString()
    };
    
    // Split long content if needed
    if (content.length > 4000) {
      // Split into chunks
      const chunks = [];
      let i = 0;
      while (i < content.length) {
        chunks.push(content.slice(i, i + 4000));
        i += 3800; // Overlapping chunks
      }
      
      // Insert each chunk
      let insertedCount = 0;
      for (let i = 0; i < chunks.length; i++) {
        await addDocument(chunks[i], {
          ...metadata,
          chunk: i + 1,
          totalChunks: chunks.length
        });
        insertedCount++;
      }
      
      return NextResponse.json({
        success: true,
        message: `Content added to knowledge base. Split into ${insertedCount} chunks.`
      });
    } else {
      // Insert as single document
      await addDocument(content, metadata);
      
      return NextResponse.json({
        success: true,
        message: 'Content added to knowledge base.'
      });
    }
  } catch (error) {
    console.error('Error uploading to Pinecone:', error);
    return NextResponse.json({ 
      error: 'Failed to upload content',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}