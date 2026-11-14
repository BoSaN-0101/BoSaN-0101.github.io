// 中元普渡：找出可以超渡的程式。這裡只做判斷，不動手；真的結束程式前一定先給使用者勾選確認。

export interface Proc {
  pid: number;
  name: string;
  path: string | null;
  mySession: boolean; // 和使用者同一個登入工作階段
  hasWindow: boolean;
  title: string;
  responding: boolean;
  start: string | null; // ISO 8601
  cpu: number | null; // 累計用掉的 CPU 秒數
  service: boolean; // 是系統服務
}

export type GhostKind = 'hung' | 'lingering';

export interface Ghost {
  pid: number;
  name: string;
  path: string;
  title: string;
  kind: GhostKind;
  start: string | null;
  hours: number; // 已經跑了幾小時
  cpu: number;
}

export interface PuduContext {
  now: Date;
  systemRoot: string; // 例如 C:\Windows
  selfPids: number[];
  selfPath: string;
  whitelist: string[]; // 使用者設定的白名單（程式名稱，不分大小寫，可省略 .exe）
}

export const LINGER_MIN_HOURS = 2;
/** 平均 CPU 使用率低於這個比例才算「幾乎不用 CPU」。 */
export const LINGER_MAX_CPU_RATIO = 0.0005;

const ANTIVIRUS_NAME =
  /^(msmpeng|nissrv|mpcmdrun|mpdefendercoreservice|securityhealth\w*|smartscreen|avp\w*|avast\w*|avg\w*|afwserv|mbam\w*|ekrn|egui|bdagent|bdservicehost|vsserv|mcshield|mfe\w+|mcuicnt|nortonsecurity|ccsvchst|savservice|sophos\w*|hmpalert|cylancesvc|csfalcon\w*|sentinel\w*|coreserviceshell|pccntmon|ntrtscan|tmlisten|360tray|360sd|zhudongfangyu|k7\w+|fsav\w*|fshoster\w*|wrsa|carbonblack\w*|psanhost)$/i;
const ANTIVIRUS_PATH =
  /[\\/](windows defender|avast|avg|kaspersky\w*|eset|bitdefender|mcafee|norton\w*|symantec|sophos|malwarebytes|trend micro|crowdstrike|sentinelone|f-secure|webroot|panda security|360\w*)[\\/]/i;
const ALWAYS_KEEP = /^(system|idle|registry|memory compression|explorer|dwm|csrss|winlogon|wininit|services|lsass|smss|svchost|fontdrvhost|sihost|taskhostw|ctfmon|conhost|searchhost|startmenuexperiencehost|shellexperiencehost|runtimebroker|textinputhost)$/i;

const bare = (name: string) => name.toLowerCase().replace(/\.exe$/, '');
const under = (path: string, root: string) => {
  const p = path.toLowerCase().replace(/\//g, '\\');
  const r = root.toLowerCase().replace(/\//g, '\\').replace(/\\+$/, '');
  return !!r && (p === r || p.startsWith(r + '\\'));
};

/** 永遠排除：系統程式、系統服務、防毒軟體、賽博宮自己、白名單。回傳排除原因，可以超渡就回傳 null。 */
export function exclusionReason(p: Proc, ctx: PuduContext): string | null {
  if (ctx.selfPids.includes(p.pid)) return '賽博宮自己';
  if (!p.path) return '查不到位置（多半是系統程式）';
  if (p.path.toLowerCase() === ctx.selfPath.toLowerCase()) return '賽博宮自己';
  if (!p.mySession) return '不是你啟動的';
  if (p.service) return '系統服務';
  if (under(p.path, ctx.systemRoot)) return '系統程式';
  if (ALWAYS_KEEP.test(bare(p.name))) return '系統程式';
  if (ANTIVIRUS_NAME.test(bare(p.name)) || ANTIVIRUS_PATH.test(p.path)) return '防毒軟體';
  if (ctx.whitelist.some((w) => bare(w) === bare(p.name))) return '白名單';
  return null;
}

export function findGhosts(procs: Proc[], ctx: PuduContext): Ghost[] {
  const out: Ghost[] = [];
  for (const p of procs) {
    if (exclusionReason(p, ctx)) continue;
    const startMs = p.start ? new Date(p.start).getTime() : NaN;
    const hours = Number.isNaN(startMs) ? 0 : (ctx.now.getTime() - startMs) / 3600000;
    const base = { pid: p.pid, name: p.name, path: p.path!, title: p.title, start: p.start, hours: Math.round(hours * 10) / 10, cpu: p.cpu ?? 0 };
    if (p.hasWindow && !p.responding) {
      out.push({ ...base, kind: 'hung' });
    } else if (!p.hasWindow && p.cpu !== null && hours >= LINGER_MIN_HOURS && p.cpu / (hours * 3600) < LINGER_MAX_CPU_RATIO) {
      out.push({ ...base, kind: 'lingering' });
    }
  }
  return out.sort((a, b) => (a.kind === b.kind ? b.hours - a.hours : a.kind === 'hung' ? -1 : 1));
}

export function parseWhitelist(text: string): string[] {
  return text.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
}
