export const MAX_REPLY_CHARS = 2000;

// Count UTF-16 code units conservatively and never split an emoji surrogate pair.
export function limitReply(content: string): string {
  if (content.length <= MAX_REPLY_CHARS) return content;
  const clipped = content.slice(0, MAX_REPLY_CHARS - 1).replace(/[\uD800-\uDBFF]$/, "");
  return clipped.trimEnd() + "…";
}
