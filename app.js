(function () {
  const $ = (id) => document.getElementById(id);
  const vid = $("vid");

  const CHAT_URL = "https://oxwatch-chat.typical-impala.workers.dev/";
  const POINTS_URL = CHAT_URL.replace(/\/?$/, "/") + "points";
  if (!localStorage.getItem("ox_sid")) {
    const sid = (crypto.randomUUID && crypto.randomUUID()) || ("id" + Math.random().toString(16).slice(2) + Date.now().toString(16));
    localStorage.setItem("ox_sid", sid);
  }
  const SID = localStorage.getItem("ox_sid");
  const state = {
    id: null,
    unvested: 0,
    unlocked: 0,
    ads: 0,
    session: 0,
    last: performance.now(),
    accruing: false,
    room: "lobby",
    seen: 0
  };

  if (!localStorage.getItem("ox_nick")) {
    const n = "ox" + Math.random().toString(16).slice(2, 6);
    localStorage.setItem("ox_nick", n);
  }
  $("nick").value = localStorage.getItem("ox_nick");
  $("nick").addEventListener("change", () => {
    const n = $("nick").value.replace(/[^\w\-.]/g, "").slice(0, 18);
    $("nick").value = n;
    localStorage.setItem("ox_nick", n);
  });

  function fmt(n) {
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function clockfmt(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ":" + String(s).padStart(2, "0");
  }
  function paint() {
    $("bigpts").innerHTML = fmt(state.unvested) + "<em> pts</em>";
    $("pill-pts").textContent = fmt(state.unvested);
    $("pill-unl").textContent = fmt(state.unlocked);
    $("unlocked").textContent = fmt(state.unlocked);
    $("ads").textContent = "$" + fmt(state.ads);
    $("sess").textContent = clockfmt(state.session);
    const live = state.accruing;
    $("accrue").textContent = live ? "accruing" : "paused";
    $("sig").textContent = live ? "play + foreground" : "idle";
    $("livepill").innerHTML = live
      ? "<strong>live</strong> · minting"
      : "<strong>idle</strong> · no signal";
    $("livepill").classList.toggle("live", live);
    const pct = state.ads > 0 ? Math.min(100, (state.unlocked / Math.max(state.unvested, 0.01)) * 100) : 0;
    $("vestbar").style.width = pct + "%";
    $("vestbar").style.opacity = state.ads > 0 ? "1" : "0.35";
  }

  function load(item, autoplay) {
    state.id = item.id;
    vid.pause();
    vid.src = item.src;
    vid.poster = item.poster;
    $("title").textContent = item.title;
    $("why").textContent = item.why + " · " + item.year + " · " + item.runtime;
    $("rights").textContent = item.rights;
    document.querySelectorAll(".card").forEach((c) => c.classList.toggle("on", c.dataset.id === item.id));
    joinRoom(item.id);
    if (autoplay) vid.play().catch(() => {});
  }

  function renderShelf() {
    const shelf = $("shelf");
    shelf.innerHTML = "";
    window.OX_CATALOG.forEach((item) => {
      const b = document.createElement("button");
      b.className = "card";
      b.dataset.id = item.id;
      b.type = "button";
      b.innerHTML =
        "<img alt=\"\" src=\"" + item.poster + "\" onerror=\"this.src='./assets/hero.jpg'\">" +
        "<div class=\"t\"><b>" + item.title + "</b><small>" + item.year + " · " + item.runtime + "</small></div>";
      b.addEventListener("click", () => load(item, true));
      shelf.appendChild(b);
    });
  }

  function isLive() {
    return (
      !vid.paused &&
      !vid.ended &&
      vid.currentTime > 0 &&
      document.visibilityState === "visible" &&
      !document.hidden
    );
  }


  function applyScore(data) {
    if (!data || !data.ok) return;
    state.unvested = Number(data.unvested || 0);
    state.unlocked = Number(data.unlocked || 0);
    state.ads = Number(data.ads || 0);
    paint();
  }
  async function pullScore() {
    try {
      const r = await fetch(POINTS_URL + "?id=" + encodeURIComponent(SID), { cache: "no-store" });
      applyScore(await r.json());
    } catch (_) {}
  }
  async function heartbeat() {
    const live = isLive();
    state.accruing = live;
    try {
      const r = await fetch(POINTS_URL + "?id=" + encodeURIComponent(SID), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: state.id || "",
          playing: live,
          muted: !!(vid.muted || vid.volume < 0.05),
          t: vid.currentTime || 0,
          d: vid.duration || 0
        })
      });
      applyScore(await r.json());
    } catch (_) {}
  }
  function tick(now) {
    const dt = Math.min(1, (now - state.last) / 1000);
    state.last = now;
    state.accruing = isLive();
    if (state.accruing) state.session += dt;
    paint();
    requestAnimationFrame(tick);
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  function renderMessages(messages) {
    const log = $("log");
    const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
    log.innerHTML = "";
    if (!messages.length) {
      const d = document.createElement("div");
      d.className = "msg";
      d.innerHTML = "<span class=\"who sys\">0xwatch</span><span class=\"txt\">Empty lounge. First line is yours.</span>";
      log.appendChild(d);
      return;
    }
    messages.forEach((m) => {
      const d = document.createElement("div");
      d.className = "msg";
      const when = new Date(m.t || Date.now());
      const hh = String(when.getHours()).padStart(2, "0") + ":" + String(when.getMinutes()).padStart(2, "0");
      d.innerHTML =
        "<span class=\"who\">" + esc(m.nick) + "</span>" +
        "<span class=\"txt\">" + esc(m.text) + "</span>" +
        "<time>" + hh + "</time>";
      log.appendChild(d);
    });
    if (stick) log.scrollTop = log.scrollHeight;
  }
  async function pullChat() {
    try {
      const r = await fetch(CHAT_URL + "?room=" + encodeURIComponent(state.room), { cache: "no-store" });
      const data = await r.json();
      if (data && data.messages) renderMessages(data.messages);
      $("chatroom").textContent = state.room;
    } catch {
      $("chatroom").textContent = state.room + " · offline";
    }
  }
  function joinRoom(id) {
    state.room = id || "lobby";
    $("chatroom").textContent = state.room;
    pullChat();
  }
  $("composer").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("draft").value.trim();
    const nick = $("nick").value.replace(/[^\w\-.]/g, "").slice(0, 18);
    if (!text || !nick) return;
    $("draft").value = "";
    try {
      const r = await fetch(CHAT_URL + "?room=" + encodeURIComponent(state.room), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nick, text })
      });
      const data = await r.json();
      if (data && data.messages) renderMessages(data.messages);
      else if (!data.ok) $("chatroom").textContent = data.error || "rejected";
    } catch {
      $("chatroom").textContent = state.room + " · offline";
    }
  });
  setInterval(pullChat, 2500);
  setInterval(heartbeat, 4000);
  document.addEventListener("visibilitychange", heartbeat);
  vid.addEventListener("pause", heartbeat);
  vid.addEventListener("play", heartbeat);

  renderShelf();
  load(window.OX_CATALOG[0], false);
  pullScore();
  paint();
  requestAnimationFrame(tick);
})();

