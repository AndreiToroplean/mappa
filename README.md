# Fifty

A geography drill. You're named a region, you click it on the map.

Two geographies — the 50 US states and the 101 French départements — and two
modes: Trial, where three misses ends the run, and Practice, where nothing does
and clues are there if you ask. One self-contained HTML file: no network calls,
no dependencies at runtime, no ads. It works offline.

**[Play](https://USER.github.io/fifty/)** · [beta](https://USER.github.io/fifty/beta/)

## How it was made

Entirely vibe coded, with Claude Opus 5. I have not read the code.

I wanted a game I would actually want to play. Finding one on mobile turned out
to be harder than having one built — what exists is buried in ads.

And I wanted a feel for vibe coding. As an experienced developer I don't think
it's the way forward for me, but I'd rather know where it fits my process than
guess.

## Build

```
python3 src/make.py     # writes dist/fifty.html
python3 check.py        # regression harness, no browser needed
```

`ARCHITECTURE.md` is how it works. `DESIGN.md` is why — including the things that
were tried and thrown away.

## Licence

Code is MIT. The map and clue data keep their own licences and require
attribution; see `data/`.
