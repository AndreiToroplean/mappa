# Fifty

A geography drill. You're named a region, you click it on the map.

Two geographies — the 50 US states and the 101 French départements — and two
modes: Trial, where three misses ends the run, and Practice, where nothing does
and clues are there if you ask. One self-contained HTML file: no network calls,
no dependencies at runtime, no ads. It works offline.

**[Play](https://andreitoroplean.github.io/fifty/)** · [beta](https://andreitoroplean.github.io/fifty/beta/)

## How it was made

Entirely vibe coded, with Claude Opus 5. I have not read the code.

Two reasons. One was wanting a geography drill I'd enjoy on my phone. I didn't
survey the stores properly, so this is an impression rather than a finding: what I
came across was ad-supported, which is a normal way to fund a game but not what I
wanted for myself.

The other was to get first-hand experience of vibe coding and see whether there
are places for it in my own workflow. I'm an experienced developer and not looking
to change how I work; I'd rather find out where it's a match for a task than
guess.

## Build

```
python3 src/make.py     # writes dist/fifty.html
python3 check.py        # regression harness, no browser needed
```

`ARCHITECTURE.md` is how it works. `DESIGN.md` is why — including the things that
were tried and thrown away.

## Licence

None yet, so the code is under default copyright — readable and forkable on
GitHub, not reusable elsewhere. The map and clue data are third-party and keep
their own terms; see `ATTRIBUTION.md`.
