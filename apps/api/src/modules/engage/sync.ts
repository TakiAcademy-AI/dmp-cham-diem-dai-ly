import { eq } from 'drizzle-orm';
import { fmtNumber } from '@dmp/shared';
import { schema, type DB } from '../../db/db';

const { evidence, complaints, campaigns, approvals } = schema;
const nowVN = () => new Date().toLocaleString('vi-VN');

/* ---------- Đồng bộ trạng thái thực thể sau khi duyệt (gọi từ ApprovalsService) ---------- */
export async function afterDecision(db: DB, ap: typeof approvals.$inferSelect, approved: boolean, by: string, note?: string | null) {
  const p = ap.payload ?? {};
  const at = nowVN();
  if (p.evidenceId) {
    const [e] = await db.select().from(evidence).where(eq(evidence.id, p.evidenceId));
    if (e) await db.update(evidence).set({ stage: approved ? 'Đã duyệt' : 'Từ chối', history: [...e.history, { stage: approved ? 'Marketing đã duyệt' : 'Marketing từ chối', by, at, note: note ?? undefined }] }).where(eq(evidence.id, e.id));
  }
  if (p.complaintId) {
    const [c] = await db.select().from(complaints).where(eq(complaints.id, p.complaintId));
    if (c) await db.update(complaints).set({ status: approved ? 'Đã giải quyết' : 'Từ chối', resolution: approved ? `${c.resolution ?? ''} — đã điều chỉnh ${ap.points! > 0 ? '+' : ''}${fmtNumber(ap.points ?? 0)} (${ap.id})` : `BOD không duyệt điều chỉnh: ${note}`, history: [...c.history, { stage: approved ? 'BOD duyệt điều chỉnh' : 'BOD không duyệt', by, at, note: note ?? undefined }] }).where(eq(complaints.id, c.id));
  }
  if (p.campaignId) {
    await db.update(campaigns).set({ status: approved ? 'Đã duyệt' : 'Từ chối', note: approved ? undefined : `Bị từ chối: ${note}` }).where(eq(campaigns.id, p.campaignId));
  }
}
