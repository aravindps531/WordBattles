# Sarathys' Word Battles

A private family word game for 2 to 4 players, built to be played a few moves a day across time zones.

- Standard 15x15 board, 100-tile English set, standard scoring, 50-point bonus for using all 7 tiles.
- Words are checked instantly against **Collins Scrabble Words 2021 + NASPA Word List 2023** combined (283,573 words; UK/Indian and US spellings). Invalid words are rejected before the turn is used.
- Standard end rules: exchanges need at least 7 tiles in the bag; the game ends when someone goes out with the bag empty (they gain everyone else's leftover tile values), or after 6 scoreless turns in a row (everyone loses their own leftover values).
- Each person signs in with a **personal link**; no passwords.
- **Push notifications** when it's your turn; the board shows who is playing now and who is next, and highlights the last word played.
- Any number of games can run at once. No time limits.
- Works on phones and tablets; can be added to the home screen as an app.

## How it's built

| Part | Technology | Cost |
|---|---|---|
| Hosting + API | Cloudflare Workers (static assets + one Worker) | Free plan |
| Database | Cloudflare D1 (SQLite) | Free plan |
| Notifications | Web Push (VAPID), implemented with WebCrypto | Free |
| UI | Preact + TypeScript, built with Vite | — |

```
src/shared/   game engine (rules, scoring, dictionary lookup), used by both server and browser
src/worker/   API, personal-link handling, push notifications
src/client/   the app (home, game, admin pages)
public/       word list, service worker, icons
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
2. Add each person (e.g. Aravind, PViji, Anitha).
3. Use **Send on WhatsApp** to send each person their own link.

### What each person does once

- **Android phone/tablet (Chrome):** open the link, tap **Turn on notifications**. Optionally use the menu to *Add to Home screen*.
- **iPhone/iPad (Safari, iOS 16.4+):** open the link, tap **Share → Add to Home Screen**, open the app from the home screen, then tap **Turn on notifications**. Apple only allows web notifications for home-screen apps.

## Automatic deploys (optional)

`.github/workflows/deploy.yml` runs the tests on every push and deploys `main` to Cloudflare. Add two repository secrets: `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers", plus D1 edit permission) and `CLOUDFLARE_ACCOUNT_ID`. Without them, the workflow only runs tests.

## Local development

```bash
cp .dev.vars.example .dev.vars    # then fill in values (npm run vapid)
npm run db:migrate:local
npm run dev                       # http://localhost:8787
npm test
```

## Notes and limits

- **Word list licensing.** CSW is owned by Collins and NWL by NASPA. The list is **not stored in this repository**; `npm run build` downloads it into `public/words-v1.txt` (git-ignored). The repo's CC0 license covers the code only. The deployed site serves the list to players, which is fine for private family play; don't promote the site publicly.
- **Name.** "Scrabble" is a trademark, so the game uses its own name and look.
- **Lost or leaked link:** on `/admin`, press **New link** for that person; the old link stops working immediately.
- **Free plan headroom:** D1 allows 5 million reads and 100,000 writes per day; a family game uses a tiny fraction of that.
