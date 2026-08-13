# Arknights Global Gacha Analyze / 明日方舟悠星服尋訪紀錄分析 (Node.js & Firebase Edition)

## Features / 功能

* **Modern Serverless Architecture**: Deployed on Firebase Functions (2nd Gen) and Firebase Hosting, providing excellent scalability and extremely low maintenance costs.
* **現代化無伺服器架構**: 使用 Firebase Functions (2nd Gen) 與 Firebase Hosting，提供極佳的擴展性與極低的維護成本。

* **Database Integration**: Uses Firebase Firestore to securely store user gacha records.
* **資料庫整合**: 使用 Firebase Firestore 安全儲存用戶的抽卡紀錄。

* **Dynamic Frontend**: Utilizes the EJS template engine for real-time frontend rendering with Chart.js, supporting responsive layouts for both mobile and desktop.
* **動態前端介面**: 採用 EJS 模板引擎，並使用前端即時渲染的 Chart.js，支援手機與電腦的響應式 (Responsive) 排版。

* **Multilingual with Path-based URLs**: Traditional Chinese, Simplified Chinese, Japanese and English, each served from its own URL (`/zh-tw/`, `/zh-cn/`, `/ja-jp/`, `/en-us/`) with per-page `canonical`, `hreflang` and a generated `sitemap.xml`, so search engines index every language version distinctly. Any browser language outside these falls back to English.
* **多語系與路徑式網址**: 支援繁體中文、簡體中文、日文與英文，每個語系擁有獨立網址 (`/zh-tw/`、`/zh-cn/`、`/ja-jp/`、`/en-us/`)，並各自產生 `canonical`、`hreflang` 與 `sitemap.xml`，讓搜尋引擎能正確索引各語言版本。上述以外的瀏覽器語言一律使用英文。

* **Enhanced Analytics**: Advanced analysis interface supporting layered collapsing of consecutive pull histories, "pity" accumulation statistics across gacha pools, and complete export functionality.
* **進階資料分析**: 更進階的分析介面，支援連續抽出歷史的分層折疊、跨卡池的「已墊」累積抽數統計，以及完整的匯出 (Export) 功能。

* **Extension Ecosystem**: Fully integrated with the developed Chromium extension "One-Click Token Extractor", perfectly solving the high-barrier process of manually opening F12 developer tools to copy data.
* **擴充功能生態**: 完全整合開發的 Chromium 擴充功能「一鍵截取 Token」，完美解決必須手動開啟 F12 開發者工具複製資料的高門檻流程。

* **Security & Cost Control**: Implements `express-rate-limit` to defend against abnormal traffic, and sets the maximum server execution instances (`maxInstances`), ensuring no extra paid quota is consumed under the Blaze billing plan.
* **安全與成本控制**: 實裝 `express-rate-limit` 防禦異常流量，並設定伺服器最高執行實例 (`maxInstances`)，保障 Blaze 計費方案下不花費任何額外的付費額度。

---

## Prerequisites / 前置需求

Before setting up, please ensure your system has the following environments and tools installed:
在開始架設之前，請確保您的系統已安裝下列環境與工具：

* **Node.js** (version >= 22 / 版本 >= 22)
* **npm** (usually included with Node.js / 通常隨附於 Node.js)
* **Firebase CLI** (`npm install -g firebase-tools`)
* A Google account with Firebase enabled and Firestore database permissions activated (requires switching the project to the Blaze plan).
* 已開通 Firebase 並啟用 Firestore 資料庫權限的 Google 帳號 (須將專案切換至 Blaze 方案)。

---

## Usage / 使用方法

### 1. Downloading Copyrighted Assets / 取得版權資產

Based on copyright protection principles, the repository of this project **does not directly contain any official artwork, fonts, or original CSS**. After cloning this project for the first time, you **must first execute the copyright asset fetch script**.
The script will automatically go to the official server to fetch all necessary public static resources and synthesize patches locally.

基於版權保護原則，本專案的儲存庫中**未直接包含任何官方美術圖片、字體與原始 CSS**。當您首次複製此專案後，**必須先執行版權資產抓取腳本**。
腳本會自動前往官方伺服器抓取所有所需的公開靜態資源，並在當地合成補丁。

```bash
# Execute this script in the root directory of the project
# 在專案根目錄中執行此腳本
bash asset_download.sh
```

> **Note:** After successful execution, you will see the complete `your.css`, `assets/images`, and `assets/fonts` folders automatically generated under `public/css/`, and you can begin development or deployment.
> **注意：** 執行完成後，您會看到 `public/css/` 底下自動長出完整的 `your.css`、`assets/images` 和 `assets/fonts` 資料夾，即可開始進行開發或部署。

### 2. Install Dependencies / 安裝依賴庫

Server-side code is enclosed in the `functions/` folder. Please ensure you have installed these Node modules.

伺服器端代碼被封裝在 `functions/` 資料夾下，請確保您安裝了這些 Node 模組。

```bash
cd functions
npm install
cd ..
```

### 3. Local Emulator Testing / 本地端模擬與測試

If you need to develop or preview locally, Firebase provides a very convenient emulator feature.

如果您需要開發或是進行本地預覽，Firebase 提供了非常方便的模擬器功能。

```bash
# Ensure you are in the Firebase-arknightsgacha root directory
# 請確保您位於 Firebase-arknightsgacha 根目錄
firebase emulators:start --only functions,hosting
```

After startup, open the local URL provided by the terminal in your browser (usually `http://localhost:5000` or `http://127.0.0.1:5000`) to test all connections and rendering results at any time.

啟動完畢後，在瀏覽器打開終端機提示的本機網址 (通常為 `http://localhost:5000` 或 `http://127.0.0.1:5000`) 即可隨時測試所有連線與渲染結果。

To preview a specific language, go straight to its path, e.g. `/ja-jp/login` or `/zh-tw/privacy`.

若要預覽特定語系，請直接使用該語系的路徑，例如 `/ja-jp/login` 或 `/zh-tw/privacy`。

### 3.1 Checking the Locale Files / 檢查語系檔

After editing anything under `functions/locales/`, run the locale linter. It verifies that all four languages share the same key set, that strings rendered escaped contain no HTML, and that no translation has silently dropped links, list items or whole clauses relative to the Traditional Chinese source.

修改 `functions/locales/` 底下的任何檔案後，請執行語系檢查工具。它會驗證四種語言的鍵集合是否一致、被跳脫渲染的字串是否誤含 HTML，以及是否有翻譯相對繁體中文原文漏掉了連結、列舉項目或整段條款。

```bash
node functions/lint-locales.js
# 讓警告也視為失敗 / treat warnings as failures too
node functions/lint-locales.js --strict
```

### 4. Deployment / 雲端部署

When all tests are confirmed green, simply run a single command to push the full stack to Google Cloud for official operation.

當所有的測試都確認綠燈，只需一行指令即可把全端推上 Google Cloud 進行正式營運。

```bash
# Default deployment region is us-west1 (Oregon)
# 預設部署區域為 us-west1 (奧勒岡)
firebase deploy
```

If you later only modify the frontend interface (ejs, css) and want to speed up the deployment process, you can add parameters to specify the deployment target.

若您後續僅修改前端介面 (ejs, css)，想要加速部署流程，您可以加上參數指定部署部位。

```bash
firebase deploy --only hosting
```

---

## Disclaimer & Copyright / 免責與版權聲明

1. This project is not affiliated with, endorsed by, or authorized by the game's developers or publishers (including but not limited to Hypergryph, Longcheng, Ariel, Yostar, or Studio Montagne).
1. 本專案與遊戲開發商或發行商（包括但不限於鷹角網路、龍成網路、艾瑞爾網路、悠星網路或蒙塔山工作室）無任何關聯，也未經其授權。

2. Use this project entirely at your own risk. The author does not guarantee that using this project won't violate any terms of service or local laws, nor does the author guarantee protection against data leaks or provide any implied warranties. The author shall not be held liable for any damages or losses resulting from the use of this project.
2. 任何使用本專案的人士，須自行承擔一切風險，專案作者不保證使用本專案不會違反任何機構的使用條款或任何地區的法律規範，專案作者不保證使用本專案不會造成任何個人資料的洩漏，專案作者不會負責任何因使用本專案而引致之損失，專案作者不會作出任何默示的擔保。

3. The original source code of this project is licensed under the MIT License. However, all in-game assets, concepts, and intellectual properties associated with "Arknights" are strictly for personal and academic research. Any commercial use or resale utilizing the "Arknights" IP is strictly prohibited. Users engaging in such infringing behavior will bear full legal responsibility.
3. 本專案的原創底層程式碼採 MIT 授權開源。但專案內包含或擷取的任何「明日方舟」相關資源、介面與概念，僅供學術與個人研究，**嚴禁將本專案基於明日方舟的型態進行任何商業用途或轉售**。任何侵犯版權的商業行為須由使用者自行負擔完全之法律責任。

4. All in-game images, animations, audio, original text, styles, patterns, and selected layout designs used within the project are solely for the purpose of better presenting game data. The copyrights of these assets belong to Shanghai Hypergryph Network Technology Co., Ltd., Longcheng Network Co., Ltd., Ariel Co., Limited, Yostar Limited., GRYPH FRONTIER PTE. LTD., or their affiliated companies.
4. 專案內使用的遊戲圖片、動畫、音訊、文字原文、風格、樣式與部分版面設計，僅用於更好地表現遊戲資料，其版權屬於上海鷹角網路科技有限公司、龍成網路有限公司、艾瑞爾網路股份有限公司、上海悠星網路科技有限公司、GRYPH FRONTIER PTE. LTD 或以上之關聯公司。
