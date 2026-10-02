/* MyMini 클라이언트 (코어) — 로비 · 연결 · 회의방(사이드바·헤더·대화·입력) · 시연 가이드.
   머릿속 패널·준비 시트·내가 빠진 사이·초대·안건 편집은 panels.js (window.MMPanels)에 있다.
   사용자 입력은 모두 textContent로만 넣는다(XSS 방지). */
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
  const fmtTime = ts => { const d = new Date(ts * 1000); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fmtDur = sec => { sec = Math.max(0, Math.floor(sec)); const m = Math.floor(sec / 60); return m >= 60 ? `${Math.floor(m / 60)}:${pad(m % 60)}:${pad(sec % 60)}` : `${m}:${pad(sec % 60)}`; };
  const clip = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const store = {
    get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 불가 환경 */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* */ } },
  };
  function toast(text, kind = '') {
    const t = h('div', { class: `toast ${kind}`, role: 'status', text });
    $('#toasts').append(t);
    setTimeout(() => t.remove(), kind === 'bad' ? 5200 : 3000);
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
  const tag = (text, kind = '') => h('span', { class: `tag ${kind}`, text });

  const ACT = { rebuttal: '반론', opinion: '의견', answer: '답변', agree_add: '동의 + 조건' };
  const VERDICT = { supported: ['근거 있음', 'ok'], weak: ['근거 약함', 'warn'], conflict: ['충돌', 'bad'], none: ['근거 없음', 'warn'] };
  const DSTATUS = { confirmed: ['확정', 'ok'], pending: ['보류', 'warn'], needs_check: ['확인 필요', 'info'], objected: ['이의', 'bad'] };
  const ISTATUS = { open: ['논의 전', 'plain'], discussing: ['논의 중', 'info'], pending: ['보류', 'warn'], decided: ['결정', 'ok'] };
  const RSTATE = { confirmed: ['확인된 입장', 'ok'], report: ['보고서 근거', 'info'], candidate: ['초안만', 'warn'], none: ['근거 없음', 'bad'] };
  const MODE_KO = { intervene: '개입형', interactive: '상호작용형', call: '호출형' };

  function engineLabel(e) {
    if (!e || e === 'rule') return '규칙';
    const [kind, ...rest] = e.split(':');
    return `${kind === 'ollama' ? '로컬' : kind === 'api' ? 'API' : kind} ${rest.join(':')}`;
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
  const colorOf = uid => (S.byId[uid] ? S.byId[uid].color : 0) || 0;

  function avatar(m, { mini = false, size = '', online = null } = {}) {
    const el = h('span', { class: `av ${size} c${(m && m.color) || 0}${mini ? ' mini' : ''}`, 'aria-hidden': 'true' },
      ((m && m.name) || '?').slice(0, 1));
    if (online != null && !mini) el.append(h('span', { class: `dot${online ? ' on' : ''}` }));
    return el;
  }

  let P = null;   // panels.js
  function panels() {
    if (!P) {
      P = window.MMPanels({
        $, $$, h, fill, icon, avatar, tag, toast, api, busy, S, send, me, nameOf, engineLabel, fmtTime, clip,
        openModal, closeModal, confirmModal, openSheet, closeSheet, toggleAway, setTab, openRight,
        renderCited, decideForm, ACT, VERDICT, DSTATUS, ISTATUS, RSTATE, MODE_KO,
      });
    }
    return P;
  }

  // ================================================================ 시작
  function init() {
    const theme = store.get('mymini.theme');
    document.documentElement.dataset.theme = theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    bindStatic();
    const qs = new URLSearchParams(location.search);
    const roomQ = qs.get('room');
    const sess = store.get('mymini.session');
    if (sess && (!roomQ || roomQ === sess.room) && !qs.has('lobby')) join(sess.room, sess.uid, sess.observer);
    else showLobby(roomQ || (sess && sess.room) || 'demo');
  }

  // ================================================================ 로비
  function showLobby(roomId) {
    closeWs();
    $('#app').hidden = true;
    $('#demoPanel').hidden = true;
    $('#lobby').hidden = false;
    document.title = 'MyMini';
    if (roomId) { $('#roomInput').value = roomId; loadLobbyRoom(roomId); }
  }

  async function loadLobbyRoom(roomId) {
    try {
      const d = await api('GET', `/api/rooms/${encodeURIComponent(roomId)}`);
      const box = $('#lobbyRoom');
      box.hidden = false;
      box.dataset.room = roomId;
      $('#lobbyRoomTitle').textContent = d.room.title || roomId;
      $('#lobbyAgenda').textContent = d.room.agenda || '안건이 아직 없어요';
      const members = d.members.members;
      const online = members.filter(m => m.online).length;
      $('#lobbyOnline').textContent = online ? `${online}명 접속 중` : '';
      fill($('#seatGrid'), members.length ? members.map(m => {
        const r = m.readiness || { covered: 0, total: 0 };
        return h('button', { class: `seat c${m.color || 0}`, type: 'button', on: { click: () => pickSeat(roomId, m) } },
          avatar(m, { size: 'lg', online: m.online }),
          h('div', { class: 'grow' }, h('div', { class: 'nm', text: m.name }),
            h('div', { class: 'rl', text: m.online ? `${m.role || '역할 미정'} · 접속 중` : `${m.role || '역할 미정'} · 준비 ${r.covered}/${r.total}` })));
      }) : h('p', { class: 'empty', text: '아직 팀원이 없어요. 새 팀원으로 들어오세요.' }));
    } catch (e) {
      $('#lobbyRoom').hidden = true;
      toast(e.message, 'bad');
      if (/없는 방/.test(e.message)) { const d = $$('.lobby-card details.fold').pop(); d.open = true; $('#newRoomId').value = roomId; }
    }
  }

  function pickSeat(roomId, m) {
    if (!m.online) return join(roomId, m.user_id, false);
    confirmModal({
      eyebrow: '자리 선택', title: `${m.name} 님 자리는 이미 접속 중이에요`,
      body: '같은 사람이 다른 기기로 들어오는 경우에만 계속하세요.', ok: '들어가기', onOk: () => join(roomId, m.user_id, false),
    });
  }

  // ================================================================ 입장 · 연결
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
      if (ev.code === 4404) { store.del('mymini.session'); toast('방에 없는 팀원이거나 방이 바뀌었어요. 자리를 다시 골라 주세요.', 'bad'); showLobby(S.roomId); return; }
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
      case 'room': S.room = d; renderRoom(); break;
      case 'members': setMembers(d.members); break;
      case 'history':
        S.messages = d.messages || []; S.drift = d.drift || [];
        if (d.gate) { S.gate = d.gate; S.gateByMsg.set(d.gate.msg_id, d.gate); }
        renderFeed(); renderDash(); break;
      case 'message': addMessage(d); break;
      case 'message_update': updateMessage(d.message); break;
      case 'gate': S.gate = d; S.gateByMsg.set(d.msg_id, d); S.selGate = null; panels().renderGate(); panels().renderEvidence(); break;
      case 'drift': S.drift.push(d); if (S.drift.length > 200) S.drift.shift(); panels().renderDrift(); break;
      case 'typing': onTyping(d); break;
      case 'status': S.status = d; renderEnginePill(); panels().renderEngine(); break;
      case 'decision': updateDecision(d.decision); break;
      case 'away_digest': if (d.user_id === S.me) panels().openDigest(d, { preview: false, uid: S.me }); break;
      case 'digest_ready': panels().onDigestReady(d.user_id); break;
      case 'memory':
        if (d.user_id === S.me && d.stances.length) toast(`회의에서 입장 변화 후보 ${d.stances.length}개를 찾았어요. 내 미니미 › 입장 카드에서 확인해 주세요.`);
        break;
      case 'refine': showRefine(d); break;
      case 'prep_update':
        if (S.prep && S.prep.uid === d.user_id) {
          if (S.prep.preview) S.prep.tab = d.event === 'report' ? 1 : 2;   // 시연 미리보기는 흐름을 따라간다
          panels().refreshPrep();
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
    renderMembers(); renderMyCard(); renderAvatarStack(); renderComposerState(); panels().renderGate();
    if (S.prep && S.prep.preview) panels().refreshPrep();
  }

  // ================================================================ 사이드바 · 헤더
  let timerT = null;
  function renderRoom() {
    const r = S.room;
    if (!r) return;
    document.title = `${r.title || r.room_id} · MyMini`;
    $('#roomMark').textContent = (r.title || r.room_id || 'M').trim().slice(0, 1);
    $('#roomTitle').textContent = r.title || r.room_id;
    $('#agendaTitle').textContent = r.agenda || '안건을 정해 주세요';
    $$('#meMenu [data-mode]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === (r.mode || 'intervene'))));
    renderIssues(); renderDecisions(); renderHeadTitle(); renderMeeting(); refreshDecisionCards();
    if (S.digest && S.digest.preview) panels().renderDigest();
  }
  function renderHeadTitle() {
    const r = S.room;
    const cur = r && r.issues.find(i => i.id === r.current_issue);
    fill($('#issueStrip'), icon('hash'), cur ? h('span', { class: 't', text: cur.title })
      : h('span', { class: 't dim', text: r && r.issues.length ? '쟁점을 이야기하면 지금 쟁점이 여기에 보여요' : (r && r.agenda) || '회의' }));
  }
  function renderMeeting() {
    clearInterval(timerT);
    const el = $('#meetingState');
    const m = (S.room && S.room.meeting) || {};
    const tick = () => {
      if (m.status === 'live') fill(el, h('span', { class: 'live', text: `회의 중 ${fmtDur(Date.now() / 1000 - m.started_at)}` }));
      else if (m.status === 'ended') fill(el, '회의 종료');
      else fill(el, '시작 전');
    };
    tick();
    if (m.status === 'live') timerT = setInterval(tick, 1000);
    const ended = m.status === 'ended';                            // 끝난 뒤에는 같은 자리에서 다음 회의를 연다
    fill($('#endBtn'), icon(ended ? 'play' : 'flag'), ended ? '새 회의 시작' : '회의 종료 · 회의록');
    $('#endBtn').disabled = S.observer || !(m.status === 'live' || ended);
  }
  function renderIssues() {
    const issues = (S.room && S.room.issues) || [];
    fill($('#issueList'), issues.length ? issues.map((it, i) => h('li', { class: `issue${it.id === S.room.current_issue ? ' current' : ''}`, 'data-status': it.status || 'open', title: (ISTATUS[it.status] || [''])[0] },
      h('span', { class: 'num' }, it.status === 'decided' ? icon('check', 'xs') : String(i + 1)),
      h('span', { class: 't', text: it.title }),
      it.options && it.options.length ? h('span', { class: 's', text: it.options.map(o => o.label).join(' · ') }) : null))
      : h('li', { class: 'empty', text: '쟁점을 추가해 주세요' }));
  }
  function renderDecisions() {
    const ds = (S.room && S.room.decisions) || [];
    $('#decisionCount').textContent = ds.length ? ds.length : '';
    fill($('#decisionList'), ds.length ? ds.slice().reverse().map(d => {
      const [label] = DSTATUS[d.status] || [''];
      return h('li', { class: 'dec', 'data-status': d.status || '', title: label }, h('span', { class: 'dot' }), h('span', { class: 't', text: d.text }));
    }) : h('li', { class: 'empty', text: '아직 없어요' }));
  }
  function renderMembers() {
    const online = S.members.filter(m => m.online).length;
    $('#presenceCount').textContent = `${online}/${S.members.length}`;
    fill($('#memberList'), S.members.map(m => {
      const r = m.readiness || { covered: 0, total: 0 };
      const st = m.mini_on ? '미니미가 대신 참석' : m.online ? (m.role || '대화 중') : '오프라인';
      return h('li', { class: `member c${m.color || 0}${m.mini_on ? ' away' : ''}${!m.online && !m.mini_on ? ' offline' : ''}` },
        avatar(m, { mini: m.mini_on, online: m.mini_on ? null : m.online }),
        h('div', { class: 'grow' },
          h('div', { class: 'nm' }, m.name, m.user_id === S.me ? h('span', { class: 'me', text: '나' }) : null),
          h('div', { class: 'st', text: st })),
        h('span', { class: `rd${r.ready ? ' full' : ''}`, title: '준비도: 쟁점 중 근거가 있는 비율', text: `${r.covered}/${r.total}` }));
    }));
  }
  function renderAvatarStack() {
    const on = S.members.filter(m => m.online || m.mini_on).slice(0, 5);
    fill($('#avatarStack'), on.map(m => { const a = avatar(m, { size: 'sm', mini: m.mini_on }); a.title = `${m.name}${m.mini_on ? ' (미니미)' : ''}`; return a; }));
  }
  function renderMyCard() {
    const bar = $('#myCard');
    const m = me();
    if (S.observer || !m) {
      bar.className = 'me-bar observer';
      fill(bar, icon('eye'), h('span', { class: 'grow', text: '발표 화면으로 보는 중' }),
        h('button', { class: 'text-btn', type: 'button', on: { click: leave } }, '자리 고르기'));
      return;
    }
    const r = m.readiness || { covered: 0, total: 0 };
    const pct = r.total ? Math.round(100 * r.covered / r.total) : 0;
    bar.className = `me-bar c${m.color || 0}`;
    fill(bar, avatar(m, { online: true }),
      h('div', { class: 'info', title: `준비도: 쟁점 ${r.total}개 중 ${r.covered}개에 답할 수 있어요` }, h('div', { class: 'nm', text: m.name }),
        h('div', { class: `sub${r.ready ? ' ready' : ''}` }, h('span', { class: 'meter' }, h('i', { style: `width:${pct}%` })), `${r.covered}/${r.total}`)),
      h('button', { class: 'icon-btn sm prep-btn', type: 'button', title: '내 미니미 준비', 'aria-label': '내 미니미 준비', on: { click: () => panels().openPrep(S.me) } }, icon('mini')),
      h('button', { class: 'away-toggle', type: 'button', role: 'switch', 'aria-checked': String(!!m.mini_on), title: '자리를 비우면 미니미가 대신 참석해요', on: { click: () => toggleAway() } },
        '자리 비움', h('span', { class: 'switch' })));
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
          h('p', { class: 'lead-text', text: '근거가 없는 쟁점에서는 미니미가 말하지 않고, 돌아오면 볼 질문으로 남겨요.' }),
          panels().readinessList(m.readiness_items || [])),
        ok: '그래도 켜기', cancel: '준비 먼저 하기',
        onOk: () => send({ type: 'away', value: true }), onCancel: () => panels().openPrep(S.me, { tab: 2 }),
      });
      return;
    }
    send({ type: 'away', value: on });
  }

  // ================================================================ 대화
  function renderFeed() {
    const feed = $('#feed');
    S.msgEls.clear();
    if (!S.messages.length) {
      fill(feed, h('div', { class: 'feed-empty' }, h('span', { class: 'mark' }),
        h('h3', { text: '회의를 시작해 보세요' }),
        h('p', { text: '첫 메시지를 보내면 회의가 시작돼요. 자리를 비운 팀원의 미니미는 근거가 있을 때만 말해요.' })));
      return;
    }
    let prev = null;
    fill(feed, S.messages.map(m => { const el = renderMessage(m, prev); prev = m; return el; }));
    feed.scrollTop = feed.scrollHeight;
  }
  function addMessage(m) {
    if (S.msgEls.has(m.id)) return;
    const feed = $('#feed');
    const near = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 180;
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
  function updateMessage(m) {
    if (!m) return;
    const i = S.messages.findIndex(x => x.id === m.id);
    if (i < 0) return;
    S.messages[i] = m;
    const old = S.msgEls.get(m.id);
    if (old) old.replaceWith(renderMessage(m, S.messages[i - 1] || null));
  }
  function renderMessage(m, prev) {
    let el;
    switch (m.kind) {
      case 'human': el = humanRow(m, prev); break;
      case 'mini': el = miniRow(m, prev); break;
      case 'facilitator': el = facilitatorCard(m); break;
      case 'decision': el = decisionCard(m); break;
      case 'verify': el = verifyCard(m, prev); break;
      case 'result': el = resultCard(m); break;
      default: el = h('div', { class: 'sys', text: m.text });
    }
    el.dataset.id = m.id;
    S.msgEls.set(m.id, el);
    return el;
  }
  const grouped = (m, prev) => prev && prev.kind === m.kind && prev.user_id === m.user_id && m.ts - prev.ts < 180
    && !(m.meta && m.meta.abstain) && !(prev.meta && prev.meta.abstain);

  function humanRow(m, prev) {
    const mine = m.user_id === S.me;
    const meta = m.meta || {};
    const cont = grouped(m, prev);
    const stamp = h('span', { class: 'stamp' },
      meta.decision_id ? h('span', { title: '결정으로 기록됨' }, icon('flag')) : null,
      meta.refined ? h('span', { title: '미니미가 다듬은 문장' }, icon('wand')) : null,
      fmtTime(m.ts));
    const canAct = !S.observer && S.me && !(me() && me().mini_on);
    const acts = canAct ? h('div', { class: 'hover-actions' },
      h('button', { type: 'button', title: '내 미니미가 근거 · 이전 발언 · 놓친 점을 확인해요', on: { click: () => { send({ type: 'verify', message_id: m.id }); toast('미니미에게 2차 검증을 맡겼어요.'); } } }, icon('shield'), '2차 검증'),
      !meta.decision_id ? h('button', { type: 'button', title: '이 발언을 결정으로 기록해요', on: { click: () => send({ type: 'mark_decision', message_id: m.id }) } }, icon('flag'), '결정으로 기록') : null) : null;
    return h('div', { class: `row human ${mine ? 'mine' : 'other'} c${colorOf(m.user_id)} ${cont ? 'cont' : 'first'}` },
      mine ? null : avatar(S.byId[m.user_id] || { name: nameOf(m.user_id) }),
      h('div', { class: 'col' },
        !mine && !cont ? h('div', { class: 'who', text: nameOf(m.user_id) }) : null,
        h('div', { class: 'line' }, h('div', { class: 'bubble', text: m.text }), stamp)),
      acts);
  }
  // 다른 주인의 미니미가 바로 이어 말하면 한 줄기 대화로 잇는다
  const isMiniLike = m => !!m && (m.kind === 'mini' || m.kind === 'verify');
  const ownerOf = m => (m.kind === 'verify' ? (m.meta || {}).requester : m.user_id);
  const chained = (m, prev) => isMiniLike(prev) && ownerOf(prev) !== ownerOf(m) && m.ts - prev.ts < 180;
  const miniHead = (mem, label) => h('div', { class: 'who' }, `${mem.name}의 미니미`, h('span', { class: 'ai', text: label ? `AI · ${label}` : 'AI' }));

  // 미니미 말풍선을 누르면 왜 말했는지(개입 판단 · 근거)를 서랍으로 연다
  function whyBubble(bubble, meta) {
    bubble.setAttribute('role', 'button');
    bubble.tabIndex = 0;
    bubble.title = '왜 이렇게 말했는지 보기';
    const open = e => {
      if (e.target.closest('.cite, a, summary, details, button')) return;
      if (meta.reply_to && S.gateByMsg.has(meta.reply_to)) showGateFor(meta.reply_to);
      else { openRight(); setTab('evidence', true); }
    };
    bubble.addEventListener('click', open);
    bubble.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } });
    return bubble;
  }
  function miniRow(m, prev) {
    const mem = S.byId[m.user_id] || { name: nameOf(m.user_id), color: 0 };
    const meta = m.meta || {};
    const abst = meta.abstain;
    const cont = grouped(m, prev);
    const bubble = h('div', { class: 'bubble' });
    renderCited(bubble, m.text, meta.citations || []);
    if (abst) bubble.append(h('span', { class: 'hint', text: '돌아오면 볼 질문으로 남겼어요' }));
    whyBubble(bubble, meta);
    const label = abst ? (abst === 'commit' ? '약속 보류' : '확인 필요') : (ACT[meta.act] || '');
    const stampTitle = [engineLabel(meta.engine), meta.dropped ? `출처 없는 문장 ${meta.dropped}개 삭제` : ''].filter(Boolean).join(' · ');
    return h('div', { class: `row mini other c${mem.color || 0} ${cont ? 'cont' : 'first'}${!cont && chained(m, prev) ? ' chain' : ''}${abst ? ' abstain' : ''}` },
      avatar(mem, { mini: true }),
      h('div', { class: 'col' },
        cont ? null : miniHead(mem, label),
        h('div', { class: 'line' }, bubble, h('span', { class: 'stamp', title: stampTitle, text: fmtTime(m.ts) }))));
  }
  function renderCited(el, text, citations) {
    const byLabel = Object.fromEntries((citations || []).map(c => [c.label, c]));
    const re = /\[([^\]\n]{1,30})\]/g;
    let last = 0; let mm;
    while ((mm = re.exec(text))) {
      if (mm.index > last) el.append(document.createTextNode(text.slice(last, mm.index)));
      const c = byLabel[mm[1]];
      if (c) el.append(h('button', { class: 'cite', type: 'button', title: '출처 보기', on: { click: e => showPopover(e.currentTarget, c) } }, mm[1].replace('문단', '')));
      else el.append(document.createTextNode(mm[0]));
      last = re.lastIndex;
    }
    if (last < text.length) el.append(document.createTextNode(text.slice(last)));
  }
  function showPopover(anchor, c) {
    const pop = $('#popover');
    const kind = { report: '보고서', stance: '입장 카드', interview: '인터뷰 답', profile: '약력', past: '지난 발언' }[c.kind] || '';
    fill(pop, h('div', { class: 'lab' }, icon('doc'), c.label, kind ? tag(kind, 'plain') : null), h('div', { text: c.text }));
    pop.hidden = false;
    const r = anchor.getBoundingClientRect();
    const w = Math.min(340, innerWidth - 24);
    pop.style.width = `${w}px`;
    pop.style.left = `${clip(r.left - 12, 12, innerWidth - w - 12)}px`;
    pop.style.top = `${r.bottom + 8}px`;
    requestAnimationFrame(() => { const ph = pop.offsetHeight; if (r.bottom + 8 + ph > innerHeight - 12) pop.style.top = `${Math.max(12, r.top - ph - 8)}px`; });
  }
  // 회의 도우미(규칙 기반 진행 봇)의 말풍선
  function botRow(cls, kids, ts) {
    return h('div', { class: `row bot other first${cls ? ` ${cls}` : ''}` },
      h('span', { class: 'av bot', 'aria-hidden': 'true' }, icon('spark')),
      h('div', { class: 'col' }, h('div', { class: 'who', text: '회의 도우미' }),
        h('div', { class: 'line' }, h('div', { class: 'bubble' }, kids), ts ? h('span', { class: 'stamp', text: fmtTime(ts) }) : null)));
  }
  function facilitatorCard(m) {
    return botRow('', [m.text], m.ts);
  }

  // ---- 결정: 대화 사이에 끼는 작은 알림
  function liveDecision(id, fallback) {
    return ((S.room && S.room.decisions) || []).find(d => d.id === id) || fallback || {};
  }
  function decisionCard(m) {
    const el = h('div', { class: 'event decision' });
    const id = m.meta && m.meta.decision && m.meta.decision.id;
    el.dataset.decisionId = id || '';
    fillDecision(el, liveDecision(id, m.meta && m.meta.decision));
    return el;
  }
  function fillDecision(el, d) {
    const [label] = DSTATUS[d.status] || [''];
    el.dataset.status = d.status || '';
    const responses = d.responses || {};
    const affected = d.affected || [];
    const canDecide = S.me && !S.observer && !responses[S.me]
      && ((affected.includes(S.me) && d.status === 'pending') || d.status === 'needs_check');
    const why = [d.by_name ? `${d.by_name} 님 발언` : '', d.issue_title, d.status === 'pending' ? '불참자와 관련돼 보류됐어요' : ''].filter(Boolean).join(' · ');
    fill(el,
      h('div', { class: 'event-pill', title: why },
        icon('flag', 'xs'), h('b', { text: `결정 ${label}` }), h('span', { class: 't', text: d.text }),
        affected.length ? h('span', { class: 'resp' }, affected.map(u => {
          const r = responses[u];
          return h('span', { class: `who-chip c${colorOf(u)}` }, avatar(S.byId[u] || { name: nameOf(u) }, { size: 'xs' }), nameOf(u),
            h('span', { class: `s ${r ? (r.action === 'approve' ? 'ok' : 'bad') : ''}`, text: r ? (r.action === 'approve' ? '승인' : '이의') : '확인 전' }));
        })) : null),
      Object.entries(responses).filter(([, r]) => r.note).map(([u, r]) => h('div', { class: 'note-line' }, h('b', { text: `${nameOf(u)} ` }), r.note)),
      canDecide ? decideForm(d) : null);
  }
  function decideForm(d, after) {
    const note = h('input', { placeholder: '이의가 있으면 이유 (선택)', maxlength: 300 });
    const go = action => {
      if (action === 'object' && !note.value.trim()) { note.focus(); toast('이의를 다는 이유를 한 줄 적어 주세요.'); return; }
      send({ type: 'decide', decision_id: d.id, action, note: note.value });
      if (after) after();
    };
    return h('div', { class: 'decide-form' }, note,
      h('button', { class: 'btn primary xs', type: 'button', on: { click: () => go('approve') } }, '승인'),
      h('button', { class: 'btn xs danger', type: 'button', on: { click: () => go('object') } }, '이의'));
  }
  function updateDecision(d) {
    if (!S.room) return;
    const i = S.room.decisions.findIndex(x => x.id === d.id);
    if (i >= 0) S.room.decisions[i] = d; else S.room.decisions.push(d);
    renderDecisions(); refreshDecisionCards();
    if (S.digest) panels().renderDigest();
  }
  function refreshDecisionCards() {
    if (!S.room) return;
    $$('.event.decision[data-decision-id]').forEach(el => {
      const d = S.room.decisions.find(x => x.id === el.dataset.decisionId);
      if (d) fillDecision(el, d);
    });
    if (S.minutesOpen && !$('#modal').hidden) {                     // 열려 있는 회의록의 결정 상태도 최신으로
      const m = S.messages.find(x => x.id === S.minutesOpen);
      const old = $('#modalBody .result-card');
      if (m && old) old.replaceWith(minutesBody(m));
    }
  }

  // ---- 2차 검증: 부탁한 사람의 미니미가 대화로 알려 준다
  function verifyCard(m, prev) {
    const v = m.meta || {};
    const req = S.byId[v.requester] || { name: nameOf(v.requester), color: colorOf(v.requester) };
    const sp = S.byId[v.speaker] || { name: nameOf(v.speaker) };
    const items = [
      ...(v.claims || []).map(c => {
        const [vl, vc] = VERDICT[c.verdict] || ['판정 없음', 'info'];
        return h('li', { class: vc || 'info' }, h('b', { class: 'k', text: vl }), h('span', { text: c.note || c.claim }));
      }),
      ...(v.missed || []).map(x => h('li', { class: 'warn' }, h('b', { class: 'k', text: '놓친 점' }), h('span', { text: x }))),
      v.devil ? h('li', { class: 'info' }, h('b', { class: 'k', text: '반대 관점' }), h('span', { text: v.devil.text }),
        v.devil.cite ? h('span', { class: 's', text: v.devil.cite }) : null) : null,
    ];
    const target = v.target_text || '';
    const bubble = h('div', { class: 'bubble' },
      h('p', { class: 'lead' }, `${sp.name} 님 말을 확인해 봤어요`, target ? h('span', { class: 'q', text: ` "${target.length > 40 ? `${target.slice(0, 40)}…` : target}"` }) : null),
      h('ul', { class: 'vlist' }, items),
      (v.claims || []).length ? h('details', { class: 'more' }, h('summary', { text: '자세히' }),
        h('div', { class: 'claims' }, (v.claims || []).map(claimRow)),
        h('div', { class: 'hint', text: `고칠지는 사람이 정해요 · ${engineLabel(v.engine)}` })) : null);
    return h('div', { class: `row mini verify other c${req.color || 0} first${chained(m, prev) ? ' chain' : ''}` },
      avatar(req, { mini: true }),
      h('div', { class: 'col' }, miniHead(req, '검증'),
        h('div', { class: 'line' }, bubble, h('span', { class: 'stamp', text: fmtTime(m.ts) }))));
  }
  function claimRow(c) {
    const [vl, vc] = VERDICT[c.verdict] || ['판정 없음', ''];
    const ev = (c.conflicts || []).map(x => ({ ...x, conflict: true })).concat(c.evidence || []);
    return h('div', { class: 'claim' },
      h('span', { class: `v ${vc}`, text: vl }), h('span', { class: 'c', text: c.claim }),
      c.note ? h('span', { class: 'note', text: c.note }) : null,
      h('details', {}, h('summary', { text: '논리 구조와 근거' }),
        h('dl', { class: 'toulmin' },
          h('dt', { text: '근거' }), h('dd', { class: c.grounds ? '' : 'none', text: c.grounds || '발언에 근거가 없어요' }),
          c.warrant ? [h('dt', { text: '전제' }), h('dd', { text: c.warrant })] : null,
          c.qualifier ? [h('dt', { text: '단정 표현' }), h('dd', { text: c.qualifier })] : null,
          (c.questions || []).length ? [h('dt', { text: '검증 질문' }), h('dd', { text: c.questions.join(' / ') })] : null),
        ev.map(e => h('div', { class: `ev${e.conflict ? ' conflict' : ''}` }, h('span', { class: 'lab', text: e.label }), h('span', { text: e.numeric || e.text })))));
  }

  // ---- 회의록: 도우미가 짧게 알리고, 자세한 건 창으로 연다
  function resultCard(m) {
    const x = m.meta || {};
    const st = x.stats || {};
    const row = botRow('result', [
      h('p', { text: x.summary || m.text }),
      h('div', { class: 'stats' }, h('span', {}, '발언 ', h('b', { text: st.messages || 0 })), h('span', {}, '미니미 ', h('b', { text: st.mini || 0 })),
        h('span', {}, '결정 ', h('b', { text: st.decisions || 0 })), h('span', {}, h('b', { text: `${st.minutes || 0}분` }))),
      h('div', { class: 'actions' },
        h('button', { class: 'btn sm', type: 'button', on: { click: () => openMinutes(m.id) } }, icon('doc'), '회의록 보기'),
        h('a', { class: 'btn sm ghost', href: `/api/rooms/${encodeURIComponent(S.roomId)}/minutes.md`, download: '' }, icon('download'), '내보내기')),
    ], m.ts);
    row.dataset.kind = 'result';
    return row;
  }
  function openMinutes(id) {
    const m = S.messages.find(x => x.id === id);
    if (!m) return;
    openModal({ eyebrow: '회의 도우미', title: '회의록', body: minutesBody(m), wide: true });
    S.minutesOpen = id;
  }
  function minutesBody(m) {
    const x = m.meta || {};
    return h('div', { class: 'result-card' },
      h('p', { class: 'lead-text', text: x.summary || m.text }),
      (x.issues || []).map((it, i) => {
        const d = it.decision ? liveDecision(it.decision.id, it.decision) : null;
        const s = d ? (DSTATUS[d.status] || ['', '']) : (it.status === 'untouched' ? ['미논의', 'plain'] : ['논의 중', 'info']);
        return h('div', { class: 'minutes-issue' },
          h('div', { class: 'h' }, h('span', { text: `${i + 1}. ${it.title}` }), tag(s[0], s[1])),
          (it.opinions || []).length ? h('ul', {}, it.opinions.map(o => h('li', { class: `op c${colorOf(o.uid)}` }, h('b', { text: o.who }), o.position ? ` (${o.position})` : '', ` ${o.text}`))) : null,
          (it.conflicts || []).map(c => h('div', { class: 'conf', text: `충돌 · ${c}` })),
          d ? h('div', { class: 'note-line' }, h('b', { text: '결정 ' }), d.text,
            d.status === 'pending' && (d.affected_names || []).length ? ` · ${d.affected_names.join(', ')} 확인 전` : '') : null);
      }),
      (x.questions || []).length ? h('div', { class: 'points' }, x.questions.map(q => h('div', { class: 'point' }, h('span', { class: 'k', text: `${q.who} 확인` }), h('span', { text: q.text })))) : null,
      (x.next_steps || []).length ? h('div', { class: 'points' }, x.next_steps.map(s2 => h('div', { class: 'point' }, h('span', { class: 'k', text: '다음' }), h('span', { text: s2 })))) : null,
      h('div', { class: 'modal-actions' },
        h('a', { class: 'btn', href: `/api/rooms/${encodeURIComponent(S.roomId)}/minutes.md`, download: '' }, icon('download'), '마크다운으로 내보내기')));
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
    fill($('#typing'), parts.length ? [h('span', { class: 'dots' }, h('i'), h('i'), h('i')), parts.join(' · ')] : []);
  }
  setInterval(renderTyping, 1500);

  // ================================================================ 입력창
  function renderComposerState() {
    const m = me();
    const away = !!(m && m.mini_on);
    $('#composerWrap').hidden = S.observer || away;
    $('#observerBar').hidden = !S.observer;
    const bar = $('#awayBar');
    bar.hidden = !away || S.observer;
    if (away) {
      bar.className = `away-bar c${m.color || 0}`;
      fill(bar, avatar(m, { mini: true, size: 'sm' }), h('span', { class: 't' }, h('b', { text: '미니미가 대신 참석 중이에요. ' }), '확인된 입장과 보고서에 있는 말만 해요.'),
        h('button', { class: 'btn primary sm', type: 'button', on: { click: () => toggleAway(false) } }, '돌아왔어요'));
    }
    $$('[data-act="prep"],[data-act="digest"],[data-act="agenda"]').forEach(b => { b.hidden = S.observer; });
    $('#endBtn').hidden = S.observer;
    $$('#meMenu [data-mode]').forEach(b => { b.disabled = S.observer; });
  }
  function autosize() { const t = $('#input'); t.style.height = 'auto'; t.style.height = `${Math.min(160, t.scrollHeight)}px`; }
  function sendTyping(on) {
    const now = Date.now();
    if (on && now - S.typingSent < 2500) return;
    S.typingSent = on ? now : 0;
    send({ type: 'typing', on }, true);
  }
  function setComposerMode(mode) {
    S.cmode = mode;
    $$('.composer-modes button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.cmode === mode)));
    $('#input').placeholder = mode === 'refine' ? '한 줄만 적으면 미니미가 다듬어요' : '메시지 보내기';
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
        fill(card, h('div', { class: 'head' }, h('span', { class: 'dots' }, h('i'), h('i'), h('i')), '미니미가 다듬는 중'));
      }
      return;
    }
    if (send({ type: 'message', text })) { t.value = ''; autosize(); sendTyping(false); closeMention(); }
  }
  function showRefine(d) {
    const card = $('#refineCard');
    card.hidden = false;
    const ta = h('textarea', { rows: 2, value: d.text, id: 'refineText' });
    const done = () => { card.hidden = true; $('#input').value = ''; autosize(); setComposerMode('direct'); };
    fill(card,
      h('div', { class: 'head' }, icon('wand'), '미니미가 다듬었어요 · 보내기 전에 확인해 주세요', h('span', { class: 'grow' }), h('span', { text: engineLabel(d.engine) })),
      ta,
      h('div', { class: 'hrow' },
        h('button', { class: 'btn primary sm', type: 'button', on: { click: () => { if (send({ type: 'message', text: ta.value.trim() || d.text, refined_from: d.original })) done(); } } }, '이대로 보내기'),
        h('button', { class: 'btn sm', type: 'button', on: { click: () => { if (send({ type: 'message', text: d.original })) done(); } } }, '원래 문장으로'),
        h('button', { class: 'btn ghost sm', type: 'button', on: { click: () => { card.hidden = true; } } }, '취소')));
  }
  // @호출
  function onInputMention() {
    const t = $('#input');
    const upto = t.value.slice(0, t.selectionStart);
    const m = upto.match(/@([^\s@]{0,8})$/);
    if (!m) return closeMention();
    const list = S.members.filter(x => x.user_id !== S.me && x.name.startsWith(m[1])).sort((a, b) => (b.mini_on - a.mini_on));
    if (!list.length) return closeMention();
    S.mention = { start: upto.length - m[0].length, list, sel: 0 };
    renderMention();
  }
  function renderMention() {
    const pop = $('#mentionPop');
    pop.hidden = false;
    fill(pop, S.mention.list.map((x, i) => h('button', { type: 'button', class: `${i === S.mention.sel ? 'sel' : ''} c${x.color || 0}`, on: { mousedown: e => { e.preventDefault(); pickMention(i); } } },
      avatar(x, { size: 'sm', mini: x.mini_on }), h('span', { class: 'grow' }, x.mini_on ? `${x.name}의 미니미` : x.name),
      h('span', { class: 'muted sm', text: x.mini_on ? '대리 참석' : (x.online ? '접속 중' : '') }))));
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

  // ================================================================ 머릿속
  function renderDash() { const p = panels(); p.renderGate(); p.renderEvidence(); p.renderDrift(); p.renderEngine(); }
  function setTab(tab, flash = false) {
    S.dash = tab;
    $$('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    ['gate', 'evidence', 'drift', 'engine'].forEach(t => { $(`#tab-${t}`).hidden = t !== tab; });
    if (flash) { const el = $(`#tab-${tab}`); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  }
  function showGateFor(msgId) {
    const g = S.gateByMsg.get(msgId);
    if (!g) { toast('이 판단 기록은 접속하기 전 것이라 볼 수 없어요.'); return; }
    S.selGate = g;
    panels().renderGate(); panels().renderEvidence();
    openRight(); setTab('gate', true);
  }
  function renderEnginePill() {
    const st = S.status;
    if (!st) return;
    let cls = 'rule'; let text = '규칙 대체';
    if (st.force_rule) text = '규칙 대체 (모델 끔)';
    else if (st.slow.startsWith('ollama')) { cls = 'local'; text = `로컬 ${st.slow.split(':').slice(1).join(':')}`; }
    else if (st.slow.startsWith('api')) { cls = 'api'; text = `API ${st.slow.split(':').slice(1).join(':')}`; }
    const pill = $('#enginePill');
    pill.className = `engine ${cls}`;
    $('#engineText').textContent = text;
    pill.title = `판단 ${engineLabel(st.fast)} · 작성 ${engineLabel(st.slow)} · 임베딩 ${st.embed}`;
  }

  // ================================================================ 모달 · 시트
  function openModal({ eyebrow = '', title = '', body, wide = false }) {
    $('#modalEyebrow').textContent = eyebrow;
    $('#modalTitle').textContent = title;
    $('.modal-card').classList.toggle('wide', wide);
    fill($('#modalBody'), body);
    $('#modal').hidden = false;
    dockDemo();
  }
  function closeModal() { $('#modal').hidden = true; S.digest = null; S.minutesOpen = null; dockDemo(); }
  function dockDemo() {
    // 오른쪽에 시트·모달이 열리면 시연 가이드는 왼쪽으로 비켜서 발표자가 언제든 다음 장면을 누를 수 있게 한다
    const left = !$('#sheet').hidden || !$('#modal').hidden || $('#rightPanel').classList.contains('open');
    $('#demoPanel').classList.toggle('dock-left', left);
    document.body.classList.toggle('demo-left', left && !$('#demoPanel').hidden);
  }
  function confirmModal({ eyebrow, title, body, ok = '확인', cancel = '취소', onOk, onCancel, danger = false }) {
    openModal({
      eyebrow, title, body: [typeof body === 'string' ? h('p', { class: 'lead-text', text: body }) : body,
        h('div', { class: 'modal-actions' },
          h('button', { class: 'btn', type: 'button', on: { click: () => { closeModal(); if (onCancel) onCancel(); } } }, cancel),
          h('button', { class: `btn primary${danger ? ' danger' : ''}`, type: 'button', on: { click: () => { closeModal(); if (onOk) onOk(); } } }, ok))],
    });
  }
  function openSheet(eyebrow, title) {
    $('#sheetEyebrow').textContent = eyebrow;
    $('#sheetTitle').textContent = title;
    $('#sheet').hidden = false;
    dockDemo();
  }
  function closeSheet() { $('#sheet').hidden = true; S.prep = null; dockDemo(); }

  // ================================================================ 시연 가이드
  function openDemoPanel() {
    $('#demoPanel').hidden = false;
    $('#demoPanel').classList.remove('min');
    $('#demoBtn').setAttribute('aria-pressed', 'true');
    renderDemo(); dockDemo();
  }
  function closeDemoPanel() { $('#demoPanel').hidden = true; $('#demoBtn').setAttribute('aria-pressed', 'false'); dockDemo(); }
  function onDemo(d) {
    const prev = S.demoPrev || {};
    S.demoPrev = { scene: d.scene, status: d.status };
    if (d.status === 'running' && d.scene >= 0) S.demoSel = d.scene;
    if (d.status === 'done' && prev.status !== 'done' && d.scene >= 0) S.demoSel = Math.min(d.scene + 1, (d.scenes || []).length - 1);
    renderDemo();
    if (d.status === 'running' && (prev.scene !== d.scene || prev.status !== 'running')) applyDemoFocus(d);
    if (d.status === 'done' && prev.status === 'running') {
      if (S.prep && S.prep.preview && (d.view || '').startsWith('prep:')) { S.prep.tab = 4; panels().refreshPrep(); }
      if (d.focus === 'minutes' || d.focus === 'verify') {
        const kind = d.focus === 'minutes' ? 'result' : 'verify';
        const last = [...S.messages].reverse().find(m => m.kind === kind);
        if (last) flashMsg(last.id);
      }
      if ((d.view || '').startsWith('digest:')) panels().refreshDigestPreview();
    }
    if (S.digest && S.digest.preview && d.status === 'running') panels().refreshDigestPreview();
  }
  function applyDemoFocus(d) {
    const v = d.view || '';
    if (v.startsWith('prep:')) {
      const uid = v.split(':')[1];
      panels().openPrep(uid, { tab: 1, preview: uid !== S.me });
    } else if (S.prep && S.prep.preview) closeSheet();
    if (!v.startsWith('digest:') && S.digest && S.digest.preview) closeModal();
    if (['gate', 'evidence', 'drift', 'engine'].includes(d.focus)) { setTab(d.focus, true); if (S.observer) openRight(); }
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
    if ($('#demoPanel').hidden || !d) return;
    const scenes = d.scenes || [];
    const sel = clip(S.demoSel, 0, scenes.length - 1);
    const sc = scenes[sel] || {};
    const running = d.status === 'running';
    const done = d.done || [];
    fill($('#demoSteps'), scenes.map((s, i) => h('li', {}, h('button', {
      type: 'button', class: done.includes(i) ? 'done' : '', 'aria-current': String(i === sel), title: `${i}. ${s.title}`, 'aria-label': `${i}. ${s.title}`,
      on: { click: () => { S.demoSel = i; renderDemo(); } },
    }))));
    $('#demoMetric').textContent = `장면 ${sel} / ${scenes.length - 1} · ${sc.metric || ''}`;
    $('#demoTitle').textContent = sc.title || '';
    $('#demoNarration').textContent = sc.narration || '';
    const st = $('#demoStatus');
    st.className = `demo-status${running ? ' running' : ''}`;
    if (running) fill(st, h('span', { class: 'dots' }, h('i'), h('i'), h('i')), d.scene === sel ? (d.step || '실행 중') : `장면 ${d.scene} 실행 중`);
    else if (d.status === 'error') fill(st, icon('alert', 'xs'), d.step || '오류가 났어요');
    else if (done.includes(sel)) fill(st, icon('check', 'xs'), '실행했어요');
    else fill(st, sel === 0 ? '0번부터 시작하면 방이 시연 상태로 바뀌어요' : '실행하면 모든 접속자 화면이 같이 움직여요');
    $('#demoRun').disabled = running;
    $('#demoNext').disabled = running || sel >= scenes.length - 1;
    $('#demoAuto').textContent = running && d.auto ? '멈추기' : '자동 재생';
    $('#demoAuto').disabled = running && !d.auto;
    if (running) $('#demoSpeed').value = String(d.speed || 1);
  }
  async function demoRun(scene, auto = false) {
    const go = async () => {
      try { S.demo = await api('POST', `/api/demo/${encodeURIComponent(S.roomId)}/run`, { scene, auto, speed: Number($('#demoSpeed').value) }); S.demoSel = scene; renderDemo(); } catch (e) { toast(e.message, 'bad'); }
    };
    if (scene === 0 && S.messages.length) {
      confirmModal({ eyebrow: '시연', title: '방을 시연 시작 상태로 되돌릴까요?', body: '지금 방의 대화·결정·준비 내용이 지워지고 시연 시나리오로 다시 채워져요.', ok: '되돌리고 시작', onOk: go });
      return;
    }
    if (scene > 0 && S.demo && !(S.demo.done || []).length) {
      confirmModal({ eyebrow: '시연', title: '0번 장면부터 할까요?', body: '장면은 앞 장면의 결과를 이어 받아요. 처음이면 0번부터 실행하는 게 안전해요.', ok: '이 장면만 실행', onOk: go });
      return;
    }
    await go();
  }

  // ================================================================ 반응형 패널
  function openLeft() { $('#leftPanel').classList.add('open'); scrim(true); setNav('left'); }
  function openRight() { $('#rightPanel').classList.add('open'); scrim(true); setNav('right'); dockDemo(); }
  function closePanels() { $('#leftPanel').classList.remove('open'); $('#rightPanel').classList.remove('open'); scrim(false); setNav('chat'); dockDemo(); }
  function scrim(on) { $('#scrim').hidden = !on; $('#scrim').classList.toggle('on', on); }
  function setNav(k) { $$('#bottomNav button').forEach(b => b.setAttribute('aria-current', String(b.dataset.nav === k))); }
  function leave() {
    store.del('mymini.session');
    const url = new URL(location.href); url.searchParams.set('lobby', '1'); history.replaceState(null, '', url);
    showLobby(S.roomId);
  }
  function closeMenus(except) { ['#meMenu'].forEach(id => { if (id !== except) $(id).hidden = true; }); }

  // ================================================================ 정적 바인딩
  function bindStatic() {
    $('#roomForm').addEventListener('submit', e => { e.preventDefault(); const v = $('#roomInput').value.trim(); if (v) loadLobbyRoom(v); });
    $('#newMemberForm').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.currentTarget; const room = $('#lobbyRoom').dataset.room;
      try {
        const m = await api('POST', `/api/rooms/${encodeURIComponent(room)}/members`, { name: f.name.value, role: f.role.value });
        f.reset(); join(room, m.user_id, false);
        toast(`${m.name} 님, 환영해요. 먼저 내 미니미를 준비해 보세요.`);
        setTimeout(() => panels().openPrep(m.user_id, { tab: 0 }), 600);
      } catch (err) { toast(err.message, 'bad'); }
    });
    $('#observeBtn').addEventListener('click', () => join($('#lobbyRoom').dataset.room, null, true));
    $('#newRoomForm').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.currentTarget;
      const issues = f.issues.value.split('\n').map(s => s.trim()).filter(Boolean).map(line => {
        const [t, opts] = line.split(/[:：]/);
        return { title: t.trim(), options: opts ? opts.split(/[,，/]/).map(s => s.trim()).filter(Boolean) : [] };
      });
      try {
        await api('POST', '/api/rooms', { room_id: f.room_id.value.trim(), title: f.title.value, agenda: f.agenda.value, issues, seed: f.seed.checked });
        const id = f.room_id.value.trim();
        $('#roomInput').value = id; loadLobbyRoom(id); f.reset(); f.closest('details').open = false;
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
      setComposerMode(b.dataset.cmode === 'refine' && S.cmode === 'refine' ? 'direct' : b.dataset.cmode);
      input.focus();
    }));

    $$('#meMenu [data-mode]').forEach(b => b.addEventListener('click', () => { $('#meMenu').hidden = true; send({ type: 'mode', mode: b.dataset.mode }); }));
    $$('.tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
    const eng = $('#enginePill');
    eng.addEventListener('click', () => { setTab('engine', true); openRight(); });
    eng.addEventListener('keydown', e => { if (e.key === 'Enter') { setTab('engine', true); openRight(); } });
    $('#inviteBtn').addEventListener('click', () => panels().openInvite());
    $('#endBtn').addEventListener('click', () => {
      $('#meMenu').hidden = true;
      if (S.room && S.room.meeting && S.room.meeting.status === 'ended') {
        confirmModal({ eyebrow: '새 회의', title: '다음 회의를 시작할까요?', body: '안건과 쟁점, 결정 기록은 그대로 이어져요. 지난 회의록은 대화에 남아 있어요.', ok: '시작하기', onOk: () => send({ type: 'start_meeting' }) });
        return;
      }
      confirmModal({ eyebrow: '회의 종료', title: '회의를 끝내고 회의록을 만들까요?', body: '쟁점별 의견과 결정 상태가 정리돼요. 보류된 결정은 불참자가 확인할 때까지 남아요.', ok: '끝내고 정리', onOk: () => send({ type: 'end_meeting' }) });
    });
    $('#themeBtn').addEventListener('click', () => {
      const cur = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = cur; store.set('mymini.theme', cur); $('#meMenu').hidden = true;
    });
    $('#meBtn').addEventListener('click', e => { e.stopPropagation(); closeMenus('#meMenu'); $('#meMenu').hidden = !$('#meMenu').hidden; });
    document.addEventListener('click', e => {
      if (!e.target.closest('.pop-wrap')) closeMenus();
      if (!$('#popover').hidden && !e.target.closest('.popover') && !e.target.closest('.cite')) $('#popover').hidden = true;
      const b = e.target.closest('[data-act]');
      if (!b) return;
      closeMenus();
      const act = b.dataset.act;
      if (act === 'prep') panels().openPrep(S.me);
      else if (act === 'digest') { if (send({ type: 'digest' })) setTimeout(() => { if (!S.digest) toast('아직 기록이 없어요. 자리 비움을 켰다가 돌아오면 생겨요.'); }, 700); }
      else if (act === 'agenda') { if (S.observer) toast('발표 화면에서는 안건을 바꿀 수 없어요.'); else panels().openAgenda(); }
      else if (act === 'leave') leave();
    });
    $('#modal').addEventListener('click', e => { if (e.target.closest('[data-close]')) closeModal(); });
    $('#sheet').addEventListener('click', e => { if (e.target.closest('[data-sclose]')) closeSheet(); });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (!$('#popover').hidden) { $('#popover').hidden = true; return; }
      if (!$('#modal').hidden) { closeModal(); return; }
      if (!$('#sheet').hidden) { closeSheet(); return; }
      closeMenus(); closePanels();
    });
    $('#openLeft').addEventListener('click', openLeft);
    $('#brainBtn').addEventListener('click', () => { if ($('#rightPanel').classList.contains('open')) closePanels(); else { renderDash(); openRight(); } });
    $('#closeRight').addEventListener('click', closePanels);
    $('#scrim').addEventListener('click', closePanels);
    $$('#bottomNav button').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.nav;
      closePanels();
      if (k === 'left') openLeft();
      else if (k === 'right') { renderDash(); openRight(); }
      else if (k === 'prep') { if (S.observer) toast('발표 화면에는 내 미니미가 없어요.'); else panels().openPrep(S.me); }
    }));

    $('#demoBtn').addEventListener('click', () => { if ($('#demoPanel').hidden) openDemoPanel(); else closeDemoPanel(); });
    $('#demoClose').addEventListener('click', closeDemoPanel);
    $('#demoMin').addEventListener('click', () => $('#demoPanel').classList.toggle('min'));
    $('#demoRun').addEventListener('click', () => demoRun(S.demoSel));
    $('#demoNext').addEventListener('click', () => { S.demoSel = Math.min(S.demoSel + 1, ((S.demo && S.demo.scenes) || []).length - 1); demoRun(S.demoSel); });
    $('#demoAuto').addEventListener('click', async () => {
      if (S.demo && S.demo.status === 'running' && S.demo.auto) { try { S.demo = await api('POST', `/api/demo/${encodeURIComponent(S.roomId)}/stop`); renderDemo(); } catch (e) { toast(e.message, 'bad'); } return; }
      demoRun(S.demoSel, true);
    });
    $('#demoRestart').addEventListener('click', () => { S.demoSel = 0; demoRun(0); });
    addEventListener('resize', () => { if (innerWidth > 900 && $('#leftPanel').classList.contains('open')) closePanels(); });
  }

  init();
})();
