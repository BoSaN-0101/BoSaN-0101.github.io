// 畫面也要用的名稱對照（獨立一個檔案，免得畫面把整套檢查邏輯打包進去）。

import type { Severity } from './linters.ts';

export const SEVERITY_NAMES: Record<Severity, string> = { error: '錯誤', warning: '警告', performance: '效能', portability: '可攜性', style: '風格', information: '資訊' };
