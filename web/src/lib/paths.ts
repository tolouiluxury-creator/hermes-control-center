/** Parent of an absolute path, in whichever separator the host reports. */
export function parentOf(absolute: string): string {
  const cut = Math.max(absolute.lastIndexOf('/'), absolute.lastIndexOf('\\'));
  return cut <= 0 ? absolute : absolute.slice(0, cut);
}
