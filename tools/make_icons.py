"""Generate the Neo AI extension icons (rounded gradient square + chat bubble + sparkle)."""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), "..", "icons")
os.makedirs(OUT, exist_ok=True)

TOP = (99, 102, 241)      # indigo
BOTTOM = (168, 85, 247)   # violet
SIZES = [16, 32, 48, 96, 128, 512]


def make_base(size=512):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Vertical gradient.
    for y in range(size):
        t = y / max(size - 1, 1)
        r = int(TOP[0] + (BOTTOM[0] - TOP[0]) * t)
        g = int(TOP[1] + (BOTTOM[1] - TOP[1]) * t)
        b = int(TOP[2] + (BOTTOM[2] - TOP[2]) * t)
        draw.line([(0, y), (size, y)], fill=(r, g, b, 255))

    # Rounded-rect alpha mask.
    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    radius = int(size * 0.22)
    md.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    img.putalpha(mask)

    # Chat bubble (white).
    draw = ImageDraw.Draw(img)
    b_l = int(size * 0.30)   # bubble left
    b_r = int(size * 0.70)   # bubble right
    b_t = int(size * 0.26)   # bubble top
    b_b = int(size * 0.62)   # bubble bottom
    b_radius = int(size * 0.10)
    draw.rounded_rectangle([b_l, b_t, b_r, b_b], radius=b_radius, fill=(255, 255, 255, 255))
    # Tail.
    tail = [
        (int(size * 0.40), b_b),
        (int(size * 0.40), int(size * 0.76)),
        (int(size * 0.55), b_b),
    ]
    draw.polygon(tail, fill=(255, 255, 255, 255))

    # Four-point sparkle inside the bubble (gradient colour).
    cx = int(size * 0.50)
    cy = int(size * 0.44)
    r = int(size * 0.12)
    inner = int(r * 0.22)
    pts = [
        (cx, cy - r),
        (cx + inner, cy - inner),
        (cx + r, cy),
        (cx + inner, cy + inner),
        (cx, cy + r),
        (cx - inner, cy + inner),
        (cx - r, cy),
        (cx - inner, cy - inner),
    ]
    # Approximate gradient midpoint colour.
    mid = tuple(int((TOP[i] + BOTTOM[i]) / 2) for i in range(3))
    draw.polygon(pts, fill=mid + (255,))

    return img


base = make_base(512)
for s in SIZES:
    if s == 512:
        icon = base
    else:
        icon = base.resize((s, s), Image.LANCZOS)
    path = os.path.join(OUT, "icon-%d.png" % s)
    icon.save(path, "PNG")
    print("wrote", path)

print("done")
