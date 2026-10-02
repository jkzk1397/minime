/* MyMini 클라이언트 — 로비 · 회의방 · 미니미의 머릿속 · 내 미니미 준비 · 내가 빠진 사이 · 시연 가이드.
   빌드 없이 도는 단일 파일. 사용자 입력은 모두 textContent로만 넣는다(XSS 방지). */
'use strict';
(() => {
  // ================================================================ 도구
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const SVGNS = 'http://www.w3.org/2000/svg';

  function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === 'style') el.style.cssText = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'open') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(3)) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  function fill(el, ...kids) {
    el.replaceChildren(...kids.flat(3).filter(k => k != null && k !== false)
      .map(k => (k instanceof Node ? k : document.createTextNode(String(k)))));
    return el;
  }
  function icon(name, cls = '') {
    const s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('class', `ic ${cls}`);
    s.setAttribute('aria-hidden', 'true');
    const u = document.createElementNS(SVGNS, 'use');
    u.setAttribute('href', `#i-${name}`);
    s.append(u);
    return s;
  }
  const pad = n => String(n).padStart(2, '0');
  function fmtTime(ts) { const d = new Date(ts * 1000); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
  function fmtDur(sec) { sec = Math.max(0, Math.floor(sec)); const m = Math.floor(sec / 60); return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}:${pad(sec % 60)}`; }
  const clip = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const store = {
    get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 불가 환경 */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* */ } },
  };
  function toast(text, kind = '') {
    const t = h('div', { class: `toast ${kind}`, role: 'status', text });
    $('#toasts').append(t);
    setTimeout(() => t.remove(), kind === 'bad' ? 5200 : 3200);
  }
  async function api(method, path, body, isForm = false) {
    const opt = { method, headers: {} };
    if (body !== undefined) {
      if (isForm) opt.body = body;
      else { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    }
    const r = await fetch(path, opt);
    let data = null;
    try { data = await r.json(); } catch { /* 본문 없음 */ }
    if (!r.ok) throw new Error((data && data.detail) || `요청 실패 (${r.status})`);
    return data;
  }
  function busy(btn, on, label) {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.textContent; btn.disabled = true; if (label) btn.textContent = label; }
    else { btn.disabled = false; if (btn.dataset.label != null && label) btn.textContent = btn.dataset.label; }
  }

  const ACT = { rebuttal: '반론', opinion: '의견', answer: '답변', agree_add: '동의 + 조건' };
  const VERDICT = { supported: ['근거 있음', 'ok'], weak: ['근거 약함', 'warn'], conflict: ['충돌', 'bad'], none: ['근거 없음', 'warn'] };
  const DSTATUS = { confirmed: ['확정', 'ok'], pending: ['보류', 'warn'], needs_check: ['확인 필요', 'info'], objected: ['이의', 'bad'] };
  const ISTATUS = { open: ['논의 전', ''], discussing: ['논의 중', 'info'], pending: ['보류', 'warn'], decided: ['결정', 'ok'] };
  const RSTATE = { confirmed: ['확인된 입장', 'ok'], report: ['보고서 근거', 'info'], candidate: ['초안만', 'warn'], none: ['근거 없음', 'bad'] };
  const MODE_KO = { intervene: '개입형', interactive: '상호작용형', call: '호출형' };

  function engineLabel(e) {
    if (!e || e === 'rule') return '규칙';
    const [kind, ...rest] = e.split(':');
    return `${kind === 'ollama' ? '로컬' : kind === 'api' ? 'API' : kind} · ${rest.join(':')}`;
  }

  // ================================================================ 상태
  const S = {
    roomId: null, me: null, observer: false, room: null, members: [], byId: {},
    messages: [], msgEls: new Map(), drift: [], gate: null, gateByMsg: new Map(), selGate: null,
    status: null, demo: null, demoSel: 0, ws: null, retry: 0, pingT: null, closedByUser: false,
    typing: {}, cmode: 'direct', dash: 'gate', prep: null, digest: null, mention: null, typingSent: 0, typingOffT: null,
  };
  const me = () => S.byId[S.me];
  const nameOf = uid => { if (S.byId[uid]) return S.byId[uid].name; if (uid) S.unknownSeen = true; return '알 수 없음'; };

  function avatar(m, { mini = false, size = '', online = null } = {}) {
    const el = h('span', { class: `av ${size} c${(m && m.color) || 0}${mini ? ' mini' : ''}`, 'aria-hidden': 'true' },
      ((m && m.name) || '?').slice(0, 1));
    if (mini) el.append(h('span', { class: 'badge' }, icon('spark')));
    if (online != null && !mini) el.append(h('span', { class: `dot${online ? ' on' : ''}` }));
    return el;
  }
  function chip(text, cls = '', ic = null) { return h('span', { class: `chip ${cls}` }, ic ? icon(ic) : null, text); }

  // ================================================================ 시작
  function init() {
    const theme = store.get('mymini.theme');
    if (theme) document.documentElement.dataset.theme = theme;
    else if (matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.dataset.theme = 'dark';
    bindStatic();
    const qs = new URLSearchParams(location.search);
    const roomQ = qs.get('room');
    const sess = store.get('mymini.session');
    if (sess && (!roomQ || roomQ === sess.room) && !qs.has('lobby')) {
      join(sess.room, sess.uid, sess.observer);
    } else {
      showLobby(roomQ || (sess && sess.room) || 'demo');
    }
  }

  // ================================================================ 로비
  function showLobby(roomId) {
    closeWs();
    $('#app').hidden = true;
    $('#demoPanel').hidden = true;
    $('#lobby').hidden = false;
    document.title = 'MyMini · 팀플 회의 AI';
    if (roomId) { $('#roomInput').value = roomId; loadLobbyRoom(roomId); }
  }

  async function loadLobbyRoom(roomId) {
    try {
      const d = await api('GET', `/api/rooms/${encodeURIComponent(roomId)}`);
      const box = $('#lobbyRoom');
      box.hidden = false;
      box.dataset.room = roomId;
      $('#lobbyRoomTitle').textContent = d.room.title || `방 ${roomId}`;
      $('#lobbyAgenda').textContent = d.room.agenda || '안건이 아직 없어요';
      const members = d.members.members;
      const online = members.filter(m => m.online).length;
      $('#lobbyOnline').textContent = `${online}명 접속 중`;
      $('#lobbyOnline').className = `chip ${online ? 'ok' : ''}`;
      const grid = $('#seatGrid');
      fill(grid);
      if (!members.length) grid.append(h('p', { class: 'empty', text: '아직 팀원이 없어요. 아래에서 새 팀원으로 들어오세요.' }));
      for (const m of members) {
        const r = m.readiness || { covered: 0, total: 0 };
        const pct = r.total ? Math.round(100 * r.covered / r.total) : 0;
        grid.append(h('button', {
          class: `seat${m.online ? ' taken' : ''}`, type: 'button',
          on: { click: () => pickSeat(roomId, m) },
        }, avatar(m, { size: 'lg', online: m.online }),
        h('div', { class: 'grow' },
          h('div', { class: 'nm', text: m.name }),
          h('div', { class: 'rl', text: m.role || '역할 미정' }),
          h('div', { class: 'st muted', text: m.online ? '접속 중' : (m.mini_on ? '미니미 대리 참석 중' : `준비도 ${r.covered}/${r.total}`) }),
          h('div', { class: `meter${r.ready ? ' ok' : ''}` }, h('i', { style: `width:${pct}%` })))));
      }
    } catch (e) {
      $('#lobbyRoom').hidden = true;
      if (/찾을 수|404/.test(e.message)) toast('방을 찾을 수 없어요.', 'bad'); else toast(e.message, 'bad');
    }
  }

  function pickSeat(roomId, m) {
    if (!m.online) return join(roomId, m.user_id, false);
    confirmModal({
      eyebrow: '자리 선택', title: `${m.name} 님 자리는 이미 접속 중이에요`,
      body: '같은 사람이 다른 기기로 들어오는 경우에만 계속하세요. 두 기기 모두 같은 사람으로 표시돼요.',
      ok: '그래도 들어가기', onOk: () => join(roomId, m.user_id, false),
    });
  }

  // ================================================================ 입장·연결
  function join(roomId, uid, observer) {
    S.roomId = roomId; S.me = observer ? null : uid; S.observer = !!observer;
    S.messages = []; S.msgEls.clear(); S.gateByMsg.clear(); S.gate = null; S.selGate = null; S.drift = [];
    store.set('mymini.session', { room: roomId, uid, observer: !!observer });
    const url = new URL(location.href);
    url.searchParams.set('room', roomId); url.searchParams.delete('lobby');
    history.replaceState(null, '', url);
    $('#lobby').hidden = true;
    $('#app').hidden = false;
    fill($('#feed'));
    renderComposerState();
    if (observer) openDemoPanel();
    connect();
  }

  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const uid = S.observer ? `obs${Math.random().toString(36).slice(2, 8)}` : S.me;
    return `${proto}://${location.host}/ws/${encodeURIComponent(S.roomId)}/${encodeURIComponent(uid)}${S.observer ? '?observer=1' : ''}`;
  }
  function connect() {
    closeWs();
    S.closedByUser = false;
    const ws = new WebSocket(wsUrl());
    S.ws = ws;
    ws.onopen = () => {
      S.retry = 0;
      $('#connBanner').hidden = true;
      clearInterval(S.pingT);
      S.pingT = setInterval(() => send({ type: 'ping' }, true), 20000);
    };
    ws.onmessage = ev => { try { dispatch(JSON.parse(ev.data)); } catch (e) { console.error(e); } };
    ws.onclose = ev => {
      clearInterval(S.pingT);
      if (S.ws !== ws || S.closedByUser) return;
      if (ev.code === 4404) { store.del('mymini.session'); toast('방에 없는 팀원이에요. 다시 자리를 골라 주세요.', 'bad'); showLobby(S.roomId); return; }
      $('#connBanner').hidden = false;
      const wait = Math.min(8000, 600 * 2 ** S.retry++);
      setTimeout(() => { if (S.ws === ws) connect(); }, wait);
    };
  }
  function closeWs() {
    S.closedByUser = true;
    clearInterval(S.pingT);
    if (S.ws) { try { S.ws.close(); } catch { /* */ } }
    S.ws = null;
  }
  function send(obj, quiet = false) {
    if (S.ws && S.ws.readyState === 1) { S.ws.send(JSON.stringify(obj)); return true; }
    if (!quiet) toast('연결 중이에요. 잠시 후 다시 시도해 주세요.', 'bad');
    return false;
  }

  // ================================================================ 서버 이벤트
  function dispatch(d) {
    switch (d.type) {
      case 'hello': break;
      case 'room': S.room = d; renderRoom(); break;
      case 'members': setMembers(d.members); break;
      case 'history':
        S.messages = d.messages || []; S.drift = d.drift || [];
        if (d.gate) { S.gate = d.gate; S.gateByMsg.set(d.gate.msg_id, d.gate); }
        renderFeed(); renderDash(); break;
      case 'message': addMessage(d); break;
      case 'gate': S.gate = d; S.gateByMsg.set(d.msg_id, d); S.selGate = null; renderGate(); renderEvidence(); break;
      case 'drift': S.drift.push(d); if (S.drift.length > 200) S.drift.shift(); renderDrift(); break;
      case 'typing': onTyping(d); break;
      case 'status': S.status = d; renderEnginePill(); renderEngine(); break;
      case 'decision': updateDecision(d.decision); break;
      case 'away_digest': if (d.user_id === S.me) openDigest(d, { preview: false, uid: S.me }); break;
      case 'digest_ready': onDigestReady(d.user_id); break;
      case 'memory':
        if (d.user_id === S.me && d.stances.length) toast(`회의에서 입장 변화 후보 ${d.stances.length}개를 찾았어요. '내 미니미 준비 › 입장 카드'에서 확인해 주세요.`);
        break;
      case 'refine': showRefine(d); break;
      case 'prep_update':
        if (S.prep && S.prep.uid === d.user_id) {
          // 시연 미리보기는 흐름을 따라간다: 보고서 → 인터뷰 → (끝나면) 준비도
          if (S.prep.preview) S.prep.tab = d.event === 'report' ? 1 : 2;
          refreshPrep();
        }
        break;
      case 'demo': S.demo = d; onDemo(d); break;
      case 'reset':
        S.messages = []; S.msgEls.clear(); S.gate = null; S.gateByMsg.clear(); S.drift = [];
        renderFeed(); renderDash(); closeModal();
        if (S.prep && !S.prep.preview) closeSheet();
        toast('방을 시연 시작 상태로 되돌렸어요.');
        break;
      case 'activity': toast(d.text); break;
      case 'error': toast(d.text || '오류가 났어요.', 'bad'); break;
      default: break;
    }
  }

  function setMembers(list) {
    S.members = list;
    S.byId = Object.fromEntries(list.map(m => [m.user_id, m]));
    if (S.unknownSeen) { S.unknownSeen = false; renderFeed(); }
    renderMembers(); renderMyCard(); renderMe(); renderComposerState(); renderGate();
    if (S.prep && S.prep.preview) refreshPrep();
  }

  // ================================================================ 상단·왼쪽
  let timerT = null;
  function renderRoom() {
    const r = S.room;
    if (!r) return;
    document.title = `${r.title || r.room_id} · MyMini`;
    $('#roomTitle').textContent = r.title || `방 ${r.room_id}`;
    $('#roomAgenda').textContent = r.agenda || '안건을 정해 주세요';
    $('#agendaTitle').textContent = r.agenda || '안건이 없어요';
    $$('#modeSeg button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === r.mode)));
    renderIssues(); renderDecisions(); renderIssueStrip(); renderMeeting(); refreshDecisionCards();
    if (S.digest && S.digest.preview) renderDigest();
  }
  function renderMeeting() {
    clearInterval(timerT);
    const el = $('#meetingState');
    const m = (S.room && S.room.meeting) || {};
    const tick = () => {
      if (m.status === 'live') fill(el, h('span', { class: 'live' }, `회의 중 ${fmtDur(Date.now() / 1000 - m.started_at)}`));
      else if (m.status === 'ended') fill(el, chip('회의 종료', 'ok', 'check'));
      else fill(el, chip('시작 전', '', 'clock'));
    };
    tick();
    if (m.status === 'live') timerT = setInterval(tick, 1000);
    $('#endBtn').disabled = S.observer || m.status !== 'live';
  }
  function renderIssues() {
    const ul = $('#issueList');
    fill(ul);
    const issues = (S.room && S.room.issues) || [];
    if (!issues.length) ul.append(h('li', { class: 'empty' }, '쟁점이 없어요. 편집에서 추가하세요.'));
    issues.forEach((it, i) => {
      const [label, cls] = ISTATUS[it.status] || ISTATUS.open;
      ul.append(h('li', { class: it.id === S.room.current_issue ? 'current' : '' },
        h('span', { class: 'num', text: i + 1 }),
        h('span', { class: 't' }, it.title,
          it.options && it.options.length ? h('span', { class: 'opts', text: it.options.map(o => o.label).join(' / ') }) : null),
        chip(label, cls)));
    });
  }
  function renderIssueStrip() {
    const el = $('#issueStrip');
    const r = S.room;
    const cur = r && r.issues.find(i => i.id === r.current_issue);
    const n = r ? r.issues.indexOf(cur) + 1 : 0;
    fill(el, icon('target'), cur ? h('span', {}, `지금 쟁점 ${n} · `, h('b', { text: cur.title })) : h('span', { class: 'muted', text: '쟁점을 이야기하면 여기에 지금 쟁점이 표시돼요' }),
      h('span', { class: 'grow' }), r ? chip(`미니미: ${MODE_KO[r.mode]}`, 'ai', 'spark') : null);
  }
  function renderDecisions() {
    const ul = $('#decisionList');
    const ds = (S.room && S.room.decisions) || [];
    $('#decisionCount').textContent = ds.length ? `${ds.length}개` : '';
    fill(ul);
    if (!ds.length) { ul.append(h('li', { class: 'empty' }, '아직 결정이 없어요')); return; }
    for (const d of ds.slice().reverse()) {
      const [label, cls] = DSTATUS[d.status] || ['', ''];
      ul.append(h('li', {}, h('div', { class: 'row' }, chip(label, cls), d.issue_title ? h('span', { class: 'muted sm', text: d.issue_title }) : null),
        h('div', { class: 't', text: d.text }),
        d.status === 'pending' && d.affected_names.length ? h('div', { class: 'muted sm', text: `확인 필요: ${d.affected_names.join(', ')}` }) : null));
    }
  }
  function renderMembers() {
    const ul = $('#memberList');
    fill(ul);
    const online = S.members.filter(m => m.online).length;
    const minis = S.members.filter(m => m.mini_on).length;
    $('#presenceCount').textContent = `접속 ${online} · 미니미 ${minis}`;
    for (const m of S.members) {
      const r = m.readiness || { covered: 0, total: 0 };
      const status = m.mini_on ? '미니미가 대리 참석 중' : (m.online ? '접속 중' : '오프라인');
      ul.append(h('li', { class: 'member' }, avatar(m, { mini: m.mini_on, online: m.online }),
        h('div', { class: 'info' },
          h('div', { class: 'nm' }, m.name, m.user_id === S.me ? h('span', { class: 'me', text: '나' }) : null,
            m.mini_on ? chip('AI 대리', 'ai') : null),
          h('div', { class: 'sub', text: `${m.role || '역할 미정'} · ${status}` })),
        h('span', { class: `ready${r.ready ? ' full' : ''}`, title: '준비도: 안건 쟁점 중 근거가 있는 비율', text: `${r.covered}/${r.total}` })));
    }
  }
  function renderMyCard() {
    const sec = $('#myCardSec');
    const m = me();
    sec.hidden = S.observer || !m;
    if (!m) return;
    const r = m.readiness || { covered: 0, total: 0 };
    const pct = r.total ? Math.round(100 * r.covered / r.total) : 0;
    fill($('#myCard'), 
      h('div', { class: 'top' }, avatar(m, { size: 'lg' }),
        h('div', { class: 'grow' }, h('div', { class: 'nm', text: m.name }), h('div', { class: 'muted sm', text: m.role || '역할 미정' }))),
      h('div', { class: 'row', style: 'justify-content:space-between' }, h('span', { class: 'sm', text: `준비도 ${r.covered}/${r.total}` }),
        h('button', { class: 'link-btn', type: 'button', on: { click: () => openPrep(S.me) } }, '내 미니미 준비')),
      h('div', { class: `meter${r.ready ? ' ok' : ''}`, style: 'margin-bottom:10px' }, h('i', { style: `width:${pct}%` })),
      h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(!!m.mini_on), on: { click: () => toggleAway() } },
        h('span', {}, h('div', { class: 'lbl', text: '대리 참석' }),
          h('div', { class: 'desc', text: m.mini_on ? '미니미가 근거 있는 말만 대신해요' : '자리를 비울 때 미니미를 보내요' })),
        h('span', { class: 'toggle' })));
  }
  function renderMe() {
    const m = me();
    const b = $('#meBtn');
    fill(b, S.observer ? h('span', { class: 'av' }, icon('eye')) : avatar(m || { name: '?' }));
    b.title = S.observer ? '관전 모드' : (m ? `${m.name} (${m.role || ''})` : '');
  }

  function toggleAway(force) {
    const m = me();
    if (!m) return;
    const on = force != null ? force : !m.mini_on;
    if (on && !(m.readiness && m.readiness.ready)) {
      const r = m.readiness || { covered: 0, total: 0 };
      confirmModal({
        eyebrow: '대리 참석', title: `쟁점 ${r.total}개 중 ${r.covered}개만 답할 수 있어요`,
        body: h('div', { class: 'stack' },
          h('p', { style: 'margin:0', text: '근거가 없는 쟁점에서는 미니미가 말하지 않고, 돌아오면 확인할 질문으로 남겨요. 준비를 조금 더 하면 미니미가 더 많이 도울 수 있어요.' }),
          readinessList(m.readiness_items || [])),
        ok: '그래도 켜기', cancel: '준비 먼저 하기',
        onOk: () => send({ type: 'away', value: true }), onCancel: () => openPrep(S.me, { tab: 2 }),
      });
      return;
    }
    send({ type: 'away', value: on });
  }

  // ================================================================ 대화
  function renderFeed() {
    const feed = $('#feed');
    fill(feed);
    S.msgEls.clear();
    if (!S.messages.length) {
      feed.append(h('div', { class: 'feed-empty' },
        h('h3', { text: '회의를 시작해 보세요' }),
        h('p', { text: '첫 발언을 보내면 회의가 시작돼요. 못 온 팀원의 미니미는 근거가 있을 때만, 필요할 때만 말해요.' }),
        S.observer ? h('p', {}, h('button', { class: 'btn demo', type: 'button', on: { click: openDemoPanel } }, icon('play'), '시연 가이드 열기')) : null));
      return;
    }
    let prev = null;
    for (const m of S.messages) { feed.append(renderMessage(m, prev)); prev = m; }
    feed.scrollTop = feed.scrollHeight;
  }
  function addMessage(m) {
    if (S.msgEls.has(m.id)) return;
    const feed = $('#feed');
    const near = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 160;
    if (!S.messages.length) fill(feed);
    const prev = S.messages[S.messages.length - 1] || null;
    S.messages.push(m);
    feed.append(renderMessage(m, prev));
    if (m.kind === 'mini' || m.kind === 'human') delete S.typing[`${m.user_id}|${m.kind === 'mini'}`];
    renderTyping();
    if (near || m.user_id === S.me || ['verify', 'result', 'facilitator', 'decision'].includes(m.kind)) {
      requestAnimationFrame(() => { feed.scrollTop = feed.scrollHeight; });
    }
  }
  function renderMessage(m, prev) {
    let el;
    switch (m.kind) {
      case 'human': el = humanMsg(m, prev); break;
      case 'mini': el = miniMsg(m, prev); break;
      case 'facilitator': el = facilitatorCard(m); break;
      case 'decision': el = decisionCard(m); break;
      case 'verify': el = verifyCard(m); break;
      case 'result': el = resultCard(m); break;
      case 'tool': el = h('div', { class: 'card-msg' }, h('div', { class: 'card-head' }, icon('link'), h('span', { class: 'title', text: `검색: ${m.meta.query || ''}` })),
        h('div', { class: 'card-body', text: m.text })); break;
      default: el = h('div', { class: 'sys', text: m.text });
    }
    el.dataset.id = m.id;
    S.msgEls.set(m.id, el);
    return el;
  }
  function isCont(m, prev) {
    return prev && prev.kind === m.kind && prev.user_id === m.user_id && m.ts - prev.ts < 180 && !(m.meta && m.meta.abstain);
  }
  function humanMsg(m, prev) {
    const mem = S.byId[m.user_id];
    const mine = m.user_id === S.me;
    const meta = m.meta || {};
    const issue = S.room && S.room.issues.find(i => i.id === m.issue_id);
    const head = h('div', { class: 'head' }, h('span', { class: 'who', text: nameOf(m.user_id) }), h('span', { class: 'time', text: fmtTime(m.ts) }),
      meta.position ? chip(meta.position, 'accent') : null,
      meta.refined ? chip('미니미가 다듬음', 'ai', 'wand') : null,
      meta.decision_id ? chip('결정 기록됨', 'warn', 'flag') : null,
      meta.answer_to ? chip('질문에 답함', 'info') : null);
    const acts = (!S.observer && S.me && !(me() && me().mini_on)) ? h('div', { class: 'hover-actions' },
      h('button', { type: 'button', title: '내 미니미가 근거·모순·놓친 점을 검증해요', on: { click: () => { send({ type: 'verify', message_id: m.id }); toast('미니미에게 2차 검증을 맡겼어요.'); } } }, icon('shield'), '2차 검증'),
      !meta.decision_id ? h('button', { type: 'button', title: '이 발언을 결정으로 기록해요. 불참자 관련이면 자동 보류돼요.', on: { click: () => send({ type: 'mark_decision', message_id: m.id }) } }, icon('flag'), '결정으로 기록') : null) : null;
    return h('div', { class: `msg human${mine ? ' mine' : ''}${isCont(m, prev) ? ' cont' : ''}`, title: issue ? `쟁점: ${issue.title}` : '' },
      avatar(mem), h('div', { class: 'body' }, isCont(m, prev) ? null : head, h('div', { class: 'text', text: m.text })), acts);
  }
  function miniMsg(m, prev) {
    const mem = S.byId[m.user_id] || { name: nameOf(m.user_id), color: 0 };
    const meta = m.meta || {};
    const abst = meta.abstain;
    const head = h('div', { class: 'head' },
      h('span', { class: 'who', text: `${mem.name}의 미니미` }), chip('AI', 'ai', 'spark'),
      m.proxy ? chip('대리 참석', '') : null,
      abst ? chip(abst === 'commit' ? '약속 보류' : '확인 필요', 'warn', 'help') : (meta.act ? chip(ACT[meta.act] || meta.act, 'accent') : null),
      h('span', { class: 'time', text: fmtTime(m.ts) }));
    const bubble = h('div', { class: 'mini-bubble' });
    renderCited(bubble, m.text, meta.citations || []);
    const foot = h('div', { class: 'msg-foot' },
      h('span', {}, `엔진: ${engineLabel(meta.engine)}`),
      meta.dropped ? h('span', { title: '출처가 뒷받침하지 않는 문장을 생성 후 검사에서 지웠어요' }, `출처 없는 문장 ${meta.dropped}개 삭제`) : null,
      abst ? h('span', {}, '복귀 후 확인할 질문으로 저장됨') : null,
      meta.reply_to ? h('button', { type: 'button', on: { click: () => showGateFor(meta.reply_to) } }, '왜 지금 말했나요?') : null);
    return h('div', { class: `msg mini c${mem.color || 0}${abst ? ' abstain' : ''}${isCont(m, prev) ? ' cont' : ''}` },
      avatar(mem, { mini: true }), h('div', { class: 'body' }, head, bubble, foot));
  }
  function renderCited(el, text, citations) {
    const byLabel = Object.fromEntries((citations || []).map(c => [c.label, c]));
    const re = /\[([^\]\n]{1,30})\]/g;
    let last = 0; let mm;
    while ((mm = re.exec(text))) {
      if (mm.index > last) el.append(document.createTextNode(text.slice(last, mm.index)));
      const c = byLabel[mm[1]];
      if (c) {
        el.append(h('button', { class: 'cite', type: 'button', title: '출처 보기', on: { click: e => showPopover(e.currentTarget, c) } }, mm[1]));
      } else el.append(document.createTextNode(mm[0]));
      last = re.lastIndex;
    }
    if (last < text.length) el.append(document.createTextNode(text.slice(last)));
  }
  function showPopover(anchor, c) {
    const pop = $('#popover');
    const kind = { report: '보고서', stance: '입장 카드', interview: '인터뷰 답', profile: '약력', past: '지난 발언' }[c.kind] || c.kind || '';
    fill(pop, h('div', { class: 'lab' }, icon('doc'), c.label, kind ? chip(kind, 'info') : null), h('div', { text: c.text }));
    pop.hidden = false;
    const r = anchor.getBoundingClientRect();
    const w = Math.min(340, innerWidth - 24);
    pop.style.width = `${w}px`;
    pop.style.left = `${clip(r.left, 12, innerWidth - w - 12)}px`;
    const below = r.bottom + 8;
    pop.style.top = `${below}px`;
    requestAnimationFrame(() => {
      const ph = pop.offsetHeight;
      if (below + ph > innerHeight - 12) pop.style.top = `${Math.max(12, r.top - ph - 8)}px`;
    });
  }
  function facilitatorCard(m) {
    const rem = (m.meta && m.meta.remaining) || [];
    return h('div', { class: 'card-msg facilitator' },
      h('div', { class: 'card-head' }, icon('target'), h('span', { class: 'title', text: '회의 도우미' }), chip('안건 이탈 감지', 'info'),
        h('span', { class: 'muted sm', text: m.meta && m.meta.source && m.meta.source !== 'rule' ? `확인: ${engineLabel(m.meta.source)}` : '규칙 판단' })),
      h('div', { class: 'card-body' }, h('div', { text: m.text }),
        rem.length ? h('div', { class: 'row' }, rem.map(r => chip(r.title, 'info'))) : null));
  }

  // ---- 결정 카드
  function decisionData(m) {
    const id = m.meta && m.meta.decision && m.meta.decision.id;
    return ((S.room && S.room.decisions) || []).find(d => d.id === id) || (m.meta && m.meta.decision) || {};
  }
  function decisionCard(m) {
    const el = h('div', { class: 'card-msg decision-card' });
    el.dataset.decisionId = (m.meta && m.meta.decision && m.meta.decision.id) || '';
    fillDecision(el, decisionData(m));
    return el;
  }
  function fillDecision(el, d) {
    const [label, cls] = DSTATUS[d.status] || ['', ''];
    el.className = `card-msg decision-card ${d.status || ''}`;
    const resp = Object.entries(d.responses || {});
    const mine = S.me && (d.affected || []).includes(S.me) && !(d.responses || {})[S.me];
    fill(el, 
      h('div', { class: 'card-head' }, icon('flag'), h('span', { class: 'title', text: '결정 기록' }), chip(label, cls),
        d.issue_title ? h('span', { class: 'muted sm', text: d.issue_title }) : null),
      h('div', { class: 'card-body' },
        h('div', { class: 'decision-text', text: d.text }),
        h('div', { class: 'muted sm', text: `${d.by_name || ''} 님 발언에서` + (d.status === 'pending' ? ' · 불참자 입장에 영향을 주는 결정이라 자동 보류됐어요' : '') }),
        (d.affected || []).length ? h('div', { class: 'resp' }, (d.affected || []).map(u => {
          const r = (d.responses || {})[u];
          return chip(`${nameOf(u)} ${r ? (r.action === 'approve' ? '승인' : '이의') : '확인 대기'}`, r ? (r.action === 'approve' ? 'ok' : 'bad') : 'warn');
        })) : null,
        resp.filter(([, r]) => r.note).map(([u, r]) => h('div', { class: 'box info' }, icon('msg'), h('span', {}, h('b', { text: `${nameOf(u)}: ` }), r.note))),
        mine ? decideForm(d) : null));
  }
  function decideForm(d, after) {
    const note = h('input', { placeholder: '이의가 있으면 이유를 적어 주세요 (선택)', maxlength: 300 });
    const go = action => {
      if (action === 'object' && !note.value.trim()) { note.focus(); toast('이의를 다는 이유를 한 줄 적어 주세요.'); return; }
      send({ type: 'decide', decision_id: d.id, action, note: note.value });
      if (after) after();
    };
    return h('div', { class: 'decide-form' }, note,
      h('button', { class: 'btn ok xs', type: 'button', on: { click: () => go('approve') } }, icon('check'), '승인'),
      h('button', { class: 'btn danger xs', type: 'button', on: { click: () => go('object') } }, '이의'));
  }
  function updateDecision(d) {
    if (!S.room) return;
    const i = S.room.decisions.findIndex(x => x.id === d.id);
    if (i >= 0) S.room.decisions[i] = d; else S.room.decisions.push(d);
    renderDecisions(); refreshDecisionCards();
    if (S.digest) renderDigest();
  }
  function refreshDecisionCards() {
    if (!S.room) return;
    $$('.decision-card[data-decision-id]').forEach(el => {
      const d = S.room.decisions.find(x => x.id === el.dataset.decisionId);
      if (d) fillDecision(el, d);
    });
  }

  // ---- 2차 검증 카드
  function verifyCard(m) {
    const v = m.meta || {};
    const req = S.byId[v.requester] || { name: '?' };
    const sp = S.byId[v.speaker] || { name: '?' };
    const labelCls = { '근거 있음': 'ok', '근거 약함': 'warn', '이전 발언과 충돌': 'bad', '놓친 점': 'info', '반대 관점': '' };
    return h('div', { class: 'card-msg verify-card' },
      h('div', { class: 'card-head' }, icon('shield'),
        h('span', { class: 'title', text: `${req.name}의 미니미 · 2차 검증${v.requester !== v.speaker ? ` (${sp.name} 님 발언)` : ''}` }),
        (v.labels || []).map(l => chip(l, labelCls[l] || ''))),
      h('div', { class: 'card-body' },
        h('div', { class: 'box devil' }, icon('msg'), h('span', {}, h('b', { text: `${sp.name}: ` }), v.target_text || '')),
        (v.claims || []).map((c, i) => claimBox(c, i)),
        (v.missed || []).length ? h('div', { class: 'box warn' }, icon('alert'), h('div', {}, h('b', { text: '놓친 점' }),
          h('ul', { style: 'margin:4px 0 0;padding-left:18px' }, v.missed.map(x => h('li', { text: x }))))) : null,
        v.devil ? h('div', { class: 'box devil' }, icon('users'), h('div', {}, h('b', { text: '반대 관점 (악마의 변호인) ' }),
          h('div', { text: v.devil.text }), v.devil.cite ? h('div', { class: 'muted sm', text: `출처: ${v.devil.cite}` }) : null)) : null,
        h('div', { class: 'muted sm', text: `고칠지 말지는 사람이 정해요 · 엔진: ${engineLabel(v.engine)}${v.ms != null ? ` · ${v.ms}ms` : ''}` })));
  }
  function claimBox(c, i) {
    const [vl, vc] = VERDICT[c.verdict] || ['판정 없음', ''];
    const ev = (c.conflicts || []).map(x => ({ ...x, conflict: true })).concat(c.evidence || []);
    return h('div', { class: 'claim' },
      h('div', { class: 'claim-top' }, h('span', { class: 'q', text: `주장 ${i + 1}. ${c.claim}` }), chip(vl, `verdict ${vc}`)),
      h('dl', { class: 'toulmin' },
        h('dt', { text: '근거' }), h('dd', { class: c.grounds ? '' : 'empty', text: c.grounds || '발언에 제시된 근거 없음' }),
        c.warrant ? [h('dt', { text: '전제' }), h('dd', { text: c.warrant })] : null,
        c.qualifier ? [h('dt', { text: '단정 표현' }), h('dd', { text: c.qualifier })] : null,
        (c.questions || []).length ? [h('dt', { text: '검증 질문' }), h('dd', { text: c.questions.join(' / ') })] : null),
      c.note ? h('div', { class: 'note', text: c.note }) : null,
      ev.length ? h('details', {}, h('summary', { class: 'sm' }, `찾은 근거 ${ev.length}개 보기`),
        h('div', { class: 'ev-list' }, ev.map(e => h('div', { class: `ev${e.conflict ? ' conflict' : ''}` },
          h('span', { class: 'lab', text: e.label }),
          h('span', { class: 'grow', text: e.text }),
          e.source ? chip({ own: '내 자료', team: '팀원 자료', past: '이전 발언' }[e.source] || e.source, e.conflict ? 'bad' : '') : null)))) : null);
  }

  // ---- 회의록 카드
  function resultCard(m) {
    const x = m.meta || {};
    const st = x.stats || {};
    return h('div', { class: 'card-msg result-card' },
      h('div', { class: 'card-head' }, icon('doc'), h('span', { class: 'title', text: '회의록' }),
        h('a', { class: 'btn xs', href: `/api/rooms/${encodeURIComponent(S.roomId)}/minutes.md`, download: '' }, icon('download'), '내보내기 .md')),
      h('div', { class: 'card-body' },
        h('div', { text: x.summary || m.text }),
        h('div', { class: 'stats' }, h('span', {}, '발언 ', h('b', { text: st.messages || 0 })), h('span', {}, '미니미 ', h('b', { text: st.mini || 0 })),
          h('span', {}, '결정 ', h('b', { text: st.decisions || 0 })), h('span', {}, '시간 ', h('b', { text: `${st.minutes || 0}분` })),
          h('span', {}, `엔진 ${engineLabel(x.engine)}`)),
        (x.issues || []).map((it, i) => {
          const s = it.decision ? (DSTATUS[it.decision.status] || ['', '']) : (it.status === 'untouched' ? ['미논의', ''] : ['논의 중', 'info']);
          return h('div', { class: 'minutes-issue' },
            h('div', { class: 'h' }, h('span', { text: `${i + 1}. ${it.title}` }), chip(s[0], s[1])),
            (it.opinions || []).length ? h('ul', {}, it.opinions.map(o => h('li', {}, h('b', { text: `${o.who}` }), o.position ? ` (${o.position})` : '', `: ${o.text}`))) : h('div', { class: 'muted sm', text: '나온 의견이 없어요' }),
            (it.conflicts || []).map(c => h('div', { class: 'sm', style: 'color:var(--bad)', text: `충돌 · ${c}` })),
            it.decision ? h('div', { class: 'sm' }, h('b', { text: '결정: ' }), it.decision.text,
              it.decision.affected_names && it.decision.affected_names.length && it.decision.status === 'pending' ? ` — ${it.decision.affected_names.join(', ')} 님 확인 대기` : '') : null);
        }),
        (x.questions || []).length ? h('div', { class: 'box warn' }, icon('help'), h('div', {}, h('b', { text: '복귀 후 확인할 질문' }),
          h('ul', { style: 'margin:4px 0 0;padding-left:18px' }, x.questions.map(q => h('li', { text: `${q.who}: ${q.text} (${q.reason})` }))))) : null,
        (x.next_steps || []).length ? h('div', { class: 'box info' }, icon('check'), h('div', {}, h('b', { text: '다음 할 일' }),
          h('ul', { style: 'margin:4px 0 0;padding-left:18px' }, x.next_steps.map(s => h('li', { text: s }))))) : null));
  }

  // ---- 입력 중
  function onTyping(d) {
    const key = `${d.user_id}|${!!d.mini}`;
    if (d.user_id === S.me && !d.mini) return;
    if (d.on) S.typing[key] = { label: d.label || '', until: Date.now() + (d.mini ? 30000 : 5000) };
    else delete S.typing[key];
    renderTyping();
  }
  function renderTyping() {
    const now = Date.now();
    const parts = [];
    for (const [key, v] of Object.entries(S.typing)) {
      if (v.until < now) { delete S.typing[key]; continue; }
      const [uid, mini] = key.split('|');
      parts.push(mini === 'true' ? `${nameOf(uid)}의 미니미가 ${v.label || '생각 중'}` : `${nameOf(uid)} 님이 입력 중`);
    }
    const el = $('#typing');
    fill(el, ...(parts.length ? [h('span', { class: 'dots' }, h('i'), h('i'), h('i')), parts.join(' · ')] : []));
  }
  setInterval(renderTyping, 1500);

  // ================================================================ 입력창
  function renderComposerState() {
    const m = me();
    const away = !!(m && m.mini_on);
    $('#composerWrap').hidden = S.observer || away;
    $('#observerBar').hidden = !S.observer;
    $('#awayBar').hidden = !away || S.observer;
    if (away) {
      fill($('#awayBar'), icon('bot'), h('span', { class: 't' }, h('b', { text: '지금 미니미가 대신 참석 중이에요. ' }),
        '내 입장 카드와 보고서에 있는 말만 하고, 근거가 없으면 질문으로 남겨요.'),
      h('button', { class: 'btn primary sm', type: 'button', on: { click: () => toggleAway(false) } }, '돌아왔어요'));
    }
    $$('[data-act="prep"],[data-act="digest"],[data-act="agenda"]').forEach(b => { b.hidden = S.observer; });
    $('#endBtn').hidden = S.observer;
    $('#modeSeg').style.pointerEvents = S.observer ? 'none' : '';
  }
  function autosize() { const t = $('#input'); t.style.height = 'auto'; t.style.height = `${Math.min(160, t.scrollHeight)}px`; }
  function sendTyping(on) {
    const now = Date.now();
    if (on && now - S.typingSent < 2500) return;
    S.typingSent = on ? now : 0;
    send({ type: 'typing', on }, true);
  }
  function submitComposer(e) {
    if (e) e.preventDefault();
    const t = $('#input');
    const text = t.value.trim();
    if (!text) return;
    if (S.cmode === 'refine') {
      if (send({ type: 'refine', text })) {
        const card = $('#refineCard');
        card.hidden = false;
        fill(card, h('div', { class: 'row' }, icon('wand'), h('b', { text: '미니미가 다듬는 중…' })));
      }
      return;
    }
    if (send({ type: 'message', text })) {
      t.value = ''; autosize(); sendTyping(false); closeMention();
    }
  }
  function showRefine(d) {
    const card = $('#refineCard');
    card.hidden = false;
    const ta = h('textarea', { rows: 2, value: d.text });
    fill(card, 
      h('div', { class: 'row' }, icon('wand'), h('b', { text: '미니미가 다듬었어요. 올리기 전에 확인해 주세요.' }), h('span', { class: 'grow' }), chip(engineLabel(d.engine), 'ai')),
      ta,
      h('div', { class: 'row' },
        h('button', { class: 'btn primary sm', type: 'button', on: { click: () => { if (send({ type: 'message', text: ta.value.trim() || d.text, refined_from: d.original })) { card.hidden = true; $('#input').value = ''; autosize(); } } } }, icon('check'), '이대로 보내기'),
        h('button', { class: 'btn sm', type: 'button', on: { click: () => { if (send({ type: 'message', text: d.original })) { card.hidden = true; $('#input').value = ''; autosize(); } } } }, '원래 문장으로 보내기'),
        h('button', { class: 'btn ghost sm', type: 'button', on: { click: () => { card.hidden = true; } } }, '취소')));
  }
  // @호출
  function onInputMention() {
    const t = $('#input');
    const upto = t.value.slice(0, t.selectionStart);
    const m = upto.match(/@([^\s@]{0,8})$/);
    if (!m) return closeMention();
    const q = m[1];
    const list = S.members.filter(x => x.user_id !== S.me && x.name.startsWith(q))
      .sort((a, b) => (b.mini_on - a.mini_on));
    if (!list.length) return closeMention();
    S.mention = { start: upto.length - m[0].length, list, sel: 0 };
    renderMention();
  }
  function renderMention() {
    const pop = $('#mentionPop');
    pop.hidden = false;
    fill(pop, ...S.mention.list.map((x, i) => h('button', { type: 'button', class: i === S.mention.sel ? 'sel' : '', on: { mousedown: e => { e.preventDefault(); pickMention(i); } } },
      avatar(x, { size: 'sm', mini: x.mini_on }), h('span', { class: 'grow' }, x.name, x.mini_on ? ' 미니미' : ''),
      h('span', { class: 'muted sm', text: x.mini_on ? '대리 참석 중' : (x.online ? '접속 중' : '오프라인') }))));
  }
  function pickMention(i) {
    const t = $('#input');
    const x = S.mention.list[i];
    const before = t.value.slice(0, S.mention.start);
    const after = t.value.slice(t.selectionStart);
    t.value = `${before}@${x.name} ${after}`;
    const pos = before.length + x.name.length + 2;
    t.setSelectionRange(pos, pos);
    closeMention(); t.focus();
  }
  function closeMention() { S.mention = null; $('#mentionPop').hidden = true; }

  // ================================================================ 미니미의 머릿속
  function renderDash() { renderGate(); renderEvidence(); renderDrift(); renderEngine(); }
  function setTab(tab, flash = false) {
    S.dash = tab;
    $$('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    ['gate', 'evidence', 'drift', 'engine'].forEach(t => { $(`#tab-${t}`).hidden = t !== tab; });
    if (flash) { const el = $(`#tab-${tab}`); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  }
  function curGate() { return S.selGate || S.gate; }
  function showGateFor(msgId) {
    const g = S.gateByMsg.get(msgId);
    if (!g) { toast('이 판단 기록은 접속하기 전 것이라 볼 수 없어요.'); return; }
    S.selGate = g;
    renderGate(); renderEvidence();
    openRight(); setTab('gate', true);
  }
  function factor(label, val, cls = '', marks = []) {
    return h('div', { class: 'factor' }, h('span', { class: 'lbl', text: label }),
      h('div', { class: `bar ${cls}` }, h('i', { style: `width:${Math.round(clip(val) * 100)}%` }),
        marks.map(([x, c]) => h('span', { class: `mark ${c || ''}`, style: `left:${Math.round(clip(x) * 100)}%` }))),
      h('span', { class: 'val', text: val.toFixed(2) }));
  }
  function renderGate() {
    const box = $('#tab-gate');
    const g = curGate();
    if (!g) {
      fill(box, h('div', { class: 'gate-msg' }, h('b', { text: '개입 게이트' }),
        h('p', { style: 'margin:6px 0 0', text: '사람이 발언할 때마다 대리 참석 중인 미니미가 지금 말할지 계산해요. 규칙과 점수로 먼저 정하고, 애매할 때만 작은 모델에게 물어요.' })),
      legend());
      return;
    }
    const trig = S.messages.find(x => x.id === g.msg_id);
    const acts = g.actions || [];
    let verdict;
    if (!acts.length) verdict = h('div', { class: 'verdict-box silent' }, icon('x'), h('div', {}, h('b', { text: '아무도 말하지 않아요' }), h('div', { class: 'sm', text: g.reason })));
    else verdict = h('div', { class: 'stack', style: 'gap:6px' }, acts.map(a => {
      const nm = nameOf(a.uid);
      return a.type === 'abstain'
        ? h('div', { class: 'verdict-box abstain' }, icon('help'), h('div', {}, h('b', { text: `${nm}의 미니미: ${a.reason === 'commit' ? '약속 요청이라 보류' : '근거가 없어 기권'}` }), h('div', { class: 'sm', text: g.reason })))
        : h('div', { class: 'verdict-box speak' }, icon('spark'), h('div', {}, h('b', { text: `${nm}의 미니미가 ${ACT[a.act] || '발언'}` }), h('div', { class: 'sm', text: g.reason })));
    }));
    const th = g.thresholds || {};
    const chosen = new Set(acts.map(a => a.uid));
    fill(box, 
      h('div', { class: 'gate-msg' }, h('span', { class: 'who', text: trig ? `${nameOf(trig.user_id)}: ` : '방금 발언: ' }), trig ? trig.text : '',
        h('div', { class: 'row', style: 'margin-top:6px' },
          chip(g.source === 'rule' ? '규칙으로 판단' : `모델 판정 · ${engineLabel(g.source)}`, g.source === 'rule' ? '' : 'ai'),
          chip({ high: '확실히 높음', low: '확실히 낮음', mid: '애매한 구간', called: '이름 호출', none: '후보 없음' }[g.zone] || g.zone, 'info'),
          g.msg_position ? chip(`발언 입장: ${g.msg_position}`, 'accent') : null,
          S.selGate ? h('button', { class: 'link-btn', type: 'button', on: { click: () => { S.selGate = null; renderGate(); renderEvidence(); } } }, '최신 판단 보기') : null)),
      verdict,
      (g.candidates || []).length ? h('div', { class: 'section-title', text: '후보별 효용 점수' }) : null,
      (g.candidates || []).map(c => {
        const mem = S.byId[c.uid] || { name: c.name, color: 0 };
        return h('div', { class: `cand${chosen.has(c.uid) ? ' chosen' : ''}` },
          h('div', { class: 'cand-head' }, avatar(mem, { size: 'sm', mini: true }), h('span', { class: 'nm', text: `${mem.name}의 미니미` }),
            c.called ? chip('호출됨', 'accent') : null, c.excluded ? chip(c.excluded, '') : null, c.position ? chip(c.position, '') : null),
          factor('관련도', c.rel), factor('근거', c.ev, '', [[th.evidence_min, 'low']]), factor('새로움', c.nov), factor('입장 차이', c.diff),
          factor('끼어들기', c.cost, 'cost'),
          factor('효용 U', Math.max(0, c.utility), 'util', [[th.low, 'low'], [th.high, '']]));
      }),
      legend(th));
  }
  function legend(th = {}) {
    return h('div', { class: 'guide sm' }, h('b', { text: '효용 U = 관련도 × 근거 × 새로움 × 입장 차이 − 끼어들기 비용' }),
      h('div', { text: `U ≥ ${th.high ?? 0.42}이면 말하고, ≤ ${th.low ?? 0.22}이면 침묵, 사이면 작은 모델이 판정해요. 근거가 ${th.evidence_min ?? 0.3} 아래면 말하지 않아요.` }));
  }
  function renderEvidence() {
    const box = $('#tab-evidence');
    const g = curGate();
    const cands = (g && g.candidates) || [];
    const act = g && (g.actions || [])[0];
    const c = cands.find(x => act && x.uid === act.uid) || cands[0];
    const thr = (g && g.thresholds && g.thresholds.evidence_min) || 0.3;
    if (!c) {
      fill(box, h('div', { class: 'gate-msg', text: '미니미가 판단할 때 찾은 근거 문단이 여기에 보여요. 형태소 BM25와 벡터 검색을 RRF로 합치고, 근거 점수가 임계값 아래면 말하지 않아요.' }));
      return;
    }
    const mem = S.byId[c.uid] || { name: c.name };
    const ev = c.evidence || [];
    fill(box, 
      h('div', { class: 'gate-msg' }, h('b', { text: `${mem.name}의 미니미가 찾은 근거` }),
        h('div', { class: 'sm muted', text: `최고 근거 점수 ${c.ev.toFixed(2)} · 임계값 ${thr} ${c.ev < thr ? '→ 근거 부족 (침묵·확인 질문)' : '→ 말할 수 있음'}` })),
      ev.length ? ev.map(e => h('div', { class: 'passage' },
        h('div', { class: 'lab' }, icon('doc'), e.label, chip({ report: '보고서', stance: '입장 카드', interview: '인터뷰', profile: '약력' }[e.kind] || e.kind, 'info')),
        highlight(e.text, e.matched || []),
        factor('근거 점수', e.strength, '', [[thr, 'low']]),
        h('div', { class: 'muted sm', text: `BM25 ${e.bm25.toFixed(2)} · 벡터 ${e.cos.toFixed(2)} · 핵심어 ${Math.round(e.coverage * 100)}% 일치` })))
        : h('div', { class: 'empty', text: '관련 문단을 찾지 못했어요.' }),
      h('div', { class: 'guide sm', text: '근거 점수 = 0.55 × 질문 핵심어를 덮는 비율(IDF 가중) + 0.45 × 벡터 유사도. 입장을 말할 때는 확인된 입장 카드가, 사실을 물을 때는 그 내용을 덮는 문단이 근거예요.' }));
  }
  function highlight(text, words) {
    const el = h('div', {});
    const ws = words.filter(w => w && w.length > 1 && text.toLowerCase().includes(w)).sort((a, b) => b.length - a.length);
    if (!ws.length) { el.textContent = text; return el; }
    const re = new RegExp(`(${ws.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
    let last = 0; let m;
    while ((m = re.exec(text))) {
      if (m.index > last) el.append(text.slice(last, m.index));
      el.append(h('mark', { text: m[0] }));
      last = re.lastIndex;
    }
    el.append(text.slice(last));
    return el;
  }
  function renderDrift() {
    const box = $('#tab-drift');
    const pts = S.drift.filter(p => p.distance != null).slice(-40);
    const thr = (S.drift.length && S.drift[S.drift.length - 1].threshold) || 0.8;
    const W = 340; const H = 200; const P = { l: 28, r: 10, t: 12, b: 22 };
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'chart');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', '발언별 안건 거리 그래프');
    const X = i => P.l + (pts.length <= 1 ? (W - P.l - P.r) / 2 : i * (W - P.l - P.r) / (pts.length - 1));
    const Y = v => P.t + (1 - v) * (H - P.t - P.b);
    const add = (tag, attrs, text) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; svg.append(e); return e; };
    for (const v of [0, 0.5, 1]) { add('line', { x1: P.l, x2: W - P.r, y1: Y(v), y2: Y(v), stroke: 'var(--line)' }); add('text', { x: 4, y: Y(v) + 3 }, v.toFixed(1)); }
    add('rect', { x: P.l, y: Y(1), width: W - P.l - P.r, height: Y(thr) - Y(1), fill: 'var(--bad-soft)', opacity: 0.7 });
    add('line', { x1: P.l, x2: W - P.r, y1: Y(thr), y2: Y(thr), stroke: 'var(--bad)', 'stroke-dasharray': '4 3' });
    add('text', { x: W - P.r - 64, y: Y(thr) - 4 }, `이탈 기준 ${thr}`);
    if (pts.length) {
      add('polyline', { points: pts.map((p, i) => `${X(i)},${Y(p.distance)}`).join(' '), fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2, 'stroke-linejoin': 'round' });
      pts.forEach((p, i) => {
        const c = add('circle', { cx: X(i), cy: Y(p.distance), r: p.reminded ? 5.5 : 3.5, fill: p.distance >= thr ? 'var(--bad)' : 'var(--accent)', stroke: 'var(--surface)', 'stroke-width': 1.5 });
        const msg = S.messages.find(m => m.id === p.msg_id);
        c.append(document.createElementNS(SVGNS, 'title'));
        c.lastChild.textContent = `${p.who || ''}: ${msg ? msg.text.slice(0, 40) : ''} — 거리 ${p.distance}`;
      });
    } else add('text', { x: W / 2 - 60, y: H / 2 }, '발언이 오면 그려져요');
    add('text', { x: P.l, y: H - 6 }, '발언 순서 →');
    const recent = pts.slice(-5).reverse();
    fill(box, 
      h('div', { class: 'gate-msg' }, h('b', { text: '안건 거리' }), h('div', { class: 'sm', text: '발언이 안건·쟁점 어휘에서 얼마나 멀어졌는지(0~1). LLM 없이 계산해서 0초에 가까워요. 기준선 위가 연속 2번이면 회의 도우미가 남은 쟁점을 상기시켜요.' })),
      svg,
      recent.length ? h('div', { class: 'stack', style: 'gap:6px' }, recent.map(p => {
        const msg = S.messages.find(m => m.id === p.msg_id);
        return h('div', { class: 'factor', style: 'grid-template-columns:62px 1fr 38px' }, h('span', { class: 'lbl', text: p.who || '' }),
          h('span', { class: 'sm', style: 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis', text: msg ? msg.text : '' }),
          h('span', { class: 'val', style: p.distance >= thr ? 'color:var(--bad)' : '', text: p.distance.toFixed(2) }));
      })) : null);
  }
  function renderEnginePill() {
    const st = S.status;
    const pill = $('#enginePill');
    if (!st) return;
    let cls = 'rule'; let text = '규칙 대체';
    if (st.force_rule) text = '규칙 대체 (모델 끔)';
    else if (st.slow.startsWith('ollama')) { cls = 'local'; text = `로컬 · ${st.slow.split(':').slice(1).join(':')}`; }
    else if (st.slow.startsWith('api')) { cls = 'api'; text = `API · ${st.slow.split(':').slice(1).join(':')}`; }
    pill.className = `engine-pill ${cls}`;
    $('#engineText').textContent = text;
    pill.title = `빠른 레인: ${engineLabel(st.fast)} · 생각 레인: ${engineLabel(st.slow)} · 임베딩: ${st.embed}`;
  }
  function renderEngine() {
    const box = $('#tab-engine');
    const st = S.status;
    if (!st) { fill(box, h('div', { class: 'empty', text: '엔진 상태를 불러오는 중…' })); return; }
    const sw = h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(!!st.force_rule),
      on: { click: async () => { try { S.status = await api('POST', '/api/engine', { force_rule: !st.force_rule }); renderEnginePill(); renderEngine(); toast(S.status.force_rule ? '모델을 껐어요. 모든 단계가 규칙으로 대체돼요.' : '모델을 다시 켰어요.'); } catch (e) { toast(e.message, 'bad'); } } } },
    h('span', {}, h('div', { class: 'lbl', text: '모델 끄기 (규칙 대체)' }), h('div', { class: 'desc', text: '시연용: 모델이 죽어도 회의가 계속되는 것을 보여 줘요' })), h('span', { class: 'toggle' }));
    const lanes = [['빠른 레인 · 개입 판단', st.fast, 'fast'], ['생각 레인 · 발언·검증·회의록', st.slow, 'slow']];
    fill(box, 
      sw,
      lanes.map(([name, label, lane]) => {
        const eng = (st.engines || []).find(e => label.startsWith(e.name));
        const l = eng && eng.lanes[lane];
        return h('div', { class: 'lane' }, h('div', { class: 'lane-head' }, h('span', { text: name }), chip(engineLabel(label), label === 'rule' ? 'warn' : 'ok')),
          l ? h('dl', { class: 'kv' }, h('dt', { text: '지연 p50/p95' }), h('dd', { text: `${l.p50 ?? '-'}s / ${l.p95 ?? '-'}s` }),
            h('dt', { text: '성공/실패' }), h('dd', { text: `${l.ok} / ${l.fail}` })) : h('div', { class: 'muted sm', text: '규칙: 모델 없이 점수·검색·추출식 문장으로 동작' }));
      }),
      h('div', { class: 'lane' }, h('div', { class: 'lane-head' }, h('span', { text: '검색 임베딩' }), chip(st.embed, st.embed.startsWith('n-gram') ? '' : 'ok')),
        h('div', { class: 'muted sm', text: '형태소(Kiwi) BM25 + 벡터 검색을 RRF로 합쳐요. 임베딩은 항상 로컬.' })),
      h('div', { class: 'section-title', text: `엔진 순서: ${(st.order || []).join(' → ')} → 규칙` }),
      (st.engines || []).map(e => h('div', { class: 'lane' },
        h('div', { class: 'lane-head' }, h('span', { text: e.name === 'ollama' ? '로컬 Ollama' : 'OpenAI 호환 API' }),
          chip(!e.configured ? '설정 안 됨' : e.reachable === false ? '연결 안 됨' : e.reachable ? '연결됨' : '확인 전', e.reachable ? 'ok' : (e.configured ? 'warn' : ''))),
        e.reason ? h('div', { class: 'muted sm', text: e.reason }) : null,
        Object.entries(e.lanes).filter(([, l]) => l.breaker_open || l.last_error).map(([lane, l]) => h('div', { class: 'sm', style: 'color:var(--bad)', text: `${lane}: ${l.breaker_open ? '서킷 브레이커 열림 · ' : ''}${l.last_error}` })))),
      h('div', { class: 'section-title', text: '호출 추적 (최근)' }),
      (st.trace || []).length ? h('div', { class: 'trace' }, st.trace.slice().reverse().map(t => h('div', {},
        h('span', { class: t.ok ? 'ok' : 'bad', text: t.ok ? '✓' : '✗' }), h('span', { text: fmtTime(t.ts) }), h('span', { text: t.task }),
        h('span', { text: `${t.engine}:${t.model}` }), h('span', { text: `${t.ms}ms` }), t.ok ? h('span', { text: `${t.tin || 0}→${t.tout || 0}tok` }) : h('span', { text: t.error || '' }))))
        : h('div', { class: 'empty', text: '아직 모델 호출이 없어요 (규칙 대체 중이면 비어 있어요).' }));
  }

  // ================================================================ 모달·시트
  function openModal({ eyebrow = '', title = '', body, wide = false }) {
    $('#modalEyebrow').textContent = eyebrow;
    $('#modalTitle').textContent = title;
    $('.modal-card').classList.toggle('wide', wide);
    const b = $('#modalBody');
    fill(b, ...(Array.isArray(body) ? body : [body]));
    $('#modal').hidden = false;
    dockDemo();
  }
  function closeModal() { $('#modal').hidden = true; S.digest = null; dockDemo(); }
  function dockDemo() {
    // 오른쪽에 시트·모달이 열리면 시연 가이드는 왼쪽으로 비켜서, 발표자가 언제든 다음 장면을 누를 수 있게 한다
    const left = !$('#sheet').hidden || !$('#modal').hidden;
    $('#demoPanel').classList.toggle('dock-left', left);
    document.body.classList.toggle('demo-left', left && !$('#demoPanel').hidden);
  }
  function confirmModal({ eyebrow, title, body, ok = '확인', cancel = '취소', onOk, onCancel, danger = false }) {
    openModal({ eyebrow, title, body: [typeof body === 'string' ? h('p', { style: 'margin:0', text: body }) : body,
      h('div', { class: 'row', style: 'justify-content:flex-end' },
        h('button', { class: 'btn', type: 'button', on: { click: () => { closeModal(); if (onCancel) onCancel(); } } }, cancel),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'button', on: { click: () => { closeModal(); if (onOk) onOk(); } } }, ok))] });
  }
  function openSheet(eyebrow, title) {
    $('#sheetEyebrow').textContent = eyebrow;
    $('#sheetTitle').textContent = title;
    $('#sheet').hidden = false;
    dockDemo();
  }
  function closeSheet() { $('#sheet').hidden = true; S.prep = null; dockDemo(); }

  // ---- 초대
  async function openInvite() {
    try {
      const d = await api('GET', `/api/rooms/${encodeURIComponent(S.roomId)}/invite`);
      const qr = h('div', { class: 'qr' });
      if (d.qr_svg) qr.innerHTML = d.qr_svg;          // 서버가 만든 QR SVG (사용자 입력 아님)
      else qr.append(h('div', { class: 'muted', text: 'QR을 만들 수 없어요 (qrcode 패키지 필요). 아래 주소를 공유하세요.' }));
      const inp = h('input', { value: d.url, readonly: true });
      openModal({
        eyebrow: '팀원 초대', title: '같은 와이파이에서 스캔해 들어오세요', body: [qr,
          h('div', { class: 'copy-row' }, inp, h('button', { class: 'btn', type: 'button', on: { click: async () => { try { await navigator.clipboard.writeText(d.url); toast('주소를 복사했어요.'); } catch { inp.select(); toast('주소를 선택했어요. 복사해 주세요.'); } } } }, '복사')),
          h('p', { class: 'muted sm', style: 'margin:0', text: '접속하면 자기 자리를 고르면 돼요. 서버를 띄운 노트북과 같은 네트워크여야 해요. 외부에서 접속하려면 .env의 PUBLIC_URL을 설정하세요.' })],
      });
    } catch (e) { toast(e.message, 'bad'); }
  }

  // ---- 안건 편집
  function openAgenda() {
    const r = S.room || { agenda: '', issues: [] };
    const title = h('input', { value: r.agenda, maxlength: 120, placeholder: '오늘 안건' });
    const ta = h('textarea', { rows: 5, value: r.issues.map(i => i.options.length ? `${i.title}: ${i.options.map(o => o.label).join(', ')}` : i.title).join('\n'), placeholder: '쟁점: 선택지1, 선택지2' });
    openModal({
      eyebrow: '안건', title: '안건과 쟁점 편집', body: [
        h('label', { class: 'field' }, h('span', { text: '오늘 안건' }), title),
        h('label', { class: 'field' }, h('span', {}, '쟁점 ', h('small', { text: "한 줄에 하나. 선택지가 있으면 '쟁점: A안, B안'" })), ta),
        h('div', { class: 'guide sm', text: '쟁점과 선택지를 적어 두면 미니미가 누가 어느 쪽인지 알아보고, 준비도와 안건 이탈을 계산해요. 바꾸면 모든 팀원의 준비도가 다시 계산돼요.' }),
        h('div', { class: 'row', style: 'justify-content:flex-end' }, h('button', { class: 'btn', type: 'button', on: { click: closeModal } }, '취소'),
          h('button', { class: 'btn primary', type: 'button', on: { click: () => { if (send({ type: 'agenda', title: title.value, issues: parseIssues(ta.value, r.issues) })) closeModal(); } } }, '저장'))],
    });
  }
  function parseIssues(text, old = []) {
    return text.split('\n').map(s => s.trim()).filter(Boolean).map((line, i) => {
      const [t, opts] = line.split(/[:：]/);
      const prev = old.find(o => o.title === t.trim());
      return { id: prev ? prev.id : `i${i + 1}`, title: t.trim(), options: opts ? opts.split(/[,，/]/).map(s => s.trim()).filter(Boolean) : [] };
    });
  }

  // ================================================================ 내 미니미 준비
  const PREP_TABS = ['프로필', '보고서', '입장 인터뷰', '입장 카드', '준비도·대리 참석'];
  async function openPrep(uid, { tab = null, preview = null } = {}) {
    const isPreview = preview != null ? preview : uid !== S.me;
    S.prep = { uid, tab: tab ?? (S.prep && S.prep.uid === uid ? S.prep.tab : 0), data: null, preview: isPreview };
    const m = S.byId[uid];
    openSheet(isPreview ? '화면 미리보기' : '내 미니미 준비', isPreview ? `${m ? m.name : ''} 님의 미니미 준비` : '내 미니미 만들기');
    fill($('#sheetBody'), h('div', { class: 'empty', style: 'padding:20px 0', text: '불러오는 중…' }));
    await refreshPrep();
  }
  async function refreshPrep() {
    if (!S.prep) return;
    const { uid } = S.prep;
    try {
      S.prep.data = await api('GET', `/api/rooms/${encodeURIComponent(S.roomId)}/members/${encodeURIComponent(uid)}`);
      if (S.prep && S.prep.uid === uid) renderPrep();
    } catch (e) { toast(e.message, 'bad'); }
  }
  function prepApi(method, path, body, isForm) {
    return api(method, `/api/rooms/${encodeURIComponent(S.roomId)}/members/${encodeURIComponent(S.prep.uid)}${path}`, body, isForm);
  }
  function renderPrep() {
    const P = S.prep;
    const d = P.data;
    if (!d) return;
    const r = d.readiness;
    const done = [
      !!(d.profile.intro || d.profile.criteria.length),
      d.reports.length > 0,
      d.interview.length > 0 && !d.interview.some(q => q.status === 'open'),
      d.stances.some(s => s.status === 'confirmed'),
      r.ready,
    ];
    const stepper = h('div', { class: 'stepper' }, PREP_TABS.map((t, i) => h('button', {
      type: 'button', class: done[i] ? 'done' : '', 'aria-current': String(P.tab === i), on: { click: () => { P.tab = i; renderPrep(); } },
    }, h('span', { class: 'n', text: done[i] ? '✓' : i + 1 }), t)));
    const body = [prepProfile, prepReports, prepInterview, prepStances, prepReady][P.tab](d);
    fill($('#sheetBody'), 
      P.preview ? h('div', { class: 'preview-banner' }, icon('eye'), `${d.name} 님 화면을 미리 보는 중이에요 (읽기 전용 · 실시간으로 바뀌어요)`) : null,
      stepper, h('div', { class: 'prep-sec' }, body));
    if (P.preview) $$('#sheetBody input, #sheetBody textarea, #sheetBody select, #sheetBody .prep-sec button').forEach(el => { el.disabled = true; });
  }
  function listInputs(values, n, placeholder) {
    return h('div', { class: 'stack', style: 'gap:6px' }, Array.from({ length: n }, (_, i) => h('input', { value: values[i] || '', placeholder: typeof placeholder === 'function' ? placeholder(i) : placeholder, maxlength: 160 })));
  }
  function readList(box) { return $$('input', box).map(x => x.value.trim()).filter(Boolean); }
  function chipsInput(values, placeholder) {
    const wrap = h('div', { class: 'chips-input' });
    const vals = [...values];
    const inp = h('input', { placeholder });
    const draw = () => {
      fill(wrap, ...vals.map((v, i) => h('span', { class: 'chip accent' }, v, h('button', { type: 'button', 'aria-label': `${v} 삭제`, on: { click: () => { vals.splice(i, 1); draw(); } } }, icon('x')))), inp);
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
    const p = d.profile; const sc = d.scope;
    const name = h('input', { value: d.name, maxlength: 12 });
    const role = h('input', { value: d.role, maxlength: 20, placeholder: '예: 자료조사' });
    const intro = h('input', { value: p.intro, maxlength: 120, placeholder: '예: 4조 자료조사 담당. 숫자와 근거를 챙김' });
    const exp = chipsInput(p.expertise, '키워드 입력 후 Enter (예: 설문, 예산)');
    const crit = listInputs(p.criteria, 3, i => ['1순위 (예: 학생 만족도 데이터)', '2순위 (예: 비용 대비 효과)', '3순위 (예: 준비 기간)'][i]);
    const proj = listInputs(p.projects, 3, '이번 안건과 관련된 경험만 (선택)');
    const tone = listInputs(p.tone_examples, 3, i => ['평소 회의에서 하는 말 예시 1', '예시 2', '예시 3 (선택)'][i]);
    const lvl = sc.level;
    const r1 = h('input', { type: 'radio', name: 'lvl', value: 'opinion', checked: lvl === 'opinion' });
    const r2 = h('input', { type: 'radio', name: 'lvl', value: 'answer', checked: lvl === 'answer' });
    const nc = chipsInput(sc.no_commit, '약속하면 안 되는 것 (예: 마감일)');
    const c1 = h('input', { type: 'checkbox', checked: d.consent.use_reports });
    const c2 = h('input', { type: 'checkbox', checked: d.consent.store_utterances });
    const save = h('button', { class: 'btn primary', type: 'button' }, '프로필 저장');
    save.addEventListener('click', async () => {
      busy(save, true, '저장 중…');
      try {
        S.prep.data = await prepApi('PUT', '/profile', {
          name: name.value, role: role.value, intro: intro.value, expertise: exp.values(), criteria: readList(crit), projects: readList(proj),
          tone_examples: readList(tone), scope_level: r2.checked ? 'answer' : 'opinion', no_commit: nc.values(), scope_note: '',
          use_reports: c1.checked, store_utterances: c2.checked,
        });
        toast('프로필을 저장했어요.'); S.prep.tab = 1; renderPrep();
      } catch (e) { toast(e.message, 'bad'); busy(save, false); }
    });
    return [
      h('div', { class: 'guide' }, h('b', { text: '페르소나에는 "안건 판단에 쓰이는 것"만 적어요' }),
        h('div', { class: 'cols', style: 'margin-top:6px' },
          h('div', {}, h('b', { text: '적어 주세요' }), h('ul', {}, ['팀에서 맡은 일과 관심 분야', '판단 기준 우선순위 (생각의 흐름)', '이번 안건과 관련된 경험 1~3줄', '평소 말투 예시 2~3문장', '위임 범위 (의견만? 약속 금지?)'].map(t => h('li', { text: t })))),
          h('div', {}, h('b', { text: '적지 않아요' }), h('ul', {}, ['학번·연락처·주소', '나이·성별·출신', 'MBTI 같은 성격검사', '건강·종교·정치 성향', '다른 사람의 개인정보'].map(t => h('li', { text: t }))))),
        h('div', { class: 'sm muted', style: 'margin-top:6px', text: '신상 정보는 안건 의견을 예측하는 데 도움이 안 되고, 고정관념과 개인정보 위험만 커져요.' })),
      h('div', { class: 'grid2' }, h('label', { class: 'field' }, h('span', { text: '이름' }), name), h('label', { class: 'field' }, h('span', { text: '팀에서 맡은 일' }), role)),
      h('label', { class: 'field' }, h('span', { text: '한 줄 소개' }), intro),
      h('label', { class: 'field' }, h('span', {}, '관심·전문 키워드 ', h('small', { text: '— 이 주제가 나오면 미니미가 더 귀 기울여요' })), exp),
      h('div', { class: 'field' }, h('span', {}, '판단 기준 ', h('small', { text: '— 우선순위 순서. 미니미가 생각을 정리하는 순서예요' })), crit),
      h('div', { class: 'field' }, h('span', {}, '관련 경험·프로젝트 ', h('small', { text: '— 근거로 인용돼요 [약력 1]' })), proj),
      h('div', { class: 'field' }, h('span', {}, '말투 예시 ', h('small', { text: '— 말투만 흉내 내고 내용은 근거에서만 가져와요' })), tone),
      h('div', { class: 'field' }, h('span', { text: '위임 범위' }),
        h('label', { class: 'check' }, r1, '의견 제시만 (기본)'), h('label', { class: 'check' }, r2, '질문 답변까지'), nc),
      h('div', { class: 'field' }, h('span', { text: '동의' }),
        h('label', { class: 'check' }, c1, '내 보고서를 미니미의 근거로 쓰는 데 동의해요'),
        h('label', { class: 'check' }, c2, '회의 발언에서 입장 변화 후보를 뽑아 저장하는 데 동의해요 (확인 전엔 쓰지 않아요)')),
      h('div', { class: 'row', style: 'justify-content:flex-end' }, save),
    ];
  }
  function prepReports(d) {
    const title = h('input', { placeholder: '보고서 제목 (예: 자료조사 보고서)', maxlength: 60 });
    const text = h('textarea', { rows: 7, placeholder: '보고서 내용을 붙여 넣으세요. 빈 줄로 문단을 나누면 [보고서 2문단]처럼 문단 단위로 인용돼요.' });
    const add = h('button', { class: 'btn primary', type: 'button' }, icon('spark'), '올리고 입장 카드 초안 만들기');
    const after = res => {
      S.prep.data = res.member;
      toast(res.candidates ? `입장 카드 초안 ${res.candidates}개를 만들었어요 (${engineLabel(res.engine)}). 인터뷰에서 확인해 주세요.` : '보고서를 올렸어요. 입장이 드러난 문단은 찾지 못했어요. 인터뷰로 채워 주세요.');
      S.prep.tab = 2; renderPrep();
    };
    add.addEventListener('click', async () => {
      if (!text.value.trim()) { toast('보고서 내용을 붙여 넣어 주세요.'); return; }
      busy(add, true, '분석 중…');
      try { after(await prepApi('POST', '/reports', { title: title.value, text: text.value })); } catch (e) { toast(e.message, 'bad'); busy(add, false); }
    });
    const file = h('input', { type: 'file', accept: '.txt,.md,.docx,.pdf', hidden: true });
    const drop = h('div', { class: 'dropzone' }, icon('upload'), ' 파일을 끌어다 놓거나 ',
      h('button', { class: 'link-btn', type: 'button', on: { click: () => file.click() } }, '파일 고르기'), h('div', { class: 'sm', text: 'txt · md · docx · pdf (pdf는 서버에 Docling/pypdf 필요)' }));
    const upload = async f => {
      if (!f) return;
      const fd = new FormData(); fd.append('file', f); fd.append('title', title.value);
      drop.textContent = '분석 중…';
      try { after(await prepApi('POST', '/reports/upload', fd, true)); } catch (e) { toast(e.message, 'bad'); renderPrep(); }
    };
    file.addEventListener('change', () => upload(file.files[0]));
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); upload(e.dataTransfer.files[0]); });
    return [
      h('div', { class: 'guide' }, h('b', { text: '보고서는 미니미의 사실 근거예요' }),
        h('div', { text: '안건에 대해 각자 먼저 짧은 보고서를 쓰고 올리면, AI가 문단을 나눠 입장 카드 초안을 만들어요. 초안은 본인이 확인하기 전까지 근거로 쓰지 않아요.' })),
      h('label', { class: 'field' }, h('span', { text: '제목' }), title),
      h('label', { class: 'field' }, h('span', { text: '내용' }), text),
      drop, file,
      h('div', { class: 'row', style: 'justify-content:flex-end' }, add),
      d.reports.length ? h('div', { class: 'section-title', text: `올린 보고서 ${d.reports.length}개` }) : null,
      d.reports.map(rep => h('div', { class: 'report' },
        h('div', { class: 'report-head' }, icon('doc'), h('span', { class: 't', text: rep.title }), chip(`${rep.paragraphs.length}문단`),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': '삭제', on: { click: async () => { try { S.prep.data = await prepApi('DELETE', `/reports/${rep.id}`); renderPrep(); } catch (e) { toast(e.message, 'bad'); } } } }, icon('trash'))),
        h('ol', {}, rep.paragraphs.map((t, i) => h('li', {}, h('span', { class: 'lab', text: rep.labels[i] }), h('span', { text: t })))))),
    ];
  }
  function prepInterview(d) {
    const r = d.readiness;
    const qs = d.interview;
    const plan = h('button', { class: 'btn primary', type: 'button' }, icon('spark'), qs.length ? '빈 쟁점 다시 확인하기' : '빈 곳만 질문 받기');
    plan.addEventListener('click', async () => {
      busy(plan, true, '확인 중…');
      try { const res = await prepApi('POST', '/interview/plan'); S.prep.data = res.member; if (!res.questions.length) toast('모든 쟁점에 확인된 입장이 있어요. 더 물어볼 게 없어요.'); renderPrep(); } catch (e) { toast(e.message, 'bad'); busy(plan, false); }
    });
    return [
      h('div', { class: 'guide' }, h('b', { text: `쟁점 ${r.total}개 중 ${r.covered}개에 근거가 있어요. 빈 곳만 물어볼게요 (약 3분)` }),
        h('div', { text: '한 줄로 대충 답해도 돼요. 미니미가 풀어 쓴 문장을 보여 주면 "맞아요"를 눌러 주세요. 확인한 문장만 근거가 돼요.' })),
      h('div', { class: 'row' }, plan),
      qs.length ? qs.slice().sort((a, b) => ({ open: 0, answered: 1, confirmed: 2, skipped: 3 }[a.status] - { open: 0, answered: 1, confirmed: 2, skipped: 3 }[b.status])).map(q => qaBox(q, d)) : null,
    ];
  }
  function qaBox(q, d) {
    const issue = S.room && S.room.issues.find(i => i.id === q.issue_id);
    const head = h('div', { class: 'row' }, issue ? chip(issue.title, 'info') : null,
      chip({ open: '답 대기', answered: '확인 대기', confirmed: '확인됨', skipped: '건너뜀' }[q.status], { open: '', answered: 'warn', confirmed: 'ok' }[q.status] || ''));
    if (q.status === 'open') {
      const inp = h('input', { placeholder: '한 줄로 답해 주세요', maxlength: 400 });
      const go = h('button', { class: 'btn primary sm', type: 'button' }, '답하기');
      const submit = async () => {
        if (!inp.value.trim()) return;
        busy(go, true, '풀어 쓰는 중…');
        try { const res = await prepApi('POST', `/interview/${q.id}/answer`, { text: inp.value }); S.prep.data = res.member; renderPrep(); } catch (e) { toast(e.message, 'bad'); busy(go, false); }
      };
      go.addEventListener('click', submit);
      inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) submit(); });
      return h('div', { class: 'qa' }, head, h('div', { class: 'q', text: q.question }), h('div', { class: 'row-form' }, inp, go));
    }
    const st = d.stances.find(s => s.id === q.stance_id);
    if (q.status === 'answered' && st) {
      return h('div', { class: 'qa' }, head, h('div', { class: 'q', text: q.question }),
        h('div', { class: 'sm muted', text: `내 답: ${q.answer}` }),
        h('div', { class: 'cand-text', text: st.claim }),
        stanceActions(st, true));
    }
    return h('div', { class: 'qa' }, head, h('div', { class: 'q', text: q.question }), q.expanded ? h('div', { class: 'sm', text: q.expanded }) : h('div', { class: 'sm muted', text: q.answer }));
  }
  function stanceActions(st, fromInterview = false) {
    const confirm = async (ok, edit = '') => {
      try {
        const res = await prepApi('POST', `/stances/${st.id}/confirm`, { ok, edit });
        S.prep.data = res.member;
        if (res.replaced.length) toast(`같은 쟁점의 예전 입장 카드 ${res.replaced.length}개를 새 입장으로 바꿨어요.`);
        else toast(ok ? '확인했어요. 이제 이 문장은 미니미의 근거예요.' : '버렸어요.');
        renderPrep();
      } catch (e) { toast(e.message, 'bad'); }
    };
    const editBtn = h('button', { class: 'btn xs', type: 'button' }, icon('edit'), '고칠래요');
    editBtn.addEventListener('click', () => {
      const ta = h('textarea', { rows: 3, value: st.claim });
      editBtn.parentElement.replaceWith(h('div', { class: 'stack', style: 'gap:6px' }, ta,
        h('div', { class: 'row' }, h('button', { class: 'btn primary xs', type: 'button', on: { click: () => confirm(true, ta.value) } }, '고쳐서 확인'),
          h('button', { class: 'btn ghost xs', type: 'button', on: { click: renderPrep } }, '취소'))));
      ta.focus();
    });
    return h('div', { class: 'acts row' },
      st.status !== 'confirmed' ? h('button', { class: 'btn ok xs', type: 'button', on: { click: () => confirm(true) } }, icon('check'), '맞아요') : null,
      editBtn,
      st.status !== 'confirmed' ? h('button', { class: 'btn ghost xs', type: 'button', on: { click: () => confirm(false) } }, fromInterview ? '아니에요' : '버리기')
        : h('button', { class: 'btn ghost xs', type: 'button', on: { click: async () => { try { S.prep.data = await prepApi('DELETE', `/stances/${st.id}`); renderPrep(); } catch (e) { toast(e.message, 'bad'); } } } }, icon('trash'), '삭제'));
  }
  function prepStances(d) {
    const issues = (S.room && S.room.issues) || [];
    const groups = issues.map(i => ({ id: i.id, title: i.title, options: i.options })).concat([{ id: '', title: '쟁점 없음', options: [] }]);
    const SST = { confirmed: ['확인됨', 'ok'], candidate: ['초안 · 확인 필요', 'warn'], inferred: ['추정 · 회의 발언', 'ai'] };
    const visible = d.stances.filter(s => s.status !== 'rejected');
    const issueSel = h('select', {}, issues.map(i => h('option', { value: i.id, text: i.title })), h('option', { value: '', text: '쟁점 없음' }));
    const claim = h('textarea', { rows: 2, placeholder: '내 입장 (예: 저는 B안이 맞다고 생각해요)', maxlength: 300 });
    const pos = h('input', { placeholder: '선택지 (예: B안, 선택)', maxlength: 20 });
    const red = h('input', { placeholder: '양보할 수 없는 조건 (선택)', maxlength: 200 });
    const add = h('button', { class: 'btn primary sm', type: 'button' }, icon('plus'), '입장 카드 추가');
    add.addEventListener('click', async () => {
      if (!claim.value.trim()) { toast('입장을 적어 주세요.'); return; }
      try {
        const res = await prepApi('POST', '/stances', { issue_id: issueSel.value, claim: claim.value, position: pos.value, red_line: red.value });
        S.prep.data = res.member; toast('입장 카드를 추가했어요.'); renderPrep();
      } catch (e) { toast(e.message, 'bad'); }
    });
    return [
      h('div', { class: 'guide' }, h('b', { text: '입장 카드 = 생각의 흐름을 정리한 단위' }),
        h('div', { text: '주장 · 근거 · 판단 기준(왜 그 근거가 주장을 뒷받침하나) · 양보 불가선 · 모르는 부분. 미니미는 "확인됨" 카드와 보고서에 있는 말만 하고, 같은 쟁점에 다른 선택지를 확인하면 예전 카드는 자동으로 대체돼요.' })),
      groups.map(g => {
        const list = visible.filter(s => s.issue_id === g.id);
        if (!list.length && !g.id) return null;
        return h('div', { class: 'stack', style: 'gap:8px' }, h('div', { class: 'section-title', text: g.title }),
          list.length ? list.map(s => {
            const [sl, sc] = SST[s.status] || [s.status, ''];
            return h('div', { class: `stance ${s.status}` },
              h('div', { class: 'stance-top' }, chip(sl, sc), s.label ? chip(s.label, 'accent') : null, s.position ? chip(s.position, '') : null,
                s.priority === 1 ? chip('우선순위 높음', 'bad') : null, chip({ report: '보고서', interview: '인터뷰', memory: '회의 기억', manual: '직접 작성' }[s.origin] || s.origin)),
              h('div', { class: 'claim-t', text: s.claim }),
              h('div', { class: 'meta' },
                s.reasons ? h('span', { text: `근거: ${s.reasons}` }) : null, s.warrant ? h('span', { text: `판단 기준: ${s.warrant}` }) : null,
                s.red_line ? h('span', { style: 'color:var(--bad)', text: `양보 불가: ${s.red_line}` }) : null,
                s.unknown ? h('span', { text: `모르는 부분: ${s.unknown}` }) : null,
                s.sources.length ? h('span', { text: `출처: ${s.sources.join(', ')}` }) : null),
              stanceActions(s));
          }) : h('div', { class: 'empty', text: '아직 입장이 없어요. 인터뷰에서 채워 주세요.' }));
      }),
      h('div', { class: 'section-title', text: '직접 추가' }),
      h('div', { class: 'stack', style: 'gap:8px' }, h('label', { class: 'field' }, h('span', { text: '쟁점' }), issueSel), claim, h('div', { class: 'grid2' }, pos, red), h('div', { class: 'row', style: 'justify-content:flex-end' }, add)),
    ];
  }
  function readinessList(items) {
    return h('ul', { class: 'ready-items' }, items.map(it => {
      const [l, c] = RSTATE[it.state] || [it.state, ''];
      return h('li', {}, h('span', { class: 't', text: it.title }), it.evidence && it.evidence.length ? h('span', { class: 'muted sm', text: it.evidence.slice(0, 2).join(', ') }) : null, chip(l, c));
    }));
  }
  function prepReady(d) {
    const r = d.readiness;
    const pct = r.total ? Math.round(100 * r.covered / r.total) : 0;
    const isMe = d.user_id === S.me;
    const m = S.byId[d.user_id] || {};
    const openQs = d.questions.filter(q => q.status === 'open');
    const forget = h('button', { class: 'btn danger sm', type: 'button' }, icon('trash'), '내 기억 삭제');
    forget.addEventListener('click', () => confirmModal({
      eyebrow: '개인정보', title: '미니미의 기억을 모두 지울까요?', danger: true, ok: '모두 지우기',
      body: '보고서·입장 카드·인터뷰·미니미가 남긴 질문이 모두 지워져요. 이름과 역할만 남아요. 되돌릴 수 없어요.',
      onOk: async () => { try { S.prep.data = await prepApi('DELETE', '/memory'); toast('미니미의 기억을 지웠어요.'); renderPrep(); } catch (e) { toast(e.message, 'bad'); } },
    }));
    return [
      h('div', { class: 'ready-big' }, h('div', { class: 'ring', style: `--p:${pct}` }, h('span', { text: `${r.covered}/${r.total}` })),
        h('div', {}, h('b', { text: r.ready ? '모든 쟁점에 근거가 있어요' : `쟁점 ${r.total}개 중 ${r.covered}개만 답할 수 있어요` }),
          h('div', { class: 'sm muted', text: '준비도 = 안건 쟁점 중 확인된 입장이나 보고서 근거가 있는 비율. 근거가 없는 쟁점에서 미니미는 말하지 않아요.' }))),
      readinessList(r.items),
      isMe ? h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(!!m.mini_on), on: { click: () => toggleAway() } },
        h('span', {}, h('div', { class: 'lbl', text: '대리 참석 (자리 비움)' }), h('div', { class: 'desc', text: m.mini_on ? '지금 미니미가 대신 참석 중이에요' : '켜면 회의에 미니미가 대신 들어가요' })), h('span', { class: 'toggle' })) : null,
      openQs.length ? h('div', { class: 'section-title', text: `미니미가 남긴 질문 ${openQs.length}개` }) : null,
      openQs.map(q => questionBox(q)),
      isMe ? h('div', { class: 'danger-zone' }, h('b', { text: '내 기억 삭제' }), h('div', { class: 'sm muted', text: '보고서·발언 기억은 동의한 경우에만 저장되고, 언제든 지울 수 있어요.' }), h('div', {}, forget)) : null,
    ];
  }
  function questionBox(q, onDone) {
    const inp = h('input', { placeholder: '한 줄로 답하면 확인된 입장으로 저장돼요', maxlength: 400 });
    const share = h('input', { type: 'checkbox', checked: true });
    const go = h('button', { class: 'btn primary sm', type: 'button' }, '답하기');
    go.addEventListener('click', async () => {
      if (!inp.value.trim()) return;
      busy(go, true, '저장 중…');
      try {
        const data = await api('POST', `/api/rooms/${encodeURIComponent(S.roomId)}/members/${encodeURIComponent(S.me)}/questions/${q.id}/answer`, { text: inp.value, share: share.checked });
        if (S.prep && S.prep.uid === S.me) { S.prep.data = data; renderPrep(); }
        toast('답을 저장했어요. 다음엔 미니미가 이 근거로 답할 수 있어요.');
        if (onDone) onDone(data);
      } catch (e) { toast(e.message, 'bad'); busy(go, false); }
    });
    return h('div', { class: 'qa' }, h('div', { class: 'row' }, chip(q.reason, q.reason === '약속 필요' ? 'warn' : 'info'), h('span', { class: 'muted sm', text: `${nameOf(q.asked_by)} 님이 물음 · ${fmtTime(q.ts)}` })),
      h('div', { class: 'q', text: q.text }), h('div', { class: 'row-form' }, inp, go), h('label', { class: 'check sm' }, share, '답을 회의방에도 올리기'));
  }

  // ================================================================ 내가 빠진 사이
  function openDigest(d, { preview = false, uid = S.me } = {}) {
    S.digest = { data: d, preview, uid };
    renderDigest();
  }
  function renderDigest() {
    if (!S.digest) return;
    const { data: d, preview, uid } = S.digest;
    const m = S.byId[uid] || { name: '' };
    const live = id => ((S.room && S.room.decisions) || []).find(x => x.id === id);
    const decisions = (d.decisions || []).map(x => live(x.id) || x);
    const body = [
      preview ? h('div', { class: 'preview-banner' }, icon('eye'), `${m.name} 님 화면 미리보기 (읽기 전용 · 실시간)`) : null,
      h('div', { class: 'digest-sum', text: d.summary }),
      h('div', { class: 'stats' }, h('span', {}, '대화 ', h('b', { text: d.count })), h('span', {}, '미니미 발언 ', h('b', { text: (d.mini || []).length })),
        h('span', {}, '보류 결정 ', h('b', { text: decisions.length })), h('span', {}, '질문 ', h('b', { text: (d.questions || []).length })), h('span', {}, `요약 엔진 ${engineLabel(d.engine)}`)),
      (d.mini || []).length ? h('div', { class: 'section-title', text: '내 미니미가 대신 한 말' }) : null,
      (d.mini || []).map(x => {
        const b = h('div', { class: 'mini-bubble' });
        renderCited(b, x.text, x.citations || []);
        return h('div', { class: `msg mini c${m.color || 0}${x.abstain ? ' abstain' : ''}`, style: 'padding:4px 0' }, avatar(m, { mini: true }),
          h('div', { class: 'body' }, h('div', { class: 'head' }, h('span', { class: 'who', text: `${m.name}의 미니미` }), h('span', { class: 'time', text: fmtTime(x.ts) }),
            x.abstain ? chip(x.abstain === 'commit' ? '약속 보류' : '확인 필요', 'warn') : null), b));
      }),
      decisions.length ? h('div', { class: 'section-title', text: '내 확인이 필요한 보류 결정' }) : null,
      decisions.map(x => {
        const [l, c] = DSTATUS[x.status] || ['', ''];
        const resp = (x.responses || {})[uid];
        return h('div', { class: 'qa' }, h('div', { class: 'row' }, chip(l, c), x.issue_title ? chip(x.issue_title, 'info') : null, h('span', { class: 'muted sm', text: `${x.by_name} 님 발언` })),
          h('div', { class: 'q', text: x.text }),
          resp ? h('div', { class: `box ${resp.action === 'approve' ? 'info' : 'warn'}` }, icon(resp.action === 'approve' ? 'check' : 'alert'),
            h('span', {}, resp.action === 'approve' ? '승인했어요' : `이의를 달았어요${resp.note ? `: ${resp.note}` : ''}`))
            : (preview ? h('div', { class: 'muted sm', text: '확인 대기 중' }) : decideForm(x)));
      }),
      (d.questions || []).length ? h('div', { class: 'section-title', text: '미니미가 남긴 질문' }) : null,
      (d.questions || []).map(q => {
        if (preview) {
          const live2 = S.digest.liveQ && S.digest.liveQ.find(x => x.id === q.id);
          return h('div', { class: 'qa' }, h('div', { class: 'row' }, chip(q.reason, 'info'), h('span', { class: 'muted sm', text: `${nameOf(q.asked_by)} 님이 물음` })),
            h('div', { class: 'q', text: q.text }), live2 && live2.status === 'answered' ? h('div', { class: 'box info' }, icon('check'), h('span', { text: `답: ${live2.answer}` })) : h('div', { class: 'muted sm', text: '답 대기 중' }));
        }
        return questionBox(q, data => { S.digest.data.questions = (S.digest.data.questions || []).filter(x => x.id !== q.id); S.digest.liveQ = data.questions; renderDigest(); });
      }),
      !preview ? h('div', { class: 'row', style: 'justify-content:flex-end' }, h('button', { class: 'btn', type: 'button', on: { click: () => { closeModal(); openPrep(S.me, { tab: 3 }); } } }, '입장 카드 보기'),
        h('button', { class: 'btn primary', type: 'button', on: { click: closeModal } }, '확인했어요')) : null,
    ];
    openModal({ eyebrow: preview ? '화면 미리보기' : '돌아온 걸 환영해요', title: preview ? `${m.name} 님이 빠진 사이` : '내가 빠진 사이', body, wide: true });
    S.digest = { data: d, preview, uid, liveQ: S.digest && S.digest.liveQ };
  }
  async function onDigestReady(uid) {
    if (!(S.observer && S.demo && S.demo.view === `digest:${uid}`)) return;
    try {
      const det = await api('GET', `/api/rooms/${encodeURIComponent(S.roomId)}/members/${encodeURIComponent(uid)}`);
      if (det.last_digest && det.last_digest.summary) { openDigest(det.last_digest, { preview: true, uid }); S.digest.liveQ = det.questions; }
    } catch { /* 무시 */ }
  }
  async function refreshDigestPreview() {
    if (!S.digest || !S.digest.preview) return;
    try {
      const det = await api('GET', `/api/rooms/${encodeURIComponent(S.roomId)}/members/${encodeURIComponent(S.digest.uid)}`);
      S.digest.liveQ = det.questions; renderDigest();
    } catch { /* 무시 */ }
  }

  // ================================================================ 시연 가이드
  function openDemoPanel() {
    $('#demoPanel').hidden = false;
    $('#demoPanel').classList.remove('min');
    renderDemo();
  }
  function onDemo(d) {
    const prev = S.demoPrev || {};
    S.demoPrev = { scene: d.scene, status: d.status, step: d.step };
    if (d.status === 'running' && d.scene >= 0) S.demoSel = d.scene;
    if (d.status === 'done' && prev.status !== 'done' && d.scene >= 0) S.demoSel = Math.min(d.scene + 1, (d.scenes || []).length - 1);
    renderDemo();
    if (d.status === 'running' && (prev.scene !== d.scene || prev.status !== 'running')) applyDemoFocus(d);
    if (d.status === 'done' && prev.status === 'running' && S.prep && S.prep.preview && (d.view || '').startsWith('prep:')) {
      S.prep.tab = 4; refreshPrep();
    }
    if (d.status === 'done' && prev.status === 'running') {
      if (d.focus === 'minutes') { const last = [...S.messages].reverse().find(m => m.kind === 'result'); if (last) flashMsg(last.id); }
      if (d.focus === 'verify') { const last = [...S.messages].reverse().find(m => m.kind === 'verify'); if (last) flashMsg(last.id); }
      if (d.view && d.view.startsWith('digest:')) refreshDigestPreview();
    }
    if (S.digest && S.digest.preview && d.status === 'running') refreshDigestPreview();
  }
  function applyDemoFocus(d) {
    const v = d.view || '';
    if (v.startsWith('prep:')) {
      const uid = v.split(':')[1];
      openPrep(uid, { tab: 1, preview: uid !== S.me });
      S.demoPrepFollow = true;
    } else if (S.prep && S.prep.preview) closeSheet();
    if (!v.startsWith('digest:') && S.digest && S.digest.preview) closeModal();
    if (['gate', 'evidence', 'drift', 'engine'].includes(d.focus)) { if (innerWidth > 1240) setTab(d.focus, true); else { setTab(d.focus); } }
    if (d.focus === 'agenda') { const el = $('#issueList'); el.classList.remove('focus-ring'); void el.offsetWidth; el.classList.add('focus-ring'); }
  }
  function flashMsg(id) {
    const el = S.msgEls.get(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('focus-ring'); void el.offsetWidth; el.classList.add('focus-ring');
  }
  function renderDemo() {
    const d = S.demo;
    const panel = $('#demoPanel');
    if (panel.hidden || !d) return;
    const scenes = d.scenes || [];
    const sel = clip(S.demoSel, 0, scenes.length - 1);
    const sc = scenes[sel] || {};
    const running = d.status === 'running';
    fill($('#demoSteps'), ...scenes.map((s, i) => h('li', {}, h('button', {
      type: 'button', class: (d.done || []).includes(i) ? 'done' : '', 'aria-current': String(i === sel), title: s.title,
      on: { click: () => { S.demoSel = i; renderDemo(); } },
    }, h('span', { class: 'n', text: (d.done || []).includes(i) ? '✓' : i }), s.title.split(':')[0]))));
    $('#demoTitle').textContent = `${sel}. ${sc.title || ''}`;
    fill($('#demoMetric'), chip(`연결 지표 · ${sc.metric || ''}`, 'ai'), sc.view ? chip('발표 화면: ' + (sc.view.startsWith('prep') ? '준비 화면 미리보기' : '복귀 화면 미리보기'), 'info') : null);
    $('#demoNarration').textContent = sc.narration || '';
    const st = $('#demoStatus');
    st.className = `demo-status ${running ? 'running' : ''}`;
    if (running) fill(st, h('span', { class: 'dots' }, h('i'), h('i'), h('i')), d.scene === sel ? (d.step || '실행 중') : `장면 ${d.scene} 실행 중…`);
    else if (d.status === 'error') fill(st, icon('alert'), d.step || '오류');
    else if ((d.done || []).includes(sel)) fill(st, icon('check'), '이 장면을 실행했어요. 다음 장면으로 넘어가세요.');
    else fill(st, icon('info'), sel === 0 ? '처음이면 0번부터. 방의 대화가 초기화돼요.' : '실행을 누르면 모든 접속자 화면이 함께 움직여요.');
    $('#demoRun').disabled = running; $('#demoNext').disabled = running || sel >= scenes.length - 1;
    $('#demoAuto').textContent = running && d.auto ? '자동 재생 중지' : '자동 재생';
    $('#demoAuto').disabled = running && !d.auto;
    if (running) $('#demoSpeed').value = String(d.speed || 1);
  }
  async function demoRun(scene, auto = false) {
    const go = async () => {
      try { S.demo = await api('POST', `/api/demo/${encodeURIComponent(S.roomId)}/run`, { scene, auto, speed: Number($('#demoSpeed').value) }); S.demoSel = scene; renderDemo(); } catch (e) { toast(e.message, 'bad'); }
    };
    if (scene === 0 && S.messages.length) {
      confirmModal({ eyebrow: '시연 가이드', title: '방을 시연 시작 상태로 되돌릴까요?', body: '지금 방의 대화·결정·준비 내용이 지워지고 시연 시나리오로 다시 채워져요.', ok: '초기화하고 시작', onOk: go });
      return;
    }
    if (scene > 0 && S.demo && !(S.demo.done || []).includes(scene - 1) && !(S.demo.done || []).length) {
      confirmModal({ eyebrow: '시연 가이드', title: '0번 장면부터 실행할까요?', body: '시연 장면은 앞 장면의 결과를 이어 받아요. 처음이면 0번부터 실행하는 게 안전해요.', ok: '이 장면만 실행', cancel: '취소', onOk: go });
      return;
    }
    await go();
  }

  // ================================================================ 반응형 패널
  function openLeft() { $('#leftPanel').classList.add('open'); $('#scrim').hidden = false; $('#scrim').classList.add('on'); setNav('left'); }
  function openRight() { if (innerWidth > 1240) return; $('#rightPanel').classList.add('open'); $('#scrim').hidden = false; $('#scrim').classList.add('on'); setNav('right'); }
  function closePanels() { $('#leftPanel').classList.remove('open'); $('#rightPanel').classList.remove('open'); $('#scrim').hidden = true; $('#scrim').classList.remove('on'); setNav('chat'); }
  function setNav(k) { $$('#bottomNav button').forEach(b => b.setAttribute('aria-current', String(b.dataset.nav === k))); }

  // ================================================================ 정적 바인딩
  function bindStatic() {
    $('#roomForm').addEventListener('submit', e => { e.preventDefault(); const v = $('#roomInput').value.trim(); if (v) loadLobbyRoom(v); });
    $('#newMemberForm').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.currentTarget; const room = $('#lobbyRoom').dataset.room;
      try { const m = await api('POST', `/api/rooms/${encodeURIComponent(room)}/members`, { name: f.name.value, role: f.role.value }); f.reset(); join(room, m.user_id, false); toast(`${m.name} 님, 환영해요. 먼저 '내 미니미 준비'를 해 보세요.`); setTimeout(() => openPrep(m.user_id, { tab: 0 }), 600); } catch (err) { toast(err.message, 'bad'); }
    });
    $('#observeBtn').addEventListener('click', () => join($('#lobbyRoom').dataset.room, null, true));
    $('#newRoomForm').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.currentTarget;
      const issues = parseIssues(f.issues.value);
      try {
        await api('POST', '/api/rooms', { room_id: f.room_id.value.trim(), title: f.title.value, agenda: f.agenda.value, issues, seed: f.seed.checked });
        $('#roomInput').value = f.room_id.value.trim(); loadLobbyRoom(f.room_id.value.trim()); f.reset(); f.closest('details').open = false;
        toast('방을 만들었어요. 자리를 고르거나 새 팀원으로 들어오세요.');
      } catch (err) { toast(err.message, 'bad'); }
    });

    $('#composer').addEventListener('submit', submitComposer);
    const input = $('#input');
    input.addEventListener('input', () => { autosize(); sendTyping(true); clearTimeout(S.typingOffT); S.typingOffT = setTimeout(() => sendTyping(false), 3000); onInputMention(); });
    input.addEventListener('keydown', e => {
      if (S.mention) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); S.mention.sel = (S.mention.sel + (e.key === 'ArrowDown' ? 1 : -1) + S.mention.list.length) % S.mention.list.length; renderMention(); return; }
        if ((e.key === 'Enter' || e.key === 'Tab') && !e.isComposing) { e.preventDefault(); pickMention(S.mention.sel); return; }
        if (e.key === 'Escape') { closeMention(); return; }
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submitComposer(); }
    });
    input.addEventListener('blur', () => setTimeout(closeMention, 150));
    $$('.composer-modes button').forEach(b => b.addEventListener('click', () => {
      S.cmode = b.dataset.cmode;
      $$('.composer-modes button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      input.placeholder = S.cmode === 'refine' ? '한 줄만 적어도 돼요. 내 미니미가 다듬고, 올리기 전에 확인해요.' : '의견을 적어 주세요. @이름 으로 미니미를 부를 수 있어요.';
      input.focus();
    }));

    $$('#modeSeg button').forEach(b => b.addEventListener('click', () => send({ type: 'mode', mode: b.dataset.mode })));
    $$('.tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
    $('#enginePill').addEventListener('click', () => { setTab('engine', true); openRight(); });
    $('#inviteBtn').addEventListener('click', openInvite);
    $('#endBtn').addEventListener('click', () => confirmModal({
      eyebrow: '회의 종료', title: '회의를 끝내고 회의록을 만들까요?', body: '쟁점별 의견·충돌·결정 상태가 정리돼요. 보류된 결정은 불참자가 돌아와 확인할 때까지 그대로 남아요.',
      ok: '종료하고 정리', onOk: () => send({ type: 'end_meeting' }),
    }));
    $('#themeBtn').addEventListener('click', () => {
      const cur = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = cur; store.set('mymini.theme', cur);
    });
    $('#meBtn').addEventListener('click', e => { e.stopPropagation(); $('#meMenu').hidden = !$('#meMenu').hidden; });
    document.addEventListener('click', e => {
      if (!$('#meMenu').hidden && !e.target.closest('.me-menu')) $('#meMenu').hidden = true;
      if (!$('#popover').hidden && !e.target.closest('.popover') && !e.target.closest('.cite')) $('#popover').hidden = true;
    });
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      $('#meMenu').hidden = true;
      const act = b.dataset.act;
      if (act === 'prep') openPrep(S.me);
      else if (act === 'digest') { if (!send({ type: 'digest' })) return; setTimeout(() => { if (!S.digest) toast('아직 "내가 빠진 사이" 기록이 없어요. 대리 참석을 켰다가 돌아오면 생겨요.'); }, 700); }
      else if (act === 'agenda') { if (S.observer) toast('관전 모드에서는 안건을 바꿀 수 없어요.'); else openAgenda(); }
      else if (act === 'leave') { store.del('mymini.session'); const url = new URL(location.href); url.searchParams.set('lobby', '1'); history.replaceState(null, '', url); showLobby(S.roomId); }
    });
    $('#modal').addEventListener('click', e => { if (e.target.closest('[data-close]')) closeModal(); });
    $('#sheet').addEventListener('click', e => { if (e.target.closest('[data-sclose]')) closeSheet(); });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (!$('#popover').hidden) { $('#popover').hidden = true; return; }
      if (!$('#modal').hidden) { closeModal(); return; }
      if (!$('#sheet').hidden) { closeSheet(); return; }
      closePanels();
    });
    $('#openLeft').addEventListener('click', openLeft);
    $('#openRight').addEventListener('click', () => { $('#rightPanel').classList.add('open'); $('#scrim').hidden = false; $('#scrim').classList.add('on'); });
    $('#closeRight').addEventListener('click', closePanels);
    $('#scrim').addEventListener('click', closePanels);
    $$('#bottomNav button').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.nav;
      closePanels();
      if (k === 'left') openLeft();
      else if (k === 'right') { $('#rightPanel').classList.add('open'); $('#scrim').hidden = false; $('#scrim').classList.add('on'); setNav('right'); }
      else if (k === 'prep') { if (S.observer) toast('관전 모드에는 내 미니미가 없어요.'); else openPrep(S.me); }
    }));

    $('#demoBtn').addEventListener('click', () => { if ($('#demoPanel').hidden) openDemoPanel(); else $('#demoPanel').hidden = true; });
    $('#demoClose').addEventListener('click', () => { $('#demoPanel').hidden = true; });
    $('#demoMin').addEventListener('click', () => $('#demoPanel').classList.toggle('min'));
    $('#demoRun').addEventListener('click', () => demoRun(S.demoSel));
    $('#demoNext').addEventListener('click', () => { S.demoSel = Math.min(S.demoSel + 1, ((S.demo && S.demo.scenes) || []).length - 1); demoRun(S.demoSel); });
    $('#demoAuto').addEventListener('click', async () => {
      if (S.demo && S.demo.status === 'running' && S.demo.auto) { try { S.demo = await api('POST', `/api/demo/${encodeURIComponent(S.roomId)}/stop`); renderDemo(); } catch (e) { toast(e.message, 'bad'); } return; }
      demoRun(S.demoSel, true);
    });
    $('#demoRestart').addEventListener('click', () => { S.demoSel = 0; demoRun(0); });
    addEventListener('resize', () => { if (innerWidth > 1240) $('#rightPanel').classList.remove('open'); });
  }

  init();
})();
