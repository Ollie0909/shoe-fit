"""
產生模擬評論 data/reviews.json（demo 用，不是真人評論）

用法（在專案資料夾執行）：
    python scripts/generate_reviews.py

做法：
1. 讀取 data/models.json 和 data/size-charts.json
2. 每個鞋款產生 15–40 位模擬買家：性別、腳長（貼近台灣成年人分布）、腳寬
3. 每位買家有一個「真正合腳的尺寸」= 標準尺寸 + 該鞋款的尺寸傾向 + 個人差異
4. 模擬他實際買了幾號，再依「買的尺寸 − 真正合腳尺寸」決定太小／剛好／太大
5. 用句型組合出評論文字

隨機種子固定（依鞋款 id），所以每次執行結果都一樣；新增鞋款不會影響其他鞋款的評論。
之後有真實評論時，直接用真實資料取代 data/reviews.json，這支腳本就不需要了。
"""

import json
import random
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

# 台灣成年人腳長分布（mm，平均、標準差），參考人體計測資料的概略值
FOOT_LENGTH = {"男": (255, 11), "女": (233, 10)}
# 腳寬 / 腳長 比例分布
WIDTH_RATIO = {"男": (0.392, 0.018), "女": (0.385, 0.017)}
WIDE_MIN, NARROW_MAX = 0.40, 0.36

# 各鞋款的模擬參數。沒列到的鞋款使用預設值：
#   count 評論數、trend 尺寸傾向（號，預設 = 鞋款的 sizeOffset）、sd 個人差異
#   mixture：兩派意見 [(比例, 傾向), ...]；upsize：買家自行加大一號的機率
SIM = {
    # DUKE + DEXTER：官方說正常尺寸，但買家分兩派——一派覺得偏小要加大，
    # 另一派加大後掉跟。這裡用「兩群人」模擬這種分歧。
    "dd-wilde-m": {"count": 40, "mixture": [(0.42, 0.7), (0.58, -0.1)], "upsize": 0.4},
    "dd-wilde-w": {"count": 34, "mixture": [(0.40, 0.7), (0.60, -0.1)], "upsize": 0.4},
    "dd-maryjane-w": {"count": 24, "mixture": [(0.25, 0.7), (0.75, -0.1)], "upsize": 0.25},
    "dd-derby-m": {"count": 20},
    "dd-chelsea-m": {"count": 16, "sd": 0.35},
    "cp-achilles-m": {"count": 38, "sd": 0.35},
    "cp-achilles-w": {"count": 28, "sd": 0.35},
    "cp-retro-m": {"count": 20, "sd": 0.35},
    "cp-chelsea-m": {"count": 16, "sd": 0.35},
    "ax-clean90": {"count": 26, "trend": 0.2, "sd": 0.35},
    "ax-dice": {"count": 18, "sd": 0.35},
    "ax-genesis": {"count": 17, "sd": 0.35},
    "au-medalist-m": {"count": 22, "sd": 0.35},
    "au-medalist-w": {"count": 25, "sd": 0.35},
    "au-platform-w": {"count": 15, "sd": 0.35},
    "vb-service-2030": {"count": 30},
    "vb-service-1035": {"count": 22},
    "vb-service-6748": {"count": 18},
    "vb-hiker-240": {"count": 15},
    "cj-audley": {"count": 24},
    "cj-cavendish": {"count": 18},
    "cj-coniston": {"count": 16},
    "cj-chelsea": {"count": 15},
    "al-indy": {"count": 26},
    "al-990": {"count": 20},
    "al-van": {"count": 17},
    "al-chukka": {"count": 15},
    "eg-chelsea": {"count": 20},
    "eg-dover": {"count": 18},
    "eg-piccadilly": {"count": 16},
    "eg-galway": {"count": 15},
}

FOLLOW_GUIDE = 0.55  # 照官方／預設建議尺寸購買的機率

# ===== 句型 =====
FIT_TEXT = {
    "剛好": [
        "買 {S} 剛好，腳趾前面還有一點空間。",
        "{S} 很合腳，第一天穿就沒有不舒服。",
        "照尺寸建議買 {S}，長度剛好。",
        "{S} 穿起來服貼，後跟不會滑。",
    ],
    "太小": [
        "{S} 偏緊，腳趾會頂到前面，應該要再大一點。",
        "買 {S} 太小了，穿兩小時腳就很痛，後來轉賣。",
        "{S} 長度勉強，久走會壓腳趾。",
    ],
    "太大": [
        "{S} 偏大，走路時後跟會滑。",
        "{S} 太鬆，要加鞋墊才穿得住。",
        "{S} 前面空太多，下次會買小一點。",
    ],
}
DD_TEXT = {
    ("太小", "guide"): ["官方說正常尺寸，但 {S} 我穿偏小，建議加半號。", "照官方對照表買 {S}，腳背壓得很緊，偏小。"],
    ("太大", "up"): ["看網友說偏小，所以加大買 {S}，結果走路一直掉跟。", "加一號買 {S}，長度太鬆、會掉跟，其實照官方尺寸就好。"],
    ("剛好", "up"): ["我腳背比較高，加一號買 {S} 剛好。", "照網友建議加大買 {S}，穿起來剛好。"],
    ("剛好", "guide"): ["照官方對照表買 {S} 剛好，皮革穿幾次後更服貼。", "{S} 是官方表建議的尺寸，剛好，不用加大。"],
}
WIDTH_TEXT = {
    "偏窄": ["楦頭偏窄，小趾兩側會壓到。", "前掌窄，腳寬的人要注意。", "寬度偏緊，前幾次穿要忍耐一下。"],
    "偏寬": ["楦頭很寬鬆，腳趾空間充足。", "寬度有餘，腳瘦的人可能會覺得空。"],
    "剛好": ["寬度剛好。", ""],
}
AX_ASIAN = "鞋型比較窄長，感覺不太適合亞洲人偏寬的腳型。"
MATERIAL_TEXT = {
    "high": ["麂皮穿兩三週就撐開了，一開始緊一點沒關係。", "皮面很軟，穿一陣子寬度會鬆一點（長度不會變）。"],
    "some": ["皮革會慢慢服貼，但不會差太多。", "穿一個月後腳背處稍微鬆了一點。"],
    "low": ["皮革偏硬，幾乎不會撐開，尺寸要一次買對。"],
}
CORDOVAN = "馬臀皮不太會撐開，只會隨腳型起皺。"


# ===== 和 js/recommend.js 相同的尺寸計算 =====
def interpolate(rows, xk, yk, x):
    if x <= rows[0][xk]:
        return rows[0][yk]
    if x >= rows[-1][xk]:
        return rows[-1][yk]
    for a, b in zip(rows, rows[1:]):
        if x <= b[xk]:
            t = (x - a[xk]) / (b[xk] - a[xk])
            return a[yk] + t * (b[yk] - a[yk])
    return rows[-1][yk]


def column_for(system, gender):
    if system == "UK":
        return "uk"
    if system in ("EU", "IT"):
        return "eu"
    return "usW" if gender == "女" else "usM"


def standard_size(foot_mm, model, charts):
    if model.get("sizeChart"):
        rows = charts["official"][model["sizeChart"]]["rows"]
        for r in rows:
            if foot_mm <= r["maxMm"]:
                return r["size"]
        return rows[-1]["size"]
    col = column_for(model["sizeSystem"], model["gender"])
    return interpolate(charts["generic"]["rows"], "footMm", col, foot_mm)


def round_to(x, step):
    return round((x + 1e-6) / step) * step


def size_range(model, charts):
    if model.get("sizeChart"):
        rows = charts["official"][model["sizeChart"]]["rows"]
        return rows[0]["size"], rows[-1]["size"]
    return tuple(model["sizeRange"])


def foot_range(model, charts):
    """這個鞋款合理的買家腳長範圍（mm），避免產生「根本沒有尺碼」的買家"""
    if model.get("sizeChart"):
        rows = charts["official"][model["sizeChart"]]["rows"]
        return rows[0]["maxMm"] - 9, rows[-1]["maxMm"]
    rows = charts["generic"]["rows"]
    col = column_for(model["sizeSystem"], model["gender"])
    lo, hi = size_range(model, charts)
    off = model["sizeOffset"]
    return interpolate(rows, col, "footMm", lo - off) - 4, interpolate(rows, col, "footMm", hi - off) + 4


def fmt(n):
    return str(int(n)) if float(n).is_integer() else f"{n:g}"


# ===== 產生評論 =====
def make_reviews(model, charts):
    cfg = SIM.get(model["id"], {})
    rng = random.Random(zlib.crc32(model["id"].encode("utf-8")))
    step = 0.5 if model["halfSizes"] else 1
    lo_size, hi_size = size_range(model, charts)
    lo_mm, hi_mm = foot_range(model, charts)
    is_dd = model["brandId"] == "duke-dexter"
    sys = model["sizeSystem"]
    reviews = []

    for i in range(cfg.get("count", 18)):
        gender = model["gender"] if model["gender"] != "中性" else rng.choice(["男", "女"])

        # 腳長：常態分布，超出這款尺碼範圍就重抽
        mean, sd = FOOT_LENGTH[gender]
        for _ in range(100):
            foot_mm = round(rng.gauss(mean, sd))
            if lo_mm <= foot_mm <= hi_mm:
                break
        else:
            foot_mm = round(min(max(foot_mm, lo_mm), hi_mm))

        rmean, rsd = WIDTH_RATIO[gender]
        ratio = rng.gauss(rmean, rsd)
        width_cm = round(foot_mm * ratio) / 10 if rng.random() < 0.7 else None

        std = standard_size(foot_mm, model, charts)

        # 這位買家「真正合腳」的尺寸
        if "mixture" in cfg:
            pick, acc = rng.random(), 0
            for share, t in cfg["mixture"]:
                acc += share
                if pick <= acc:
                    trend = t
                    break
        else:
            trend = cfg.get("trend", model["sizeOffset"])
        width_effect = 0
        if ratio >= WIDE_MIN:
            width_effect = {"窄": 0.35, "標準": 0.1}.get(model["toeWidth"], 0)
        elif ratio <= NARROW_MAX and model["toeWidth"] == "寬":
            width_effect = -0.2
        ideal = std + trend + rng.gauss(0, cfg.get("sd", 0.3) if "mixture" not in cfg else 0.15) + width_effect

        # 他實際買了幾號
        guide = round_to(std + model["sizeOffset"], step)
        r = rng.random()
        if r < FOLLOW_GUIDE:
            purchased, how = guide, "guide"
        elif r < FOLLOW_GUIDE + cfg.get("upsize", 0):
            purchased, how = guide + step, "up"
        else:
            purchased, how = round_to(ideal + rng.gauss(0, 0.35 * step), step), "own"
        purchased = min(max(purchased, lo_size), hi_size)

        # 合腳結果：買的尺寸和真正合腳尺寸的差距
        diff = purchased - ideal
        fit = "太小" if diff < -0.6 * step else "太大" if diff > 0.7 * step else "剛好"

        # 寬度感受
        score = (ratio - 0.39) / 0.02 + {"窄": 1, "寬": -1}.get(model["toeWidth"], 0) + rng.gauss(0, 0.6)
        width_feel = "偏窄" if score > 1.3 else "偏寬" if score < -1.3 else "剛好"

        # 材質備註
        material_note = None
        if rng.random() < 0.55:
            material_note = CORDOVAN if "馬臀皮" in model["material"] else rng.choice(MATERIAL_TEXT[model["stretch"]])

        # 評論文字
        label = f"{sys} {fmt(purchased)}"
        key = (fit, "up" if how == "up" else "guide")
        if is_dd and key in DD_TEXT and (how != "own"):
            fit_sentence = rng.choice(DD_TEXT[key])
        else:
            fit_sentence = rng.choice(FIT_TEXT[fit])
        parts = [fit_sentence.format(S=label)]
        if model["brandId"] == "axel-arigato" and width_feel == "偏窄" and rng.random() < 0.6:
            parts.append(AX_ASIAN)
        else:
            parts.append(rng.choice(WIDTH_TEXT[width_feel]))
        if material_note:
            parts.append(material_note)

        usual_col = "usW" if gender == "女" else "usM"
        usual = round_to(interpolate(charts["generic"]["rows"], "footMm", usual_col, foot_mm) + rng.gauss(0, 0.25), 0.5)

        reviews.append({
            "id": f"{model['id']}-{i + 1:03d}",
            "modelId": model["id"],
            "gender": gender,
            "footLengthCm": foot_mm / 10,
            "footWidthCm": width_cm,
            "usualSize": f"US {'女' if gender == '女' else '男'} {fmt(usual)}",
            "purchasedSize": purchased,
            "sizeSystem": sys,
            "fit": fit,
            "widthFeel": width_feel,
            "materialNote": material_note,
            "text": "".join(p for p in parts if p),
            "source": "模擬評論（demo 用）",
            "isSimulated": True,
        })
    return reviews


def main():
    models = json.loads((DATA / "models.json").read_text(encoding="utf-8"))
    charts = json.loads((DATA / "size-charts.json").read_text(encoding="utf-8"))
    all_reviews = []
    for m in models:
        all_reviews.extend(make_reviews(m, charts))

    lines = [json.dumps(r, ensure_ascii=False) for r in all_reviews]
    out = (
        "{\n"
        '  "note": "全部為程式產生的模擬評論（demo 用），不是真人撰寫。產生方式見 scripts/generate_reviews.py。",\n'
        '  "reviews": [\n    ' + ",\n    ".join(lines) + "\n  ]\n}\n"
    )
    (DATA / "reviews.json").write_text(out, encoding="utf-8")
    print(f"已產生 {len(all_reviews)} 則模擬評論，涵蓋 {len(models)} 個鞋款 → data/reviews.json")


if __name__ == "__main__":
    main()
