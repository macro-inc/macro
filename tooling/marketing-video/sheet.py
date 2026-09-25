"""Contact sheet: python3 sheet.py <dir> <out.png> [cols] [thumb]"""
import sys, glob, os
from PIL import Image, ImageDraw
d, out = sys.argv[1], sys.argv[2]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 7
th = int(sys.argv[4]) if len(sys.argv) > 4 else 300
files = sorted(glob.glob(os.path.join(d, "*.png")))
rows = (len(files) + cols - 1) // cols
sheet = Image.new("RGB", (cols * th, rows * (th + 22)), "white")
dr = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    im = Image.open(f).convert("RGB").resize((th, th), Image.LANCZOS)
    x, y = (i % cols) * th, (i // cols) * (th + 22)
    sheet.paste(im, (x, y + 22))
    dr.text((x + 6, y + 4), os.path.basename(f)[:-4], fill="black")
sheet.save(out)
print(out, sheet.size)
