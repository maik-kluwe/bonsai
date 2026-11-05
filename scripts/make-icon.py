"""Draws media/icon.png from the same shapes as media/icon.svg: a bonsai whose branches are a commit graph.

Run with Python and Pillow: python scripts/make-icon.py
Drawn at four times the size and scaled down, which smooths the edges.
If you change the shapes, change them in media/icon.svg too.
"""
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 256
SCALE = 4

TRUNK_FROM, TRUNK_TO = (47, 111, 228), (34, 184, 216)
TRUNK_Y_BOTTOM, TRUNK_Y_TOP = 196, 62
POT_TOP, POT_BOTTOM = (47, 111, 228), (31, 79, 184)
POT_Y_TOP, POT_Y_BOTTOM = 196, 232
RIM = (58, 134, 240)
GREEN = (61, 220, 132)
CYAN = (34, 193, 220)
WHITE = (255, 255, 255)

# Each stroke is a width and a chain of cubic Beziers: (start, then (control, control, end) per segment)
STROKES = [
    (16, (128, 196), [((112, 176), (148, 156), (132, 132)), ((120, 112), (116, 92), (124, 62))]),
    (12, (131, 150), [((108, 142), (88, 128), (66, 118))]),
    (12, (128, 112), [((150, 112), (172, 104), (192, 96))]),
]
# Commits: centre, radius, colour, radius of the white core
COMMITS = [((66, 118), 20, GREEN, 8), ((192, 96), 20, CYAN, 8), ((124, 58), 24, GREEN, 10)]


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def cubic(p0, p1, p2, p3, steps):
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        yield (
            u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
            u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1],
        )


def quad(p0, p1, p2, steps):
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        yield (u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1])


def circle(draw, centre, radius, fill):
    x, y = centre[0] * SCALE, centre[1] * SCALE
    r = radius * SCALE
    draw.ellipse([x - r, y - r, x + r, y + r], fill=fill)


def stroke(draw, width, start, segments):
    """A line of round dots: draw.line leaves gaps at the joints of a curve, and the colour follows y."""
    p0 = start
    for c1, c2, end in segments:
        for x, y in cubic(p0, c1, c2, end, 400):
            t = (TRUNK_Y_BOTTOM - y) / (TRUNK_Y_BOTTOM - TRUNK_Y_TOP)
            circle(draw, (x, y), width / 2, mix(TRUNK_FROM, TRUNK_TO, t) + (255,))
        p0 = end


def pot_outline():
    """M52 196 H204 L192 226 Q190 232 184 232 H72 Q66 232 64 226 Z"""
    points = [(52, 196), (204, 196), (192, 226)]
    points += list(quad((192, 226), (190, 232), (184, 232), 20))
    points += [(72, 232)]
    points += list(quad((72, 232), (66, 232), (64, 226), 20))
    return [(x * SCALE, y * SCALE) for x, y in points]


def main():
    full = SIZE * SCALE
    image = Image.new('RGBA', (full, full), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    for width, start, segments in STROKES:
        stroke(draw, width, start, segments)

    for centre, radius, colour, core in COMMITS:
        circle(draw, centre, radius, colour + (255,))
    for centre, _, colour, core in COMMITS:
        # 90 % white over the commit colour, opaque, because ImageDraw replaces pixels instead of blending
        circle(draw, centre, core, mix(colour, WHITE, 0.9) + (255,))

    mask = Image.new('L', (full, full), 0)
    ImageDraw.Draw(mask).polygon(pot_outline(), fill=255)
    gradient = Image.new('RGBA', (full, full), (0, 0, 0, 0))
    gradient_draw = ImageDraw.Draw(gradient)
    for row in range(POT_Y_TOP * SCALE, POT_Y_BOTTOM * SCALE + 1):
        t = (row / SCALE - POT_Y_TOP) / (POT_Y_BOTTOM - POT_Y_TOP)
        gradient_draw.line([(0, row), (full, row)], fill=mix(POT_TOP, POT_BOTTOM, t) + (255,))
    image.paste(gradient, (0, 0), mask)

    draw.rounded_rectangle([44 * SCALE, 190 * SCALE, 212 * SCALE, 202 * SCALE], radius=6 * SCALE, fill=RIM + (255,))

    target = Path(__file__).resolve().parent.parent / 'media' / 'icon.png'
    image.resize((SIZE, SIZE), Image.LANCZOS).save(target, optimize=True)


if __name__ == '__main__':
    main()
