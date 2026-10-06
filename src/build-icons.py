#!/usr/bin/env python3
"""Draw the home-screen icons into data/icons, from the compass on the Start button.

A phone that installs the game wants a picture for its home screen, and that
picture has to be a PNG: Android and iOS both refuse an SVG icon. So the
drawing in textures.icon() is rasterised here, once, and the result is committed
like the fonts and the map data. make.py only copies the files. The browser tab
needs no PNG, and gets the same drawing inlined as SVG by make.py.

One drawing serves every size and both purposes. Android's "maskable" icons
are cropped to a shape of the launcher's choosing — a circle, a squircle, a
teardrop — and only the middle 80% is promised to survive, so the rose is kept
inside that and the ground runs to the edges. The same full-bleed square is
what iOS wants for its touch icon, since iOS rounds the corners itself.

Needs a Chromium to rasterise with, and specifically the old headless shell:
the new headless mode treats --window-size as the window rather than the page,
so a 192px icon comes out blank. Playwright's shell is found by default:

    python3 src/build-icons.py
    CHROME=/path/to/chrome python3 src/build-icons.py
"""
import os, pathlib, subprocess, sys, tempfile

import textures

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'icons'
CHROME = os.environ.get('CHROME', '/opt/pw-browsers/chromium_headless_shell-1194'
                                   '/chrome-linux/headless_shell')

# file, pixel size. 192 and 512 are the two sizes Chrome asks a manifest for;
# 180 is the iPhone's own touch-icon size.
SIZES = [('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)]

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        page = pathlib.Path(tmp) / 'icon.html'
        page.write_text(
            '<!doctype html><html><body style="margin:0">'
            f'<div style="width:100vw;height:100vh">{textures.icon()}</div>'
            '<style>svg{display:block;width:100vw;height:100vh}</style>'
            '</body></html>')
        for name, size in SIZES:
            target = OUT / name
            subprocess.run(
                [CHROME, '--headless', '--no-sandbox', '--hide-scrollbars',
                 '--force-device-scale-factor=1', f'--window-size={size},{size}',
                 f'--screenshot={target}', page.as_uri()],
                check=True, capture_output=True, timeout=120)
            print(f'  {name}: {size}px, {target.stat().st_size:,} bytes')


if __name__ == '__main__':
    sys.exit(main())
