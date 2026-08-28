(function () {
  const $ = (id) => document.getElementById(id);
  const vid = $("vid");
  const poster = $("poster");
  const playBig = $("playBig");
  const playMini = $("playMini");
  const fill = $("fill");
  const clock = $("clock");
  const mute = $("mute");
  const fs = $("fs");
  const seek = $("seek");
  const stage = $("stage");

  const CHAT_URL = "https://oxwatch-chat.typical-impala.workers.dev/";
  const state = {
    id: null,
    unvested: Number(localStorage.getItem("ox_unvested") || 0),
    unlocked: Number(localStorage.getItem("ox_unlocked") || 0),
    ads: Number(localStorage.getItem("ox_ads") || 0),
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
  function save() {
    localStorage.setItem("ox_unvested", String(state.unvested));
    localStorage.setItem("ox_unlocked", String(state.unlocked));
    localStorage.setItem("ox_ads", String(state.ads));
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
    vid.removeAttribute("src");
    vid.pause();
    vid.src = item.src;
    vid.poster = item.poster;
    poster.style.backgroundImage = "url('" + item.poster + "'), url('./assets/hero.jpg')";
    poster.style.display = "block";
    $("title").textContent = item.title;
    $("why").textContent = item.why + " · " + item.year + " · " + item.runtime;
    $("rights").textContent = item.rights;
    document.querySelectorAll(".card").forEach((c) => c.classList.toggle("on", c.dataset.id === item.id));
    joinRoom(item.id);
    playBig.style.display = autoplay ? "none" : "grid";
    if (autoplay) {
      vid.play().catch(() => {
        playBig.style.display = "grid";
      });
    }
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
  function rate() {
    if (!isLive()) return 0;
    if (vid.muted || vid.volume < 0.05) return 0.25;
    return 1;
  }

  function tick(now) {
    const dt = Math.min(1, (now - state.last) / 1000);
    state.last = now;
    const r = rate();
    state.accruing = r > 0;
    if (r > 0) {
      state.unvested += (r * dt) / 60;
      state.session += dt;
      save();
    }
    if (!vid.paused && vid.duration) {
      fill.style.width = (vid.currentTime / vid.duration) * 100 + "%";
      clock.textContent = clockfmt(vid.currentTime) + " / " + clockfmt(vid.duration);
    }
    playMini.textContent = vid.paused ? "▶" : "❚❚";
    mute.textContent = vid.muted ? "muted" : "unmuted";
    paint();
    requestAnimationFrame(tick);
  }

  function toggle() {
    if (vid.paused) {
      playBig.style.display = "none";
      poster.style.display = "none";
      vid.play().catch(() => {
        playBig.style.display = "grid";
      });
    } else {
      vid.pause();
    }
  }

  playBig.addEventListener("click", toggle);
  playMini.addEventListener("click", toggle);
  vid.addEventListener("click", toggle);
  vid.addEventListener("play", () => {
    playBig.style.display = "none";
    poster.style.display = "none";
  });
  vid.addEventListener("pause", () => {
    if (vid.currentTime < 0.2) playBig.style.display = "grid";
  });
  mute.addEventListener("click", () => {
    vid.muted = !vid.muted;
  });
  fs.addEventListener("click", () => {
    if (!document.fullscreenElement) stage.requestFullscreen().catch(() => {});
    else document.exitFullscreen();
  });
  seek.addEventListener("click", (e) => {
    if (!vid.duration) return;
    const rct = seek.getBoundingClientRect();
    vid.currentTime = ((e.clientX - rct.left) / rct.width) * vid.duration;
  });

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

  renderShelf();
  load(window.OX_CATALOG[0], false);
  paint();
  requestAnimationFrame(tick);
})();

