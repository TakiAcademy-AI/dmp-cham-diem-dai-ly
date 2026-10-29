# DMP Việt Pháp — Hệ thống quản lý đại lý & tích điểm (MVP)

Bản MVP full-stack, dựng theo **DMP_01 Đề xuất triển khai & Đặc tả UI/UX v1.0** và bộ **DMP_VietPhap_DesignSystem**. Hệ thống gồm hai phần:

- **Web quản trị** (`/`): dành cho 8 vai trò nội bộ, gồm SA, BOD, KTT, KT, TPKD, Sale, MKT và Kho.
- **App đại lý PWA** (`/app`): dành cho chủ đại lý (ĐL-C) và nhân viên đại lý (ĐL-NV).

> **Tham số điểm/hạng đang [CHỜ CHỐT].** Toàn bộ ngưỡng hạng, tỷ lệ tích điểm, hệ số và thưởng là cấu hình có phiên bản (màn W11/W12). Bộ v1 lấy theo khảo sát của khách và chưa phải con số đã chốt.

## Chạy nhanh

```bash
npm install
npm run dev          # API :3000 + web :5173 (mở http://localhost:5173)
npm test             # test engine điểm + test end-to-end API
```

Lần chạy đầu, API tự tạo DB và nạp dữ liệu demo (60 đại lý, 10 người dùng, 30 SKU, 12 quà, đơn hàng tháng 10/2026). Muốn nạp lại từ đầu thì chạy `npm run seed`, hoặc vào W25 và bấm "Nạp lại dữ liệu demo".

Không cần cài PostgreSQL khi dev. Nếu không đặt `DATABASE_URL`, API chạy **PGlite**, tức PostgreSQL bản nhúng, dữ liệu lưu ở `apps/api/.data/pg`. Khi deploy thì đặt `DATABASE_URL=postgres://…` (xem `.env.example`).

### Tài khoản demo

| Vai trò | Email | Ghi chú |
|---|---|---|
| BOD | an.nv@dmpvietphap.com | 2FA |
| Kế toán trưởng | mai.ht@dmpvietphap.com | 2FA |
| Kế toán | lan.pt@dmpvietphap.com | 2FA |
| Quản trị hệ thống | son.dc@dmpvietphap.com | 2FA |
| TP Kinh doanh | long.vd@dmpvietphap.com | |
| Sale | nam.tv@dmpvietphap.com | Phụ trách Nhà thuốc Minh Châu |
| Marketing | thu.dm@dmpvietphap.com | |
| Kho | tung.bv@dmpvietphap.com | |

Mật khẩu chung là `Dmp@2026`. Khi `DEMO_MODE=true`, mã 2FA/OTP luôn là `123456` và được hiện ngay trên màn hình. Màn đăng nhập có nút vào nhanh theo vai trò, và thanh trên có ô **Xem với vai trò** để đổi vai trò mà không cần đăng nhập lại.

App đại lý đăng nhập bằng SĐT: `0912345789` (chủ Nhà thuốc Minh Châu) hoặc `0987000125` (nhân viên).

## Kiến trúc

```
packages/shared   Engine điểm (hàm thuần, B1→B5), ma trận quyền, kiểu dữ liệu, định dạng — dùng chung API & web
apps/api          NestJS + Drizzle ORM + PostgreSQL (PGlite khi dev)
apps/web          React 18 + Vite + TanStack Query; component lấy nguyên từ design system (src/ds)
docs/FRONTEND.md  Quy ước khi thêm/sửa màn hình
```

Các quyết định thiết kế đã cài đặt:

- **Sổ cái điểm chỉ ghi thêm.** Trigger trong PostgreSQL chặn mọi `UPDATE`/`DELETE` (migration `0001_ledger_append_only.sql`). Muốn sửa sai thì ghi bút toán đảo. Ngoại lệ duy nhất: một dòng Treo được chuyển trạng thái một lần sang Khả dụng hoặc Thu hồi.
- **Hai quỹ điểm.** Điểm hạng dùng để xét hạng và không bị trừ khi đổi quà; điểm thưởng dùng để đổi quà. Điểm thưởng được chia thành **lô FIFO**, hết hạn sau N tháng (job `POST /jobs/expire`).
- **Điểm Treo → Khả dụng.** Đơn hoàn tất thì điểm ở trạng thái Treo; điểm chỉ thành Khả dụng khi Kế toán ghi nhận thanh toán đủ.
- **Bộ quy tắc có phiên bản.** Luồng là Nháp → Chờ BOD duyệt → Hiệu lực. Mỗi đơn lưu phiên bản quy tắc đã dùng để tính điểm, kèm cách tính từng bước.
- **Khoá sổ theo kỳ.** Kỳ đã khoá thì không ghi được điểm; mở lại phải có BOD duyệt.
- **Maker-checker.** Cộng điểm thủ công hoặc hàng loạt, điều chỉnh điểm, nâng hạng tay, ngoại lệ công nợ, đổi quy tắc và mở lại kỳ đều tạo yêu cầu vào hàng chờ duyệt. Người tạo yêu cầu không được tự duyệt.
- **Phân quyền ở server.** Mỗi endpoint gắn `@Can(quyền)`. Sale chỉ truy vấn được đại lý mình phụ trách. Trường nhạy cảm (SĐT, CCCD, ngày sinh, số tài khoản, công nợ) được che ngay ở server; bấm "Xem" sẽ ghi vào audit log.
- **Audit log** cho mọi thao tác ghi và mọi lần xem dữ liệu nhạy cảm.

## Phạm vi

| Nhóm | Màn |
|---|---|
| Web GĐ1 | W01–W17, W20, W22–W25 |
| Web GĐ2 | W18 Campaign điểm, W19 Đào tạo & sự kiện, W21 Khiếu nại điểm |
| Web khác | W26 Tài khoản & bảo mật (bật Authenticator/TOTP) |
| App đại lý | M01–M16 (M11 đặt hàng; M12 bằng chứng; M13 học tập & quiz; M14 bảng xếp hạng; M15 khiếu nại; M16 tài liệu bán hàng) |

Ngoài các màn trên, hệ thống còn có:

- **File & Excel:** upload file (giấy tờ, bằng chứng, ảnh quà, tài liệu). Ảnh CCCD chỉ BOD, KTT và Kế toán mở được. Xuất Excel chạy ở server và ghi vào audit log.
- **Công nợ:** thanh toán một phần, import CSV từ MISA có bước xem trước, lịch sử thanh toán.
- **Duyệt bổ sung:** quà ≥ 10 triệu cần BOD duyệt, Kho cập nhật tồn kho, KTT đề xuất hệ số điểm theo SKU (BOD duyệt). Hệ số hết hạn đúng theo ngày đã đặt.
- **Thông báo:** hẹn giờ gửi, theo dõi từng lô đã gửi.
- **Đại lý:** tạm ngưng/kích hoạt lại; tài khoản nhân viên đại lý; lưu thời điểm và thiết bị lúc đại lý đồng ý xử lý dữ liệu cá nhân.
- **Job tự chạy trong API** (xem và chạy tay ở W25):
  - Gửi thông báo hẹn giờ: mỗi phút.
  - Đồng bộ KiotViet: mỗi 15 phút.
  - Hết hạn điểm: 00:05 hằng ngày.
  - Đánh dấu ngủ đông: 00:15 hằng ngày.
  - Khoá sổ: ngày 05.
  - Xét hạng: ngày 01.

## Tích hợp

Mỗi bộ kết nối chỉ chạy thật khi đã điền đủ biến môi trường (xem `.env.example`). Khi chưa điền, hệ thống tự chuyển sang chế độ giả lập. W25 hiển thị trạng thái từng bộ.

| Hệ thống | Cách tích hợp | Biến cần |
|---|---|---|
| KiotViet | Kéo hoá đơn mới mỗi 15 phút. Mã khách hàng trên KiotViet phải trùng mã đại lý | `KIOTVIET_CLIENT_ID/SECRET/RETAILER` |
| Zalo OA / ZNS | Gửi tin theo mã mẫu tin đã được Zalo duyệt | `ZALO_OA_ACCESS_TOKEN`, `ZNS_TEMPLATES` |
| Zalo CRM tự xây | Gửi sự kiện qua webhook có chữ ký HMAC: đại lý mới, tạm ngưng, đổi quà, khiếu nại | `ZALO_CRM_WEBHOOK_URL`, `ZALO_CRM_SECRET` |
| MISA | Import file CSV ở W10, vì MISA chưa có API | — |

> Các bộ kết nối được viết theo tài liệu công khai của KiotViet và Zalo, **chưa kiểm thử với tài khoản thật của khách**. Cần chạy UAT khi có thông tin kết nối. Riêng Zalo CRM đang chờ khách gửi tài liệu API (rủi ro R11).

Việc bắt buộc trước go-live:

- Đặt `DEMO_MODE=false` và đổi `JWT_SECRET`.
- Dùng PostgreSQL có backup và mount `UPLOAD_DIR` ra volume riêng.
- Chốt tham số điểm theo bảng quyết định trong DMP_02.

## Kịch bản demo 30 phút (mục 7.3 DMP_01)

Đổi vai trò bằng ô **Xem với vai trò** ở thanh trên. App đại lý mở ở `/app`, nên chạy trong tab riêng.

| # | Kịch bản | Thao tác |
|---|---|---|
| 1 | BOD xem tổng quan | `/` (BOD) → `/contracts` → `/reports` |
| 2 | Sale chăm sóc đại lý ngủ đông | `/` (Sale) → mở đại lý trong "Việc cần làm" → W04 |
| 3 | Đại lý mới | `/agents/new`: Sale gửi hồ sơ → BOD duyệt → Kế toán cấp mã → đăng nhập app bằng SĐT mới |
| 4 | Điểm treo → khả dụng | `/orders` (Kế toán), mở DH0123 → "Ghi nhận đã thanh toán đủ" → app `/app` thấy +512 điểm |
| 5 | Đổi quà | app `/app/gifts` → đổi quà → `/redemptions`: Sale xác nhận → Kế toán duyệt → Kho giao |
| 6 | Cộng điểm hàng loạt | `/points/bulk` (MKT) → `/approvals` (BOD duyệt) |
| 7 | Trả hàng, thu hồi điểm | `/returns` (Kế toán) → tạo phiếu → `/points/ledger` thấy bút toán đảo |
| 8 | Chỉnh ngưỡng hạng | `/points/tiers` và `/points/rules`: xem phân bổ và chi phí điểm thay đổi ngay, lưu nháp, gửi BOD duyệt |
| 9 | Che dữ liệu theo vai trò | `/agents/DL00125`: Sale ↔ BOD; bấm "Hiện" sẽ ghi vào `/audit` |

Sau mỗi buổi demo, chạy `npm run seed` để đưa dữ liệu về trạng thái ban đầu.

## Còn mở (cần dữ liệu hoặc quyết định từ khách)

- **Kiểm thử tích hợp:** chưa chạy với tài khoản KiotViet, Zalo OA và Zalo CRM thật. Dữ liệu biến cho từng mẫu ZNS cần khớp với mẫu tin khách đăng ký.
- **Theo dõi xem video đào tạo:** chưa có. Hiện đại lý làm bài test được mà không cần xem hết video.
- **Chứng nhận đào tạo:** chưa có hạn hiệu lực hay mã QR xác thực.
- **Quét QR điểm danh sự kiện trên app:** chưa có. Marketing đang điểm danh tay ở W19.

## Deploy

```bash
docker compose up --build      # PostgreSQL + app tại http://localhost:3000
```

Image gồm cả API và bản build web (API phục vụ `apps/web/dist` trên cùng cổng). Có thể chạy trên bất kỳ nền tảng nào hỗ trợ Docker và PostgreSQL. Migration tự chạy khi khởi động.
