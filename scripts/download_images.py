"""
下載鞋款商品照片到 images/shoes/（demo 用）

用法（在專案資料夾執行）：
    python scripts/download_images.py            下載全部
    python scripts/download_images.py dd-wilde-m 只下載指定鞋款

照片來源是各品牌官網或零售商網站（Shopify 商店）的公開商品資料。
每個鞋款設定：網站、商品代號（handle）、要用第幾張圖（index，從 0 開始）。
想換照片時，改這裡的設定再執行一次即可；下載後會自動更新 models.json 的 image 欄位。
注意：這些照片的著作權屬於原網站，僅供課堂展示使用。
"""

import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "images" / "shoes"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36"

# 鞋款 id: (網站, 商品 handle, 第幾張圖[, 去背容許值：漸層背景調高；-1 = 不去背只調亮，白鞋用])
SOURCES = {
    "dd-wilde-m": ("dukeanddexter.com", "wilde-brown-suede-penny-loader-mens", 0),
    "dd-wilde-w": ("dukeanddexter.com", "wilde-black-penny-loafer-womens", 0),
    "dd-maryjane-w": ("dukeanddexter.com", "ruby-cherry-black-mary-jane-shoe-womens", 1),
    "dd-derby-m": ("dukeanddexter.com", "lennon-chocolate-suede-derby-mens", 0),
    "dd-chelsea-m": ("dukeanddexter.com", "moby-black-boot", 0),
    "cp-achilles-m": ("kith.com", "cp1528-0506", 0, -1),
    "cp-achilles-w": ("kith.com", "common-projects-wmns-original-achilles-low-white", 0, -1),
    "cp-retro-m": ("kith.com", "cp2542-5773", 0),
    "cp-chelsea-m": ("shop.simon.com", "brown-suede-chelsea-boots", 0),
    "ax-clean90": ("shop.simon.com", "clean-90-sneaker", 0),
    "ax-dice": ("shop.simon.com", "dice-lo-low-top-perforated-leather-sneakers", 0),
    "ax-genesis": ("shop.simon.com", "axel-arigato-genesis-vintage-runner-sneakers", 0),
    "au-medalist-m": ("www.goodnbr.com", "medalist-low-sneaker-white-leather", 0),
    "au-medalist-w": ("www.goodnbr.com", "medalist-low-sneaker-white-powder-leather-suede", 0),
    "au-platform-w": ("www.goodnbr.com", "medalist-low-bicolor-sneaker-white-silver-leather", 0),
    "vb-service-2030": ("www.viberg.com", "sb2030-bcxl", 0),
    "vb-service-1035": ("www.viberg.com", "service-1035-cuhb", 0),
    "vb-service-6748": ("www.viberg.com", "service-2030-wnawf", 0),
    "vb-hiker-240": ("www.viberg.com", "hiker-9220-bkwc", 0),
    "cj-audley": ("crockettandjones.com", "audley-black-calf", 0),
    "cj-cavendish": ("crockettandjones.com", "cavendish-black-calf", 0),
    "cj-coniston": ("crockettandjones.com", "coniston-darkbrown-scotch-grain", 0),
    "cj-chelsea": ("crockettandjones.com", "chelsea-8-darkbrown-suede-city", 0),
    "al-indy": ("clutch-cafe.com", "alden-indy-work-boot-original-brown-405", 0),
    "al-990": ("aldenmadison.com", "plain-toe-blucher-br-color-8-shell-cordovan-br-990", 4),
    "al-van": ("aldenmadison.com", "full-strap-loafer-br-brown-calfskin-br-686", 3),
    "al-chukka": ("aldenmadison.com", "chukka-boot-br-brown-suede-br-1273s", 3),
    "eg-chelsea": ("meetthehand.com", "chelsea-dark-oak-antique", 1, 48),
    "eg-dover": ("meetthehand.com", "dover-dark-oak-antique", 2, 48),
    "eg-piccadilly": ("meetthehand.com", "piccadilly-black", 0, 48),
    "eg-galway": ("meetthehand.com", "galway-country-calf-rosewood", 1, 48),
}


def tidy(raw, thresh=26):
    """
    整理照片，讓每張圖看起來一致：
    1. 背景是單一顏色（白、灰、米色）時，把背景換成純白
    2. 裁掉多餘的空白，鞋子置中
    3. 統一成 16:10 的白底畫布
    需要 Pillow（pip install pillow）；沒有安裝就直接使用原圖。
    """
    try:
        from io import BytesIO
        from PIL import Image, ImageDraw, ImageFilter, ImageChops
    except ImportError:
        return raw, None
    img = Image.open(BytesIO(raw)).convert("RGB")
    w, h = img.size
    border = [img.getpixel((x, y)) for x in range(0, w, max(1, w // 40)) for y in (1, h - 2)]
    border += [img.getpixel((x, y)) for y in range(0, h, max(1, h // 40)) for x in (1, w - 2)]
    avg = tuple(sorted(c[i] for c in border)[len(border) // 2] for i in range(3))
    spread = sum(max(abs(c[i] - avg[i]) for i in range(3)) > 18 for c in border) / len(border)

    if thresh < 0:
        # 白鞋放在淺灰背景：不去背（會吃到鞋子），只把整張圖等比例調亮，讓背景變白
        img = img.point(lambda v, k=255 / max(1, min(avg)): min(255, int(v * k)))
        shape = img.convert("L").point(lambda v: 255 if v < 236 else 0).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(9))
        bbox = shape.getbbox()
        if bbox:
            pad = 12
            img = img.crop((max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(w, bbox[2] + pad), min(h, bbox[3] + pad)))
    elif spread < 0.15 or thresh > 26:
        # 單色背景：從邊緣往內「油漆桶」填色，找出背景範圍
        marker = (255, 0, 254)
        work = img.copy()
        for x in range(0, w, max(1, w // 60)):
            for y in (0, h - 1):
                if work.getpixel((x, y)) != marker:
                    ImageDraw.floodfill(work, (x, y), marker, thresh=thresh)
        for y in range(0, h, max(1, h // 60)):
            for x in (0, w - 1):
                if work.getpixel((x, y)) != marker:
                    ImageDraw.floodfill(work, (x, y), marker, thresh=thresh)
        mask = Image.eval(ImageChops.difference(work, Image.new("RGB", (w, h), marker)).convert("L"), lambda v: 255 if v > 8 else 0)
        # 去掉背景上零星的雜點：先縮再放（小雜點會消失，鞋子主體留下），只保留主體附近的範圍
        core = mask.filter(ImageFilter.MinFilter(11)).filter(ImageFilter.MaxFilter(11))
        near = core.filter(ImageFilter.MaxFilter(21))
        mask = ImageChops.multiply(mask, near)
        mask = mask.filter(ImageFilter.GaussianBlur(1.2))  # 邊緣柔化
        white = Image.new("RGB", (w, h), (255, 255, 255))
        img = Image.composite(img, white, mask)
        bbox = core.getbbox()
        if bbox:
            img = img.crop(bbox)
    # 放進 16:10 白底畫布，四周留 7% 空間
    cw, ch = 960, 600
    iw, ih = img.size
    scale = min(cw * 0.86 / iw, ch * 0.86 / ih)
    img = img.resize((max(1, int(iw * scale)), max(1, int(ih * scale))), Image.LANCZOS)
    canvas = Image.new("RGB", (cw, ch), (255, 255, 255))
    canvas.paste(img, ((cw - img.width) // 2, (ch - img.height) // 2))
    out = BytesIO()
    canvas.save(out, "JPEG", quality=84, optimize=True, progressive=True)
    return out.getvalue(), "jpg"


def fetch(url, accept="application/json"):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def main():
    only = set(sys.argv[1:])
    OUT.mkdir(parents=True, exist_ok=True)
    models_path = ROOT / "data" / "models.json"
    models = json.loads(models_path.read_text(encoding="utf-8"))
    credits = {}
    for mid, (host, handle, idx, *opt) in SOURCES.items():
        if only and mid not in only:
            continue
        try:
            product = json.loads(fetch(f"https://{host}/products/{handle}.json"))["product"]
            images = product["images"]
            src = images[min(idx, len(images) - 1)]["src"]
            sep = "&" if "?" in src else "?"
            data = fetch(f"{src}{sep}width=1200", accept="image/*")
            data, tidy_ext = tidy(data, *opt)
            ext = tidy_ext or src.split("?")[0].rsplit(".", 1)[-1].lower()
            ext = ext if ext in ("jpg", "jpeg", "png", "webp") else "jpg"
            for old in OUT.glob(f"{mid}.*"):
                old.unlink()
            path = OUT / f"{mid}.{ext}"
            path.write_bytes(data)
            credits[mid] = {"image": f"images/shoes/{mid}.{ext}", "credit": host, "count": len(images)}
            print(f"OK   {mid:18} {len(data) // 1024:4} KB  {host}  ({len(images)} 張可選)  {product['title'][:50]}")
        except Exception as e:
            print(f"FAIL {mid:18} {host} {handle}: {e}")

    for m in models:
        if m["id"] in credits:
            m["image"] = credits[m["id"]]["image"]
            m["imageCredit"] = credits[m["id"]]["credit"]
    models_path.write_text(json.dumps(models, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
