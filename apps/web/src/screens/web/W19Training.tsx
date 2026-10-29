import { useRef, useState } from 'react';
import { can, ROLE_LABEL, type Role } from '@dmp/shared';
import { Button, Card, DataTable, EmptyState, Field, Icon, KpiCard, PointValue, StatusBadge, Tabs, TierBadge, type Tier } from '../../ds';
import { AdminShell } from '../../shell/AdminShell';
import { InfoGrid } from '../../shell/charts';
import { api, fileUrl, uploadFile } from '../../lib/api';
import { ErrorNote, Loading, useAction, useApi, useToast } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { dateTime, num } from '../../lib/fmt';
import type { Agent } from '../../lib/types';
import './W19Training.css';

type CType = 'offline' | 'online' | 'event';
interface Quiz { q: string; options: string[]; answer: number }
interface Course { id: string; name: string; type: CType; date: string; points: number; rule: string; content: string; fileId: string | null; quiz: Quiz[]; passPct: number; status: string; createdAt: string; participants: number; passed: number }
interface Attempt { id: number; courseId: string; agentId: string; score: number; total: number; passed: boolean; method: string; approvalId: string | null; createdAt: string; agentName: string; tier: string }
interface CourseDetail extends Omit<Course, 'participants' | 'passed'> { attempts: Attempt[] }
interface Draft { name: string; type: CType; date: string; points: string; passPct: string; status: string; content: string; fileId: string | null; fileName: string; quiz: Quiz[] }

const TYPE_LABEL: Record<CType, string> = { offline: 'Offline', online: 'Online', event: 'Sự kiện · QR check-in' };
const METHOD: Record<string, string> = { quiz: 'Bài test trên app', attendance: 'Điểm danh offline', qr: 'QR check-in' };
const STATUSES = ['Đang mở', 'Đã diễn ra', 'Tạm ẩn'];
const typeLabel = (c: { type: CType; content?: string; fileId?: string | null; quiz?: Quiz[] }) => {
  if (c.type !== 'online') return TYPE_LABEL[c.type];
  const parts = [/^https?:\/\//.test(c.content ?? '') ? 'video' : '', c.fileId ? 'tài liệu' : '', c.quiz?.length ? 'quiz' : ''].filter(Boolean);
  return 'Online' + (parts.length ? ' · ' + parts.join(' + ') : '');
};
const blankQ = (): Quiz => ({ q: '', options: ['', '', ''], answer: 0 });
const toDraft = (c: CourseDetail | Course): Draft => ({ name: c.name, type: c.type, date: c.date, points: String(c.points), passPct: String(c.passPct), status: c.status, content: c.content, fileId: c.fileId, fileName: c.fileId ? 'Tệp đã tải lên' : '', quiz: c.quiz.map((x) => ({ ...x, options: [...x.options] })) });
const newDraft = (type: CType): Draft => ({ name: '', type, date: type === 'online' ? 'Luôn mở' : '', points: type === 'event' ? '300' : type === 'offline' ? '150' : '50', passPct: '80', status: 'Đang mở', content: '', fileId: null, fileName: '', quiz: type === 'event' ? [] : [blankQ()] });
const quizErr = (qz: Quiz[]) => qz.findIndex((x) => !x.q.trim() || x.options.length < 2 || x.options.some((o) => !o.trim()) || x.answer >= x.options.length);

/** W19 Đào tạo & sự kiện — MKT tạo khoá học/sự kiện, soạn bài test, điểm danh → lô cộng điểm chờ BOD duyệt. */
export default function W19Training() {
  const { user } = useSession();
  const role = user!.role as Role;
  const isMkt = can(role, 'training.manage');
  const toast = useToast();
  const q = useApi<Course[]>('/courses');
  const [selId, setSelId] = useState<string | null>(null);
  const [newType, setNewType] = useState<CType | null>(null);
  const [tab, setTab] = useState('quiz');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pick, setPick] = useState<string[]>([]);
  const [pickKey, setPickKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);

  const courses = q.data ?? [];
  const creating = !!newType;
  const curId = creating ? null : selId ?? courses[0]?.id ?? null;
  const detQ = useApi<CourseDetail>(curId ? '/courses/' + curId : null);
  const cur = detQ.data && detQ.data.id === curId ? detQ.data : null;
  const row = courses.find((c) => c.id === curId);
  const needAttendance = (cur?.type ?? newType) !== 'online';
  const agentsQ = useApi<Agent[]>(isMkt && tab === 'attend' ? '/agents' : null);

  const d: Draft | null = isMkt ? draft ?? (creating ? newDraft(newType!) : cur ? toDraft(cur) : null) : null;
  const setD = (patch: Partial<Draft>) => setDraft({ ...(d as Draft), ...patch });
  const dirty = !!draft;

  const select = (id: string, type?: CType) => {
    setNewType(null); setSelId(id); setDraft(null); setPick([]); setPickKey((k) => k + 1);
    setTab(type === 'event' ? 'attend' : 'quiz');
    setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };
  const create = (type: CType) => {
    setNewType(type); setSelId(null); setDraft(newDraft(type)); setTab('info');
    setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const save = useAction(async () => {
    const x = d!;
    const body = { name: x.name.trim(), type: x.type, date: x.date.trim(), points: Number(x.points) || 0, passPct: Number(x.passPct) || 80, status: x.status, content: x.content.trim(), fileId: x.fileId, quiz: x.quiz.map((z) => ({ q: z.q.trim(), options: z.options.map((o) => o.trim()), answer: z.answer })) };
    if (creating) return api.post<{ id: string }>('/courses', body);
    await api.put(`/courses/${curId}`, body);
    return { id: curId! };
  }, {
    success: (r) => (creating ? `Đã tạo ${r.id}` : `Đã lưu ${r.id}`),
    onDone: (r) => { setNewType(null); setSelId(r.id); setDraft(null); },
  });
  const attend = useAction((ids: string[]) => api.post<{ approvalId: string; count: number }>(`/courses/${curId}/attendance`, { agentIds: ids }), {
    success: (r) => ({ tone: 'success', title: `Đã tạo lô cộng điểm từ ${r.count} lượt ${cur?.type === 'event' ? 'check-in' : 'điểm danh'}`, body: `${r.approvalId} đã vào W13 Hàng chờ duyệt · BOD duyệt rồi mới ghi sổ cái.` }),
    onDone: () => { setPick([]); setPickKey((k) => k + 1); },
  });

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setUploading(true);
    try { const up = await uploadFile(f); setD({ fileId: up.id, fileName: up.name }); } catch (e) { toast({ tone: 'danger', title: 'Không tải được tệp', body: (e as Error).message }); } finally { setUploading(false); }
  };

  /* ---------- KPI ---------- */
  const open = courses.filter((c) => c.status === 'Đang mở').length;
  const totalPart = courses.reduce((t, c) => t + c.participants, 0);
  const totalPass = courses.reduce((t, c) => t + c.passed, 0);
  const retake = courses.reduce((t, c) => t + Math.max(0, c.participants - c.passed), 0);

  /* ---------- Tab nội dung ---------- */
  const qErrIdx = d ? quizErr(d.quiz) : -1;
  const formOk = !!d && !!d.name.trim() && qErrIdx < 0 && Number(d.passPct) > 0 && Number(d.passPct) <= 100;
  const infoTab = d ? (
    <div className="demo-grid">
      <Field label="Tên khoá học / sự kiện" required value={d.name} onChange={(e) => setD({ name: e.target.value })} error={d.name.trim() ? undefined : 'Cần tên'} placeholder="Ví dụ: Sản phẩm NOREVA mới 2026" />
      <div className="w19-two">
        <Field label="Hình thức" as="select" value={d.type} disabled={!creating} onChange={(e) => setD({ type: e.target.value as CType })}
          options={[{ value: 'offline', label: 'Offline (điểm danh)' }, { value: 'online', label: 'Online (video/PDF + quiz trên app)' }, { value: 'event', label: 'Sự kiện (QR check-in)' }]} hint={creating ? undefined : 'Không đổi hình thức sau khi tạo (mã KH/SK)'} />
        <Field label="Thời gian" value={d.date} onChange={(e) => setD({ date: e.target.value })} placeholder="15/10/2026 · Luôn mở · Hạn 31/12/2026" />
      </div>
      <div className="w19-three">
        <Field label="Điểm thưởng" value={d.points} onChange={(e) => setD({ points: e.target.value.replace(/\D/g, '') })} inputMode="numeric" suffix="điểm" hint={d.type === 'event' ? 'Quy tắc R08 · cần BOD duyệt' : 'Quy tắc R07 · cần BOD duyệt'} />
        <Field label="Ngưỡng đạt" value={d.passPct} onChange={(e) => setD({ passPct: e.target.value.replace(/\D/g, '') })} inputMode="numeric" suffix="%" error={Number(d.passPct) > 0 && Number(d.passPct) <= 100 ? undefined : '1–100%'} />
        <Field label="Trạng thái" as="select" value={d.status} onChange={(e) => setD({ status: e.target.value })} options={STATUSES} hint="Tạm ẩn = không hiện trên app" />
      </div>
      <Field as="textarea" label={d.type === 'online' ? 'Link video / nội dung bài học' : 'Mô tả / địa điểm'} value={d.content} onChange={(e) => setD({ content: e.target.value })}
        placeholder={d.type === 'online' ? 'https://… (video 18 phút) hoặc nội dung tóm tắt' : 'Đào tạo tại văn phòng Hà Nội, 2 giờ, có bài test cuối buổi.'} />
      <label className={'w19-file' + (d.fileId ? ' is-done' : '')}>
        <Icon name={d.fileId ? 'check' : 'upload'} size={20} />
        <span><b>{uploading ? 'Đang tải lên…' : d.fileId ? d.fileName || 'Đã đính kèm tài liệu' : 'Tải tài liệu (PDF, MP4, slide ≤ 15MB)'}</b>
          {d.fileId && <> · <a className="demo-link" href={fileUrl(d.fileId)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Mở tệp</a></>}</span>
        <input type="file" className="w19-hidden" accept=".pdf,.mp4,.ppt,.pptx,.doc,.docx,image/*" onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      {d.fileId && <div><Button variant="ghost" icon="x" onClick={() => setD({ fileId: null, fileName: '' })}>Gỡ tệp</Button></div>}
    </div>
  ) : cur && (
    <div className="demo-grid">
      <InfoGrid cols={2} items={[
        ['Hình thức', typeLabel(cur)], ['Thời gian', cur.date || '—'], ['Điểm thưởng', `${num(cur.points)} điểm · ${cur.rule}`], ['Ngưỡng đạt', `${cur.passPct}%`],
        ['Trạng thái', cur.status], ['Tài liệu', cur.fileId ? <a className="demo-link" href={fileUrl(cur.fileId)} target="_blank" rel="noreferrer">Mở tệp</a> : 'Không có'],
      ]} />
      {cur.content && <div><div className="dmp-field__label">Nội dung</div><div className="w19-content">{/^https?:\/\//.test(cur.content) ? <a className="demo-link" href={cur.content} target="_blank" rel="noreferrer">{cur.content}</a> : cur.content}</div></div>}
    </div>
  );

  /* ---------- Tab bài test ---------- */
  const quizSrc = d ? d.quiz : cur?.quiz ?? [];
  const passNeed = (n: number, pct: number) => Math.ceil((n * pct) / 100);
  const updQ = (i: number, patch: Partial<Quiz>) => setD({ quiz: d!.quiz.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
  const quizTab = (
    <div className="w19-qz">
      {!quizSrc.length && <EmptyState icon="book" title="Chưa có bài test" body={isMkt ? 'Thêm câu hỏi để đại lý làm bài trên app (M13). Sự kiện không bắt buộc bài test.' : 'Khoá này không có bài test.'} />}
      {quizSrc.map((x, i) => (d ? (
        <div key={i} className={'w19-q' + (i === qErrIdx ? ' has-err' : '')}>
          <div className="demo-between"><b>Câu {i + 1}/{quizSrc.length}</b>
            <Button variant="ghost" icon="x" onClick={() => setD({ quiz: d.quiz.filter((_, k) => k !== i) })}>Xoá câu</Button></div>
          <Field as="textarea" label="Câu hỏi" value={x.q} onChange={(e) => updQ(i, { q: e.target.value })} placeholder="Ví dụ: SPF50 phù hợp nhất cho trường hợp nào?" />
          <div className="dmp-field__label">Đáp án <span className="demo-sub">· chọn nút tròn ở đáp án đúng</span></div>
          {x.options.map((o, k) => (
            <div key={k} className={'w19-optedit' + (x.answer === k ? ' is-ok' : '')}>
              <input type="radio" name={`ans-${i}`} checked={x.answer === k} onChange={() => updQ(i, { answer: k })} aria-label={`Đáp án đúng ${k + 1}`} />
              <input className="dmp-field__ctl w19-optin" value={o} placeholder={`Lựa chọn ${k + 1}`} onChange={(e) => updQ(i, { options: x.options.map((v, j) => (j === k ? e.target.value : v)) })} />
              {x.options.length > 2 && <button type="button" className="dmp-iconbtn" aria-label="Xoá lựa chọn" onClick={() => updQ(i, { options: x.options.filter((_, j) => j !== k), answer: x.answer === k ? 0 : x.answer > k ? x.answer - 1 : x.answer })}><Icon name="x" size={16} /></button>}
            </div>
          ))}
          {x.options.length < 6 && <div><Button variant="ghost" icon="plus" onClick={() => updQ(i, { options: [...x.options, ''] })}>Thêm lựa chọn</Button></div>}
        </div>
      ) : (
        <div key={i} className="w19-q">
          <b>Câu {i + 1}/{quizSrc.length}. {x.q}</b>
          {x.options.map((o, k) => <div key={k} className={'w19-opt' + (k === x.answer ? ' is-ok' : '')}>{k === x.answer ? <Icon name="check" size={14} /> : <span className="w19-sp" />}{o}</div>)}
        </div>
      )))}
      {d && <div><Button icon="plus" onClick={() => setD({ quiz: [...d.quiz, blankQ()] })}>Thêm câu hỏi</Button></div>}
      {qErrIdx >= 0 && <div className="demo-note demo-note--warn"><Icon name="alert" size={16} />Câu {qErrIdx + 1} còn thiếu nội dung câu hỏi hoặc lựa chọn.</div>}
      {quizSrc.length > 0 && <div className="demo-sub">Đạt khi đúng ≥ {passNeed(quizSrc.length, Number(d?.passPct ?? cur?.passPct ?? 80))}/{quizSrc.length} câu ({d?.passPct ?? cur?.passPct}%) · mỗi khoá chỉ cộng điểm một lần · điểm chờ BOD duyệt.</div>}
    </div>
  );

  /* ---------- Tab điểm danh / QR ---------- */
  const attempts = cur?.attempts ?? [];
  const recorded = new Set(attempts.filter((a) => a.passed).map((a) => a.agentId));
  const checkins = attempts.filter((a) => a.method === 'qr' || a.method === 'attendance');
  const attendTab = cur && (
    <div className="demo-grid">
      <div className="w19-att">
        <div className="demo-grid w19-attnum">
          <span className="demo-muted">{cur.type === 'event' ? 'Đã check-in' : 'Đã điểm danh'}</span>
          <span className="w19-big">{num(checkins.length)}</span>
          <span className="demo-sub">{cur.type === 'event' ? 'QR check-in trên app chưa nối (giai đoạn sau) — tick danh sách tham dự từ file điểm danh.' : 'Tick đại lý có mặt buổi đào tạo.'}</span>
        </div>
        {isMkt && <div className="demo-note demo-note--muted"><Icon name="info" size={16} />Điểm danh tạo lô cộng {num(cur.points)} điểm/đại lý ({cur.rule}) và chờ BOD duyệt ở W13. Đại lý đã được ghi nhận sẽ không hiện trong danh sách.</div>}
      </div>
      {isMkt ? (agentsQ.isLoading ? <Loading /> : agentsQ.error ? <ErrorNote error={agentsQ.error} /> : (
        <>
          <DataTable key={pickKey + curId!} rows={(agentsQ.data ?? []).filter((a) => !recorded.has(a.id) && a.status !== 'locked')} rowKey="id" selectable onSelectionChange={(k) => setPick(k as string[])} itemLabel="đại lý" maxHeight={360}
            bulkActions={(sel) => [<Button key="a" variant="primary" icon="star" disabled={attend.isPending} onClick={() => attend.mutate(sel.map((a) => a.id))}>Tạo lô cộng điểm ({sel.length})</Button>]}
            columns={[
              { key: 'name', label: 'Đại lý', primary: true, render: (a) => <div><b>{a.name}</b><div className="demo-sub">{a.id} · {a.city}</div></div> },
              { key: 'tier', label: 'Hạng', render: (a) => <TierBadge tier={a.tier as Tier} /> },
              { key: 'type', label: 'Loại hình' },
              { key: 'saleName', label: 'Sale' },
            ]} />
          <div className="demo-between"><span className="demo-muted">{pick.length} đại lý đã chọn · {num(pick.length * cur.points)} điểm</span>
            <Button variant="primary" icon="star" disabled={!pick.length || attend.isPending} onClick={() => attend.mutate(pick)}>Tạo lô cộng điểm (gửi BOD duyệt)</Button></div>
        </>
      )) : <div className="demo-sub">Marketing điểm danh và tạo lô cộng điểm; vai trò {ROLE_LABEL[role]} chỉ xem.</div>}
    </div>
  );

  /* ---------- Tab kết quả ---------- */
  const resultTab = (
    <DataTable rows={attempts} rowKey="id" itemLabel="lượt" empty={<EmptyState icon="users" title="Chưa có lượt tham gia" body="Kết quả bài test và điểm danh sẽ hiện ở đây." />}
      columns={[
        { key: 'agentName', label: 'Đại lý', primary: true, render: (a) => <div><b>{a.agentName}</b><div className="demo-sub">{a.agentId}</div></div> },
        { key: 'tier', label: 'Hạng', render: (a) => <TierBadge tier={a.tier as Tier} /> },
        { key: 'method', label: 'Hình thức', render: (a) => METHOD[a.method] ?? a.method },
        { key: 'score', label: 'Điểm bài', align: 'right', render: (a) => (a.total ? `${a.score}/${a.total}` : '—') },
        { key: 'passed', label: 'Kết quả', render: (a) => <StatusBadge tone={a.passed ? 'success' : 'neutral'}>{a.passed ? 'Đạt' : 'Chưa đạt'}</StatusBadge> },
        { key: 'approvalId', label: 'Yêu cầu điểm', render: (a) => a.approvalId ?? <span className="demo-muted">—</span> },
        { key: 'createdAt', label: 'Thời gian', render: (a) => dateTime(a.createdAt) },
      ]} />
  );

  const certTab = cur && (
    <div className="demo-grid">
      <div className="demo-note"><Icon name="award" size={16} />Chứng nhận PDF có mã QR để khách hàng của đại lý quét kiểm tra. Hiệu lực 12 tháng — hết hạn thì đại lý được nhắc học lại.</div>
      <InfoGrid cols={2} items={[['Đã cấp', `${num(row?.passed ?? recorded.size)} chứng nhận`], ['Chưa đạt / cần học lại', num(Math.max(0, (row?.participants ?? 0) - (row?.passed ?? 0)))], ['Mẫu chứng nhận', 'Logo DMP + tên đại lý + mã QR'], ['Tự động nhắc', 'ZNS trước 30 ngày']]} />
    </div>
  );

  const tabs = [
    { key: 'info', label: 'Nội dung' },
    { key: 'quiz', label: 'Bài test', count: quizSrc.length || undefined },
    ...(!creating && needAttendance ? [{ key: 'attend', label: cur?.type === 'event' ? 'QR check-in' : 'Điểm danh' }] : []),
    ...(!creating ? [{ key: 'result', label: 'Kết quả', count: attempts.length || undefined }, { key: 'cert', label: 'Chứng nhận' }] : []),
  ];
  const curTab = tabs.some((t) => t.key === tab) ? tab : 'info';

  return (
    <AdminShell screen="W19"
      sub="Đại lý học trên app (M13). Đạt bài test ≥ ngưỡng thì tạo yêu cầu cộng điểm đào tạo (cần duyệt). Sự kiện dùng QR check-in làm danh sách cộng điểm hàng loạt."
      actions={isMkt ? <><Button icon="plus" onClick={() => create('event')}>Tạo sự kiện</Button><Button variant="primary" icon="plus" onClick={() => create('offline')}>Tạo khoá học</Button></> : undefined}>
      {q.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : (
        <div className="demo-grid">
          <div className="demo-grid demo-grid--4">
            <KpiCard label="Khoá học đang mở" value={open} />
            <KpiCard label="Lượt tham gia" value={num(totalPart)} hint={`${courses.length} khoá học / sự kiện`} />
            <KpiCard label="Tỷ lệ đạt" value={totalPart ? Math.round((totalPass / totalPart) * 100) + '%' : '—'} hint={`${num(totalPass)} đại lý đạt`} />
            <KpiCard label="Cần học lại" value={num(retake)} tone={retake ? 'warning' : undefined} hint="Đã làm bài nhưng chưa đạt" />
          </div>
          <DataTable rows={courses} rowKey="id" onRowClick={(c) => select(c.id, c.type)} itemLabel="khoá"
            empty={<EmptyState icon="book" title="Chưa có khoá học" body={isMkt ? 'Bấm "Tạo khoá học" hoặc "Tạo sự kiện" để bắt đầu.' : 'Marketing sẽ tạo khoá học và sự kiện.'} />}
            columns={[
              { key: 'name', label: 'Khoá học / sự kiện', primary: true, render: (c) => <div className="w19-name"><div className={'demo-strong' + (c.id === curId ? ' w19-sel' : '')}>{c.name}</div><div className="demo-sub">{c.id} · {typeLabel(c)}</div></div> },
              { key: 'date', label: 'Thời gian', render: (c) => c.date || '—' },
              { key: 'points', label: 'Điểm', align: 'right', render: (c) => <PointValue value={c.points} /> },
              { key: 'pass', label: 'Đạt / tham gia', align: 'right', render: (c) => `${num(c.passed)}/${num(c.participants)}` },
              { key: 'status', label: 'Trạng thái', render: (c) => <StatusBadge tone={c.status === 'Đang mở' ? 'success' : 'neutral'}>{c.status}</StatusBadge> },
            ]} />
          <div ref={detailRef} className="w19-detail">
            {(creating || curId) && (
              <Card title={creating ? (newType === 'event' ? 'Sự kiện mới' : 'Khoá học mới') : cur?.name ?? row?.name ?? 'Đang tải…'}
                subtitle={creating ? 'Chưa lưu' : cur ? `${cur.id} · ${typeLabel(cur)}` : undefined}
                actions={isMkt && (creating || dirty) ? <div className="demo-row"><Button onClick={() => { setDraft(null); setNewType(null); }}>Huỷ</Button><Button variant="primary" icon="check" disabled={!formOk || save.isPending} onClick={() => save.mutate()}>{creating ? 'Tạo' : 'Lưu thay đổi'}</Button></div> : undefined}>
                {!creating && detQ.isLoading ? <Loading /> : detQ.error ? <ErrorNote error={detQ.error} /> : (
                  <>
                    <div className="w19-tabs"><Tabs value={curTab} onChange={setTab} items={tabs} /></div>
                    <div className="w19-pane">
                      {curTab === 'info' && infoTab}
                      {curTab === 'quiz' && quizTab}
                      {curTab === 'attend' && attendTab}
                      {curTab === 'result' && resultTab}
                      {curTab === 'cert' && certTab}
                    </div>
                    {isMkt && (curTab === 'info' || curTab === 'quiz') && (
                      <div className="w19-foot">
                        <span className="demo-sub">{dirty ? 'Có thay đổi chưa lưu' : 'Sửa trực tiếp rồi bấm Lưu'}</span>
                        <Button variant="primary" icon="check" disabled={!formOk || !dirty || save.isPending} onClick={() => save.mutate()}>{creating ? 'Tạo' : 'Lưu thay đổi'}</Button>
                      </div>
                    )}
                  </>
                )}
              </Card>
            )}
          </div>
        </div>
      )}
    </AdminShell>
  );
}
