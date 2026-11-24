export function isCodeComment(line: string): boolean {
  const trimmed = line.trimStart();
  return (
    trimmed.startsWith("#") ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("%") ||
    trimmed.startsWith("--") ||
    trimmed.startsWith("<!--")
  );
}
