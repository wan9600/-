'use strict';

/* =========================================================
 * 고연전 티켓 장터
 * 서버 없이 동작하는 정적 웹앱. 모든 데이터는 브라우저 localStorage 에 저장된다.
 * 실제 서비스로 운영하려면 Store 영역(load/save)을 서버 API 로 교체하면 된다.
 * ========================================================= */

/* ---------- 설정 ---------- */
const CONFIG = {
    maxPriceRatio: 1.0,      // 정가 대비 허용 최대 가격 (1.0 = 정가 초과 금지)
    maxQty: 4,               // 글 하나당 최대 매수
    maxImages: 3,            // 첨부 이미지 최대 개수
    bumpCooldownMin: 60,     // 끌어올리기 간격(분)
    eventStart: null,        // 'YYYY-MM-DD' 로 지정하면 상단에 D-day 가 표시된다
};

const SPORTS = [
    { id: 'baseball',   name: '야구',       emoji: '⚾' },
    { id: 'hockey',     name: '아이스하키', emoji: '🏒' },
    { id: 'basketball', name: '농구',       emoji: '🏀' },
    { id: 'rugby',      name: '럭비',       emoji: '🏉' },
    { id: 'soccer',     name: '축구',       emoji: '⚽' },
    { id: 'package',    name: '패키지/기타', emoji: '🎟️' },
];
const SEATS = { ku: '고려대 응원석', yu: '연세대 응원석', general: '일반석', etc: '기타' };
const METHODS = { meet: '직거래', transfer: '모바일 양도', delivery: '택배' };
const STATUS = { open: '거래가능', reserved: '예약중', done: '거래완료' };
const SCHOOLS = { KU: '고려대', YU: '연세대', ETC: '기타' };
const REPORT_REASONS = ['사기 의심', '정가 초과(암표)', '허위 매물', '욕설/비매너', '개인정보 노출', '기타'];
const QUICK_REPLIES = ['아직 거래 가능한가요?', '직거래 장소 조율 가능할까요?', '좌석 위치 알 수 있을까요?', '예약 부탁드려요!'];
const SCAM_PATTERN = /(\d{2,6}-\d{2,6}-\d{2,8})|계좌|선입금|입금\s*먼저|카톡\s*아이디|오픈\s*채팅|문화상품권/;

const DATA_KEY = 'kyt-data-v1';
const SESSION_KEY = 'kyt-session-v1';

/* ---------- 유틸 ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const now = () => Date.now();

function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function won(n) { return Number(n || 0).toLocaleString('ko-KR') + '원'; }
function sportOf(id) { return SPORTS.find(s => s.id === id) || SPORTS[SPORTS.length - 1]; }
function fmtDate(d) {
    if (!d) return '날짜 미정';
    const dt = new Date(d + 'T00:00:00');
    if (isNaN(dt)) return esc(d);
    return `${dt.getMonth() + 1}.${dt.getDate()}(${'일월화수목금토'[dt.getDay()]})`;
}
function fmtDateTime(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function fmtTime(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function timeAgo(ts) {
    const s = Math.floor((now() - ts) / 1000);
    if (s < 60) return '방금 전';
    if (s < 3600) return `${Math.floor(s / 60)}분 전`;
    if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
    if (s < 86400 * 7) return `${Math.floor(s / 86400)}일 전`;
    const d = new Date(ts);
    return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}
function dateAfter(days) {
    const d = new Date(now() + days * 86400000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function starText(r) { const n = Math.round(r); return '★'.repeat(n) + '☆'.repeat(5 - n); }
function safeImg(src) { return typeof src === 'string' && src.startsWith('data:image/') ? src : ''; }

async function hashPw(pw, salt) {
    const text = salt + ':' + pw;
    if (window.crypto && crypto.subtle) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    // crypto.subtle 을 쓸 수 없는 환경(비보안 컨텍스트)용 대체 해시
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < text.length; i++) {
        h1 = Math.imul(h1 ^ text.charCodeAt(i), 16777619);
        h2 = Math.imul(h2 + text.charCodeAt(i), 2246822519);
    }
    return 'f' + (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
}

function resizeImage(file, max = 1000) {
    return new Promise((resolve, reject) => {
        if (!file.type.startsWith('image/')) return reject(new Error('이미지 파일만 올릴 수 있어요.'));
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const scale = Math.min(1, max / Math.max(img.width, img.height));
            const c = document.createElement('canvas');
            c.width = Math.round(img.width * scale);
            c.height = Math.round(img.height * scale);
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            URL.revokeObjectURL(url);
            resolve(c.toDataURL('image/jpeg', 0.72));
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 읽을 수 없어요.')); };
        img.src = url;
    });
}

/* ---------- 저장소 ---------- */
let db = null;

function blankDb() {
    return { users: [], posts: [], favs: {}, chats: [], reviews: [], reports: [], notifs: [] };
}
function loadDb() {
    try { db = JSON.parse(localStorage.getItem(DATA_KEY)); } catch { db = null; }
    if (!db || !Array.isArray(db.users)) return false;
    db = Object.assign(blankDb(), db);
    return true;
}
function save() {
    try {
        localStorage.setItem(DATA_KEY, JSON.stringify(db));
        return true;
    } catch {
        toast('저장 공간이 부족해요. 이미지 수를 줄이거나 오래된 글을 정리해 주세요.');
        return false;
    }
}

function sessionId() { try { return localStorage.getItem(SESSION_KEY); } catch { return null; } }
function setSession(id) { try { id ? localStorage.setItem(SESSION_KEY, id) : localStorage.removeItem(SESSION_KEY); } catch { /* 무시 */ } }

function me() {
    const id = sessionId();
    const u = id && db.users.find(x => x.id === id);
    return u && !u.banned ? u : null;
}
const isAdmin = () => me()?.role === 'admin';
const userById = id => db.users.find(u => u.id === id);
const postById = id => db.posts.find(p => p.id === id);
const chatById = id => db.chats.find(c => c.id === id);
const favsOf = userId => (db.favs[userId] ||= []);
const isFav = (userId, postId) => (db.favs[userId] || []).includes(postId);
const favCount = postId => Object.values(db.favs).filter(list => list.includes(postId)).length;
const chatsForPost = postId => db.chats.filter(c => c.postId === postId);
const chatsOf = userId => db.chats.filter(c => c.ownerId === userId || c.otherId === userId);
const partnerOf = (chat, userId) => (chat.ownerId === userId ? chat.otherId : chat.ownerId);
const unreadIn = (chat, userId) => chat.messages.filter(m => m.from !== userId && m.from !== 'system' && m.at > (chat.lastRead[userId] || 0)).length;
const totalUnread = userId => chatsOf(userId).reduce((n, c) => n + unreadIn(c, userId), 0);
const lastActivity = c => (c.messages.length ? c.messages[c.messages.length - 1].at : c.createdAt);

function ratingOf(userId) {
    const rs = db.reviews.filter(r => r.to === userId);
    const avg = rs.length ? rs.reduce((s, r) => s + r.rating, 0) / rs.length : 0;
    return { avg, count: rs.length };
}
function tradesOf(userId) {
    return db.posts.filter(p => p.status === 'done' && (p.authorId === userId || p.partnerId === userId));
}
function visiblePost(p) {
    const author = userById(p.authorId);
    return p && !p.hidden && author && !author.banned;
}
function notify(userId, text, link) {
    if (!userId) return;
    db.notifs.push({ id: uid(), userId, text, link, at: now(), read: false });
    // 사용자별 최근 100개만 유지
    const mine = db.notifs.filter(n => n.userId === userId);
    if (mine.length > 100) {
        const drop = new Set(mine.slice(0, mine.length - 100).map(n => n.id));
        db.notifs = db.notifs.filter(n => !drop.has(n.id));
    }
}
function systemMessage(chat, text) {
    if (chat) chat.messages.push({ id: uid(), from: 'system', text, at: now() });
}

/* ---------- 초기 예시 데이터 ---------- */
async function seed() {
    db = blankDb();
    const mk = async (loginId, pw, nickname, school, year, role = 'user') => {
        const salt = uid();
        const u = { id: uid(), loginId, salt, pwHash: await hashPw(pw, salt), nickname, school, year, role, createdAt: now() - 86400000 * 20 };
        db.users.push(u);
        return u;
    };
    const admin = await mk('admin', 'admin1234', '운영자', 'ETC', '', 'admin');
    const tiger = await mk('tiger24', 'demo1234', '호랑이24', 'KU', '24');
    const eagle = await mk('eagle23', 'demo1234', '독수리23', 'YU', '23');
    const crimson = await mk('crimson', 'demo1234', '크림슨', 'KU', '22');
    const blue = await mk('blueblue', 'demo1234', '연고블루', 'YU', '25');
    void admin;

    const day1 = dateAfter(14), day2 = dateAfter(15);
    const H = 3600000;
    const mkPost = (author, o, ago) => {
        const t = now() - ago * H;
        const p = Object.assign({
            id: uid(), authorId: author.id, kind: 'sell', sport: 'baseball', eventDate: day1, seat: 'ku',
            qty: 1, price: 0, faceValue: 0, methods: ['meet'], place: '', title: '', desc: '', images: [],
            status: 'open', partnerId: null, hidden: false, views: Math.floor(Math.random() * 60) + 5,
            createdAt: t, updatedAt: t, bumpedAt: t,
        }, o);
        db.posts.push(p);
        return p;
    };
    const p1 = mkPost(tiger, { sport: 'hockey', seat: 'ku', qty: 2, price: 10000, faceValue: 10000, methods: ['meet', 'transfer'], place: '안암역 2번 출구', title: '아이스하키 고대 응원석 2매 정가 양도', desc: '일정이 생겨서 못 가게 됐어요.\n연석이고 모바일 양도 또는 안암역 직거래 가능합니다.' }, 2);
    mkPost(eagle, { sport: 'basketball', eventDate: day1, seat: 'yu', qty: 1, price: 8000, faceValue: 10000, methods: ['transfer'], title: '농구 연대 응원석 1매 (정가보다 저렴하게)', desc: '급하게 양도합니다. 모바일 양도만 가능해요.' }, 5);
    mkPost(crimson, { kind: 'buy', sport: 'rugby', eventDate: day2, seat: 'ku', qty: 2, price: 10000, faceValue: 10000, methods: ['meet', 'transfer'], place: '고려대 정문', title: '럭비 고대 응원석 2매 구해요 🙏', desc: '친구랑 같이 가려고 합니다. 정가로 구매 원해요!' }, 7);
    const p4 = mkPost(blue, { sport: 'soccer', eventDate: day2, seat: 'general', qty: 1, price: 10000, faceValue: 10000, methods: ['meet'], place: '신촌역', title: '축구 일반석 1매 양도합니다', desc: '신촌역 근처 직거래 원해요.', status: 'reserved', partnerId: tiger.id }, 20);
    const p5 = mkPost(tiger, { sport: 'baseball', eventDate: day1, seat: 'ku', qty: 1, price: 9000, faceValue: 10000, methods: ['transfer'], title: '야구 고대 응원석 1매', desc: '거래 완료되었습니다. 감사합니다!', status: 'done', partnerId: crimson.id }, 48);
    mkPost(eagle, { kind: 'buy', sport: 'package', eventDate: day1, seat: 'yu', qty: 1, price: 40000, faceValue: 50000, methods: ['transfer', 'meet'], title: '정기전 전 종목 패키지 구합니다', desc: '전 종목 패키지 있으신 분 연락 주세요. 가격 조율 가능해요.' }, 30);
    mkPost(crimson, { sport: 'basketball', eventDate: day1, seat: 'ku', qty: 3, price: 10000, faceValue: 10000, methods: ['meet', 'delivery'], place: '안암 참살이길', title: '농구 고대 응원석 3매 (분할 가능)', desc: '1매씩도 판매 가능합니다.' }, 1);

    const c1 = { id: uid(), postId: p1.id, ownerId: tiger.id, otherId: blue.id, createdAt: now() - 1.5 * H, lastRead: {}, messages: [
        { id: uid(), from: blue.id, text: '안녕하세요! 아직 거래 가능한가요?', at: now() - 1.5 * H },
        { id: uid(), from: tiger.id, text: '네 가능합니다 😊 직거래 원하시나요?', at: now() - 1.4 * H },
        { id: uid(), from: blue.id, text: '모바일 양도로 부탁드려도 될까요?', at: now() - 1.2 * H },
    ] };
    c1.lastRead[blue.id] = now() - 1.2 * H;
    const c2 = { id: uid(), postId: p4.id, ownerId: blue.id, otherId: tiger.id, createdAt: now() - 19 * H, lastRead: {}, messages: [
        { id: uid(), from: tiger.id, text: '축구 표 구매하고 싶어요!', at: now() - 19 * H },
        { id: uid(), from: blue.id, text: '좋아요, 경기 전날 신촌역에서 뵐까요?', at: now() - 18 * H },
        { id: uid(), from: 'system', text: '판매자가 거래를 예약중으로 변경했어요.', at: now() - 18 * H },
    ] };
    c2.lastRead[tiger.id] = now(); c2.lastRead[blue.id] = now();
    const c3 = { id: uid(), postId: p5.id, ownerId: tiger.id, otherId: crimson.id, createdAt: now() - 47 * H, lastRead: {}, messages: [
        { id: uid(), from: crimson.id, text: '야구 표 구매할게요!', at: now() - 47 * H },
        { id: uid(), from: 'system', text: '거래가 완료되었어요. 서로 후기를 남겨주세요.', at: now() - 40 * H },
    ] };
    c3.lastRead[tiger.id] = now(); c3.lastRead[crimson.id] = now();
    db.chats.push(c1, c2, c3);

    db.reviews.push({ id: uid(), postId: p5.id, from: crimson.id, to: tiger.id, rating: 5, text: '양도 빠르고 친절하셨어요!', at: now() - 39 * H });
    db.favs[blue.id] = [p1.id];
    db.favs[crimson.id] = [p1.id];
    save();
}

/* ---------- 라우팅 ---------- */
const ROUTES = [
    ['/', viewList],
    ['/post/:id', viewPost],
    ['/new', viewForm, { auth: true }],
    ['/edit/:id', viewForm, { auth: true }],
    ['/chats', viewChats, { auth: true }],
    ['/chat/:id', viewChat, { auth: true }],
    ['/me', viewMe, { auth: true }],
    ['/me/:tab', viewMe, { auth: true }],
    ['/user/:id', viewUser],
    ['/notifs', viewNotifs, { auth: true }],
    ['/admin', viewAdmin, { auth: true, admin: true }],
    ['/guide', viewGuide],
    ['/login', viewLogin],
    ['/signup', viewSignup],
];
const FORM_VIEWS = new Set([viewForm, viewLogin, viewSignup]);

function parseHash() {
    const raw = location.hash.replace(/^#/, '') || '/';
    const [path, qs] = raw.split('?');
    return { path: path || '/', query: new URLSearchParams(qs || '') };
}
function matchRoute(path) {
    const sp = path.split('/');
    for (const [pat, view, opt = {}] of ROUTES) {
        const pp = pat.split('/');
        if (pp.length !== sp.length) continue;
        const params = [];
        let ok = true;
        for (let i = 0; i < pp.length; i++) {
            if (pp[i].startsWith(':')) params.push(decodeURIComponent(sp[i]));
            else if (pp[i] !== sp[i]) { ok = false; break; }
        }
        if (ok) return { view, params, opt };
    }
    return { view: viewNotFound, params: [], opt: {} };
}
function go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
}
function requireLogin() {
    toast('로그인이 필요해요.');
    go('#/login?next=' + encodeURIComponent(location.hash || '#/'));
}

let current = { view: null, params: [] };
let afterRender = null;

function render(soft = false) {
    renderHeader();
    const { path, query } = parseHash();
    const { view, params, opt } = matchRoute(path);
    const u = me();
    if (opt.auth && !u) { requireLogin(); return; }
    if (opt.admin && !isAdmin()) { current = { view: viewNotFound, params: [] }; $('#app').innerHTML = viewNotFound(); return; }

    // 다른 탭에서 데이터가 바뀌었을 때 작성 중인 폼은 덮어쓰지 않는다
    if (soft && (FORM_VIEWS.has(view) || (view === viewMe && params[0] === 'settings'))) return;
    const keepForm = $('#app form[data-keep]');
    if (soft && keepForm && (keepForm.contains(document.activeElement) || [...keepForm.querySelectorAll('textarea')].some(t => t.value))) return;

    let keep = null;
    const active = document.activeElement;
    if (soft && active && active.id && 'value' in active) {
        keep = { id: active.id, value: active.value, pos: active.selectionStart };
    }

    current = { view, params, query };
    afterRender = null;
    $('#app').innerHTML = view(...params);
    document.title = (view.title ? view.title + ' · ' : '') + '고연전 티켓 장터';

    if (keep) {
        const el = document.getElementById(keep.id);
        if (el) {
            el.value = keep.value;
            el.focus();
            try { el.setSelectionRange(keep.pos, keep.pos); } catch { /* select 등 */ }
        }
    }
    if (!soft) window.scrollTo(0, 0);
    renderHeader();
    if (afterRender) afterRender();
}

function renderHeader() {
    const u = me();
    const unread = u ? totalUnread(u.id) : 0;
    const notifs = u ? db.notifs.filter(n => n.userId === u.id && !n.read).length : 0;
    const badge = n => (n ? `<span class="count-badge">${n > 99 ? '99+' : n}</span>` : '');
    const path = parseHash().path;
    const on = p => (path === p || (p !== '/' && path.startsWith(p)) ? ' active' : '');
    $('#topbar').innerHTML = `
        <a class="brand" href="#/"><span class="brand-mark">🐯🦅</span><span class="brand-name"><span class="ku">고연전</span> <span class="yu">티켓 장터</span></span></a>
        <nav class="nav">
            <a href="#/" class="nav-link${on('/')}">거래글</a>
            <a href="#/guide" class="nav-link nav-hide-sm${on('/guide')}">이용안내</a>
            ${u ? `
                ${u.role === 'admin' ? `<a href="#/admin" class="nav-link${on('/admin')}">관리</a>` : ''}
                <a href="#/chats" class="icon-btn" title="채팅" aria-label="채팅 ${unread}개 안 읽음">💬${badge(unread)}</a>
                <a href="#/notifs" class="icon-btn" title="알림" aria-label="알림 ${notifs}개">🔔${badge(notifs)}</a>
                <a href="#/me" class="icon-btn" title="${esc(u.nickname)}" aria-label="내 정보">👤</a>
                <a href="#/new" class="btn btn-primary btn-sm">글쓰기</a>
            ` : `
                <a href="#/login" class="nav-link">로그인</a>
                <a href="#/signup" class="btn btn-primary btn-sm">회원가입</a>
            `}
        </nav>`;
}

/* ---------- 공용 조각 ---------- */
function schoolBadge(u) {
    const s = u?.school || 'ETC';
    return `<span class="school school-${s}">${SCHOOLS[s] || '기타'}${u?.year ? ' ' + esc(u.year) : ''}</span>`;
}
function avatar(u) {
    const s = u?.school || 'ETC';
    return `<div class="avatar avatar-${s}">${esc((u?.nickname || '?').slice(0, 1))}</div>`;
}
function statusBadge(p) { return `<span class="badge status-${p.status}">${STATUS[p.status]}</span>`; }
function kindBadge(p) { return `<span class="badge kind-${p.kind}">${p.kind === 'sell' ? '팝니다' : '삽니다'}</span>`; }
function discountTag(p) {
    if (!p.faceValue || p.price >= p.faceValue) return '';
    return `<span class="discount">정가 대비 ${Math.round((1 - p.price / p.faceValue) * 100)}%↓</span>`;
}
function emptyState(icon, text, action = '') {
    return `<div class="empty card"><div class="big">${icon}</div><div>${text}</div>${action ? `<div style="margin-top:14px">${action}</div>` : ''}</div>`;
}

function postCard(p) {
    const sp = sportOf(p.sport);
    const author = userById(p.authorId);
    const chats = chatsForPost(p.id).filter(c => c.messages.length).length;
    return `
    <a class="card post-card ${p.status}" href="#/post/${p.id}">
        <div class="pc-top">${kindBadge(p)} ${statusBadge(p)} ${p.hidden ? '<span class="badge badge-hidden">숨김</span>' : ''}${p.images?.length ? `<span class="pc-thumb">📷 ${p.images.length}</span>` : ''}</div>
        <div class="pc-sport">${sp.emoji} ${sp.name} · ${fmtDate(p.eventDate)}</div>
        <h3 class="pc-title">${esc(p.title)}</h3>
        <div class="pc-meta">${SEATS[p.seat] || '기타'} · ${p.qty}매 · ${(p.methods || []).map(m => METHODS[m]).join('/')}</div>
        <div class="pc-price"><span class="price">${won(p.price)}</span><span class="muted small">/ 1매</span>${discountTag(p)}</div>
        <div class="pc-foot">${schoolBadge(author)} ${esc(author?.nickname || '탈퇴한 사용자')} · ${timeAgo(p.bumpedAt || p.createdAt)}
            <span class="pc-counts">♡ ${favCount(p.id)} · 💬 ${chats}</span></div>
    </a>`;
}

/* ---------- 목록 ---------- */
const filters = { kind: 'all', sport: 'all', q: '', sort: 'recent', openOnly: true };

function filteredPosts() {
    const q = filters.q.trim().toLowerCase();
    let list = db.posts.filter(visiblePost);
    if (filters.kind !== 'all') list = list.filter(p => p.kind === filters.kind);
    if (filters.sport !== 'all') list = list.filter(p => p.sport === filters.sport);
    if (filters.openOnly) list = list.filter(p => p.status !== 'done');
    if (q) {
        list = list.filter(p => {
            const hay = [p.title, p.desc, p.place, SEATS[p.seat], sportOf(p.sport).name, userById(p.authorId)?.nickname].join(' ').toLowerCase();
            return hay.includes(q);
        });
    }
    const sorters = {
        recent: (a, b) => (b.bumpedAt || b.createdAt) - (a.bumpedAt || a.createdAt),
        priceAsc: (a, b) => a.price - b.price,
        priceDesc: (a, b) => b.price - a.price,
        popular: (a, b) => favCount(b.id) - favCount(a.id) || b.views - a.views,
        date: (a, b) => String(a.eventDate).localeCompare(String(b.eventDate)),
    };
    return list.sort(sorters[filters.sort] || sorters.recent);
}

function resultsHTML() {
    const list = filteredPosts();
    if (!list.length) {
        return emptyState('🎫', '조건에 맞는 거래글이 없어요.', me() ? '<a class="btn btn-primary" href="#/new">첫 글 올리기</a>' : '');
    }
    return `<div class="result-bar"><span class="muted">${list.length}개의 거래글</span></div>
        <div class="post-grid">${list.map(postCard).join('')}</div>`;
}

function viewList() {
    const live = db.posts.filter(visiblePost);
    const openSell = live.filter(p => p.kind === 'sell' && p.status === 'open').length;
    const openBuy = live.filter(p => p.kind === 'buy' && p.status === 'open').length;
    const done = live.filter(p => p.status === 'done').length;
    const countFor = id => live.filter(p => p.status !== 'done' && (id === 'all' || p.sport === id)).length;

    let dday = '';
    if (CONFIG.eventStart) {
        const diff = Math.ceil((new Date(CONFIG.eventStart + 'T00:00:00') - new Date(new Date().toDateString())) / 86400000);
        dday = `<div class="hero-dday">${diff > 0 ? 'D-' + diff : diff === 0 ? 'D-DAY' : '경기 종료'}</div>`;
    }

    return `
    <section class="hero">
        ${dday}
        <h1>고연전 티켓, 정가로 안전하게</h1>
        <p>고려대·연세대 학생들이 직접 올리는 양도·구매 글. 정가를 넘는 가격(암표)은 등록할 수 없고, 채팅으로 바로 거래할 수 있어요.</p>
        <div class="hero-stats">
            <div class="hero-stat"><b>${openSell}</b>양도 중</div>
            <div class="hero-stat"><b>${openBuy}</b>구매 희망</div>
            <div class="hero-stat"><b>${done}</b>거래 완료</div>
        </div>
    </section>

    <section class="filters">
        <div class="seg" role="tablist">
            ${[['all', '전체'], ['sell', '팝니다'], ['buy', '삽니다']].map(([v, l]) =>
                `<button role="tab" class="${filters.kind === v ? 'on' : ''}" data-act="setKind" data-v="${v}">${l}</button>`).join('')}
        </div>
        <div class="chips">
            <button class="chip ${filters.sport === 'all' ? 'on' : ''}" data-act="setSport" data-v="all">전체<span class="n">${countFor('all')}</span></button>
            ${SPORTS.map(s => `<button class="chip ${filters.sport === s.id ? 'on' : ''}" data-act="setSport" data-v="${s.id}">${s.emoji} ${s.name}<span class="n">${countFor(s.id)}</span></button>`).join('')}
        </div>
        <div class="filter-row">
            <input type="search" class="input" id="q" data-filter="q" placeholder="제목, 좌석, 장소, 닉네임 검색" value="${esc(filters.q)}">
            <select class="input" style="width:auto" id="sort" data-filter="sort" aria-label="정렬">
                ${[['recent', '최신순'], ['priceAsc', '낮은 가격순'], ['priceDesc', '높은 가격순'], ['popular', '인기순'], ['date', '경기일 빠른순']].map(([v, l]) =>
                    `<option value="${v}" ${filters.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
            <label class="check"><input type="checkbox" id="openOnly" data-filter="openOnly" ${filters.openOnly ? 'checked' : ''}> 완료된 거래 숨기기</label>
        </div>
    </section>

    <section id="results">${resultsHTML()}</section>`;
}

/* ---------- 상세 ---------- */
function viewPost(id) {
    const p = postById(id);
    const u = me();
    if (!p) return viewNotFound('삭제되었거나 존재하지 않는 글이에요.');
    const isOwner = u && u.id === p.authorId;
    if (!visiblePost(p) && !isOwner && !isAdmin()) return viewNotFound('운영 정책에 따라 숨겨진 글이에요.');

    // 조회수: 탭당 1회
    try {
        const k = 'kyt-viewed-' + p.id;
        if (!sessionStorage.getItem(k) && !isOwner) { sessionStorage.setItem(k, '1'); p.views = (p.views || 0) + 1; save(); }
    } catch { /* 무시 */ }

    viewPost.title = p.title;
    const sp = sportOf(p.sport);
    const author = userById(p.authorId);
    const rating = ratingOf(p.authorId);
    const myChat = u && !isOwner ? db.chats.find(c => c.postId === p.id && c.otherId === u.id) : null;
    const fav = u && isFav(u.id, p.id);
    const partner = p.partnerId ? userById(p.partnerId) : null;
    const chats = chatsForPost(p.id).filter(c => c.messages.length);
    const postReviews = db.reviews.filter(r => r.postId === p.id);
    const canReview = u && p.status === 'done' && p.partnerId && (u.id === p.authorId || u.id === p.partnerId)
        && !postReviews.some(r => r.from === u.id);
    const counterpartLabel = p.kind === 'sell' ? '구매자' : '판매자';

    const similar = db.posts.filter(x => x.id !== p.id && visiblePost(x) && x.sport === p.sport && x.status !== 'done').slice(0, 3);

    let actions = '';
    if (isOwner) {
        actions = `<a class="btn btn-block" href="#/chats">💬 받은 채팅 ${chats.length}개 보기</a>`;
    } else if (p.status === 'done') {
        actions = `<button class="btn btn-block" disabled>거래가 완료된 글이에요</button>`;
    } else {
        actions = `
            <button class="btn btn-primary btn-block" data-act="startChat" data-id="${p.id}">💬 ${myChat ? '채팅 이어하기' : (p.kind === 'sell' ? '채팅으로 구매 문의' : '채팅으로 판매 제안')}</button>`;
    }
    if (!isOwner) {
        actions += `
            <div class="row">
                <button class="btn ${fav ? 'on' : ''}" style="flex:1" data-act="toggleFav" data-id="${p.id}">${fav ? '♥ 찜함' : '♡ 찜하기'} ${favCount(p.id)}</button>
                <button class="btn" data-act="share" data-id="${p.id}" title="링크 복사">🔗</button>
                <button class="btn btn-danger" data-act="report" data-id="${p.id}" title="신고">🚨</button>
            </div>`;
    } else {
        actions += `<button class="btn btn-block" data-act="share" data-id="${p.id}">🔗 링크 복사</button>`;
    }

    const ownerTools = isOwner ? `
        <div class="card owner-tools">
            <h4>거래 상태 관리</h4>
            <div class="status-btns">
                ${Object.entries(STATUS).map(([k, l]) => `<button class="btn btn-sm ${p.status === k ? 'on' : ''}" data-act="setStatus" data-id="${p.id}" data-v="${k}">${l}</button>`).join('')}
            </div>
            ${partner ? `<p class="small muted" style="margin:0 0 10px">${counterpartLabel}: <a href="#/user/${partner.id}"><b>${esc(partner.nickname)}</b></a></p>` : ''}
            <div class="row">
                <a class="btn btn-sm" href="#/edit/${p.id}">✏️ 수정</a>
                <button class="btn btn-sm" data-act="bump" data-id="${p.id}" ${p.status === 'done' ? 'disabled' : ''}>⬆️ 끌어올리기</button>
                <button class="btn btn-sm btn-danger" data-act="deletePost" data-id="${p.id}">삭제</button>
            </div>
        </div>` : '';

    const adminTools = isAdmin() && !isOwner ? `
        <div class="card owner-tools">
            <h4>관리자</h4>
            <button class="btn btn-sm btn-block ${p.hidden ? '' : 'btn-danger'}" data-act="toggleHide" data-id="${p.id}">${p.hidden ? '숨김 해제' : '글 숨기기'}</button>
        </div>` : '';

    const reviewForm = canReview ? `
        <form class="card card-pad" data-form="review" data-keep style="margin-top:16px">
            <input type="hidden" name="postId" value="${p.id}">
            <h3 style="font-size:16px;margin-bottom:8px">거래 후기 남기기</h3>
            <p class="small muted" style="margin:0 0 8px">${esc(userById(u.id === p.authorId ? p.partnerId : p.authorId)?.nickname || '')}님과의 거래는 어떠셨나요?</p>
            <div class="stars-input">
                ${[5, 4, 3, 2, 1].map(n => `<input type="radio" name="rating" id="rate${n}" value="${n}" ${n === 5 ? 'checked' : ''}><label for="rate${n}" title="${n}점">★</label>`).join('')}
            </div>
            <textarea class="input" id="reviewText" name="text" maxlength="200" placeholder="후기를 남겨주세요 (최대 200자)" style="margin-top:10px;min-height:80px"></textarea>
            <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn btn-primary">후기 등록</button></div>
        </form>` : '';

    return `
    <div class="detail">
        <div>
            <article class="card detail-main">
                <div class="row">${kindBadge(p)} ${statusBadge(p)} ${p.hidden ? '<span class="badge badge-hidden">숨김 처리됨</span>' : ''}</div>
                <h1 class="detail-title">${esc(p.title)}</h1>
                <div class="small muted">${timeAgo(p.createdAt)} 작성${p.updatedAt > p.createdAt + 1000 ? ' · 수정됨' : ''} · 조회 ${p.views || 0}</div>
                ${p.images?.length ? `<div class="gallery">${p.images.map((src, i) =>
                    `<button data-act="viewImage" data-id="${p.id}" data-i="${i}" aria-label="이미지 크게 보기"><img src="${esc(safeImg(src))}" alt="티켓 이미지 ${i + 1}"></button>`).join('')}</div>` : ''}
                <table class="info-table">
                    <tr><th>종목</th><td>${sp.emoji} ${sp.name}</td></tr>
                    <tr><th>경기일</th><td>${fmtDate(p.eventDate)}</td></tr>
                    <tr><th>좌석</th><td>${SEATS[p.seat] || '기타'}</td></tr>
                    <tr><th>수량</th><td>${p.qty}매</td></tr>
                    <tr><th>정가</th><td>${p.faceValue ? won(p.faceValue) + ' / 1매' : '-'}</td></tr>
                    <tr><th>거래 방법</th><td>${(p.methods || []).map(m => METHODS[m]).join(', ')}</td></tr>
                    ${p.place ? `<tr><th>희망 장소</th><td>${esc(p.place)}</td></tr>` : ''}
                </table>
                <div class="desc">${esc(p.desc) || '<span class="muted">상세 설명이 없어요.</span>'}</div>
            </article>
            ${reviewForm}
            ${postReviews.length ? `
                <div class="card card-pad" style="margin-top:16px">
                    <h3 style="font-size:16px;margin-bottom:4px">이 거래의 후기</h3>
                    ${postReviews.map(reviewItem).join('')}
                </div>` : ''}
        </div>
        <aside class="aside">
            <div class="card price-box">
                <div class="small muted">${p.kind === 'sell' ? '판매 가격' : '희망 구매 가격'} (1매)</div>
                <div class="price">${won(p.price)}</div>
                <div class="small">${discountTag(p)} ${p.qty > 1 ? `<span class="muted">총 ${won(p.price * p.qty)}</span>` : ''}</div>
                <div class="actions">${actions}</div>
            </div>
            <a class="card author-card" href="#/user/${author?.id || ''}">
                ${avatar(author)}
                <div>
                    <div><b>${esc(author?.nickname || '탈퇴한 사용자')}</b> ${schoolBadge(author)}</div>
                    <div class="small muted">${rating.count ? `<span class="stars">★</span> ${rating.avg.toFixed(1)} (후기 ${rating.count})` : '아직 후기 없음'} · 거래 ${tradesOf(p.authorId).length}회</div>
                </div>
            </a>
            ${ownerTools}
            ${adminTools}
            <div class="notice small">⚠️ 선입금 요구, 외부 메신저 유도, 바코드 사진 거래는 사기 위험이 높아요. <a href="#/guide"><u>안전거래 수칙</u></a></div>
        </aside>
    </div>
    ${similar.length ? `<h2 class="section-title">${sp.emoji} 다른 ${sp.name} 거래글</h2><div class="post-grid">${similar.map(postCard).join('')}</div>` : ''}`;
}

function reviewItem(r) {
    const from = userById(r.from);
    const post = postById(r.postId);
    return `<div class="review-item">
        <div class="row"><span class="stars">${starText(r.rating)}</span><b>${esc(from?.nickname || '탈퇴한 사용자')}</b> ${schoolBadge(from)}<span class="spacer"></span><span class="small muted">${timeAgo(r.at)}</span></div>
        ${r.text ? `<div style="margin-top:4px">${esc(r.text)}</div>` : ''}
        ${post ? `<div class="small muted" style="margin-top:2px">거래: <a href="#/post/${post.id}">${esc(post.title)}</a></div>` : ''}
    </div>`;
}

/* ---------- 글쓰기/수정 ---------- */
let draftImages = [];

function viewForm(id) {
    const u = me();
    const editing = id ? postById(id) : null;
    if (id && (!editing || editing.authorId !== u.id)) return viewNotFound('수정할 수 없는 글이에요.');
    viewForm.title = editing ? '글 수정' : '글쓰기';
    const p = editing || { kind: 'sell', sport: 'baseball', eventDate: '', seat: u.school === 'YU' ? 'yu' : 'ku', qty: 1, price: '', faceValue: '', methods: ['meet'], place: '', title: '', desc: '', images: [] };
    draftImages = (p.images || []).slice();

    const opt = (obj, sel) => Object.entries(obj).map(([k, l]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${l}</option>`).join('');
    return `
    <div class="mid">
        <h1 class="page-title">${editing ? '거래글 수정' : '거래글 쓰기'}</h1>
        <form class="card card-pad" data-form="post" novalidate>
            ${editing ? `<input type="hidden" name="id" value="${editing.id}">` : ''}
            <div id="form-error" class="form-error hidden"></div>
            <div class="field">
                <span class="field-label">거래 종류</span>
                <div class="radio-group">
                    <label><input type="radio" name="kind" value="sell" ${p.kind === 'sell' ? 'checked' : ''}> 팝니다 (양도)</label>
                    <label><input type="radio" name="kind" value="buy" ${p.kind === 'buy' ? 'checked' : ''}> 삽니다 (구매)</label>
                </div>
            </div>
            <div class="grid-2">
                <div class="field">
                    <label for="f-sport">종목</label>
                    <select class="input" id="f-sport" name="sport">${SPORTS.map(s => `<option value="${s.id}" ${p.sport === s.id ? 'selected' : ''}>${s.emoji} ${s.name}</option>`).join('')}</select>
                </div>
                <div class="field">
                    <label for="f-date">경기일</label>
                    <input class="input" type="date" id="f-date" name="eventDate" value="${esc(p.eventDate)}">
                </div>
                <div class="field">
                    <label for="f-seat">좌석</label>
                    <select class="input" id="f-seat" name="seat">${opt(SEATS, p.seat)}</select>
                </div>
                <div class="field">
                    <label for="f-qty">수량</label>
                    <select class="input" id="f-qty" name="qty">${Array.from({ length: CONFIG.maxQty }, (_, i) => i + 1).map(n => `<option value="${n}" ${Number(p.qty) === n ? 'selected' : ''}>${n}매</option>`).join('')}</select>
                </div>
                <div class="field">
                    <label for="f-face">정가 (1매, 원)</label>
                    <input class="input" type="number" id="f-face" name="faceValue" min="0" step="100" inputmode="numeric" value="${esc(p.faceValue)}" placeholder="예: 10000">
                    <span class="hint">예매처에 표시된 원래 가격</span>
                </div>
                <div class="field">
                    <label for="f-price">거래 가격 (1매, 원)</label>
                    <input class="input" type="number" id="f-price" name="price" min="0" step="100" inputmode="numeric" value="${esc(p.price)}" placeholder="예: 10000">
                    <span class="hint">정가를 초과할 수 없어요</span>
                </div>
            </div>
            <div class="field">
                <span class="field-label">거래 방법 (복수 선택)</span>
                <div class="radio-group">
                    ${Object.entries(METHODS).map(([k, l]) => `<label><input type="checkbox" name="methods" value="${k}" ${(p.methods || []).includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}
                </div>
            </div>
            <div class="field">
                <label for="f-place">희망 거래 장소 <span class="muted small">(선택)</span></label>
                <input class="input" id="f-place" name="place" maxlength="40" value="${esc(p.place)}" placeholder="예: 안암역 3번 출구, 신촌역">
            </div>
            <div class="field">
                <label for="f-title">제목</label>
                <input class="input" id="f-title" name="title" maxlength="50" value="${esc(p.title)}" placeholder="예: 농구 고대 응원석 2매 정가 양도">
            </div>
            <div class="field">
                <label for="f-desc">상세 설명</label>
                <textarea class="input" id="f-desc" name="desc" maxlength="1000" placeholder="좌석 구역, 연석 여부, 양도 사유 등을 적어주세요.">${esc(p.desc)}</textarea>
            </div>
            <div class="field">
                <span class="field-label">사진 첨부 <span class="muted small">(최대 ${CONFIG.maxImages}장)</span></span>
                <input type="file" id="imgInput" accept="image/*" multiple>
                <span class="hint">⚠️ 바코드·QR·예매번호·개인정보는 꼭 가리고 올려주세요. 노출되면 티켓을 도용당할 수 있어요.</span>
                <div class="img-previews" id="imgPreviews">${imgPreviewsHTML()}</div>
            </div>
            <div class="row" style="justify-content:flex-end">
                <a class="btn" href="${editing ? '#/post/' + editing.id : '#/'}">취소</a>
                <button class="btn btn-primary" type="submit">${editing ? '수정 완료' : '등록하기'}</button>
            </div>
        </form>
    </div>`;
}
function imgPreviewsHTML() {
    return draftImages.map((src, i) => `<div class="img-thumb"><img src="${esc(safeImg(src))}" alt="첨부 이미지 ${i + 1}"><button type="button" data-act="removeImg" data-i="${i}" aria-label="삭제">✕</button></div>`).join('');
}

/* ---------- 채팅 ---------- */
function viewChats() {
    viewChats.title = '채팅';
    const u = me();
    const list = chatsOf(u.id).filter(c => c.messages.length).sort((a, b) => lastActivity(b) - lastActivity(a));
    return `
    <div class="mid">
        <h1 class="page-title">채팅</h1>
        ${list.length ? `<div class="card chat-list">${list.map(c => {
            const post = postById(c.postId);
            const other = userById(partnerOf(c, u.id));
            const last = c.messages[c.messages.length - 1];
            const n = unreadIn(c, u.id);
            return `<a class="chat-row" href="#/chat/${c.id}">
                ${avatar(other)}
                <div class="body">
                    <div class="row" style="gap:6px"><b>${esc(other?.nickname || '탈퇴한 사용자')}</b> ${schoolBadge(other)} <span class="small muted">${timeAgo(lastActivity(c))}</span></div>
                    <div class="small muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${post ? `${post.kind === 'sell' ? '[팝니다]' : '[삽니다]'} ${esc(post.title)}` : '삭제된 글'}</div>
                    <div class="last">${last ? esc(last.text) : ''}</div>
                </div>
                ${n ? `<span class="unread">${n}</span>` : ''}
            </a>`;
        }).join('')}</div>` : emptyState('💬', '아직 채팅이 없어요. 관심 있는 거래글에서 채팅을 시작해 보세요.', '<a class="btn" href="#/">거래글 보기</a>')}
    </div>`;
}

function viewChat(id) {
    const u = me();
    const c = chatById(id);
    if (!c || (c.ownerId !== u.id && c.otherId !== u.id)) return viewNotFound('채팅방을 찾을 수 없어요.');
    viewChat.title = '채팅';
    if (unreadIn(c, u.id) || !c.lastRead[u.id]) { c.lastRead[u.id] = now(); save(); }

    const post = postById(c.postId);
    const other = userById(partnerOf(c, u.id));
    const isOwner = post && post.authorId === u.id;
    const theirRead = c.lastRead[other?.id] || 0;
    const blocked = !other || other.banned;

    let ownerBtns = '';
    if (isOwner && post.status !== 'done') {
        if (post.status === 'open') ownerBtns = `<button class="btn btn-sm" data-act="chatReserve" data-id="${c.id}">🤝 이 분과 예약하기</button>`;
        if (post.status === 'reserved' && post.partnerId === other?.id) {
            ownerBtns = `<button class="btn btn-sm btn-primary" data-act="chatComplete" data-id="${c.id}">✅ 거래 완료</button>
                         <button class="btn btn-sm" data-act="chatUnreserve" data-id="${c.id}">예약 취소</button>`;
        }
    }
    if (post && post.status === 'done' && post.partnerId && (post.partnerId === u.id || post.authorId === u.id)
        && !db.reviews.some(r => r.postId === post.id && r.from === u.id)) {
        ownerBtns += `<a class="btn btn-sm btn-primary" href="#/post/${post.id}">⭐ 후기 남기기</a>`;
    }

    let prevDay = '';
    const msgs = c.messages.map(m => {
        const day = new Date(m.at).toDateString();
        const sep = day !== prevDay ? `<div class="msg system"><div class="bubble">${fmtDateTime(m.at).split(' ')[0]}</div></div>` : '';
        prevDay = day;
        if (m.from === 'system') return sep + `<div class="msg system"><div class="bubble">${esc(m.text)}</div></div>`;
        const mine = m.from === u.id;
        const warn = !mine && SCAM_PATTERN.test(m.text) ? '<div class="warn">⚠️ 선입금·계좌·외부 메신저 요구는 사기일 수 있어요</div>' : '';
        return sep + `<div class="msg ${mine ? 'mine' : 'theirs'}"><div class="bubble">${esc(m.text)}</div>${warn}
            <div class="time">${mine && m.at <= theirRead ? '읽음 · ' : ''}${fmtTime(m.at)}</div></div>`;
    }).join('');

    afterRender = () => {
        const body = $('#chatBody');
        if (body) body.scrollTop = body.scrollHeight;
    };

    return `
    <div class="mid">
        <div class="card chat">
            <div class="chat-head">
                <div class="row">
                    <a href="#/chats" class="btn btn-ghost btn-sm" aria-label="채팅 목록">←</a>
                    <a href="#/user/${other?.id || ''}"><b>${esc(other?.nickname || '탈퇴한 사용자')}</b></a> ${schoolBadge(other)}
                    <span class="small muted">${other ? (() => { const r = ratingOf(other.id); return r.count ? `★ ${r.avg.toFixed(1)}` : ''; })() : ''}</span>
                    <span class="spacer"></span>
                    ${other ? `<button class="btn btn-ghost btn-sm" data-act="reportUser" data-id="${other.id}" data-post="${post?.id || ''}" title="신고">🚨</button>` : ''}
                </div>
                ${post ? `<a class="chat-post" href="#/post/${post.id}">
                    <span>${sportOf(post.sport).emoji}</span>
                    <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><b>${esc(post.title)}</b></span>
                    ${statusBadge(post)} <b>${won(post.price)}</b>
                </a>` : '<div class="chat-post muted">삭제된 글이에요</div>'}
                ${ownerBtns ? `<div class="row">${ownerBtns}</div>` : ''}
            </div>
            <div class="chat-body" id="chatBody">
                <div class="msg system"><div class="bubble">🔒 거래는 가급적 직거래 또는 공식 예매처의 양도 기능을 이용하세요.<br>선입금만 요구하는 경우 사기일 가능성이 높아요.</div></div>
                ${msgs}
            </div>
            ${blocked ? '<div class="chat-input"><span class="muted small">대화할 수 없는 사용자예요.</span></div>' : `
            <div class="quick-replies">${QUICK_REPLIES.map(q => `<button type="button" class="chip" data-act="quickReply" data-v="${esc(q)}">${esc(q)}</button>`).join('')}</div>
            <form class="chat-input" data-form="chat">
                <input type="hidden" name="chatId" value="${c.id}">
                <textarea class="input" id="msg" name="text" rows="1" maxlength="1000" placeholder="메시지를 입력하세요" aria-label="메시지"></textarea>
                <button class="btn btn-primary">전송</button>
            </form>`}
        </div>
    </div>`;
}

/* ---------- 내 정보 ---------- */
function viewMe(tab = 'posts') {
    const u = me();
    viewMe.title = '내 정보';
    const tabs = [['posts', '내 글'], ['favs', '찜한 글'], ['trades', '거래 내역'], ['reviews', '받은 후기'], ['settings', '설정']];
    const r = ratingOf(u.id);
    let body = '';

    if (tab === 'posts') {
        const list = db.posts.filter(p => p.authorId === u.id).sort((a, b) => b.createdAt - a.createdAt);
        body = list.length ? `<div class="post-grid">${list.map(postCard).join('')}</div>` : emptyState('📝', '작성한 글이 없어요.', '<a class="btn btn-primary" href="#/new">글쓰기</a>');
    } else if (tab === 'favs') {
        const list = favsOf(u.id).map(postById).filter(p => p && visiblePost(p));
        body = list.length ? `<div class="post-grid">${list.map(postCard).join('')}</div>` : emptyState('♡', '찜한 글이 없어요.');
    } else if (tab === 'trades') {
        const list = db.posts.filter(p => p.partnerId && (p.authorId === u.id || p.partnerId === u.id) && p.status !== 'open')
            .sort((a, b) => b.updatedAt - a.updatedAt);
        body = list.length ? `<div class="card table-wrap"><table class="data">
            <tr><th>글</th><th>역할</th><th>상대</th><th>금액</th><th>상태</th><th>후기</th></tr>
            ${list.map(p => {
                const iAmAuthor = p.authorId === u.id;
                const seller = p.kind === 'sell' ? iAmAuthor : !iAmAuthor;
                const other = userById(iAmAuthor ? p.partnerId : p.authorId);
                const reviewed = db.reviews.some(x => x.postId === p.id && x.from === u.id);
                return `<tr>
                    <td><a href="#/post/${p.id}"><b>${esc(p.title)}</b></a><div class="small muted">${sportOf(p.sport).name} · ${fmtDate(p.eventDate)}</div></td>
                    <td>${seller ? '판매' : '구매'}</td>
                    <td>${other ? `<a href="#/user/${other.id}">${esc(other.nickname)}</a>` : '-'}</td>
                    <td>${won(p.price * p.qty)}</td>
                    <td>${statusBadge(p)}</td>
                    <td>${p.status === 'done' ? (reviewed ? '작성 완료' : `<a class="btn btn-sm" href="#/post/${p.id}">작성</a>`) : '-'}</td>
                </tr>`;
            }).join('')}
        </table></div>` : emptyState('🤝', '예약 또는 완료된 거래가 없어요.');
    } else if (tab === 'reviews') {
        const list = db.reviews.filter(x => x.to === u.id).sort((a, b) => b.at - a.at);
        body = list.length ? `<div class="card card-pad">${list.map(reviewItem).join('')}</div>` : emptyState('⭐', '받은 후기가 없어요.');
    } else if (tab === 'settings') {
        body = `
        <form class="card card-pad" data-form="profile" style="margin-bottom:16px">
            <h3 style="font-size:16px;margin-bottom:14px">프로필</h3>
            <div class="grid-2">
                <div class="field"><label for="s-nick">닉네임</label><input class="input" id="s-nick" name="nickname" maxlength="12" value="${esc(u.nickname)}"></div>
                <div class="field"><label for="s-year">학번 (2자리)</label><input class="input" id="s-year" name="year" maxlength="2" inputmode="numeric" value="${esc(u.year)}" placeholder="예: 24"></div>
            </div>
            <div class="field"><span class="field-label">소속 학교</span><div class="radio-group">
                ${Object.entries(SCHOOLS).map(([k, l]) => `<label><input type="radio" name="school" value="${k}" ${u.school === k ? 'checked' : ''}> ${l}</label>`).join('')}
            </div></div>
            <div class="row" style="justify-content:flex-end"><button class="btn btn-primary">저장</button></div>
        </form>
        <form class="card card-pad" data-form="password" style="margin-bottom:16px">
            <h3 style="font-size:16px;margin-bottom:14px">비밀번호 변경</h3>
            <div class="field"><label for="s-cur">현재 비밀번호</label><input class="input" type="password" id="s-cur" name="current" autocomplete="current-password"></div>
            <div class="grid-2">
                <div class="field"><label for="s-new">새 비밀번호</label><input class="input" type="password" id="s-new" name="next" autocomplete="new-password" placeholder="6자 이상"></div>
                <div class="field"><label for="s-new2">새 비밀번호 확인</label><input class="input" type="password" id="s-new2" name="next2" autocomplete="new-password"></div>
            </div>
            <div class="row" style="justify-content:flex-end"><button class="btn btn-primary">변경</button></div>
        </form>
        <div class="card card-pad">
            <h3 style="font-size:16px;margin-bottom:14px">계정</h3>
            <div class="row">
                <button class="btn" data-act="logout">로그아웃</button>
                <button class="btn" data-act="exportData">내 데이터 내보내기</button>
                <span class="spacer"></span>
                <button class="btn btn-danger" data-act="deleteAccount">회원 탈퇴</button>
            </div>
        </div>`;
    } else {
        return viewNotFound();
    }

    return `
    <div class="card profile-head">
        ${avatar(u)}
        <div>
            <div style="font-size:20px;font-weight:800">${esc(u.nickname)} ${schoolBadge(u)}</div>
            <div class="small muted">@${esc(u.loginId)} · ${new Date(u.createdAt).getFullYear()}.${new Date(u.createdAt).getMonth() + 1} 가입${u.role === 'admin' ? ' · 관리자' : ''}</div>
        </div>
        <div class="stat-row">
            <div><b>${r.count ? r.avg.toFixed(1) : '-'}</b><span class="small muted">평점</span></div>
            <div><b>${tradesOf(u.id).length}</b><span class="small muted">거래</span></div>
            <div><b>${db.posts.filter(p => p.authorId === u.id).length}</b><span class="small muted">작성글</span></div>
        </div>
    </div>
    <nav class="tabs">${tabs.map(([k, l]) => `<a href="#/me/${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</nav>
    ${body}`;
}

function viewUser(id) {
    const u = userById(id);
    if (!u) return viewNotFound('존재하지 않거나 탈퇴한 사용자예요.');
    viewUser.title = u.nickname;
    const r = ratingOf(u.id);
    const posts = db.posts.filter(p => p.authorId === u.id && visiblePost(p) && p.status !== 'done').sort((a, b) => b.createdAt - a.createdAt);
    const reviews = db.reviews.filter(x => x.to === u.id).sort((a, b) => b.at - a.at);
    const viewer = me();
    return `
    <div class="card profile-head">
        ${avatar(u)}
        <div>
            <div style="font-size:20px;font-weight:800">${esc(u.nickname)} ${schoolBadge(u)} ${u.banned ? '<span class="badge badge-hidden">이용 제한</span>' : ''}</div>
            <div class="small muted">${r.count ? `<span class="stars">${starText(r.avg)}</span> ${r.avg.toFixed(1)} · 후기 ${r.count}개` : '아직 받은 후기가 없어요'}</div>
        </div>
        <div class="stat-row">
            <div><b>${tradesOf(u.id).length}</b><span class="small muted">거래 완료</span></div>
            <div><b>${posts.length}</b><span class="small muted">진행 중</span></div>
        </div>
        ${viewer && viewer.id !== u.id ? `<button class="btn btn-sm btn-danger" data-act="reportUser" data-id="${u.id}">🚨 신고</button>` : ''}
        ${isAdmin() && u.role !== 'admin' ? `<button class="btn btn-sm" data-act="toggleBan" data-id="${u.id}">${u.banned ? '제한 해제' : '이용 제한'}</button>` : ''}
    </div>
    <h2 class="section-title">진행 중인 거래글</h2>
    ${posts.length ? `<div class="post-grid">${posts.map(postCard).join('')}</div>` : emptyState('🎫', '진행 중인 거래글이 없어요.')}
    <h2 class="section-title">받은 후기</h2>
    ${reviews.length ? `<div class="card card-pad">${reviews.map(reviewItem).join('')}</div>` : emptyState('⭐', '받은 후기가 없어요.')}`;
}

/* ---------- 알림 ---------- */
function viewNotifs() {
    viewNotifs.title = '알림';
    const u = me();
    const list = db.notifs.filter(n => n.userId === u.id).sort((a, b) => b.at - a.at);
    const html = `
    <div class="mid">
        <div class="row" style="margin-bottom:16px"><h1 class="page-title" style="margin:0">알림</h1><span class="spacer"></span>
            ${list.length ? '<button class="btn btn-sm" data-act="clearNotifs">모두 지우기</button>' : ''}</div>
        ${list.length ? `<div class="card">${list.map(n => `
            <a class="list-item ${n.read ? '' : 'unread-row'}" href="${esc(n.link || '#/')}">
                <div style="flex:1">${esc(n.text)}</div><span class="small muted">${timeAgo(n.at)}</span>
            </a>`).join('')}</div>` : emptyState('🔔', '새 알림이 없어요.')}
    </div>`;
    if (list.some(n => !n.read)) { list.forEach(n => { n.read = true; }); save(); }
    return html;
}

/* ---------- 관리자 ---------- */
function viewAdmin() {
    viewAdmin.title = '관리';
    const pending = db.reports.filter(r => !r.resolved).sort((a, b) => b.at - a.at);
    const resolved = db.reports.filter(r => r.resolved).sort((a, b) => b.at - a.at).slice(0, 30);
    const hidden = db.posts.filter(p => p.hidden);
    const users = db.users.slice().sort((a, b) => b.createdAt - a.createdAt);
    const reportRow = r => {
        const reporter = userById(r.from);
        const post = r.postId ? postById(r.postId) : null;
        const target = r.userId ? userById(r.userId) : (post ? userById(post.authorId) : null);
        return `<tr>
            <td class="small">${fmtDateTime(r.at)}</td>
            <td><b>${esc(r.reason)}</b>${r.detail ? `<div class="small muted">${esc(r.detail)}</div>` : ''}</td>
            <td>${post ? `<a href="#/post/${post.id}">${esc(post.title)}</a>${post.hidden ? ' <span class="badge badge-hidden">숨김</span>' : ''}` : (r.postId ? '<span class="muted">삭제된 글</span>' : '-')}</td>
            <td>${target ? `<a href="#/user/${target.id}">${esc(target.nickname)}</a>${target.banned ? ' <span class="badge badge-hidden">제한</span>' : ''}` : '-'}</td>
            <td class="small">${esc(reporter?.nickname || '-')}</td>
            <td><div class="row">
                ${post ? `<button class="btn btn-sm" data-act="toggleHide" data-id="${post.id}">${post.hidden ? '숨김 해제' : '글 숨김'}</button>` : ''}
                ${target && target.role !== 'admin' ? `<button class="btn btn-sm" data-act="toggleBan" data-id="${target.id}">${target.banned ? '제한 해제' : '이용 제한'}</button>` : ''}
                ${r.resolved ? '' : `<button class="btn btn-sm btn-primary" data-act="resolveReport" data-id="${r.id}">처리 완료</button>`}
            </div></td>
        </tr>`;
    };
    return `
    <h1 class="page-title">관리자</h1>
    <div class="hero-stats" style="margin:0 0 8px">
        ${[['회원', db.users.length], ['거래글', db.posts.length], ['거래 완료', db.posts.filter(p => p.status === 'done').length], ['미처리 신고', pending.length], ['숨긴 글', hidden.length]]
            .map(([l, n]) => `<div class="card" style="padding:10px 16px"><b style="font-size:20px">${n}</b> <span class="small muted">${l}</span></div>`).join('')}
    </div>
    <h2 class="section-title">미처리 신고 ${pending.length ? `<span class="tab-count">${pending.length}</span>` : ''}</h2>
    ${pending.length ? `<div class="card table-wrap"><table class="data"><tr><th>일시</th><th>사유</th><th>글</th><th>대상</th><th>신고자</th><th>조치</th></tr>${pending.map(reportRow).join('')}</table></div>` : emptyState('✅', '처리할 신고가 없어요.')}
    ${resolved.length ? `<h2 class="section-title">처리된 신고</h2><div class="card table-wrap"><table class="data"><tr><th>일시</th><th>사유</th><th>글</th><th>대상</th><th>신고자</th><th>조치</th></tr>${resolved.map(reportRow).join('')}</table></div>` : ''}
    <h2 class="section-title">회원 관리</h2>
    <div class="card table-wrap"><table class="data">
        <tr><th>닉네임</th><th>아이디</th><th>학교</th><th>가입</th><th>글</th><th>평점</th><th>상태</th></tr>
        ${users.map(u => {
            const r = ratingOf(u.id);
            return `<tr>
                <td><a href="#/user/${u.id}"><b>${esc(u.nickname)}</b></a></td>
                <td class="small">@${esc(u.loginId)}</td>
                <td>${schoolBadge(u)}</td>
                <td class="small">${fmtDateTime(u.createdAt).split(' ')[0]}</td>
                <td>${db.posts.filter(p => p.authorId === u.id).length}</td>
                <td>${r.count ? r.avg.toFixed(1) : '-'}</td>
                <td>${u.role === 'admin' ? '관리자' : `<button class="btn btn-sm ${u.banned ? '' : 'btn-danger'}" data-act="toggleBan" data-id="${u.id}">${u.banned ? '제한 해제' : '이용 제한'}</button>`}</td>
            </tr>`;
        }).join('')}
    </table></div>
    <h2 class="section-title">데이터</h2>
    <div class="card card-pad row">
        <button class="btn" data-act="exportAll">전체 데이터 백업(JSON)</button>
        <label class="btn">백업 복원<input type="file" id="importInput" accept="application/json" hidden></label>
        <span class="spacer"></span>
        <button class="btn btn-danger" data-act="resetAll">초기화(예시 데이터로)</button>
    </div>`;
}

/* ---------- 안내 ---------- */
function viewGuide() {
    viewGuide.title = '이용 안내';
    return `
    <div class="mid guide">
        <h1 class="page-title">이용 안내</h1>
        <div class="card card-pad">
            <h2 style="margin-top:0">🎫 거래 방법</h2>
            <ol>
                <li>회원가입 후 <b>팝니다</b>(양도) 또는 <b>삽니다</b>(구매) 글을 올려요.</li>
                <li>관심 있는 글에서 <b>채팅</b>으로 좌석·시간·장소를 조율해요.</li>
                <li>글 작성자는 상대를 정해 <b>예약중</b>으로 바꾸고, 거래가 끝나면 <b>거래완료</b>로 바꿔요.</li>
                <li>거래가 완료되면 서로 <b>후기</b>를 남겨 신뢰도를 쌓아요.</li>
            </ol>

            <h2>🚫 운영 원칙</h2>
            <ul>
                <li><b>정가 초과 거래(암표)는 금지</b>되어 있어 등록 자체가 되지 않아요. 정가 이하로만 거래할 수 있어요.</li>
                <li>허위 매물, 사기, 욕설, 개인정보 노출 글은 신고를 통해 숨김 처리되고 작성자는 이용이 제한될 수 있어요.</li>
                <li>학교 행사 규정상 양도가 금지된 티켓(본인 확인 좌석 등)은 거래하지 마세요.</li>
            </ul>

            <h2>🛡️ 사기 예방 수칙</h2>
            <ul>
                <li>가능하면 <b>캠퍼스·역 등 공개된 장소에서 직거래</b>하세요.</li>
                <li>모바일 티켓은 <b>예매처의 공식 양도 기능</b>을 이용하세요.</li>
                <li><b>선입금만 요구</b>하거나, 카톡·오픈채팅 등 <b>외부 메신저로 유도</b>하면 의심하세요.</li>
                <li>티켓 사진의 <b>바코드·QR·예매번호</b>는 절대 공개하지 마세요. 사진만으로 입장이 가능할 수 있어요.</li>
                <li>상대의 후기와 거래 횟수를 확인하고, 이상하면 🚨 신고해 주세요.</li>
            </ul>

            <h2>❓ 자주 묻는 질문</h2>
            <details class="faq"><summary>정가보다 싸게 올려도 되나요?</summary><p>네. 정가 이하라면 자유롭게 가격을 정할 수 있고, 목록에 할인율이 표시돼요.</p></details>
            <details class="faq"><summary>여러 장을 나눠 팔 수 있나요?</summary><p>설명에 분할 가능 여부를 적어 주세요. 일부가 팔리면 글을 수정해 수량을 줄이면 돼요.</p></details>
            <details class="faq"><summary>예약을 취소하고 싶어요.</summary><p>글 상세 또는 채팅방에서 상태를 다시 '거래가능'으로 바꾸면 돼요. 상대에게 알림이 가요.</p></details>
            <details class="faq"><summary>데이터는 어디에 저장되나요?</summary><p>이 사이트는 서버 없이 동작하는 버전이라 모든 데이터가 이 브라우저에 저장돼요. 다른 기기와는 공유되지 않아요.</p></details>
        </div>
    </div>`;
}

/* ---------- 로그인/회원가입 ---------- */
function viewLogin() {
    viewLogin.title = '로그인';
    const next = parseHash().query.get('next') || '';
    return `
    <div class="narrow">
        <h1 class="page-title center">로그인</h1>
        <form class="card card-pad" data-form="login">
            <input type="hidden" name="next" value="${esc(next)}">
            <div id="form-error" class="form-error hidden"></div>
            <div class="field"><label for="l-id">아이디</label><input class="input" id="l-id" name="loginId" autocomplete="username" autocapitalize="off"></div>
            <div class="field"><label for="l-pw">비밀번호</label><input class="input" type="password" id="l-pw" name="password" autocomplete="current-password"></div>
            <button class="btn btn-primary btn-block">로그인</button>
            <p class="center small muted" style="margin:14px 0 0">계정이 없나요? <a href="#/signup${next ? '?next=' + encodeURIComponent(next) : ''}"><b>회원가입</b></a></p>
        </form>
        <div class="notice notice-info small" style="margin-top:14px">
            체험용 계정: <b>tiger24</b> / <b>eagle23</b> / <b>crimson</b> / <b>blueblue</b> (비밀번호 <b>demo1234</b>)<br>
            관리자: <b>admin</b> / <b>admin1234</b>
        </div>
    </div>`;
}

function viewSignup() {
    viewSignup.title = '회원가입';
    const next = parseHash().query.get('next') || '';
    return `
    <div class="narrow">
        <h1 class="page-title center">회원가입</h1>
        <form class="card card-pad" data-form="signup" novalidate>
            <input type="hidden" name="next" value="${esc(next)}">
            <div id="form-error" class="form-error hidden"></div>
            <div class="field"><label for="s-id">아이디</label><input class="input" id="s-id" name="loginId" autocomplete="username" autocapitalize="off" placeholder="영문 소문자·숫자·_ 4~20자"></div>
            <div class="grid-2">
                <div class="field"><label for="s-pw">비밀번호</label><input class="input" type="password" id="s-pw" name="password" autocomplete="new-password" placeholder="6자 이상"></div>
                <div class="field"><label for="s-pw2">비밀번호 확인</label><input class="input" type="password" id="s-pw2" name="password2" autocomplete="new-password"></div>
            </div>
            <div class="grid-2">
                <div class="field"><label for="s-nick">닉네임</label><input class="input" id="s-nick" name="nickname" maxlength="12" placeholder="2~12자"></div>
                <div class="field"><label for="s-year">학번 (2자리)</label><input class="input" id="s-year" name="year" maxlength="2" inputmode="numeric" placeholder="예: 24"></div>
            </div>
            <div class="field"><span class="field-label">소속 학교</span><div class="radio-group">
                ${Object.entries(SCHOOLS).map(([k, l], i) => `<label><input type="radio" name="school" value="${k}" ${i === 0 ? 'checked' : ''}> ${l}</label>`).join('')}
            </div></div>
            <label class="check" style="margin-bottom:16px"><input type="checkbox" name="agree"> <span>정가 초과 거래 금지 등 <a href="#/guide" target="_blank"><u>운영 원칙</u></a>에 동의합니다.</span></label>
            <button class="btn btn-primary btn-block">가입하기</button>
            <p class="center small muted" style="margin:14px 0 0">이미 계정이 있나요? <a href="#/login"><b>로그인</b></a></p>
        </form>
    </div>`;
}

function viewNotFound(msg = '페이지를 찾을 수 없어요.') {
    return emptyState('🤔', esc(msg), '<a class="btn" href="#/">홈으로</a>');
}

/* ---------- 모달 & 토스트 ---------- */
let confirmCallback = null;

function openModal(html, cls = '') {
    $('#modal-root').innerHTML = `<div class="modal-back"><div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div></div>`;
    const first = $('#modal-root').querySelector('input, textarea, button');
    if (first) first.focus();
}
function closeModal() { $('#modal-root').innerHTML = ''; confirmCallback = null; }
function confirmModal(title, text, onOk, okLabel = '확인', danger = false) {
    confirmCallback = onOk;
    openModal(`<h3>${esc(title)}</h3><p class="muted" style="margin:0">${esc(text)}</p>
        <div class="modal-actions"><button class="btn" data-act="closeModal">취소</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="confirmOk">${esc(okLabel)}</button></div>`);
}
function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    $('#toast-root').appendChild(el);
    setTimeout(() => el.remove(), 2600);
}
function showFormError(form, msg) {
    const el = form.querySelector('#form-error');
    if (el) { el.textContent = msg; el.classList.remove('hidden'); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    else toast(msg);
}

/* ---------- 거래 상태 변경 ---------- */
function changeStatus(p, status, partnerId) {
    const author = userById(p.authorId);
    const prevPartner = p.partnerId;
    p.status = status;
    p.partnerId = status === 'open' ? null : (partnerId || null);
    p.updatedAt = now();
    const link = '#/post/' + p.id;
    const chatWith = pid => pid && db.chats.find(c => c.postId === p.id && c.otherId === pid);

    if (status === 'open' && prevPartner) {
        systemMessage(chatWith(prevPartner), '예약이 취소되어 다시 거래가능 상태가 되었어요.');
        notify(prevPartner, `'${p.title}' 예약이 취소되었어요.`, link);
    }
    if (status === 'reserved' && p.partnerId) {
        systemMessage(chatWith(p.partnerId), `${author.nickname}님이 거래를 예약중으로 변경했어요.`);
        notify(p.partnerId, `${author.nickname}님이 '${p.title}' 거래를 예약했어요.`, link);
    }
    if (status === 'done' && p.partnerId) {
        systemMessage(chatWith(p.partnerId), '거래가 완료되었어요. 서로 후기를 남겨주세요.');
        notify(p.partnerId, `'${p.title}' 거래가 완료되었어요. 후기를 남겨주세요!`, link);
    }
    save();
}

function openPartnerModal(p, status) {
    const partners = chatsForPost(p.id).filter(c => c.messages.some(m => m.from === c.otherId)).map(c => userById(c.otherId)).filter(Boolean);
    const label = p.kind === 'sell' ? '구매자' : '판매자';
    openModal(`
        <h3>${status === 'reserved' ? '예약할' : '거래 완료한'} ${label} 선택</h3>
        <form data-form="setPartner">
            <input type="hidden" name="postId" value="${p.id}">
            <input type="hidden" name="status" value="${status}">
            <div class="radio-group" style="flex-direction:column">
                ${partners.map((u, i) => `<label><input type="radio" name="partnerId" value="${u.id}" ${(p.partnerId ? p.partnerId === u.id : i === 0) ? 'checked' : ''}> ${esc(u.nickname)} ${schoolBadge(u)}</label>`).join('')}
                <label><input type="radio" name="partnerId" value="" ${partners.length ? '' : 'checked'}> 이 사이트 밖에서 거래함 (선택 안 함)</label>
            </div>
            ${partners.length ? '' : '<p class="small muted">아직 채팅한 상대가 없어요.</p>'}
            <p class="small muted">상대를 선택하면 알림이 가고, 거래 완료 후 서로 후기를 남길 수 있어요.</p>
            <div class="modal-actions"><button type="button" class="btn" data-act="closeModal">취소</button><button class="btn btn-primary">확인</button></div>
        </form>`);
}

function openReportModal(postId, userId) {
    const u = me();
    if (!u) return requireLogin();
    openModal(`
        <h3>🚨 신고하기</h3>
        <form data-form="report">
            <input type="hidden" name="postId" value="${esc(postId || '')}">
            <input type="hidden" name="userId" value="${esc(userId || '')}">
            <div class="radio-group" style="flex-direction:column">
                ${REPORT_REASONS.map((r, i) => `<label><input type="radio" name="reason" value="${esc(r)}" ${i === 0 ? 'checked' : ''}> ${esc(r)}</label>`).join('')}
            </div>
            <textarea class="input" name="detail" maxlength="300" placeholder="자세한 내용 (선택)" style="margin-top:12px;min-height:80px"></textarea>
            <div class="modal-actions"><button type="button" class="btn" data-act="closeModal">취소</button><button class="btn btn-danger">신고</button></div>
        </form>`);
}

function download(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- 클릭 액션 ---------- */
const actions = {
    setKind(el) { filters.kind = el.dataset.v; render(true); },
    setSport(el) { filters.sport = el.dataset.v; render(true); },
    closeModal,
    confirmOk() { const cb = confirmCallback; closeModal(); if (cb) cb(); },

    startChat(el) {
        const u = me();
        if (!u) return requireLogin();
        const p = postById(el.dataset.id);
        if (!p || p.authorId === u.id) return;
        let c = db.chats.find(x => x.postId === p.id && x.otherId === u.id);
        if (!c) {
            c = { id: uid(), postId: p.id, ownerId: p.authorId, otherId: u.id, createdAt: now(), lastRead: {}, messages: [] };
            db.chats.push(c);
            save();
        }
        go('#/chat/' + c.id);
    },
    toggleFav(el) {
        const u = me();
        if (!u) return requireLogin();
        const list = favsOf(u.id);
        const i = list.indexOf(el.dataset.id);
        if (i >= 0) list.splice(i, 1);
        else { list.push(el.dataset.id); toast('찜 목록에 추가했어요.'); }
        save();
        render(true);
    },
    async share(el) {
        const url = location.href.split('#')[0] + '#/post/' + el.dataset.id;
        try {
            await navigator.clipboard.writeText(url);
            toast('링크를 복사했어요.');
        } catch {
            openModal(`<h3>링크 복사</h3><input class="input" id="shareUrl" value="${esc(url)}" readonly>
                <div class="modal-actions"><button class="btn" data-act="closeModal">닫기</button></div>`);
            $('#shareUrl')?.select();
        }
    },
    report(el) { openReportModal(el.dataset.id, null); },
    reportUser(el) { openReportModal(el.dataset.post || '', el.dataset.id); },
    viewImage(el) {
        const p = postById(el.dataset.id);
        const src = safeImg(p?.images?.[Number(el.dataset.i)]);
        if (src) openModal(`<img src="${esc(src)}" alt="티켓 이미지"><div class="modal-actions"><button class="btn" data-act="closeModal">닫기</button></div>`, 'modal-img');
    },
    setStatus(el) {
        const p = postById(el.dataset.id);
        const status = el.dataset.v;
        if (!p || p.authorId !== me()?.id || p.status === status) return;
        if (status === 'open') {
            confirmModal('거래가능으로 변경', p.partnerId ? '예약/완료 상태가 해제되고 상대에게 알림이 가요.' : '거래가능 상태로 되돌릴까요?', () => { changeStatus(p, 'open'); toast('거래가능으로 변경했어요.'); render(); });
        } else {
            openPartnerModal(p, status);
        }
    },
    bump(el) {
        const p = postById(el.dataset.id);
        if (!p) return;
        const left = CONFIG.bumpCooldownMin * 60000 - (now() - (p.bumpedAt || p.createdAt));
        if (left > 0) return toast(`${Math.ceil(left / 60000)}분 뒤에 다시 끌어올릴 수 있어요.`);
        p.bumpedAt = now();
        save();
        toast('글을 목록 맨 위로 끌어올렸어요.');
        render(true);
    },
    deletePost(el) {
        const p = postById(el.dataset.id);
        if (!p) return;
        confirmModal('글 삭제', '삭제한 글은 복구할 수 없어요. 채팅 기록은 남아있어요.', () => {
            db.posts = db.posts.filter(x => x.id !== p.id);
            Object.values(db.favs).forEach(list => { const i = list.indexOf(p.id); if (i >= 0) list.splice(i, 1); });
            save();
            toast('글을 삭제했어요.');
            go('#/me/posts');
        }, '삭제', true);
    },
    removeImg(el) {
        draftImages.splice(Number(el.dataset.i), 1);
        $('#imgPreviews').innerHTML = imgPreviewsHTML();
    },
    quickReply(el) {
        const input = $('#msg');
        if (input) { input.value = el.dataset.v; input.focus(); }
    },
    chatReserve(el) {
        const c = chatById(el.dataset.id);
        const p = c && postById(c.postId);
        if (!p) return;
        confirmModal('예약하기', `${userById(c.otherId)?.nickname}님과 거래를 예약할까요?`, () => { changeStatus(p, 'reserved', c.otherId); render(); });
    },
    chatUnreserve(el) {
        const c = chatById(el.dataset.id);
        const p = c && postById(c.postId);
        if (!p) return;
        confirmModal('예약 취소', '예약을 취소하고 다시 거래가능 상태로 바꿀까요?', () => { changeStatus(p, 'open'); render(); });
    },
    chatComplete(el) {
        const c = chatById(el.dataset.id);
        const p = c && postById(c.postId);
        if (!p) return;
        confirmModal('거래 완료', `${userById(c.otherId)?.nickname}님과의 거래를 완료 처리할까요?`, () => { changeStatus(p, 'done', c.otherId); render(); });
    },
    clearNotifs() {
        const u = me();
        db.notifs = db.notifs.filter(n => n.userId !== u.id);
        save();
        render();
    },
    logout() {
        setSession(null);
        toast('로그아웃했어요.');
        go('#/');
    },
    exportData() {
        const u = me();
        const { salt, pwHash, ...profile } = u; void salt; void pwHash;
        download(`my-data-${u.loginId}.json`, {
            profile,
            posts: db.posts.filter(p => p.authorId === u.id),
            chats: chatsOf(u.id),
            reviewsReceived: db.reviews.filter(r => r.to === u.id),
            reviewsWritten: db.reviews.filter(r => r.from === u.id),
            favorites: favsOf(u.id),
        });
    },
    deleteAccount() {
        const u = me();
        if (u.role === 'admin' && db.users.filter(x => x.role === 'admin').length === 1) return toast('마지막 관리자 계정은 탈퇴할 수 없어요.');
        confirmModal('회원 탈퇴', '작성한 글과 찜 목록이 삭제되고 되돌릴 수 없어요. 탈퇴할까요?', () => {
            const mine = new Set(db.posts.filter(p => p.authorId === u.id).map(p => p.id));
            db.posts = db.posts.filter(p => !mine.has(p.id));
            delete db.favs[u.id];
            Object.values(db.favs).forEach(list => { for (let i = list.length - 1; i >= 0; i--) if (mine.has(list[i])) list.splice(i, 1); });
            db.notifs = db.notifs.filter(n => n.userId !== u.id);
            db.users = db.users.filter(x => x.id !== u.id);
            save();
            setSession(null);
            toast('탈퇴가 완료되었어요.');
            go('#/');
        }, '탈퇴', true);
    },

    // 관리자
    toggleHide(el) {
        if (!isAdmin()) return;
        const p = postById(el.dataset.id);
        if (!p) return;
        p.hidden = !p.hidden;
        notify(p.authorId, p.hidden ? `'${p.title}' 글이 운영 정책에 따라 숨김 처리되었어요.` : `'${p.title}' 글의 숨김이 해제되었어요.`, '#/post/' + p.id);
        save();
        toast(p.hidden ? '글을 숨겼어요.' : '숨김을 해제했어요.');
        render(true);
    },
    toggleBan(el) {
        if (!isAdmin()) return;
        const u = userById(el.dataset.id);
        if (!u || u.role === 'admin') return;
        confirmModal(u.banned ? '이용 제한 해제' : '이용 제한', u.banned ? `${u.nickname}님의 이용 제한을 해제할까요?` : `${u.nickname}님을 이용 제한할까요? 로그인과 글이 모두 차단돼요.`, () => {
            u.banned = !u.banned;
            save();
            toast(u.banned ? '이용을 제한했어요.' : '제한을 해제했어요.');
            render(true);
        }, '확인', !u.banned);
    },
    resolveReport(el) {
        if (!isAdmin()) return;
        const r = db.reports.find(x => x.id === el.dataset.id);
        if (!r) return;
        r.resolved = true;
        notify(r.from, `신고하신 내용(${r.reason})이 처리되었어요. 감사합니다.`, '#/');
        save();
        render(true);
    },
    exportAll() {
        if (!isAdmin()) return;
        download(`kyt-backup-${dateAfter(0)}.json`, db);
    },
    resetAll() {
        if (!isAdmin()) return;
        confirmModal('전체 초기화', '모든 데이터가 삭제되고 예시 데이터로 다시 채워져요. 계속할까요?', async () => {
            await seed();
            setSession(null);
            toast('초기화했어요. 다시 로그인해 주세요.');
            go('#/login');
        }, '초기화', true);
    },
};

/* ---------- 폼 제출 ---------- */
const forms = {
    async login(f, fd) {
        const loginId = String(fd.get('loginId') || '').trim().toLowerCase();
        const pw = String(fd.get('password') || '');
        const u = db.users.find(x => x.loginId === loginId);
        if (!u || (await hashPw(pw, u.salt)) !== u.pwHash) return showFormError(f, '아이디 또는 비밀번호가 맞지 않아요.');
        if (u.banned) return showFormError(f, '운영 정책 위반으로 이용이 제한된 계정이에요.');
        setSession(u.id);
        toast(`${u.nickname}님, 반가워요!`);
        const next = String(fd.get('next') || '');
        go(next.startsWith('#/') && !next.startsWith('#/login') ? next : '#/');
    },
    async signup(f, fd) {
        const loginId = String(fd.get('loginId') || '').trim().toLowerCase();
        const pw = String(fd.get('password') || '');
        const nickname = String(fd.get('nickname') || '').trim();
        const year = String(fd.get('year') || '').trim();
        const school = String(fd.get('school') || 'ETC');
        if (!/^[a-z0-9_]{4,20}$/.test(loginId)) return showFormError(f, '아이디는 영문 소문자, 숫자, _ 로 4~20자여야 해요.');
        if (db.users.some(u => u.loginId === loginId)) return showFormError(f, '이미 사용 중인 아이디예요.');
        if (pw.length < 6) return showFormError(f, '비밀번호는 6자 이상이어야 해요.');
        if (pw !== fd.get('password2')) return showFormError(f, '비밀번호 확인이 일치하지 않아요.');
        if (nickname.length < 2 || nickname.length > 12) return showFormError(f, '닉네임은 2~12자여야 해요.');
        if (db.users.some(u => u.nickname === nickname)) return showFormError(f, '이미 사용 중인 닉네임이에요.');
        if (year && !/^\d{2}$/.test(year)) return showFormError(f, '학번은 숫자 2자리로 입력해 주세요. (예: 24)');
        if (!SCHOOLS[school]) return showFormError(f, '소속 학교를 선택해 주세요.');
        if (!fd.get('agree')) return showFormError(f, '운영 원칙에 동의해 주세요.');
        const salt = uid();
        const u = { id: uid(), loginId, salt, pwHash: await hashPw(pw, salt), nickname, school, year, role: 'user', createdAt: now() };
        db.users.push(u);
        notify(u.id, '가입을 환영해요! 안전거래 수칙을 먼저 확인해 주세요.', '#/guide');
        if (!save()) return;
        setSession(u.id);
        toast('가입이 완료되었어요!');
        const next = String(fd.get('next') || '');
        go(next.startsWith('#/') && !next.startsWith('#/login') ? next : '#/');
    },
    post(f, fd) {
        const u = me();
        const id = fd.get('id');
        const existing = id ? postById(id) : null;
        if (id && (!existing || existing.authorId !== u.id)) return showFormError(f, '수정할 수 없는 글이에요.');
        const data = {
            kind: fd.get('kind') === 'buy' ? 'buy' : 'sell',
            sport: SPORTS.some(s => s.id === fd.get('sport')) ? fd.get('sport') : 'package',
            eventDate: String(fd.get('eventDate') || ''),
            seat: SEATS[fd.get('seat')] ? fd.get('seat') : 'etc',
            qty: Math.max(1, Math.min(CONFIG.maxQty, parseInt(fd.get('qty'), 10) || 1)),
            price: parseInt(fd.get('price'), 10),
            faceValue: parseInt(fd.get('faceValue'), 10),
            methods: fd.getAll('methods').filter(m => METHODS[m]),
            place: String(fd.get('place') || '').trim().slice(0, 40),
            title: String(fd.get('title') || '').trim().slice(0, 50),
            desc: String(fd.get('desc') || '').trim().slice(0, 1000),
            images: draftImages.slice(0, CONFIG.maxImages),
        };
        if (!data.eventDate) return showFormError(f, '경기일을 선택해 주세요.');
        if (!Number.isFinite(data.faceValue) || data.faceValue <= 0) return showFormError(f, '정가를 입력해 주세요.');
        if (!Number.isFinite(data.price) || data.price < 0) return showFormError(f, '거래 가격을 입력해 주세요.');
        if (data.price > data.faceValue * CONFIG.maxPriceRatio) {
            return showFormError(f, `정가(${won(data.faceValue)})를 초과하는 가격은 등록할 수 없어요. 암표 거래는 금지되어 있어요.`);
        }
        if (!data.methods.length) return showFormError(f, '거래 방법을 하나 이상 선택해 주세요.');
        if (data.title.length < 4) return showFormError(f, '제목을 4자 이상 입력해 주세요.');

        let p;
        if (existing) {
            p = Object.assign(existing, data, { updatedAt: now() });
        } else {
            const t = now();
            p = Object.assign({ id: uid(), authorId: u.id, status: 'open', partnerId: null, hidden: false, views: 0, createdAt: t, updatedAt: t, bumpedAt: t }, data);
            db.posts.push(p);
            // 같은 종목의 반대 글(팝니다↔삽니다)을 찜한 사람들에게 알림
            const watchers = new Set();
            db.posts.filter(x => x.sport === p.sport && x.kind !== p.kind && x.status === 'open' && x.authorId !== u.id).forEach(x => watchers.add(x.authorId));
            watchers.forEach(w => notify(w, `${sportOf(p.sport).emoji} ${sportOf(p.sport).name} 새 ${p.kind === 'sell' ? '양도' : '구매'} 글: ${p.title}`, '#/post/' + p.id));
        }
        if (!save()) {
            if (!existing) db.posts = db.posts.filter(x => x.id !== p.id);
            return;
        }
        draftImages = [];
        toast(existing ? '수정했어요.' : '등록했어요!');
        go('#/post/' + p.id);
    },
    chat(f, fd) {
        const u = me();
        const c = chatById(fd.get('chatId'));
        const text = String(fd.get('text') || '').trim().slice(0, 1000);
        if (!c || !text) return;
        const first = !c.messages.some(m => m.from === u.id);
        c.messages.push({ id: uid(), from: u.id, text, at: now() });
        c.lastRead[u.id] = now();
        if (first && c.otherId === u.id) {
            const p = postById(c.postId);
            notify(c.ownerId, `${u.nickname}님이 '${p?.title || '거래글'}'에 채팅을 보냈어요.`, '#/chat/' + c.id);
        }
        save();
        render();
        $('#msg')?.focus();
    },
    review(f, fd) {
        const u = me();
        const p = postById(fd.get('postId'));
        if (!p || p.status !== 'done' || !p.partnerId) return;
        const to = u.id === p.authorId ? p.partnerId : (u.id === p.partnerId ? p.authorId : null);
        if (!to || db.reviews.some(r => r.postId === p.id && r.from === u.id)) return;
        const rating = Math.max(1, Math.min(5, parseInt(fd.get('rating'), 10) || 5));
        db.reviews.push({ id: uid(), postId: p.id, from: u.id, to, rating, text: String(fd.get('text') || '').trim().slice(0, 200), at: now() });
        notify(to, `${u.nickname}님이 거래 후기(★${rating})를 남겼어요.`, '#/me/reviews');
        save();
        toast('후기를 등록했어요. 감사합니다!');
        render();
    },
    report(f, fd) {
        const u = me();
        const postId = String(fd.get('postId') || '') || null;
        const userId = String(fd.get('userId') || '') || null;
        if (db.reports.some(r => r.from === u.id && !r.resolved && r.postId === postId && r.userId === userId)) {
            closeModal();
            return toast('이미 접수된 신고예요. 검토 중이에요.');
        }
        db.reports.push({ id: uid(), from: u.id, postId, userId, reason: String(fd.get('reason') || '기타'), detail: String(fd.get('detail') || '').trim().slice(0, 300), at: now(), resolved: false });
        db.users.filter(x => x.role === 'admin').forEach(a => notify(a.id, `새 신고가 접수되었어요: ${fd.get('reason')}`, '#/admin'));
        save();
        closeModal();
        toast('신고가 접수되었어요. 검토 후 조치할게요.');
    },
    setPartner(f, fd) {
        const p = postById(fd.get('postId'));
        if (!p || p.authorId !== me()?.id) return;
        const status = fd.get('status') === 'done' ? 'done' : 'reserved';
        changeStatus(p, status, String(fd.get('partnerId') || '') || null);
        closeModal();
        toast(status === 'done' ? '거래 완료로 변경했어요.' : '예약중으로 변경했어요.');
        render(true);
    },
    profile(f, fd) {
        const u = me();
        const nickname = String(fd.get('nickname') || '').trim();
        const year = String(fd.get('year') || '').trim();
        const school = String(fd.get('school') || u.school);
        if (nickname.length < 2 || nickname.length > 12) return toast('닉네임은 2~12자여야 해요.');
        if (db.users.some(x => x.id !== u.id && x.nickname === nickname)) return toast('이미 사용 중인 닉네임이에요.');
        if (year && !/^\d{2}$/.test(year)) return toast('학번은 숫자 2자리로 입력해 주세요.');
        Object.assign(u, { nickname, year, school: SCHOOLS[school] ? school : u.school });
        save();
        toast('프로필을 저장했어요.');
        render();
    },
    async password(f, fd) {
        const u = me();
        if ((await hashPw(String(fd.get('current') || ''), u.salt)) !== u.pwHash) return toast('현재 비밀번호가 맞지 않아요.');
        const next = String(fd.get('next') || '');
        if (next.length < 6) return toast('새 비밀번호는 6자 이상이어야 해요.');
        if (next !== fd.get('next2')) return toast('새 비밀번호 확인이 일치하지 않아요.');
        u.salt = uid();
        u.pwHash = await hashPw(next, u.salt);
        save();
        f.reset();
        toast('비밀번호를 변경했어요.');
    },
};

/* ---------- 이벤트 연결 ---------- */
document.addEventListener('click', e => {
    if (e.target.classList?.contains('modal-back')) return closeModal();
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const fn = actions[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el, e); }
});

document.addEventListener('submit', e => {
    const f = e.target;
    const fn = forms[f.dataset.form];
    if (!fn) return;
    e.preventDefault();
    const btn = f.querySelector('button:not([type="button"])');
    if (btn) btn.disabled = true;
    Promise.resolve(fn(f, new FormData(f))).finally(() => { if (btn && btn.isConnected) btn.disabled = false; });
});

document.addEventListener('input', e => {
    const key = e.target.dataset?.filter;
    if (!key) return;
    filters[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    const r = $('#results');
    if (r) r.innerHTML = resultsHTML();
});

document.addEventListener('change', async e => {
    if (e.target.id === 'imgInput') {
        const files = [...e.target.files];
        e.target.value = '';
        for (const file of files) {
            if (draftImages.length >= CONFIG.maxImages) { toast(`사진은 최대 ${CONFIG.maxImages}장까지 올릴 수 있어요.`); break; }
            try { draftImages.push(await resizeImage(file)); } catch (err) { toast(err.message); }
        }
        const box = $('#imgPreviews');
        if (box) box.innerHTML = imgPreviewsHTML();
    }
    if (e.target.id === 'importInput') {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file || !isAdmin()) return;
        try {
            const data = JSON.parse(await file.text());
            if (!Array.isArray(data.users) || !Array.isArray(data.posts)) throw new Error();
            confirmModal('백업 복원', '현재 데이터를 백업 파일 내용으로 덮어쓸까요?', () => {
                db = Object.assign(blankDb(), data);
                save();
                toast('복원했어요.');
                render();
            }, '복원', true);
        } catch { toast('올바른 백업 파일이 아니에요.'); }
    }
});

document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('#modal-root').innerHTML) closeModal();
    // 채팅: Enter 전송, Shift+Enter 줄바꿈
    if (e.target.id === 'msg' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        e.target.form.requestSubmit();
    }
});

window.addEventListener('hashchange', () => { closeModal(); render(); });

// 다른 탭에서 데이터가 바뀌면 동기화 (새 채팅 메시지 등)
window.addEventListener('storage', e => {
    if (e.key !== DATA_KEY && e.key !== SESSION_KEY) return;
    loadDb() || (db = blankDb());
    render(true);
});

// 상대적 시간 표시 갱신
setInterval(() => { if (!$('#modal-root').innerHTML) render(true); }, 60000);

/* ---------- 시작 ---------- */
(async function init() {
    if (!loadDb()) await seed();
    render();
})();
