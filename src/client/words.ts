import { Dictionary } from "../shared/dictionary";

let promise: Promise<Dictionary> | null = null;

/** Loads the word list once (cached by the browser for a year). */
export function loadDictionary(): Promise<Dictionary> {
  if (!promise) {
    promise = fetch("/words-v1.txt")
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.text(); })
      .then((t) => new Dictionary(t))
      .catch((e) => { promise = null; throw e; });
  }
  return promise;
}
