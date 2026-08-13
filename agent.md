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
  - 已實裝完整的 i18n 多國語系架構（`zh-tw`, `zh-cn`, `ja-jp`, `en-us`），並改為**路徑式語系網址**（`/en-us/login`）。
  - 已完成 SEO 最佳化（每頁各自的 canonical/hreflang、JSON-LD、Open Graph、`/sitemap.xml`）。
  - 英日文文案已依繁中原文補齊被刪減的條款與列舉；卡池專有名詞改用四服官方客戶端字串。
  - 新增 `functions/lint-locales.js` 作為語系檔的回歸防護。
  - 修正了 `mergeLogs` 造成的紀錄重複問題，並確保了時間排序與保底計算邏輯的一致性。

## 🏗️ Architecture & Core Concepts (架構與核心概念)

### 核心目錄與職責
- `functions/index.js`：應用的核心進入點。處理 Express 路由配置、語系偵測中介軟體（i18n Middleware）、Firestore 存取、以及負責接收來自外部應用同步的 `/login` (POST) 邏輯。
- `functions/utils.js`：核心業務邏輯的集散地。
  - `fetchAllLogsSlowly()`：向悠星伺服器緩慢發送請求以獲取玩家尋訪紀錄（防封控機制）。
  - `mergeLogs(records, previousRecords)`：將剛抓取的紀錄與資料庫內既有的紀錄合併。
  - `analyzeLogs(logs)`：處理抽數累計（Pity accumulation）、星級統計與分類卡池邏輯。
- `functions/locales/*.json`：多語系字串對應表。**`zh-tw.json` 是準據版本**，其餘語言以它為基準補齊；`zh-cn.json` 基本上是它的繁→簡轉換。
- `functions/views/*.ejs`：視覺化介面（包含 `login.ejs`, `index.ejs`, `privacy.ejs`）。
- `functions/views/partials/`：
  - `seo-head.ejs`：canonical / hreflang / JSON-LD / OG 標籤，全部由 `origin` + `lang` + `page` 推導。
  - `lang-switcher.ejs`：語言選單（`<select>` 加上真實 `<a>` 連結供爬蟲使用）。
  - 抽成 partial 的原因：這兩塊原本在三個 view 裡各複製一份，正是 JSON-LD 網址被寫死成首頁的原因。
- `functions/lint-locales.js`：語系檔檢查工具（見下方開發指南）。
- `functions/create_locales.js`：**已棄用**，請勿執行。語系 JSON 已改為手動維護，跑它會覆蓋掉現有內容並遺失鍵。

### 關鍵設計決策 (Architecture Decisions)
- **路徑式語系網址 (Path-based locale URLs)**：所有可被索引的頁面都放在語系前綴底下（`/zh-tw/`、`/zh-cn/`、`/en-us/`、`/ja-jp/`），例如 `/ja-jp/privacy`。每個語系版本因此擁有各自穩定、唯一的網址，`canonical` 與 `hreflang` 才能正確指向。舊的 `?lang=xx` 網址會以 **301** 永久轉向對應的新路徑；而無語系前綴的 `/`、`/login`、`/privacy` 則以 **302** 依訪客的 cookie / `Accept-Language` 導向其語系版本——這裡刻意不用 301，因為目標語系會隨訪客而異，用 301 會讓瀏覽器永久快取單一語系，也會妨礙搜尋引擎探索其他語言版本。
- **預設語言為英文 (English by default)**：語系判定順序為 **網址路徑前綴 → 表單 body 的 `lang` → `lang` cookie → `Accept-Language` → `en-us`**。中文（`zh-tw`/`zh-cn`）、日文（`ja-jp`）、英文（`en-us`）之外的任何瀏覽器語言（韓文、法文、德文…）一律使用英文。此規則由 `functions/index.js` 的 `DEFAULT_LOCALE` 常數統一定義，且必須是所有 fallback 的終點——包含 `res.locals.t()` 找不到翻譯鍵時的退路（**絕對不可退回 `zh-tw`**，否則英日文頁面會被塞進繁體中文字串）。
- **[CRITICAL] Firebase Hosting 會吃掉 `lang` cookie**：Hosting 在把請求轉給 Function 前，會**移除 `__session` 以外的所有 cookie**。因此 `req.cookies.lang` 在正式環境永遠是 `undefined`（本地模擬器不會複製這個行為，所以本機測試看起來是正常的，別被騙了）。這也是為什麼 `POST /login` 必須靠**表單裡的 hidden `lang` 欄位**帶語系——否則使用者登入後會被丟回瀏覽器語言，而不是他自己選的語言。三個登入表單（cookie / existing / upload）都已帶上此欄位；外部 App 與擴充功能不帶，會沿用 `Accept-Language` 的舊行為（可接受）。
- **語系合法性一律用 `isLocale()`**：不要用 `locales[x]` 判斷語系是否有效——那會把 `constructor`、`toString` 等原型鏈上的名稱誤判為合法語系。
- **[CRITICAL] 對外網址一律用 `CANONICAL_ORIGIN`，絕不可用 `req.get('host')`**：Firebase Hosting 在把請求轉給函式前，會把 `Host` 改寫成 Cloud Run 服務網址，因此正式環境的 `req.get('host')` 永遠是 `app-xxxx.a.run.app`，**拿不到真正的網域**。凡是要對外宣告站台身分的東西（`canonical`、`hreflang`、`og:url`、JSON-LD `url`、`sitemap.xml`）都必須經由 `resolveOrigin()` 取得，否則等於在告訴 Google「這頁的正版在 run.app」，會把正式網域的排名讓出去。此問題曾實際發生於線上。
  - **本機完全看不出來**：模擬器會原封不動傳遞真實 Host，所以本機所有測試都會通過。要驗證請用非本機的 Host 打 functions 模擬器：`curl -s -H "Host: app-test.a.run.app" http://127.0.0.1:5001/arknights-gacha/us-central1/app/ja-jp/privacy | grep canonical`，輸出必須是正式網域。
  - 若日後掛上自訂網域，設定環境變數 `CANONICAL_ORIGIN` 覆寫即可，不必改程式碼。
  - **不能只依 `Host` 做 noindex 或轉址**：經由 Hosting 的正常流量與直接打 `run.app` 的流量，兩者的 `Host` 完全一樣，只看 `Host` 去封鎖會把正式站一起弄掛。
  - 但**若真的需要區分**，可以用 `x-forwarded-host`——Hosting 會送這個標頭，直連 `run.app` 則沒有。（先前此處曾寫「無法區分」，那是錯的。）目前不採用：寫死 `CANONICAL_ORIGIN` 已經讓 `run.app` 的頁面吐出指向正式網域的 canonical，重複內容會自行收斂，而且寫死比信任請求標頭更能防 Host 注入。
- **[CRITICAL] `x-orig-accept-language` 必須還原，不可刪除**：Firebase Hosting 的 CDN 會把 `Accept-Language` 正規化成基礎語言碼（`zh-TW` → `zh`），**但會把原始值保留在 `x-orig-accept-language`**。`detectLocaleFromHeaders()` 必須在解析語言前先把它還原回 `accept-language`，否則繁中與簡中完全無法區分，**所有中文訪客都會被送到 `/zh-cn/`**。
  - 這個標頭是 **Hosting 送進來的入站標頭**，應用程式端不會、也不該設定它。
  - **曾經出過事**：有人 grep 整個 repo 找「誰設定這個標頭」，找不到就當成死碼刪掉，導致上述迴歸。**判斷一個標頭有沒有用，要看正式環境「收到什麼」，不是看 repo 裡「誰設定它」。**
  - **本機測不出來**：模擬器不送這個標頭，而是直接原封不動傳遞 `Accept-Language`，所以本機所有語系測試都會通過。要驗證只能部署後打正式網域：
    `curl -s -o /dev/null -D- -H "Accept-Language: zh-TW" https://arknights-gacha.web.app/ | grep -i location` → 必須是 `/zh-tw/`。
  - 診斷小技巧：用程式碼未處理的地區碼（如 `zh-MO`）當對照——經 Hosting 若得到 `/zh-cn/` 就代表地區碼已遺失，若得到 `/en-us/` 則代表原始標頭有正確還原。
- **Firestore 儲存格式**：抽卡紀錄可能高達數萬筆，為了節省 Firestore Document 儲存的陣列開銷與傳輸限制，我們將紀錄序列化為字串（`JSON.stringify`）存在 `jsonString` 欄位中。

## 🚦 Development Guidelines (開發與上手指南)

1. **本地測試環境**：
   - 請使用 `firebase emulators:start --only functions,hosting` 啟動本地模擬器。
   - 注意：若 `functions` 啟動出現 timeout 或載入錯誤，請確認本機 Node.js 版本（目前專案 package.json 設定為 Node 22/24，但 SDK 較舊，有時需忽略特定警告）。
2. **語系測試**：
   - 直接走路徑：`/zh-tw/login`、`/ja-jp/privacy`。（舊的 `?lang=xx` 仍可用，但會 **301** 轉到對應路徑，已不適合拿來測試。）
   - 測預設語言：`curl -I -H 'Accept-Language: ko-KR' http://localhost:5000/`，應 302 到 `/en-us/`。
   - 更改語系設定檔後，必須重啟模擬器或確保快取未干擾。
3. **語系檔檢查（每次改 `locales/*.json` 後都要跑）**：
   - `node functions/lint-locales.js`，`--strict` 會讓警告也回傳非零。
   - 檢查項目：四語鍵集合是否一致、被跳脫渲染（`<%=`）的鍵是否誤含 HTML、`main_heading` 是否含會破壞 JSON-LD 的字元、相對 `zh-tw` 是否掉了 `<a>`／`<br>`／`<strong>`／`<code>`／項目符號、文案長度比是否過短（疑似漏譯）、以及未被引用的鍵。
   - 「被跳脫 vs 原始渲染」的鍵清單是**在執行時掃描 `.ejs` 產生**的，不是寫死的，所以不會和 view 脫節。
4. **擴充功能/App 測試**：
   - 透過發送 POST 到 `/login` 並帶上 `method=app_sync`，可模擬擴充功能直接推送抽卡紀錄到資料庫的行為。
   - `POST /login` 是**不帶語系前綴**的，外部 client 硬寫的 `https://arknights-gacha.web.app/login` 仍然有效，改動路由時**不要動到它**。

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
5. **[CRITICAL] 每個 `res.render()` 都必須傳 `page`**
   - `seo-head.ejs` 與 `lang-switcher.ejs` 會取用 `page`（`''` / `'login'` / `'privacy'`）來組出 canonical 與各語系連結。少傳會直接 throw，整頁 500。
   - 中介軟體已設 `res.locals.page = ''` 當安全網（render options 會覆蓋它），但**新增 render 時仍請明確傳值**，否則 canonical 會指錯頁。
6. **兩種轉向的狀態碼不一樣，別寫混了**
   - 舊 `?lang=xx` → 新路徑用 **301**（固定 1:1，要把索引權重收斂過去）。
   - 無前綴的 `/`、`/login`、`/privacy` → 語系版本用 **302**（目標隨訪客而異，用 301 會被瀏覽器永久快取成單一語系）。
   - `res.redirect()` 預設是 302，很容易漏寫 301。改完請用 `curl -I` 逐一確認。
   - 舊網址轉向中介軟體**只處理 GET**：對 POST 發 301 會讓瀏覽器改用 GET 重送並丟掉 body，擴充功能與 App 上傳的抽卡紀錄會直接消失。
7. **`firebase deploy` 會刪掉 `functions/node_modules`**
   - `firebase.json` 的 `postdeploy` 設了 `rm -rf "$RESOURCE_DIR/node_modules"`。部署完再跑模擬器會出現 `Cannot find module 'firebase-functions'`，此時先 `cd functions && npm install` 即可。
8. **不要用 `perl -0pi -e` 對 `.ejs` 做含 `${...}` 的取代**
   - 曾因此炸過：在雙引號 shell 字串裡，perl 會把 `${item.poolId}` 當成變數插值（`\Q...\E` 擋不住），pattern 塌成只剩後半段，於是四個位置全被替換、還多插了一次 `${item.poolId}`。結果是頁面直接顯示 `${...}` 原始字串。
   - 請改用 Edit 工具或 Node 腳本處理這類取代。
