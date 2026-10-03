# 北海道協作行程｜瘋瘋火火冒險記（簡易版）

多人即時協作的北海道行程網頁（mobile-first）。朋友用同一房間碼加入後，可即時拖曳排序、新增／刪除站點，地圖顯示當日路徑與下一站，並顯示札幌／小樽／旭川即時天氣。

## 技術棧

- 前端：Vite + React + TypeScript + Tailwind CSS
- 即時：Socket.io
- 地圖：`VITE_MAP_PROVIDER=google` 且有瀏覽器金鑰時用 Google Maps JavaScript（標記、路線、手機手勢）。否則 Leaflet + Esri World Street Map（免 API key）。CARTO 公開圖磚現在會回「API KEY REQUIRED」浮水印，所以不當預設；OSM 只在主圖磚載入失敗時備援
- 路線：有 `GOOGLE_MAPS_SERVER_KEY` 時優先 Google Directions（步行／開車／大眾運輸）。沒有金鑰或 Google 失敗時用 OSRM 公開服務，經伺服器 `/api/route` 轉打
- 拖曳：@dnd-kit（含觸控感測器）
- 天氣：Open-Meteo 預報（札幌／小樽／旭川）。警報用氣象廳防災資訊 XML（PULL）。tenki.jp 沒有免費公開 API，不抓取
- JR：官方運行頁面使用的公開 JSON（`top_tc.json`）做摘要，並附官方連結。不抓 HTML
- 登入：JWT + localStorage。示範帳號仍可用，朋友也可自行註冊（同一套帳號＋密碼）
- 後端：Express（port 3001），Vite 代理 `/api` 與 `/socket.io`

## 啟動方式

```bash
# from the repository root
npm run install:all   # 或：npm install && npm install --prefix server && npm install --prefix client
npm run dev
```

- 前端：http://localhost:5173
- 後端：http://localhost:3001

瀏覽器開啟 `http://localhost:5173` 即可。

## 示範帳號

| 帳號  | 密碼     |
|-------|----------|
| alice | demo1234 |
| bob   | demo1234 |

- 未登入：可瀏覽行程、地圖、各段交通估算與分帳（支出、淨額、建議轉帳、匯率）
- 已登入：可拖曳排序、加入、刪除、改時間、改地點名稱（只改顯示名稱，座標與路段不變）、改相鄰站交通方式，以及新增／修改／刪除支出、旅伴，與設定手動匯率。從 `state.json` 讀入的行程，重置不會改寫站點

朋友可在登入視窗點「還沒有帳號？註冊」，用帳號＋密碼建立帳號。註冊成功會直接登入，並加入目前房間（預設 `HOKKAIDO2027`）。帳號存在伺服器 `data/users.json`（已 gitignore），只存 bcrypt 雜湊。註冊沒有 migrate，不讀、不寫 `data/state.json`，也不會用種子行程覆蓋或清空既有房間（含 `HOKKAIDO2027`）。`alice` / `bob` 仍是示範帳，不能被註冊蓋掉。帳號或密碼沒填、或帳號重複，會在畫面上顯示中文錯誤。

## 房間碼

預設：`HOKKAIDO2027`

點頂部「選單」可改房間碼並加入。同一房間內的操作會即時同步。

## 功能說明

1. **即時協作**：Socket.io 房間同步行程。行程存在 `data/state.json`（容器裡是 `/app/data/state.json`，`server/src/index.js` 的 `DATA_DIR`）。這個檔案不在 git，也不在 Docker 映像裡。`NODE_ENV=production` 時若檔案不存在，程序會以非 0 結束，印出 `Refusing to start`，不會呼叫 `createSeedState()`、不會寫入種子檔、也不會開始服務。本機開發時檔案不存在才會用種子建立新房間。已存在的 `state.json` 會原樣讀入；若沒有分帳或匯率欄位，只補上空的 `members`、`expenses` 與空白匯率，不改站點、日期與其他已存欄位。從 `state.json` 讀入的行程，啟動時不做種子座標修正，也不會把地理編碼結果寫回站點座標。上線前要先把外部存好的行程放到 volume 的 `/app/data/state.json`，再啟動新程序。本 repo 不掛 volume。
2. **地圖**：`VITE_MAP_PROVIDER=google` 且建置時有 `VITE_GOOGLE_MAPS_API_KEY` 才畫 Google 地圖（標記、折線、`gestureHandling=greedy`、44px 縮放鈕）。否則維持 Leaflet + Esri。切換日期、從列表切到地圖、或當天站點變更時，視野會貼到**當天全部站點**。只有 1 站時用 zoom 15，沒有站點時回到住宿 Minn（約 43.0573, 141.3366）zoom 13。手機地圖面板填滿日期列、目前站點與底部導覽之間的剩餘高度。Google 腳本載入失敗時改回 Leaflet。Leaflet 主圖磚若連線失敗才改打 OpenStreetMap。
3. **交通方式**：同一天相鄰站（列表順序）可設 `步行 / 地鐵 / JR / 巴士 / 計程車 / 自駕 / 包車`。估時與路徑寫進共用 `legs`，經 Socket.io `trip:setLegMode` 同步（與其他編輯一樣廣播 `trip:update`）。訪客只讀。地圖依路段畫路徑，顏色依交通方式。有伺服器金鑰時：步行→walking、計程車／自駕／包車→driving、地鐵／JR／巴士→transit；transit 失敗則改 driving，摘要標成開車路徑估算。
4. **拖曳排序**：長按（約 0.2 秒）拖動手把可排序，避免誤觸捲動。排序、新增、刪除會重算受影響路段。
5. **天氣與告警**：日期列下方有可收合的「天氣＋交通告警」。預設收合：有警報時只顯示「有警報」與數量、簡稱；平穩時顯示旅程日期預報氣溫與 JR 一行摘要。展開後，「旅程日期預報」與「目前運行狀態」（氣象廳警報、JR）分開。氣象廳與 JR 的日文原文保留，介面說明用繁體中文
6. **警報與 JR**：預報仍走 Open-Meteo。警報只讀氣象廳公開的 Atom／XML（`extra.xml` 與必要時 `extra_l.xml`），同一份電文不重複下載，結果快取約 5 分鐘。JR 讀官方頁面本身在用的 `top_tc.json`（快取約 5 分鐘）；`robots.txt` 未禁止 `/webunkou/`。JSON 讀不到時仍顯示「查看 JR北海道官方運行資訊」。不抓 tenki.jp，也不抓 JR 的 HTML
7. **種子行程**：2027-02-12～18，基地 Minn 札幌大通西14。D2 札幌市區預設以地鐵與短程步行為主。
8. **分帳**：支出存在同一份 `state.json` 的 `expenses`。支出仍用日圓或新台幣原幣別記帳，分攤也在該幣別裡驗算。分攤可以均分、自訂金額、依比例，或排除某些人；加總要等於金額（日圓可差 1 圓、新台幣可差 0.01）。每種幣別的淨額會收成最少筆數的轉帳。另外用目前的日圓兌新台幣匯率，把兩邊合成「用台幣看」或「用日圓看」的結算。可選連結某一天或某個站點（在新增支出的「進階分攤」裡）。手機底部「分帳」，或直接開 `/split`；電腦在左欄切換，地圖仍留在旁邊。已登入可以點「複製連結」，貼到群組公告（網址加上一行說明）。訪客開同一個連結看得到帳，要記帳會先登入，登入後回到這個分帳頁並打開新增支出。匯出 CSV 含支出明細、各幣別轉帳，以及有匯率時的換算。從 `state.json` 讀入的行程不能按「重置種子資料」蓋掉。
9. **匯率**：伺服器向 Yahoo Finance 公開圖表抓 `JPYTWD=X`（不需要 API key），約每 3 分鐘更新一次；打開分帳頁也會再要一次，90 秒內不重複打來源。畫面上同時有「1 日圓 = ? 台幣」和「1 台幣 = ? 日圓」，以及上次成功取得的時間。抓取失敗時沿用上一筆成功的匯率與時間，不會空白、也不會偷偷換成別的數字。從來沒成功過就顯示拿不到匯率，結算不換算。已登入可以改成手動匯率，畫面上會標「手動匯率」，直到按「改回即時匯率」。

## 手機操作（mobile-first）

- 預設以約 390px 寬設計；小螢幕為單欄
- 底部「行程／分帳／地圖」切換；看分帳時日期列先讓出來，底下有一顆「新增支出」。日期列與「目前站點」固定在列表捲動區外
- 分帳固定網址是 `/split`（例如 `http://localhost:5173/split`）
- 當日站點是直向時間軸，兩站之間標「前往下一站」
- 拖曳：按住站點上的 ≡ 手把約 0.2 秒再拖；一般滑動仍可捲動列表
- 地圖支援雙指縮放與拖曳；縮放按鈕 ≥ 44px
- 頂部可點「選單」展開房間碼、線上人數、班機資訊
- 點擊區與按鈕高度 ≥ 44px；底部導覽避開 home indicator（safe-area）


## 環境變數

複製 `.env.example` 後自行設定（**不要**提交 `.env`）：

| 變數 | 說明 | 預設／範例 |
|------|------|------------|
| `JWT_SECRET` | JWT 簽章密鑰；**production 必填**，未設會拒絕啟動 | `change-me-in-production` |
| `PORT` | HTTP／WebSocket 埠 | `3001` |
| `ROOM_CODE` | 預設房間碼 | `HOKKAIDO2027` |
| `NODE_ENV` | `production` 時提供 `client/dist` 靜態檔 | `production` |
| `OSRM_BASE_URL` | 選用。自架 OSRM 時才改；沒有 Google 金鑰時的預設路線服務，**不需要 API key** | `https://router.project-osrm.org` |
| `VITE_TILE_URL` | 選用、**建置時**覆寫 Leaflet 圖磚。未設則用 Esri，不需要 key | 見 `.env.example` |
| `VITE_TILE_ATTRIBUTION` | 選用，搭配自訂圖磚的版權文字 | |
| `VITE_MAP_PROVIDER` | `google` 或 `leaflet`。**建置時**決定前端地圖。`google` 還需要下一列的瀏覽器金鑰，否則仍走 Leaflet | `leaflet` |
| `VITE_GOOGLE_MAPS_API_KEY` | **建置時**瀏覽器金鑰：Maps JavaScript API、Places Autocomplete。會進前端 bundle，請用 HTTP referrer 限制。勿把真實金鑰寫進 git | |
| `GOOGLE_MAPS_SERVER_KEY` | **執行時**伺服器金鑰：Directions、Geocoding、Places Find Place。可與瀏覽器金鑰相同（需在 Google Cloud 啟用對應 API）。勿提交 | |

本機開發可不設 `JWT_SECRET`（會用開發用 fallback）。正式環境務必設定強隨機字串。

複製 `.env.example` 成 `.env` 後只在機器或主機儀表板填值。伺服器啟動時會讀取專案根目錄的 `.env`（已在環境裡的變數不會被蓋過），**不會**把內容寫進紀錄。Vite 開發伺服器也從專案根目錄讀 `VITE_*`。

Docker／Railway 映像在 `npm run build` 時就把 `VITE_MAP_PROVIDER` 與 `VITE_GOOGLE_MAPS_API_KEY` 打進前端。這兩個要在**建置**階段就存在（Dockerfile 的 `ARG` 同名）。`GOOGLE_MAPS_SERVER_KEY` 只在容器執行時需要，不要寫進映像層的原始碼。

沒設 Google 變數時，地圖仍是 Leaflet、路線仍是 OSRM，不需要金鑰。CARTO 匿名網址目前會回傳「API KEY REQUIRED」浮水印圖，不能當免 key 底圖。

## 部署（單一 Port：Express 靜態檔 + Socket.io）

Production 時 `server` 會提供 `client/dist`，前端與 API／WebSocket 同 origin，適合 Render／Railway。

### 本機 production 煙測

```bash
cp .env.example .env   # 並改 JWT_SECRET
npm run install:all
npm run build
export $(grep -v '^#' .env | xargs)
npm start              # http://localhost:3001
```

### Docker

```bash
docker build -t hokkaido-collab-trip .
docker run --rm -p 3001:3001 \
  -e JWT_SECRET=your-strong-secret \
  -e ROOM_CODE=HOKKAIDO2027 \
  -e NODE_ENV=production \
  hokkaido-collab-trip
```

### Render（建議：支援 Node + WebSocket）

1. 連 GitHub repo → New Web Service，或用 Blueprint（`render.yaml`）
2. Build：`npm run install:all && npm run build`
3. Start：`npm start`
4. 環境變數：`NODE_ENV=production`、`JWT_SECRET`（自動產生或自填）、`ROOM_CODE=HOKKAIDO2027`
5. Health check：`/api/health`

### Railway（可選，用 Dockerfile）

- 已附 `railway.toml`（builder=DOCKERFILE）
- 在 Dashboard 設定 `JWT_SECRET`、`ROOM_CODE`、`NODE_ENV=production`
- 要用 Google 地圖時再設 `VITE_MAP_PROVIDER=google`、`VITE_GOOGLE_MAPS_API_KEY`（建置時）、`GOOGLE_MAPS_SERVER_KEY`（執行時）。改瀏覽器金鑰後需重新建置映像

部署後朋友用手機開公開網址即可；房間碼與示範帳密同上。

## 目錄結構

```
hokkaido-collab-trip/
  package.json          # concurrently / build / start
  README.md
  .env.example          # 環境變數範本（勿提交真實 .env）
  Dockerfile            # multi-stage：build client → Express 單 port
  render.yaml / railway.toml
  data/                 # state.json、users.json 執行期產生（已 gitignore）
  server/
    package.json
    src/index.js        # Express + Socket.io + JWT + 靜態檔 + 天氣
    src/seed.js         # 種子行程與公開座標
    src/seedGeocode.js  # 啟動時／單次用 Google 修正種子座標
    src/googleMaps.js   # Directions、Geocoding、Places API (New)、舊版 Find Place
  client/
    package.json
    vite.config.ts      # dev proxy → :3001
    src/…
```

## API 摘要

- `POST /api/login` `{ username, password }` → `{ token, user }`
- `POST /api/register` `{ username, password }` → `201 { token, user }`（帳號重複回 409，帳號或密碼沒填回 400 與中文錯誤）
- `GET /api/trip` 目前行程
- `GET /api/weather` 三城市天氣（伺服器轉打 Open-Meteo）
- `GET /api/trip-alerts` 預報＋氣象廳警報＋JR 運行摘要（伺服器抓取並短快取；不含 tenki.jp）
- `GET /api/health`
- `GET /api/fx` 日圓兌新台幣。距上次嘗試超過 90 秒才會再打 Yahoo Finance，否則回傳目前這筆（含手動匯率、上次成功時間；沒有成功過則沒有數字）
- `GET /api/places?q=`（需登入）先 Geocoding（北海道範圍），沒有結果再試 Places API (New)，最後才試舊版 Find Place。舊版回 `REQUEST_DENIED` 時視為沒找到，不會擋下 Geocoding。兩邊都失敗時回 502 與簡短原因（不含金鑰）。沒有 `GOOGLE_MAPS_SERVER_KEY` 時回 503。回應只有名稱、地址、座標
- `GET /api/route?fromLat=&fromLng=&toLat=&toLng=&mode=`  
  有 `GOOGLE_MAPS_SERVER_KEY` 時轉打 Google Directions，否則 OSRM（記憶體快取約 10 分鐘）。
  - `walk` → walking／OSRM walking
  - `taxi` / `car` / `charter` → driving
  - `subway` / `jr` / `bus` → Google `transit`（可再加 subway／rail／bus）。transit 失敗則用 driving，摘要註明「開車路徑估算」
  - 沒有 Google 金鑰時，transit 路徑用 OSRM driving 幾何，時間用估算速度（**估算非時刻表**）  
    地鐵約 28 km/h＋3 分鐘、JR 約 50 km/h＋4 分鐘、巴士約 18 km/h＋3 分鐘  
    摘要例：`約 25 分・3.2 km・建議地鐵（估算非時刻表）`
  - 路線服務都失敗時改直線距離估算，摘要會註明「直線估算」

Socket.io（需登入 JWT，成功後廣播 `trip:update`）：

- `trip:reorder` / `trip:add` / `trip:updateStop` / `trip:delete` / `trip:reset`
- `trip:setLegMode` `{ fromStopId, toStopId, mode }` 改相鄰站交通方式並重新估算
- `expense:upsert` / `expense:delete` 與 `member:add` / `member:rename` / `member:remove` 改分帳，同樣廣播整份行程（含 `expenses`）。不重算路線。訪客只讀
- `fx:override` `{ basis: 'twdPerJpy' | 'jpyPerTwd', value, token }` 設定手動匯率；`fx:clearOverride` `{ token }` 改回即時。成功後廣播 `fx:update`

## 已知限制

- 帳號＋密碼登入（JWT），可公開註冊；非正式 OAuth。註冊帳存在 `data/users.json`。production 必須設 `JWT_SECRET`（未設會拒絕啟動）
- 狀態以單一預設房間為主（房間碼主要用於 presence 分組）；`legs` 存在同一份行程狀態裡
- 未啟用 Google 時，新增站點座標沿用當日第一站或住宿點。啟用後以 Places Autocomplete（或「伺服器搜尋」的 Geocoding／Places API (New)）帶入 lat/lng，並可改既有站的地點。瀏覽器舊版 Autocomplete 載入失敗時，仍可用「伺服器搜尋」
- Open-Meteo、氣象廳 XML、JR 公開 JSON、圖磚、OSRM 或 Google 需外網。CARTO 公開 raster 需 key，否則是浮水印
- 氣象廳電文若整份下載超過注意事項的每日上限，來源 IP 可能被擋。本服務快取結果，且同一電文網址不下載第二次
- JR 摘要是官方狀態碼（0 無停駛／延遲訊息、1 停駛或延誤 30 分以上、2 服務時間外），不是時刻表。異常時才另外讀該區 JSON 的原文。詳情以官方頁為準
- tenki.jp 沒有可串接的免費 API，服務條款也不允許自動抓取，所以沒有接 tenki.jp
- 沒有 Google transit 結果時，地鐵／JR／巴士時間不是時刻表。Google transit 用查詢當下的 `departure_time`，不是 2027 年的班表
- 種子座標先用公開資料（Wikipedia、OpenStreetMap、訂房頁）。伺服器若有 `GOOGLE_MAPS_SERVER_KEY`，啟動時會對每個種子站以「名稱＋札幌／小樽／旭川／美瑛／千歲等城市」做 Find Place，失敗再 Geocoding，並更新記憶體與 `data/state.json`。標題已被改過的站不會被蓋掉。也可執行 `node server/src/seedGeocode.js`（加 `--write` 會把座標寫回 `server/src/seed.js` 的 `SEED_COORDINATES`，過程不印出金鑰）
