import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { Toast, type ToastProps } from '../ds';
import { api, appApi, type Realm } from './api';

/* ---------- Toast toàn cục ---------- */
type ToastInput = Pick<ToastProps, 'tone' | 'title' | 'body'>;
const ToastCtx = createContext<(t: ToastInput) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Array<ToastInput & { id: number }>>([]);
  const push = useCallback((t: ToastInput) => {
    const id = Math.random();
    setList((l) => [...l, { ...t, id }]);
    if (t.tone !== 'danger') setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="demo-toasts" aria-live="polite">
        {list.map((t) => <Toast key={t.id} tone={t.tone} title={t.title} body={t.body} onClose={() => setList((l) => l.filter((x) => x.id !== t.id))} />)}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/* ---------- Truy vấn & thao tác ---------- */
/** GET có cache. `key` mặc định là path — các thao tác invalidate theo tiền tố path. */
export function useApi<T = any>(path: string | null, opts: { realm?: Realm } & Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'> = {}) {
  const { realm = 'admin', ...rest } = opts;
  const client = realm === 'admin' ? api : appApi;
  return useQuery<T>({ queryKey: [realm, path], queryFn: () => client.get<T>(path!), enabled: !!path, ...rest });
}

/**
 * Thao tác ghi: gọi API, báo toast lỗi/thành công, làm mới các truy vấn có path bắt đầu bằng `invalidate`.
 * Mặc định làm mới toàn bộ để màn khác (badge, số dư điểm) luôn đúng sau mỗi thao tác.
 */
export function useAction<TVars = void, TRes = any>(
  fn: (vars: TVars) => Promise<TRes>,
  opts: { success?: string | ((r: TRes, v: TVars) => ToastInput | string | null); invalidate?: string[]; realm?: Realm; onDone?: (r: TRes, v: TVars) => void } = {},
) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<TRes, Error, TVars>({
    mutationFn: fn,
    onSuccess: (r, v) => {
      const realm = opts.realm ?? 'admin';
      if (opts.invalidate) opts.invalidate.forEach((p) => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === realm && String(q.queryKey[1] ?? '').startsWith(p) }));
      else qc.invalidateQueries();
      const s = typeof opts.success === 'function' ? opts.success(r, v) : opts.success;
      if (s) toast(typeof s === 'string' ? { tone: 'success', title: s } : s);
      opts.onDone?.(r, v);
    },
    onError: (e) => toast({ tone: 'danger', title: 'Không thực hiện được', body: e.message }),
  });
}

/* ---------- Trạng thái tải / lỗi ---------- */
export function Loading({ label = 'Đang tải dữ liệu…' }: { label?: string }) {
  return <div className="app-loading">{label}</div>;
}
export function ErrorNote({ error }: { error: unknown }) {
  return <div className="app-error" role="alert">{(error as Error)?.message ?? 'Có lỗi xảy ra'}</div>;
}
