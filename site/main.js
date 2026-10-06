// Milo marketing site. Vanilla JS: theme, nav, scroll reveal, tabs, copy buttons,
// and the small simulations that keep the product previews moving.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const root = document.documentElement;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
const onChange = (mql, fn) => (mql.addEventListener ? mql.addEventListener('change', fn) : mql.addListener(fn));

/* ---------- Theme ---------- */

function storedTheme() {
  try {
    return localStorage.getItem('milo_theme');
  } catch {
    return null;
  }
}

function applyTheme(dark) {
  root.classList.toggle('dark', dark);
  const btn = $('[data-theme-toggle]');
  if (btn) btn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0f172a' : '#ffffff');
}

applyTheme(root.classList.contains('dark'));

$('[data-theme-toggle]')?.addEventListener('click', () => {
  const dark = !root.classList.contains('dark');
  applyTheme(dark);
  try {
    localStorage.setItem('milo_theme', dark ? 'dark' : 'light');
  } catch {
    /* storage unavailable: theme still applies for this visit */
  }
});

onChange(prefersDark, (e) => {
  if (!storedTheme()) applyTheme(e.matches);
});

/* ---------- Nav ---------- */

const nav = $('[data-nav]');
const syncNav = () => nav?.classList.toggle('is-scrolled', window.scrollY > 4);
syncNav();
window.addEventListener('scroll', syncNav, { passive: true });

const menuBtn = $('[data-menu-toggle]');
const menu = $('#mobile-menu');

function setMenu(open) {
  if (!menuBtn || !menu) return;
  menuBtn.setAttribute('aria-expanded', String(open));
  menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  menu.hidden = !open;
}

menuBtn?.addEventListener('click', () => setMenu(menuBtn.getAttribute('aria-expanded') !== 'true'));
menu?.addEventListener('click', (e) => {
  if (e.target.closest('a')) setMenu(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && menuBtn?.getAttribute('aria-expanded') === 'true') {
    setMenu(false);
    menuBtn.focus();
  }
});
onChange(window.matchMedia('(min-width: 861px)'), (e) => {
  if (e.matches) setMenu(false);
});

/* ---------- Scroll reveal ---------- */

// Elements that come into view together are staggered in document order.
const revealEls = $$('.reveal');
if (!('IntersectionObserver' in window) || reduceMotion.matches) {
  revealEls.forEach((el) => el.classList.add('is-in'));
} else {
  const io = new IntersectionObserver(
    (entries) => {
      let n = 0;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.style.setProperty('--delay', `${Math.min(n, 8) * 70}ms`);
        n += 1;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.1 },
  );
  revealEls.forEach((el) => io.observe(el));
}

/* ---------- Loops that only run while visible ---------- */

// Runs `tick` every `ms` while `target` is on screen, the tab is visible and the
// visitor has not asked for reduced motion.
function createLoop(target, tick, ms) {
  let timer = null;
  let visible = false;
  const stop = () => {
    clearInterval(timer);
    timer = null;
  };
  const update = () => {
    const shouldRun = visible && !document.hidden && !reduceMotion.matches;
    if (shouldRun && !timer) timer = setInterval(tick, ms);
    else if (!shouldRun) stop();
  };
  if (!target || !('IntersectionObserver' in window)) return { update };
  new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      update();
    },
    { threshold: 0.15 },
  ).observe(target);
  document.addEventListener('visibilitychange', update);
  onChange(reduceMotion, update);
  return { update };
}

/* ---------- Copy buttons ---------- */

const live = $('[data-live]');

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

$$('[data-copy]').forEach((btn) => {
  let timer;
  btn.addEventListener('click', async () => {
    const ok = await copyText(btn.dataset.copy);
    if (!ok) return;
    btn.classList.add('is-copied');
    if (live) live.textContent = 'Copied to clipboard';
    clearTimeout(timer);
    timer = setTimeout(() => {
      btn.classList.remove('is-copied');
      if (live) live.textContent = '';
    }, 1600);
  });
});

/* ---------- Helpers ---------- */

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function formatClock(mins) {
  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const h = h24 % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}

const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : 'same');

const money = (n) =>
  `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signedMoney = (n) => `${n >= 0 ? '+' : '−'}${money(n)}`;

function restartClass(el, cls, ms) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  if (ms) setTimeout(() => el.classList.remove(cls), ms);
}

/* ---------- Hero: control room simulation ---------- */

const TAGS = {
  found: ['Found', 'gray'],
  brief: ['Brief', 'violet'],
  contacts: ['Contacts', 'gray'],
  score: ['Score', 'blue'],
  review: ['Review', 'amber'],
  sent: ['Sent', 'green'],
  reply: ['Reply', 'blue'],
  escalated: ['Escalated', 'amber'],
  meeting: ['Meeting', 'teal'],
  crm: ['CRM', 'gray'],
};

const AGENTS = [
  { id: 'Sc', name: 'Scout', status: 'running', q: 2, now: 'Searching Apollo: provider groups, 500–5k, US', done: 'Last: found Acme Health', last: '2:41 PM', at: -1 },
  { id: 'Re', name: 'Researcher', status: 'running', q: 7, now: 'Researching Acme Health', done: 'Last: brief for Acme Health', last: '2:46 PM', at: -2 },
  { id: 'Pr', name: 'Prospector', status: 'running', q: 4, now: 'Verifying 3 emails at Halcyon Labs', done: 'Last: 3 contacts at Halcyon Labs', last: '2:45 PM', at: -3 },
  { id: 'Qu', name: 'Qualifier', status: 'idle', q: 0, now: 'Last: scored Acme Health 92', done: 'Last: scored Acme Health 92', last: '2:44 PM', at: -9 },
  { id: 'Pe', name: 'Personalizer', status: 'running', q: 3, now: 'Drafting for Dana Whitfield, Acme Health', done: 'Last: draft for Dana Whitfield', last: '2:46 PM', at: 0 },
  { id: 'SD', name: 'SDR', status: 'running', q: 9, now: 'Reading replies in sales@ledgerline.io', done: 'Last: read 4 replies', last: '2:40 PM', at: -2 },
  { id: 'CR', name: 'CRM Agent', status: 'idle', q: 0, now: 'Last: synced 14 records to HubSpot', done: 'Last: synced 14 records to HubSpot', last: '2:27 PM', at: -9 },
];

const STATS = [
  { key: 'accounts', label: 'Accounts found', v: 38, week: [22, 30, 41, 28, 35, 32], suffix: ' vs yesterday' },
  { key: 'qualified', label: 'Qualified', v: 12, week: [6, 8, 11, 7, 9, 9] },
  { key: 'contacts', label: 'Contacts found', v: 84, week: [51, 66, 90, 62, 70, 73] },
  { key: 'drafts', label: 'Drafts written', v: 19, week: [14, 18, 22, 17, 20, 21] },
  { key: 'sent', label: 'Sent', v: 16, week: [9, 12, 14, 10, 13, 11] },
  { key: 'meetings', label: 'Meetings booked', v: 2, week: [0, 1, 1, 0, 1, 2] },
];

const FEED_START = [
  ['2:46 PM', 'Pe', 'wrote a first touch for', 'Dana Whitfield', '· VP Revenue Cycle, Acme Health', 'review'],
  ['2:45 PM', 'Pe', 'has', '4 drafts', 'waiting for approval', 'review'],
  ['2:44 PM', 'Qu', 'scored', 'Acme Health', '92/100 → outreach', 'score'],
  ['2:43 PM', 'Pr', 'found 3 contacts at', 'Acme Health', '· 2 verified, 1 likely', 'contacts'],
  ['2:41 PM', 'Re', 'wrote a brief for', 'Acme Health', '· 6 sources', 'brief'],
  ['2:38 PM', 'SD', 'booked a meeting with', 'Priya Natarajan', '· Northwind Medical Group, Thu 10:00 AM', 'meeting'],
  ['2:31 PM', 'SD', 'got a reply from', 'Marcus Lee', '· Brightline Dental, question', 'reply'],
  ['2:27 PM', 'CR', 'synced 14 records to', 'HubSpot', '· 9 contacts, 5 activities', 'crm'],
  ['2:20 PM', 'Sc', 'found', 'Acme Health', '· 1,200 employees, Detroit', 'found'],
  ['2:12 PM', 'Qu', 'scored', 'Halcyon Labs', '78/100 → more research', 'score'],
];

const WAITING_START = [
  ['Dana Whitfield · Acme Health', 'First touch · “Prior-auth volume after the Dearborn opening”', 1],
  ['Sam Okafor · Halcyon Labs', 'First touch · “Lab orders after the Epic go-live”', 9],
  ['Marcus Lee · Brightline Dental', 'Reply · answers pricing question', 14],
  ['Lena Brandt · Corvid Orthopedics', 'Meeting invite · Fri Oct 9, 11:30 AM', 38],
];

const EVENTS = [
  { ag: 'Sc', pre: 'found', link: 'Riverbend Health', post: '· 2,400 employees, Columbus', tag: 'found', stat: 'accounts', now: 'Searching Apollo: provider groups, 500–5k, US', done: 'Last: found Riverbend Health' },
  { ag: 'Re', pre: 'wrote a brief for', link: 'Riverbend Health', post: '· 7 sources', tag: 'brief', now: 'Reading riverbendhealth.org/news', done: 'Last: brief for Riverbend Health' },
  { ag: 'Pr', pre: 'found 3 contacts at', link: 'Riverbend Health', post: '· 2 verified, 1 likely', tag: 'contacts', stat: 'contacts', n: 3, now: 'Verifying 3 emails at Riverbend Health', done: 'Last: 3 contacts at Riverbend' },
  { ag: 'Qu', pre: 'scored', link: 'Riverbend Health', post: '94/100 → outreach', tag: 'score', stat: 'qualified', now: 'Scoring Riverbend Health', done: 'Last: scored Riverbend 94' },
  { ag: 'Pe', pre: 'wrote a first touch for', link: 'Owen Castillo', post: '· Director of Patient Access, Riverbend', tag: 'review', stat: 'drafts', review: 1, wait: ['Owen Castillo · Riverbend Health', 'First touch · “Patient access after the Columbus merger”'], now: 'Drafting for Owen Castillo', done: 'Last: draft waiting for review' },
  { ag: 'SD', pre: 'sent', link: '3 approved emails', post: 'from sales@ledgerline.io', tag: 'sent', stat: 'sent', n: 3, review: -3, now: 'Sending inside 8 AM–5 PM their time', done: 'Last: sent 3 approved emails' },
  { ag: 'CR', pre: 'synced 8 records to', link: 'HubSpot', post: '· 5 contacts, 3 activities', tag: 'crm', now: 'Writing activities to HubSpot', done: 'Last: synced 8 records to HubSpot' },
  { ag: 'Sc', pre: 'found', link: 'Pinecrest Clinics', post: '· 640 employees, Tucson', tag: 'found', stat: 'accounts', now: 'Searching Apollo: dental groups, 300–5k, US', done: 'Last: found Pinecrest Clinics' },
  { ag: 'SD', pre: 'got a reply from', link: 'Grace Liu', post: '· Juniper Home Health, pricing question', tag: 'escalated', review: 1, wait: ['Grace Liu · Juniper Home Health', 'Reply · asks about pricing, escalated to you'], now: 'Reading replies in sales@ledgerline.io', done: 'Last: 1 reply escalated' },
  { ag: 'Re', pre: 'wrote a brief for', link: 'Pinecrest Clinics', post: '· 5 sources', tag: 'brief', now: 'Researching Pinecrest Clinics', done: 'Last: brief for Pinecrest Clinics' },
  { ag: 'Qu', pre: 'scored', link: 'Halcyon Labs', post: '78/100 → more research', tag: 'score', now: 'Scoring Halcyon Labs', done: 'Last: Halcyon Labs back to research' },
  { ag: 'SD', pre: 'booked a meeting with', link: 'Lena Brandt', post: '· Corvid Orthopedics, Fri 11:30 AM', tag: 'meeting', stat: 'meetings', now: 'Booking Lena Brandt, Fri 11:30 AM', done: 'Last: booked Lena Brandt' },
  { ag: 'Pr', pre: 'found 2 contacts at', link: 'Pinecrest Clinics', post: '· 2 verified', tag: 'contacts', stat: 'contacts', n: 2, now: 'Searching people at Pinecrest Clinics', done: 'Last: 2 contacts at Pinecrest' },
  { ag: 'Pe', pre: 'wrote a follow-up for', link: 'Sam Okafor', post: '· step 2 of 3, Halcyon Labs', tag: 'review', stat: 'drafts', review: 1, wait: ['Sam Okafor · Halcyon Labs', 'Follow-up 2 of 3 · “Lab orders after the Epic go-live”'], now: 'Drafting for Sam Okafor', done: 'Last: follow-up waiting for review' },
];

function initHero() {
  const frame = $('.hero-preview .frame');
  const statsEl = $('[data-stats]');
  const pipeEl = $('[data-pipe]');
  const feedEl = $('[data-feed]');
  const waitEl = $('[data-waiting]');
  if (!frame || !statsEl || !pipeEl || !feedEl || !waitEl) return;

  const agentById = Object.fromEntries(AGENTS.map((a) => [a.id, a]));
  let clock = 14 * 60 + 47;
  let tickN = 0;
  let eventIdx = 0;
  let reviewCount = 6;
  const waiting = WAITING_START.map(([who, what, age]) => ({ who, what, age }));

  /* Stats */
  const barsHtml = (s) => {
    const vals = [...s.week, s.v];
    const max = Math.max(...vals, 1);
    return vals.map((v) => `<i style="--h:${Math.max(2, Math.round((v / max) * 18))}px"></i>`).join('');
  };
  const deltaText = (s) => {
    const d = s.v - s.week[s.week.length - 1];
    return d === 0 ? 'same as yesterday' : `${signed(d)}${s.suffix ?? ''}`;
  };
  statsEl.innerHTML = STATS.map(
    (s) => `
      <div class="stat" data-stat="${s.key}">
        <span class="stat-label">${esc(s.label)}</span>
        <div class="stat-row"><span class="stat-value">${s.v}</span><span class="spark-bars">${barsHtml(s)}</span></div>
        <span class="stat-delta">${esc(deltaText(s))}</span>
      </div>`,
  ).join('');

  function bumpStat(key, n = 1) {
    const s = STATS.find((x) => x.key === key);
    const el = $(`[data-stat="${key}"]`, statsEl);
    if (!s || !el) return;
    const from = s.v;
    s.v += n;
    const valueEl = $('.stat-value', el);
    const start = performance.now();
    const dur = 500;
    const step = (t) => {
      const p = Math.min(1, (t - start) / dur);
      valueEl.textContent = String(Math.round(from + (s.v - from) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    $('.spark-bars', el).innerHTML = barsHtml(s);
    $('.stat-delta', el).textContent = deltaText(s);
    restartClass(el, 'is-bump', 900);
  }

  /* Pipeline */
  pipeEl.innerHTML = AGENTS.map(
    (a, i) => `
      <div class="pipe-item">
        <div class="pipe-card" data-agent="${a.id}">
          <div class="pipe-top"><span class="mono-badge mono-badge-sm">${a.id}</span><span class="pipe-name">${esc(a.name)}</span></div>
          <div class="pipe-status"><span class="dot"></span><span data-st></span></div>
          <div class="pipe-now" data-now></div>
          <div class="pipe-last"><span data-q></span><span data-last></span></div>
        </div>
        ${i < AGENTS.length - 1 ? '<span class="pipe-arrow"><svg class="icon icon-xs"><use href="#i-chevron-right" /></svg></span>' : ''}
      </div>`,
  ).join('');

  function renderAgent(a) {
    const card = $(`[data-agent="${a.id}"]`, pipeEl);
    if (!card) return;
    $('.dot', card).className = `dot${a.status === 'running' ? ' dot-run' : ''}`;
    $('[data-st]', card).textContent = a.status === 'running' ? 'Running' : 'Idle';
    $('[data-now]', card).textContent = a.now;
    $('[data-q]', card).textContent = `${a.q} queued`;
    $('[data-last]', card).textContent = a.last;
  }
  AGENTS.forEach(renderAgent);

  /* Feed */
  const feedRow = (t, ag, pre, link, post, tag) => {
    const a = agentById[ag];
    const [label, color] = TAGS[tag] ?? [tag, 'gray'];
    return `<span class="feed-t">${esc(t)}</span><span class="feed-m">${ag}</span><span class="feed-txt"><b>${esc(a.name)}</b> ${esc(pre)} <span class="feed-lnk">${esc(link)}</span> <span class="feed-post">${esc(post)}</span></span><span class="tag tag-${color}">${label}</span>`;
  };
  feedEl.innerHTML = FEED_START.map((r) => `<li>${feedRow(...r)}</li>`).join('');

  /* Waiting on you */
  const ageText = (m) => (m <= 0 ? 'now' : `${m} min`);
  function renderWaiting(fresh) {
    waitEl.innerHTML = waiting
      .slice(0, 4)
      .map(
        (w, i) => `
        <li${fresh && i === 0 ? ' class="is-new"' : ''}>
          <div class="w-top"><span class="w-who">${esc(w.who)}</span><span class="w-age">${ageText(w.age)}</span></div>
          <span class="w-what">${esc(w.what)}</span>
        </li>`,
      )
      .join('');
  }
  renderWaiting(false);

  const reviewEls = $$('[data-review-count], [data-side-approvals]');
  const clockEl = $('[data-clock]');

  function tick() {
    tickN += 1;
    clock += 1;
    const time = formatClock(clock);
    if (clockEl) clockEl.textContent = `Tue Oct 6, ${time}`;

    const ev = EVENTS[eventIdx % EVENTS.length];
    eventIdx += 1;
    const a = agentById[ev.ag];

    // New activity row slides in at the top; the oldest drops off.
    const li = document.createElement('li');
    li.className = 'is-new';
    li.innerHTML = feedRow(time, ev.ag, ev.pre, ev.link, ev.post, ev.tag);
    feedEl.prepend(li);
    while (feedEl.children.length > FEED_START.length) feedEl.lastElementChild.remove();

    // The agent that emitted the event is running; its work moves to the next agent.
    a.status = 'running';
    a.now = ev.now;
    a.last = time;
    a.at = tickN;
    a.doneText = ev.done;
    a.q = Math.max(0, a.q - 1);
    const next = AGENTS[AGENTS.indexOf(a) + 1];
    if (next) {
      next.q += 1;
      renderAgent(next);
    }
    renderAgent(a);
    const card = $(`[data-agent="${a.id}"]`, pipeEl);
    if (card) restartClass(card, 'is-flash', 1200);

    // Agents that have been quiet for a while go idle.
    for (const other of AGENTS) {
      if (other === a || other.status !== 'running' || tickN - other.at < 4) continue;
      other.status = 'idle';
      other.now = other.doneText ?? other.done;
      renderAgent(other);
    }

    if (ev.stat) bumpStat(ev.stat, ev.n ?? 1);

    if (ev.review) {
      reviewCount = Math.min(12, Math.max(2, reviewCount + ev.review));
      reviewEls.forEach((el) => {
        el.textContent = String(reviewCount);
      });
    }

    waiting.forEach((w) => {
      w.age += 1;
    });
    if (ev.wait) {
      waiting.unshift({ who: ev.wait[0], what: ev.wait[1], age: 0 });
      waiting.length = Math.min(waiting.length, 6);
    }
    renderWaiting(Boolean(ev.wait));
  }

  createLoop(frame, tick, 2800);
}

/* ---------- Playbooks: tabs and hand-off animation ---------- */

const smallFlow = window.matchMedia('(max-width: 760px)');

function createFlow(flowEl) {
  const inner = $('.flow-inner', flowEl);
  const steps = $$('.flow-step', flowEl);
  const marker = $('.flow-marker', flowEl);
  const rail = $('.flow-rail', flowEl);
  if (!inner || !steps.length || !marker || !rail) return null;

  let phase = 0; // two phases per step: arrive, finish; then a short hold
  let current = -1;
  let userTouchedAt = 0;
  const holdTicks = 3;
  const totalPhases = steps.length * 2 + holdTicks;

  ['pointerdown', 'wheel', 'touchstart'].forEach((evt) =>
    flowEl.addEventListener(evt, () => {
      userTouchedAt = Date.now();
    }, { passive: true }),
  );

  const centerOf = (el) => ({ x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop + el.offsetHeight / 2 });

  function layoutRail() {
    const first = centerOf(steps[0]);
    const last = centerOf(steps[steps.length - 1]);
    const vertical = smallFlow.matches;
    rail.style.setProperty('--rail-start', `${vertical ? first.y : first.x}px`);
    rail.style.setProperty('--rail-len', `${vertical ? last.y - first.y : last.x - first.x}px`);
  }

  function placeMarker(i, animate) {
    if (i < 0) return;
    const c = centerOf(steps[i]);
    marker.classList.toggle('no-anim', !animate);
    if (smallFlow.matches) {
      marker.style.setProperty('--y', `${c.y}px`);
    } else {
      const half = marker.offsetWidth / 2;
      const x = Math.min(Math.max(c.x, half), inner.offsetWidth - half);
      marker.style.setProperty('--x', `${x}px`);
      // Keep the active step in view when the pipeline scrolls sideways.
      if (flowEl.scrollWidth > flowEl.clientWidth + 2 && Date.now() - userTouchedAt > 5000) {
        flowEl.scrollTo({ left: c.x - flowEl.clientWidth / 2, behavior: 'smooth' });
      }
    }
  }

  function setStep(el, state) {
    el.classList.toggle('is-active', state === 'active');
    el.classList.toggle('is-done', state === 'done');
    const dot = $('.flow-state .dot', el);
    const text = $('.flow-state-text', el);
    if (dot) dot.className = `dot${state === 'active' ? ' dot-run' : state === 'done' ? ' dot-done' : ''}`;
    if (text) text.textContent = state === 'active' ? 'Working' : state === 'done' ? el.dataset.out : 'Waiting';
  }

  function showAllDone() {
    steps.forEach((s) => setStep(s, 'done'));
    marker.classList.remove('is-shown');
  }

  function tick() {
    if (phase === 0) {
      steps.forEach((s) => setStep(s, 'waiting'));
      layoutRail();
      placeMarker(0, false);
      marker.classList.add('is-shown');
    }
    if (phase < steps.length * 2) {
      const i = Math.floor(phase / 2);
      if (phase % 2 === 0) {
        current = i;
        setStep(steps[i], 'active');
        placeMarker(i, phase !== 0);
      } else {
        setStep(steps[i], 'done');
      }
    } else if (phase === totalPhases - 1) {
      marker.classList.remove('is-shown');
      current = -1;
    }
    phase = (phase + 1) % totalPhases;
  }

  function relayout() {
    layoutRail();
    placeMarker(current, false);
  }

  // Before the loop starts (or with reduced motion) every step shows its result.
  showAllDone();
  layoutRail();
  onChange(smallFlow, relayout);
  window.addEventListener('resize', relayout, { passive: true });
  createLoop(flowEl, tick, 800);
  return { relayout };
}

function initPlaybooks() {
  const flows = $$('[data-flow]').map(createFlow).filter(Boolean);
  const tablist = $('[data-tabs]');
  if (!tablist) return;
  const tabs = $$('[role="tab"]', tablist);

  function select(tab, focus) {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(t.getAttribute('aria-controls'));
      if (!panel) return;
      panel.hidden = !on;
      panel.classList.toggle('is-active', on);
    });
    if (focus) tab.focus();
    requestAnimationFrame(() => flows.forEach((f) => f.relayout()));
  }

  tablist.addEventListener('click', (e) => {
    const tab = e.target.closest('[role="tab"]');
    if (tab) select(tab, false);
  });

  tablist.addEventListener('keydown', (e) => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const keys = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    select(tabs[(keys[e.key] + tabs.length) % tabs.length], true);
  });
}

/* ---------- Markets preview: paper positions marked to market ---------- */

const POSITIONS = [
  { q: 'Fed cuts rates at the December meeting', side: 'YES', stake: 46.6, entry: 0.41, mark: 0.44 },
  { q: 'ETH closes above $5,000 on Dec 31', side: 'NO', stake: 38.0, entry: 0.62, mark: 0.66 },
  { q: 'Starship reaches orbit before Nov 30', side: 'YES', stake: 50.0, entry: 0.3, mark: 0.37 },
  { q: 'Best Picture goes to a streaming release', side: 'NO', stake: 45.05, entry: 0.55, mark: 0.53 },
  { q: '10+ inches of December snow in Central Park', side: 'YES', stake: 50.0, entry: 0.2, mark: 0.22 },
];
const START_BALANCE = 1000;
const REALIZED = 61.9;
const CASH = 832.25;

function initMarkets() {
  const body = $('[data-positions]');
  const spark = $('[data-spark]');
  if (!body || !spark) return;
  const line = $('.spark-line', spark);
  const base = $('.spark-base', spark);
  const equityEl = $('[data-equity]');
  const deltaEl = $('[data-equity-delta]');
  const unrealEl = $('[data-unrealized]');

  const pnl = (p) => (p.stake / p.entry) * p.mark - p.stake;
  const unrealized = () => POSITIONS.reduce((sum, p) => sum + pnl(p), 0);
  const equity = () => START_BALANCE + REALIZED + unrealized();

  body.innerHTML = POSITIONS.map(
    (p, i) => `
      <div class="pos-row" data-pos="${i}">
        <span class="pos-q">${esc(p.q)}</span>
        <span><span class="tag ${p.side === 'YES' ? 'tag-green' : 'tag-red'}">${p.side}</span></span>
        <span class="r">${money(p.stake)}</span>
        <span class="r hide-sm">${p.entry.toFixed(2)}</span>
        <span class="r" data-mark></span>
        <span class="r pnl" data-pnl></span>
      </div>`,
  ).join('');

  function renderRow(i, flash) {
    const p = POSITIONS[i];
    const row = $(`[data-pos="${i}"]`, body);
    const v = pnl(p);
    $('[data-mark]', row).textContent = p.mark.toFixed(2);
    const pnlEl = $('[data-pnl]', row);
    pnlEl.textContent = signedMoney(v);
    pnlEl.className = `r pnl ${v >= 0 ? 'pos' : 'neg'}`;
    if (flash) restartClass(row, 'flash', 1000);
  }

  function renderTotals() {
    const eq = equity();
    const d = eq - START_BALANCE;
    const u = unrealized();
    if (equityEl) equityEl.textContent = money(eq);
    if (deltaEl) {
      deltaEl.textContent = `${signedMoney(d)} (${d >= 0 ? '+' : '−'}${Math.abs((d / START_BALANCE) * 100).toFixed(1)}%) since start`;
      deltaEl.className = `pnl mono ${d >= 0 ? 'pos' : 'neg'}`;
    }
    if (unrealEl) {
      unrealEl.textContent = signedMoney(u);
      unrealEl.className = `mono pnl ${u >= 0 ? 'pos' : 'neg'}`;
    }
  }

  // Equity history: a seeded walk from the starting balance to today's equity.
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const N = 48;
  const target = equity();
  const series = Array.from({ length: N }, (_, i) => {
    const t = i / (N - 1);
    const drift = START_BALANCE + (target - START_BALANCE) * t;
    const noise = i === 0 || i === N - 1 ? 0 : (rand() - 0.45) * 26 * Math.sin(Math.PI * t);
    return drift + noise;
  });

  function drawSpark() {
    const min = Math.min(...series, START_BALANCE) - 6;
    const max = Math.max(...series, START_BALANCE) + 6;
    const y = (v) => 88 - ((v - min) / (max - min)) * 80;
    line.setAttribute(
      'points',
      series.map((v, i) => `${((i / (series.length - 1)) * 320).toFixed(1)},${y(v).toFixed(1)}`).join(' '),
    );
    const by = y(START_BALANCE).toFixed(1);
    base.setAttribute('y1', by);
    base.setAttribute('y2', by);
  }

  POSITIONS.forEach((_, i) => renderRow(i, false));
  renderTotals();
  drawSpark();

  function tick() {
    const i = Math.floor(Math.random() * POSITIONS.length);
    const p = POSITIONS[i];
    const step = Math.random() < 0.55 ? 0.01 : -0.01;
    p.mark = Math.min(0.97, Math.max(0.03, Math.round((p.mark + step) * 100) / 100));
    renderRow(i, true);
    renderTotals();
    series.push(equity());
    series.shift();
    drawSpark();
  }

  createLoop(body.closest('.positions') ?? body, tick, 2600);
}

/* ---------- Connections: the model behind "Write text" changes ---------- */

const MODELS = [
  ['Anthropic', 'claude-sonnet-4-5'],
  ['OpenAI', 'gpt-4.1-mini'],
  ['Ollama', 'llama3.1:8b'],
  ['Sample data', 'sample-model'],
];

function initModelCycle() {
  const el = $('[data-model-cycle]');
  if (!el) return;
  let i = 0;
  createLoop(
    el,
    () => {
      i = (i + 1) % MODELS.length;
      el.classList.add('is-swapping');
      setTimeout(() => {
        const [name, model] = MODELS[i];
        el.innerHTML = `${esc(name)} <span class="dim">${esc(model)}</span>`;
        el.classList.remove('is-swapping');
      }, 200);
    },
    2600,
  );
}

/* ---------- Observability: tool calls stream in ---------- */

const CALLS = [
  ['apollo.organization_search', 200, 412],
  ['tavily.search', 200, 820],
  ['hunter.email_verifier', 200, 1180],
  ['anthropic.messages', 200, 4310],
  ['apollo.people_search', 429, 90],
  ['hubspot.upsert_contact', 200, 280],
  ['smtp.send', 250, 520],
  ['tavily.extract', 200, 1310],
  ['anthropic.messages', 200, 2140],
  ['hunter.email_finder', 200, 610],
  ['hubspot.create_note', 200, 210],
  ['slack.post_message', 200, 240],
  ['smtp.auth', 535, 210],
  ['apollo.people_search', 200, 340],
];

function initCalls() {
  const list = $('[data-calls]');
  if (!list) return;
  let secs = 14 * 3600 + 46 * 60 + 12;
  let idx = 0;
  const fmt = (s) => {
    const h = Math.floor(s / 3600) % 12 || 12;
    const m = Math.floor(s / 60) % 60;
    const sec = s % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };
  const cls = (code) => (code === 429 ? 'warn' : code >= 400 ? 'err' : 'ok');
  const row = (t, [op, code, ms]) =>
    `<span class="call-t">${fmt(t)}</span><span class="call-op">${esc(op)}</span><span class="call-code ${cls(code)}">${code}</span><span class="call-ms">${ms.toLocaleString('en-US')} ms</span>`;

  const ROWS = 8;
  const start = [];
  let t = secs;
  for (let i = 0; i < ROWS; i++) {
    start.push(`<li>${row(t, CALLS[i])}</li>`);
    t -= 9 + ((i * 7) % 13);
  }
  list.innerHTML = start.join('');
  idx = ROWS;

  createLoop(
    list,
    () => {
      secs += 4 + Math.floor(Math.random() * 16);
      const [op, code, ms] = CALLS[idx % CALLS.length];
      idx += 1;
      const jitter = Math.round(ms * (0.85 + Math.random() * 0.3));
      const li = document.createElement('li');
      li.className = 'is-new';
      li.innerHTML = row(secs, [op, code, jitter]);
      list.prepend(li);
      while (list.children.length > ROWS) list.lastElementChild.remove();
    },
    2200,
  );
}

initHero();
initPlaybooks();
initMarkets();
initModelCycle();
initCalls();
