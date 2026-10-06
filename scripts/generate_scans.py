"""
產生模擬鞋內掃描資料 data/scans.json（demo 用，不是真實掃描）

用法（在專案資料夾執行）：
    python scripts/generate_scans.py

真實版本的資料來源可能是：鞋內 3D 掃描儀、矽膠翻模後掃描、或品牌提供的楦頭 CAD 檔。
這裡依各鞋款的楦型參數（楦頭寬窄、尺寸偏移、穿法）推算每個尺碼的鞋內尺寸，
並加上 ±0.5 mm 的測量誤差，模擬「實際量出來」的數值。

每個尺碼記錄四個區域（單位 mm）：
- lengthMm        鞋內長度（腳跟到鞋頭內側）
- ballWidthMm     前掌最寬處的內寬
- instepHeightMm  腳背處的內部高度（從鞋墊量起）
- heelWidthMm     腳跟處的內寬
"""

import json
import random
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

# 鞋頭預留空間（鞋內長度 − 合適腳長），依類型
TOE_ALLOWANCE = {"小白鞋": 12, "休閒鞋": 12, "靴子": 13, "皮鞋": 14, "樂福鞋": 11, "瑪莉珍鞋": 11}
# 楦頭寬窄對前掌內寬的影響（mm）
TOE_WIDTH_ADJ = {"窄": -4, "標準": 0, "寬": 5}
# 個別楦型的特殊調整（mm）
LAST_ADJ = {
    "vb-service-6748": {"instep": -2, "heel": -2},  # 最貼腳：腳跟收窄、腰身窄
    "vb-hiker-240": {"instep": 3, "heel": 1},  # hiker 楦最寬鬆
    "vb-service-1035": {"instep": 1},
    "al-990": {"instep": 1},
    "eg-galway": {"instep": 1},
}


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


def sizes_and_feet(model, charts):
    """回傳 [(尺碼, 這個尺碼設計給多長的腳 mm)]"""
    if model.get("sizeChart"):
        rows = charts["official"][model["sizeChart"]]["rows"]
        out = []
        prev = rows[0]["maxMm"] - 9
        for r in rows:
            out.append((r["size"], (prev + r["maxMm"]) / 2))
            prev = r["maxMm"]
        return out
    step = 0.5 if model["halfSizes"] else 1
    lo, hi = model["sizeRange"]
    col = column_for(model["sizeSystem"], model["gender"])
    rows = charts["generic"]["rows"]
    out = []
    s = lo
    while s <= hi + 1e-9:
        # 偏移 -1（小一號）代表標示 s 號的鞋，實際上是給「標準 s+1 號」的腳穿
        foot = interpolate(rows, col, "footMm", s - model["sizeOffset"])
        out.append((s, foot))
        s += step
    return out


def main():
    models = json.loads((DATA / "models.json").read_text(encoding="utf-8"))
    charts = json.loads((DATA / "size-charts.json").read_text(encoding="utf-8"))
    scans = {}
    for m in models:
        rng = random.Random(zlib.crc32(("scan-" + m["id"]).encode("utf-8")))
        adj = LAST_ADJ.get(m["id"], {})
        closure_instep = {"slip-on": -1, "strap": -0.5}.get(m["closure"], 0)
        sizes = []
        for size, foot in sizes_and_feet(m, charts):
            noise = lambda: rng.uniform(-0.5, 0.5)
            sizes.append({
                "size": size,
                "lengthMm": round(foot + TOE_ALLOWANCE[m["category"]] + noise(), 1),
                "ballWidthMm": round(foot * 0.39 + TOE_WIDTH_ADJ[m["toeWidth"]] + noise(), 1),
                "instepHeightMm": round(foot * 0.262 + closure_instep + adj.get("instep", 0) + noise(), 1),
                "heelWidthMm": round(foot * 0.268 + {"窄": -1.5, "寬": 2}.get(m["toeWidth"], 0) + adj.get("heel", 0) + noise(), 1),
            })
        scans[m["id"]] = {"method": "模擬（依楦型參數推算，demo 用）", "sizes": sizes}

    out = {
        "note": "全部為程式依楦型參數推算的模擬鞋內尺寸（demo 用），不是實際掃描結果。產生方式見 scripts/generate_scans.py。",
        "scans": scans,
    }
    (DATA / "scans.json").write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"已產生 {len(scans)} 個鞋款的模擬鞋內尺寸 → data/scans.json")


if __name__ == "__main__":
    main()
