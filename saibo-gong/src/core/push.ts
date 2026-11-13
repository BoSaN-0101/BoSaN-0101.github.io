// 解讀 git 交給 pre-push hook 的資訊，判斷這次 push 算不算「正式上線」。

export interface PushRef {
  localRef: string;
  localSha: string;
  remoteRef: string;
  remoteSha: string;
}

export interface PushInfo {
  repoPath: string;
  remote: string;
  url: string;
  refs: PushRef[];
}

export const DEFAULT_PROTECTED = ['main', 'master'];

/** pre-push hook 的標準輸入：每行「本地ref 本地sha 遠端ref 遠端sha」。 */
export function parsePrePushInput(text: string): PushRef[] {
  const refs: PushRef[] = [];
  for (const line of text.split(/\r?\n/)) {
    const p = line.trim().split(/\s+/);
    if (p.length === 4) refs.push({ localRef: p[0], localSha: p[1], remoteRef: p[2], remoteSha: p[3] });
  }
  return refs;
}

export function parseBranchList(text: string): string[] {
  return text.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
}

const short = (ref: string) => ref.replace(/^refs\/(heads|tags)\//, '');

/** 這次 push 裡算「正式上線」的目標：受保護的分支，或任何 tag。 */
export function releaseTargets(refs: PushRef[], protectedBranches: string[]): string[] {
  const out: string[] = [];
  for (const r of refs) {
    if (r.remoteRef.startsWith('refs/tags/')) out.push(`tag ${short(r.remoteRef)}`);
    else if (r.remoteRef.startsWith('refs/heads/') && protectedBranches.includes(short(r.remoteRef))) out.push(`分支 ${short(r.remoteRef)}`);
  }
  return out;
}

export function describeRefs(refs: PushRef[]): string {
  return refs.map((r) => short(r.remoteRef)).join('、') || '（沒有內容）';
}

export function repoName(repoPath: string): string {
  return repoPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || repoPath;
}
