import { fmtDate, fmtDateTime, fmtMillion, fmtNumber, fmtVND, TIER_NAME, type Tier } from '@dmp/shared';

/** Định dạng hiển thị — dùng thống nhất trên mọi màn (README design system mục Định dạng). */
export const num = fmtNumber;
export const vnd = fmtVND;
export const mil = fmtMillion;
/** Ngày từ ISO (API) hoặc chuỗi dd/mm/yyyy (giữ nguyên). */
export const date = (d: string | Date | null | undefined) => (!d ? '—' : typeof d === 'string' && /^\d{2}\/\d{2}\/\d{4}/.test(d) ? d.slice(0, 10) : fmtDate(d));
export const dateTime = (d: string | Date | null | undefined) => (!d ? '—' : typeof d === 'string' && /^\d{2}\/\d{2}\/\d{4}/.test(d) ? d : fmtDateTime(d));
export const tierName = (t: string) => TIER_NAME[t as Tier] ?? t;
/** "+512" / "−154" cho biến động điểm. */
export const signed = (n: number) => (n > 0 ? '+' : '') + fmtNumber(n);
/** Tỷ VNĐ ngắn gọn cho KPI: 4,82 tỷ. */
export const ty = (n: number) => String(Math.round((n / 1e9) * 100) / 100).replace('.', ',') + ' tỷ';
