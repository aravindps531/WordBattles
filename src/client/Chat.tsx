import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { Api, ChatMessage } from "./api";

const POLL_MS = 15000;
const QUICK = ["👍", "😂", "❤️", "😮", "👏", "🎉", "🙏", "🔥"];
const MORE = [
  "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😊", "🙂", "😉", "😍", "🥰", "😘", "😋", "😎", "🤓",
  "🤔", "🤨", "😐", "🙄", "😏", "😬", "😌", "😴", "🥱", "😢", "😭", "😤", "😡", "🤯", "😱", "🥳",
  "😇", "🤗", "🤭", "🤫", "😈", "👻", "🙈", "🙉", "👍", "👎", "👌", "✌️", "🤞", "👋", "🙌", "💪",
  "❤️", "🧡", "💛", "💚", "💙", "💜", "💔", "💯", "✨", "⭐", "🏆", "🥇", "🎯", "🎲", "🧩", "♟️",
  "📖", "🧠", "💡", "⏳", "☕", "🍵", "🍰", "🌸", "🌞", "🌙", "🎂", "🎁",
];

/** True when a message is only emoji (shown larger, like most chat apps). */
export function isEmojiOnly(text: string): boolean {
  const t = text.replace(/\s/g, "");
  return t.length > 0 && t.length <= 16 && /^(\p{Extended_Pictographic}|\p{Emoji_Component}|️|‍)+$/u.test(t)
    && !/^[\d#*]+$/.test(t);
}

function timeLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return sameDay ? time : `${d.toLocaleDateString([], { day: "numeric", month: "short" })}, ${time}`;
}

/**
 * Chat for one game. Always mounted (so the unread badge stays current);
 * the panel itself shows only when `open` is true.
 */
export function useChat(api: Api, gameId: string, meId: string | null, open: boolean) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lastReadId, setLastReadId] = useState(0);
  const lastIdRef = useRef(0);

  const load = useCallback(async () => {
    try {
      const r = await api.chatMessages(gameId, lastIdRef.current);
      if (r.messages.length) {
        lastIdRef.current = r.messages[r.messages.length - 1].id;
        setMessages((ms) => {
          const seen = new Set(ms.map((m) => m.id));
          return [...ms, ...r.messages.filter((m) => !seen.has(m.id))];
        });
      }
      setLastReadId((x) => Math.max(x, r.lastReadId));
    } catch { /* offline: try again on the next poll */ }
  }, [api, gameId]);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, POLL_MS);
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    const onMsg = (e: MessageEvent) => { if (e.data?.type === "refresh") load(); };
    document.addEventListener("visibilitychange", onVis);
    navigator.serviceWorker?.addEventListener("message", onMsg);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
      navigator.serviceWorker?.removeEventListener("message", onMsg);
    };
  }, [load]);

  // Mark everything read while the panel is open.
  const newest = messages.length ? messages[messages.length - 1].id : 0;
  useEffect(() => {
    if (open && newest > lastReadId) {
      setLastReadId(newest);
      api.markChatRead(gameId, newest).catch(() => {});
    }
  }, [open, newest, lastReadId, api, gameId]);

  const unread = messages.filter((m) => m.id > lastReadId && m.playerId !== meId).length;

  const send = async (text: string) => {
    const r = await api.sendChat(gameId, text);
    lastIdRef.current = Math.max(lastIdRef.current, r.message.id);
    setMessages((ms) => (ms.some((m) => m.id === r.message.id) ? ms : [...ms, r.message]));
    setLastReadId((x) => Math.max(x, r.message.id));
  };

  return { messages, unread, send };
}

export function ChatPanel({ messages, meId, onSend, onClose }: {
  messages: ChatMessage[]; meId: string | null; onSend: (text: string) => Promise<void>; onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const insert = (emoji: string) => {
    const el = inputRef.current;
    if (!el) { setText((t) => t + emoji); return; }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + emoji.length;
    });
  };

  const submit = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend(t);
      setText("");
      setShowMore(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div class="chat-back" onClick={onClose}>
      <section class="chat" role="dialog" aria-label="Game chat" onClick={(e) => e.stopPropagation()}>
        <header class="chat-head">
          <h2>Chat</h2>
          <button class="btn" onClick={onClose} aria-label="Close chat">Close</button>
        </header>
        <div class="chat-list" ref={listRef} aria-live="polite">
          {messages.length === 0 && <p class="muted center small">No messages yet. Say hello!</p>}
          {messages.map((m, i) => {
            const mine = m.playerId === meId;
            const showName = !mine && (i === 0 || messages[i - 1].playerId !== m.playerId);
            return (
              <div key={m.id} class={`bubble-row ${mine ? "mine" : ""}`}>
                <div class={`bubble ${isEmojiOnly(m.body) ? "emoji-only" : ""}`}>
                  {showName && <span class="who">{m.name}</span>}
                  <span class="text">{m.body}</span>
                  <span class="at">{timeLabel(m.at)}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div class="quick" aria-label="Quick emoji">
          {QUICK.map((e) => <button key={e} class="emoji-btn" onClick={() => insert(e)} aria-label={`Insert ${e}`}>{e}</button>)}
          <button class={`emoji-btn more ${showMore ? "on" : ""}`} onClick={() => setShowMore((s) => !s)}
            aria-label="More emoji" aria-expanded={showMore}>{showMore ? "×" : "😊+"}</button>
        </div>
        {showMore && (
          <div class="emoji-grid" aria-label="Emoji">
            {MORE.map((e) => <button key={e} class="emoji-btn" onClick={() => insert(e)} aria-label={`Insert ${e}`}>{e}</button>)}
          </div>
        )}
        {error && <p class="msg error">{error}</p>}
        <form class="chat-input" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <textarea
            ref={inputRef}
            rows={1}
            maxLength={500}
            placeholder="Message"
            value={text}
            onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          />
          <button class="btn primary" disabled={!text.trim() || sending}>Send</button>
        </form>
      </section>
    </div>
  );
}
