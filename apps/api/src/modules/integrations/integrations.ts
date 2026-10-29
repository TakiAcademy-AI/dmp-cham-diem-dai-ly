import crypto from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { OrderLineInput } from '@dmp/shared';

/**
 * Bộ kết nối hệ thống ngoài. Mỗi bộ chỉ chạy thật khi đủ biến môi trường; thiếu cấu hình thì `configured=false`
 * và hệ thống dùng chế độ giả lập (đơn ngẫu nhiên, ZNS ghi hộp thư) như bản demo.
 * Chưa kiểm thử với tài khoản thật của khách — cần chạy UAT khi có thông tin kết nối.
 */

/* ---------- KiotViet (public API: https://www.kiotviet.vn/huong-dan-su-dung-public-api-retail/) ---------- */
export interface KiotOrder { code: string; customerCode: string; purchaseDate: string; total: number; status: number; lines: OrderLineInput[] }

@Injectable()
export class KiotVietClient {
  private log = new Logger('KiotViet');
  private token: { value: string; exp: number } | null = null;
  get configured() { return !!(process.env.KIOTVIET_CLIENT_ID && process.env.KIOTVIET_CLIENT_SECRET && process.env.KIOTVIET_RETAILER); }

  private async auth() {
    if (this.token && this.token.exp > Date.now() + 60e3) return this.token.value;
    const body = new URLSearchParams({ scopes: 'PublicApi.Access', grant_type: 'client_credentials', client_id: process.env.KIOTVIET_CLIENT_ID!, client_secret: process.env.KIOTVIET_CLIENT_SECRET! });
    const r = await fetch('https://id.kiotviet.vn/connect/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    if (!r.ok) throw new Error(`KiotViet auth ${r.status}`);
    const j = (await r.json()) as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  /** Hoá đơn hoàn thành sửa đổi từ `since`. Mã khách hàng KiotViet = mã đại lý (DLxxxxx) — cần chốt quy ước mapping với khách. */
  async invoicesSince(since: Date): Promise<KiotOrder[]> {
    const token = await this.auth();
    const out: KiotOrder[] = [];
    for (let skip = 0; ; skip += 100) {
      const q = new URLSearchParams({ lastModifiedFrom: since.toISOString(), pageSize: '100', currentItem: String(skip), includeInvoiceDelivery: 'false', 'status[]': '1' });
      const r = await fetch('https://public.kiotapi.com/invoices?' + q, { headers: { Retailer: process.env.KIOTVIET_RETAILER!, Authorization: 'Bearer ' + token } });
      if (!r.ok) throw new Error(`KiotViet invoices ${r.status}`);
      const j = (await r.json()) as { data: any[]; total: number };
      for (const inv of j.data ?? []) {
        out.push({
          code: inv.code, customerCode: inv.customerCode, purchaseDate: inv.purchaseDate, total: inv.total, status: inv.status,
          lines: (inv.invoiceDetails ?? []).map((d: any) => ({ sku: d.productCode, name: d.productName, price: d.price, qty: d.quantity, discount: d.discountRatio ? d.discountRatio / 100 : 0 })),
        });
      }
      if (!j.data?.length || skip + 100 >= j.total) break;
    }
    this.log.log(`Kéo ${out.length} hoá đơn từ ${since.toISOString()}`);
    return out;
  }
}

/* ---------- Zalo ZNS (https://developers.zalo.me/docs/zalo-notification-service) ---------- */
@Injectable()
export class ZaloZnsClient {
  private log = new Logger('ZNS');
  /** ZNS_TEMPLATES: JSON {"otp":"123456","points":"234567",...} — mã template đã được Zalo duyệt. */
  private templates(): Record<string, string> { try { return JSON.parse(process.env.ZNS_TEMPLATES || '{}'); } catch { return {}; } }
  get configured() { return !!process.env.ZALO_OA_ACCESS_TOKEN && Object.keys(this.templates()).length > 0; }
  hasTemplate(t: string) { return !!this.templates()[t]; }

  /** Gửi một tin; trả về trạng thái để ghi vào hộp thư. SĐT đổi sang dạng 84xxxxxxxxx. */
  async send(template: string, phone: string, data: Record<string, string>): Promise<'Đã gửi' | 'Lỗi' | 'Giả lập'> {
    const id = this.templates()[template];
    if (!process.env.ZALO_OA_ACCESS_TOKEN || !id) return 'Giả lập';
    try {
      const r = await fetch('https://business.openapi.zalo.me/message/template', {
        method: 'POST', headers: { 'content-type': 'application/json', access_token: process.env.ZALO_OA_ACCESS_TOKEN },
        body: JSON.stringify({ phone: phone.replace(/^0/, '84'), template_id: id, template_data: data, tracking_id: crypto.randomUUID() }),
      });
      const j = (await r.json()) as { error: number; message: string };
      if (j.error !== 0) { this.log.warn(`ZNS ${template} → ${phone}: ${j.message}`); return 'Lỗi'; }
      return 'Đã gửi';
    } catch (e) { this.log.warn(`ZNS lỗi mạng: ${(e as Error).message}`); return 'Lỗi'; }
  }
}

/* ---------- Zalo CRM tự xây của khách: đẩy sự kiện qua webhook (chờ tài liệu API — rủi ro R11) ---------- */
export type CrmEvent = 'agent.created' | 'agent.dormant' | 'agent.tier_changed' | 'agent.suspended' | 'redemption.created' | 'complaint.created';

@Injectable()
export class ZaloCrmClient {
  private log = new Logger('ZaloCRM');
  get configured() { return !!process.env.ZALO_CRM_WEBHOOK_URL; }

  /** Gửi sự kiện kèm chữ ký HMAC-SHA256 (header X-DMP-Signature). Không chặn luồng chính khi lỗi. */
  async emit(event: CrmEvent, data: Record<string, unknown>): Promise<boolean> {
    if (!this.configured) return false;
    const body = JSON.stringify({ event, at: new Date().toISOString(), data });
    const sig = crypto.createHmac('sha256', process.env.ZALO_CRM_SECRET || '').update(body).digest('hex');
    try {
      const r = await fetch(process.env.ZALO_CRM_WEBHOOK_URL!, { method: 'POST', headers: { 'content-type': 'application/json', 'x-dmp-signature': sig }, body });
      if (!r.ok) this.log.warn(`${event} → ${r.status}`);
      return r.ok;
    } catch (e) { this.log.warn(`${event} lỗi mạng: ${(e as Error).message}`); return false; }
  }
}

/* ---------- MISA: chưa có API — nhập file CSV công nợ/thanh toán xuất từ MISA ---------- */
export interface MisaRow { orderId: string; amount: number; date?: string; method?: string }
/** CSV có tiêu đề; nhận cột "Số chứng từ gốc"/"orderId", "Số tiền"/"amount", "Ngày"/"date". Dấu phân cách , hoặc ; */
export function parseMisaCsv(text: string): { rows: MisaRow[]; errors: string[] } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { rows: [], errors: ['File trống'] };
  const sep = lines[0].includes(';') ? ';' : ',';
  const head = lines[0].split(sep).map((h) => h.trim().toLowerCase());
  // Ưu tiên khớp chính xác, sau đó khớp chứa — theo thứ tự tên ứng viên; cột ngày không bao giờ là cột mã đơn
  const col = (names: string[], exclude: string[] = []) => {
    for (const n of names) { const i = head.findIndex((h) => h === n); if (i >= 0) return i; }
    for (const n of names) { const i = head.findIndex((h) => h.includes(n) && !exclude.some((x) => h.includes(x))); if (i >= 0) return i; }
    return -1;
  };
  const ci = col(['số chứng từ gốc', 'orderid', 'mã đơn', 'số đơn', 'chứng từ gốc', 'chứng từ'], ['ngày', 'date']);
  const ai = col(['số tiền', 'amount', 'tiền']), di = col(['ngày', 'date', 'ngày chứng từ']), mi = col(['hình thức', 'method']);
  if (ci < 0 || ai < 0) return { rows: [], errors: ['Thiếu cột mã đơn hoặc số tiền'] };
  const rows: MisaRow[] = [], errors: string[] = [];
  lines.slice(1).forEach((l, i) => {
    const c = l.split(sep).map((x) => x.trim().replace(/^"|"$/g, ''));
    const amount = Number(c[ai].replace(/[.\s]/g, '').replace(',', '.'));
    if (!c[ci] || !(amount > 0)) errors.push(`Dòng ${i + 2}: dữ liệu không hợp lệ`);
    else rows.push({ orderId: c[ci], amount, date: di >= 0 ? c[di] : undefined, method: mi >= 0 ? c[mi] : undefined });
  });
  return { rows, errors };
}

/* ---------- TOTP (RFC 6238) cho 2FA nội bộ ---------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function newTotpSecret(): string {
  return Array.from(crypto.randomBytes(20), (b) => B32[b % 32]).join('');
}
function b32decode(s: string): Buffer {
  let bits = '';
  for (const ch of s.replace(/=+$/, '').toUpperCase()) bits += B32.indexOf(ch).toString(2).padStart(5, '0');
  return Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
}
export function totpCode(secret: string, at = Date.now(), step = 30): string {
  const ctr = Buffer.alloc(8);
  ctr.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / step)));
  const h = crypto.createHmac('sha1', b32decode(secret)).update(ctr).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}
/** Chấp nhận lệch ±1 bước (30 giây) do đồng hồ điện thoại. */
export function verifyTotp(secret: string, code: string): boolean {
  return [-1, 0, 1].some((d) => totpCode(secret, Date.now() + d * 30e3) === code);
}
export const otpauthUrl = (secret: string, email: string) => `otpauth://totp/DMP%20Vi%E1%BB%87t%20Ph%C3%A1p:${encodeURIComponent(email)}?secret=${secret}&issuer=DMP%20Viet%20Phap`;
