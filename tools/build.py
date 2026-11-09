#!/usr/bin/env python3
"""Inline src/ (CSS, scripts, samples) into one self-contained index.html.

Usage: python tools/build.py            (from the project folder)
The result opens straight from disk (double-click) and is what GitHub Pages serves.
"""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src')
OUT = os.path.join(ROOT, 'index.html')


def read(rel):
    with open(os.path.join(SRC, rel), encoding='utf-8') as f:
        return f.read()


def main():
    html = read('index.html')

    def css(m):
        return '<style>\n' + read(m.group(1)) + '\n</style>'

    def js(m):
        code = read(m.group(1)).replace('</script', '<\\/script')
        return '<script>\n' + code + '\n</script>'

    html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', css, html)
    html = re.sub(r'<script src="([^"]+)"></script>', js, html)
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write(html)
    print('wrote', OUT, round(os.path.getsize(OUT) / 1024), 'KB')


if __name__ == '__main__':
    sys.exit(main())
