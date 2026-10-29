/** Định dạng theo README design system: dấu chấm hàng nghìn, "−" cho số âm, ngày dd/mm/yyyy. */
export function fmtNumber(n: number): string {
  const v = Math.round(Math.abs(Number(n) || 0));
  return (n < 0 ? '−' : '') + String(v).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
export const fmtVND = (n: number) => fmtNumber(n) + 'đ';
export function fmtMillion(n: number): string {
  const m = Math.round((n / 1e6) * 10) / 10;
  return String(m).replace('.', ',') + ' triệu';
}
export const fmtDec = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

const pad = (n: number) => String(n).padStart(2, '0');
export function fmtDate(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${pad(x.getDate())}/${pad(x.getMonth() + 1)}/${x.getFullYear()}`;
}
export function fmtDateTime(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${fmtDate(x)} ${pad(x.getHours())}:${pad(x.getMinutes())}`;
}
/** Kỳ khoá sổ dạng "2026-10". */
export function periodOf(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}`;
}
export function addMonths(d: Date, months: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + months);
  return x;
}
/** Cuối tháng của ngày d — lô điểm hết hạn vào cuối tháng thứ N. */
export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
}

/** Che dữ liệu nhạy cảm (mục 4.3). */
export const mask = {
  phone: (p: string) => (p ? p.slice(0, 3) + '****' + p.slice(-3) : ''),
  idCard: (id: string) => (id ? '********' + id.slice(-4) : ''),
  birthday: (d: string) => (d ? d.slice(0, 5) + '/****' : ''),
  bank: (acc: string) => (acc ? '**' + acc.slice(-2) : ''),
};
