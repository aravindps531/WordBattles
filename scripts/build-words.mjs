// Rebuilds public/words-v1.txt as the union of Collins Scrabble Words (CSW21)
// and the NASPA Word List (NWL2023). Output: one uppercase word per line,
// byte-sorted, which the binary-search Dictionary relies on.
//
// The list is not committed to the repository (it is copyrighted by Collins and
// NASPA); it is downloaded at build time. Runs automatically before build/test.
//
// Usage: node scripts/build-words.mjs [--if-missing] [csw.txt] [nwl.txt]
// Files may include definitions after the word; only the first token is used.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const OUT = new URL("../public/words-v1.txt", import.meta.url);
const args = process.argv.slice(2);
if (args.includes("--if-missing") && existsSync(OUT)) process.exit(0);

const BASE = "https://raw.githubusercontent.com/scrabblewords/scrabblewords/main/words";
const sources = args.filter((a) => !a.startsWith("--"));
const inputs = sources.length
  ? sources.map((f) => readFileSync(f, "utf8"))
  : await Promise.all([`${BASE}/British/CSW21.txt`, `${BASE}/North-American/NWL2023.txt`].map(async (u) => {
      const r = await fetch(u);
      if (!r.ok) throw new Error(`${u}: ${r.status}`);
      return r.text();
    }));

const words = new Set();
for (const text of inputs) {
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const w = line.split(/\s/)[0].toUpperCase();
    if (/^[A-Z]{2,15}$/.test(w)) words.add(w);
  }
}
const sorted = [...words].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
writeFileSync(OUT, sorted.join("\n") + "\n");
console.log(`Wrote ${sorted.length} words.`);
