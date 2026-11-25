/**
 * Word lookup over a newline-separated, byte-sorted (LC_ALL=C), uppercase word list.
 *
 * Uses binary search directly on the raw text, so there is no parse/build step.
 * That matters on the Cloudflare Workers free plan, where each request gets
 * ~10ms of CPU: splitting 283k words into a Set would blow that budget.
 */
export class Dictionary {
  private readonly text: string;

  constructor(text: string) {
    // Normalise line endings and guarantee a trailing newline.
    let t = text.includes("\r") ? text.replace(/\r/g, "") : text;
    if (!t.endsWith("\n")) t += "\n";
    this.text = t;
  }

  has(word: string): boolean {
    const target = word.toUpperCase();
    if (target.length < 2) return false;
    const text = this.text;
    let lo = 0;
    let hi = text.length; // search window of character offsets [lo, hi)
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      // Move to the start of the line containing mid.
      const start = text.lastIndexOf("\n", mid - 1) + 1;
      if (start < lo) {
        // Window begins mid-line (cannot happen since lo is always a line start),
        // but guard against infinite loops.
        break;
      }
      const end = text.indexOf("\n", start);
      const w = text.slice(start, end);
      if (w === target) return true;
      if (w < target) lo = end + 1;
      else hi = start;
    }
    return false;
  }
}
