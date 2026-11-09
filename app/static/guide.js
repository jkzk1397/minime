/* MINIME 첫 화면 안내 — 온보딩 카드 5장 + 개인정보 수집·이용 동의.
   - 카드 문구는 4조 멀티모달 보고서(온보딩 카드 5장)를 그대로 쓰고, 그림은 같은 캐릭터 규칙을 SVG로 다시 그렸다
     (사용자 = 진한 파랑, 팀원 = 연보라·하늘색, 미니미 = 같은 파랑이지만 반투명 + 점선 테두리로 'AI'임을 구분)
   - 동의 화면은 10주차 근거 설계 보고서 5-2 시안: 제15조 제2항 고지사항 4가지 + 제22조 제1항 항목별 동의
   app.js보다 먼저 로드되고, app.js가 window.MMGuide(ctx)를 한 번 부른다. 사용자 입력은 textContent로만 넣는다. */
'use strict';
window.MMGuide = function (ctx) {
  const { $, h: h0, fill: fill0, icon, toast, api, openModal, closeModal, store } = ctx;
  const flat = kids => kids.flat(6).filter(k => k != null && k !== false);
  const h = (t, p, ...k) => h0(t, p, ...flat(k));
  const fill = (el, ...k) => fill0(el, ...flat(k));
  const NS = 'http://www.w3.org/2000/svg';

  // ================================================================ 캐릭터 (SVG)
  let uidSeq = 0;
  function svg(tag, attrs = {}, kids = []) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
    [].concat(kids).filter(Boolean).forEach(c => el.append(typeof c === 'string' ? document.createTextNode(c) : c));
    return el;
  }
  const PALETTE = {
    me: ['#5b84ff', '#2f55e4', '#1e3bb8'],        // 사용자: 진한 파랑
    lav: ['#cbbcff', '#9f86f0', '#7b5fd6'],       // 팀원: 연보라
    sky: ['#bfe0ff', '#86bdf3', '#5a97d6'],       // 팀원: 하늘색
  };
  function grad(defs, colors) {
    const id = `mmg${++uidSeq}`;
    defs.append(svg('radialGradient', { id, cx: '35%', cy: '28%', r: '80%' }, [
      svg('stop', { offset: '0%', 'stop-color': '#ffffff', 'stop-opacity': '0.9' }),
      svg('stop', { offset: '22%', 'stop-color': colors[0] }),
      svg('stop', { offset: '70%', 'stop-color': colors[1] }),
      svg('stop', { offset: '100%', 'stop-color': colors[2] }),
    ]));
    return `url(#${id})`;
  }
  /** 말랑한 젤리 캐릭터. kind: me | lav | sky | mini(반투명 + 점선 = AI). face: dot | happy | worry */
  function blob(defs, x, y, s, kind = 'me', { face = 'dot', arm = '', look = 0 } = {}) {
    const mini = kind === 'mini';
    const fillUrl = grad(defs, PALETTE[mini ? 'me' : kind]);
    const g = svg('g', { transform: `translate(${x} ${y}) scale(${s})` });
    g.append(svg('ellipse', { cx: 0, cy: 46, rx: 34, ry: 6, fill: 'rgba(40,40,110,.12)' }));
    const body = 'M-34 30 C-38 -8 -26 -40 0 -40 C26 -40 38 -8 34 30 C33 42 20 46 0 46 C-20 46 -33 42 -34 30 Z';
    if (arm === 'wave' || arm === 'both') g.append(svg('ellipse', { cx: 33, cy: 2, rx: 9, ry: 13, fill: fillUrl, transform: 'rotate(-38 33 2)', opacity: mini ? 0.7 : 1 }));
    if (arm === 'hold' || arm === 'both') g.append(svg('ellipse', { cx: -33, cy: 12, rx: 9, ry: 12, fill: fillUrl, transform: 'rotate(30 -33 12)', opacity: mini ? 0.7 : 1 }));
    g.append(svg('path', { d: body, fill: fillUrl, opacity: mini ? 0.62 : 1 }));
    if (mini) {
      g.append(svg('path', { d: body, fill: 'none', stroke: '#2f55e4', 'stroke-width': 2.2, 'stroke-dasharray': '5 4', 'stroke-linecap': 'round' }));
      g.append(svg('path', { d: 'M27 -44 l2.4 5 5 2.4 -5 2.4 -2.4 5 -2.4 -5 -5 -2.4 5 -2.4z', fill: '#7b8cff' }));
    }
    g.append(svg('ellipse', { cx: -14, cy: -22, rx: 9, ry: 5, fill: '#ffffff', opacity: 0.45, transform: 'rotate(-25 -14 -22)' }));
    const ex = look * 4;
    const ink = mini ? '#1d2a6b' : '#141a3a';
    if (face === 'happy') {
      g.append(svg('path', { d: `M${-13 + ex} -8 q5 -6 10 0 M${4 + ex} -8 q5 -6 10 0`, stroke: ink, 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' }));
    } else {
      g.append(svg('ellipse', { cx: -8 + ex, cy: -8, rx: 3.6, ry: 5.4, fill: ink }));
      g.append(svg('ellipse', { cx: 9 + ex, cy: -8, rx: 3.6, ry: 5.4, fill: ink }));
    }
    if (face === 'happy') g.append(svg('path', { d: `M${-5 + ex} 4 q5 5 10 0`, stroke: ink, 'stroke-width': 2.6, fill: 'none', 'stroke-linecap': 'round' }));
    if (face === 'worry') g.append(svg('path', { d: `M${-4 + ex} 8 q4 -3 8 0`, stroke: ink, 'stroke-width': 2.4, fill: 'none', 'stroke-linecap': 'round' }));
    return g;
  }
  function table(x, y, w = 150) {
    return svg('g', {}, [
      svg('rect', { x: x - 6, y: y + 8, width: 12, height: 40, rx: 4, fill: '#d9dcef' }),
      svg('ellipse', { cx: x, cy: y + 48, rx: 30, ry: 6, fill: 'rgba(40,40,110,.08)' }),
      svg('ellipse', { cx: x, cy: y + 4, rx: w / 2, ry: w / 7.5, fill: '#e8eaf6' }),
      svg('ellipse', { cx: x, cy: y, rx: w / 2, ry: w / 7.5, fill: '#ffffff', stroke: '#e3e5f3' }),
    ]);
  }
  function chair(x, y, empty = false) {
    return svg('g', { transform: `translate(${x} ${y})` }, [
      svg('rect', { x: -26, y: -40, width: 52, height: 50, rx: 18, fill: '#fbfbff', stroke: '#e3e5f3' }),
      svg('rect', { x: -30, y: 4, width: 60, height: 18, rx: 9, fill: '#ffffff', stroke: '#e3e5f3' }),
      svg('path', { d: 'M-20 22 l-4 18 M20 22 l4 18', stroke: '#d9b48c', 'stroke-width': 4, 'stroke-linecap': 'round' }),
      empty ? svg('path', { d: 'M-16 -2 C-18 -24 -10 -36 0 -36 C10 -36 18 -24 16 -2', fill: 'none', stroke: '#6b78ff', 'stroke-width': 2.2, 'stroke-dasharray': '4 4', 'stroke-linecap': 'round' }) : null,
    ]);
  }
  function card(x, y, w, hgt, rot = 0, kids = []) {
    return svg('g', { transform: `translate(${x} ${y}) rotate(${rot})` }, [
      svg('rect', { x: 0, y: 3, width: w, height: hgt, rx: 12, fill: 'rgba(60,60,140,.10)' }),
      svg('rect', { x: 0, y: 0, width: w, height: hgt, rx: 12, fill: '#ffffff', stroke: '#e3e5f3' }), ...kids]);
  }
  const lines = (x, y, n, w, gap = 12, color = '#dfe3f6') => Array.from({ length: n }, (_, i) =>
    svg('rect', { x, y: y + i * gap, width: i === n - 1 ? w * 0.6 : w, height: 5, rx: 2.5, fill: color }));
  const text = (x, y, t, size = 12, weight = 700, color = '#2b3170', anchor = 'start') =>
    svg('text', { x, y, 'font-size': size, 'font-weight': weight, fill: color, 'text-anchor': anchor, 'font-family': 'inherit' }, [t]);
  const check = (x, y, r = 9, color = '#22a06b') => svg('g', {}, [svg('circle', { cx: x, cy: y, r, fill: color }),
    svg('path', { d: `M${x - r * 0.45} ${y} l${r * 0.32} ${r * 0.34} ${r * 0.55} -${r * 0.62}`, stroke: '#fff', 'stroke-width': 2.4, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })]);
  const sparks = (x, y, color = '#6b78ff') => svg('g', { stroke: color, 'stroke-width': 4, 'stroke-linecap': 'round' }, [
    svg('path', { d: `M${x} ${y} l-6 -10` }), svg('path', { d: `M${x + 12} ${y - 4} l2 -12` }), svg('path', { d: `M${x + 22} ${y + 4} l9 -7` })]);

  function scene(n) {
    const root = svg('svg', { viewBox: '0 0 400 300', class: 'ob-illus', role: 'img' });
    const defs = svg('defs');
    root.append(defs);
    root.append(svg('ellipse', { cx: 210, cy: 158, rx: 182, ry: 132, fill: 'url(#obBg)' }));
    defs.append(svg('radialGradient', { id: 'obBg' }, [svg('stop', { offset: '0%', 'stop-color': '#eef0ff' }), svg('stop', { offset: '100%', 'stop-color': '#eef0ff', 'stop-opacity': '0' })]));
    const add = (...els) => els.forEach(e => root.append(e));
    if (n === 0) {
      root.setAttribute('aria-label', '팀원 둘이 탁자에 앉아 있고 빈 의자 두 개에는 점선 실루엣이 있어요. 달력에는 X 표시가 있어요.');
      add(chair(118, 172), chair(286, 172));
      add(blob(defs, 124, 142, 0.9, 'lav', { face: 'happy' }), blob(defs, 280, 142, 0.9, 'sky', { face: 'dot', look: -1 }));
      add(table(202, 196, 176));
      add(chair(150, 262, true), chair(254, 262, true));                 // 비어 있는 두 자리: 점선 실루엣 = 있어야 할 사람
      add(card(296, 26, 76, 66, 8, [svg('rect', { x: 0, y: 0, width: 76, height: 18, rx: 9, fill: '#c8ccf6' }),
        ...[0, 1, 2].flatMap(r => [0, 1, 2].map(c => svg('rect', { x: 10 + c * 20, y: 26 + r * 12, width: 14, height: 7, rx: 2, fill: '#eceefa' }))),
        svg('circle', { cx: 60, cy: 52, r: 12, fill: '#ff6b7a' }), svg('path', { d: 'M54 46 l12 12 M66 46 l-12 12', stroke: '#fff', 'stroke-width': 3, 'stroke-linecap': 'round' })]));
      add(sparks(282, 36, '#ff8a95'));
    } else if (n === 1) {
      root.setAttribute('aria-label', '자료 문서에서 화살표를 따라 체크 표시가 된 입장 카드가 만들어지고, 파란 캐릭터가 카드를 들고 있어요.');
      add(card(30, 56, 112, 136, -8, [text(18, 30, '내 자료', 16, 800, '#4b5bd6'), ...lines(18, 46, 6, 76)]));
      add(card(70, 112, 104, 118, 5, [text(16, 28, '메모·채팅', 13, 800, '#7b5fd6'), ...lines(16, 44, 5, 70, 12, '#e6e1fb')]));
      add(svg('path', { d: 'M160 248 C196 278 236 262 246 226', fill: 'none', stroke: '#8f9bff', 'stroke-width': 10, 'stroke-linecap': 'round' }),
        svg('path', { d: 'M234 228 l13 -16 10 18z', fill: '#8f9bff' }));
      add(blob(defs, 340, 206, 1.0, 'me', { face: 'happy', arm: 'hold' }));
      add(card(196, 108, 124, 96, -4, [text(14, 24, '입장 카드', 13, 800, '#2b3170'),
        check(22, 44, 8), ...lines(36, 41, 1, 66), check(22, 64, 8), ...lines(36, 61, 1, 60), svg('rect', { x: 36, y: 74, width: 40, height: 5, rx: 2.5, fill: '#dfe3f6' })]));
      add(sparks(330, 120));
    } else if (n === 2) {
      root.setAttribute('aria-label', '반투명한 미니미가 팀원들과 같은 크기로 탁자에 앉아 말하고, 말풍선 아래에 근거 자료 7쪽 칩이 붙어 있어요.');
      add(table(206, 212, 190));
      add(blob(defs, 300, 176, 0.9, 'lav', { face: 'happy', look: -1 }), blob(defs, 210, 186, 0.82, 'sky', { face: 'dot' }));
      add(blob(defs, 112, 172, 1.0, 'mini', { face: 'happy', arm: 'wave', look: 1 }));
      add(card(36, 26, 168, 70, 0, [...lines(16, 18, 3, 120, 13, '#b9c6ff'), svg('rect', { x: 14, y: 50, width: 96, height: 14, rx: 7, fill: '#eef0ff' }),
        svg('circle', { cx: 24, cy: 57, r: 4, fill: '#6b78ff' }), text(32, 61, '근거: 자료 p.7', 9.5, 700, '#3d4ab8')]));
      add(svg('path', { d: 'M108 96 l8 18 8 -18z', fill: '#ffffff' }));
      add(card(290, 30, 82, 96, 6, [text(10, 20, '자료 p.7', 11, 800, '#4b5bd6'), ...lines(10, 32, 2, 58), svg('rect', { x: 8, y: 54, width: 66, height: 9, rx: 3, fill: '#ffe69a' }), ...lines(10, 74, 1, 58)]));
      add(svg('path', { d: 'M204 66 C240 70 260 84 294 90', fill: 'none', stroke: '#8f9bff', 'stroke-width': 2, 'stroke-dasharray': '4 4' }));
    } else if (n === 3) {
      root.setAttribute('aria-label', '반투명한 미니미가 물음표 메모를 들고 있고, 말풍선에 이 부분은 본인에게 확인이 필요해요라고 쓰여 있어요.');
      add(blob(defs, 160, 176, 1.25, 'mini', { face: 'worry', arm: 'hold' }));
      add(card(104, 182, 58, 50, -10, [text(29, 38, '?', 30, 800, '#6b78ff', 'middle')]));
      add(card(196, 30, 176, 74, 0, [text(88, 32, '이 부분은 본인에게', 12.5, 700, '#2b3170', 'middle'), text(88, 52, '확인이 필요해요.', 12.5, 700, '#2b3170', 'middle')]));
      add(svg('path', { d: 'M214 102 l-14 18 26 -14z', fill: '#ffffff' }));
      add(card(278, 132, 92, 104, 6, [svg('rect', { x: 30, y: -6, width: 32, height: 12, rx: 4, fill: '#ffd36b' }),
        text(12, 26, '남긴 질문', 11, 800, '#7a5a00'), ...[0, 1, 2].flatMap(i => [svg('rect', { x: 12, y: 38 + i * 20, width: 10, height: 10, rx: 3, fill: i === 0 ? '#ffd36b' : '#eef0fa' }), ...lines(28, 40 + i * 20, 1, 50)])]));
      add(sparks(110, 92));
    } else {
      root.setAttribute('aria-label', '사용자 캐릭터가 노트북에서 직접 체크하고, 회의 요약 창에 확정된 내용, 보류된 결정, 남겨둔 질문이 나뉘어 있어요.');
      add(card(196, 26, 178, 150, 0, [text(18, 28, '회의 요약', 14, 800, '#2b3170'),
        ...[['#22a06b', '확정된 내용'], ['#f0a020', '보류된 결정'], ['#7b6cf6', '남겨둔 질문']].flatMap(([c, t], i) => [
          svg('rect', { x: 12, y: 42 + i * 34, width: 154, height: 28, rx: 14, fill: '#f6f7ff' }),
          svg('circle', { cx: 28, cy: 56 + i * 34, r: 8, fill: c }), text(44, 60 + i * 34, t, 11.5, 700, '#2b3170')])]));
      add(blob(defs, 150, 194, 1.1, 'me', { face: 'happy', arm: 'hold' }));
      add(svg('g', { transform: 'translate(176 206) rotate(-8)' }, [
        svg('rect', { x: 0, y: 0, width: 84, height: 54, rx: 8, fill: '#8d93a8' }), svg('rect', { x: 6, y: 6, width: 72, height: 42, rx: 5, fill: '#dfe3f0' }),
        svg('rect', { x: -8, y: 52, width: 100, height: 10, rx: 5, fill: '#b5bacb' }), check(42, 27, 12)]));
      add(sparks(70, 116));
    }
    return root;
  }

  // ================================================================ 온보딩 카드 (멀티모달 보고서 4장)
  const CARDS = [
    { k: 'PROBLEM', title: ['팀 회의 날,', '둘이 못 온다면?'],
      body: ['수업, 아르바이트, 다른 팀플 일정까지. 네 명이 같은 시간에 모이는 건 생각보다 어려워요.',
        '결국 회의는 다음으로 미뤄지거나, 남은 사람끼리 결정하게 돼요.',
        '그러면 빠진 사람의 의견은 논의에서 사라지고, 나중에 같은 설명을 또 반복해야 해요.'],
      chips: [['clock', '회의 연기'], ['x', '의견 누락'], ['reset', '같은 설명 반복']] },
    { k: 'PREPARE', title: ['내 자료로', '내 미니미 준비'],
      body: ['회의 전에 내가 쓴 보고서나 제안서를 올려요.',
        'AI가 자료를 읽고, 안건마다 비어 있는 부분만 골라서 짧게 물어봐요.',
        '3분 인터뷰에 답하고 “맞아요”를 누르면, 내 입장을 담은 입장 카드가 완성돼요. 내가 확인한 내용만 미니미가 쓸 수 있어요.'],
      extra: '보고서가 없으면 1분 빠른 입장 체크로도 준비할 수 있어요.',
      chips: [['upload', '보고서 업로드'], ['msg', '3분 인터뷰'], ['check', '입장 카드 확인']], arrows: true },
    { k: 'ATTEND', title: ['회의엔', '미니미가 대신 가요'],
      body: ['내가 자리를 비워도, 내 미니미가 회의에 참석해서 팀원들과 함께 논의해요.',
        '안건이 나오면 입장 카드와 보고서를 찾아보고, 필요한 순간에만 의견을 말해요.',
        '모든 발언에는 근거가 표시돼서, 팀원들이 “이건 보고서 몇 쪽 내용이구나” 하고 바로 확인할 수 있어요.'],
      chips: [['msg', '필요할 때만 발언'], ['doc', '모든 말에 근거 표시'], ['mini', 'AI 발언은 따로 구분']] },
    { k: 'SILENCE', title: ['모르는 건', '지어내지 않아요'],
      body: ['내 자료에 없는 질문을 받으면, 미니미는 그럴듯하게 꾸며 말하지 않아요.',
        '대신 “이 부분은 본인에게 확인이 필요해요”라고 말하고, 질문을 메모로 남겨둬요.',
        '돌아온 내가 답하면, 그 답은 다음 회의부터 미니미가 쓸 수 있는 내 입장으로 저장돼요.'],
      chips: [['help', '근거 없음 → 침묵'], ['edit', '질문은 메모로 저장'], ['spark', '내 답으로 미니미 성장']] },
    { k: 'CONFIRM', title: ['최종 결정은', '내가'],
      body: ['회의가 끝나면 미니미가 내가 빠진 사이의 내용을 정리해서 알려줘요.',
        '확정된 내용, 나에게 영향을 주는 보류된 결정, 남겨둔 질문을 한눈에 볼 수 있어요.',
        '보류된 결정은 내가 직접 승인하거나 이의를 남길 수 있어요. 의견은 미니미가 전하고, 결정은 사람이 해요.'],
      chips: [['check', '확정'], ['clock', '보류 → 내가 승인·이의'], ['help', '남긴 질문에 답하기']] },
  ];

  let OB = null;
  function openOnboarding({ start = 0, onFinish = null } = {}) {
    let el = $('#onboarding');
    if (!el) { el = h('div', { id: 'onboarding', class: 'ob', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'MINIME 이용 안내' }); document.body.append(el); }
    OB = { i: start, onFinish, el, prevFocus: document.activeElement };
    el.hidden = false;
    document.body.classList.add('ob-open');
    renderOb();
    el.onkeydown = e => {
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    };
    let sx = null;
    el.ontouchstart = e => { sx = e.touches[0].clientX; };
    el.ontouchend = e => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); sx = null; };
  }
  function go(d) {
    if (!OB) return;
    const n = OB.i + d;
    if (n >= CARDS.length) { finish(true); return; }
    OB.i = Math.max(0, n);
    renderOb();
  }
  function finish(done) {
    if (!OB) return;
    store.set('minime.onboarded', 1);
    OB.el.hidden = true;
    document.body.classList.remove('ob-open');
    const cb = OB.onFinish;
    const prev = OB.prevFocus;
    OB = null;
    if (prev && prev.focus) try { prev.focus(); } catch { /* */ }
    if (cb) cb(done);
  }
  function renderOb() {
    const c = CARDS[OB.i];
    const last = OB.i === CARDS.length - 1;
    const chips = c.chips.map(([ic, t], i) => [i && c.arrows ? h('span', { class: 'ob-arrow', 'aria-hidden': 'true' }, icon('chev', 'xs')) : null,
      h('span', { class: 'ob-chip' }, icon(ic, 'xs'), t)]);
    fill(OB.el,
      h('div', { class: 'ob-card', 'data-step': String(OB.i + 1) },
        h('button', { class: 'ob-skip text-btn', type: 'button', on: { click: () => finish(false) } }, '건너뛰기'),
        h('div', { class: 'ob-main' },
          h('div', { class: 'ob-text' },
            h('div', { class: 'ob-kicker' }, h('span', { text: `MINIME 0${OB.i + 1}` }), h('b', { text: ` · ${c.k}` })),
            h('h2', { class: 'ob-title', id: 'obTitle' }, c.title[0], h('br'), c.title[1]),
            h('span', { class: 'ob-rule', 'aria-hidden': 'true' }),
            c.body.map(t => h('p', { text: t })),
            c.extra ? h('p', { class: 'ob-extra' }, icon('info', 'xs'), c.extra) : null),
          h('div', { class: 'ob-art' }, scene(OB.i))),
        h('div', { class: 'ob-chips' }, chips),
        h('div', { class: 'ob-foot' },
          h('div', { class: 'ob-dots', role: 'tablist', 'aria-label': '안내 카드' }, CARDS.map((_, i) => h('button', {
            type: 'button', role: 'tab', 'aria-selected': String(i === OB.i), 'aria-label': `${i + 1}번째 카드`,
            on: { click: () => { OB.i = i; renderOb(); } } }))),
          h('span', { class: 'grow' }),
          OB.i ? h('button', { class: 'btn ghost', type: 'button', on: { click: () => go(-1) } }, '이전') : null,
          h('button', { class: 'btn primary ob-next', type: 'button', on: { click: () => go(1) } }, last ? '시작하기' : '다음', icon(last ? 'check' : 'chev', 'xs')))));
    OB.el.setAttribute('aria-labelledby', 'obTitle');
    const nx = OB.el.querySelector('.ob-next');
    if (nx) nx.focus();
  }

  // ================================================================ 개인정보 수집·이용 동의 (10주차 보고서 5-2)
  let noticeCache = null;
  async function notice() {
    if (!noticeCache) noticeCache = await api('GET', '/api/privacy');
    return noticeCache;
  }

  /** 동의 화면. 결과: Promise<'ok' | 'observe' | 'cancel'> */
  async function openConsent(roomId, uid, { current = null, change = false } = {}) {
    let n;
    try { n = await notice(); } catch (e) { toast(e.message, 'bad'); return 'cancel'; }
    return new Promise(resolve => {
      let settled = false;
      const done = v => { if (!settled) { settled = true; resolve(v); } };
      const cur = current || {};
      const boxes = {};
      const ok = h('button', { class: 'btn primary', type: 'button', disabled: true }, icon('check', 'xs'), change ? '저장' : '동의하고 시작');
      const sync = () => { ok.disabled = !boxes.service.checked; };
      const items = n.items.map(it => {
        const box = h('input', { type: 'checkbox', checked: change ? !!cur[it.key] : false });   // 처음에는 모두 해제
        boxes[it.key] = box;
        box.addEventListener('change', sync);
        return h('section', { class: `consent-item${it.required ? ' req' : ''}` },
          h('label', { class: 'consent-head' }, box,
            h('b', { class: 'grow', text: it.title }),
            h('span', { class: `tag ${it.required ? 'warn' : 'info'}`, text: it.required ? '필수' : '선택' })),
          h('dl', { class: 'consent-table' },
            h('dt', { text: '목적' }), h('dd', { text: it.purpose }),
            h('dt', { text: '항목' }), h('dd', { text: it.fields }),
            h('dt', { text: '거부 시' }), h('dd', { text: it.refuse })));
      });
      sync();
      ok.addEventListener('click', async () => {
        ok.disabled = true;
        try {
          const member = await api('POST', `/api/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(uid)}/consent`, {
            service: boxes.service.checked, use_reports: boxes.use_reports.checked, store_utterances: boxes.store_utterances.checked });
          settled = true; closeModal(); resolve({ result: 'ok', member });
        } catch (e) { toast(e.message, 'bad'); sync(); }
      });
      const observe = h('button', { class: 'btn ghost', type: 'button', on: { click: () => { settled = true; closeModal(); resolve('observe'); } } }, '관전만 하기');
      const fact = (ic, k, v) => h('div', { class: 'consent-fact' }, icon(ic, 'xs'), h('b', { text: k }), h('span', { text: v }));
      openModal({
        eyebrow: '개인정보 수집·이용 동의', title: change ? '동의 내용 보기·바꾸기' : '시작하기 전에 확인해 주세요', wide: true,
        body: [
          h('p', { class: 'lead-text', text: '항목마다 따로 골라 주세요. 선택 항목은 동의하지 않아도 회의에 참여할 수 있어요.' }),
          items,
          h('div', { class: 'consent-facts' },
            fact('clock', '보유 기간', n.keep || n.items[0].keep),
            fact('doc', '저장 위치', n.where),
            fact('shield', '외부 전송', n.outside.join(' · ')),
            fact('check', '내 권리', n.rights)),
          h('details', { class: 'consent-law' }, h('summary', { text: '법적 근거' }),
            h('ul', {}, n.law.map(t => h('li', { text: t }))),
            h('p', { class: 'muted sm', text: n.note })),
          h('div', { class: 'modal-actions' }, change ? h('button', { class: 'btn ghost', type: 'button', on: { click: () => { settled = true; closeModal(); resolve('cancel'); } } }, '닫기') : observe, ok),
        ],
      });
      // 모달을 다른 방법(닫기 버튼·바깥 누르기·Esc)으로 닫으면 취소로 본다
      const watch = setInterval(() => { if ($('#modal').hidden) { clearInterval(watch); done('cancel'); } }, 300);
    });
  }

  /** 자리에 앉기 전에 동의를 확인한다. 이미 지금 버전으로 동의했으면 바로 통과. */
  async function ensureConsent(roomId, uid) {
    let d;
    try { d = await api('GET', `/api/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(uid)}`); }
    catch (e) { toast(e.message, 'bad'); return 'cancel'; }
    if (d.consent_ok) return 'ok';
    const r = await openConsent(roomId, uid, { current: d.consent });
    return r && r.result === 'ok' ? 'ok' : r;
  }

  return { openOnboarding, openConsent, ensureConsent, scene, onboarded: () => !!store.get('minime.onboarded') };
};
