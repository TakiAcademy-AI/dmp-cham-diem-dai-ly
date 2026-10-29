import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { and, desc, eq, lte } from 'drizzle-orm';
import { TIER_ORDER, periodOf } from '@dmp/shared';
import { schema, type DB } from '../../db/db';
import { InjectDb, ZnsService } from '../../common/core';
import { PointsService } from '../points/points.service';
import { OrdersController } from '../orders/orders.controller';
import { KiotVietClient } from '../integrations/integrations';

const { jobRuns, scheduledBroadcasts, agents, periods, tierHistory } = schema;

export interface JobDef { key: string; name: string; schedule: string; due: (now: Date, last: Date | null) => boolean; run: () => Promise<string> }

/**
 * Job định kỳ (không cần cron ngoài): kiểm tra mỗi phút, chạy job đến hạn, ghi job_runs.
 * Tắt bằng CRON_ENABLED=false (test). Chạy nhiều bản API cùng lúc thì chỉ bật ở một bản.
 */
@Injectable()
export class SchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private log = new Logger('Scheduler');
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  readonly jobs: JobDef[];

  constructor(@InjectDb() private db: DB, private points: PointsService, private orders: OrdersController, private kiot: KiotVietClient, private zns: ZnsService) {
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const daily = (h: number, m: number) => (now: Date, last: Date | null) => (now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m)) && (!last || day(last) !== day(now));
    this.jobs = [
      { key: 'broadcasts', name: 'Gửi thông báo hẹn giờ', schedule: 'Mỗi phút', due: () => true, run: () => this.sendScheduled() },
      { key: 'kiotviet', name: 'Đồng bộ đơn KiotViet', schedule: 'Mỗi 15 phút (khi đã cấu hình)', due: (n, l) => this.kiot.configured && (!l || +n - +l >= 15 * 60e3), run: async () => { const r = await this.orders.runSync(); return `${r.created.length} đơn mới`; } },
      { key: 'expire', name: 'Hết hạn lô điểm', schedule: 'Hằng ngày 00:05', due: daily(0, 5), run: async () => { const r = await this.points.expireLots(); return `${r.expiredLots} lô · ${r.points} điểm`; } },
      { key: 'dormant', name: 'Đánh dấu đại lý ngủ đông (> 60 ngày không có đơn)', schedule: 'Hằng ngày 00:15', due: daily(0, 15), run: () => this.markDormant() },
      { key: 'lock', name: 'Khoá sổ kỳ trước', schedule: 'Ngày khoá sổ (mặc định 05) lúc 18:00', due: (n, l) => n.getDate() === 5 && n.getHours() >= 18 && (!l || day(l) !== day(n)), run: () => this.lockPrevious() },
      { key: 'tier', name: 'Xét hạng định kỳ', schedule: 'Ngày 01 hằng tháng lúc 01:00', due: (n, l) => n.getDate() === 1 && n.getHours() >= 1 && (!l || day(l) !== day(n)), run: () => this.tierReview() },
    ];
  }

  onApplicationBootstrap() {
    if (process.env.CRON_ENABLED === 'false') return;
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.log.log('Bật job định kỳ (kiểm tra mỗi phút)');
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async lastRuns() {
    const out: Record<string, typeof jobRuns.$inferSelect | null> = {};
    for (const j of this.jobs) out[j.key] = (await this.db.select().from(jobRuns).where(eq(jobRuns.job, j.key)).orderBy(desc(jobRuns.at)).limit(1))[0] ?? null;
    return out;
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const last = await this.lastRuns();
      const now = new Date();
      for (const j of this.jobs) if (j.due(now, last[j.key]?.at ?? null)) await this.runJob(j.key, j.key === 'broadcasts');
    } finally { this.running = false; }
  }

  /** Chạy một job; `quiet` không ghi log khi không có gì để làm. */
  async runJob(key: string, quiet = false) {
    const j = this.jobs.find((x) => x.key === key);
    if (!j) throw new Error('Không có job ' + key);
    try {
      const msg = await j.run();
      if (!quiet || msg) await this.db.insert(jobRuns).values({ job: key, status: 'OK', message: msg });
      return { key, status: 'OK', message: msg };
    } catch (e) {
      const msg = (e as Error).message;
      this.log.warn(`${key}: ${msg}`);
      await this.db.insert(jobRuns).values({ job: key, status: 'Lỗi', message: msg });
      return { key, status: 'Lỗi', message: msg };
    }
  }

  private async sendScheduled(): Promise<string> {
    const due = await this.db.select().from(scheduledBroadcasts).where(and(eq(scheduledBroadcasts.status, 'Chờ gửi'), lte(scheduledBroadcasts.sendAt, new Date())));
    let sent = 0;
    for (const s of due) {
      const p = s.payload;
      let targets = await this.db.select().from(agents);
      targets = targets.filter((a) => a.status !== 'locked');
      if (p.agentIds?.length) targets = targets.filter((a) => p.agentIds.includes(a.id));
      else if (p.tiers?.length) targets = targets.filter((a) => p.tiers.includes(a.tier));
      const batchId = 'BC' + s.id;
      for (const a of targets) await this.zns.send({ agentId: a.id, phone: a.phone, channel: p.channel ?? 'ZNS', template: p.template ?? 'broadcast', title: p.title, body: String(p.body).replace(/<tên>/g, a.name), sender: s.sender, batchId });
      await this.db.update(scheduledBroadcasts).set({ status: 'Đã gửi', result: `${targets.length} đại lý` }).where(eq(scheduledBroadcasts.id, s.id));
      sent += targets.length;
    }
    return due.length ? `${due.length} lô · ${sent} tin` : '';
  }

  private async markDormant(): Promise<string> {
    const all = await this.db.select().from(agents);
    const cutoff = Date.now() - 60 * 86400e3;
    let n = 0;
    for (const a of all) {
      const [d, m, y] = a.lastOrder.split('/').map(Number);
      if (!y || a.status === 'locked' || a.status === 'dormant') continue;
      if (+new Date(y, m - 1, d) < cutoff) { await this.db.update(agents).set({ status: 'dormant', flags: [...new Set([...a.flags, 'dormant'])] }).where(eq(agents.id, a.id)); n++; }
    }
    return `${n} đại lý chuyển ngủ đông`;
  }

  private async lockPrevious(): Promise<string> {
    const d = new Date(); d.setMonth(d.getMonth() - 1);
    const p = periodOf(d);
    const [row] = await this.db.select().from(periods).where(eq(periods.period, p));
    if (row?.locked) return `Kỳ ${p} đã khoá trước đó`;
    await this.db.insert(periods).values({ period: p, locked: true, lockedBy: 'Tự động (job)', lockedAt: new Date() }).onConflictDoUpdate({ target: periods.period, set: { locked: true, lockedBy: 'Tự động (job)', lockedAt: new Date() } });
    return `Đã khoá sổ kỳ ${p}`;
  }

  private async tierReview(): Promise<string> {
    const r = await this.points.runTierReview();
    const all = await this.db.select({ tier: agents.tier }).from(agents);
    const now = new Date();
    const month = `T${now.getMonth() + 1}/${String(now.getFullYear()).slice(2)}`;
    const counts = Object.fromEntries(TIER_ORDER.map((t) => [t, all.filter((a) => a.tier === t).length]));
    await this.db.insert(tierHistory).values({ month, counts }).onConflictDoUpdate({ target: tierHistory.month, set: { counts } });
    return `${r.reviewed} đại lý · ${r.changes.filter((c) => c.change === 'up').length} lên, ${r.changes.filter((c) => c.change === 'down').length} xuống`;
  }
}
