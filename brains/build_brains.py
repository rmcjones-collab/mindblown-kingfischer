#!/usr/bin/env python3
"""Write the Kingfischer knowledge brains: king-data.js, leela-data.js, maia-data.js and their pages.

Every synapse cites at least one source URL (the Brain helper refuses uncited facts). Facts about Kingfischer itself
cite the code in this repository; facts about the engines cite their projects, papers and public rating lists.
Stockfish has its own brain, built separately; the King Brain keeps a council seat for it and links out, but does not
duplicate it.

    python3 brains/build_brains.py
"""
import html, json, os, re
from mb_shared import load_published, write_network, Brain, BRAINS, HERE

REPO = 'https://github.com/rmcjones-collab/mindblown-kingfischer/blob/master/'
S = {
    'king': REPO + 'king/king.js', 'council': REPO + 'council/council.js', 'desktop': REPO + 'bot/desktop/kingfischer.js',
    'lichess': REPO + 'bot/lichess/bot.js', 'policy': REPO + 'bot/lichess/policy.js', 'browser': REPO + 'bot/browser/council-web.js',
    'maiajs': REPO + 'bot/browser/maia.js', 'validate': REPO + 'tools/validate-maia.mjs', 'rules': REPO + 'docs/KING-RULES.md',
    'lcz': 'https://lczero.org/dev/overview/', 'lc0wiki': 'https://en.wikipedia.org/wiki/Leela_Chess_Zero',
    'bestnets': 'https://lczero.org/play/networks/bestnets/', 'wdl': 'https://lczero.org/blog/2020/04/wdl-head/',
    'encoder': 'https://github.com/LeelaChessZero/lc0/blob/master/src/neural/encoder.cc',
    'policyidx': 'https://github.com/LeelaChessZero/lczero-training/blob/master/tf/policy_index.py',
    'maiarepo': 'https://github.com/CSSLab/maia-chess', 'maiablog': 'http://csslab.cs.toronto.edu/blog/2020/08/24/maia_chess_kdd/',
    'maia2': 'https://github.com/CSSLab/maia2',
    'chessformer': 'https://proceedings.iclr.cc/paper_files/paper/2026/file/3d167db04a90885ad5208fe8b273668b-Paper-Conference.pdf',
    'ccrl': 'https://ramachess.com/topchessengines/', 'tcec': 'https://ramachess.com/tournaments/',
    'uci': 'https://www.chessprogramming.org/UCI', 'syzygy': 'https://www.chessprogramming.org/Syzygy_Bases',
    'sprt': 'https://www.chessprogramming.org/Sequential_Probability_Ratio_Test',
    'botapi': 'https://lichess.org/api#tag/Bot', 'botblog': 'https://lichess.org/blog/WvDNticAAMu_mHKP/welcome-lichess-bots',
    'sfjs': 'https://github.com/nmrugg/stockfish.js',
    'sf19blog': 'https://stockfishchess.org/blog/2026/stockfish-19/', 'sf18blog': 'https://stockfishchess.org/blog/2026/stockfish-18/',
    'wikisf': 'https://en.wikipedia.org/wiki/Stockfish_(chess)',
    'hubsf': 'https://hubbrain.pplx.app/brain.html#b=75ab2900-2000-4d2a-9f98-199bb4c50665',
}
LABELS = {
    'king': 'Kingfischer · king/king.js', 'council': 'Kingfischer · council/council.js', 'desktop': 'Kingfischer · bot/desktop/kingfischer.js',
    'lichess': 'Kingfischer · bot/lichess/bot.js', 'policy': 'Kingfischer · bot/lichess/policy.js', 'browser': 'Kingfischer · bot/browser/council-web.js',
    'maiajs': 'Kingfischer · bot/browser/maia.js', 'validate': 'Kingfischer · tools/validate-maia.mjs', 'rules': 'Kingfischer · docs/KING-RULES.md',
    'lcz': 'LCZero · Technical overview', 'lc0wiki': 'Wikipedia · Leela Chess Zero', 'bestnets': 'LCZero · Best networks',
    'wdl': 'LCZero blog · The WDL head', 'encoder': 'Lc0 source · neural/encoder.cc', 'policyidx': 'lczero-training · policy_index.py',
    'maiarepo': 'CSSLab · maia-chess (GitHub)', 'maiablog': 'CSSLab blog · Maia Chess (KDD 2020)', 'maia2': 'CSSLab · Maia-2 (GitHub)',
    'chessformer': 'ICLR 2026 · Chessformer', 'ccrl': 'Rama Chess · top engines (CCRL 40/15)', 'tcec': 'Rama Chess · tournaments',
    'uci': 'Chess Programming Wiki · UCI', 'syzygy': 'Chess Programming Wiki · Syzygy bases', 'sprt': 'Chess Programming Wiki · SPRT',
    'botapi': 'Lichess API · Bot', 'botblog': 'Lichess blog · Welcome Lichess bots', 'sfjs': 'stockfish.js (GitHub)',
    'sf19blog': 'Stockfish blog: Stockfish 19 (2026)', 'sf18blog': 'Stockfish blog: Stockfish 18 (2026)', 'wikisf': 'Wikipedia: Stockfish (chess)',
    'hubsf': 'MindBlown AI Hub · Stockfish chess engine (unofficial)',
}


def brain(bid, subtitle, lobes, hub):
    B = Brain(bid, next(b['title'] for b in BRAINS if b['id'] == bid), subtitle, lobes, hub)
    for k, u in S.items(): B.src(u, LABELS[k], 'code' if u.startswith(REPO) else 'web')
    return B


def c(*keys): return [S[k] for k in keys]


# ---------------------------------------------------------------- King Brain
K = brain('king', 'the last output gate · every engine reports here, one move goes out', [
    {'id': 'self', 'name': 'King Brain', 'color': '#ff8a3d'},
    {'id': 'gate', 'name': 'The gate', 'color': '#fcd34d'},
    {'id': 'modes', 'name': 'Modes', 'color': '#fca5a5'},
    {'id': 'voices', 'name': 'Council', 'color': '#93c5fd'},
    {'id': 'bots', 'name': 'Bots', 'color': '#86efac'},
], 'king')
K.page('king', 'King Brain', 'hub', 'self', 'The last output gate of Kingfischer: it weighs every engine brain and decides the one move played, with reasons.', [
    ('One gate', 'Every engine brain reports on the same position; the King Brain weighs those reports and decides the one move Kingfischer plays, with a plain-language account of why.', c('king'), ['gate/vote', 'gate/veto']),
    ('Pure', 'The decision function never starts an engine, touches the network or reads a clock, so the desktop engine, the Lichess bot and the browser share it unchanged.', c('king', 'council'), ['bot/desktop', 'bot/lichess', 'bot/browser']),
    ('Order of rules', 'Only move, then the endgame tablebase, then a forced mate found by the referee, then the weighted vote, then the safety veto, then (in human mode) sampling.', c('king', 'rules'), ['gate/tablebase', 'gate/mate', 'gate/vote', 'gate/veto']),
], see=['gate/vote', 'voice/stockfish', 'voice/leela', 'voice/maia'], ring=0)
K.page('gate/tablebase', 'Tablebase first', 'rule', 'gate', 'With 7 or fewer pieces the Lichess tablebase decides, and the vote is skipped.', [
    ('When', 'The council looks up the Lichess tablebase whenever 7 or fewer pieces remain, with a 2.5-second timeout; if it answers, the tablebase move is played.', c('council'), ['king']),
    ('Why it is exact', 'Syzygy tablebases hold perfect play for every position up to 7 pieces; the full 7-man set is about 16.7 TiB, which is why Kingfischer asks Lichess rather than shipping them.', c('syzygy')),
    ('Human mode', 'In human mode the King picks the most human-looking move that keeps the tablebase result, instead of the fastest win.', c('king'), ['mode/human']),
])
K.page('gate/mate', 'Forced mates', 'rule', 'gate', 'A forced mate the referee has found is always played, within a horizon that depends on the mode.', [
    ('Full strength', 'In full and teach modes any forced mate reported by the referee (Stockfish) is played at once.', c('king'), ['voice/stockfish']),
    ('Human horizon', 'In human mode the King only insists on short mates: mate in 1 at 1100, in 2 at 1500 and in 3 at 1900; longer ones are left to the human vote.', c('king', 'rules'), ['mode/human']),
])
K.page('gate/vote', 'The weighted vote', 'rule', 'gate', 'Each engine gives full weight to its best move and fading partial weight to close alternatives.', [
    ('Weights from ratings', 'Search engines are weighted on the Elo scale: an engine 400 points below the strongest gets a tenth of its vote. The ratings are starting assumptions until backtests replace them.', c('king', 'rules'), ['voice/stockfish', 'voice/leela']),
    ('Partial support', "A search engine's other MultiPV lines earn support that fades to zero once they are 0.05 expected score worse than its best.", c('king')),
    ('Maia as tiebreak', 'In full and teach modes the human voice (Maia) has weight 0.15: a style tiebreak, not a decision maker.', c('king'), ['voice/maia']),
])
K.page('gate/veto', 'Safety veto', 'rule', 'gate', 'The referee scores every candidate on one scale and blocks any that give away too much.', [
    ('One scale', 'Stockfish, as referee, re-searches the candidates other voices proposed (searchmoves) so every move is rated in the same search, as expected score for the side to move.', c('council', 'king'), ['voice/stockfish']),
    ('Expected score', 'Expected score comes from win/draw/loss when the engine reports it (UCI_ShowWDL, in permille), otherwise from the centipawn score on the Elo logistic.', c('king', 'wdl')),
    ('Margins', 'Full strength allows 0.02 below the referee\'s choice. Human mode allows 0.30 / 0.20 / 0.12 at 1100 / 1500 / 1900 (soft guard) or 0.12 / 0.08 / 0.05 (strict); the guard can also be switched off.', c('king', 'rules'), ['mode/full', 'mode/human']),
    ('Unrated moves', 'A move the referee never rated cannot win; it is set aside and the King says so.', c('king')),
])
K.page('mode/full', 'Full strength', 'mode', 'modes', 'Play the best move the council can agree on.', [
    ('What it does', 'The vote decides among moves within 0.02 expected score of the referee\'s choice, so Leela or Maia can tip a close call but never pick a worse move.', c('king'), ['gate/vote', 'gate/veto']),
])
K.page('mode/human', 'Human-like', 'mode', 'modes', 'Play a move a person at a chosen level would play, with a blunder guard.', [
    ('Which Maia', 'The council asks the Maia model nearest the requested level and samples its moves in proportion to their probability, seeded so games are reproducible.', c('council', 'king'), ['voice/maia']),
    ('Guard', 'Soft keeps human mistakes but blocks the worst; strict plays nearer to the engines; off plays Maia as it is.', c('king'), ['gate/veto']),
])
K.page('mode/teach', 'Teach', 'mode', 'modes', 'Full strength, plus every voice explains its choice.', [
    ('Explanations', 'Each search engine reports its move, score, win/draw/loss and main line; Maia reports how people tend to play the position.', c('king'), ['voice/stockfish', 'voice/leela', 'voice/maia']),
    ('On Lichess', 'In teach mode the Lichess bot posts the King\'s first reason to the game chat, trimmed to 140 characters.', c('lichess', 'policy'), ['bot/lichess']),
])
K.page('voice/stockfish', 'Stockfish 19 (referee)', 'voice', 'voices', 'The strongest search engine and the referee; it has its own brain, imported from the AI Hub.', [
    ('Strength', 'Stockfish 19 is first on the CCRL 40/15 list at 3650, ahead of Reckless, PlentyChess, pawnocchio and Torch.', c('ccrl')),
    ('TCEC', 'Stockfish beat Reckless 59–41 in the TCEC Season 29 Superfinal.', c('tcec')),
    ('Role here', 'Stockfish is the referee: it rates every candidate and its forced mates are played. The same neuron in the Stockfish brain tells the story from its side.', c('king', 'council'), ['gate/veto', 'gate/mate']),
    ('Its brain', 'The Stockfish brain was published on the MindBlown AI Hub on 4 November 2026 as "Stockfish chess engine (unofficial)" and is imported here unchanged apart from page ids.', c('hubsf')),
    ('In the browser', 'The browser uses Stockfish 19 lite (single-threaded WebAssembly, about 1.8 MB) from stockfish.js, which needs no cross-origin isolation.', c('sfjs', 'browser'), ['bot/browser']),
])
K.page('voice/leela', 'Leela Chess Zero', 'voice', 'voices', 'A neural-network search engine; a second strong opinion in the vote.', [
    ('Role here', 'Leela votes with its best move and MultiPV alternatives, weighted by rating, in the desktop and Lichess versions.', c('council', 'king'), ['gate/vote']),
    ('More', 'See the Leela brain for how it works.', c('lc0wiki')),
], see=[])
K.page('voice/maia', 'Maia', 'voice', 'voices', 'The human voice: the move a person at 1100, 1500 or 1900 would likely play.', [
    ('Role here', 'Maia decides human mode and is a 0.15-weight tiebreak at full strength. It runs one node (go nodes 1) at policy temperature 1, so the probabilities are the network\'s own.', c('council', 'maiarepo'), ['mode/human', 'gate/vote']),
    ('In the browser', 'The browser runs Maia as ONNX with its own JavaScript encoder; on 10 test positions per level it matches Lc0 to within 0.06 percentage points.', c('maiajs', 'validate'), ['bot/browser']),
])
K.page('bot/desktop', 'Desktop engine', 'bot', 'bots', 'Kingfischer as a UCI engine for any chess GUI.', [
    ('UCI', 'Kingfischer speaks UCI, so any GUI that loads engines can load it; its options are Mode, HumanElo, Guard, Explain, Seed and Config, and it explains its moves as info strings.', c('desktop', 'uci'), ['king']),
])
K.page('bot/lichess', 'Lichess bot', 'bot', 'bots', 'Kingfischer on Lichess through the Bot API.', [
    ('Streams', 'The bot reads the event stream for challenges and game starts, then each game stream, and posts its moves to the Bot API.', c('lichess', 'botapi')),
    ('Challenges', 'It accepts standard games of blitz or slower (at least one minute) one at a time and declines the rest with a Lichess reason such as tooFast or variant.', c('policy')),
    ('Bot rules', 'Lichess bots can play casual and rated games and accept challenges, but cannot join tournaments or simuls, use lobby seeks or appear on leaderboards.', c('botblog')),
])
K.page('bot/browser', 'Browser player', 'bot', 'bots', 'Play Kingfischer in a browser tab, no install.', [
    ('Council', 'Stockfish 19 lite and Maia 1100/1500/1900 run in the tab; the Lichess tablebase answers endgames; the King Brain is the same file the other bots use.', c('browser', 'king'), ['voice/stockfish', 'voice/maia']),
])

# ---------------------------------------------------------------- Leela
L = brain('leela', 'Leela Chess Zero · a neural network guided by tree search', [
    {'id': 'self', 'name': 'Leela', 'color': '#7bbcf4'},
    {'id': 'how', 'name': 'How it works', 'color': '#93c5fd'},
    {'id': 'history', 'name': 'History', 'color': '#d8b4fe'},
    {'id': 'here', 'name': 'In Kingfischer', 'color': '#ff8a3d'},
], 'leela')
L.page('leela', 'Leela Chess Zero', 'hub', 'self', 'An open-source engine that evaluates positions with a neural network and searches with MCTS.', [
    ('What it is', 'Lc0 uses a neural network to evaluate positions and runs a Monte Carlo tree search (mainly MCTS/PUCT).', c('lcz'), ['how/heads', 'how/search']),
    ('Licence', 'Lc0 is written in C++ and licensed GPL-3.0-or-later.', c('lc0wiki')),
], see=['how/heads', 'how/search', 'history/selfplay', 'here/leela'], ring=0)
L.page('how/heads', 'Network heads', 'concept', 'how', 'Policy, value and moves-left: what the network says about a position.', [
    ('Three outputs', 'The network gives a position value (win/draw/loss probability), a policy (probabilities over legal moves) and a moves-left estimate.', c('lcz')),
    ('WDL', 'Engines with a WDL head report it in UCI when UCI_ShowWDL is on, as win, draw and loss in permille that add up to 1000.', c('wdl'), ['here/leela']),
    ('Transformers', 'Leela first used residual networks and switched to a transformer architecture in 2022.', c('lc0wiki')),
])
L.page('how/search', 'Search', 'concept', 'how', 'MCTS/PUCT, plus one-node modes for networks like Maia.', [
    ('Searches', 'Lc0 ships several searches: classic MCTS, a DAG variant, and policyhead, which evaluates one position and returns the highest-policy move (useful for Maia networks).', c('lcz')),
    ('Input planes', "Lc0's classical input is 112 planes: 8 history positions of 13 planes each, then castling, side-to-move, fifty-move and constant planes.", c('encoder'), ['here/encoder']),
])
L.page('history/selfplay', 'Self-play', 'fact', 'history', 'Trained from billions of games against itself.', [
    ('Games', 'As of June 2025 Leela had played over 2.5 billion games against itself, around 1 million a day.', c('lc0wiki')),
    ('TCEC', 'In TCEC Season 17 (January–April 2020) Leela regained the championship, beating Stockfish 52.5–47.5.', c('lc0wiki')),
    ('Chessformer', 'The Chessformer architecture added over 100 Elo to Leela (ICLR 2026).', c('chessformer'), ['history/nets']),
])
L.page('history/nets', 'Networks', 'fact', 'history', 'Which nets to run.', [
    ('Best nets', 'LCZero lists recommended networks by hardware; Kingfischer starts with the small distilled t1-256x10 net for CPU use.', c('bestnets', 'council'), ['here/leela']),
])
L.page('open/leela-data', 'Training on a rival\'s data', 'fact', 'history', 'Two open-source engines sharing data across a rivalry.', [
    ('Leela data under ODbL', 'Stockfish\'s neural networks are trained on data from the Leela Chess Zero project, released under the Open Database License.', c('sf19blog', 'lcz')),
    ('100 billion positions', 'With Stockfish 18 the team moved to an automated, reproducible training workflow using over 100 billion positions of Leela evaluation data; Stockfish 19\'s positions were rescored with a strong Leela network.', c('sf18blog', 'sf19blog'), ['history/selfplay']),
])
L.page('results/tcec', 'TCEC', 'fact', 'history', 'The Top Chess Engine Championship, a long-running engine competition.', [
    ('Two superfinals', 'Leela beat Stockfish in the TCEC superfinals of Seasons 15 and 17; Stockfish has won every TCEC season since Season 18, according to Wikipedia.', c('wikisf')),
    ('Season 29', 'Stockfish beat Reckless 59–41 in the TCEC Season 29 Superfinal; Leela was not in that final.', c('tcec'), ['here/leela']),
])
L.page('here/leela', 'Leela in the council', 'role', 'here', 'A rated vote in the desktop and Lichess versions.', [
    ('Vote', 'Leela votes with its best move and MultiPV alternatives; its rating sets its weight on the Elo scale.', c('king', 'council')),
])
L.page('here/encoder', 'Encoder in JavaScript', 'role', 'here', "Kingfischer's browser port of Lc0's input encoding, used for Maia.", [
    ('Port', 'bot/browser/maia.js rebuilds the 112 classical planes and reads the 1858-slot policy; castling is king-takes-rook and knight promotions use the plain move slot.', c('maiajs', 'encoder', 'policyidx')),
    ('Checked', 'tools/validate-maia.mjs compares it with Lc0 itself on 10 positions covering mirroring, castling, repetition, en passant, promotions and the fifty-move counter.', c('validate')),
])

# ---------------------------------------------------------------- Maia
M = brain('maia', 'Maia · engines that play like people', [
    {'id': 'self', 'name': 'Maia', 'color': '#7bf48a'},
    {'id': 'models', 'name': 'Models', 'color': '#86efac'},
    {'id': 'next', 'name': 'Successors', 'color': '#fcd34d'},
    {'id': 'here', 'name': 'In Kingfischer', 'color': '#ff8a3d'},
], 'maia')
M.page('maia', 'Maia', 'hub', 'self', 'Human-like chess engines, one per rating level from 1100 to 1900.', [
    ('What it is', 'Maia is a collection of chess engines that play like humans, from rating 1100 to 1900, saved as Leela Chess networks.', c('maiarepo'), ['models/nine']),
    ('Licence', 'The Maia software is available under the GPL.', c('maiarepo')),
], see=['models/nine', 'models/accuracy', 'next/maia2', 'next/maia3', 'here/maia'], ring=0)
M.page('models/nine', 'Nine models', 'fact', 'models', 'One network per 100-point rating bin.', [
    ('Training', 'Each of the 9 models was trained on its own set of 12 million Lichess games from one rating bin, 1100-1199 to 1900-1999.', c('maiablog')),
    ('How to run', 'Unlike most engines Maia should not search: a nodes limit of 1 (go nodes 1 in UCI) is what its authors use.', c('maiarepo'), ['here/maia']),
    ('Stronger than its label', 'The models play above the rating they were trained on, because they make the average move of players at that level.', c('maiarepo')),
])
M.page('models/accuracy', 'Move matching', 'fact', 'models', 'How often Maia predicts the move a person actually played.', [
    ('Over half', "Maia's highest accuracy is over 52%: Maia 1900 predicts the exact move a 1900-rated human played more than half the time.", c('maiablog')),
])
M.page('next/maia2', 'Maia-2', 'fact', 'next', 'One model across skill levels.', [
    ('Unified', 'Maia-2 is a unified human-like model across skill levels (NeurIPS 2024), released under the MIT licence.', c('maia2')),
])
M.page('next/maia3', 'Maia-3 (Chessformer)', 'fact', 'next', 'The newest human-move predictor.', [
    ('Accuracy', 'Maia-3, built on Chessformer, reaches 57.1% move-matching accuracy with fewer than a quarter of the parameters of the previous best.', c('chessformer')),
])
M.page('compare/human-moves', 'Matching human moves', 'fact', 'models', 'How often engines pick the move a person actually played, and why weakened engines do not play like people.', [
    ('Weak Stockfish is not a weak human', 'Depth-limited versions of Stockfish match human moves only about 35–40 % of the time, and each one matches 1900-rated players better than 1100-rated ones: it plays regular Stockfish chess with noise, not lower-rated chess.', c('maiablog'), ['models/accuracy']),
    ('Leela too', 'The best Leela versions match human moves more often than Stockfish, but every version gets steadily better or worse as the human rating rises, so none captures a particular skill level.', c('maiablog')),
    ('Why Maia', 'Maia is trained on human games at each rating, so its match rate peaks at the rating it was trained on; that is why it, and not a weakened Stockfish, is the human voice of the council.', c('maiablog', 'council'), ['here/maia']),
])
M.page('here/maia', 'Maia in the council', 'role', 'here', 'The human voice of Kingfischer.', [
    ('Levels', 'Kingfischer runs Maia 1100, 1500 and 1900 and asks the one nearest the requested level.', c('council')),
    ('Temperature', 'The council reads Maia at policy temperature 1; Lc0\'s default of 1.36 is tuned for search and would flatten the human probabilities.', c('council')),
    ('In the browser', 'Maia runs in the tab through onnxruntime-web, from networks converted with lc0 leela2onnx; the encoder matches Lc0 to within 0.06 percentage points on the test positions.', c('maiajs', 'validate')),
])

# ---------------------------------------------------------------- Stockfish (imported from the AI Hub, plus its seat here)
F = brain('stockfish', 'Stockfish (unofficial) · how it plays, how it is tested, and its seat as the referee', [
    {'id': 'self', 'name': 'Stockfish, unofficial', 'color': '#fde68a'},
    {'id': 'engine', 'name': 'How it plays', 'color': '#60a5fa'},
    {'id': 'test', 'name': 'Testing', 'color': '#a78bfa'},
    {'id': 'results', 'name': 'History and results', 'color': '#f472b6'},
    {'id': 'evid', 'name': 'Evidence and doubt', 'color': '#fb923c'},
    {'id': 'open', 'name': 'Free software', 'color': '#34d399'},
    {'id': 'here', 'name': 'In Kingfischer', 'color': '#ff8a3d'},
], 'stockfish')
# The published file is kept verbatim in brains/import/. Only ids in the Hub's namespace are renamed: its hub page becomes
# `stockfish` (like `king`, `leela`, `maia`) and the Hub's two shared concepts become sub-neurons of the hub, next to the
# label page, since here they describe this brain. The content is otherwise as published; the hub's ring and see-also list
# are set here, like the other hubs.
load_published(F, os.path.join(HERE, 'import', 'stockfish-public.json'),
               ids={'shared/brain/stockfish-public': 'stockfish', 'shared/concept/source': 'self/source', 'shared/concept/ai-hub': 'self/hub'},
               types={'brain': 'hub'}, relobe={'self/source': 'self', 'self/hub': 'self'}, reparent={'self/source': 'stockfish', 'self/hub': 'stockfish'}, ring={'stockfish': 0})
F.see['stockfish'].extend(['engine/search', 'engine/nnue', 'test/fishtest', 'results/strength', 'voice/stockfish'])
F.page('self/imported', 'Imported into Kingfischer', 'rule', 'self', 'Where this copy came from and what changed on the way.', [
    ('From the AI Hub', 'This brain was published on the MindBlown AI Hub on 4 November 2026 as "Stockfish chess engine (unofficial)", 23 neurons and 49 synapses, and imported here from that published file.', c('hubsf'), ['self/hub']),
    ('What changed', 'Only page ids in the Hub\'s namespace were renamed, and the pages under "In Kingfischer" were added; every fact and citation is as published.', c('hubsf'), ['voice/stockfish']),
], parent='stockfish')
F.page('voice/stockfish', 'Stockfish 19 (referee)', 'voice', 'here', 'The strongest search engine and the referee; it has its own brain, imported from the AI Hub.', [
    ('Referee', 'In the council Stockfish rates every candidate move on one scale, blocks any that give away too much, and a forced mate it finds is always played. The same neuron in the King Brain gives the rules.', c('king', 'council'), ['engine/search']),
    ('In the browser', 'The browser player runs Stockfish 19 lite, a single-threaded WebAssembly build of about 1.8 MB from stockfish.js that needs no cross-origin isolation.', c('sfjs', 'browser'), ['open/browser']),
    ('Tablebases', 'With 7 or fewer pieces Kingfischer asks the Lichess tablebase itself before any engine, so Stockfish\'s own Syzygy probing is not needed for that.', c('council'), ['engine/tablebases']),
    ('Weight', 'Its vote is weighted by its CCRL rating of 3650, the highest in the council.', c('ccrl', 'king'), ['results/strength']),
])
F.page('compare/human-moves', 'Matching human moves', 'fact', 'here', 'How often engines pick the move a person actually played, and why weakened engines do not play like people.', [
    ('35–40 %', 'Depth-limited versions of Stockfish match human moves only about 35–40 % of the time, and even depth-1 Stockfish matches 1900-rated players better than 1100-rated ones.', c('maiablog'), ['engine/uci']),
    ('Not monotonic', 'Limiting the depth from 15 to 7 lowers the match rate, but limiting it further towards depth 1 raises it again: very weak Stockfish predicts people better than moderate-strength Stockfish.', c('maiablog'), ['engine/search']),
    ('So Maia', 'That is why Kingfischer\'s human mode asks Maia, trained on human games at each rating, and uses Stockfish only to veto blunders.', c('maiablog', 'council'), ['voice/stockfish']),
])
# the two pages Leela shares with this brain sit next to Stockfish's own page on Leela
F.see['open/leela-data'].append('results/leela')
F.see['results/tcec'].append('results/leela')

BUILT = {'king': K, 'leela': L, 'maia': M, 'stockfish': F}
if set(BUILT) != {b['id'] for b in BRAINS}: raise KeyError(f'brains defined here {sorted(BUILT)} do not match mb_shared.BRAINS')
datas = {b['id']: BUILT[b['id']].write() for b in BRAINS}
write_network(datas)

# ---------------------------------------------------------------- pages
TEMPLATE = open(os.path.join(HERE, 'page.template.html'), encoding='utf-8').read()


def fill(tpl, **vals): return re.sub(r'\{\{(\w+)\}\}', lambda m: vals[m.group(1)], tpl)


def nav(active):
    return '<nav class="brains" aria-label="Brains">' + ''.join(
        f'<a href="{b["href"]}"' + (' class="on"' if b["id"] == active else '') + f'>{html.escape(b["short"])}</a>' for b in BRAINS) + '<a href="../index.html">Play</a></nav>'


for b in BRAINS:
    d = datas[b['id']]
    out = fill(TEMPLATE, HEAD_TITLE=html.escape(f'Kingfischer: {b["title"]}'), DESC=html.escape(b['blurb']), TITLE=html.escape(f'Kingfischer: {b["title"]}'),
               SUB=html.escape(d['subtitle']), NAV=nav(b['id']), DATA=b['data'], OPTIONS=json.dumps({'labels': True}))
    with open(os.path.join(HERE, b['href']), 'w', encoding='utf-8') as f: f.write(out)
print('pages:', ', '.join(b['href'] for b in BRAINS))
