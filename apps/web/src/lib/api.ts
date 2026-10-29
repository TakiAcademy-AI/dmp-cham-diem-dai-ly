/**
 * Client gọi API. Web quản trị và app đại lý giữ token riêng (có thể đăng nhập song song ở 2 tab khi demo).
 * Lỗi từ server luôn có `message` tiếng Việt — hiện thẳng cho người dùng.
 */
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export type Realm = 'admin' | 'app';
const KEY: Record<Realm, string> = { admin: 'dmp.admin.token', app: 'dmp.app.token' };

export function getToken(realm: Realm): string | null {
  try { return localStorage.getItem(KEY[realm]); } catch { return null; }
}
export function setToken(realm: Realm, token: string | null) {
  try { token ? localStorage.setItem(KEY[realm], token) : localStorage.removeItem(KEY[realm]); } catch { /* chế độ riêng tư */ }
}

const listeners = new Set<(realm: Realm) => void>();
/** Báo hết phiên (401) để khung chuyển về màn đăng nhập. */
export function onUnauthorized(fn: (realm: Realm) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

async function request<T>(realm: Realm, method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken(realm);
  const res = await fetch('/api' + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && token) { setToken(realm, null); listeners.forEach((l) => l(realm)); }
    const msg = Array.isArray(data?.message) ? data.message.join('; ') : data?.message;
    throw new ApiError(res.status, msg || 'Có lỗi xảy ra, vui lòng thử lại');
  }
  return data as T;
}

function client(realm: Realm) {
  return {
    get: <T = any>(p: string) => request<T>(realm, 'GET', p),
    post: <T = any>(p: string, b: unknown = {}) => request<T>(realm, 'POST', p, b),
    put: <T = any>(p: string, b: unknown = {}) => request<T>(realm, 'PUT', p, b),
    patch: <T = any>(p: string, b: unknown = {}) => request<T>(realm, 'PATCH', p, b),
  };
}
/** API web quản trị (token nội bộ). */
export const api = client('admin');
/** API app đại lý (token đại lý). */
export const appApi = client('app');

/* ---------- File & xuất Excel ---------- */
export interface UploadedFile { id: string; name: string; mime: string; size: number }
/** Upload một file (≤ 15MB: ảnh, PDF, MP4, Office, CSV) → trả id để gắn vào hồ sơ/bằng chứng. */
export async function uploadFile(file: File, realm: Realm = 'admin'): Promise<UploadedFile> {
  const fd = new FormData();
  fd.append('file', file);
  const token = getToken(realm);
  const res = await fetch('/api/files', { method: 'POST', headers: token ? { authorization: 'Bearer ' + token } : {}, body: fd });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.message || 'Tải file thất bại');
  return data;
}
/** URL mở file (dùng được trong <img src> / <a href>) — token gắn qua ?t=. */
export const fileUrl = (id: string, realm: Realm = 'admin') => `/api/files/${id}?t=${encodeURIComponent(getToken(realm) ?? '')}`;
/** Tải Excel phía server (có ghi audit log): agents | orders | ledger | audit | redemptions | contracts | debt. */
export function downloadExport(kind: 'agents' | 'orders' | 'ledger' | 'audit' | 'redemptions' | 'contracts' | 'debt') {
  const a = document.createElement('a');
  a.href = `/api/export/${kind}?t=${encodeURIComponent(getToken('admin') ?? '')}`;
  a.click();
}
