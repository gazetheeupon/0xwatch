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

  const state = {
    id: null,
    unvested: Number(localStorage.getItem("ox_unvested") || 0),
    unlocked: Number(localStorage.getItem("ox_unlocked") || 0),
    ads: Number(localStorage.getItem("ox_ads") || 0),
    session: 0,
    last: performance.now(),
    accruing: false
  };

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

  renderShelf();
  load(window.OX_CATALOG[0], false);
  paint();
  requestAnimationFrame(tick);
})();
