# 賽博宮

把台灣民俗儀式套進寫程式日常的 Windows 桌面 App（Electron + TypeScript）。

目前進度：**M2**（M1 的擲筊引擎、功過簿、主殿、系統匣，加上擲筊 push 與農民曆宜忌）。

## 在 Windows 上試用

需要先裝 [Node.js](https://nodejs.org/) 22 以上。

```
cd saibo-gong
npm install
npm start
```

- 關掉視窗只是收進系統匣（右下角）；要真正結束，在系統匣圖示按右鍵選「離開」。
- 資料存在 `%APPDATA%\DigitalTemple\`：`ledger.jsonl`（功過簿）、`ledger.head.json`（封印）、`stats.json`（擲筊統計）、`settings.json`。
- 想試又不想弄髒正式的功過簿，可以先設環境變數 `SAIBO_DATA_DIR` 指到別的資料夾再啟動。

## 擲筊 push

在主殿的「擲筊 push」卡片安裝：

- **為某個 repo 安裝**：只在那個 repo 的 `.git/hooks` 放一個 `pre-push`。repo 已經有別的 pre-push hook 時不會蓋掉它。
- **全域安裝**：把 git 的全域設定 `core.hooksPath` 指到 `%APPDATA%\DigitalTemple\hooks`，所有 repo 都生效；各 repo 原有的 hook 會被轉交執行。

之後 `git push` 會先叫出主殿：

1. 當天忌開市、而且是正式上線（push 到受保護的分支，預設 `main`、`master`；或任何 tag）→ 直接擋，可打懺悔文硬闖。
2. 接著擲筊，三次為限。聖筊放行；擲不到可以硬闖（懺悔文，記入功過簿）或作罷（push 取消）。

主殿沒開時 hook 會自己把它叫起來；等不到回應就放行，並在功過簿記一筆「神明不在」。閉廟時一律直接放行。

想模擬忌開市的日子，啟動前設環境變數 `SAIBO_FAKE_DATE`，例如 `2026-11-14`。

## 開發

| 指令 | 作用 |
|---|---|
| `npm test` | 核心邏輯測試（擲筊機率、功過簿竄改偵測、懺悔文比對、農民曆、push 判斷） |
| `npm run typecheck` | 型別檢查 |
| `npm run build` | 打包到 `dist/` |

程式碼分成 `src/core`（不碰畫面的邏輯）、`src/main`（Electron 主程序、系統匣、git hook 用的小程式）、`src/renderer`（主殿畫面）。

農民曆使用 [lunar-javascript](https://github.com/6tail/lunar-javascript)（MIT 授權），完全離線計算。
