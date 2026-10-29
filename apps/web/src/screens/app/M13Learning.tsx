import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Celebration, EmptyState, Icon, PointValue, StatusBadge, TierIcon, type IconName, type Tier } from '../../ds';
import { PhoneFrame } from '../../shell/PhoneFrame';
import { InfoGrid } from '../../shell/charts';
import { appApi, fileUrl } from '../../lib/api';
import { ErrorNote, Loading, useAction, useApi } from '../../lib/hooks';
import { date, num } from '../../lib/fmt';
import './M13Learning.css';

interface Course {
  id: string; name: string; type: 'online' | 'offline' | 'event'; date: string; points: number; rule: string; content: string; fileId: string | null;
  passPct: number; status: string; createdAt: string; questions: number; attempts: number; passed: boolean; bestScore: string | null; certificateAt: string | null;
}
interface CourseDetail extends Omit<Course, 'questions' | 'attempts' | 'passed' | 'bestScore' | 'certificateAt'> { quiz: Array<{ q: string; options: string[] }> }
interface AttemptRes { score: number; total: number; passed: boolean; passPct: number; pointsPending: number; alreadyAwarded: boolean }
interface HomeLite { agent: { id: string; name: string; tier: Tier } }

const TYPE: Record<Course['type'], { label: string; icon: IconName }> = {
  online: { label: 'Học online', icon: 'book' },
  offline: { label: 'Đào tạo tại lớp', icon: 'users' },
  event: { label: 'Sự kiện', icon: 'calendar' },
};
const isUrl = (s: string) => /^https?:\/\//.test(s.trim());
function youtubeEmbed(u: string) {
  const m = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/);
  return m ? `https://www.youtube-nocookie.com/embed/${m[1]}` : null;
}
function progressText(c: Course) {
  if (c.passed) return `Hoàn thành${c.bestScore ? ' · đạt ' + c.bestScore : ''}`;
  if (c.attempts) return `Đã làm ${c.attempts} lần · cao nhất ${c.bestScore}`;
  if (c.questions) return c.status === 'Đang mở' ? `Chưa làm bài test (${c.questions} câu)` : 'Đã đóng';
  return c.type === 'event' ? 'Điểm danh bằng mã QR tại sự kiện' : 'Điểm danh tại lớp';
}

/** M13 Học tập — danh sách khoá → nội dung → bài test → kết quả (đạt thì gửi yêu cầu cộng điểm) → chứng nhận. */
export default function M13Learning() {
  const [sp, setSp] = useSearchParams();
  const cid = sp.get('c');
  const view = cid ? (sp.get('v') ?? 'detail') : 'list';
  const go = (c: string | null, v?: string) => setSp(c ? { c, ...(v ? { v } : {}) } : {});

  const list = useApi<Course[]>('/app/courses', { realm: 'app' });
  const home = useApi<HomeLite>('/app/home', { realm: 'app' });
  const detail = useApi<CourseDetail>(cid && (view === 'detail' || view === 'quiz') ? `/app/courses/${cid}` : null, { realm: 'app' });
  const course = list.data?.find((c) => c.id === cid);

  const [answers, setAnswers] = useState<number[]>([]);
  const [qi, setQi] = useState(0);
  const [result, setResult] = useState<(AttemptRes & { courseId: string }) | null>(null);

  const submit = useAction((v: { id: string; answers: number[] }) => appApi.post<AttemptRes>(`/app/courses/${v.id}/attempt`, { answers: v.answers }), {
    realm: 'app',
    onDone: (r, v) => { setResult({ ...r, courseId: v.id }); setSp({ c: v.id, v: 'result' }, { replace: true }); },
  });

  function startQuiz() { setAnswers([]); setQi(0); go(cid, 'quiz'); }

  const tier = home.data?.agent.tier ?? 'gold';
  const earned = (list.data ?? []).filter((c) => c.passed).reduce((t, c) => t + c.points, 0);
  let title = 'Học tập';
  let body;

  if (list.isLoading) body = <Loading />;
  else if (list.error) body = <ErrorNote error={list.error} />;
  else if (view === 'list') {
    const rows = list.data ?? [];
    body = (
      <>
        <div className="demo-acard m13-sum">
          <div className="demo-between"><b>Điểm đào tạo đã đạt</b><PointValue value={earned} /></div>
          <span className="m13-sub">Đạt bài test để nhận điểm thưởng. Mỗi khoá chỉ cộng điểm một lần, sau khi DMP duyệt.</span>
        </div>
        {rows.length ? rows.map((c) => (
          <button type="button" key={c.id} className="m13-course" onClick={() => go(c.id, c.passed ? 'cert' : undefined)}>
            <span className={'m13-thumb' + (c.passed ? ' is-done' : '')}><Icon name={c.passed ? 'award' : TYPE[c.type]?.icon ?? 'book'} size={28} /></span>
            <span className="m13-course__m">
              <b>{c.name}</b>
              <span className="m13-sub">{TYPE[c.type]?.label ?? c.type} · {c.date}</span>
              <span className="m13-prog"><i style={{ width: c.passed ? '100%' : c.attempts ? '50%' : '0%' }} /></span>
              <span className="m13-sub">{progressText(c)}{c.points ? ` · +${num(c.points)} điểm` : ''}</span>
            </span>
            <Icon name="chevronRight" size={20} />
          </button>
        )) : <EmptyState icon="book" title="Chưa có khoá học nào" body="Khoá học và sự kiện mới sẽ được thông báo qua app và Zalo." />}
      </>
    );
  } else if (!course) {
    body = <EmptyState icon="book" title="Không tìm thấy khoá học" action={<Button size="lg" onClick={() => go(null)}>Về danh sách khoá học</Button>} />;
  } else if (view === 'detail') {
    title = TYPE[course.type]?.label ?? 'Khoá học';
    const d = detail.data;
    const embed = d && isUrl(d.content) ? youtubeEmbed(d.content) : null;
    const canQuiz = !!d?.quiz.length && course.status === 'Đang mở';
    body = detail.isLoading ? <Loading /> : detail.error || !d ? <ErrorNote error={detail.error} /> : (
      <>
        {embed ? (
          <div className="m13-video"><iframe src={embed} title={d.name} allow="encrypted-media; picture-in-picture" allowFullScreen /></div>
        ) : (
          <div className="m13-video m13-video--ph"><Icon name={TYPE[course.type]?.icon ?? 'book'} size={44} strokeWidth={1.6} /></div>
        )}
        <b className="m13-title">{d.name}</b>
        <div className="demo-row">
          <StatusBadge tone={course.passed ? 'success' : course.status === 'Đang mở' ? 'info' : 'neutral'}>{course.passed ? 'Đã hoàn thành' : course.status}</StatusBadge>
          <span className="m13-sub">{d.date}</span>
        </div>
        {!isUrl(d.content) && d.content && <p className="m13-text">{d.content}</p>}
        {isUrl(d.content) && !embed && <a className="m13-open" href={d.content} target="_blank" rel="noreferrer"><Button size="lg" block icon="link">Mở nội dung khoá học</Button></a>}
        {isUrl(d.content) && embed && <a className="demo-link m13-alt" href={d.content} target="_blank" rel="noreferrer">Không xem được? Mở video trong trình duyệt ↗</a>}
        {d.fileId && <a className="m13-open" href={fileUrl(d.fileId, 'app')} target="_blank" rel="noreferrer"><Button size="lg" block icon="file">Mở tài liệu</Button></a>}
        <InfoGrid cols={2} items={[
          ['Điểm thưởng', d.points ? '+' + num(d.points) : '—'],
          ['Bài test', d.quiz.length ? `${d.quiz.length} câu` : 'Không có'],
          !!d.quiz.length && ['Điểm đạt', `≥ ${d.passPct}%`],
          !!course.bestScore && ['Kết quả cao nhất', course.bestScore],
        ]} />
        {course.passed && <Button variant="primary" size="lg" block icon="award" onClick={() => go(course.id, 'cert')}>Xem chứng nhận</Button>}
        {canQuiz && <Button variant={course.passed ? 'secondary' : 'primary'} size="lg" block icon="edit" onClick={startQuiz}>{course.passed ? 'Làm lại bài test' : course.attempts ? 'Làm lại bài test' : `Làm bài test (${d.quiz.length} câu)`}</Button>}
        {canQuiz && course.passed && <div className="demo-note demo-note--muted"><Icon name="info" size={16} />Khoá này đã được ghi nhận điểm — làm lại chỉ để ôn tập.</div>}
        {!d.quiz.length && <div className="demo-note demo-note--muted"><Icon name="info" size={16} />{course.type === 'event' ? 'Điểm được ghi nhận khi check-in bằng mã QR tại sự kiện.' : 'Điểm được ghi nhận theo danh sách điểm danh của DMP.'}</div>}
        {!!d.quiz.length && course.status !== 'Đang mở' && !course.passed && <div className="demo-note demo-note--muted"><Icon name="lock" size={16} />Bài test của khoá này đã đóng.</div>}
      </>
    );
  } else if (view === 'quiz') {
    title = 'Bài test';
    const d = detail.data;
    if (detail.isLoading) body = <Loading />;
    else if (detail.error || !d || !d.quiz.length) body = <ErrorNote error={detail.error ?? new Error('Khoá này không có bài kiểm tra')} />;
    else {
      const n = d.quiz.length;
      const i = Math.min(qi, n - 1);
      const cur = d.quiz[i];
      const last = i === n - 1;
      const done = answers.filter((a) => a != null).length;
      body = (
        <>
          <div className="m13-dots" aria-hidden>{d.quiz.map((_, k) => <i key={k} className={answers[k] != null ? 'on' : k === i ? 'cur' : ''} />)}</div>
          <span className="m13-sub m13-qn">Câu {i + 1}/{n} · {d.name}</span>
          <b className="m13-q">{cur.q}</b>
          <div className="m13-opts" role="radiogroup" aria-label={cur.q}>
            {cur.options.map((o, k) => {
              const on = answers[i] === k;
              return (
                <button type="button" role="radio" aria-checked={on} key={k} className={'m13-opt' + (on ? ' is-on' : '')}
                  onClick={() => setAnswers((a) => { const x = [...a]; x[i] = k; return x; })}>
                  <span className="m13-opt__k">{String.fromCharCode(65 + k)}</span>{o}
                </button>
              );
            })}
          </div>
          <div className="m13-spacer" />
          {last ? (
            <Button variant="primary" size="lg" block icon="send" disabled={done < n || submit.isPending} onClick={() => submit.mutate({ id: d.id, answers: d.quiz.map((_, k) => answers[k] ?? -1) })}>
              {submit.isPending ? 'Đang chấm…' : done < n ? `Còn ${n - done} câu chưa trả lời` : 'Nộp bài'}
            </Button>
          ) : (
            <Button variant="primary" size="lg" block disabled={answers[i] == null} onClick={() => setQi(i + 1)}>Câu tiếp</Button>
          )}
          {i > 0 && <Button size="lg" block onClick={() => setQi(i - 1)}>Câu trước</Button>}
        </>
      );
    }
  } else if (view === 'result') {
    title = 'Kết quả';
    if (!result || result.courseId !== course.id) body = <EmptyState icon="award" title="Chưa có kết quả" action={<Button size="lg" onClick={() => go(course.id)}>Về khoá học</Button>} />;
    else if (result.passed) body = (
      <Celebration icon="award" tier={tier} title={`Đạt ${result.score}/${result.total} câu!`}
        body={result.pointsPending ? `Yêu cầu cộng +${num(result.pointsPending)} điểm đào tạo đã gửi DMP duyệt. Điểm sẽ vào sổ sau khi được duyệt.`
          : result.alreadyAwarded ? 'Khoá này đã được ghi nhận điểm trước đó — lần làm này chỉ để ôn tập.' : 'Chúc mừng Quý đại lý đã hoàn thành khoá học.'}
        action={<div className="m13-actions">
          <Button variant="primary" size="lg" block icon="award" onClick={() => setSp({ c: course.id, v: 'cert' }, { replace: true })}>Xem chứng nhận</Button>
          <Button size="lg" block onClick={() => go(null)}>Về danh sách khoá học</Button>
        </div>} />
    );
    else body = (
      <div className="m13-fail">
        <span className="m13-fail__ic"><Icon name="refresh" size={32} /></span>
        <b className="m13-title">Chưa đạt: {result.score}/{result.total} câu</b>
        <span className="m13-text">Cần đúng từ {result.passPct}% trở lên ({Math.ceil(result.total * result.passPct / 100)}/{result.total} câu). Xem lại nội dung rồi làm lại — không giới hạn số lần.</span>
        <Button variant="primary" size="lg" block icon="refresh" onClick={() => { setAnswers([]); setQi(0); setSp({ c: course.id, v: 'quiz' }, { replace: true }); }}>Làm lại bài test</Button>
        <Button size="lg" block onClick={() => setSp({ c: course.id }, { replace: true })}>Xem lại nội dung</Button>
      </div>
    );
  } else if (view === 'cert') {
    title = 'Chứng nhận';
    const at = course.certificateAt;
    body = !course.passed ? (
      <EmptyState icon="award" title="Chưa có chứng nhận" body="Hoàn thành bài test của khoá học để nhận chứng nhận." action={<Button size="lg" onClick={() => go(course.id)}>Về khoá học</Button>} />
    ) : (
      <>
        <div className="m13-cert">
          <TierIcon tier={tier} size={52} />
          <span className="m13-cert__k">Chứng nhận hoàn thành</span>
          <b className="m13-title">{course.name}</b>
          <span>Cấp cho</span>
          <b className="m13-cert__who">{home.data?.agent.name ?? '—'}</b>
          {course.bestScore && <span className="m13-sub">Kết quả {course.bestScore}</span>}
          <span className="m13-sub">Cấp ngày {date(at)} · mã CN-{at ? new Date(at).getFullYear() : ''}-{course.id}-{home.data?.agent.id ?? ''}</span>
          <span className="m13-sub">DMP Việt Pháp</span>
        </div>
        <Button size="lg" block icon="printer" onClick={() => window.print()}>In / lưu PDF</Button>
        <Button size="lg" block onClick={() => go(course.id)}>Xem nội dung khoá học</Button>
      </>
    );
  }

  return <PhoneFrame title={title} back>{body}</PhoneFrame>;
}
