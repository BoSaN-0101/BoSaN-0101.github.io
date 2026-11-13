# 賽博宮

把台灣民俗儀式套進寫程式日常的 Windows 桌面 App（Electron + TypeScript）。

目前進度：**M1**（擲筊引擎、功過簿、主殿畫面、系統匣常駐）。

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

## 開發

| 指令 | 作用 |
|---|---|
| `npm test` | 核心邏輯測試（擲筊機率、功過簿竄改偵測、懺悔文比對） |
| `npm run typecheck` | 型別檢查 |
| `npm run build` | 打包到 `dist/` |

程式碼分成 `src/core`（不碰畫面的邏輯）、`src/main`（Electron 主程序、系統匣）、`src/renderer`（主殿畫面）。
