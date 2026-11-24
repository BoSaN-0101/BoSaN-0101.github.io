// 陰間回收筒：把檔案「燒」進 App 管理的資料夾，之後可以請回陽間。
// 原則：絕不永久刪除；還陽一定要成功（原位置不能用就換地方放）。

import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, parse, resolve, sep } from 'node:path';

export interface Soul {
  id: string;
  name: string;
  originalPath: string;
  burnedAt: string; // ISO 8601
  isDir: boolean;
  size: number; // 位元組（資料夾為 0）
}

export interface UnderworldOptions {
  dir: string; // 陰間資料夾
  fallbackDir: string; // 原位置回不去時，還陽到這裡
  protectedDirs?: string[]; // 不准燒的地方（系統資料夾、App 自己的資料）
}

const norm = (p: string) => {
  const r = resolve(p);
  return process.platform === 'win32' ? r.toLowerCase() : r;
};
const within = (child: string, parent: string) => {
  const c = norm(child);
  const p = norm(parent);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
};

/** 搬移；跨磁碟不能直接改名時，先完整複製、確認在了再移除原本的。 */
function move(src: string, dst: string): void {
  mkdirSync(dirname(dst), { recursive: true });
  try {
    renameSync(src, dst);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'EACCES') throw e;
    cpSync(src, dst, { recursive: true, preserveTimestamps: true, errorOnExist: true, force: false });
    if (!existsSync(dst)) throw new Error('複製失敗');
    rmSync(src, { recursive: true });
  }
}

export class Underworld {
  private readonly opt: UnderworldOptions;
  private readonly indexFile: string;

  constructor(opt: UnderworldOptions) {
    this.opt = opt;
    this.indexFile = join(opt.dir, 'index.json');
  }

  list(): Soul[] {
    try {
      const list = JSON.parse(readFileSync(this.indexFile, 'utf8')) as Soul[];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  private save(list: Soul[]): void {
    mkdirSync(this.opt.dir, { recursive: true });
    const tmp = this.indexFile + '.tmp';
    writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
    renameSync(tmp, this.indexFile);
  }

  pathOf(soul: Soul): string {
    return join(this.opt.dir, 'items', soul.id, soul.name);
  }

  /** 檢查能不能燒；不能的話回傳原因。 */
  whyNot(path: string): string | null {
    const full = resolve(path);
    if (!existsSync(full)) return '找不到這個檔案';
    if (parse(full).root === full) return '整個磁碟不能燒';
    if (within(full, this.opt.dir) || within(this.opt.dir, full)) return '陰間自己不能燒';
    for (const p of this.opt.protectedDirs ?? []) {
      if (p && (within(full, p) || within(p, full))) return '系統或賽博宮自己的檔案不能燒';
    }
    return null;
  }

  /** 燒給它：搬進陰間。 */
  burn(path: string, now: Date = new Date()): Soul {
    const full = resolve(path);
    const why = this.whyNot(full);
    if (why) throw new Error(why);
    const st = statSync(full);
    const soul: Soul = {
      id: `${now.getTime().toString(36)}-${randomBytes(4).toString('hex')}`,
      name: basename(full),
      originalPath: full,
      burnedAt: now.toISOString(),
      isDir: st.isDirectory(),
      size: st.isDirectory() ? 0 : st.size,
    };
    move(full, this.pathOf(soul));
    this.save([...this.list(), soul]);
    return soul;
  }

  private freeName(dir: string, name: string): string {
    if (!existsSync(join(dir, name))) return join(dir, name);
    const ext = extname(name);
    const stem = name.slice(0, name.length - ext.length);
    for (let i = 1; ; i++) {
      const candidate = join(dir, `${stem}（還陽${i > 1 ? i : ''}）${ext}`);
      if (!existsSync(candidate)) return candidate;
    }
  }

  /** 還陽：搬回原本的位置。原位置有同名檔案就改名；原資料夾回不去就放到備用資料夾。一定要成功。 */
  restore(id: string): { soul: Soul; restoredTo: string; relocated: boolean } {
    const list = this.list();
    const soul = list.find((s) => s.id === id);
    if (!soul) throw new Error('陰間裡找不到這個檔案');
    const src = this.pathOf(soul);
    if (!existsSync(src)) {
      // 檔案已經不在陰間了（被人從外面搬走），把紀錄清掉。
      this.save(list.filter((s) => s.id !== id));
      throw new Error('這個檔案已經不在陰間裡了');
    }
    let target = '';
    let relocated = false;
    for (const dir of [dirname(soul.originalPath), this.opt.fallbackDir]) {
      try {
        mkdirSync(dir, { recursive: true });
        target = this.freeName(dir, soul.name);
        move(src, target);
        relocated = dir !== dirname(soul.originalPath);
        break;
      } catch {
        target = '';
      }
    }
    if (!target) throw new Error('還陽失敗：原位置和備用位置都放不進去，檔案仍安全地留在陰間');
    rmSync(join(this.opt.dir, 'items', soul.id), { recursive: true, force: true });
    this.save(list.filter((s) => s.id !== id));
    return { soul, restoredTo: target, relocated };
  }

  /** 超渡之後（已移到 Windows 的回收筒），把紀錄清掉。 */
  forget(id: string): void {
    rmSync(join(this.opt.dir, 'items', id), { recursive: true, force: true });
    this.save(this.list().filter((s) => s.id !== id));
  }

  /** 在陰間待超過指定天數的。 */
  overdue(days: number, now: Date = new Date()): Soul[] {
    return this.list().filter((s) => now.getTime() - new Date(s.burnedAt).getTime() > days * 86400000);
  }
}
