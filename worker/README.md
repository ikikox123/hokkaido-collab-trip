# Cloudflare Workers 版本

Railway（Express + Socket.io）的替代部署。功能、事件名稱、權限規則都跟 `server/` 一樣；
純邏輯模組（分帳、路段、匯率、天氣、氣象廳、JR、分享）直接 import `server/src/`，不另外複製一份。

| 原本（Railway） | Workers 版 |
|---|---|
| Express API | `src/index.js`（Worker）＋ `src/tripHub.js`（Durable Object） |
| Socket.io | 原生 WebSocket `/ws`，休眠 API（沒人在線上時不算錢） |
| `data/state.json` | Durable Object SQLite（`doc_chunks` 表） |
| `data/users.json` | Durable Object SQLite（`users` 表，bcrypt 雜湊原樣保留） |
| Railway bucket 備份 | Durable Object 內建 30 天時間點還原＋`npm run export` |
| `setInterval` 匯率輪詢 | Durable Object alarm，每 3 分鐘，有人在線上才跑 |
| `client/dist` 靜態檔 | Workers Static Assets |

前端用同一份程式碼，建置時設定 `VITE_REALTIME=ws` 就改走 `/ws`；沒設時仍然走 Socket.io，Railway 版不受影響。

## 本機開發

```bash
cd worker
npm install
printf 'ENVIRONMENT=development\nADMIN_TOKEN=local-admin-token-for-dev-only\n' > .dev.vars
npm run dev            # http://127.0.0.1:8787，示範帳號 alice / bob，密碼 demo1234
node test/smoke.mjs    # 另開終端機：登入、註冊、即時同步、分帳的端對端測試
npm test               # 單元測試
```

## 部署（Cloudflare 後台連 GitHub，推薦）

1. Cloudflare 後台 → **Compute → Workers & Pages** → **Create** → **Import a repository** → 選 `hokkaido-collab-trip`
2. 設定：
   - **Project name**：`hokkaido-collab-trip`（要跟 `wrangler.jsonc` 的 `name` 一樣）
   - **Production branch**：要部署的分支
   - **Root directory**（Advanced settings 裡）：`worker`
   - **Build command**：留空（`wrangler.jsonc` 的 `build.command` 會自己建前端）
   - **Deploy command**：`npx wrangler deploy`
   - **Build variables**（要用 Google 地圖才填）：`VITE_MAP_PROVIDER=google`、`VITE_GOOGLE_MAPS_API_KEY=<瀏覽器金鑰>`
3. 第一次部署完 → 這個 Worker → **Settings → Variables and Secrets**，用 **Secret** 類型加入：
   - `JWT_SECRET`：填 Railway 上同一個值，大家就不用重新登入；換新值的話，每個人重新登入一次即可
   - `ADMIN_TOKEN`：自己產一組 16 字以上的隨機字串，匯入／匯出資料用
   - `GOOGLE_MAPS_SERVER_KEY`：選填，Google 路線與地點搜尋
4. Google Cloud Console → 瀏覽器金鑰 → HTTP referrer 加上 `https://hokkaido-collab-trip.<你的子網域>.workers.dev/*`

## 從 Railway 搬資料

Production 不會自動建立種子行程；匯入前，行程相關 API 都會回「行程資料尚未匯入」。

1. 從 Railway 下載 `state.json` 與 `users.json`（volume 或 bucket 的備份都可以）。**不要放進 git。**
2. 匯入：
   ```bash
   cd worker
   ADMIN_TOKEN=<剛設的值> node scripts/import.mjs https://hokkaido-collab-trip.<子網域>.workers.dev state.json users.json
   ```
   已經匯入過還要覆蓋時，最後加上 `--force`。
3. 打開網站，用原本的帳號密碼登入確認。

隨時備份：`ADMIN_TOKEN=... node scripts/export.mjs <網址> backups/2027-02-01`

## 檢查外部資料來源

打開 `https://<網址>/api/sources`，會從 Cloudflare 對每個來源各打一次，回傳狀態與回應時間：

- 匯率：Yahoo Finance `JPYTWD=X`
- 天氣：Open-Meteo
- 警報：氣象廳 `extra.xml`
- JR 北海道：`top_tc.json`
- 路線：OSRM 公開服務

任何一項 `ok: false`，畫面上原本的失敗提示都會照常顯示（沿用上一次成功的匯率、JR 官方連結），不會讓網站壞掉。

## 免費方案注意事項

- Workers 免費方案：每天 10 萬個請求；Durable Objects 免費方案也夠一群朋友用
- 密碼比對（bcrypt）在 Durable Object 裡跑，Durable Object 的 CPU 上限比一般 Worker 寬，舊的 bcrypt 雜湊可以直接沿用
