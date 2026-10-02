/* MyMini 패널 — 미니미의 머릿속 · 내 미니미 준비 · 내가 빠진 사이 · 팀원 초대 · 안건 편집.
   app.js보다 먼저 로드되고, app.js가 시작할 때 window.MMPanels(ctx)를 한 번 부른다.
   사용자 입력은 모두 textContent로만 넣는다 (초대 QR SVG만 서버가 만든 것을 그대로 넣는다). */
'use strict';
window.MMPanels = function (ctx) {
  const { $, $$, h: h0, fill: fill0, icon, avatar, tag, toast, api, busy, S, send, nameOf, engineLabel, fmtTime, clip,
    openModal, closeModal, confirmModal, openSheet, toggleAway, renderCited, decideForm, ACT, DSTATUS, RSTATE } = ctx;

  // ================================================================ 작은 도구
  // 중첩 배열·null 자식을 여기서 펼치고 걸러서, core의 h·fill 구현에 기대지 않는다.
  const flat = kids => kids.flat(6).filter(k => k != null && k !== false);
  const h = (tagName, props, ...kids) => h0(tagName, props, ...flat(kids));
  const fill = (el, ...kids) => fill0(el, ...flat(kids));
  const enc = encodeURIComponent;
  const roomUrl = () => `/api/rooms/${enc(S.roomId)}`;
  const memberUrl = uid => `${roomUrl()}/members/${enc(uid)}`;
  const fx = (v, n = 2) => (Number(v) || 0).toFixed(n);
  const pct01 = v => Math.round(clip(Number(v) || 0, 0, 1) * 100);
  const lead = text => h('p', { class: 'lead-text', text });
  const bullets = items => h('ul', {}, items.map(t => h('li', { text: t })));
  const tip = (summary, ...kids) => h('details', { class: 'tip' }, h('summary', { text: summary }), kids);
  const right = (...kids) => h('div', { class: 'hrow', style: 'justify-content:flex-end' }, kids);
  const fieldHead = (label, hint) => h('span', {}, label, hint ? h('small', { text: hint }) : null);

  // 버튼을 잠시 '처리 중'으로 바꿨다가, 화면이 다시 그려지지 않았으면 원래 모양(아이콘 포함)으로 되돌린다.
  async function run(btn, label, fn) {
    const kids = [...btn.childNodes];
    busy(btn, true, label);
    try { await fn(); } catch (e) { toast(e.message, 'bad'); } finally {
      if (btn.isConnected) { busy(btn, false); fill(btn, kids); btn.disabled = false; }
    }
  }

  // ================================================================ 미니미의 머릿속
  const ZONE = { high: ['확실히 높음', 'ok'], mid: ['애매한 구간', 'warn'], low: ['확실히 낮음', ''], called: ['이름 호출', 'info'], none: ['후보 없음', ''] };
  const SPEAK = { rebuttal: '반론해요', opinion: '의견을 내요', answer: '답해요', agree_add: '조건을 붙여 동의해요' };
  const SRC_KO = { report: '보고서', stance: '입장 카드', interview: '인터뷰', profile: '약력', past: '지난 발언' };

  function curGate() { return S.selGate || S.gate; }

  function factor(label, val, { cost = false, marks = [] } = {}) {
    return h('div', { class: 'factor' },
      h('span', { class: 'lbl', text: label }),
      h('div', { class: `bar${cost ? ' cost' : ''}` },
        h('i', { style: `width:${pct01(val)}%` }),
        marks.filter(x => x != null).map(x => h('span', { class: 'mark', style: `left:${pct01(x)}%` }))),
      h('span', { class: 'val', text: fx(val) }));
  }

  function verdictRow(kind, sym, head, reason, color) {
    return h('div', { class: `verdict${kind ? ` ${kind}` : ''}${color != null ? ` c${color}` : ''}` },
      h('span', { class: 'sym' }, icon(sym)),
      h('div', { class: 'grow' }, h('div', { class: 'h', text: head }), reason ? h('div', { class: 'd', text: reason }) : null));
  }

  function backToLatest() {
    return S.selGate ? h('button', {
      class: 'link sm', type: 'button',
      on: { click: () => { S.selGate = null; renderGate(); renderEvidence(); } },
    }, '최신 판단 보기') : null;
  }

  function renderGate() {
    const box = $('#tab-gate');
    if (!box) return;
    const g = curGate();
    if (!g) {
      fill(box, h('p', { class: 'brain-empty', text: '누군가 말하면, 대리 참석 중인 미니미가 끼어들지 말지 여기서 계산해요.' }));
      return;
    }
    const th = g.thresholds || {};
    const hi = th.high ?? 0.42;
    const lo = th.low ?? 0.22;
    const evMin = th.evidence_min ?? 0.35;
    const trig = (S.messages || []).find(x => x.id === g.msg_id);
    const acts = g.actions || [];
    const chosen = new Set(acts.map(a => a.uid));
    const [zoneLabel, zoneKind] = ZONE[g.zone] || [g.zone || '판단', ''];

    const quote = h('div', {},
      h('div', { class: 'brain-quote', style: 'display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden' },
        trig ? [h('b', { text: `${nameOf(trig.user_id)}:` }), ` ${trig.text}`] : h('span', { class: 'muted', text: '이전 발언에 대한 판단' }),
        g.msg_position ? h('span', { class: 'muted', text: ` (${g.msg_position} 쪽)` }) : null),
      h('div', { class: 'brain-meta' },
        !g.source || g.source === 'rule' ? tag('규칙으로 판단', '') : tag(`모델 판단 · ${engineLabel(g.source)}`, 'info'),
        tag(zoneLabel, zoneKind),
        backToLatest()));

    const verdicts = acts.length ? acts.map((a, i) => {
      const mem = S.byId[a.uid] || { name: nameOf(a.uid), color: 0 };
      if (a.type === 'abstain') {
        return verdictRow('abstain', 'help', `${mem.name}의 미니미는 말하지 않아요`,
          a.reason === 'commit' ? '약속을 정하는 일이라 본인에게 넘겨요' : '근거가 없어 돌아오면 물어볼 질문으로 남겨요');
      }
      return verdictRow('speak', 'mini', `${mem.name}의 미니미가 ${SPEAK[a.act] || `${ACT[a.act] || '발언'}해요`}`,
        i === 0 ? g.reason : '', mem.color || 0);
    }) : [verdictRow('', 'x', '아무도 말하지 않아요', g.reason)];

    const cands = (g.candidates || []).map(c => {
      const mem = S.byId[c.uid] || { name: c.name || '?', color: 0 };
      const note = [c.position, c.called ? '호출됨' : null, c.excluded].filter(Boolean).join(' · ');
      return h('div', { class: `cand${chosen.has(c.uid) ? ' chosen' : ''} c${mem.color || 0}` },
        h('div', { class: 'cand-head' },
          avatar(mem, { mini: true, size: 'sm' }),
          h('span', { class: 'nm', text: `${mem.name}의 미니미` }),
          note ? h('span', { class: 'x', text: note }) : null,
          h('span', { class: 'u', text: fx(c.utility) })),
        factor('관련도', c.rel),
        factor('근거', c.ev, { marks: [evMin] }),
        factor('새로움', c.nov),
        factor('입장 차이', c.diff),
        factor('끼어들기', c.cost, { cost: true }),
        factor('효용', Math.max(0, Number(c.utility) || 0), { marks: [lo, hi] }));
    });

    fill(box, quote, verdicts, cands,
      h('div', { class: 'formula', text: `U = 관련도 × 근거 × 새로움 × 입장 차이 − 끼어들기 · 말하기 ≥ ${hi} · 침묵 ≤ ${lo} · 근거 < ${evMin}면 침묵` }));
  }

  function highlight(text, words) {
    const el = h('div', {});
    const src = String(text || '');
    const ws = (words || []).filter(w => w && w.length > 1 && src.toLowerCase().includes(w)).sort((a, b) => b.length - a.length);
    if (!ws.length) { el.textContent = src; return el; }
    const re = new RegExp(`(${ws.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
    let last = 0; let m;
    while ((m = re.exec(src))) {
      if (m.index > last) el.append(src.slice(last, m.index));
      el.append(h('mark', { text: m[0] }));
      last = re.lastIndex;
    }
    el.append(src.slice(last));
    return el;
  }

  function renderEvidence() {
    const box = $('#tab-evidence');
    if (!box) return;
    const g = curGate();
    const cands = (g && g.candidates) || [];
    const act = g && (g.actions || [])[0];
    const c = cands.find(x => act && x.uid === act.uid) || cands[0];
    const thr = (g && g.thresholds && g.thresholds.evidence_min) || 0.3;
    if (!c) {
      fill(box, h('p', { class: 'brain-empty', text: '미니미가 판단할 때 찾은 근거 문단이 여기에 보여요.' }));
      return;
    }
    const mem = S.byId[c.uid] || { name: c.name || '?' };
    const ev = c.evidence || [];
    const enough = (Number(c.ev) || 0) >= thr;
    fill(box,
      h('div', {},
        h('div', { class: 'brain-quote' }, h('b', { text: `${mem.name}의 미니미` }), '가 찾은 근거'),
        h('div', { class: 'brain-meta' },
          tag(enough ? '근거 충분' : '근거 부족 · 침묵', enough ? 'ok' : 'warn'),
          h('span', { class: 'muted sm', text: `최고 ${fx(c.ev)} · 기준 ${thr}` }),
          backToLatest())),
      ev.length ? ev.map(e => h('div', { class: 'passage' },
        h('div', { class: 'lab' }, icon('doc', 'xs'), h('span', { class: 'grow', text: e.label }), tag(SRC_KO[e.kind] || e.kind || '자료', 'plain')),
        highlight(e.text, e.matched || []),
        factor('근거 점수', e.strength, { marks: [thr] }),
        h('div', { class: 'muted sm', text: `BM25 ${fx(e.bm25)} · 벡터 ${fx(e.cos)} · 핵심어 ${Math.round((Number(e.coverage) || 0) * 100)}%` })))
        : h('p', { class: 'brain-empty', text: '관련 문단을 찾지 못했어요.' }),
      h('div', { class: 'formula', text: '근거 점수 = 0.55 × 핵심어 일치(IDF 가중) + 0.45 × 벡터 유사도' }));
  }

  const SVGNS = 'http://www.w3.org/2000/svg';
  function svgEl(name, attrs = {}, text = null) {
    const e = document.createElementNS(SVGNS, name);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    return e;
  }

  function renderDrift() {
    const box = $('#tab-drift');
    if (!box) return;
    const all = S.drift || [];
    const pts = all.filter(p => p.distance != null).slice(-40);
    const thr = (all.length && all[all.length - 1].threshold) || 0.8;
    const W = 320; const H = 180; const P = { l: 24, r: 8, t: 12, b: 22 };
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': '발언별 안건 거리 그래프' });
    const add = (name, attrs, text) => { const e = svgEl(name, attrs, text); svg.append(e); return e; };
    const X = i => P.l + (pts.length <= 1 ? (W - P.l - P.r) / 2 : i * (W - P.l - P.r) / (pts.length - 1));
    const Y = v => P.t + (1 - clip(v, 0, 1)) * (H - P.t - P.b);
    add('rect', { x: P.l, y: Y(1), width: W - P.l - P.r, height: Math.max(0, Y(thr) - Y(1)), style: 'fill:var(--bad-soft)' });
    for (const v of [0, 0.5, 1]) {
      add('line', { x1: P.l, x2: W - P.r, y1: Y(v), y2: Y(v), style: 'stroke:var(--line)' });
      add('text', { x: 2, y: Y(v) + 3 }, v.toFixed(1));
    }
    add('line', { x1: P.l, x2: W - P.r, y1: Y(thr), y2: Y(thr), style: 'stroke:var(--bad)', 'stroke-dasharray': '4 3' });
    // 첫 발언들은 대개 안건 안쪽이라, 기준선 이름은 왼쪽에 둬야 점과 덜 겹친다
    add('text', { x: P.l + 4, y: Y(thr) - 4 }, `이탈 기준 ${thr}`);
    if (pts.length) {
      add('polyline', {
        points: pts.map((p, i) => `${X(i)},${Y(p.distance)}`).join(' '),
        style: 'fill:none;stroke:var(--ink-2);stroke-width:1.6;stroke-linejoin:round;stroke-linecap:round',
      });
      pts.forEach((p, i) => {
        const over = p.distance >= thr;
        const dot = add('circle', {
          cx: X(i), cy: Y(p.distance), r: p.reminded ? 5 : 3.5,
          style: `fill:${over ? 'var(--bad)' : 'var(--ink)'};stroke:var(--panel);stroke-width:1.5`,
        });
        const msg = (S.messages || []).find(m => m.id === p.msg_id);
        dot.append(svgEl('title', {}, `${p.who || ''}: ${msg ? msg.text.slice(0, 40) : ''} · 거리 ${fx(p.distance)}`));
      });
    } else {
      add('text', { x: (P.l + W - P.r) / 2, y: H / 2, 'text-anchor': 'middle' }, '발언이 오면 그려져요');
    }
    add('text', { x: P.l, y: H - 6 }, '발언 순서 →');

    const recent = pts.slice(-5).reverse();
    fill(box,
      h('p', { class: 'brain-empty', text: '발언이 안건에서 벗어난 정도예요. 기준선을 연달아 넘으면 도우미가 남은 쟁점을 짚어 줘요.' }),
      svg,
      recent.length ? [
        h('div', { class: 'section-title', text: '최근 발언' }),
        h('div', { class: 'drift-list' }, recent.map(p => {
          const msg = (S.messages || []).find(m => m.id === p.msg_id);
          return h('div', { class: 'drift-row' },
            h('span', { class: 'w', text: p.who || '' }),
            h('span', { class: 't', text: msg ? msg.text : '' }),
            h('span', { class: `v${p.distance >= thr ? ' over' : ''}`, text: fx(p.distance) }));
        })),
      ] : null);
  }

  const ENGINE_KO = { ollama: '로컬 Ollama', api: 'OpenAI 호환 API', rule: '규칙' };
  const LANE_KO = { fast: '빠른 레인', slow: '생각 레인' };

  function renderEngine() {
    const box = $('#tab-engine');
    if (!box) return;
    const st = S.status;
    if (!st) { fill(box, h('p', { class: 'brain-empty', text: '엔진 상태를 불러오는 중…' })); return; }
    const sw = h('button', {
      class: 'toggle-row', type: 'button', role: 'switch', 'aria-checked': String(!!st.force_rule),
      on: {
        click: async () => {
          try {
            // 엔진 표시줄은 서버가 곧바로 방송하는 status로 core가 다시 그린다
            S.status = await api('POST', '/api/engine', { force_rule: !st.force_rule });
            renderEngine();
            toast(S.status.force_rule ? '모델을 껐어요. 이제 규칙으로만 움직여요.' : '모델을 다시 켰어요.');
          } catch (e) { toast(e.message, 'bad'); }
        },
      },
    },
    h('span', { class: 'grow', style: 'display:flex;flex-direction:column' },
      h('span', { class: 'lbl', text: '모델 끄기' }),
      h('span', { class: 'desc', text: '모델이 없어도 규칙만으로 회의가 이어져요' })),
    h('span', { class: 'switch' }));

    const lanes = [['빠른 레인', '개입 판단', st.fast || 'rule', 'fast'], ['생각 레인', '발언 · 검증 · 회의록', st.slow || 'rule', 'slow']];
    const laneEls = lanes.map(([name, job, label, lane]) => {
      const eng = (st.engines || []).find(e => label.startsWith(e.name));
      const l = eng && eng.lanes && eng.lanes[lane];
      return h('div', { class: 'lane' },
        h('div', { class: 'lane-head' }, h('span', {}, name, h('span', { class: 'muted sm', style: 'font-weight:400', text: ` · ${job}` })),
          tag(engineLabel(label), label === 'rule' ? 'warn' : 'ok')),
        l ? h('dl', { class: 'kv' },
          h('dt', { text: '지연 p50 / p95' }), h('dd', { text: `${l.p50 ?? '-'}s / ${l.p95 ?? '-'}s` }),
          h('dt', { text: '성공 / 실패' }), h('dd', { text: `${l.ok ?? 0} / ${l.fail ?? 0}` }))
          : h('div', { class: 'muted sm', text: '모델 없이 점수와 검색으로 움직여요' }));
    });
    const embed = String(st.embed || '');
    const embedEl = h('div', { class: 'lane' },
      h('div', { class: 'lane-head' }, h('span', { text: '임베딩' }), tag(embed || '없음', embed.startsWith('n-gram') ? '' : 'ok')),
      h('div', { class: 'muted sm', text: '형태소 BM25와 벡터 검색을 섞어 근거를 찾아요. 항상 로컬에서 돌아요.' }));

    const order = (st.order || []).filter(x => x !== 'rule').map(x => ENGINE_KO[x] || x).concat('규칙');
    const engines = (st.engines || []).map(e => {
      const [sl, sk] = !e.configured ? ['설정 안 됨', ''] : e.reachable === false ? ['연결 안 됨', 'warn'] : e.reachable ? ['연결됨', 'ok'] : ['확인 전', ''];
      return h('div', { class: 'lane' },
        h('div', { class: 'lane-head' }, h('span', { text: ENGINE_KO[e.name] || e.name }), tag(sl, sk)),
        e.reason ? h('div', { class: 'muted sm', text: e.reason }) : null,
        Object.entries(e.lanes || {}).filter(([, l]) => l.breaker_open || l.last_error).map(([lane, l]) =>
          h('div', { class: 'sm', style: 'color:var(--bad)', text: `${LANE_KO[lane] || lane}: ${l.breaker_open ? '잠시 차단됨 · ' : ''}${l.last_error || ''}` })));
    });

    const tr = st.trace || [];
    fill(box, sw, laneEls, embedEl,
      h('div', { class: 'section-title', text: `연결 순서 · ${order.join(' → ')}` }),
      engines,
      tr.length ? h('details', { class: 'tip' }, h('summary', { text: `최근 호출 ${tr.length}건` }),
        h('div', { class: 'trace' }, tr.slice().reverse().map(t => h('div', {},
          h('span', { class: t.ok ? 'ok' : 'bad', text: t.ok ? '✓' : '✗' }),
          h('span', { text: fmtTime(t.ts) }),
          h('span', { text: t.task || '' }),
          h('span', { text: `${t.engine}:${t.model}` }),
          h('span', { text: `${t.ms}ms` }),
          t.ok ? h('span', { text: `${t.tin || 0}→${t.tout || 0}tok` }) : h('span', { text: t.error || '' })))))
        : h('p', { class: 'brain-empty', text: '아직 모델을 부른 적이 없어요.' }));
  }

  // ================================================================ 내 미니미 준비
  const PREP_TABS = ['프로필', '보고서', '입장 인터뷰', '입장 카드', '준비도·대리 참석'];

  async function openPrep(uid, { tab = null, preview = null } = {}) {
    const isPreview = preview != null ? preview : uid !== S.me;
    S.prep = { uid, tab: tab ?? (S.prep && S.prep.uid === uid ? S.prep.tab : 0), data: null, preview: isPreview };
    const m = S.byId[uid];
    openSheet(isPreview ? '화면 미리보기' : (m ? [m.name, m.role].filter(Boolean).join(' · ') : '내 미니미'),
      isPreview ? `${m ? m.name : ''} 님의 미니미 준비` : '내 미니미 준비');
    fill($('#sheetBody'), h('p', { class: 'muted sm', style: 'padding:24px 0', text: '불러오는 중…' }));
    await refreshPrep();
  }

  async function refreshPrep() {
    if (!S.prep) return;
    const { uid } = S.prep;
    try {
      const data = await api('GET', memberUrl(uid));
      if (S.prep && S.prep.uid === uid) { S.prep.data = data; renderPrep(); }
    } catch (e) { toast(e.message, 'bad'); }
  }

  function prepApi(method, path, body, isForm) {
    return api(method, `${memberUrl(S.prep.uid)}${path}`, body, isForm);
  }
  // 응답이 왔을 때 시트가 아직 열려 있으면 반영하고 true
  function applyPrep(member) {
    if (!S.prep || !member) return false;
    S.prep.data = member;
    return true;
  }

  function renderPrep() {
    const P = S.prep;
    if (!P || !P.data) return;
    const d = P.data;
    const r = d.readiness || { covered: 0, total: 0, items: [] };
    const prof = d.profile || {};
    const done = [
      !!(prof.intro || (prof.criteria || []).length),
      (d.reports || []).length > 0,
      (d.interview || []).length > 0 && !d.interview.some(q => q.status === 'open'),
      (d.stances || []).some(s => s.status === 'confirmed'),
      !!r.ready,
    ];
    const tab = Math.max(0, Math.min(PREP_TABS.length - 1, Number(P.tab) || 0));
    const stepper = h('div', { class: 'stepper' }, PREP_TABS.map((t, i) => h('button', {
      type: 'button', class: done[i] ? 'done' : '', 'aria-current': String(tab === i),
      on: { click: () => { P.tab = i; renderPrep(); } },
    }, h('span', { class: 'n', text: done[i] ? '✓' : String(i + 1) }), t)));
    const body = [prepProfile, prepReports, prepInterview, prepStances, prepReady][tab](d);
    const root = $('#sheetBody');
    fill(root,
      P.preview ? h('div', { class: 'preview-note' }, icon('eye', 'xs'), `${d.name} 님 화면 미리보기 · 읽기 전용`) : null,
      stepper,
      h('div', { class: 'prep-sec' }, body));
    if (P.preview && root) {
      $$('.prep-sec input, .prep-sec textarea, .prep-sec select, .prep-sec button', root).forEach(el => { el.disabled = true; });
    }
  }

  function listInputs(values, n, placeholder) {
    return h('div', { class: 'stack', style: 'gap:6px' }, Array.from({ length: n }, (_, i) => h('input', {
      value: (values || [])[i] || '', maxlength: 160,
      placeholder: typeof placeholder === 'function' ? placeholder(i) : placeholder,
    })));
  }
  function readList(box) { return $$('input', box).map(x => x.value.trim()).filter(Boolean); }

  function chipsInput(values, placeholder) {
    const wrap = h('div', { class: 'chips-input' });
    const vals = [...(values || [])];
    const inp = h('input', { placeholder, maxlength: 30 });
    const draw = () => {
      fill(wrap, vals.map((v, i) => h('span', { class: 'chip' }, v,
        h('button', { type: 'button', 'aria-label': `${v} 삭제`, on: { click: () => { vals.splice(i, 1); draw(); } } }, icon('x')))), inp);
    };
    inp.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ',') && !e.isComposing) {
        e.preventDefault();
        const v = inp.value.trim().replace(/,$/, '');
        if (v && !vals.includes(v) && vals.length < 8) vals.push(v);
        inp.value = ''; draw(); inp.focus();
      } else if (e.key === 'Backspace' && !inp.value && vals.length) { vals.pop(); draw(); inp.focus(); }
    });
    draw();
    wrap.values = () => { const v = inp.value.trim(); return v && !vals.includes(v) ? [...vals, v] : vals; };
    return wrap;
  }

  function prepProfile(d) {
    const p = d.profile || {};
    const sc = d.scope || {};
    const cs = d.consent || {};
    const name = h('input', { value: d.name || '', maxlength: 12 });
    const role = h('input', { value: d.role || '', maxlength: 20, placeholder: '예: 자료조사' });
    const intro = h('input', { value: p.intro || '', maxlength: 120, placeholder: '예: 자료조사 담당. 숫자와 근거를 먼저 봐요' });
    const exp = chipsInput(p.expertise, '예: 설문, 예산');
    const crit = listInputs(p.criteria, 3, i => ['1순위 (예: 학생 만족도)', '2순위 (예: 비용 대비 효과)', '3순위 (예: 준비 기간)'][i]);
    const proj = listInputs(p.projects, 3, '이번 안건과 관련된 경험');
    const tone = listInputs(p.tone_examples, 3, i => ['회의에서 자주 하는 말', '예시 2', '예시 3'][i]);
    const r1 = h('input', { type: 'radio', name: 'mm-scope-level', value: 'opinion', checked: sc.level !== 'answer' });
    const r2 = h('input', { type: 'radio', name: 'mm-scope-level', value: 'answer', checked: sc.level === 'answer' });
    const nc = chipsInput(sc.no_commit, '약속하면 안 되는 것 (예: 마감일)');
    const c1 = h('input', { type: 'checkbox', checked: cs.use_reports });
    const c2 = h('input', { type: 'checkbox', checked: cs.store_utterances });
    const save = h('button', { class: 'btn primary', type: 'button' }, '프로필 저장');
    save.addEventListener('click', () => run(save, '저장 중…', async () => {
      const member = await prepApi('PUT', '/profile', {
        name: name.value, role: role.value, intro: intro.value, expertise: exp.values(), criteria: readList(crit), projects: readList(proj),
        tone_examples: readList(tone), scope_level: r2.checked ? 'answer' : 'opinion', no_commit: nc.values(), scope_note: '',
        use_reports: c1.checked, store_utterances: c2.checked,
      });
      if (!applyPrep(member)) return;
      toast('프로필을 저장했어요.');
      S.prep.tab = 1; renderPrep();
    }));
    const checkRow = (input, text) => h('label', { class: 'check', style: 'font-weight:500' }, input, text);
    return [
      lead('미니미가 안건을 판단할 때 쓰는 것만 적어 주세요.'),
      tip('작성 팁',
        h('div', { class: 'cols' },
          h('div', {}, h('b', { text: '적어 주세요' }),
            bullets(['맡은 일과 관심 분야', '판단 기준과 우선순위', '이번 안건과 관련된 경험', '평소 말투 2~3문장', '어디까지 대신 말해도 되는지'])),
          h('div', {}, h('b', { text: '적지 않아요' }),
            bullets(['학번·연락처·주소', '나이·성별·출신', 'MBTI 같은 성격 검사', '건강·종교·정치 성향', '다른 사람의 개인정보']))),
        h('p', { class: 'muted sm', style: 'margin:8px 0 0', text: '신상 정보는 의견을 예측하는 데 도움이 안 되고, 개인정보 위험만 커져요.' })),
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, h('span', { text: '이름' }), name),
        h('label', { class: 'field' }, h('span', { text: '팀에서 맡은 일' }), role)),
      h('label', { class: 'field' }, h('span', { text: '한 줄 소개' }), intro),
      h('div', { class: 'field' }, fieldHead('관심·전문 키워드', 'Enter로 추가'), exp),
      h('div', { class: 'field' }, fieldHead('판단 기준', '중요한 순서대로'), crit),
      h('div', { class: 'field' }, fieldHead('관련 경험·프로젝트', '선택'), proj),
      h('div', { class: 'field' }, fieldHead('말투 예시', '말투만 따라 해요'), tone),
      h('div', { class: 'field' }, h('span', { text: '위임 범위' }),
        h('div', { class: 'radio-row' }, h('label', {}, r1, '의견 제시만'), h('label', {}, r2, '질문 답변까지')),
        nc),
      h('div', { class: 'field' }, h('span', { text: '동의' }),
        checkRow(c1, '내 보고서를 미니미의 근거로 써도 돼요'),
        checkRow(c2, '회의 발언에서 입장 변화를 찾아 저장해도 돼요 (확인 전엔 안 써요)')),
      right(save),
    ];
  }

  function prepReports(d) {
    const reports = d.reports || [];
    const title = h('input', { placeholder: '보고서 제목 (예: 자료조사 보고서)', maxlength: 60 });
    const text = h('textarea', { rows: 7, placeholder: '보고서 내용을 붙여 넣으세요. 빈 줄로 문단을 나눠 주세요.' });
    const add = h('button', { class: 'btn primary', type: 'button' }, icon('spark'), '올리고 입장 카드 초안 만들기');
    const tpl = h('button', { class: 'text-btn', type: 'button', title: '빈 줄로 나뉜 5문단 틀을 넣어요' }, icon('doc', 'xs'), '보고서 틀 넣기');
    tpl.addEventListener('click', () => {
      if (text.value.trim() && !text.value.includes('(예:')) { toast('내용이 있어서 틀을 넣지 않았어요.'); return; }
      text.value = ['조사한 사실 1: (숫자와 출처를 같이. 예: 작년 축제 만족도 조사에서 부스는 4.2점이었다)',
        '조사한 사실 2 또는 사례: (예: 한 대학은 공연을 1팀으로 줄이고도 방문객이 15% 늘었다)',
        '그래서 내 입장: 나는 ___이 좋다고 생각한다. 이유는 ___ 때문이다.',
        '조건: 다만 ___은 양보할 수 없다.',
        '아직 모르는 것: ___은 확인이 필요하다.'].join('\n\n');
      text.focus();
    });
    const after = res => {
      if (!applyPrep(res && res.member)) return;
      toast(res.candidates ? `입장 카드 초안 ${res.candidates}개를 만들었어요. 인터뷰에서 확인해 주세요.`
        : '보고서를 올렸어요. 입장이 드러난 문단은 없어서 인터뷰로 채울게요.');
      S.prep.tab = 2; renderPrep();
    };
    add.addEventListener('click', () => {
      if (!text.value.trim()) { toast('보고서 내용을 붙여 넣어 주세요.'); return; }
      run(add, '분석 중…', async () => after(await prepApi('POST', '/reports', { title: title.value, text: text.value })));
    });
    const file = h('input', { type: 'file', accept: '.txt,.md,.docx,.pdf', hidden: true });
    const pick = h('button', { class: 'link', type: 'button', on: { click: () => file.click() } }, '파일 고르기');
    const drop = h('div', { class: 'dropzone' },
      h('div', { class: 'hrow', style: 'justify-content:center;gap:6px' }, icon('upload', 'xs'), '파일을 끌어다 놓거나', pick),
      h('div', { class: 'sm', style: 'margin-top:4px;color:var(--faint)', text: 'txt · md · docx · pdf' }));
    const upload = async f => {
      if (!f || !S.prep || S.prep.preview) return;
      const fd = new FormData(); fd.append('file', f); fd.append('title', title.value);
      fill(drop, '분석 중…');
      try { after(await prepApi('POST', '/reports/upload', fd, true)); } catch (e) { toast(e.message, 'bad'); renderPrep(); }
    };
    file.addEventListener('change', () => upload(file.files[0]));
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); upload(e.dataTransfer.files[0]); });
    const removeReport = rep => async () => {
      try { if (applyPrep(await prepApi('DELETE', `/reports/${rep.id}`))) renderPrep(); } catch (e) { toast(e.message, 'bad'); }
    };
    return [
      lead('안건에 대해 쓴 보고서를 올리면 입장 카드 초안을 만들어 드려요.'),
      tip('작성 팁', bullets([
        '빈 줄로 문단을 나누면 문단마다 따로 인용돼요.',
        '입장이 드러난 문단은 입장 카드 초안이 돼요.',
        '초안은 내가 확인하기 전까지 근거로 쓰지 않아요.'])),
      h('label', { class: 'field' }, h('span', { text: '제목' }), title),
      h('div', { class: 'field' },
        h('div', { class: 'hrow', style: 'justify-content:space-between' }, h('span', { text: '내용' }),
          d.example ? h('button', { class: 'text-btn', type: 'button', title: '시연 시나리오의 예시 보고서를 넣어요',
            on: { click: () => { title.value = d.example.report_title; text.value = d.example.report_text; } } }, icon('doc', 'xs'), '예시 보고서 넣기') : tpl),
        text),
      drop, file,
      right(add),
      reports.length ? h('div', { class: 'section-title', text: `올린 보고서 ${reports.length}개` }) : null,
      reports.map(rep => h('div', { class: 'report' },
        h('div', { class: 'report-head' }, icon('doc', 'xs'), h('span', { class: 't', text: rep.title }),
          h('span', { class: 'muted sm', style: 'font-weight:400', text: `${(rep.paragraphs || []).length}문단` }),
          h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': '보고서 삭제', title: '삭제', on: { click: removeReport(rep) } }, icon('trash'))),
        // 라벨('보고서2 3문단')이 기본 56px 칸보다 길어서, 목록 전체를 한 격자로 맞춰 라벨 폭을 통일한다
        h('ol', { style: 'display:grid;grid-template-columns:max-content minmax(0,1fr);gap:6px 10px' },
          (rep.paragraphs || []).map((t, i) => h('li', { style: 'display:contents' },
            h('span', { class: 'lab', style: 'padding-top:1px', text: (rep.labels || [])[i] || `${i + 1}문단` }), h('span', { text: t })))))),
    ];
  }

  const QA_ORDER = { open: 0, answered: 1, confirmed: 2, skipped: 3 };
  const QA_STATE = { open: ['답 대기', ''], answered: ['확인 대기', 'warn'], confirmed: ['확인됨', 'ok'], skipped: ['건너뜀', ''] };

  function prepInterview(d) {
    const r = d.readiness || { covered: 0, total: 0, confirmed: 0 };
    const qs = d.interview || [];
    const plan = h('button', { class: 'btn primary', type: 'button' }, icon('spark'), qs.length ? '빈 쟁점 다시 확인하기' : '빈 곳만 질문 받기');
    plan.addEventListener('click', () => run(plan, '확인 중…', async () => {
      const res = await prepApi('POST', '/interview/plan');
      if (!applyPrep(res.member)) return;
      if (!(res.questions || []).length) toast('모든 쟁점에 확인된 입장이 있어요. 더 물어볼 게 없어요.');
      renderPrep();
    }));
    return [
      lead((r.confirmed || 0) >= r.total
        ? `쟁점 ${r.total}개 모두 확인된 입장이 있어요.`
        : `쟁점 ${r.total}개 중 ${r.confirmed || 0}개에 확인된 입장이 있어요. 비어 있는 곳만 짧게 물어볼게요.`),
      tip('작성 팁', bullets([
        '한 줄로 대충 답해도 돼요.',
        '미니미가 풀어 쓴 문장이 맞으면 "맞아요"를 눌러 주세요.',
        '확인한 문장만 미니미가 근거로 써요.'])),
      h('div', { class: 'hrow' }, plan),
      qs.slice().sort((a, b) => (QA_ORDER[a.status] ?? 9) - (QA_ORDER[b.status] ?? 9)).map(q => qaBox(q, d)),
    ];
  }

  function qaBox(q, d) {
    const issue = S.room && (S.room.issues || []).find(i => i.id === q.issue_id);
    const [sl, sk] = QA_STATE[q.status] || [q.status || '', ''];
    const head = h('div', { class: 'hrow' }, tag(sl, sk), issue ? h('span', { class: 'muted sm', text: issue.title }) : null);
    const question = h('div', { class: 'q', text: q.question });
    if (q.status === 'open') {
      const inp = h('input', { placeholder: '한 줄로 답해 주세요', maxlength: 400 });
      const go = h('button', { class: 'btn primary sm', type: 'button' }, '답하기');
      const submit = () => {
        if (!inp.value.trim() || go.disabled) return;
        run(go, '풀어 쓰는 중…', async () => {
          const res = await prepApi('POST', `/interview/${q.id}/answer`, { text: inp.value });
          if (applyPrep(res.member)) renderPrep();
        });
      };
      go.addEventListener('click', submit);
      inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) submit(); });
      const ex = d.example && (d.example.answers || {})[q.issue_id];
      return h('div', { class: 'qa' }, head, question, h('div', { class: 'row-form' }, inp, go),
        ex ? h('button', { class: 'text-btn sm', type: 'button', style: 'align-self:flex-start;text-align:left;color:var(--accent)',
          on: { click: () => { inp.value = ex; inp.focus(); } } }, `예시 답 넣기: "${ex}"`) : null);
    }
    const st = (d.stances || []).find(s => s.id === q.stance_id);
    if (q.status === 'answered' && st) {
      return h('div', { class: 'qa' }, head, question,
        h('div', { class: 'muted sm', text: `내 답: ${q.answer}` }),
        h('div', { class: 'cand-text', text: st.claim }),
        stanceActions(st, true));
    }
    return h('div', { class: 'qa' }, head, question,
      q.expanded ? h('div', { class: 'sm', text: q.expanded }) : h('div', { class: 'muted sm', text: q.answer || '' }));
  }

  function stanceActions(st, fromInterview = false) {
    const confirm = async (ok, edit = '') => {
      try {
        const res = await prepApi('POST', `/stances/${st.id}/confirm`, { ok, edit });
        if (!applyPrep(res.member)) return;
        if ((res.replaced || []).length) toast(`같은 쟁점의 예전 입장 카드 ${res.replaced.length}개를 새 입장으로 바꿨어요.`);
        else toast(ok ? '확인했어요. 이제 미니미가 이 문장을 근거로 써요.' : '버렸어요.');
        renderPrep();
      } catch (e) { toast(e.message, 'bad'); }
    };
    const editBtn = h('button', { class: 'btn xs', type: 'button' }, icon('edit', 'xs'), '고칠래요');
    editBtn.addEventListener('click', () => {
      const ta = h('textarea', { rows: 3, value: st.claim });
      editBtn.parentElement.replaceWith(h('div', { class: 'stack', style: 'gap:6px' }, ta,
        h('div', { class: 'hrow' },
          h('button', { class: 'btn primary xs', type: 'button', on: { click: () => confirm(true, ta.value) } }, '고쳐서 확인'),
          h('button', { class: 'btn ghost xs', type: 'button', on: { click: () => renderPrep() } }, '취소'))));
      ta.focus();
    });
    const remove = async () => {
      try { if (applyPrep(await prepApi('DELETE', `/stances/${st.id}`))) renderPrep(); } catch (e) { toast(e.message, 'bad'); }
    };
    const confirmed = st.status === 'confirmed';
    return h('div', { class: 'acts hrow' },
      !confirmed ? h('button', { class: 'btn primary xs', type: 'button', on: { click: () => confirm(true) } }, icon('check', 'xs'), '맞아요') : null,
      editBtn,
      !confirmed
        ? h('button', { class: 'btn ghost xs', type: 'button', on: { click: () => confirm(false) } }, fromInterview ? '아니에요' : '버리기')
        : h('button', { class: 'btn ghost xs', type: 'button', on: { click: remove } }, icon('trash', 'xs'), '삭제'));
  }

  const STANCE_STATE = { confirmed: ['확인됨', 'ok'], candidate: ['초안', 'warn'], inferred: ['회의에서 추정', 'info'] };
  const ORIGIN_KO = { report: '보고서', interview: '인터뷰', memory: '회의 기억', manual: '직접 작성' };

  function prepStances(d) {
    const issues = (S.room && S.room.issues) || [];
    const groups = issues.map(i => ({ id: i.id, title: i.title })).concat([{ id: '', title: '쟁점 없음' }]);
    const visible = (d.stances || []).filter(s => s.status !== 'rejected');
    const issueSel = h('select', {}, issues.map(i => h('option', { value: i.id, text: i.title })), h('option', { value: '', text: '쟁점 없음' }));
    const claim = h('textarea', { rows: 2, placeholder: '예: 저는 B안이 맞다고 생각해요', maxlength: 300 });
    const pos = h('input', { placeholder: '선택지 (예: B안)', maxlength: 20 });
    const red = h('input', { placeholder: '양보할 수 없는 조건 (선택)', maxlength: 200 });
    const add = h('button', { class: 'btn primary sm', type: 'button' }, icon('plus', 'xs'), '입장 카드 추가');
    add.addEventListener('click', () => {
      if (!claim.value.trim()) { toast('입장을 적어 주세요.'); return; }
      run(add, '추가 중…', async () => {
        const res = await prepApi('POST', '/stances', { issue_id: issueSel.value, claim: claim.value, position: pos.value, red_line: red.value });
        if (!applyPrep(res.member)) return;
        toast('입장 카드를 추가했어요.'); renderPrep();
      });
    });
    const card = s => {
      const [sl, sk] = STANCE_STATE[s.status] || [s.status, ''];
      const sub = [s.label, s.position, ORIGIN_KO[s.origin] || s.origin, s.priority === 1 ? '우선순위 높음' : null].filter(Boolean).join(' · ');
      return h('div', { class: `stance ${s.status || ''}` },
        h('div', { class: 'stance-top' }, tag(sl, sk), sub ? h('span', { text: sub }) : null),
        h('div', { class: 'claim-t', text: s.claim }),
        h('div', { class: 'meta' },
          s.reasons ? h('span', { text: `근거: ${s.reasons}` }) : null,
          s.warrant ? h('span', { text: `판단 기준: ${s.warrant}` }) : null,
          s.red_line ? h('span', { class: 'red', text: `양보 불가: ${s.red_line}` }) : null,
          s.unknown ? h('span', { text: `모르는 부분: ${s.unknown}` }) : null,
          (s.sources || []).length ? h('span', { text: `출처: ${s.sources.join(', ')}` }) : null),
        stanceActions(s));
    };
    return [
      lead('미니미는 확인된 입장 카드와 보고서에 있는 말만 해요.'),
      tip('입장 카드란?', bullets([
        '주장 · 근거 · 판단 기준 · 양보할 수 없는 조건 · 모르는 부분을 한 장에 정리한 거예요.',
        '같은 쟁점에서 다른 선택지를 확인하면 예전 카드는 자동으로 바뀌어요.'])),
      groups.map(g => {
        const list = visible.filter(s => (s.issue_id || '') === g.id);
        if (!list.length && !g.id) return null;
        return h('div', { class: 'stack', style: 'gap:8px' },
          h('div', { class: 'group-title', text: g.title }),
          list.length ? list.map(card) : h('div', { class: 'muted sm', text: '아직 입장이 없어요. 인터뷰에서 채워 주세요.' }));
      }),
      h('div', { class: 'group-title', text: '직접 추가' }),
      h('div', { class: 'stack', style: 'gap:8px' },
        h('label', { class: 'field' }, h('span', { text: '쟁점' }), issueSel),
        h('label', { class: 'field' }, h('span', { text: '내 입장' }), claim),
        h('div', { class: 'grid2' }, pos, red),
        right(add)),
    ];
  }

  function readinessList(items) {
    return h('ul', { class: 'ready-items' }, (items || []).map(it => {
      const [l, c] = RSTATE[it.state] || [it.state, ''];
      return h('li', {}, h('span', { class: 't', text: it.title }),
        it.evidence && it.evidence.length ? h('span', { class: 'e', text: it.evidence.slice(0, 2).join(', ') }) : null,
        tag(l, c));
    }));
  }

  function prepReady(d) {
    const r = d.readiness || { covered: 0, total: 0, items: [] };
    const pct = r.total ? Math.round(100 * r.covered / r.total) : 0;
    const isMe = d.user_id === S.me;
    const m = S.byId[d.user_id] || {};
    const openQs = (d.questions || []).filter(q => q.status === 'open');
    const forget = h('button', { class: 'btn danger sm', type: 'button' }, icon('trash', 'xs'), '내 기억 삭제');
    forget.addEventListener('click', () => confirmModal({
      eyebrow: '개인정보', title: '미니미의 기억을 모두 지울까요?', danger: true, ok: '모두 지우기',
      body: '보고서·입장 카드·인터뷰·미니미가 남긴 질문이 모두 지워지고 이름과 역할만 남아요. 되돌릴 수 없어요.',
      onOk: async () => {
        try { if (applyPrep(await prepApi('DELETE', '/memory'))) { toast('미니미의 기억을 지웠어요.'); renderPrep(); } } catch (e) { toast(e.message, 'bad'); }
      },
    }));
    return [
      h('div', { class: 'ready-big' },
        h('div', { class: 'ring', style: `--p:${pct}` }, h('span', { text: `${r.covered}/${r.total}` })),
        h('div', { class: 'grow' },
          h('div', { style: 'font-weight:700;font-size:15px', text: r.ready ? '모든 쟁점에 근거가 있어요' : `쟁점 ${r.total}개 중 ${r.covered}개에 답할 수 있어요` }),
          h('div', { class: 'muted sm', text: '근거가 없는 쟁점에서는 미니미가 말하지 않고 질문으로 남겨요.' }))),
      readinessList(r.items),
      isMe ? h('button', {
        class: 'toggle-row', type: 'button', role: 'switch', 'aria-checked': String(!!m.mini_on),
        on: { click: () => toggleAway() },
      },
      h('span', { class: 'grow', style: 'display:flex;flex-direction:column' },
        h('span', { class: 'lbl', text: '대리 참석' }),
        h('span', { class: 'desc', text: m.mini_on ? '지금 미니미가 대신 참석 중이에요' : '켜면 미니미가 회의에 대신 들어가요' })),
      h('span', { class: 'switch' })) : null,
      openQs.length ? h('div', { class: 'section-title', text: `미니미가 남긴 질문 ${openQs.length}개` }) : null,
      openQs.map(q => questionBox(q)),
      isMe ? h('div', { class: 'danger-zone' },
        h('span', { text: '미니미가 기억하는 내용은 언제든 지울 수 있어요.' }),
        forget) : null,
    ];
  }

  function questionBox(q, onDone) {
    const inp = h('input', { placeholder: '한 줄로 답하면 확인된 입장으로 저장돼요', maxlength: 400 });
    const share = h('input', { type: 'checkbox', checked: true });
    const go = h('button', { class: 'btn primary sm', type: 'button' }, '답하기');
    const submit = () => {
      if (!inp.value.trim() || go.disabled) return;
      run(go, '저장 중…', async () => {
        const data = await api('POST', `${memberUrl(S.me)}/questions/${q.id}/answer`, { text: inp.value, share: share.checked });
        if (S.prep && S.prep.uid === S.me) { S.prep.data = data; renderPrep(); }
        toast('답을 저장했어요. 다음엔 미니미가 이 근거로 답할 수 있어요.');
        if (onDone) onDone(data);
      });
    };
    go.addEventListener('click', submit);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) submit(); });
    return h('div', { class: 'qa' },
      h('div', { class: 'hrow' }, tag(q.reason, q.reason === '약속 필요' ? 'warn' : 'info'),
        h('span', { class: 'muted sm', text: `${nameOf(q.asked_by)} 님이 물음 · ${fmtTime(q.ts)}` })),
      h('div', { class: 'q', text: q.text }),
      h('div', { class: 'row-form' }, inp, go),
      h('label', { class: 'check sm' }, share, '답을 회의방에도 올리기'));
  }

  // ================================================================ 내가 빠진 사이
  function openDigest(d, { preview = false, uid = S.me } = {}) {
    S.digest = { data: d, preview, uid };
    renderDigest();
  }

  function digestMiniRow(m, x) {
    const bubble = h('div', { class: 'bubble' });
    renderCited(bubble, x.text || '', x.citations || []);
    return h('div', { class: `row mini first c${m.color || 0}${x.abstain ? ' abstain' : ''}`, style: 'margin-top:0' },
      h('span', { class: `av mini c${m.color || 0}`, 'aria-hidden': 'true' }, 'AI'),
      h('div', { class: 'col' },
        h('div', { class: 'who' }, h('b', { text: `${m.name} 미니미` }),
          x.abstain ? h('span', { class: 'chip-tag', text: x.abstain === 'commit' ? '약속 보류' : '확인 필요' }) : null,
          x.ts ? h('time', { text: fmtTime(x.ts) }) : null),
        bubble));
  }

  function renderDigest() {
    if (!S.digest) return;
    const { data: d, preview, uid } = S.digest;
    const liveQ = S.digest.liveQ;
    const m = S.byId[uid] || { name: '' };
    const live = id => ((S.room && S.room.decisions) || []).find(x => x.id === id);
    const decisions = (d.decisions || []).map(x => live(x.id) || x);
    const minis = d.mini || [];
    const qs = d.questions || [];
    const stat = (k, v) => h('span', {}, `${k} `, h('b', { text: String(v) }));
    const section = (title, items) => h('section', { class: 'digest-sec' }, h('div', { class: 'section-title', text: title }), items);

    const body = [
      preview ? h('div', { class: 'preview-note' }, icon('eye', 'xs'), `${m.name} 님 화면 미리보기 · 읽기 전용`) : null,
      h('p', { class: 'digest-sum', text: d.summary || '' }),
      h('div', { class: 'stats' },
        stat('대화', d.count || 0), stat('미니미 발언', minis.length), stat('보류 결정', decisions.length), stat('질문', qs.length),
        h('span', { text: `요약 ${engineLabel(d.engine)}` })),
      minis.length ? section(preview ? `${m.name}의 미니미가 대신 한 말` : '내 미니미가 대신 한 말', minis.map(x => digestMiniRow(m, x))) : null,
      decisions.length ? section('확인이 필요한 보류 결정', decisions.map(x => {
        const [l, c] = DSTATUS[x.status] || ['', ''];
        const resp = (x.responses || {})[uid];
        const sub = [x.issue_title, x.by_name ? `${x.by_name} 님 발언` : ''].filter(Boolean).join(' · ');
        return h('div', { class: 'qa' },
          h('div', { class: 'hrow', style: 'align-items:flex-start;flex-wrap:nowrap' }, h('b', { class: 'grow', text: x.text }), l ? tag(l, c) : null),
          sub ? h('div', { class: 'muted sm', text: sub }) : null,
          resp ? h('div', { class: 'note-line' }, h('b', { text: resp.action === 'approve' ? '승인했어요' : '이의를 달았어요' }), resp.note ? ` · ${resp.note}` : '')
            : (preview ? h('div', { class: 'muted sm', text: '확인 대기 중' }) : decideForm(x)));
      })) : null,
      qs.length ? section('미니미가 남긴 질문', qs.map(q => {
        if (preview) {
          const lq = liveQ && liveQ.find(x => x.id === q.id);
          return h('div', { class: 'qa' },
            h('div', { class: 'hrow' }, tag(q.reason, 'info'), h('span', { class: 'muted sm', text: `${nameOf(q.asked_by)} 님이 물음` })),
            h('div', { class: 'q', text: q.text }),
            lq && lq.status === 'answered' ? h('div', { class: 'note-line' }, h('b', { text: '답' }), ` ${lq.answer}`)
              : h('div', { class: 'muted sm', text: '답 대기 중' }));
        }
        return questionBox(q, data => {
          if (!S.digest) return;
          S.digest.data.questions = (S.digest.data.questions || []).filter(x => x.id !== q.id);
          S.digest.liveQ = data.questions;
          renderDigest();
        });
      })) : null,
      !minis.length && !decisions.length && !qs.length ? h('p', { class: 'muted sm', style: 'margin:0', text: '따로 확인할 건 없어요.' }) : null,
      !preview ? h('div', { class: 'modal-actions' },
        h('button', { class: 'btn', type: 'button', on: { click: () => { closeModal(); openPrep(S.me, { tab: 3 }); } } }, '입장 카드 보기'),
        h('button', { class: 'btn primary', type: 'button', on: { click: () => closeModal() } }, '확인했어요')) : null,
    ];
    openModal({
      eyebrow: preview ? '화면 미리보기' : '돌아온 걸 환영해요',
      title: preview ? `${m.name} 님이 빠진 사이` : '내가 빠진 사이',
      body: flat(body), wide: true,
    });
    S.digest = { data: d, preview, uid, liveQ: (S.digest && S.digest.liveQ) || liveQ };
  }

  async function onDigestReady(uid) {
    if (!(S.observer && S.demo && S.demo.view === `digest:${uid}`)) return;
    try {
      const det = await api('GET', memberUrl(uid));
      if (det.last_digest && det.last_digest.summary) { openDigest(det.last_digest, { preview: true, uid }); S.digest.liveQ = det.questions; }
    } catch { /* 무시 */ }
  }

  async function refreshDigestPreview() {
    if (!S.digest || !S.digest.preview) return;
    try {
      const det = await api('GET', memberUrl(S.digest.uid));
      if (!S.digest) return;
      S.digest.liveQ = det.questions; renderDigest();
    } catch { /* 무시 */ }
  }

  // ================================================================ 팀원 초대
  async function openInvite() {
    try {
      const d = await api('GET', `${roomUrl()}/invite`);
      const qr = h('div', { class: 'qr' });
      if (d.qr_svg) qr.innerHTML = d.qr_svg; // 서버가 만든 QR SVG (사용자 입력 아님)
      else qr.append(h('div', { class: 'muted sm', text: 'QR을 만들 수 없어요. 아래 주소를 보내 주세요.' }));
      const inp = h('input', { value: d.url, readonly: true, 'aria-label': '초대 주소' });
      const copy = h('button', {
        class: 'btn', type: 'button',
        on: {
          click: async () => {
            try { await navigator.clipboard.writeText(d.url); toast('주소를 복사했어요.'); } catch { inp.select(); toast('주소를 선택했어요. 복사해 주세요.'); }
          },
        },
      }, '복사');
      openModal({
        eyebrow: '팀원 초대', title: 'QR을 찍으면 바로 들어와요',
        body: [qr, h('div', { class: 'copy-row' }, inp, copy),
          h('p', { class: 'muted sm', style: 'margin:0', text: '서버와 같은 와이파이에 있어야 해요. 들어오면 자기 자리를 고르면 돼요.' })],
      });
    } catch (e) { toast(e.message, 'bad'); }
  }

  // ================================================================ 안건 편집
  function openAgenda() {
    const r = S.room || { agenda: '', issues: [] };
    const issues = r.issues || [];
    const title = h('input', { value: r.agenda || '', maxlength: 120, placeholder: '오늘 안건' });
    const ta = h('textarea', {
      rows: 5, placeholder: '쟁점: 선택지1, 선택지2',
      value: issues.map(i => ((i.options || []).length ? `${i.title}: ${i.options.map(o => o.label).join(', ')}` : i.title)).join('\n'),
    });
    const save = h('button', {
      class: 'btn primary', type: 'button',
      on: { click: () => { if (send({ type: 'agenda', title: title.value, issues: parseIssues(ta.value, issues) })) closeModal(); } },
    }, '저장');
    openModal({
      eyebrow: '안건', title: '안건과 쟁점',
      body: [
        h('label', { class: 'field' }, h('span', { text: '오늘 안건' }), title),
        h('label', { class: 'field' }, fieldHead('쟁점', "한 줄에 하나 · 선택지는 '쟁점: A안, B안'"), ta),
        h('p', { class: 'muted sm', style: 'margin:0', text: '쟁점을 바꾸면 모두의 준비도가 다시 계산돼요.' }),
        h('div', { class: 'modal-actions' }, h('button', { class: 'btn', type: 'button', on: { click: () => closeModal() } }, '취소'), save),
      ],
    });
  }

  // 기존 쟁점과 제목이 같은 줄에만 id를 붙인다. 새 줄은 id를 빼서 서버가 새로 정하게 한다 (중복 id 방지).
  function parseIssues(text, old = []) {
    const used = new Set();
    return String(text || '').split('\n').map(s => s.trim()).filter(Boolean).map(line => {
      const [t, opts] = line.split(/[:：]/);
      const title = (t || '').trim();
      const options = opts ? opts.split(/[,，/]/).map(s => s.trim()).filter(Boolean) : [];
      const prev = (old || []).find(o => o.title === title && !used.has(o.id));
      if (prev) { used.add(prev.id); return { id: prev.id, title, options }; }
      return { title, options };
    }).filter(it => it.title);
  }

  return {
    renderGate, renderEvidence, renderDrift, renderEngine, openPrep, refreshPrep, renderPrep,
    openDigest, renderDigest, onDigestReady, refreshDigestPreview, openInvite, openAgenda, parseIssues, readinessList,
  };
};
