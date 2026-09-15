# Wolves Family Ticket Draft

Snake-draft the family's Timberwolves **Half Season Green** tickets, live, from
four phones at once. Built for the 2026-27 package: 20 home games, 4 seats each.

**Live:** https://peterlundquist33-source.github.io/wolves-ticket-draft/

## Rules

- 4 drafters, snake order (1-2-3-4, 4-3-2-1, …), order shuffled in the lobby.
- One pick = **2 seats** to one game, one pair at a time. 40 picks total, 10 each.
  Want all 4 seats to a game? Take the other pair on a later turn if it's still open.
- Ticket prices (per seat) are optional, set under Commissioner tools in the Lobby.
  Once set, cards show the price, My Games shows what you owe, Season shows totals.
- Can't make many games? **Pass** on your turn: you give up one pair of seats for the season.
- A game closes once both seat-pairs are claimed. The draft ends when every pair is
  claimed or nobody has picks left; anything left over from passes is first come,
  first served ("Claim" on the board).

## Stack

Same setup as Rizzlers Pick'ems and the wedding planner: a static site on GitHub
Pages plus **Firebase Firestore** (project `rizzlers-pickems`) for real-time state.
No accounts; each person picks their name on their phone.

- `index.html`, `styles.css`, `app.js` — the UI. Firebase compat SDK from CDN.
- `draft.js` — the rules engine (pure functions, no DOM). `node --test test/draft.test.js` runs its tests.
- `games.js` — the game pool (the package schedule).
- `firestore.rules` — shape/size limits on the `wolvesdraft` collection.

State is one Firestore document, `wolvesdraft/family-2026-27`:
`{ participants, order, started, prices?: {gameId: perSeat}, picks: [{game, person, seats, ts} | {pass} | {claim}] }`.
Everything else (whose turn, board status, each person's games) is derived
client-side, and picks are written in a transaction that re-validates the turn.

## Run / deploy

It's static: open `index.html` from any local server (`python3 -m http.server`).
Push to `main` and GitHub Pages serves it. Firestore rules are published from
`firestore.rules` via the Firebase console or the Rules API.

Commissioner reset (wipes all picks) is under the Lobby tab.
