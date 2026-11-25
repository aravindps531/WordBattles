import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";

export type HowToKey = "words" | "chess" | "go" | "sea";
const storageKey = (k: HowToKey) => `swb-howto-hidden-${k}`;

function isHidden(k: HowToKey): boolean {
  try { return localStorage.getItem(storageKey(k)) === "1"; } catch { return false; }
}

/** Shows the guide automatically until the player chooses not to; the "?" button reopens it. */
export function useHowTo(k: HowToKey) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!isHidden(k)) setOpen(true); }, [k]);
  return { open, show: () => setOpen(true), close: () => setOpen(false) };
}

export function HowToButton({ onClick }: { onClick: () => void }) {
  return <button class="btn help-btn" onClick={onClick} aria-label="How to play">?</button>;
}

export function HowToPanel({ k, title, onClose, children }: { k: HowToKey; title: string; onClose: () => void; children: ComponentChildren }) {
  const [dontShow, setDontShow] = useState(isHidden(k));
  const close = () => {
    try { localStorage.setItem(storageKey(k), dontShow ? "1" : "0"); } catch { /* ignore */ }
    onClose();
  };
  return (
    <div class="modal-back" onClick={close}>
      <div class="modal howto" role="dialog" aria-label={`How to play ${title}`} onClick={(e) => e.stopPropagation()}>
        <h3>How to play {title}</h3>
        <div class="howto-body">{children}</div>
        <label class="setting">
          <input type="checkbox" checked={dontShow} onChange={(e) => setDontShow((e.target as HTMLInputElement).checked)} />
          Don't show this again (the ? button brings it back)
        </label>
        <button class="btn primary wide" onClick={close}>Start playing</button>
      </div>
    </div>
  );
}

export function WordsHowTo() {
  return (
    <ul>
      <li><b>Goal:</b> score the most points by making words on the board, crossword style.</li>
      <li><b>Placing tiles:</b> tap a square, then tap your letters; they flow to the right. Tap the square again to go downwards. You can also tap a letter, then a square. Tap a placed tile to take it back.</li>
      <li>The first word must cover the centre star. After that, every word must connect to tiles already on the board.</li>
      <li>The line above your tiles shows the score as you go, and turns red if a word isn't valid. Invalid words never cost you a turn.</li>
      <li><b>Bonus squares:</b> 2L / 3L double or triple a letter; 2W / 3W double or triple the whole word. Using all 7 tiles earns 50 extra points.</li>
      <li><b>Blank tiles</b> can be any letter and score 0.</li>
      <li>Not happy with your letters? <b>Swap</b> some (only while the bag has 7 or more) or <b>Pass</b>.</li>
      <li><b>End:</b> when someone uses their last tile and the bag is empty, or after 6 turns in a row with no score. Leftover tiles count against you.</li>
    </ul>
  );
}

export function ChessHowTo() {
  return (
    <ul>
      <li>Standard chess rules. Tap one of your pieces to see where it can go (dots), then tap a dot to move.</li>
      <li>With "confirm each move" on, you'll see the move on the board first; press <b>Play</b> to send it.</li>
      <li>Castling, en passant and promotion all work as usual. You choose the piece when a pawn promotes.</li>
      <li>Draws happen automatically for stalemate, repeating the same position three times, the 50-move rule, or too few pieces to checkmate.</li>
      <li>You can <b>offer a draw</b>, <b>resign</b>, or <b>ask to take back</b> your last move before your opponent replies (they must agree).</li>
      <li>Use the arrows to replay earlier moves. Against the computer, <b>Undo</b> works straight away.</li>
      <li>After a game, <b>Review</b> shows mistakes (?), blunders (??) and the better moves.</li>
    </ul>
  );
}

export function GoHowTo() {
  return (
    <ul>
      <li><b>Goal:</b> control more of the board than your opponent. Black plays first (White first in handicap games).</li>
      <li><b>Placing a stone:</b> tap a point where the lines cross, then tap again or press <b>Play</b> to confirm. Stones never move once placed.</li>
      <li><b>Capturing:</b> stones next to each other along the lines form a group. A group with no empty points next to it is captured and removed.</li>
      <li>You can't place a stone where it would have no empty neighbours, unless it captures something.</li>
      <li><b>Ko:</b> you can't make a move that repeats an earlier board position; play somewhere else first.</li>
      <li><b>Ending:</b> when neither of you can gain more, both <b>Pass</b>. Then tap any groups that are surrounded and would be captured anyway (dead stones) and press <b>Accept score</b>. If you disagree, press <b>Resume play</b> and settle it on the board.</li>
      <li><b>Scoring:</b> your stones plus empty points you surround. White gets 7.5 extra points (komi) for moving second.</li>
      <li>Turn on <b>Beginner hints</b> to see which stones are in danger (red) or can be captured (green).</li>
    </ul>
  );
}

export function SeaHowTo() {
  return (
    <ul>
      <li><b>Goal:</b> sink all of your opponent's ships before they sink yours.</li>
      <li><b>Setup:</b> tap a ship in the list, then tap the grid to place it. Tap a placed ship to turn it around. <b>Random fleet</b> does it for you. Ships may touch. Press <b>Ready</b> when done; your opponent never sees where they are.</li>
      <li><b>Firing (Salvo rule):</b> each turn you fire one shot for every ship you still have afloat. Tap squares on the enemy grid to aim, then press <b>Fire</b>.</li>
      <li><b>Results:</b> a red mark is a hit, a dot is a miss. When a ship is sunk it's announced and shown on the grid.</li>
      <li>Losing ships means fewer shots, so protect your fleet by sinking theirs first.</li>
      <li><b>Equal turns:</b> if the player who fired first sinks the whole fleet, the other player gets one last salvo. If that sinks everything too, it's a draw.</li>
    </ul>
  );
}
