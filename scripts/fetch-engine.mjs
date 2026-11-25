// Downloads the Stockfish chess engine (WebAssembly build, GPL-3.0) into public/engine/.
// It is not committed to the repository; this runs automatically before `npm run build`.
// Source: https://github.com/nmrugg/stockfish.js (npm package "stockfish").
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const VERSION = "18.0.8";
const FILES = ["stockfish-18-lite-single.js", "stockfish-18-lite-single.wasm"];
const MIRRORS = [
  (f) => `https://cdn.jsdelivr.net/npm/stockfish@${VERSION}/bin/${f}`,
  (f) => `https://unpkg.com/stockfish@${VERSION}/bin/${f}`,
];
const dir = new URL("../public/engine/", import.meta.url);

if (process.argv.includes("--if-missing") && FILES.every((f) => existsSync(new URL(f, dir)))) process.exit(0);
mkdirSync(dir, { recursive: true });

for (const f of FILES) {
  let ok = false;
  for (const mirror of MIRRORS) {
    try {
      const res = await fetch(mirror(f));
      if (!res.ok) throw new Error(String(res.status));
      writeFileSync(new URL(f, dir), Buffer.from(await res.arrayBuffer()));
      console.log(`Downloaded ${f}`);
      ok = true;
      break;
    } catch (e) {
      console.warn(`Could not fetch ${mirror(f)}: ${e.message}`);
    }
  }
  if (!ok) {
    console.error(`Failed to download ${f}. Chess vs computer and game review won't work until it is available.`);
    process.exit(1);
  }
}
writeFileSync(new URL("README.txt", dir),
  `Stockfish ${VERSION} (lite, single-threaded WebAssembly build) by the Stockfish developers and Nathan Rugg.\n` +
  "Licensed under the GNU General Public License v3. Source: https://github.com/nmrugg/stockfish.js\n");
