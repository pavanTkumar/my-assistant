// Read an env var, stripping surrounding quotes and stray whitespace/newlines.
// Dashboard env fields (Vercel, etc.) store values literally, so a value pasted
// as "sk-..." keeps the quotes and a value pasted with a trailing newline keeps
// the newline — both then break as URLs or HTTP header values. This sanitizes.
export const env = (name: string, fallbacks: string[] = []): string => {
  for (const key of [name, ...fallbacks]) {
    const raw = process.env[key];
    if (raw != null && raw.trim() !== '') {
      return raw.trim().replace(/^["']|["']$/g, '').trim();
    }
  }
  return '';
};
