# Arknights Global Gacha Analyzer - Agent Context

這份文件旨在協助後續接手的 AI Agent 或開發人員快速理解 `Firebase-global-arknightsgacha` 的專案架構、開發環境與注意事項。在進行任何程式碼修改前，請務必先閱讀此文件以確保上下文的連貫性。

## 📌 Project Overview & Context (專案概述與當前上下文)

- **核心目標**：提供明日方舟國際服（包含 EN, JP, KR, TW 等悠星/外服）玩家匯出、儲存與視覺化分析遊戲內尋訪（抽卡）紀錄的開源 Web 工具。支援從官方 API 抓取資料或透過 App/擴充功能上傳（App Sync）。
- **技術棧 (Tech Stack)**：
  - **後端**：Node.js + Express.js 運行於 Firebase Cloud Functions。
  - **前端**：EJS 模板引擎渲染 HTML、純 CSS (Vanilla)、Chart.js (圓餅圖)。
  - **資料庫**：Firebase Firestore（以使用者的遊戲 UID 作為主鍵）。
  - **託管**：Firebase Hosting（負責 CDN 與請求轉發至 Functions）。
- **當前系統狀態**：
  - 已實裝完整的 i18n 多國語系架構（`zh-tw`, `zh-cn`, `ja-jp`, `en-us`）。
  - 已完成 SEO 最佳化（JSON-LD 結構化資料、Open Graph 標籤、統一的 `<title>` 格式）。
  - 修正了 `mergeLogs` 造成的紀錄重複問題，並確保了時間排序與保底計算邏輯的一致性。

## 🏗️ Architecture & Core Concepts (架構與核心概念)

### 核心目錄與職責
- `functions/index.js`：應用的核心進入點。處理 Express 路由配置、語系偵測中介軟體（i18n Middleware）、Firestore 存取、以及負責接收來自外部應用同步的 `/login` (POST) 邏輯。
- `functions/utils.js`：核心業務邏輯的集散地。
  - `fetchAllLogsSlowly()`：向悠星伺服器緩慢發送請求以獲取玩家尋訪紀錄（防封控機制）。
  - `mergeLogs(records, previousRecords)`：將剛抓取的紀錄與資料庫內既有的紀錄合併。
  - `analyzeLogs(logs)`：處理抽數累計（Pity accumulation）、星級統計與分類卡池邏輯。
- `functions/locales/*.json`：多語系字串對應表。
- `functions/views/*.ejs`：視覺化介面（包含 `login.ejs`, `index.ejs`, `privacy.ejs`）。

### 關鍵設計決策 (Architecture Decisions)
- **多語系偵測機制**：由於 Firebase Hosting 的 CDN 會自動過濾或正規化 `Accept-Language` 標頭（導致台灣用戶可能被錯誤導向簡體中文），因此我們採用讀取 `x-orig-accept-language` 標頭的策略來獲取瀏覽器原始語言。
- **Firestore 儲存格式**：抽卡紀錄可能高達數萬筆，為了節省 Firestore Document 儲存的陣列開銷與傳輸限制，我們將紀錄序列化為字串（`JSON.stringify`）存在 `jsonString` 欄位中。

## 🚦 Development Guidelines (開發與上手指南)

1. **本地測試環境**：
   - 請使用 `firebase emulators:start --only functions,hosting` 啟動本地模擬器。
   - 注意：若 `functions` 啟動出現 timeout 或載入錯誤，請確認本機 Node.js 版本（目前專案 package.json 設定為 Node 22/24，但 SDK 較舊，有時需忽略特定警告）。
2. **語系測試**：
   - 可在 URL 後方加上 `?lang=zh-tw`、`?lang=ja-jp` 強制切換語系。
   - 更改語系設定檔後，必須重啟模擬器或確保快取未干擾。
3. **擴充功能/App 測試**：
   - 透過發送 POST 到 `/login` 並帶上 `method=app_sync`，可模擬擴充功能直接推送抽卡紀錄到資料庫的行為。

## ⚠️ Trade-offs & Pitfalls (權衡取捨與已知陷阱)

### 已知的坑與絕對限制 (Constraints)
1. **[CRITICAL] 排序邏輯陷阱 (`mergeLogs` & `analyzeLogs`)**
   - 官方 API 預設回傳的資料順序為**「由新到舊」（Descending, `b.at - a.at`）**。
   - **絕對不要將 `logs` 排序為 Ascending（由舊到新）！** `mergeLogs` 內部的雙指標演算法強烈依賴 `records` 與 `previousRecords` 都是從最新的項目（Index 0）開始對齊。如果順序相反，會導致無法匹配對齊點，進而引發大規模的紀錄重複合併。
   - 抽數保底計算的 `analyzeLogs` 內部會先對 `logs` 執行 `reverse()` 進行計算，結束後再 `reverse()` 回來以符合 UI 預期的「由新到舊」展示。
2. **Chart.js 與 HTML 迴圈的 Index 對齊**
   - 在 `index.ejs` 底部渲染圓餅圖時，JavaScript 定義的 `categories` 陣列必須與 HTML 區塊中定義的 `categories` 陣列長度及元素順序**完全一致**。曾經因為 JS 中多留了一個「所有卡池」，導致 Canvas 綁定錯位。
3. **雲端函數逾時與限制**
   - `fetchAllLogsSlowly` 刻意在迴圈中加入了 200ms 的延遲 (`sleep(200)`)，這是為了防止觸發悠星 (Yostar) 伺服器的 Rate Limit。這導致大帳號首次抓取時可能耗時 30~60 秒，因此前端必須要有 Load 畫面，且 Firebase Functions 必須給予充足的 Timeout 設置與實例數量 (`maxInstances: 10`)。
4. **Firebase SDK 升級的技術債**
   - 目前使用的 `firebase-functions` SDK 是 `4.9.0`，如果後續升級至 `>=5.1.0`，Express Middleware 的行為或 Node 運行環境可能會發生 Breaking Changes，升級時必須進行完整的登入與抓取測試。
