/** Читает весь stdin как UTF-8 строку (без изменений, кроме обрезки краёв). */
export async function readStdinText(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string, 'utf8'));
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}
