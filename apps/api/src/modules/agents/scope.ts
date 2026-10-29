import { eq } from 'drizzle-orm';
import { canSeeField, mask, type Role } from '@dmp/shared';
import { schema, type DB } from '../../db/db';
import type { Actor } from '../../common/core';

/** Phạm vi dữ liệu: Sale chỉ thấy đại lý mình phụ trách; null = không giới hạn. */
export async function scopeAgentIds(db: DB, actor: Actor): Promise<string[] | null> {
  if (actor.kind === 'agent') return actor.agentId ? [actor.agentId] : [];
  if (actor.role !== 'SALE') return null;
  const rows = await db.select({ id: schema.agents.id }).from(schema.agents).where(eq(schema.agents.saleId, actor.id));
  return rows.map((r) => r.id);
}

type AgentRow = typeof schema.agents.$inferSelect;

/** Che trường nhạy cảm theo vai trò ngay ở server (mục 4.3) — client không bao giờ nhận dữ liệu thật nếu không có quyền. */
export function serializeAgent(a: AgentRow, actor: Actor, extra: Record<string, unknown> = {}) {
  const role = actor.role as Role;
  const own = role === 'SALE' && a.saleId === actor.id;
  const show = (f: Parameters<typeof canSeeField>[1]) => canSeeField(role, f, own);
  return {
    ...a,
    phone: show('phone') ? a.phone : mask.phone(a.phone),
    idCard: show('idCard') ? a.idCard : mask.idCard(a.idCard),
    dob: show('dob') ? a.dob : mask.birthday(a.dob),
    bank: show('bank') ? a.bank : mask.bank(a.bank),
    debt: show('debt') ? a.debt : null,
    creditLimit: show('debt') ? a.creditLimit : null,
    // Ảnh CCCD chỉ trả cho vai trò được xem CCCD (BOD/KTT/KT)
    docFiles: Object.fromEntries(Object.entries(a.docFiles ?? {}).filter(([k]) => !/CCCD/i.test(k) || show('idCard') || ['BOD', 'KTT', 'KT'].includes(role))),
    masked: { phone: !show('phone'), idCard: !show('idCard'), dob: !show('dob'), bank: !show('bank'), debt: !show('debt') },
    ...extra,
  };
}
