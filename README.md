# FIT ATELIER｜海外精品鞋尺寸顧問（Demo）

網站有三個頁面：

| 頁面 | 網址 | 功能 |
|---|---|---|
| 尺寸建議 | `/` | 量腳 → 選鞋 → 建議尺寸。依品牌尺寸表、楦型與買家回饋計算 |
| 3D 試穿 Lab | `/lab/` | 比對你的腳和鞋內 3D 空間，再考慮材質延展性，模擬剛買時與磨合後哪裡會緊 |
| 方法說明 | `/about.html` | 計算方式、資料來源、隱私與聲明 |

- 純靜態網站：沒有後端伺服器，計算都在使用者的瀏覽器上執行
- 資料都放在 `data/` 的 JSON 檔，和計算邏輯分開
- **目前的買家評論、鞋內 3D 尺寸、材質參數都是模擬資料（demo 用）**，介面上都有清楚標示
- 鞋款圖是從品牌官網與零售商網站取得的商品照片（`images/shoes/`），著作權屬原權利人，僅供課堂展示；沒有照片時會自動改用自繪插畫
- 「尺寸建議」和「3D 試穿 Lab」用同一個函式（`js/final.js`）算出**綜合建議**，兩個頁面永遠顯示同一個尺寸
- 可以用手機拍照量腳（A4 紙當尺），自動算出腳長、腳寬

---

## 1. 在自己電腦上啟動

需要 Python（Windows 已安裝 Python 3 即可）。

1. 打開 PowerShell，進入專案資料夾：
   ```
   cd C:\Users\user\shoe-fit
   ```
2. 啟動本機伺服器：
   ```
   python -m http.server 8000
   ```
3. 用瀏覽器打開 <http://localhost:8000>
4. 要停止伺服器時，在 PowerShell 按 `Ctrl + C`

> 為什麼不能直接雙擊 `index.html`？因為瀏覽器基於安全限制，不允許直接打開的檔案讀取 JSON，所以需要一個本機伺服器。

修改任何檔案後，存檔、在瀏覽器按重新整理就會看到結果（若沒變化，按 `Ctrl + Shift + R` 強制重新整理）。

---

## 2. 專案結構

```
shoe-fit/
├─ index.html                 尺寸建議頁
├─ about.html                 方法說明頁
├─ lab/index.html             3D 試穿 Lab 頁
├─ og-image.png               分享到 LINE / Facebook 時的預覽圖
├─ images/shoes/              鞋款商品照片（由 scripts/download_images.py 下載並整理）
├─ css/style.css              三個頁面共用的樣式（顏色在檔案最上方 :root 區塊）
├─ js/
│  ├─ recommend.js            尺寸推薦邏輯（純計算，附中文註解）
│  ├─ fit3d.js                3D 試穿模擬邏輯（純計算，附中文註解）
│  ├─ final.js                綜合建議：合併上面兩種方法，兩個頁面共用（附中文註解）
│  ├─ footscan.js             用手機拍照量腳（A4 紙當尺）
│  ├─ app.js                  尺寸建議頁的畫面與互動
│  ├─ lab.js                  Lab 頁的畫面與互動
│  ├─ viewer3d.js             3D 畫面（three.js）
│  ├─ picker.js               品牌卡片＋鞋款卡片選擇器（兩頁共用）
│  ├─ illustrations.js        鞋款插畫（SVG）
│  ├─ data.js / store.js      讀取資料／記住上次輸入
├─ data/
│  ├─ brands.json             品牌（order 決定順序）
│  ├─ models.json             鞋款／楦型（含插畫設定 art、材質 materialKey、穿法 closure）
│  ├─ size-charts.json        通用腳長對照表＋品牌官方對照表
│  ├─ reviews.json            買家評論（目前是模擬資料）
│  ├─ scans.json              每個尺碼的鞋內尺寸（目前是模擬資料）
│  ├─ materials.json          材質延展性（目前是估計值）
│  └─ site.json               網站名稱、回報表單網址
└─ scripts/
   ├─ generate_reviews.py     產生模擬評論
   ├─ generate_scans.py       產生模擬鞋內尺寸
   └─ download_images.py      下載並整理鞋款照片（需要 pip install pillow）
```

---

## 3. 推薦邏輯（跟組員解釋用）

詳細註解在 `js/recommend.js`。概念如下：

1. **腳長 → 標準尺寸**
   有品牌官方腳長對照表（例如 DUKE + DEXTER）就查官方表；沒有就查通用表（依 Brannock 量腳器換算）。通用表會算出「連續值」，例如 UK 7.3，保留「介於兩號之間」的資訊。
2. **套用鞋款的尺寸偏移**
   例如 Common Projects 是「小一號」，偏移 = -1。
3. **用相近買家的回饋修正**
   找腳長 ±0.5 cm 的評論，推算每個人「真正合腳的尺寸」：買太小的再大一格、太大的再小一格。再算出這個尺寸比他自己的標準尺寸大或小幾號。
   最終偏移 = 預設偏移 ×（1 − 權重）＋ 買家平均偏移 × 權重，權重 = 評論數 ÷（評論數 + 5）。評論越多，越相信買家。
4. **取整成買得到的尺碼**
   考慮這款有沒有半號，以及品牌「介於兩號時往上或往下」的規則。
5. **寬度提醒**
   腳寬 ÷ 腳長 ≥ 0.40 視為寬腳、≤ 0.36 視為窄腳。寬腳遇到窄楦，就提醒加半號或改選其他款，並列出楦頭較寬的替代款。
6. **信心程度（滿分 100）**
   | 項目 | 配分 | 說明 |
   |---|---|---|
   | 相近評論數量 | 35 | 15 則以上拿滿分 |
   | 意見一致程度 | 35 | 最後合腳尺寸彼此相差不到半號的比例 |
   | 尺寸指南 | 20 | 官方 20、零售商／社群 15、待驗證 8 |
   | 官方與買家一致 | 10 | 不一致就是 0 分，並顯示「意見分歧提醒」 |

   75 分以上為「高」，50–74 為「中」，50 以下為「低」。

所有門檻（±0.5 cm、權重、寬腳比例、配分）都集中在 `recommend.js` 最上方的 `SETTINGS`，可以直接調整。

### 3D 試穿 Lab 的邏輯

詳細註解在 `js/fit3d.js`。核心概念是：**形狀吻合不等於舒服，要把材質算進去。**

把腳和鞋內空間分成四區比對：

| 區域 | 比對什麼 | 材質能不能改善 |
|---|---|---|
| 腳趾 | 鞋內長度 − 腳長（理想 8–15 mm） | **不能**：皮革長度方向幾乎不會撐開 |
| 前掌 | 鞋內寬 − 腳寬 | 可以：麂皮約 6%、小牛皮約 3%、馬臀皮約 1% |
| 腳背 | 鞋內高 − 腳背高 | 可以；綁帶鞋還能用鞋帶調整，樂福鞋不行 |
| 腳跟 | 鞋內寬 − 腳跟寬 | **不能**：鞋跟杯很硬；太寬就會掉跟 |

每區分成太緊／略緊／剛好／偏鬆，算出「剛買時」和「磨合後」的合腳指數（滿分 100）。最推薦的尺碼依「磨合後 60% + 剛買時 40%」挑選，因為太痛的鞋，很多人撐不到磨合完。

### 綜合建議：兩個頁面為什麼一定顯示同一個尺寸

詳細註解在 `js/final.js`。兩個頁面都呼叫同一個函式 `finalRecommendation()`：

1. 以「買家回饋推薦」的尺寸為起點
2. 用 3D 模擬檢查這一號，以及前後各一號
3. 每個候選的分數 = 3D 合腳分數（磨合後 60% ＋ 剛買時 40%）＋ 買家回饋加分
   - 加分只給買家回饋建議的那一號：10 ＋ 信心分數 × 0.15
   - 3D 發現這一號本身不合腳時加分打折：磨合後 ≥ 70 分全額、50–69 分打 4 成、< 50 分不加
4. 分數最高的就是綜合建議；如果和買家回饋不同，畫面會說明是哪個區域的問題

測試結果（2,352 組腳型 × 鞋款）：沒填腳寬、腳背高的一般腳型，196 組中只有 1 組被 3D 調整；被調整的多半是腳背很高或腳很寬的情況（例如腳背 7.2 cm 穿 DUKE + DEXTER 樂福鞋，會建議大一號，和買家回饋中「腳背高要加大」的說法一致）。

### 用手機拍照量腳

詳細註解在 `js/footscan.js`：

1. 腳踩在 A4 紙上拍照。A4 紙固定是 210 × 297 mm，程式自動找出紙的四個角（找照片中最大塊的白色區域），使用者可以拖曳微調
2. 用四個角算出透視轉換（homography），把照片「拉正」成正面的紙，手機拍得有點斜也能校正
3. 在拉正後的紙上，自動找出腳的範圍（比紙暗或有顏色的像素），標出腳跟、腳尖、最寬的兩側，使用者可以微調
4. 換算成 mm，得到腳長、腳寬。示範照片的實測誤差約 1 mm

需要 HTTPS 或 localhost 才能開相機拍照（GitHub Pages 是 HTTPS）。腳背高需要側面量，目前仍是手動輸入。

---

## 4. 更新資料

所有資料檔都是 JSON。改完存檔、重新整理就生效。**JSON 格式很嚴格**：字串要用雙引號，最後一項後面不能有逗號。改壞了，網頁會顯示「資料載入失敗」。

### 新增或修改鞋款（`data/models.json`）

複製一筆現有的鞋款、改內容即可。重要欄位：

| 欄位 | 說明 | 範例 |
|---|---|---|
| `id` | 唯一代號（英數） | `"cp-achilles-m"` |
| `brandId` | 對應 brands.json 的 id | `"common-projects"` |
| `category` | 類型（顯示在鞋款卡片和類型篩選） | `"小白鞋"`、`"靴子"`、`"皮鞋"`、`"樂福鞋"`、`"瑪莉珍鞋"` |
| `last` | 楦型 | `"2030"` |
| `gender` | `"男"`、`"女"`、`"中性"` | |
| `sizeSystem` | 尺碼制 | `"UK"`、`"US"`、`"EU"`、`"IT"` |
| `sizeChart` | 官方對照表代號（沒有就填 `null`） | `"dd-men"` |
| `halfSizes` | 有沒有半號 | `true` / `false` |
| `sizeRange` | 最小、最大尺碼（沒有官方表時使用） | `[39, 47]` |
| `betweenSizes` | 介於兩號時 | `"up"` 往上、`"down"` 往下、`"nearest"` 取最接近 |
| `stretch` | 材質會不會撐開 | `"high"`、`"some"`、`"low"` |
| `toeWidth` | 楦頭寬窄 | `"窄"`、`"標準"`、`"寬"` |
| `sizeOffset` | 尺寸偏移（號） | `-1` = 小一號、`-0.5` = 小半號 |
| `reliability` | 資料可信度 | `"official"`、`"retailer"`、`"unverified"` |
| `materialKey` | 材質（對應 materials.json） | `"suede"`、`"calf"`、`"cordovan"`… |
| `closure` | 穿法 | `"laces"` 綁帶、`"slip-on"` 套入、`"elastic"` 鬆緊帶、`"strap"` 扣帶 |
| `art` | 插畫設定 | `{"kind": "loafer", "upper": "#a87a52", "sole": "#3a2b20"}` |
| `image` | 實拍照片路徑（沒有就填 `null`，會用插畫） | `"images/shoes/dd-wilde-m.jpg"` |

插畫的 `kind` 可以是：`sneaker` 小白鞋、`platform` 厚底、`runner` 跑鞋、`loafer` 樂福鞋、`maryjane` 瑪莉珍鞋、`oxford` 牛津鞋、`derby` 德比鞋、`boot-service` 綁帶靴、`boot-chelsea` 切爾西靴、`boot-hiker` 登山靴、`boot-chukka` 短靴。`upper` 是鞋面顏色、`sole` 是鞋底顏色。

### 更換鞋款照片

照片由 `scripts/download_images.py` 從品牌官網或零售商網站（Shopify 商店）下載，並自動去背、裁切成一致的白底 16:10 構圖。

- 換一張照片：修改腳本最上方 `SOURCES` 中該鞋款的設定（網站、商品代號、第幾張圖），再執行 `python scripts/download_images.py 鞋款id`
- 用自己的照片：把照片放進 `images/shoes/`，在 `models.json` 對應鞋款的 `image` 填上路徑
- 這些照片的著作權屬原網站，目前只適合課堂展示；正式上線前請換成有授權的照片

### 新增品牌官方腳長對照表（`data/size-charts.json`）

在 `official` 底下新增一組，`maxMm` 是「這個尺碼適合的最大腳長」，然後在鞋款的 `sizeChart` 填上它的代號。

### 換成真實評論（`data/reviews.json`）

把 `reviews` 陣列換成真實資料即可，程式不用改。每則評論的格式：

```json
{
  "id": "cp-achilles-m-001",
  "modelId": "cp-achilles-m",
  "gender": "男",
  "footLengthCm": 25.6,
  "footWidthCm": 10.1,
  "usualSize": "US 男 8.5",
  "purchasedSize": 41,
  "sizeSystem": "IT",
  "fit": "剛好",
  "widthFeel": "偏窄",
  "materialNote": "穿兩週後稍微撐開",
  "text": "評論內容",
  "source": "Google 表單回報",
  "isSimulated": false
}
```

- `footWidthCm`、`materialNote` 可以填 `null`
- `fit` 只能是 `太小`、`剛好`、`太大`；`widthFeel` 只能是 `偏窄`、`剛好`、`偏寬`
- `purchasedSize` 是**該鞋款尺碼制**的數字

> 換成真實評論後，記得把 `js/app.js` 和 `index.html` 裡「模擬評論（demo 用）」等標示文字改掉。

### 重新產生模擬評論

修改 `scripts/generate_reviews.py` 裡的 `SIM` 參數（評論數、尺寸傾向等）後執行：

```
python scripts/generate_reviews.py
```

### 換成真實的鞋內掃描與材質數據（Lab 用）

- `data/scans.json`：每個鞋款、每個尺碼的鞋內 `lengthMm`、`ballWidthMm`、`instepHeightMm`、`heelWidthMm`（單位 mm）。換成實際掃描或翻模量測的數值即可。
- `data/materials.json`：各材質的 `stretchWidth`、`stretchInstep`（可撐開的比例，0.05 = 5%）和磨合時間。換成拉伸測試的實測值即可。
- 模擬數據可以用 `python scripts/generate_scans.py` 重新產生（新增鞋款後需要執行一次）。

換成真實數據後，記得把 `lab/index.html` 裡「模擬值」「估計值」等標示文字改掉。

### 換上 Google 表單

把表單網址填進 `data/site.json` 的 `feedbackFormUrl`：

```json
"feedbackFormUrl": "https://forms.gle/xxxxxxxx"
```

留空時，按鈕會顯示「回報表單準備中」。

---

## 5. 重新部署（GitHub Pages）

網站放在 GitHub Pages。只要把修改推送到 GitHub，1–2 分鐘後網址上的內容就會自動更新。

在專案資料夾的 PowerShell 執行：

```
git add .
git commit -m "說明這次改了什麼"
git push
```

更新狀態可以在 GitHub repo 頁面的 **Actions** 分頁查看，綠色勾勾代表部署完成。手機上若看到舊版，請重新整理或清除快取。

---

## 6. 資料來源與限制

- 尺寸指南：DUKE + DEXTER（官方腳長對照表）、Common Projects、Viberg、Crockett & Jones、Axel Arigato 為公開資訊整理；Autry、Alden、Edward Green 的偏移值是依一般認知設定，標示為「待驗證」
- DUKE + DEXTER 女款官方表中，UK 5（229–237mm）和 UK 6（236–245mm）有重疊，暫將 UK 6 設為 238–245mm，待官網核對
- 部分鞋款名稱和楦型編號（標示「待驗證」者）需要再核對
- 寬腳／窄腳的比例門檻是經驗值，建議之後用真實回饋校正
- Lab 的鞋內尺寸是依楦型參數推算的模擬值，材質延展性是一般皮革特性的估計值
- 3D 畫面使用 three.js（從 jsDelivr CDN 載入）；網路不通或手機不支援 3D 時，Lab 的文字分析仍然可用
