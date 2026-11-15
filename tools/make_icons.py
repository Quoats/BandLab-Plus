"""Generates icons/icon{16,32,48,128}.png: rainbow waveform bars on a dark rounded square."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "icons"
S = 512  # draw big, downscale for clean edges

BARS = [  # (color, height as fraction of icon)
    ("#ff4fa3", 0.34),
    ("#ffab00", 0.58),
    ("#39ff14", 0.80),
    ("#00b0ff", 0.58),
    ("#a066ff", 0.34),
]


def draw() -> Image.Image:
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * 0.22), fill="#18181b")
    n = len(BARS)
    bar_w = S * 0.11
    gap = S * 0.055
    x = (S - (n * bar_w + (n - 1) * gap)) / 2
    for color, h in BARS:
        top = (S - S * h) / 2
        d.rounded_rectangle((x, top, x + bar_w, top + S * h), radius=bar_w / 2, fill=color)
        x += bar_w + gap
    return img


def main() -> None:
    OUT.mkdir(exist_ok=True)
    big = draw()
    for size in (16, 32, 48, 128):
        big.resize((size, size), Image.LANCZOS).save(OUT / f"icon{size}.png")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
