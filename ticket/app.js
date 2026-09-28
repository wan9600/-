/* =========================================================
 * 고연전 티켓 장터 (Firebase 버전)
 * - 로그인: Firebase Authentication (학교 메일 + 메일 인증)
 * - 데이터: Cloud Firestore (실시간 동기화)
 * - 권한 검사: firestore.rules
 * ========================================================= */
import * as FB from './firebase.js';
import { firebaseConfig, SCHOOL_DOMAINS } from './firebase-config.js';

/* ---------- 설정 ---------- */
const CONFIG = {
    maxPriceRatio: 1.0,      // 정가 대비 허용 최대 가격 (firestore.rules 에서도 정가 초과를 막는다)
    maxQty: 4,
    maxImages: 3,
    bumpCooldownMin: 60,
    eventStart: null,        // 'YYYY-MM-DD' 로 지정하면 상단에 D-day 표시
    listLimit: 300,          // 목록에 불러올 최대 글 수
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
const SCHOOLS = { KU: '고려대', YU: '연세대' };
const REPORT_REASONS = ['사기 의심', '정가 초과(암표)', '허위 매물', '욕설/비매너', '개인정보 노출', '기타'];
const QUICK_REPLIES = ['아직 거래 가능한가요?', '직거래 장소 조율 가능할까요?', '좌석 위치 알 수 있을까요?', '예약 부탁드려요!'];
const SCAM_PATTERN = /(\d{2,6}-\d{2,6}-\d{2,8})|계좌|선입금|입금\s*먼저|카톡\s*아이디|오픈\s*채팅|문화상품권/;

/* ---------- 유틸 ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
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
function starText(r) { const n = Math.round(r); return '★'.repeat(n) + '☆'.repeat(5 - n); }
function safeImg(src) { return typeof src === 'string' && src.startsWith('data:image/') ? src : ''; }
function schoolOfEmail(email) {
    const domain = String(email || '').toLowerCase().split('@')[1] || '';
    return SCHOOL_DOMAINS[domain] || null;
}

function resizeImage(file, max = 900) {
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
            resolve(c.toDataURL('image/jpeg', 0.65));
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 읽을 수 없어요.')); };
        img.src = url;
    });
}

/* ---------- Firebase 연결 ---------- */
const EMULATOR = new URLSearchParams(location.search).has('emulator');
const CONFIGURED = EMULATOR || Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
let auth = null;
let fs = null;

if (CONFIGURED) {
    const app = FB.initializeApp(EMULATOR
        ? { apiKey: 'demo-key', authDomain: 'demo-kyt.firebaseapp.com', projectId: 'demo-kyt' }
        : firebaseConfig);
    auth = FB.getAuth(app);
    auth.languageCode = 'ko';
    fs = FB.getFirestore(app);
    if (EMULATOR) {
        FB.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
        FB.connectFirestoreEmulator(fs, '127.0.0.1', 8080);
    }
}
const col = (...p) => FB.collection(fs, ...p);
const ref = (...p) => FB.doc(fs, ...p);
const withId = d => ({ id: d.id, ...d.data() });

/* ---------- 상태 (Firestore 데이터를 담아두는 캐시) ---------- */
const session = {
    ready: false,          // 첫 로그인 상태 확인 완료
    user: null,            // Firebase Auth 사용자
    profileLoaded: false,
    profile: null,         // users/{uid}
    verified: false,       // 학교 메일 인증 여부
    admin: false,
    postsLoaded: false,
    indexUrl: null,        // Firestore 색인이 필요할 때 만들기 링크
};
const postSources = { extra: new Map(), public: new Map(), admin: new Map(), mine: new Map(), page: new Map() };
const db = {
    posts: new Map(),
    missing: new Set(),     // 없거나 볼 수 없는 글 id
    users: new Map(),       // uid -> 프로필 (null = 없음)
    chats: new Map(),
    messages: new Map(),    // chatId -> 메시지 배열
    notifs: [],
    favs: [],
    reviewsTo: new Map(),   // uid -> 받은 후기
    reviewsPost: new Map(), // postId -> 후기
    images: new Map(),      // postId -> 이미지 배열
    reports: [],
    allUsers: null,         // 관리자 페이지용
};
let userSubs = [];

function rebuildPosts() {
    db.posts = new Map();
    for (const src of Object.values(postSources)) for (const [id, p] of src) db.posts.set(id, p);
}
function fillMap(map, snap) {
    map.clear();
    snap.forEach(d => map.set(d.id, withId(d)));
}

let renderQueued = false;
function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    setTimeout(() => { renderQueued = false; render(true); }, 0);
}

function listen(target, onData, onError) {
    return FB.onSnapshot(target, onData, err => {
        console.warn('[firestore]', err.code, err.message);
        const m = /https:\/\/console\.firebase\.google\.com\S+/.exec(err.message || '');
        if (err.code === 'failed-precondition' && m) session.indexUrl = m[0];
        if (onError) onError(err);
        scheduleRender();
    });
}

/* 페이지 단위 구독: 다른 화면으로 가면 자동 해제 */
let page = { key: null, subs: [] };
let pageTouched = false;
function usePage(key, setup) {
    pageTouched = true;
    if (page.key === key) return;
    cleanupPage();
    page.key = key;
    setup(unsub => page.subs.push(unsub));
}
function cleanupPage() {
    page.subs.forEach(u => { try { u(); } catch { /* 무시 */ } });
    page = { key: null, subs: [] };
    if (postSources.page.size) { postSources.page.clear(); rebuildPosts(); }
}

function startPublicListeners() {
    const q = FB.query(col('posts'), FB.where('hidden', '==', false), FB.orderBy('bumpedAt', 'desc'), FB.limit(CONFIG.listLimit));
    listen(q, snap => {
        fillMap(postSources.public, snap);
        session.postsLoaded = true;
        rebuildPosts();
        scheduleRender();
    }, () => { session.postsLoaded = true; });
}

function startUserListeners(user) {
    userSubs.forEach(u => u());
    userSubs = [];
    db.chats.clear(); db.messages.clear(); db.notifs = []; db.favs = []; db.reports = [];
    postSources.mine.clear(); postSources.admin.clear(); rebuildPosts();
    session.admin = false;
    if (!user) return;
    const uid = user.uid;

    userSubs.push(listen(ref('users', uid), snap => {
        session.profileLoaded = true;
        session.profile = snap.exists() ? { id: uid, ...snap.data(), email: user.email } : null;
        db.users.set(uid, snap.exists() ? { id: uid, ...snap.data() } : null);
        if (session.profile?.banned) {
            toast('운영 정책 위반으로 이용이 제한된 계정이에요.');
            FB.signOut(auth);
            return;
        }
        scheduleRender();
    }, () => { session.profileLoaded = true; }));

    userSubs.push(listen(ref('privates', uid), snap => {
        db.favs = snap.exists() ? (snap.data().favs || []) : [];
        scheduleRender();
    }));
    userSubs.push(listen(FB.query(col('posts'), FB.where('authorId', '==', uid)), snap => {
        fillMap(postSources.mine, snap);
        rebuildPosts();
        scheduleRender();
    }));
    userSubs.push(listen(FB.query(col('chats'), FB.where('members', 'array-contains', uid)), snap => {
        db.chats.clear();
        snap.forEach(d => db.chats.set(d.id, withId(d)));
        scheduleRender();
    }));
    userSubs.push(listen(FB.query(col('users', uid, 'notifs'), FB.orderBy('at', 'desc'), FB.limit(50)), snap => {
        db.notifs = snap.docs.map(withId);
        scheduleRender();
    }));

    FB.getDoc(ref('admins', uid)).then(snap => {
        if (!snap.exists() || auth.currentUser?.uid !== uid) return;
        session.admin = true;
        userSubs.push(listen(FB.query(col('posts'), FB.orderBy('bumpedAt', 'desc'), FB.limit(CONFIG.listLimit)), s => {
            fillMap(postSources.admin, s);
            rebuildPosts();
            scheduleRender();
        }));
        userSubs.push(listen(FB.query(col('reports'), FB.orderBy('at', 'desc'), FB.limit(200)), s => {
            db.reports = s.docs.map(withId);
            scheduleRender();
        }));
        scheduleRender();
    }).catch(() => {});
}

/* 필요할 때 불러오는 데이터 */
const pending = new Set();
function userById(id) {
    if (!id) return null;
    if (db.users.has(id)) return db.users.get(id);
    if (!pending.has('u' + id)) {
        pending.add('u' + id);
        FB.getDoc(ref('users', id))
            .then(s => db.users.set(id, s.exists() ? { id, ...s.data() } : null))
            .catch(() => db.users.set(id, null))
            .finally(() => { pending.delete('u' + id); scheduleRender(); });
    }
    return undefined;   // 불러오는 중
}
function postById(id) {
    if (db.posts.has(id)) return db.posts.get(id);
    if (!db.missing.has(id) && !pending.has('p' + id)) {
        pending.add('p' + id);
        FB.getDoc(ref('posts', id))
            .then(s => { if (s.exists()) { postSources.extra.set(id, withId(s)); rebuildPosts(); } else db.missing.add(id); })
            .catch(() => db.missing.add(id))
            .finally(() => { pending.delete('p' + id); scheduleRender(); });
    }
    return undefined;
}
function loadReviewsTo(uid, force = false) {
    if (!uid || (!force && (db.reviewsTo.has(uid) || pending.has('r' + uid)))) return;
    pending.add('r' + uid);
    FB.getDocs(FB.query(col('reviews'), FB.where('to', '==', uid)))
        .then(s => db.reviewsTo.set(uid, s.docs.map(withId).sort((a, b) => b.at - a.at)))
        .catch(() => db.reviewsTo.set(uid, []))
        .finally(() => { pending.delete('r' + uid); scheduleRender(); });
}

/* ---------- 조회 도우미 ---------- */
function me() {
    return session.user && session.profile && !session.profile.banned ? session.profile : null;
}
const isAdmin = () => Boolean(me() && session.admin);
const postsList = () => [...db.posts.values()];
const isFav = postId => db.favs.includes(postId);
const chatsList = () => [...db.chats.values()].filter(Boolean);
const partnerOf = (chat, userId) => (chat.ownerId === userId ? chat.otherId : chat.ownerId);
const chatUnread = (c, userId) => Boolean(c.lastFrom && c.lastFrom !== userId && (c.lastAt || 0) > (c.lastRead?.[userId] || 0));
const totalUnread = userId => chatsList().filter(c => chatUnread(c, userId)).length;
const chatIdFor = (postId, otherId) => `${postId}_${otherId}`;

function ratingOf(userId) {
    loadReviewsTo(userId);
    const rs = db.reviewsTo.get(userId) || [];
    const avg = rs.length ? rs.reduce((s, r) => s + r.rating, 0) / rs.length : 0;
    return { avg, count: rs.length };
}
function tradesOf(userId) {
    return postsList().filter(p => p.status === 'done' && (p.authorId === userId || p.partnerId === userId));
}
function visiblePost(p) {
    if (!p || p.hidden) return false;
    const author = db.users.get(p.authorId);
    return !(author && author.banned);
}

function errorText(e) {
    const code = e?.code || '';
    const map = {
        'permission-denied': '권한이 없어요. 학교 메일 인증 여부나 입력값을 확인해 주세요.',
        'unavailable': '서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.',
        'auth/invalid-credential': '이메일 또는 비밀번호가 맞지 않아요.',
        'auth/wrong-password': '비밀번호가 맞지 않아요.',
        'auth/user-not-found': '가입되지 않은 이메일이에요.',
        'auth/email-already-in-use': '이미 가입된 이메일이에요. 로그인하거나 비밀번호를 재설정해 주세요.',
        'auth/weak-password': '비밀번호는 6자 이상이어야 해요.',
        'auth/invalid-email': '이메일 형식이 올바르지 않아요.',
        'auth/too-many-requests': '시도가 너무 많아요. 잠시 후 다시 시도해 주세요.',
        'auth/requires-recent-login': '보안을 위해 다시 로그인한 뒤 시도해 주세요.',
        'auth/network-request-failed': '네트워크 오류가 발생했어요.',
    };
    return map[code] || '문제가 발생했어요. 잠시 후 다시 시도해 주세요.';
}
function fail(e, form) {
    console.warn(e);
    if (form) showFormError(form, errorText(e));
    else toast(errorText(e));
}

function notify(userId, text, link) {
    const u = me();
    if (!userId || !u || userId === u.id) return;
    FB.addDoc(col('users', userId, 'notifs'), { text: text.slice(0, 200), link, at: now(), read: false, from: u.id }).catch(() => {});
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
    ['/verify', viewVerify],
];
const FORM_VIEWS = new Set([viewForm, viewLogin, viewSignup, viewProfileSetup]);

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
function requireVerified() {
    if (!me()) { requireLogin(); return false; }
    if (!session.verified) {
        toast('학교 메일 인증을 먼저 완료해 주세요.');
        go('#/verify');
        return false;
    }
    return true;
}

let afterRender = null;
const loadingHTML = '<div class="empty"><div class="big">⏳</div><div>불러오는 중...</div></div>';

function render(soft = false) {
    renderHeader();
    const appEl = $('#app');
    if (!CONFIGURED) { appEl.innerHTML = viewSetupNeeded(); return; }
    if (!session.ready) { appEl.innerHTML = loadingHTML; return; }

    const { path } = parseHash();
    let { view, params, opt } = matchRoute(path);
    if (opt.auth) {
        if (!session.user) { requireLogin(); return; }
        if (!session.profileLoaded) { appEl.innerHTML = loadingHTML; return; }
        if (!session.profile) { view = viewProfileSetup; params = []; }
    }
    if (opt.admin && !isAdmin()) { view = viewNotFound; params = []; }

    // 작성 중인 폼은 데이터 갱신으로 덮어쓰지 않는다
    if (soft && FORM_VIEWS.has(view) && $('#app form')) return;
    if (soft && view === viewMe && params[0] === 'settings' && $('#app form')) return;
    const keepForm = $('#app form[data-keep]');
    if (soft && keepForm && (keepForm.contains(document.activeElement) || [...keepForm.querySelectorAll('textarea')].some(t => t.value))) return;

    let keep = null;
    const active = document.activeElement;
    if (soft && active && active.id && 'value' in active) {
        keep = { id: active.id, value: active.value, pos: active.selectionStart };
    }
    const chatBody = $('#chatBody');
    const wasAtBottom = chatBody ? chatBody.scrollHeight - chatBody.scrollTop - chatBody.clientHeight < 40 : true;

    afterRender = null;
    pageTouched = false;
    const html = view(...params);
    if (!pageTouched && page.key) cleanupPage();

    const banners = [];
    if (session.indexUrl) {
        banners.push(`<div class="notice">데이터베이스 색인이 필요해요. 사이트 관리자라면 <a href="${esc(session.indexUrl)}" target="_blank" rel="noopener"><u>이 링크</u></a>에서 색인을 만들어 주세요. (몇 분 걸려요)</div>`);
    }
    if (me() && !session.verified && view !== viewVerify) {
        banners.push(`<div class="notice">📧 학교 메일 인증을 완료해야 글쓰기·채팅을 할 수 있어요. <a href="#/verify"><u>인증하기</u></a></div>`);
    }
    appEl.innerHTML = banners.join('') + html;
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
    if (afterRender) afterRender({ soft, wasAtBottom });
}

function renderHeader() {
    const u = me();
    const unread = u ? totalUnread(u.id) : 0;
    const notifs = u ? db.notifs.filter(n => !n.read).length : 0;
    const reports = isAdmin() ? db.reports.filter(r => !r.resolved).length : 0;
    const badge = n => (n ? `<span class="count-badge">${n > 99 ? '99+' : n}</span>` : '');
    const path = parseHash().path;
    const on = p => (path === p || (p !== '/' && path.startsWith(p)) ? ' active' : '');
    let right;
    if (u) {
        right = `
            ${isAdmin() ? `<a href="#/admin" class="nav-link${on('/admin')}">관리${reports ? ` <span class="tab-count">${reports}</span>` : ''}</a>` : ''}
            <a href="#/chats" class="icon-btn" title="채팅" aria-label="안 읽은 채팅 ${unread}개">💬${badge(unread)}</a>
            <a href="#/notifs" class="icon-btn" title="알림" aria-label="새 알림 ${notifs}개">🔔${badge(notifs)}</a>
            <a href="#/me" class="icon-btn" title="${esc(u.nickname)}" aria-label="내 정보">👤</a>
            <a href="#/new" class="btn btn-primary btn-sm">글쓰기</a>`;
    } else if (session.user) {
        right = `<button class="nav-link btn-ghost" style="border:0;cursor:pointer" data-act="logout">로그아웃</button>`;
    } else {
        right = `<a href="#/login" class="nav-link">로그인</a><a href="#/signup" class="btn btn-primary btn-sm">회원가입</a>`;
    }
    $('#topbar').innerHTML = `
        <a class="brand" href="#/"><span class="brand-mark">🐯🦅</span><span class="brand-name"><span class="ku">고연전</span> <span class="yu">티켓 장터</span></span></a>
        <nav class="nav">
            <a href="#/" class="nav-link${on('/')}">거래글</a>
            <a href="#/guide" class="nav-link nav-hide-sm${on('/guide')}">이용안내</a>
            ${right}
        </nav>`;
}

/* ---------- 공용 조각 ---------- */
function nick(u) { return u === undefined ? '…' : esc(u?.nickname || '탈퇴한 사용자'); }
function schoolBadge(u) {
    if (!u) return '';
    const s = SCHOOLS[u.school] ? u.school : 'ETC';
    return `<span class="school school-${s}">${SCHOOLS[s] || '기타'}${u.year ? ' ' + esc(u.year) : ''}</span>`;
}
function avatar(u) {
    const s = SCHOOLS[u?.school] ? u.school : 'ETC';
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
    return `
    <a class="card post-card ${p.status}" href="#/post/${esc(p.id)}">
        <div class="pc-top">${kindBadge(p)} ${statusBadge(p)} ${p.hidden ? '<span class="badge badge-hidden">숨김</span>' : ''}${p.imageCount ? `<span class="pc-thumb">📷 ${p.imageCount}</span>` : ''}</div>
        <div class="pc-sport">${sp.emoji} ${sp.name} · ${fmtDate(p.eventDate)}</div>
        <h3 class="pc-title">${esc(p.title)}</h3>
        <div class="pc-meta">${SEATS[p.seat] || '기타'} · ${p.qty}매 · ${(p.methods || []).map(m => METHODS[m]).join('/')}</div>
        <div class="pc-price"><span class="price">${won(p.price)}</span><span class="muted small">/ 1매</span>${discountTag(p)}</div>
        <div class="pc-foot">${schoolBadge(author)} ${nick(author)} · ${timeAgo(p.bumpedAt || p.createdAt)}
            <span class="pc-counts">♡ ${p.favCount || 0} · 💬 ${p.chatCount || 0}</span></div>
    </a>`;
}

/* ---------- 목록 ---------- */
const filters = { kind: 'all', sport: 'all', q: '', sort: 'recent', openOnly: true };

function filteredPosts() {
    const q = filters.q.trim().toLowerCase();
    let list = postsList().filter(visiblePost);
    if (filters.kind !== 'all') list = list.filter(p => p.kind === filters.kind);
    if (filters.sport !== 'all') list = list.filter(p => p.sport === filters.sport);
    if (filters.openOnly) list = list.filter(p => p.status !== 'done');
    if (q) {
        list = list.filter(p => {
            const hay = [p.title, p.desc, p.place, SEATS[p.seat], sportOf(p.sport).name, db.users.get(p.authorId)?.nickname].join(' ').toLowerCase();
            return hay.includes(q);
        });
    }
    const sorters = {
        recent: (a, b) => (b.bumpedAt || b.createdAt) - (a.bumpedAt || a.createdAt),
        priceAsc: (a, b) => a.price - b.price,
        priceDesc: (a, b) => b.price - a.price,
        popular: (a, b) => (b.favCount || 0) - (a.favCount || 0) || (b.views || 0) - (a.views || 0),
        date: (a, b) => String(a.eventDate).localeCompare(String(b.eventDate)),
    };
    return list.sort(sorters[filters.sort] || sorters.recent);
}

function resultsHTML() {
    if (!session.postsLoaded) return loadingHTML;
    const list = filteredPosts();
    if (!list.length) {
        return emptyState('🎫', '조건에 맞는 거래글이 없어요.', me() ? '<a class="btn btn-primary" href="#/new">첫 글 올리기</a>' : '');
    }
    return `<div class="result-bar"><span class="muted">${list.length}개의 거래글</span></div>
        <div class="post-grid">${list.map(postCard).join('')}</div>`;
}

function viewList() {
    const live = postsList().filter(visiblePost);
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
        <p>학교 메일로 인증한 고려대·연세대 학생들만 거래할 수 있어요. 정가를 넘는 가격(암표)은 등록할 수 없고, 채팅으로 바로 거래해요.</p>
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
            <select class="input" id="sort" data-filter="sort" aria-label="정렬">
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
    usePage('post:' + id, add => {
        add(listen(ref('posts', id), snap => {
            if (snap.exists()) { postSources.page.set(id, withId(snap)); db.missing.delete(id); }
            else { postSources.page.delete(id); postSources.extra.delete(id); db.missing.add(id); }
            rebuildPosts();
            scheduleRender();
        }, () => db.missing.add(id)));
        add(listen(FB.query(col('reviews'), FB.where('postId', '==', id)), snap => {
            db.reviewsPost.set(id, snap.docs.map(withId));
            scheduleRender();
        }));
        FB.getDoc(ref('postImages', id))
            .then(s => db.images.set(id, s.exists() ? (s.data().images || []) : []))
            .catch(() => db.images.set(id, []))
            .finally(scheduleRender);
    });

    const p = db.posts.get(id);
    const u = me();
    if (!p) return db.missing.has(id) ? viewNotFound('삭제되었거나 볼 수 없는 글이에요.') : loadingHTML;
    const isOwner = u && u.id === p.authorId;

    // 조회수: 탭당 1회
    try {
        const k = 'kyt-viewed-' + p.id;
        if (!sessionStorage.getItem(k) && !isOwner) {
            sessionStorage.setItem(k, '1');
            FB.updateDoc(ref('posts', p.id), { views: FB.increment(1) }).catch(() => {});
        }
    } catch { /* 무시 */ }

    viewPost.title = p.title;
    const sp = sportOf(p.sport);
    const author = userById(p.authorId);
    const rating = ratingOf(p.authorId);
    const myChat = u && !isOwner ? db.chats.get(chatIdFor(p.id, u.id)) : null;
    const fav = u && isFav(p.id);
    const partner = p.partnerId ? userById(p.partnerId) : null;
    const postReviews = db.reviewsPost.get(p.id) || [];
    const canReview = u && p.status === 'done' && p.partnerId && (u.id === p.authorId || u.id === p.partnerId)
        && db.reviewsPost.has(p.id) && !postReviews.some(r => r.from === u.id);
    const counterpartLabel = p.kind === 'sell' ? '구매자' : '판매자';
    const images = db.images.get(p.id) || [];
    const similar = postsList().filter(x => x.id !== p.id && visiblePost(x) && x.sport === p.sport && x.status !== 'done').slice(0, 3);

    let actions = '';
    if (isOwner) {
        actions = `<a class="btn btn-block" href="#/chats">💬 받은 채팅 ${p.chatCount || 0}개 보기</a>`;
    } else if (p.status === 'done') {
        actions = `<button class="btn btn-block" disabled>거래가 완료된 글이에요</button>`;
    } else {
        actions = `
            <button class="btn btn-primary btn-block" data-act="startChat" data-id="${esc(p.id)}">💬 ${myChat ? '채팅 이어하기' : (p.kind === 'sell' ? '채팅으로 구매 문의' : '채팅으로 판매 제안')}</button>`;
    }
    if (!isOwner) {
        actions += `
            <div class="row">
                <button class="btn ${fav ? 'on' : ''}" style="flex:1" data-act="toggleFav" data-id="${esc(p.id)}">${fav ? '♥ 찜함' : '♡ 찜하기'} ${p.favCount || 0}</button>
                <button class="btn" data-act="share" data-id="${esc(p.id)}" title="링크 복사">🔗</button>
                <button class="btn btn-danger" data-act="report" data-id="${esc(p.id)}" title="신고">🚨</button>
            </div>`;
    } else {
        actions += `<button class="btn btn-block" data-act="share" data-id="${esc(p.id)}">🔗 링크 복사</button>`;
    }

    const ownerTools = isOwner ? `
        <div class="card owner-tools">
            <h4>거래 상태 관리</h4>
            <div class="status-btns">
                ${Object.entries(STATUS).map(([k, l]) => `<button class="btn btn-sm ${p.status === k ? 'on' : ''}" data-act="setStatus" data-id="${esc(p.id)}" data-v="${k}">${l}</button>`).join('')}
            </div>
            ${p.partnerId ? `<p class="small muted" style="margin:0 0 10px">${counterpartLabel}: <a href="#/user/${esc(p.partnerId)}"><b>${nick(partner)}</b></a></p>` : ''}
            <div class="row">
                <a class="btn btn-sm" href="#/edit/${esc(p.id)}">✏️ 수정</a>
                <button class="btn btn-sm" data-act="bump" data-id="${esc(p.id)}" ${p.status === 'done' ? 'disabled' : ''}>⬆️ 끌어올리기</button>
                <button class="btn btn-sm btn-danger" data-act="deletePost" data-id="${esc(p.id)}">삭제</button>
            </div>
        </div>` : '';

    const adminTools = isAdmin() && !isOwner ? `
        <div class="card owner-tools">
            <h4>관리자</h4>
            <button class="btn btn-sm btn-block ${p.hidden ? '' : 'btn-danger'}" data-act="toggleHide" data-id="${esc(p.id)}">${p.hidden ? '숨김 해제' : '글 숨기기'}</button>
        </div>` : '';

    const reviewTarget = canReview ? userById(u.id === p.authorId ? p.partnerId : p.authorId) : null;
    const reviewForm = canReview ? `
        <form class="card card-pad" data-form="review" data-keep style="margin-top:16px">
            <input type="hidden" name="postId" value="${esc(p.id)}">
            <h3 style="font-size:16px;margin-bottom:8px">거래 후기 남기기</h3>
            <p class="small muted" style="margin:0 0 8px">${nick(reviewTarget)}님과의 거래는 어떠셨나요?</p>
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
                ${images.length ? `<div class="gallery">${images.map((src, i) =>
                    `<button data-act="viewImage" data-id="${esc(p.id)}" data-i="${i}" aria-label="이미지 크게 보기"><img src="${esc(safeImg(src))}" alt="티켓 이미지 ${i + 1}"></button>`).join('')}</div>`
                    : (p.imageCount && !db.images.has(p.id) ? '<p class="small muted">사진 불러오는 중...</p>' : '')}
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
            <a class="card author-card" href="#/user/${esc(p.authorId)}">
                ${avatar(author)}
                <div>
                    <div><b>${nick(author)}</b> ${schoolBadge(author)}</div>
                    <div class="small muted">${rating.count ? `<span class="stars">★</span> ${rating.avg.toFixed(1)} (후기 ${rating.count})` : '아직 후기 없음'}</div>
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
    const post = db.posts.get(r.postId);
    return `<div class="review-item">
        <div class="row"><span class="stars">${starText(r.rating)}</span><b>${nick(from)}</b> ${schoolBadge(from)}<span class="spacer"></span><span class="small muted">${timeAgo(r.at)}</span></div>
        ${r.text ? `<div style="margin-top:4px">${esc(r.text)}</div>` : ''}
        ${post ? `<div class="small muted" style="margin-top:2px">거래: <a href="#/post/${esc(post.id)}">${esc(post.title)}</a></div>` : ''}
    </div>`;
}

/* ---------- 글쓰기/수정 ---------- */
let draftImages = [];

function viewForm(id) {
    const u = me();
    let editing = null;
    if (id) {
        usePage('edit:' + id, () => {
            FB.getDoc(ref('postImages', id))
                .then(s => db.images.set(id, s.exists() ? (s.data().images || []) : []))
                .catch(() => db.images.set(id, []))
                .finally(scheduleRender);
        });
        editing = db.posts.get(id);
        if (!editing || !db.images.has(id)) return db.missing.has(id) ? viewNotFound('수정할 수 없는 글이에요.') : loadingHTML;
        if (editing.authorId !== u.id) return viewNotFound('수정할 수 없는 글이에요.');
    }
    viewForm.title = editing ? '글 수정' : '글쓰기';
    const p = editing || { kind: 'sell', sport: 'baseball', eventDate: '', seat: u.school === 'YU' ? 'yu' : 'ku', qty: 1, price: '', faceValue: '', methods: ['meet'], place: '', title: '', desc: '' };
    draftImages = editing ? (db.images.get(id) || []).slice() : [];

    const opt = (obj, sel) => Object.entries(obj).map(([k, l]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${l}</option>`).join('');
    return `
    <div class="mid">
        <h1 class="page-title">${editing ? '거래글 수정' : '거래글 쓰기'}</h1>
        <form class="card card-pad" data-form="post" novalidate>
            ${editing ? `<input type="hidden" name="id" value="${esc(editing.id)}">` : ''}
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
                <a class="btn" href="${editing ? '#/post/' + esc(editing.id) : '#/'}">취소</a>
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
    const list = chatsList().filter(c => c.lastText).sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
    return `
    <div class="mid">
        <h1 class="page-title">채팅</h1>
        ${list.length ? `<div class="card chat-list">${list.map(c => {
            const other = userById(partnerOf(c, u.id));
            const unread = chatUnread(c, u.id);
            return `<a class="chat-row" href="#/chat/${esc(c.id)}">
                ${avatar(other)}
                <div class="body">
                    <div class="row" style="gap:6px"><b>${nick(other)}</b> ${schoolBadge(other)} <span class="small muted">${timeAgo(c.lastAt || c.createdAt)}</span></div>
                    <div class="small muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.postTitle || '거래글')}</div>
                    <div class="last">${esc(c.lastText)}</div>
                </div>
                ${unread ? '<span class="unread">N</span>' : ''}
            </a>`;
        }).join('')}</div>` : emptyState('💬', '아직 채팅이 없어요. 관심 있는 거래글에서 채팅을 시작해 보세요.', '<a class="btn" href="#/">거래글 보기</a>')}
    </div>`;
}

const readMarkedAt = {};
function viewChat(id) {
    const u = me();
    usePage('chat:' + id, add => {
        add(listen(ref('chats', id), snap => {
            db.chats.set(id, snap.exists() ? withId(snap) : null);
            scheduleRender();
        }, () => db.chats.set(id, null)));
        add(listen(FB.query(col('chats', id, 'messages'), FB.orderBy('at', 'asc'), FB.limit(500)), snap => {
            db.messages.set(id, snap.docs.map(withId));
            scheduleRender();
        }, () => db.messages.set(id, [])));
        const postId = id.slice(0, id.lastIndexOf('_'));
        add(listen(ref('posts', postId), snap => {
            if (snap.exists()) postSources.page.set(postId, withId(snap));
            else { postSources.page.delete(postId); db.missing.add(postId); }
            rebuildPosts();
            scheduleRender();
        }, () => db.missing.add(postId)));
    });

    const c = db.chats.get(id);
    if (c === undefined || (c && !db.messages.has(id))) return loadingHTML;
    if (!c || (c.ownerId !== u.id && c.otherId !== u.id)) return viewNotFound('채팅방을 찾을 수 없어요.');
    viewChat.title = '채팅';

    // 읽음 처리
    if (chatUnread(c, u.id) && readMarkedAt[id] !== c.lastAt) {
        readMarkedAt[id] = c.lastAt;
        FB.updateDoc(ref('chats', id), { [`lastRead.${u.id}`]: now() }).catch(() => {});
    }

    const otherId = partnerOf(c, u.id);
    const post = db.posts.get(c.postId);
    const other = userById(otherId);
    const isOwner = c.ownerId === u.id;
    const theirRead = c.lastRead?.[otherId] || 0;
    const blocked = other === null || other?.banned;
    const r = ratingOf(otherId);

    let ownerBtns = '';
    if (post && isOwner && post.status !== 'done') {
        if (post.status === 'open') ownerBtns = `<button class="btn btn-sm" data-act="chatReserve" data-id="${esc(c.id)}">🤝 이 분과 예약하기</button>`;
        if (post.status === 'reserved' && post.partnerId === c.otherId) {
            ownerBtns = `<button class="btn btn-sm btn-primary" data-act="chatComplete" data-id="${esc(c.id)}">✅ 거래 완료</button>
                         <button class="btn btn-sm" data-act="chatUnreserve" data-id="${esc(c.id)}">예약 취소</button>`;
        }
    }
    if (post && post.status === 'done' && post.partnerId === c.otherId) {
        ownerBtns += `<a class="btn btn-sm btn-primary" href="#/post/${esc(post.id)}">⭐ 후기 남기기</a>`;
    }

    let prevDay = '';
    const msgs = (db.messages.get(id) || []).map(m => {
        const day = new Date(m.at).toDateString();
        const sep = day !== prevDay ? `<div class="msg system"><div class="bubble">${fmtDateTime(m.at).split(' ')[0]}</div></div>` : '';
        prevDay = day;
        if (m.system) return sep + `<div class="msg system"><div class="bubble">${esc(m.text)}</div></div>`;
        const mine = m.from === u.id;
        const warn = !mine && SCAM_PATTERN.test(m.text) ? '<div class="warn">⚠️ 선입금·계좌·외부 메신저 요구는 사기일 수 있어요</div>' : '';
        return sep + `<div class="msg ${mine ? 'mine' : 'theirs'}"><div class="bubble">${esc(m.text)}</div>${warn}
            <div class="time">${mine && m.at <= theirRead ? '읽음 · ' : ''}${fmtTime(m.at)}</div></div>`;
    }).join('');

    afterRender = ({ soft, wasAtBottom }) => {
        const body = $('#chatBody');
        if (body && (!soft || wasAtBottom)) body.scrollTop = body.scrollHeight;
    };

    return `
    <div class="mid">
        <div class="card chat">
            <div class="chat-head">
                <div class="row">
                    <a href="#/chats" class="btn btn-ghost btn-sm" aria-label="채팅 목록">←</a>
                    <a href="#/user/${esc(otherId)}"><b>${nick(other)}</b></a> ${schoolBadge(other)}
                    <span class="small muted">${r.count ? `★ ${r.avg.toFixed(1)}` : ''}</span>
                    <span class="spacer"></span>
                    <button class="btn btn-ghost btn-sm" data-act="reportUser" data-id="${esc(otherId)}" data-post="${esc(c.postId)}" title="신고">🚨</button>
                </div>
                ${post ? `<a class="chat-post" href="#/post/${esc(post.id)}">
                    <span>${sportOf(post.sport).emoji}</span>
                    <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><b>${esc(post.title)}</b></span>
                    ${statusBadge(post)} <b>${won(post.price)}</b>
                </a>` : `<div class="chat-post muted">${db.missing.has(c.postId) ? '삭제된 글이에요' : esc(c.postTitle || '')}</div>`}
                ${ownerBtns ? `<div class="row">${ownerBtns}</div>` : ''}
            </div>
            <div class="chat-body" id="chatBody">
                <div class="msg system"><div class="bubble">🔒 거래는 가급적 직거래 또는 공식 예매처의 양도 기능을 이용하세요.<br>선입금만 요구하는 경우 사기일 가능성이 높아요.</div></div>
                ${msgs}
            </div>
            ${blocked ? '<div class="chat-input"><span class="muted small">대화할 수 없는 사용자예요.</span></div>' : `
            <div class="quick-replies">${QUICK_REPLIES.map(q => `<button type="button" class="chip" data-act="quickReply" data-v="${esc(q)}">${esc(q)}</button>`).join('')}</div>
            <form class="chat-input" data-form="chat">
                <input type="hidden" name="chatId" value="${esc(c.id)}">
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
    usePage('me:' + u.id, add => {
        add(listen(FB.query(col('reviews'), FB.where('to', '==', u.id)), snap => {
            db.reviewsTo.set(u.id, snap.docs.map(withId).sort((a, b) => b.at - a.at));
            scheduleRender();
        }));
        add(listen(FB.query(col('reviews'), FB.where('from', '==', u.id)), snap => {
            const byPost = {};
            snap.forEach(d => { byPost[d.data().postId] = true; });
            db.myReviewedPosts = byPost;
            scheduleRender();
        }));
        add(listen(FB.query(col('posts'), FB.where('partnerId', '==', u.id), FB.where('hidden', '==', false)), snap => {
            postSources.page.clear();
            snap.forEach(d => postSources.page.set(d.id, withId(d)));
            rebuildPosts();
            scheduleRender();
        }));
    });
    const tabs = [['posts', '내 글'], ['favs', '찜한 글'], ['trades', '거래 내역'], ['reviews', '받은 후기'], ['settings', '설정']];
    const r = ratingOf(u.id);
    let body = '';

    if (tab === 'posts') {
        const list = postsList().filter(p => p.authorId === u.id).sort((a, b) => b.createdAt - a.createdAt);
        body = list.length ? `<div class="post-grid">${list.map(postCard).join('')}</div>` : emptyState('📝', '작성한 글이 없어요.', '<a class="btn btn-primary" href="#/new">글쓰기</a>');
    } else if (tab === 'favs') {
        const list = db.favs.map(postById).filter(p => p && visiblePost(p));
        const loading = db.favs.some(id => !db.posts.has(id) && !db.missing.has(id));
        body = list.length ? `<div class="post-grid">${list.map(postCard).join('')}</div>` : (loading ? loadingHTML : emptyState('♡', '찜한 글이 없어요.'));
    } else if (tab === 'trades') {
        const list = postsList().filter(p => p.partnerId && (p.authorId === u.id || p.partnerId === u.id) && p.status !== 'open')
            .sort((a, b) => b.updatedAt - a.updatedAt);
        const reviewed = db.myReviewedPosts || {};
        body = list.length ? `<div class="card table-wrap"><table class="data">
            <tr><th>글</th><th>역할</th><th>상대</th><th>금액</th><th>상태</th><th>후기</th></tr>
            ${list.map(p => {
                const iAmAuthor = p.authorId === u.id;
                const seller = p.kind === 'sell' ? iAmAuthor : !iAmAuthor;
                const otherId = iAmAuthor ? p.partnerId : p.authorId;
                return `<tr>
                    <td><a href="#/post/${esc(p.id)}"><b>${esc(p.title)}</b></a><div class="small muted">${sportOf(p.sport).name} · ${fmtDate(p.eventDate)}</div></td>
                    <td>${seller ? '판매' : '구매'}</td>
                    <td><a href="#/user/${esc(otherId)}">${nick(userById(otherId))}</a></td>
                    <td>${won(p.price * p.qty)}</td>
                    <td>${statusBadge(p)}</td>
                    <td>${p.status === 'done' ? (reviewed[p.id] ? '작성 완료' : `<a class="btn btn-sm" href="#/post/${esc(p.id)}">작성</a>`) : '-'}</td>
                </tr>`;
            }).join('')}
        </table></div>` : emptyState('🤝', '예약 또는 완료된 거래가 없어요.');
    } else if (tab === 'reviews') {
        const list = db.reviewsTo.get(u.id);
        body = !list ? loadingHTML : list.length ? `<div class="card card-pad">${list.map(reviewItem).join('')}</div>` : emptyState('⭐', '받은 후기가 없어요.');
    } else if (tab === 'settings') {
        body = `
        <form class="card card-pad" data-form="profile" style="margin-bottom:16px">
            <h3 style="font-size:16px;margin-bottom:14px">프로필</h3>
            <div class="grid-2">
                <div class="field"><label for="s-nick">닉네임</label><input class="input" id="s-nick" name="nickname" maxlength="12" value="${esc(u.nickname)}"></div>
                <div class="field"><label for="s-year">학번 (2자리)</label><input class="input" id="s-year" name="year" maxlength="2" inputmode="numeric" value="${esc(u.year)}" placeholder="예: 24"></div>
            </div>
            <p class="small muted" style="margin:0 0 12px">소속 학교(${SCHOOLS[u.school] || '-'})는 인증한 학교 메일로 정해져요.</p>
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
            <p class="small muted" style="margin:0 0 12px">${esc(u.email)}</p>
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
            <div class="small muted">${new Date(u.createdAt).getFullYear()}.${new Date(u.createdAt).getMonth() + 1} 가입${isAdmin() ? ' · 관리자' : ''}${session.verified ? ' · ✅ 학교 메일 인증' : ''}</div>
        </div>
        <div class="stat-row">
            <div><b>${r.count ? r.avg.toFixed(1) : '-'}</b><span class="small muted">평점</span></div>
            <div><b>${tradesOf(u.id).length}</b><span class="small muted">거래</span></div>
            <div><b>${postsList().filter(p => p.authorId === u.id).length}</b><span class="small muted">작성글</span></div>
        </div>
    </div>
    <nav class="tabs">${tabs.map(([k, l]) => `<a href="#/me/${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</nav>
    ${body}`;
}

function viewUser(id) {
    usePage('user:' + id, add => {
        add(listen(FB.query(col('posts'), FB.where('authorId', '==', id), FB.where('hidden', '==', false)), snap => {
            snap.forEach(d => postSources.page.set(d.id, withId(d)));
            rebuildPosts();
            scheduleRender();
        }));
        add(listen(FB.query(col('posts'), FB.where('partnerId', '==', id), FB.where('hidden', '==', false)), snap => {
            snap.forEach(d => postSources.page.set(d.id, withId(d)));
            rebuildPosts();
            scheduleRender();
        }));
        add(listen(FB.query(col('reviews'), FB.where('to', '==', id)), snap => {
            db.reviewsTo.set(id, snap.docs.map(withId).sort((a, b) => b.at - a.at));
            scheduleRender();
        }));
    });
    const u = userById(id);
    if (u === undefined) return loadingHTML;
    if (!u) return viewNotFound('존재하지 않거나 탈퇴한 사용자예요.');
    viewUser.title = u.nickname;
    const r = ratingOf(u.id);
    const posts = postsList().filter(p => p.authorId === u.id && visiblePost(p) && p.status !== 'done').sort((a, b) => b.createdAt - a.createdAt);
    const reviews = db.reviewsTo.get(id) || [];
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
        ${viewer && viewer.id !== u.id ? `<button class="btn btn-sm btn-danger" data-act="reportUser" data-id="${esc(u.id)}">🚨 신고</button>` : ''}
        ${isAdmin() && viewer.id !== u.id ? `<button class="btn btn-sm" data-act="toggleBan" data-id="${esc(u.id)}">${u.banned ? '제한 해제' : '이용 제한'}</button>` : ''}
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
    const list = db.notifs;
    const html = `
    <div class="mid">
        <div class="row" style="margin-bottom:16px"><h1 class="page-title" style="margin:0">알림</h1><span class="spacer"></span>
            ${list.length ? '<button class="btn btn-sm" data-act="clearNotifs">모두 지우기</button>' : ''}</div>
        ${list.length ? `<div class="card">${list.map(n => `
            <a class="list-item ${n.read ? '' : 'unread-row'}" href="${esc(String(n.link || '').startsWith('#/') ? n.link : '#/')}">
                <div style="flex:1">${esc(n.text)}</div><span class="small muted">${timeAgo(n.at)}</span>
            </a>`).join('')}</div>` : emptyState('🔔', '새 알림이 없어요.')}
    </div>`;
    const unread = list.filter(n => !n.read && !n.marking);
    if (unread.length) {
        const batch = FB.writeBatch(fs);
        unread.forEach(n => { n.marking = true; batch.update(ref('users', u.id, 'notifs', n.id), { read: true }); });
        batch.commit().catch(() => {});
    }
    return html;
}

/* ---------- 관리자 ---------- */
function viewAdmin() {
    viewAdmin.title = '관리';
    usePage('admin', () => {
        FB.getDocs(FB.query(col('users'), FB.limit(1000)))
            .then(s => { db.allUsers = s.docs.map(withId); db.allUsers.forEach(x => db.users.set(x.id, x)); })
            .catch(() => { db.allUsers = []; })
            .finally(scheduleRender);
    });
    const pendingReports = db.reports.filter(r => !r.resolved);
    const resolved = db.reports.filter(r => r.resolved).slice(0, 30);
    const all = postsList();
    const hidden = all.filter(p => p.hidden);
    const users = (db.allUsers || []).slice().sort((a, b) => b.createdAt - a.createdAt);
    const reportRow = r => {
        const reporter = userById(r.from);
        const post = r.postId ? postById(r.postId) : null;
        const targetId = r.userId || post?.authorId;
        const target = targetId ? userById(targetId) : null;
        return `<tr>
            <td class="small">${fmtDateTime(r.at)}</td>
            <td><b>${esc(r.reason)}</b>${r.detail ? `<div class="small muted">${esc(r.detail)}</div>` : ''}</td>
            <td>${post ? `<a href="#/post/${esc(post.id)}">${esc(post.title)}</a>${post.hidden ? ' <span class="badge badge-hidden">숨김</span>' : ''}` : (r.postId ? `<span class="muted">${db.missing.has(r.postId) ? '삭제된 글' : '…'}</span>` : '-')}</td>
            <td>${targetId ? `<a href="#/user/${esc(targetId)}">${nick(target)}</a>${target?.banned ? ' <span class="badge badge-hidden">제한</span>' : ''}` : '-'}</td>
            <td class="small">${nick(reporter)}</td>
            <td><div class="row">
                ${post ? `<button class="btn btn-sm" data-act="toggleHide" data-id="${esc(post.id)}">${post.hidden ? '숨김 해제' : '글 숨김'}</button>` : ''}
                ${targetId && targetId !== me().id ? `<button class="btn btn-sm" data-act="toggleBan" data-id="${esc(targetId)}">${target?.banned ? '제한 해제' : '이용 제한'}</button>` : ''}
                ${r.resolved ? '' : `<button class="btn btn-sm btn-primary" data-act="resolveReport" data-id="${esc(r.id)}">처리 완료</button>`}
            </div></td>
        </tr>`;
    };
    const head = '<tr><th>일시</th><th>사유</th><th>글</th><th>대상</th><th>신고자</th><th>조치</th></tr>';
    return `
    <h1 class="page-title">관리자</h1>
    <div class="hero-stats" style="margin:0 0 8px">
        ${[['회원', db.allUsers ? db.allUsers.length : '…'], ['최근 거래글', all.length], ['거래 완료', all.filter(p => p.status === 'done').length], ['미처리 신고', pendingReports.length], ['숨긴 글', hidden.length]]
            .map(([l, n]) => `<div class="card" style="padding:10px 16px"><b style="font-size:20px">${n}</b> <span class="small muted">${l}</span></div>`).join('')}
    </div>
    <h2 class="section-title">미처리 신고 ${pendingReports.length ? `<span class="tab-count">${pendingReports.length}</span>` : ''}</h2>
    ${pendingReports.length ? `<div class="card table-wrap"><table class="data">${head}${pendingReports.map(reportRow).join('')}</table></div>` : emptyState('✅', '처리할 신고가 없어요.')}
    ${resolved.length ? `<h2 class="section-title">처리된 신고</h2><div class="card table-wrap"><table class="data">${head}${resolved.map(reportRow).join('')}</table></div>` : ''}
    ${hidden.length ? `<h2 class="section-title">숨긴 글</h2><div class="post-grid">${hidden.map(postCard).join('')}</div>` : ''}
    <h2 class="section-title">회원 관리</h2>
    ${!db.allUsers ? loadingHTML : `<div class="card table-wrap"><table class="data">
        <tr><th>닉네임</th><th>학교</th><th>가입</th><th>상태</th></tr>
        ${users.map(x => `<tr>
            <td><a href="#/user/${esc(x.id)}"><b>${esc(x.nickname)}</b></a></td>
            <td>${schoolBadge(x)}</td>
            <td class="small">${fmtDateTime(x.createdAt).split(' ')[0]}</td>
            <td>${x.id === me().id ? '나' : `<button class="btn btn-sm ${x.banned ? '' : 'btn-danger'}" data-act="toggleBan" data-id="${esc(x.id)}">${x.banned ? '제한 해제' : '이용 제한'}</button>`}</td>
        </tr>`).join('')}
    </table></div>`}
    <p class="small muted">데이터 백업과 관리자 추가는 Firebase 콘솔에서 할 수 있어요. (README 참고)</p>`;
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
                <li>학교 메일(${Object.keys(SCHOOL_DOMAINS).map(d => '@' + d).join(', ')})로 가입하고 <b>메일 인증</b>을 완료해요.</li>
                <li><b>팝니다</b>(양도) 또는 <b>삽니다</b>(구매) 글을 올려요.</li>
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
            <details class="faq"><summary>인증 메일이 오지 않아요.</summary><p>스팸함을 확인하고, 인증 화면에서 '인증 메일 다시 보내기'를 눌러주세요. 학교 메일함에서 외부 메일이 차단되어 있을 수도 있어요.</p></details>
            <details class="faq"><summary>정가보다 싸게 올려도 되나요?</summary><p>네. 정가 이하라면 자유롭게 가격을 정할 수 있고, 목록에 할인율이 표시돼요.</p></details>
            <details class="faq"><summary>여러 장을 나눠 팔 수 있나요?</summary><p>설명에 분할 가능 여부를 적어 주세요. 일부가 팔리면 글을 수정해 수량을 줄이면 돼요.</p></details>
            <details class="faq"><summary>예약을 취소하고 싶어요.</summary><p>글 상세 또는 채팅방에서 상태를 다시 '거래가능'으로 바꾸면 돼요. 상대에게 알림이 가요.</p></details>
        </div>
    </div>`;
}

/* ---------- 로그인/회원가입/인증 ---------- */
function viewLogin() {
    viewLogin.title = '로그인';
    const next = parseHash().query.get('next') || '';
    if (me()) return emptyState('👋', `${esc(me().nickname)}님, 이미 로그인되어 있어요.`, '<a class="btn" href="#/">홈으로</a>');
    return `
    <div class="narrow">
        <h1 class="page-title center">로그인</h1>
        <form class="card card-pad" data-form="login">
            <input type="hidden" name="next" value="${esc(next)}">
            <div id="form-error" class="form-error hidden"></div>
            <div class="field"><label for="l-email">학교 메일</label><input class="input" type="email" id="l-email" name="email" autocomplete="username" autocapitalize="off" placeholder="example@korea.ac.kr"></div>
            <div class="field"><label for="l-pw">비밀번호</label><input class="input" type="password" id="l-pw" name="password" autocomplete="current-password"></div>
            <button class="btn btn-primary btn-block">로그인</button>
            <p class="center small muted" style="margin:14px 0 0">
                <button type="button" class="btn btn-ghost btn-sm" data-act="resetPassword">비밀번호를 잊었어요</button>
                · 계정이 없나요? <a href="#/signup${next ? '?next=' + encodeURIComponent(next) : ''}"><b>회원가입</b></a>
            </p>
        </form>
    </div>`;
}

function viewSignup() {
    viewSignup.title = '회원가입';
    const next = parseHash().query.get('next') || '';
    if (me()) return emptyState('👋', '이미 로그인되어 있어요.', '<a class="btn" href="#/">홈으로</a>');
    return `
    <div class="narrow">
        <h1 class="page-title center">회원가입</h1>
        <form class="card card-pad" data-form="signup" novalidate>
            <input type="hidden" name="next" value="${esc(next)}">
            <div id="form-error" class="form-error hidden"></div>
            <div class="field">
                <label for="s-email">학교 메일</label>
                <input class="input" type="email" id="s-email" name="email" autocomplete="username" autocapitalize="off" placeholder="example@korea.ac.kr">
                <span class="hint">${Object.keys(SCHOOL_DOMAINS).map(d => '@' + d).join(', ')} 메일만 가입할 수 있어요. 인증 메일이 발송돼요.</span>
            </div>
            <div class="grid-2">
                <div class="field"><label for="s-pw">비밀번호</label><input class="input" type="password" id="s-pw" name="password" autocomplete="new-password" placeholder="6자 이상"></div>
                <div class="field"><label for="s-pw2">비밀번호 확인</label><input class="input" type="password" id="s-pw2" name="password2" autocomplete="new-password"></div>
            </div>
            <div class="grid-2">
                <div class="field"><label for="s-nick">닉네임</label><input class="input" id="s-nick" name="nickname" maxlength="12" placeholder="2~12자"></div>
                <div class="field"><label for="s-year">학번 (2자리)</label><input class="input" id="s-year" name="year" maxlength="2" inputmode="numeric" placeholder="예: 24"></div>
            </div>
            <label class="check" style="margin-bottom:16px"><input type="checkbox" name="agree"> <span>정가 초과 거래 금지 등 <a href="#/guide" target="_blank"><u>운영 원칙</u></a>에 동의합니다.</span></label>
            <button class="btn btn-primary btn-block">가입하기</button>
            <p class="center small muted" style="margin:14px 0 0">이미 계정이 있나요? <a href="#/login"><b>로그인</b></a></p>
        </form>
    </div>`;
}

// 로그인은 됐지만 프로필이 없는 경우 (가입 도중 끊긴 경우 등)
function viewProfileSetup() {
    viewProfileSetup.title = '프로필 설정';
    const school = schoolOfEmail(session.user?.email);
    if (!school) {
        return emptyState('🏫', '학교 메일 계정이 아니에요. 학교 메일로 다시 가입해 주세요.', '<button class="btn" data-act="logout">로그아웃</button>');
    }
    return `
    <div class="narrow">
        <h1 class="page-title center">프로필 설정</h1>
        <form class="card card-pad" data-form="profileSetup" novalidate>
            <div id="form-error" class="form-error hidden"></div>
            <p class="small muted" style="margin-top:0">${esc(session.user.email)} · ${SCHOOLS[school]}</p>
            <div class="grid-2">
                <div class="field"><label for="p-nick">닉네임</label><input class="input" id="p-nick" name="nickname" maxlength="12" placeholder="2~12자"></div>
                <div class="field"><label for="p-year">학번 (2자리)</label><input class="input" id="p-year" name="year" maxlength="2" inputmode="numeric" placeholder="예: 24"></div>
            </div>
            <button class="btn btn-primary btn-block">시작하기</button>
        </form>
    </div>`;
}

function viewVerify() {
    viewVerify.title = '메일 인증';
    if (!session.user) return emptyState('📧', '로그인 후 인증할 수 있어요.', '<a class="btn btn-primary" href="#/login">로그인</a>');
    if (session.verified) return emptyState('✅', '학교 메일 인증이 완료됐어요. 이제 모든 기능을 쓸 수 있어요.', '<a class="btn btn-primary" href="#/">거래글 보러 가기</a>');
    return `
    <div class="narrow">
        <h1 class="page-title center">학교 메일 인증</h1>
        <div class="card card-pad">
            <p style="margin-top:0"><b>${esc(session.user.email)}</b>로 인증 메일을 보냈어요.</p>
            <ol class="small" style="padding-left:18px">
                <li>메일함에서 인증 링크를 눌러주세요. 안 보이면 스팸함도 확인해 주세요.</li>
                <li>인증을 마친 뒤 아래 <b>인증 완료했어요</b> 버튼을 눌러주세요.</li>
            </ol>
            <div class="row" style="margin-top:16px">
                <button class="btn btn-primary" data-act="checkVerified">인증 완료했어요</button>
                <button class="btn" data-act="resendVerify">인증 메일 다시 보내기</button>
            </div>
        </div>
    </div>`;
}

function viewSetupNeeded() {
    return `
    <div class="mid">
        <h1 class="page-title">Firebase 설정이 필요해요</h1>
        <div class="card card-pad guide">
            <p style="margin-top:0">여러 사람이 함께 쓰는 장터로 운영하려면 Firebase 프로젝트를 연결해야 해요. <code>ticket/README.md</code>의 순서를 따라 <code>firebase-config.js</code>에 설정값을 넣어주세요.</p>
            <p>설정 없이 둘러보려면 <a href="demo/"><u>체험판</u></a>을 이용하세요. (데이터가 이 브라우저에만 저장돼요)</p>
        </div>
    </div>`;
}

function viewNotFound(msg = '페이지를 찾을 수 없어요.') {
    return emptyState('🤔', esc(msg), '<a class="btn" href="#/">홈으로</a>');
}

/* ---------- 모달 & 토스트 ---------- */
let confirmCallback = null;

function openModal(html, cls = '') {
    $('#modal-root').innerHTML = `<div class="modal-back"><div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div></div>`;
    const first = $('#modal-root').querySelector('input:not([type=hidden]), textarea, button');
    if (first) first.focus();
}
function closeModal() { $('#modal-root').innerHTML = ''; confirmCallback = null; }
function confirmModal(title, text, onOk, okLabel = '확인', danger = false, extra = '') {
    confirmCallback = onOk;
    openModal(`<h3>${esc(title)}</h3><p class="muted" style="margin:0">${esc(text)}</p>${extra}
        <div class="modal-actions"><button class="btn" data-act="closeModal">취소</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="confirmOk">${esc(okLabel)}</button></div>`);
}
function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    $('#toast-root').appendChild(el);
    setTimeout(() => el.remove(), 2800);
}
function showFormError(form, msg) {
    const el = form.querySelector('#form-error');
    if (el) { el.textContent = msg; el.classList.remove('hidden'); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    else toast(msg);
}

/* ---------- 거래 상태 변경 ---------- */
function systemMessage(batch, chatId, text) {
    const at = now();
    batch.set(FB.doc(col('chats', chatId, 'messages')), { from: me().id, text, at, system: true });
    batch.update(ref('chats', chatId), { lastAt: at, lastText: text, lastFrom: me().id });
}

async function changeStatus(p, status, partnerId) {
    const u = me();
    const prevPartner = p.partnerId;
    partnerId = status === 'open' ? null : (partnerId || null);
    const batch = FB.writeBatch(fs);
    batch.update(ref('posts', p.id), { status, partnerId, updatedAt: now() });
    const hasChat = pid => pid && db.chats.has(chatIdFor(p.id, pid));
    const link = '#/post/' + p.id;
    const notes = [];

    if (status === 'open' && prevPartner) {
        if (hasChat(prevPartner)) systemMessage(batch, chatIdFor(p.id, prevPartner), '예약이 취소되어 다시 거래가능 상태가 되었어요.');
        notes.push([prevPartner, `'${p.title}' 예약이 취소되었어요.`]);
    }
    if (status === 'reserved' && partnerId) {
        if (hasChat(partnerId)) systemMessage(batch, chatIdFor(p.id, partnerId), `${u.nickname}님이 거래를 예약중으로 변경했어요.`);
        notes.push([partnerId, `${u.nickname}님이 '${p.title}' 거래를 예약했어요.`]);
    }
    if (status === 'done' && partnerId) {
        if (hasChat(partnerId)) systemMessage(batch, chatIdFor(p.id, partnerId), '거래가 완료되었어요. 서로 후기를 남겨주세요.');
        notes.push([partnerId, `'${p.title}' 거래가 완료되었어요. 후기를 남겨주세요!`]);
    }
    await batch.commit();
    notes.forEach(([to, text]) => notify(to, text, link));
}

function openPartnerModal(p, status) {
    const partners = chatsList().filter(c => c.postId === p.id && c.lastText).map(c => c.otherId);
    const label = p.kind === 'sell' ? '구매자' : '판매자';
    openModal(`
        <h3>${status === 'reserved' ? '예약할' : '거래 완료한'} ${label} 선택</h3>
        <form data-form="setPartner">
            <input type="hidden" name="postId" value="${esc(p.id)}">
            <input type="hidden" name="status" value="${status}">
            <div class="radio-group" style="flex-direction:column">
                ${partners.map((uid, i) => { const x = userById(uid); return `<label><input type="radio" name="partnerId" value="${esc(uid)}" ${(p.partnerId ? p.partnerId === uid : i === 0) ? 'checked' : ''}> ${nick(x)} ${schoolBadge(x)}</label>`; }).join('')}
                <label><input type="radio" name="partnerId" value="" ${partners.length ? '' : 'checked'}> 이 사이트 밖에서 거래함 (선택 안 함)</label>
            </div>
            ${partners.length ? '' : '<p class="small muted">아직 채팅한 상대가 없어요.</p>'}
            <p class="small muted">상대를 선택하면 알림이 가고, 거래 완료 후 서로 후기를 남길 수 있어요.</p>
            <div class="modal-actions"><button type="button" class="btn" data-act="closeModal">취소</button><button class="btn btn-primary">확인</button></div>
        </form>`);
}

function openReportModal(postId, userId) {
    if (!requireVerified()) return;
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

function openDeleteAccountModal() {
    openModal(`
        <h3>회원 탈퇴</h3>
        <form data-form="deleteAccount">
            <div id="form-error" class="form-error hidden"></div>
            <p class="muted" style="margin:0 0 12px">작성한 글과 찜 목록이 삭제되고 되돌릴 수 없어요. 확인을 위해 비밀번호를 입력해 주세요.</p>
            <input class="input" type="password" id="deletePw" name="password" autocomplete="current-password" placeholder="비밀번호">
            <div class="modal-actions"><button type="button" class="btn" data-act="closeModal">취소</button><button class="btn btn-danger">탈퇴</button></div>
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

    async startChat(el) {
        if (!requireVerified()) return;
        const u = me();
        const p = db.posts.get(el.dataset.id);
        if (!p || p.authorId === u.id) return;
        const cid = chatIdFor(p.id, u.id);
        try {
            const snap = await FB.getDoc(ref('chats', cid));
            if (!snap.exists()) {
                const batch = FB.writeBatch(fs);
                batch.set(ref('chats', cid), {
                    postId: p.id, postTitle: p.title, ownerId: p.authorId, otherId: u.id,
                    members: [p.authorId, u.id], createdAt: now(), lastAt: 0, lastText: '', lastFrom: '', lastRead: {},
                });
                batch.update(ref('posts', p.id), { chatCount: FB.increment(1) });
                await batch.commit();
            }
            go('#/chat/' + cid);
        } catch (e) { fail(e); }
    },
    async toggleFav(el) {
        if (!requireVerified()) return;
        const u = me();
        const id = el.dataset.id;
        const adding = !isFav(id);
        try {
            const batch = FB.writeBatch(fs);
            batch.set(ref('privates', u.id), { favs: adding ? FB.arrayUnion(id) : FB.arrayRemove(id) }, { merge: true });
            batch.update(ref('posts', id), { favCount: FB.increment(adding ? 1 : -1) });
            await batch.commit();
            if (adding) toast('찜 목록에 추가했어요.');
        } catch (e) { fail(e); }
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
        const src = safeImg((db.images.get(el.dataset.id) || [])[Number(el.dataset.i)]);
        if (src) openModal(`<img src="${esc(src)}" alt="티켓 이미지"><div class="modal-actions"><button class="btn" data-act="closeModal">닫기</button></div>`, 'modal-img');
    },
    setStatus(el) {
        const p = db.posts.get(el.dataset.id);
        const status = el.dataset.v;
        if (!p || p.authorId !== me()?.id || p.status === status) return;
        if (status === 'open') {
            confirmModal('거래가능으로 변경', p.partnerId ? '예약/완료 상태가 해제되고 상대에게 알림이 가요.' : '거래가능 상태로 되돌릴까요?', () =>
                changeStatus(p, 'open').then(() => toast('거래가능으로 변경했어요.')).catch(e => fail(e)));
        } else {
            openPartnerModal(p, status);
        }
    },
    async bump(el) {
        const p = db.posts.get(el.dataset.id);
        if (!p) return;
        const left = CONFIG.bumpCooldownMin * 60000 - (now() - (p.bumpedAt || p.createdAt));
        if (left > 0) return toast(`${Math.ceil(left / 60000)}분 뒤에 다시 끌어올릴 수 있어요.`);
        try {
            await FB.updateDoc(ref('posts', p.id), { bumpedAt: now() });
            toast('글을 목록 맨 위로 끌어올렸어요.');
        } catch (e) { fail(e); }
    },
    deletePost(el) {
        const p = db.posts.get(el.dataset.id);
        if (!p) return;
        confirmModal('글 삭제', '삭제한 글은 복구할 수 없어요. 채팅 기록은 남아있어요.', async () => {
            try {
                const batch = FB.writeBatch(fs);
                batch.delete(ref('postImages', p.id));
                batch.delete(ref('posts', p.id));
                await batch.commit();
                toast('글을 삭제했어요.');
                go('#/me/posts');
            } catch (e) { fail(e); }
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
        const c = db.chats.get(el.dataset.id);
        const p = c && db.posts.get(c.postId);
        if (!p) return;
        confirmModal('예약하기', `${userById(c.otherId)?.nickname || '상대'}님과 거래를 예약할까요?`, () => changeStatus(p, 'reserved', c.otherId).catch(e => fail(e)));
    },
    chatUnreserve(el) {
        const c = db.chats.get(el.dataset.id);
        const p = c && db.posts.get(c.postId);
        if (!p) return;
        confirmModal('예약 취소', '예약을 취소하고 다시 거래가능 상태로 바꿀까요?', () => changeStatus(p, 'open').catch(e => fail(e)));
    },
    chatComplete(el) {
        const c = db.chats.get(el.dataset.id);
        const p = c && db.posts.get(c.postId);
        if (!p) return;
        confirmModal('거래 완료', `${userById(c.otherId)?.nickname || '상대'}님과의 거래를 완료 처리할까요?`, () => changeStatus(p, 'done', c.otherId).catch(e => fail(e)));
    },
    async clearNotifs() {
        const u = me();
        const batch = FB.writeBatch(fs);
        db.notifs.forEach(n => batch.delete(ref('users', u.id, 'notifs', n.id)));
        try { await batch.commit(); } catch (e) { fail(e); }
    },
    async logout() {
        await FB.signOut(auth);
        toast('로그아웃했어요.');
        go('#/');
    },
    async resetPassword() {
        const email = String($('#l-email')?.value || '').trim();
        if (!email) return toast('학교 메일을 먼저 입력해 주세요.');
        try {
            await FB.sendPasswordResetEmail(auth, email);
            toast('비밀번호 재설정 메일을 보냈어요.');
        } catch (e) { fail(e); }
    },
    async resendVerify() {
        try {
            await FB.sendEmailVerification(auth.currentUser);
            toast('인증 메일을 다시 보냈어요.');
        } catch (e) { fail(e); }
    },
    async checkVerified() {
        try {
            await auth.currentUser.reload();
            await auth.currentUser.getIdToken(true);   // 보안 규칙이 인증 상태를 알도록 토큰 갱신
            session.verified = auth.currentUser.emailVerified;
            if (session.verified) { toast('인증이 완료됐어요!'); go('#/'); }
            else toast('아직 인증되지 않았어요. 메일의 링크를 눌렀는지 확인해 주세요.');
        } catch (e) { fail(e); }
    },
    exportData() {
        const u = me();
        download(`my-data-${u.nickname}.json`, {
            profile: u,
            posts: postsList().filter(p => p.authorId === u.id),
            chats: chatsList(),
            reviewsReceived: db.reviewsTo.get(u.id) || [],
            favorites: db.favs,
        });
    },
    deleteAccount() { openDeleteAccountModal(); },

    // 관리자
    async toggleHide(el) {
        if (!isAdmin()) return;
        const p = db.posts.get(el.dataset.id);
        if (!p) return;
        try {
            await FB.updateDoc(ref('posts', p.id), { hidden: !p.hidden });
            notify(p.authorId, !p.hidden ? `'${p.title}' 글이 운영 정책에 따라 숨김 처리되었어요.` : `'${p.title}' 글의 숨김이 해제되었어요.`, '#/post/' + p.id);
            toast(!p.hidden ? '글을 숨겼어요.' : '숨김을 해제했어요.');
        } catch (e) { fail(e); }
    },
    toggleBan(el) {
        if (!isAdmin()) return;
        const u = userById(el.dataset.id);
        if (!u) return;
        confirmModal(u.banned ? '이용 제한 해제' : '이용 제한', u.banned ? `${u.nickname}님의 이용 제한을 해제할까요?` : `${u.nickname}님을 이용 제한할까요? 로그인과 글이 모두 차단돼요.`, async () => {
            try {
                await FB.updateDoc(ref('users', u.id), { banned: !u.banned });
                db.users.set(u.id, { ...u, banned: !u.banned });
                if (db.allUsers) db.allUsers = db.allUsers.map(x => (x.id === u.id ? { ...x, banned: !u.banned } : x));
                toast(!u.banned ? '이용을 제한했어요.' : '제한을 해제했어요.');
                render(true);
            } catch (e) { fail(e); }
        }, '확인', !u.banned);
    },
    async resolveReport(el) {
        if (!isAdmin()) return;
        const r = db.reports.find(x => x.id === el.dataset.id);
        if (!r) return;
        try {
            await FB.updateDoc(ref('reports', r.id), { resolved: true });
            notify(r.from, `신고하신 내용(${r.reason})이 처리되었어요. 감사합니다.`, '#/');
        } catch (e) { fail(e); }
    },
};

/* ---------- 폼 제출 ---------- */
async function nicknameTaken(nickname, exceptId) {
    const s = await FB.getDocs(FB.query(col('users'), FB.where('nickname', '==', nickname), FB.limit(2)));
    return s.docs.some(d => d.id !== exceptId);
}
function nextHash(fd) {
    const next = String(fd.get('next') || '');
    return next.startsWith('#/') && !/^#\/(login|signup)/.test(next) ? next : '#/';
}

const forms = {
    async login(f, fd) {
        const email = String(fd.get('email') || '').trim();
        const pw = String(fd.get('password') || '');
        if (!email || !pw) return showFormError(f, '학교 메일과 비밀번호를 입력해 주세요.');
        try {
            await FB.signInWithEmailAndPassword(auth, email, pw);
            toast('반가워요!');
            go(nextHash(fd));
        } catch (e) { fail(e, f); }
    },
    async signup(f, fd) {
        const email = String(fd.get('email') || '').trim().toLowerCase();
        const pw = String(fd.get('password') || '');
        const nickname = String(fd.get('nickname') || '').trim();
        const year = String(fd.get('year') || '').trim();
        const school = schoolOfEmail(email);
        if (!/^[^@\s]+@[^@\s]+$/.test(email)) return showFormError(f, '학교 메일 주소를 정확히 입력해 주세요.');
        if (!school) return showFormError(f, `${Object.keys(SCHOOL_DOMAINS).map(d => '@' + d).join(' 또는 ')} 메일로만 가입할 수 있어요.`);
        if (pw.length < 6) return showFormError(f, '비밀번호는 6자 이상이어야 해요.');
        if (pw !== fd.get('password2')) return showFormError(f, '비밀번호 확인이 일치하지 않아요.');
        if (nickname.length < 2 || nickname.length > 12) return showFormError(f, '닉네임은 2~12자여야 해요.');
        if (year && !/^\d{2}$/.test(year)) return showFormError(f, '학번은 숫자 2자리로 입력해 주세요. (예: 24)');
        if (!fd.get('agree')) return showFormError(f, '운영 원칙에 동의해 주세요.');
        try {
            if (await nicknameTaken(nickname)) return showFormError(f, '이미 사용 중인 닉네임이에요.');
            const cred = await FB.createUserWithEmailAndPassword(auth, email, pw);
            await FB.setDoc(ref('users', cred.user.uid), { nickname, school, year, createdAt: now(), banned: false });
            await FB.sendEmailVerification(cred.user).catch(() => {});
            toast('가입이 완료됐어요! 학교 메일로 온 인증 링크를 눌러주세요.');
            go('#/verify');
        } catch (e) { fail(e, f); }
    },
    async profileSetup(f, fd) {
        const nickname = String(fd.get('nickname') || '').trim();
        const year = String(fd.get('year') || '').trim();
        if (nickname.length < 2 || nickname.length > 12) return showFormError(f, '닉네임은 2~12자여야 해요.');
        if (year && !/^\d{2}$/.test(year)) return showFormError(f, '학번은 숫자 2자리로 입력해 주세요.');
        try {
            if (await nicknameTaken(nickname)) return showFormError(f, '이미 사용 중인 닉네임이에요.');
            await FB.setDoc(ref('users', session.user.uid), { nickname, school: schoolOfEmail(session.user.email), year, createdAt: now(), banned: false });
            render();
        } catch (e) { fail(e, f); }
    },
    async post(f, fd) {
        if (!requireVerified()) return;
        const u = me();
        const id = fd.get('id');
        const existing = id ? db.posts.get(id) : null;
        if (id && (!existing || existing.authorId !== u.id)) return showFormError(f, '수정할 수 없는 글이에요.');
        const images = draftImages.slice(0, CONFIG.maxImages);
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
            imageCount: images.length,
        };
        if (!/^\d{4}-\d{2}-\d{2}$/.test(data.eventDate)) return showFormError(f, '경기일을 선택해 주세요.');
        if (!Number.isFinite(data.faceValue) || data.faceValue <= 0) return showFormError(f, '정가를 입력해 주세요.');
        if (data.faceValue > 1000000) return showFormError(f, '정가를 다시 확인해 주세요.');
        if (!Number.isFinite(data.price) || data.price < 0) return showFormError(f, '거래 가격을 입력해 주세요.');
        if (data.price > data.faceValue * CONFIG.maxPriceRatio) {
            return showFormError(f, `정가(${won(data.faceValue)})를 초과하는 가격은 등록할 수 없어요. 암표 거래는 금지되어 있어요.`);
        }
        if (!data.methods.length) return showFormError(f, '거래 방법을 하나 이상 선택해 주세요.');
        if (data.title.length < 4) return showFormError(f, '제목을 4자 이상 입력해 주세요.');
        if (images.join('').length > 900000) return showFormError(f, '사진 용량이 너무 커요. 사진 수를 줄여 주세요.');

        try {
            const batch = FB.writeBatch(fs);
            const t = now();
            let postRef;
            if (existing) {
                postRef = ref('posts', existing.id);
                batch.update(postRef, { ...data, updatedAt: t });
            } else {
                postRef = FB.doc(col('posts'));
                batch.set(postRef, {
                    ...data, authorId: u.id, status: 'open', partnerId: null, hidden: false,
                    views: 0, favCount: 0, chatCount: 0, createdAt: t, updatedAt: t, bumpedAt: t,
                });
            }
            if (images.length) batch.set(ref('postImages', postRef.id), { images });
            else if (existing) batch.delete(ref('postImages', postRef.id));
            await batch.commit();
            db.images.set(postRef.id, images);

            if (!existing) {
                // 같은 종목의 반대 글(팝니다↔삽니다) 작성자에게 알림
                const sp = sportOf(data.sport);
                const watchers = new Set(postsList()
                    .filter(x => x.sport === data.sport && x.kind !== data.kind && x.status === 'open' && x.authorId !== u.id)
                    .map(x => x.authorId));
                [...watchers].slice(0, 20).forEach(w => notify(w, `${sp.emoji} ${sp.name} 새 ${data.kind === 'sell' ? '양도' : '구매'} 글: ${data.title}`, '#/post/' + postRef.id));
            }
            draftImages = [];
            toast(existing ? '수정했어요.' : '등록했어요!');
            go('#/post/' + postRef.id);
        } catch (e) { fail(e, f); }
    },
    async chat(f, fd) {
        if (!requireVerified()) return;
        const u = me();
        const c = db.chats.get(fd.get('chatId'));
        const text = String(fd.get('text') || '').trim().slice(0, 1000);
        if (!c || !text) return;
        const first = c.otherId === u.id && !(db.messages.get(c.id) || []).some(m => m.from === u.id);
        const at = now();
        try {
            const batch = FB.writeBatch(fs);
            batch.set(FB.doc(col('chats', c.id, 'messages')), { from: u.id, text, at, system: false });
            batch.update(ref('chats', c.id), { lastAt: at, lastText: text.slice(0, 100), lastFrom: u.id, [`lastRead.${u.id}`]: at });
            f.reset();
            await batch.commit();
            if (first) notify(c.ownerId, `${u.nickname}님이 '${c.postTitle || '거래글'}'에 채팅을 보냈어요.`, '#/chat/' + c.id);
            $('#msg')?.focus();
        } catch (e) {
            const input = $('#msg');
            if (input && !input.value) input.value = text;
            fail(e);
        }
    },
    async review(f, fd) {
        if (!requireVerified()) return;
        const u = me();
        const p = db.posts.get(fd.get('postId'));
        if (!p || p.status !== 'done' || !p.partnerId) return;
        const to = u.id === p.authorId ? p.partnerId : (u.id === p.partnerId ? p.authorId : null);
        if (!to) return;
        const rating = Math.max(1, Math.min(5, parseInt(fd.get('rating'), 10) || 5));
        try {
            await FB.setDoc(ref('reviews', `${p.id}_${u.id}`), { postId: p.id, from: u.id, to, rating, text: String(fd.get('text') || '').trim().slice(0, 200), at: now() });
            loadReviewsTo(to, true);
            notify(to, `${u.nickname}님이 거래 후기(★${rating})를 남겼어요.`, '#/me/reviews');
            toast('후기를 등록했어요. 감사합니다!');
            f.reset();
            render();
        } catch (e) { fail(e); }
    },
    async report(f, fd) {
        const u = me();
        try {
            await FB.addDoc(col('reports'), {
                from: u.id,
                postId: String(fd.get('postId') || ''),
                userId: String(fd.get('userId') || ''),
                reason: String(fd.get('reason') || '기타').slice(0, 30),
                detail: String(fd.get('detail') || '').trim().slice(0, 300),
                at: now(),
                resolved: false,
            });
            FB.getDocs(col('admins')).then(s => s.forEach(a => notify(a.id, `새 신고가 접수되었어요: ${fd.get('reason')}`, '#/admin'))).catch(() => {});
            closeModal();
            toast('신고가 접수되었어요. 검토 후 조치할게요.');
        } catch (e) { fail(e); }
    },
    async setPartner(f, fd) {
        const p = db.posts.get(fd.get('postId'));
        if (!p || p.authorId !== me()?.id) return;
        const status = fd.get('status') === 'done' ? 'done' : 'reserved';
        try {
            await changeStatus(p, status, String(fd.get('partnerId') || '') || null);
            closeModal();
            toast(status === 'done' ? '거래 완료로 변경했어요.' : '예약중으로 변경했어요.');
        } catch (e) { fail(e); }
    },
    async profile(f, fd) {
        const u = me();
        const nickname = String(fd.get('nickname') || '').trim();
        const year = String(fd.get('year') || '').trim();
        if (nickname.length < 2 || nickname.length > 12) return toast('닉네임은 2~12자여야 해요.');
        if (year && !/^\d{2}$/.test(year)) return toast('학번은 숫자 2자리로 입력해 주세요.');
        try {
            if (nickname !== u.nickname && await nicknameTaken(nickname, u.id)) return toast('이미 사용 중인 닉네임이에요.');
            await FB.updateDoc(ref('users', u.id), { nickname, year });
            toast('프로필을 저장했어요.');
        } catch (e) { fail(e); }
    },
    async password(f, fd) {
        const next = String(fd.get('next') || '');
        if (next.length < 6) return toast('새 비밀번호는 6자 이상이어야 해요.');
        if (next !== fd.get('next2')) return toast('새 비밀번호 확인이 일치하지 않아요.');
        try {
            const user = auth.currentUser;
            await FB.reauthenticateWithCredential(user, FB.EmailAuthProvider.credential(user.email, String(fd.get('current') || '')));
            await FB.updatePassword(user, next);
            f.reset();
            toast('비밀번호를 변경했어요.');
        } catch (e) { fail(e); }
    },
    async deleteAccount(f, fd) {
        const u = me();
        const user = auth.currentUser;
        try {
            await FB.reauthenticateWithCredential(user, FB.EmailAuthProvider.credential(user.email, String(fd.get('password') || '')));
            const batch = FB.writeBatch(fs);
            postsList().filter(p => p.authorId === u.id).forEach(p => {
                batch.delete(ref('postImages', p.id));
                batch.delete(ref('posts', p.id));
            });
            batch.delete(ref('privates', u.id));
            batch.delete(ref('users', u.id));
            await batch.commit();
            await FB.deleteUser(user);
            closeModal();
            toast('탈퇴가 완료되었어요.');
            go('#/');
        } catch (e) { fail(e, f); }
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
    const fd = new FormData(f);
    const btn = f.querySelector('button:not([type="button"])');
    if (btn) btn.disabled = true;
    Promise.resolve(fn(f, fd)).finally(() => { if (btn && btn.isConnected) btn.disabled = false; });
});

document.addEventListener('input', e => {
    const key = e.target.dataset?.filter;
    if (!key) return;
    filters[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    const r = $('#results');
    if (r) r.innerHTML = resultsHTML();
});

document.addEventListener('change', async e => {
    if (e.target.id !== 'imgInput') return;
    const files = [...e.target.files];
    e.target.value = '';
    for (const file of files) {
        if (draftImages.length >= CONFIG.maxImages) { toast(`사진은 최대 ${CONFIG.maxImages}장까지 올릴 수 있어요.`); break; }
        try { draftImages.push(await resizeImage(file)); } catch (err) { toast(err.message); }
    }
    const box = $('#imgPreviews');
    if (box) box.innerHTML = imgPreviewsHTML();
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

// 상대적 시간 표시 갱신
setInterval(() => { if (!$('#modal-root').innerHTML) render(true); }, 60000);

/* ---------- 시작 ---------- */
if (CONFIGURED) {
    startPublicListeners();
    FB.onAuthStateChanged(auth, user => {
        const changedUser = session.user?.uid !== user?.uid;
        session.user = user;
        session.verified = Boolean(user?.emailVerified);
        if (changedUser) {
            session.profileLoaded = false;
            session.profile = null;
            cleanupPage();
            startUserListeners(user);
        }
        session.ready = true;
        render();
    });
}
render();
