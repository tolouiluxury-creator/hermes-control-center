/**
 * Ranking for the command palette.
 *
 * Four tiers, best first: the label starts with the query, a word inside it
 * starts with the query, the query appears anywhere, or a keyword matches.
 * Below those, a subsequence match catches abbreviations and dropped vowels
 * ("brwsr" → "Browser Automation"). Anything else scores zero and is dropped:
 * a palette that matches everything is a palette that helps with nothing.
 */
export function scoreCommand(query: string, label: string, keywords: string[] = []): number {
  const needle = query.trim().toLowerCase();
  if (needle === '') return 1;

  const haystack = label.toLowerCase();

  // Shorter labels win ties, so "Logs" outranks "Logs durchsuchen" for "log".
  if (haystack.startsWith(needle)) return 100 - Math.min(haystack.length, 99) / 100;
  if (haystack.split(/[\s(/-]+/).some((word) => word.startsWith(needle))) return 80;
  if (haystack.includes(needle)) return 60;
  if (keywords.some((keyword) => keyword.toLowerCase().includes(needle))) return 40;

  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) index += 1;
    if (index === needle.length) return 20;
  }

  return 0;
}
