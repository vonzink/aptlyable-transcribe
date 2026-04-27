/** Whitespace-delimited word count. Returns 0 for empty/whitespace-only input. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}
