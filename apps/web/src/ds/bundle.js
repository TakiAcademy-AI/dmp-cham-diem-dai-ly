/* Bộ component DMP (chuyển từ DMP_VietPhap_DesignSystem/assets/bundle.js sang ES module — không sửa logic). */
import React from 'react';
var __api;
/* @ds-bundle: {"format":4,"namespace":"DMP","components":[{"name":"Button"},{"name":"TierBadge"},{"name":"TierIcon"},{"name":"StatusBadge"},{"name":"PointValue"},{"name":"PointFunds"},{"name":"TierProgress"},{"name":"KpiCard"},{"name":"DataTable"},{"name":"MaskedField"},{"name":"ApprovalStepper"},{"name":"PointBreakdown"},{"name":"QuickView"},{"name":"EmptyState"},{"name":"Toast"},{"name":"GiftCard"},{"name":"Sidebar"},{"name":"TopBar"},{"name":"RoleSwitcher"},{"name":"BottomNav"},{"name":"Celebration"},{"name":"Tabs"},{"name":"Card"},{"name":"Field"},{"name":"FilterChip"},{"name":"OtpInput"},{"name":"Pagination"},{"name":"Icon"}]} */
(function () {
  var h = React.createElement;
  var useState = React.useState;

  function cx() { return Array.prototype.filter.call(arguments, Boolean).join(' '); }
  function assign(t) { for (var i = 1; i < arguments.length; i++) { var s = arguments[i]; if (s) for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = s[k]; } return t; }
  function omit(o, keys) { var r = {}; for (var k in o) if (keys.indexOf(k) < 0) r[k] = o[k]; return r; }

  /* ---------- Định dạng số, tiền, ngày (mục 6.3) ---------- */
  function formatNumber(n) {
    var v = Math.round(Math.abs(Number(n) || 0));
    var s = String(v).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (n < 0 ? '−' : '') + s;
  }
  function formatVND(n) { return formatNumber(n) + 'đ'; }
  function formatMillion(n) {
    var m = Math.round((Number(n) || 0) / 1e5) / 10;
    return String(m).replace('.', ',') + ' triệu';
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toDate(d) { return d instanceof Date ? d : new Date(d); }
  function formatDate(d) { var x = toDate(d); return pad(x.getDate()) + '/' + pad(x.getMonth() + 1) + '/' + x.getFullYear(); }
  function formatDateTime(d) { var x = toDate(d); return formatDate(x) + ' ' + pad(x.getHours()) + ':' + pad(x.getMinutes()); }

  /* ---------- Quy ước che dữ liệu (mục 4.3) ---------- */
  function digits(s) { return String(s || '').replace(/\D/g, ''); }
  function maskPhone(p) { var s = digits(p); return s.slice(0, 4) + ' *** ' + s.slice(-3); }
  function maskIdCard(id) { var s = digits(id); return s.slice(0, 4) + '******' + s.slice(-2); }
  function maskBirthday(d) { var s = String(d || ''); return s.slice(0, 6) + '****'; }
  function maskBank(a) { var s = digits(a); return '**' + s.slice(-2); }

  /* ---------- Icon (nét 1.8, 24×24) ---------- */
  var ICONS = {
    home: 'M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z',
    users: 'M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20 M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M22 20v-1.5a4 4 0 0 0-3-3.9 M16 4.1a3.5 3.5 0 0 1 0 6.8',
    user: 'M20 21v-1a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v1 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    file: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z M14 3v5h5 M9 13h6 M9 17h6',
    box: 'M21 8 12 3 3 8v8l9 5 9-5z M3 8l9 5 9-5 M12 13v8',
    cart: 'M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L20 8H6 M9 21a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M17 21a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
    star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3l-5.5 2.9 1-6.2L3 9.6l6.2-.9z',
    gift: 'M3 8h18v4H3z M5 12v9h14v-9 M12 8v13 M12 8S10.5 3 8 3a2.5 2.5 0 0 0 0 5 M12 8s1.5-5 4-5a2.5 2.5 0 0 1 0 5',
    wallet: 'M3 7a2 2 0 0 1 2-2h13v4 M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2 M16 14.5h.01',
    book: 'M4 19.5V5a2 2 0 0 1 2-2h14v16H6.5A2.5 2.5 0 0 0 4 21.5 M4 19.5A2.5 2.5 0 0 1 6.5 17H20',
    bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M10.3 21a1.94 1.94 0 0 0 3.4 0',
    chart: 'M3 3v18h18 M7 15l4-4 3 3 5-6',
    sliders: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6',
    lock: 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4',
    eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    eyeOff: 'M3 3l18 18 M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9 M6.6 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6 M9.9 9.9a3 3 0 0 0 4.2 4.2',
    phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z',
    chat: 'M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z',
    check: 'M5 12.5l4.5 4.5L19 7',
    x: 'M6 6l12 12 M18 6L6 18',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M21 21l-5-5',
    alert: 'M12 3 2 20h20z M12 10v4 M12 17h.01',
    clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2',
    moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
    info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v5 M12 8h.01',
    plus: 'M12 5v14 M5 12h14',
    chevronRight: 'M9 6l6 6-6 6',
    download: 'M12 3v12 M7 10l5 5 5-5 M4 21h16',
    history: 'M3 12a9 9 0 1 0 3-6.7L3 8 M3 3v5h5 M12 7v5l3 2',
    award: 'M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12z M8.5 14 7 22l5-3 5 3-1.5-8',
    send: 'M22 2 11 13 M22 2l-7 20-4-9-9-4z',
    upload: 'M12 15V3 M7 8l5-5 5 5 M4 21h16',
    printer: 'M6 9V3h12v6 M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2 M6 14h12v7H6z',
    filter: 'M3 5h18l-7 8v6l-4 2v-8z',
    edit: 'M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
    shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M9 12l2 2 4-4',
    logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
    qr: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h3v3h-3z M20 14v.01 M14 20h.01 M17 20h4v-3',
    image: 'M4 4h16v16H4z M4 16l5-5 4 4 3-3 4 4 M15 9h.01',
    link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7 M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
    refresh: 'M21 12a9 9 0 1 1-2.6-6.4L21 8 M21 3v5h-5',
    calendar: 'M4 5h16v16H4z M4 10h16 M8 3v4 M16 3v4',
    arrowLeft: 'M19 12H5 M11 6l-6 6 6 6',
    minus: 'M5 12h14',
    trend: 'M3 17l6-6 4 4 8-8 M15 7h6v6',
    handover: 'M7 7h13l-3-3 M17 17H4l3 3',
    smartphone: 'M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z M11 18h2'
  };
  function Icon(p) {
    var d = ICONS[p.name] || '';
    var size = p.size || 18;
    var segs = d.split(' M');
    return h('svg', {
      className: cx('dmp-icon', p.className), width: size, height: size, viewBox: '0 0 24 24',
      fill: 'none', stroke: 'currentColor', strokeWidth: p.strokeWidth || 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
      'aria-hidden': p.label ? undefined : 'true', role: p.label ? 'img' : undefined, 'aria-label': p.label
    }, segs.map(function (s, i) { return h('path', { key: i, d: (i ? 'M' : '') + s }); }));
  }

  /* ---------- Button ---------- */
  function Button(p) {
    var variant = p.variant || 'secondary', size = p.size || 'md';
    var rest = omit(p, ['variant', 'size', 'icon', 'children', 'className', 'block']);
    return h('button', assign({ type: 'button' }, rest, {
      className: cx('dmp-btn', 'dmp-btn--' + variant, 'dmp-btn--' + size, p.block && 'dmp-btn--block', p.className)
    }), p.icon && h(Icon, { name: p.icon, size: size === 'lg' ? 20 : 16 }), p.children != null && p.children !== false && h('span', { className: 'dmp-btn__label' }, p.children));
  }

  /* ---------- Icon hạng ---------- */
  var TIER_LABELS = { member: 'Thành viên', bronze: 'Đồng', silver: 'Bạc', gold: 'Vàng', diamond: 'Kim Cương', strategic: 'Đối tác chiến lược' };
  function v(n) { return 'var(--' + n + ')'; }
  function medal(fill, ink, inner) {
    return [
      h('path', { key: 'r1', d: 'M6.5 1.5h4.2l2 5.6H8.5z', fill: ink }),
      h('path', { key: 'r2', d: 'M17.5 1.5h-4.2l-2 5.6h4.2z', fill: ink, opacity: 0.75 }),
      h('circle', { key: 'd', cx: 12, cy: 14.6, r: 7.6, fill: fill, stroke: ink, strokeWidth: 1.4 }),
      h('circle', { key: 'd2', cx: 12, cy: 14.6, r: 5.4, fill: 'none', stroke: ink, strokeWidth: 0.9, opacity: 0.45 })
    ].concat(inner);
  }
  var TIER_ICON = {
    member: function () { return [
      h('circle', { key: 'c', cx: 12, cy: 12, r: 10, fill: v('tier-member'), stroke: v('tier-member-ink'), strokeWidth: 1.4 }),
      h('circle', { key: 'h', cx: 12, cy: 9.6, r: 3, fill: v('tier-member-ink') }),
      h('path', { key: 'b', d: 'M6.6 17.6a5.4 5.4 0 0 1 10.8 0z', fill: v('tier-member-ink') })]; },
    bronze: function () { return medal(v('tier-bronze'), v('tier-bronze-ink'), [
      h('path', { key: 'i', d: 'M8.8 16.2 12 13.2l3.2 3', fill: 'none', stroke: v('tier-bronze-ink'), strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' })]); },
    silver: function () { return medal(v('tier-silver'), v('tier-silver-ink'), [
      h('path', { key: 'i', d: 'M8.8 14.6 12 11.8l3.2 2.8 M8.8 18 12 15.2l3.2 2.8', fill: 'none', stroke: v('tier-silver-ink'), strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' })]); },
    gold: function () { return medal(v('tier-gold'), v('tier-gold-ink'), [
      h('path', { key: 'i', d: 'M12 10.6l1.25 2.55 2.8.4-2.03 1.98.48 2.8L12 17.01l-2.5 1.32.48-2.8-2.03-1.98 2.8-.4z', fill: v('tier-gold-ink') })]); },
    diamond: function () { return [
      h('path', { key: 'g', d: 'M6.2 3.5h11.6L22 9 12 21 2 9z', fill: v('tier-diamond'), stroke: v('tier-diamond-ink'), strokeWidth: 1.4, strokeLinejoin: 'round' }),
      h('path', { key: 'f', d: 'M2.4 9h19.2 M8.8 3.6 7.2 9 12 20.6 16.8 9l-1.6-5.4 M7.2 9 12 3.6 16.8 9', fill: 'none', stroke: v('on-fill'), strokeWidth: 1.1, strokeLinejoin: 'round', opacity: 0.85 })]; },
    strategic: function () { return [
      h('path', { key: 'c', d: 'M3 7.5l4.6 4.2L12 4.5l4.4 7.2L21 7.5l-1.8 10.5H4.8z', fill: v('tier-gold'), stroke: v('tier-gold-ink'), strokeWidth: 1.3, strokeLinejoin: 'round' }),
      h('rect', { key: 'b', x: 4.6, y: 18.6, width: 14.8, height: 2.6, rx: 1.3, fill: v('tier-gold'), stroke: v('tier-gold-ink'), strokeWidth: 1.1 }),
      h('circle', { key: 'j', cx: 12, cy: 13.4, r: 1.6, fill: v('tier-strategic') })]; }
  };
  function TierIcon(p) {
    var t = TIER_ICON[p.tier] ? p.tier : 'member';
    var size = p.size || 20;
    return h('svg', { className: cx('dmp-tiericon', p.className), width: size, height: size, viewBox: '0 0 24 24', role: p.label ? 'img' : undefined, 'aria-label': p.label, 'aria-hidden': p.label ? undefined : 'true' }, TIER_ICON[t]());
  }

  /* ---------- Badge hạng ---------- */
  function TierBadge(p) {
    var t = p.tier || 'member';
    return h('span', { className: cx('dmp-tier', 'dmp-tier--' + t, p.size === 'lg' && 'dmp-tier--lg', p.className) },
      h(TierIcon, { tier: t, size: p.size === 'lg' ? 22 : 17 }),
      h('span', { className: 'dmp-tier__label' }, p.label || TIER_LABELS[t]));
  }

  /* ---------- Badge trạng thái ---------- */
  var STATUS_ICON = { success: 'check', danger: 'alert', warning: 'clock', dormant: 'moon', pending: 'clock', info: 'info', neutral: null, 'new': null };
  function StatusBadge(p) {
    var tone = p.tone || 'neutral';
    var icon = p.icon === undefined ? STATUS_ICON[tone] : p.icon;
    return h('span', { className: cx('dmp-status', 'dmp-status--' + tone, p.className) },
      icon && h(Icon, { name: icon, size: 13, strokeWidth: 2.2 }), p.children);
  }

  /* ---------- Số điểm ---------- */
  function PointValue(p) {
    var v = Number(p.value) || 0, state = p.state || 'available';
    var signed = p.signed !== false;
    var tone = state === 'pending' ? 'pending' : (state === 'expired' || state === 'revoked') ? 'void' : v < 0 ? 'minus' : (signed && v > 0 ? 'plus' : 'plain');
    var text = (signed && v > 0 ? '+' : '') + formatNumber(v);
    return h('span', { className: cx('dmp-points', 'dmp-points--' + tone, p.size && 'dmp-points--' + p.size, p.className) },
      text,
      p.unit !== false && h('span', { className: 'dmp-points__unit' }, p.unit || 'điểm'),
      state === 'pending' && p.showState !== false && h('span', { className: 'dmp-points__state' }, 'đang chờ'),
      state === 'expired' && h('span', { className: 'dmp-points__state' }, 'hết hạn'),
      state === 'revoked' && h('span', { className: 'dmp-points__state' }, 'thu hồi'));
  }

  /* ---------- Hai quỹ điểm ---------- */
  function PointFunds(p) {
    var rankLabel = p.rankLabel || 'Điểm hạng', rewardLabel = p.rewardLabel || 'Điểm thưởng';
    var emph = p.emphasis || 'none';
    function cell(kind, label, value, note, extra) {
      var Tag = p.onExplain ? 'button' : 'div';
      var props = { className: cx('dmp-funds__cell', emph === kind && 'is-emph') };
      if (p.onExplain) { props.type = 'button'; props.onClick = function () { p.onExplain(kind); }; props['aria-label'] = label + ': ' + formatNumber(value) + ' điểm. Xem cách tính'; }
      return h(Tag, props,
        h('span', { className: 'dmp-funds__label' }, h(Icon, { name: kind === 'rank' ? 'award' : 'star', size: 16 }), label,
          p.onExplain && h(Icon, { name: 'info', size: 14, className: 'dmp-funds__why' })),
        h('span', { className: 'dmp-funds__value' }, formatNumber(value)),
        note && h('span', { className: 'dmp-funds__note' }, note),
        extra);
    }
    return h('div', { className: cx('dmp-funds', p.className) },
      cell('rank', rankLabel, p.rank, p.rankNote || 'Dùng để xét hạng, không bị trừ khi đổi quà'),
      cell('reward', rewardLabel, p.reward, p.rewardNote || 'Dùng để đổi quà',
        p.pending ? h('span', { className: 'dmp-funds__pending' }, '+' + formatNumber(p.pending) + ' điểm đang chờ') : null));
  }

  /* ---------- Thanh tiến độ lên hạng ---------- */
  function TierProgress(p) {
    var value = Number(p.value) || 0, target = Number(p.target) || 0;
    var pct = target > 0 ? Math.max(0, Math.min(100, value / target * 100)) : 100;
    var remain = Math.max(0, target - value);
    var unit = p.unit || 'points';
    var msg;
    if (!p.nextTier) msg = 'Quý đại lý đang ở hạng cao nhất';
    else if (unit === 'vnd') msg = h(React.Fragment, null, 'Còn ', h('strong', null, formatVND(remain)), ' doanh số nữa để lên hạng ', TIER_LABELS[p.nextTier] || p.nextTier);
    else msg = h(React.Fragment, null, 'Còn ', h('strong', null, formatNumber(remain) + ' điểm'), ' để lên hạng ', TIER_LABELS[p.nextTier] || p.nextTier);
    var fmt = unit === 'vnd' ? formatVND : function (n) { return formatNumber(n) + ' điểm'; };
    return h('div', { className: cx('dmp-progress', p.compact && 'dmp-progress--compact', p.className) },
      !p.compact && h('div', { className: 'dmp-progress__head' },
        p.tier && h(TierBadge, { tier: p.tier }),
        h('span', { className: 'dmp-progress__nums' }, (target ? formatNumber(value) + ' / ' : '') + fmt(target || value)),
        p.nextTier && h(TierBadge, { tier: p.nextTier })),
      h('div', { className: 'dmp-progress__track', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(pct), 'aria-label': 'Tiến độ lên hạng' },
        h('div', { className: 'dmp-progress__fill', style: { width: pct + '%' } })),
      h('div', { className: 'dmp-progress__msg' }, msg),
      p.footnote && h('div', { className: 'dmp-progress__foot' }, p.footnote));
  }

  /* ---------- Thẻ KPI ---------- */
  function KpiCard(p) {
    var d = p.delta;
    var Tag = p.onClick ? 'button' : 'div';
    return h(Tag, { className: cx('dmp-kpi', p.tone && 'dmp-kpi--' + p.tone, p.onClick && 'is-clickable', p.className), onClick: p.onClick, type: p.onClick ? 'button' : undefined },
      h('span', { className: 'dmp-kpi__label' }, p.label),
      h('span', { className: 'dmp-kpi__value' }, p.value),
      (d != null || p.hint) && h('span', { className: 'dmp-kpi__foot' },
        d != null && h('span', { className: d >= 0 ? 'dmp-kpi__delta--up' : 'dmp-kpi__delta--down' },
          (d >= 0 ? '▲ +' : '▼ −') + String(Math.abs(d)).replace('.', ',') + '%'),
        d != null && h('span', null, p.deltaLabel || 'so cùng kỳ'),
        p.hint && h('span', null, p.hint)));
  }

  /* ---------- Bảng dữ liệu ---------- */
  function DataTable(p) {
    var rows = p.rows || [], cols = p.columns || [];
    var keyOf = function (r, i) { return r[p.rowKey || 'id'] != null ? r[p.rowKey || 'id'] : i; };
    var st = useState(p.defaultSelected || []), sel = st[0], setSel = st[1];
    function toggle(k) { var n = sel.indexOf(k) >= 0 ? sel.filter(function (x) { return x !== k; }) : sel.concat([k]); setSel(n); if (p.onSelectionChange) p.onSelectionChange(n); }
    var allKeys = rows.map(keyOf);
    var all = allKeys.length > 0 && sel.length === allKeys.length;
    function toggleAll() { var n = all ? [] : allKeys; setSel(n); if (p.onSelectionChange) p.onSelectionChange(n); }
    var selectedRows = rows.filter(function (r, i) { return sel.indexOf(keyOf(r, i)) >= 0; });
    return h('div', { className: cx('dmp-table-wrap', p.className) },
      p.selectable && sel.length > 0 && h('div', { className: 'dmp-bulkbar', role: 'status' },
        'Đã chọn ' + sel.length + ' ' + (p.itemLabel || 'dòng'),
        h('div', { className: 'dmp-bulkbar__actions' }, p.bulkActions ? p.bulkActions(selectedRows) : null)),
      h('div', { className: 'dmp-table-scroll', style: p.maxHeight ? { maxHeight: p.maxHeight } : undefined },
        rows.length === 0 ? (p.empty || h(EmptyState, { title: 'Chưa có dữ liệu', body: 'Dữ liệu sẽ hiện ở đây khi có giao dịch đầu tiên.' })) :
        h('table', { className: 'dmp-table' },
          h('thead', null, h('tr', null,
            p.selectable && h('th', { className: 'dmp-table__sel' }, h('input', { type: 'checkbox', className: 'dmp-check', checked: all, onChange: toggleAll, 'aria-label': 'Chọn tất cả' })),
            cols.map(function (c) { return h('th', { key: c.key, className: cx(c.align === 'right' && 'is-num'), style: c.width ? { width: c.width } : undefined }, c.label); }))),
          h('tbody', null, rows.map(function (r, i) {
            var k = keyOf(r, i), isSel = sel.indexOf(k) >= 0, tone = p.rowTone ? p.rowTone(r) : null;
            return h('tr', { key: k, className: cx('dmp-row', tone && 'dmp-row--' + tone, isSel && 'is-selected'), onClick: p.onRowClick ? function () { p.onRowClick(r); } : undefined },
              p.selectable && h('td', { className: 'dmp-table__sel', onClick: function (e) { e.stopPropagation(); } },
                h('input', { type: 'checkbox', className: 'dmp-check', checked: isSel, onChange: function () { toggle(k); }, 'aria-label': 'Chọn dòng' })),
              cols.map(function (c, ci) {
                return h('td', { key: c.key, 'data-label': c.label, className: cx(c.align === 'right' && 'is-num', (c.primary || ci === 0) && 'is-primary') },
                  c.render ? c.render(r) : r[c.key]);
              }));
          })))));
  }

  /* ---------- Ô che dữ liệu nhạy cảm ---------- */
  function MaskedField(p) {
    var st = useState(false), shown = st[0], setShown = st[1];
    function reveal() { var n = !shown; setShown(n); if (n && p.onReveal) p.onReveal(); }
    var masked = !shown;
    return h('div', { className: cx('dmp-masked', p.className) },
      p.label && h('span', { className: 'dmp-masked__label' }, p.label),
      h('span', { className: 'dmp-masked__row' },
        masked && h(Icon, { name: 'lock', size: 14, className: 'dmp-masked__lock', label: 'Đã che' }),
        h('span', { className: 'dmp-masked__value' }, masked ? p.masked : p.value),
        p.canReveal && h('button', { type: 'button', className: 'dmp-masked__btn', onClick: reveal, title: 'Mỗi lần xem được ghi vào nhật ký thao tác' },
          h(Icon, { name: shown ? 'eyeOff' : 'eye', size: 14 }), shown ? 'Ẩn' : 'Hiện')));
  }

  /* ---------- Stepper luồng duyệt ---------- */
  function ApprovalStepper(p) {
    var steps = p.steps || [];
    return h('ol', { className: cx('dmp-steps', p.orientation === 'vertical' && 'dmp-steps--vertical', p.className) },
      steps.map(function (s, i) {
        var status = s.status || 'todo';
        var dot = status === 'done' ? h(Icon, { name: 'check', size: 14, strokeWidth: 2.6 }) : status === 'rejected' ? h(Icon, { name: 'x', size: 14, strokeWidth: 2.6 }) : String(i + 1);
        return h('li', { key: i, className: cx('dmp-step', 'dmp-step--' + status), 'aria-current': status === 'current' ? 'step' : undefined },
          h('div', { className: 'dmp-step__top' },
            h('span', { className: 'dmp-step__dot' }, dot),
            i < steps.length - 1 && h('span', { className: 'dmp-step__line' })),
          h('div', { className: 'dmp-step__body' },
            h('span', { className: 'dmp-step__label' }, s.label),
            s.actor && h('span', { className: 'dmp-step__meta' }, s.actor),
            s.time && h('span', { className: 'dmp-step__meta' }, s.time),
            s.note && h('span', { className: cx('dmp-step__note', status === 'rejected' && 'is-danger') }, s.note)));
      }));
  }

  /* ---------- Cách tính điểm từng bước ---------- */
  function PointBreakdown(p) {
    var steps = p.steps || [];
    return h('div', { className: cx('dmp-breakdown', p.className) },
      steps.map(function (s, i) {
        return h('div', { key: i, className: 'dmp-breakdown__row' },
          h('span', { className: 'dmp-breakdown__step' }, s.code || 'B' + (i + 1)),
          h('span', { className: 'dmp-breakdown__text' },
            h('span', { className: 'dmp-breakdown__label' }, s.label),
            s.detail && h('span', { className: 'dmp-breakdown__detail' }, s.detail)),
          h('span', { className: 'dmp-breakdown__val' }, s.value));
      }),
      h('div', { className: 'dmp-breakdown__total' },
        h('span', null, p.totalLabel || 'Tổng điểm của đơn'),
        h(PointValue, { value: p.total, state: p.state || 'available', size: 'lg' })),
      p.footnote && h('div', { className: 'dmp-breakdown__foot' }, p.footnote));
  }

  /* ---------- Popup xem nhanh ---------- */
  function QuickView(p) {
    if (p.open === false) return null;
    var dialog = h('div', { className: cx('dmp-dialog', p.inline && 'dmp-dialog--inline', p.className), role: 'dialog', 'aria-modal': p.inline ? undefined : 'true', 'aria-label': typeof p.title === 'string' ? p.title : undefined },
      h('div', { className: 'dmp-dialog__head' },
        h('h2', { className: 'dmp-dialog__title' }, p.title),
        p.onClose && h('button', { type: 'button', className: 'dmp-iconbtn', onClick: p.onClose, 'aria-label': 'Đóng' }, h(Icon, { name: 'x' }))),
      h('div', { className: 'dmp-dialog__body' }, p.children),
      p.footer && h('div', { className: 'dmp-dialog__foot' }, p.footer));
    if (p.inline) return dialog;
    return h('div', { className: 'dmp-overlay', onClick: function (e) { if (e.target === e.currentTarget && p.onClose) p.onClose(); } }, dialog);
  }

  /* ---------- Empty state ---------- */
  function EmptyState(p) {
    return h('div', { className: cx('dmp-empty', p.className) },
      h('span', { className: 'dmp-empty__icon' }, h(Icon, { name: p.icon || 'info', size: 26 })),
      h('p', { className: 'dmp-empty__title' }, p.title),
      p.body && h('p', { className: 'dmp-empty__body' }, p.body),
      p.action);
  }

  /* ---------- Toast ---------- */
  var TOAST_ICON = { success: 'check', danger: 'alert', warning: 'clock', info: 'info', pending: 'clock' };
  function Toast(p) {
    var tone = p.tone || 'info';
    return h('div', { className: cx('dmp-toast', 'dmp-toast--' + tone, p.className), role: tone === 'danger' ? 'alert' : 'status' },
      h('span', { className: 'dmp-toast__icon' }, h(Icon, { name: TOAST_ICON[tone] || 'info', size: 16, strokeWidth: 2.2 })),
      h('div', { className: 'dmp-toast__text' },
        h('div', { className: 'dmp-toast__title' }, p.title),
        p.body && h('div', { className: 'dmp-toast__body' }, p.body)),
      p.onClose && h('button', { type: 'button', className: 'dmp-iconbtn dmp-toast__close', onClick: p.onClose, 'aria-label': 'Đóng' }, h(Icon, { name: 'x', size: 16 })));
  }

  /* ---------- Thẻ quà ---------- */
  function GiftCard(p) {
    var cost = Number(p.points) || 0, bal = Number(p.balance) || 0;
    var missing = Math.max(0, cost - bal);
    var locked = !!p.lockedForTier;
    var hint = null;
    if (!locked && missing > 0) {
      hint = p.shortfallHint || ('Còn thiếu ' + formatNumber(missing) + ' điểm' +
        (p.vndPerPoint ? ' – đặt thêm khoảng ' + formatMillion(missing * p.vndPerPoint) + ' là đổi được' : ''));
    }
    var canAct = !locked && missing === 0;
    return h('article', { className: cx('dmp-gift', locked && 'is-locked', p.className) },
      h('div', { className: 'dmp-gift__img' },
        p.image ? h('img', { src: p.image, alt: '' }) : h(Icon, { name: 'gift', size: 40, strokeWidth: 1.4 }),
        p.tag && h('span', { className: 'dmp-gift__tag' }, h(StatusBadge, { tone: 'new' }, p.tag)),
        locked && h('div', { className: 'dmp-gift__lock' }, h(Icon, { name: 'lock', size: 22 }), 'Dành cho hạng ' + (TIER_LABELS[p.lockedForTier] || p.lockedForTier))),
      h('div', { className: 'dmp-gift__body' },
        h('h3', { className: 'dmp-gift__name' }, p.name),
        h('div', { className: 'dmp-gift__cost' }, formatNumber(cost) + ' điểm'),
        p.meta && h('div', { className: 'dmp-gift__meta' }, p.meta),
        hint && h('div', { className: 'dmp-gift__hint' }, hint),
        h('div', { className: 'dmp-gift__foot' },
          p.canRedeem === false
            ? h('span', { className: 'dmp-gift__note' }, 'Chỉ chủ tài khoản được đổi quà')
            : h(Button, { variant: canAct ? 'primary' : 'secondary', size: 'lg', block: true, disabled: !canAct, onClick: p.onRedeem }, locked ? 'Chưa đủ hạng' : canAct ? 'Đổi quà' : 'Chưa đủ điểm'))));
  }

  /* ---------- Sidebar web quản trị ---------- */
  function Sidebar(p) {
    var items = p.items || [];
    return h('nav', { className: cx('dmp-sidebar', p.className), 'aria-label': 'Menu chính' },
      h('div', { className: 'dmp-sidebar__brand' }, p.brand || 'DMP Việt Pháp'),
      h('ul', { className: 'dmp-nav' }, items.map(function (it) {
        return h('li', { key: it.key },
          h('button', { type: 'button', className: cx('dmp-nav__item', p.active === it.key && 'is-active'), 'aria-current': p.active === it.key ? 'page' : undefined, onClick: p.onSelect ? function () { p.onSelect(it.key); } : undefined },
            it.icon && h(Icon, { name: it.icon, size: 18 }),
            h('span', { className: 'dmp-nav__label' }, it.label),
            it.badge ? h('span', { className: 'dmp-nav__count', 'aria-label': it.badge + ' việc chờ xử lý' }, it.badge > 99 ? '99+' : it.badge) : null));
      })),
      p.footer && h('div', { className: 'dmp-sidebar__foot' }, p.footer));
  }

  /* ---------- Thanh trên cùng ---------- */
  function TopBar(p) {
    return h('header', { className: cx('dmp-topbar', p.className) },
      p.title && h('h1', { className: 'dmp-topbar__title' }, p.title),
      p.search !== false && h('label', { className: 'dmp-search' },
        h(Icon, { name: 'search', size: 18 }),
        h('input', { type: 'search', placeholder: p.searchPlaceholder || 'Tìm nhanh theo mã, tên, SĐT đại lý', 'aria-label': 'Tìm nhanh', onChange: p.onSearch ? function (e) { p.onSearch(e.target.value); } : undefined })),
      h('div', { className: 'dmp-topbar__right' }, p.right));
  }

  /* ---------- Chuyển vai trò (web demo) ---------- */
  var DEFAULT_ROLES = [{ key: 'BOD', label: 'BOD' }, { key: 'KT', label: 'Kế toán' }, { key: 'SALE', label: 'Sale' }, { key: 'MKT', label: 'Marketing' }, { key: 'DL', label: 'Đại lý' }];
  function RoleSwitcher(p) {
    var roles = p.roles || DEFAULT_ROLES;
    var st = useState(p.defaultValue || roles[0].key), inner = st[0], setInner = st[1];
    var value = p.value != null ? p.value : inner;
    return h('div', { className: cx('dmp-roles', p.className) },
      h('span', { className: 'dmp-roles__label' }, p.label || 'Xem với vai trò'),
      h('div', { className: 'dmp-roles__group', role: 'radiogroup', 'aria-label': p.label || 'Xem với vai trò' },
        roles.map(function (r) {
          var on = r.key === value;
          return h('button', { key: r.key, type: 'button', role: 'radio', 'aria-checked': on, className: cx('dmp-roles__opt', on && 'is-active'),
            onClick: function () { setInner(r.key); if (p.onChange) p.onChange(r.key); } }, r.label);
        })));
  }

  /* ---------- Thanh điều hướng dưới (app đại lý) ---------- */
  var DEFAULT_TABS = [
    { key: 'home', label: 'Trang chủ', icon: 'home' }, { key: 'orders', label: 'Đơn hàng', icon: 'box' },
    { key: 'points', label: 'Điểm', icon: 'star' }, { key: 'gifts', label: 'Quà', icon: 'gift' }, { key: 'account', label: 'Tài khoản', icon: 'user' }];
  function BottomNav(p) {
    var items = p.items || DEFAULT_TABS;
    return h('nav', { className: cx('dmp-bottomnav', p.className), 'aria-label': 'Điều hướng app' },
      items.map(function (it) {
        var on = p.active === it.key;
        return h('button', { key: it.key, type: 'button', className: cx('dmp-bottomnav__item', on && 'is-active'), 'aria-current': on ? 'page' : undefined, onClick: p.onSelect ? function () { p.onSelect(it.key); } : undefined },
          h('span', { className: 'dmp-bottomnav__icon' }, h(Icon, { name: it.icon, size: 24, strokeWidth: on ? 2.2 : 1.8 }),
            it.badge ? h('span', { className: 'dmp-bottomnav__badge', 'aria-label': it.badge + ' mới' }, it.badge) : null),
          it.label);
      }));
  }

  /* ---------- Chúc mừng lên hạng / đổi quà ---------- */
  var BURST = [[-150, 30], [-115, 52], [-80, 18], [-60, 58], [70, 56], [95, 22], [120, 48], [150, 14], [-170, -8], [-110, -26], [110, -20], [165, -30], [-140, 8], [140, 4]];
  var BURST_TONES = ['primary', 'accent', 'gold', 'primary', 'gold', 'accent', 'primary', 'gold', 'accent', 'gold', 'primary', 'accent', 'gold', 'primary'];
  function Celebration(p) {
    return h('div', { className: cx('dmp-celebrate', p.className), role: 'status' },
      h('div', { className: 'dmp-celebrate__burst', 'aria-hidden': 'true' }, BURST.map(function (b, i) {
        return h('i', { key: i, className: 'is-' + BURST_TONES[i], style: { '--x': b[0] + 'px', '--y': (-b[1]) + 'px', animationDelay: (i % 4) * 40 + 'ms' } });
      })),
      h('div', { className: cx('dmp-celebrate__medal', 'dmp-celebrate__medal--' + (p.tier || 'gold')) }, p.icon ? h(Icon, { name: p.icon, size: 34, strokeWidth: 1.8 }) : h(TierIcon, { tier: p.tier || 'gold', size: 46 })),
      h('p', { className: 'dmp-celebrate__title' }, p.title),
      p.tier && h(TierBadge, { tier: p.tier, size: 'lg' }),
      p.body && h('p', { className: 'dmp-celebrate__body' }, p.body),
      p.action);
  }

  /* ---------- Tabs ---------- */
  function Tabs(p) {
    var items = p.items || [];
    var st = useState(p.defaultValue || (items[0] && items[0].key)), inner = st[0], setInner = st[1];
    var value = p.value != null ? p.value : inner;
    return h('div', { className: cx('dmp-tabs', p.variant === 'pill' && 'dmp-tabs--pill', p.className), role: 'tablist' },
      items.map(function (it) {
        var on = it.key === value;
        return h('button', { key: it.key, type: 'button', role: 'tab', 'aria-selected': on, className: cx('dmp-tab', on && 'is-active'),
          onClick: function () { setInner(it.key); if (p.onChange) p.onChange(it.key); } },
          it.icon && h(Icon, { name: it.icon, size: 16 }), it.label,
          it.count != null && h('span', { className: cx('dmp-tab__count', it.alert && 'is-alert') }, it.count),
          it.tag && h('span', { className: 'dmp-tab__tag' }, it.tag));
      }));
  }

  /* ---------- Card ---------- */
  function Card(p) {
    return h('section', { className: cx('dmp-card', p.flush && 'dmp-card--flush', p.className), style: p.style },
      (p.title || p.actions) && h('div', { className: 'dmp-card__head' },
        h('div', { className: 'dmp-card__titles' }, p.title && h('h2', { className: 'dmp-card__title' }, p.title), p.subtitle && h('div', { className: 'dmp-card__sub' }, p.subtitle)),
        p.actions && h('div', { className: 'dmp-card__actions' }, p.actions)),
      h('div', { className: 'dmp-card__body' }, p.children));
  }

  /* ---------- Field ---------- */
  var fid = 0;
  function Field(p) {
    var idRef = React.useRef(null); if (!idRef.current) idRef.current = 'dmp-f' + (++fid);
    var id = p.id || idRef.current;
    var as = p.as || 'input';
    var ctl = omit(p, ['label', 'hint', 'error', 'required', 'as', 'options', 'suffix', 'prefix', 'className', 'size', 'children']);
    ctl.id = id; ctl.className = 'dmp-field__ctl';
    if (p.error) ctl['aria-invalid'] = 'true';
    var control;
    if (as === 'select') control = h('select', ctl, (p.options || []).map(function (o) { var v = typeof o === 'string' ? o : o.value; return h('option', { key: v, value: v }, typeof o === 'string' ? o : o.label); }));
    else if (as === 'textarea') control = h('textarea', assign({ rows: 3 }, ctl));
    else control = h('input', assign({ type: 'text' }, ctl));
    return h('div', { className: cx('dmp-field', p.size === 'lg' && 'dmp-field--lg', p.error && 'has-error', p.className) },
      p.label && h('label', { className: 'dmp-field__label', htmlFor: id }, p.label, p.required && h('span', { className: 'dmp-field__req', 'aria-hidden': 'true' }, ' *')),
      h('div', { className: 'dmp-field__box' }, p.prefix && h('span', { className: 'dmp-field__affix' }, p.prefix), control, p.suffix && h('span', { className: 'dmp-field__affix' }, p.suffix)),
      p.error ? h('span', { className: 'dmp-field__error' }, h(Icon, { name: 'alert', size: 14 }), p.error) : p.hint && h('span', { className: 'dmp-field__hint' }, p.hint),
      p.children);
  }

  /* ---------- FilterChip ---------- */
  function FilterChip(p) {
    return h('button', { type: 'button', 'aria-pressed': !!p.selected, className: cx('dmp-chip', p.selected && 'is-on', p.className), onClick: p.onClick },
      p.selected && h(Icon, { name: 'check', size: 14, strokeWidth: 2.4 }), p.children,
      p.count != null && h('span', { className: 'dmp-chip__count' }, p.count));
  }

  /* ---------- OtpInput ---------- */
  function OtpInput(p) {
    var len = p.length || 6;
    var st = useState(p.defaultValue || ''), inner = st[0], setInner = st[1];
    var value = p.value != null ? p.value : inner;
    var refs = React.useRef([]);
    function set(v) { v = v.replace(/\D/g, '').slice(0, len); setInner(v); if (p.onChange) p.onChange(v); return v; }
    var boxes = [];
    for (var i = 0; i < len; i++) (function (i) {
      boxes.push(h('input', { key: i, ref: function (el) { refs.current[i] = el; }, className: 'dmp-otp__box', inputMode: 'numeric', autoComplete: i === 0 ? 'one-time-code' : 'off', maxLength: len,
        'aria-label': 'Số thứ ' + (i + 1), value: value[i] || '',
        onChange: function (e) { var d = e.target.value.replace(/\D/g, ''); if (!d) return; var v = set(value.slice(0, i) + d + value.slice(i + 1)); var n = Math.min(v.length, len - 1); if (refs.current[n]) refs.current[n].focus(); },
        onKeyDown: function (e) { if (e.key === 'Backspace') { e.preventDefault(); set(value.slice(0, i) + value.slice(i + 1)); if (i > 0 && !value[i] && refs.current[i - 1]) refs.current[i - 1].focus(); } } }));
    })(i);
    return h('div', { className: cx('dmp-otp', p.error && 'has-error', p.className), role: 'group', 'aria-label': p.label || 'Mã xác thực' }, boxes);
  }

  /* ---------- Pagination ---------- */
  function Pagination(p) {
    var size = p.pageSize || 20, total = p.total || 0, pages = Math.max(1, Math.ceil(total / size)), page = Math.min(p.page || 1, pages);
    var from = total ? (page - 1) * size + 1 : 0, to = Math.min(total, page * size);
    function go(n) { if (p.onChange && n >= 1 && n <= pages) p.onChange(n); }
    var nums = []; for (var i = 1; i <= pages; i++) nums.push(i);
    return h('nav', { className: cx('dmp-pager', p.className), 'aria-label': 'Phân trang' },
      h('span', { className: 'dmp-pager__info' }, from + '–' + to + ' / ' + formatNumber(total) + ' ' + (p.itemLabel || 'dòng')),
      h('div', { className: 'dmp-pager__btns' },
        h('button', { type: 'button', className: 'dmp-pager__btn', onClick: function () { go(page - 1); }, disabled: page <= 1, 'aria-label': 'Trang trước' }, '‹'),
        nums.map(function (n) { return h('button', { key: n, type: 'button', className: cx('dmp-pager__btn', n === page && 'is-active'), 'aria-current': n === page ? 'page' : undefined, onClick: function () { go(n); } }, n); }),
        h('button', { type: 'button', className: 'dmp-pager__btn', onClick: function () { go(page + 1); }, disabled: page >= pages, 'aria-label': 'Trang sau' }, '›')));
  }

  var api = {
    Button: Button, TierBadge: TierBadge, StatusBadge: StatusBadge, PointValue: PointValue, PointFunds: PointFunds,
    TierProgress: TierProgress, KpiCard: KpiCard, DataTable: DataTable, MaskedField: MaskedField, ApprovalStepper: ApprovalStepper,
    PointBreakdown: PointBreakdown, QuickView: QuickView, EmptyState: EmptyState, Toast: Toast, GiftCard: GiftCard,
    TierIcon: TierIcon, Sidebar: Sidebar, TopBar: TopBar, RoleSwitcher: RoleSwitcher, BottomNav: BottomNav, Celebration: Celebration, Icon: Icon,
    Tabs: Tabs, Card: Card, Field: Field, FilterChip: FilterChip, OtpInput: OtpInput, Pagination: Pagination,
    TIER_LABELS: TIER_LABELS,
    format: { number: formatNumber, vnd: formatVND, million: formatMillion, date: formatDate, dateTime: formatDateTime },
    mask: { phone: maskPhone, idCard: maskIdCard, birthday: maskBirthday, bank: maskBank }
  };
  __api = api;
})();

export default __api;
