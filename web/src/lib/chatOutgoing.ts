/** Prepends attachment reference text ahead of the message body, separated by a blank line. */
export function buildOutgoingText(refs: string[], text: string): string {
  return refs.length > 0 ? `${refs.join('\n')}\n\n${text}` : text;
}
