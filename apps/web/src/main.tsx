import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles/tokens.css';
import './styles/bundle.css';
import './styles/shell.css';
import './styles/app.css';
import { SessionProvider, useSession } from './lib/session';
import { Loading, ToastProvider } from './lib/hooks';
import { APP_SCREENS, WEB_SCREENS } from './shell/registry';
import W01Login from './screens/web/W01Login';
import M01Login from './screens/app/M01Login';

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: false } } });

function RequireAdmin() {
  const { user, loading } = useSession('admin');
  const loc = useLocation();
  if (loading) return <Loading label="Đang kiểm tra phiên đăng nhập…" />;
  if (!user || user.kind !== 'user') return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return <Suspense fallback={<Loading />}><Outlet /></Suspense>;
}

function RequireAgent() {
  const { user, loading } = useSession('app');
  if (loading) return <Loading label="Đang kiểm tra phiên đăng nhập…" />;
  if (!user || user.kind !== 'agent') return <Navigate to="/app/login" replace />;
  return <Suspense fallback={<Loading />}><Outlet /></Suspense>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <SessionProvider realm="admin">
          <SessionProvider realm="app">
            <BrowserRouter>
              <Routes>
                <Route path="/login" element={<W01Login />} />
                <Route path="/app/login" element={<M01Login />} />
                <Route element={<RequireAgent />}>
                  {APP_SCREENS.map((s) => <Route key={s.code} path={s.path} element={<s.Component />} />)}
                </Route>
                <Route element={<RequireAdmin />}>
                  {WEB_SCREENS.map((s) => <Route key={s.code} path={s.path} element={<s.Component />} />)}
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </BrowserRouter>
          </SessionProvider>
        </SessionProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
