# Sarathys' Game Room

Private family games built to be played a few moves a day across time zones: **Word Battles** (2 to 4 players) and **Chess** (against family or the computer).

## Word Battles


- Standard 15x15 board, 100-tile English set, standard scoring, 50-point bonus for using all 7 tiles.
- Words are checked instantly against **Collins Scrabble Words 2021 + NASPA Word List 2023** combined (283,573 words; UK/Indian and US spellings). Invalid words are rejected before the turn is used.
- Standard end rules: exchanges need at least 7 tiles in the bag; the game ends when someone goes out with the bag empty (they gain everyone else's leftover tile values), or after 6 scoreless turns in a row (everyone loses their own leftover values).
- Each person signs in with a **personal link**; no passwords.
- **Push notifications** when it's your turn; the board shows who is playing now and who is next, and highlights the last word played.
- Any number of games can run at once. No time limits.
- Works on phones and tablets; can be added to the home screen as an app.

## Chess

- Full standard rules: castling, en passant, promotion (with a choice of piece), check, checkmate.
- Automatic draws for stalemate, threefold repetition, the 50-move rule and insufficient material.
- Played over days with a "your move" notification; no clocks. Draw offers, resignation, and takebacks if your opponent agrees.
- Tap a piece to see its legal moves. Optional "confirm each move" step (on by default) to avoid misplays on a phone.
- Move list with replay of any earlier position.
- **Play the computer** at levels 1 (gentle) to 8 (very strong); undo is allowed against the computer.
- **Computer review** of finished games: accuracy for each player, and every move marked as an inaccuracy (?!), mistake (?) or blunder (??), with the better move shown on the board.
- The engine (Stockfish) runs in the player's browser, so it costs nothing on the server.

## How it's built

| Part | Technology | Cost |
|---|---|---|
| Hosting + API | Cloudflare Workers (static assets + one Worker) | Free plan |
| Database | Cloudflare D1 (SQLite) | Free plan |
| Notifications | Web Push (VAPID), implemented with WebCrypto | Free |
| UI | Preact + TypeScript, built with Vite | — |

```
src/shared/   game rules (word game engine, chess rules via chess.js, dictionary lookup), shared by server and browser
src/worker/   API, personal-link handling, push notifications
src/client/   the app (home, game, admin pages)
public/       service worker, icons, chess pieces (word list and chess engine are downloaded at build time)
migrations/   database schema
test/         engine and push-encryption tests
```

The server is authoritative: the browser previews scores and word validity, but every move is re-validated on the server. Other players' tiles and the bag order are never sent to the browser.

## One-time setup (about 15 minutes)

You need a free Cloudflare account and Node.js 20+.

```bash
npm install
npx wrangler login

# 1. Create the database, then paste the printed database_id into wrangler.jsonc
npx wrangler d1 create word-battles
npm run db:migrate

# 2. Admin key (any long random string; you'll type it on the /admin page)
npx wrangler secret put ADMIN_KEY

# 3. Notification keys
npm run vapid
#   -> put VAPID_PUBLIC_KEY into wrangler.jsonc under "vars"
#   -> npx wrangler secret put VAPID_PRIVATE_KEY   (paste the private value)

# 4. Deploy
npm run deploy
```

Wrangler prints the site address, e.g. `https://sarathys-word-battles.<your-subdomain>.workers.dev`.

### Add the family

1. Open `https://<your-site>/admin` and enter the admin key.
2. Add each person (e.g. Aravind, PViji, Anitha, and the kids for chess).
3. Use **Send on WhatsApp** to send each person their own link.

### What each person does once

- **Android phone/tablet (Chrome):** open the link, tap **Turn on notifications**. Optionally use the menu to *Add to Home screen*.
- **iPhone/iPad (Safari, iOS 16.4+):** open the link, tap **Share → Add to Home Screen**, open the app from the home screen, then tap **Turn on notifications**. Apple only allows web notifications for home-screen apps.

## Automatic deploys (optional)

`.github/workflows/deploy.yml` runs the tests on every push and deploys `main` to Cloudflare. Add two repository secrets: `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers", plus D1 edit permission) and `CLOUDFLARE_ACCOUNT_ID`. Without them, the workflow only runs tests.

## Updating an existing site

After pulling new code that includes a new file in `migrations/`, update the database before deploying:

```bash
git pull
npm install
npm run db:migrate
npm run deploy
```

## Local development

```bash
cp .dev.vars.example .dev.vars    # then fill in values (npm run vapid)
npm run db:migrate:local
npm run dev                       # http://localhost:8787
npm test
```

## Notes and limits

- **Word list licensing.** CSW is owned by Collins and NWL by NASPA. The list is **not stored in this repository**; `npm run build` downloads it into `public/words-v1.txt` (git-ignored). The repo's CC0 license covers the code only. The deployed site serves the list to players, which is fine for private family play; don't promote the site publicly.
- **Chess engine licensing.** Stockfish is GPL-3.0. It is **not stored in this repository**; `npm run build` downloads it into `public/engine/` (git-ignored) from the npm CDN, and the site serves it unmodified with its license notice.
- **Chess pieces.** "Chessnut" set by Alexis Luengas, Apache License 2.0 (`public/pieces/LICENSE.txt`).
- **Name.** "Scrabble" is a trademark, so the word game uses its own name and look.
- **Lost or leaked link:** on `/admin`, press **New link** for that person; the old link stops working immediately.
- **Free plan headroom:** D1 allows 5 million reads and 100,000 writes per day; a family game uses a tiny fraction of that.
