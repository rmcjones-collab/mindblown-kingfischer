# Kingfischer on Lichess

`bot/lichess/bot.js` plays through the Lichess Bot API. Lichess only lets **BOT accounts** use the API for play.

## One-time setup (owner only)

1. Create a **new** Lichess account for the bot. It must never have played a game.
2. Create a personal API token for it with the `bot:play` scope.
3. Upgrade it to a BOT account: `curl -d '' https://lichess.org/api/bot/account/upgrade -H "Authorization: Bearer <token>"`. **This is permanent.** Kingfischer's scripts never do this step.

BOT accounts can play casual and rated games and accept challenges, but cannot join tournaments or simuls, use lobby seeks or appear on leaderboards.

## Run

```sh
export LICHESS_TOKEN=...            # never commit it
node bot/lichess/bot.js             # or: node bot/lichess/bot.js path/to/config.json --dry-run
```

`--dry-run` connects, prints what it would accept or decline, and plays nothing. The script refuses to run if the account is not a BOT.

## What it accepts

Set in a `"lichess"` block in `kingfischer.config.json` (defaults in `bot/lichess/policy.js`): one game at a time, standard or from-position, blitz/rapid/classical/correspondence, at least 60 s on the clock, rated and casual, humans only (`"bots": true` to allow bots). Declines use Lichess's own reasons (`later`, `tooFast`, `variant`, `noBot`, …).

## Modes in a game

The opponent can type `!full`, `!teach` or `!human 1100`–`!human 1900` in the chat before move 2. In teach mode the King posts its first reason after each move (140 characters). The default mode comes from the config.

## Connection drops

The event stream reconnects with backoff (1 s doubling to 30 s) and handles the challenges and games Lichess replays on reconnect only once. A game stream that drops mid-game reopens, and its first `gameFull` restores the position. A failed think or a refused move is retried once with 30 % of the budget. Chat never delays a move: messages are sent in the background, and failures are only logged. Accepted challenges count against `maxGames` until their game starts. Capacity is checked last, so a bullet challenge is declined as `tooFast`, not `later`.

## Testing without Lichess

`node tools/fake-lichess.mjs` starts a stand-in API on port 8787. Then `LICHESS_API=http://127.0.0.1:8787 LICHESS_TOKEN=fake node bot/lichess/bot.js` plays a short game against it. Start it with `FAKE_DROP=1` to also drop the game stream once mid-game.
