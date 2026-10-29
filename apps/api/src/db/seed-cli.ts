// Nạp .env ở thư mục gốc dự án nếu có (Node ≥ 20.12)
try { process.loadEnvFile(require('node:path').resolve(__dirname, '../../../../.env')); } catch { /* không có .env */ }
process.env.TZ = process.env.TZ || 'Asia/Ho_Chi_Minh';
import { createDb } from './db';
import { resetAndSeed, DEMO_PASSWORD } from './seed';

/** npm run seed — xoá sạch và nạp lại dữ liệu demo. */
(async () => {
  const { db, close, kind } = await createDb();
  await resetAndSeed(db);
  console.log(`Đã nạp dữ liệu demo (${kind}). Mật khẩu mọi tài khoản nội bộ: ${DEMO_PASSWORD}`);
  await close();
})().catch((e) => { console.error(e); process.exit(1); });
