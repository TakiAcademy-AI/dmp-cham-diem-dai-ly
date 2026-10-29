# Quy ước frontend (apps/web)

Mỗi màn hình là một file trong `src/screens/web/Wxx*.tsx` (web quản trị) hoặc `src/screens/app/Mxx*.tsx` (app đại lý). Màn đã được khai báo route trong `src/shell/registry.ts`, nên khi thêm màn mới chỉ cần sửa file của màn đó.

**Màn mẫu nên đọc trước:** `src/screens/web/W08Orders.tsx` (bảng, popup, thao tác ghi, phân quyền) và `src/screens/app/M02Home.tsx` (màn app).

## Nguồn thiết kế

- Bản thiết kế gốc của từng màn: `../DMP_VietPhap_DesignSystem/screens/<Mã>.html`. Phần `<style>` và `<script>` trong file chứa bố cục, câu chữ và hành vi. Ảnh chụp sẵn nằm ở `../DMP_VietPhap_DesignSystem/screenshots/<Mã>.png`.
- Nguyên tắc thiết kế và microcopy: `../DMP_VietPhap_DesignSystem/README.md`.
- Component có sẵn trong `src/ds` (`import { Button, DataTable, … } from '../../ds'`). Kiểu props xem ở `src/ds/bundle.d.ts`. Không tự vẽ lại component đã có.
- Class CSS dùng chung (`demo-row`, `demo-grid--2`, `demo-acard`, `demo-list`, `demo-note`…) nằm trong `src/styles/shell.css`.

## Chuyển từ bản thiết kế sang React

| Bản thiết kế (htm) | React |
|---|---|
| `X.AdminShell screen="W03" role=… onRole=…` | `<AdminShell screen="W03" sub=… actions=…>`. Vai trò lấy từ phiên đăng nhập; khung tự lo phân quyền, menu, điều hướng con |
| `X.PhoneFrame tab="home" side=…` | `<PhoneFrame tab="home" title=… back>`. Bảng "Xem với tài khoản" đã có sẵn |
| `X.BarLine`, `X.HBars`, `X.InfoGrid` | `import { BarLine, HBars, InfoGrid } from '../../shell/charts'` |
| `X.useToasts()` | `useToast()` hoặc tham số `success` của `useAction` |
| `DD.xxx` (dữ liệu giả) | Gọi API thật qua `useApi('/path')` |
| `X.sensitive(role, field)` | Server đã che sẵn; dùng cờ `agent.masked.phone`… và `POST /agents/:id/reveal` |
| Nút "Xem với vai trò" trong từng màn | Bỏ, vì khung đã có bộ chọn vai trò ở thanh trên |
| Số liệu cứng (ngưỡng hạng, tỷ lệ điểm) | Đọc từ `GET /rules` hoặc `GET /app/tiers`. Không viết cứng, tham số đang [CHỜ CHỐT] |

## Dữ liệu và thao tác

```tsx
const q = useApi<Order[]>('/orders');                   // GET, có cache theo path
const pay = useAction((id: string) => api.post(`/orders/${id}/payment`), {
  success: (r) => ({ tone: 'success', title: `+${num(r.activated)} điểm` }),
});                                                      // tự báo lỗi và làm mới mọi truy vấn
// App đại lý: useApi('/app/home', { realm: 'app' }), appApi.post(...), useAction(..., { realm: 'app' })
```

- Luôn xử lý 3 trạng thái: `q.isLoading` → `<Loading />`, `q.error` → `<ErrorNote error={q.error} />`, và rỗng → `EmptyState` kèm bước tiếp theo.
- Kiểm tra quyền để ẩn nút: `can(user.role, 'payments.record')` (import từ `@dmp/shared`). Chức năng không có quyền thì **ẩn hẳn**, không làm mờ.
- Định dạng số, tiền, ngày: `num`, `vnd`, `mil`, `ty`, `date`, `dateTime`, `signed` trong `src/lib/fmt.ts`. API trả ngày dạng ISO.
- Kiểu dữ liệu API: `src/lib/types.ts`. Thiếu trường nào thì bổ sung vào đây.
- Endpoint: xem các controller trong `apps/api/src/modules/*/**.controller.ts` (mỗi hàm có `@Get/@Post` và `@Can` quyền).

## CSS

- Mỗi màn có file `Wxx*.css` riêng, import trong file màn. **Mọi class phải có tiền tố mã màn** (`.w03-…`, `.m05-…`). Không viết selector trần như `.head` hay `table td`, vì CSS của mọi màn đều được nạp chung.
- Chỉ dùng token màu (`var(--primary)`…), không dùng mã màu cứng.
- Màn web phải dùng được ở 375px (các màn W02–W05, W13, W17). App đại lý thiết kế cho 375–430px, vùng chạm ≥ 44px.

## Kiểm tra

```bash
cd apps/web && npx tsc --noEmit          # phải sạch
```
