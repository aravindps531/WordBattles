import { useEffect, useState } from "preact/hooks";
import { adminFetch } from "./api";

interface AdminPlayer { id: string; name: string; token: string; link: string }
const KEY = "swb-admin-key";

function readKey(): string {
  try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; }
}

export function AdminPage() {
  const [key, setKey] = useState(readKey);
  const [entered, setEntered] = useState(readKey);
  const [players, setPlayers] = useState<AdminPlayer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");

  const load = async (k: string) => {
    try {
      const r = await adminFetch<{ players: AdminPlayer[] }>(k, "/api/admin/players");
      setPlayers(r.players);
      setError(null);
      try { localStorage.setItem(KEY, k); } catch { /* ignore */ }
    } catch (e) {
      setPlayers(null);
      setError((e as Error).message);
    }
  };

  useEffect(() => { if (key) load(key); }, [key]);

  const add = async (e: Event) => {
    e.preventDefault();
    try {
      await adminFetch(key, "/api/admin/players", { method: "POST", body: JSON.stringify({ name }) });
      setName("");
      load(key);
    } catch (err) { setError((err as Error).message); }
  };

  const reset = async (p: AdminPlayer) => {
    if (!confirm(`Make a new link for ${p.name}? The old link will stop working.`)) return;
    try {
      await adminFetch(key, `/api/admin/players/${p.id}/reset-link`, { method: "POST" });
      load(key);
    } catch (err) { setError((err as Error).message); }
  };

  return (
    <div class="page">
      <h1 class="title">Players &amp; links</h1>
      {!players && (
        <form class="card" onSubmit={(e) => { e.preventDefault(); setKey(entered); }}>
          <label class="field">Admin key
            <input type="password" value={entered} onInput={(e) => setEntered((e.target as HTMLInputElement).value)} autoComplete="current-password" />
          </label>
          <button class="btn primary">Open</button>
        </form>
      )}
      {error && <p class="msg error">{error}</p>}
      {players && (
        <>
          <section class="card">
            <h2>Add a player</h2>
            <form class="row" onSubmit={add}>
              <input placeholder="Name, e.g. PViji" value={name} maxLength={30}
                onInput={(e) => setName((e.target as HTMLInputElement).value)} />
              <button class="btn primary" disabled={!name.trim()}>Add</button>
            </form>
          </section>
          <ul class="admin-list">
            {players.map((p) => {
              const msg = `Hi ${p.name}! Here is your personal link for Sarathys' Word Battles:\n${p.link}\n\nOpen it, then add it to your home screen. Please don't share this link.`;
              return (
                <li key={p.id} class="card">
                  <div class="admin-name">{p.name}</div>
                  <input class="link-field" readOnly value={p.link} onFocus={(e) => (e.target as HTMLInputElement).select()} />
                  <div class="row">
                    <button class="btn" onClick={() => navigator.clipboard?.writeText(p.link)}>Copy link</button>
                    <a class="btn" href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer">Send on WhatsApp</a>
                    <a class="btn" href={p.link}>Open as {p.name}</a>
                    <button class="btn" onClick={() => reset(p)}>New link</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
