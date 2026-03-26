export interface RecentDb {
  path: string;
  name: string;
  openedAt: number; // ms timestamp
}

const KEY = "vaultix_recent_dbs";
const MAX = 10; // store up to 10; display count controlled per-setting

export function getRecentDbs(): RecentDb[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

export function addRecentDb(path: string, name: string): void {
  const list = getRecentDbs().filter(r => r.path !== path);
  list.unshift({ path, name, openedAt: Date.now() });
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
}

export function removeRecentDb(path: string): void {
  const list = getRecentDbs().filter(r => r.path !== path);
  localStorage.setItem(KEY, JSON.stringify(list));
}
