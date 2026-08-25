# Mappa

The World from Memory. You're named a place, you tap it on the map.

Three maps so far — the 50 US states, the 101 French départements and the 44 countries of Europe — and two choices about how you play. **Mode** is Test, which can end early and offers no hints, or Practice, which cannot be failed and has clues if you ask. **Scoring** is Right or Wrong, where nearly right counts for nothing and you keep tapping, or How Close, where you get one tap per place and are scored on how near you landed. One self-contained HTML file: no network calls, no dependencies at runtime, no ads. Scores stay in your browser, and you can export everything to a file and load it back on another device.

The name is from *mappa mundi*. It was *Fifty* to begin with, back when the only map was the fifty US states.

A link can carry the setup, so you can hand someone the exact game rather than the menu: `?map=fr`, `?map=eu`, `?mode=practice`, `?scoring=drift`, `?theme=light`, in any combination. `mode=trial` is the one the buttons call Test. **Copy Link**, under the dots on the menu, writes one for whatever is set up — everything but the theme, which is yours rather than the game's.

**[Play](https://andreitoroplean.github.io/mappa/)** · [Play beta](https://andreitoroplean.github.io/mappa/beta/)

## How it was made

Entirely vibe coded, with Claude Opus 5. I have not read the code.

Two reasons. One was wanting a geography drill I'd enjoy on my phone. I thought it might be easier to create one using AI than finding an existing one (that might additionally have tons of ads). The other was to get first-hand experience of vibe coding and see whether there are places for it in my own workflow.

## Build

```
python3 src/make.py     # writes dist/mappa.html
python3 check.py        # regression harness, no browser needed
```

`ARCHITECTURE.md` is how it works. `DESIGN.md` is how to work on it, including the things that were tried and thrown away.

## Licence

None yet, so the code is under default copyright — readable and forkable on GitHub, not reusable elsewhere. The map and clue data are third-party and keep their own terms; see `ATTRIBUTION.md`.
