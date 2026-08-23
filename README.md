# Mappa

The world, from memory. You're named a place, you tap it on the map.

Two maps so far — the 50 US states and the 101 French départements — and two choices about how you play. **Mode** is Test, which can end early and offers no hints, or Practice, which cannot be failed and has clues if you ask. **Scoring** is Right or wrong, where nearly right counts for nothing and you keep tapping, or How close, where you get one tap per place and are scored on how near you landed. One self-contained HTML file: no network calls, no dependencies at runtime, no ads. Scores stay in your browser, and you can export everything to a file and load it back on another device.

The name is from *mappa mundi*. The URL still says `fifty` — that was the original name, back when the only map was the fifty US states.

**[Play](https://andreitoroplean.github.io/fifty/)** · [Play beta](https://andreitoroplean.github.io/fifty/beta/)

## How it was made

Entirely vibe coded, with Claude Opus 5. I have not read the code.

Two reasons. One was wanting a geography drill I'd enjoy on my phone. I thought it might be easier to create one using AI than finding an existing one (that might additionally have tons of ads). The other was to get first-hand experience of vibe coding and see whether there are places for it in my own workflow.

## Build

```
python3 src/make.py     # writes dist/mappa.html
python3 check.py        # regression harness, no browser needed
```

`ARCHITECTURE.md` is how it works. `DESIGN.md` is why — including the things that were tried and thrown away.

## Licence

None yet, so the code is under default copyright — readable and forkable on GitHub, not reusable elsewhere. The map and clue data are third-party and keep their own terms; see `ATTRIBUTION.md`.
