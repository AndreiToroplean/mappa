# Fifty

A geography drill. You're named a region, you click it on the map.

Two geographies — the 50 US states and the 101 French départements — and two modes: Trial, where a run can end early, and Practice, where nothing does and clues are there if you ask. Wrong taps are either counted, or measured — scored by how far off you were rather than whether you were right. One self-contained HTML file: no network calls, no dependencies at runtime, no ads.

**[Play](https://andreitoroplean.github.io/fifty/)** · [Play beta](https://andreitoroplean.github.io/fifty/beta/)

## How it was made

Entirely vibe coded, with Claude Opus 5. I have not read the code.

Two reasons. One was wanting a geography drill I'd enjoy on my phone. I thought it might be easier to create one using AI than finding an existing one (that might additionally have tons of ads). The other was to get first-hand experience of vibe coding and see whether there are places for it in my own workflow.

## Build

```
python3 src/make.py     # writes dist/fifty.html
python3 check.py        # regression harness, no browser needed
```

`ARCHITECTURE.md` is how it works. `DESIGN.md` is why — including the things that were tried and thrown away.

## Licence

None yet, so the code is under default copyright — readable and forkable on GitHub, not reusable elsewhere. The map and clue data are third-party and keep their own terms; see `ATTRIBUTION.md`.
