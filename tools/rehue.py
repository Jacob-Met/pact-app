#!/usr/bin/env python3
"""Move one colour family to another across stylesheets, keeping every shade's lightness.

  rehue.py <from-hue-lo> <from-hue-hi> <to-hue> <css-file>...      (hues are 0-1)

Mid-tones take the new hue at full strength; pale tints and near-blacks keep only a trace of it, so
backgrounds and body text read as warm or cool neutrals instead of coloured blocks."""
import colorsys, re, sys
lo, hi, to = float(sys.argv[1]), float(sys.argv[2]), float(sys.argv[3])
def swap(m):
    h = m.group(0)[1:]; a = ''
    if len(h) in (3, 4): h = ''.join(c * 2 for c in h)
    if len(h) == 8: h, a = h[:6], h[6:]
    if len(h) != 6: return m.group(0)
    r, g, b = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    H, L, S = colorsys.rgb_to_hls(r, g, b)
    if not (lo <= H <= hi) or S < 0.12: return m.group(0)
    if L > 0.86: S = min(S, 0.45) * 0.75          # pale tint
    elif L < 0.2: S = min(S, 0.25)                # near-black text
    elif L > 0.7: S = min(S, 0.5)
    else: S = min(0.72, S * 1.05)
    r, g, b = colorsys.hls_to_rgb(to, L if not 0.3 < L < 0.62 else L * 0.86, S)
    return '#' + ''.join('%02x' % round(c * 255) for c in (r, g, b)) + a
for f in sys.argv[4:]:
    s = open(f).read(); t = re.sub(r'#[0-9a-fA-F]{3,8}\b', swap, s)
    if t != s: open(f, 'w').write(t); print('rehued', f)
