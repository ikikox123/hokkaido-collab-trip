# 北海道協作行程｜瘋瘋火火冒險記（簡易版）

多人即時協作的北海道行程網頁（mobile-first）。朋友用同一房間碼加入後，可即時拖曳排序、新增／刪除站點，地圖顯示當日路徑與下一站，並顯示札幌／小樽／旭川即時天氣。

## 技術棧

- 前端：Vite + React + TypeScript + Tailwind CSS
- 即時：Socket.io
- 地圖：Leaflet + OpenStreetMap（免 API key）
- 拖曳：@dnd-kit（含觸控感測器）
- 天氣：Open-Meteo
- 登入：JWT + localStorage（示範帳號）
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

- 未登入：可瀏覽行程與地圖
- 已登入：可拖曳排序、加入、刪除、改時間、重置種子資料

## 房間碼

預設：`HOKKAIDO2027`

點頂部「選單」可改房間碼並加入。同一房間內的操作會即時同步。

## 功能說明

1. **即時協作**：Socket.io 房間同步行程狀態；伺服器記憶體 + `data/state.json` 持久化
2. **地圖**：依當日站點畫 polyline；粉紅＝下一站、藍＝選中
3. **拖曳排序**：長按（約 0.2 秒）拖動手把可排序，避免誤觸捲動
4. **天氣**：頂部顯示札幌／小樽／旭川氣溫與圖示，約每 10 分鐘刷新
5. **種子行程**：2027-02-12～18，基地 Minn 札幌大通西14

## 手機操作（mobile-first）

- 預設以約 390px 寬設計；小螢幕為單欄
- 用「列表／地圖」切換，避免並排擠爆
- 拖曳：按住左側 ≡ 手把約 0.2 秒再拖；一般滑動仍可捲動列表
- 地圖支援雙指縮放與拖曳；縮放按鈕 ≥ 44px
- 頂部可點「選單」展開房間碼、線上人數、班機資訊
- 點擊區與按鈕高度 ≥ 44px；底部避開 home indicator（safe-area）


## 環境變數

複製 `.env.example` 後自行設定（**不要**提交 `.env`）：

| 變數 | 說明 | 預設／範例 |
|------|------|------------|
| `JWT_SECRET` | JWT 簽章密鑰；**production 必填**，未設會拒絕啟動 | `change-me-in-production` |
| `PORT` | HTTP／WebSocket 埠 | `3001` |
| `ROOM_CODE` | 預設房間碼 | `HOKKAIDO2027` |
| `NODE_ENV` | `production` 時提供 `client/dist` 靜態檔 | `production` |

本機開發可不設 `JWT_SECRET`（會用開發用 fallback）。正式環境務必設定強隨機字串。

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

部署後朋友用手機開公開網址即可；房間碼與示範帳密同上。

## 目錄結構

```
hokkaido-collab-trip/
  package.json          # concurrently / build / start
  README.md
  .env.example          # 環境變數範本（勿提交真實 .env）
  Dockerfile            # multi-stage：build client → Express 單 port
  render.yaml / railway.toml
  data/                 # state.json 執行期產生（已 gitignore）
  server/
    package.json
    src/index.js        # Express + Socket.io + JWT + 靜態檔 + 天氣
    src/seed.js         # 種子行程
  client/
    package.json
    vite.config.ts      # dev proxy → :3001
    src/…
```

## API 摘要

- `POST /api/login` `{ username, password }` → `{ token, user }`
- `GET /api/trip` 目前行程
- `GET /api/weather` 三城市天氣（伺服器轉打 Open-Meteo）
- `GET /api/health`

## 已知限制

- 示範登入、非正式 OAuth；production 必須設 `JWT_SECRET`（未設會拒絕啟動）
- 狀態以單一預設房間為主（房間碼主要用於 presence 分組）
- 新增站點座標沿用當日第一站或住宿點，需手動改 lat/lng（簡易版未做地圖點選加站）
- Open-Meteo／OSM 需外網；離線時天氣與圖磚可能失敗
