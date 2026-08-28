const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Max-Age": "86400",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });
}

function scorePayload(row) {
  return {
    ok: true,
    unvested: Number(row.unvested || 0),
    unlocked: Number(row.unlocked || 0),
    ads: Number(row.ads || 0),
  };
}

export class ChatRoom {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }
    if (request.method === "GET") {
      const messages = (await this.ctx.storage.get("messages")) || [];
      return json({ ok: true, messages });
    }
    if (request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: "bad json" }, 400);
      }
      const nick = String(body.nick || "")
        .replace(/[^\w\-.]/g, "")
        .slice(0, 18);
      const text = String(body.text || "")
        .replace(/[<>]/g, "")
        .trim()
        .slice(0, 280);
      if (!nick || nick.length < 2) return json({ ok: false, error: "nick" }, 400);
      if (!text) return json({ ok: false, error: "empty" }, 400);
      const lastAt = Number((await this.ctx.storage.get("last:" + nick)) || 0);
      const now = Date.now();
      if (now - lastAt < 1500) return json({ ok: false, error: "slow down" }, 429);
      const messages = (await this.ctx.storage.get("messages")) || [];
      messages.push({ nick, text, t: now });
      while (messages.length > 120) messages.shift();
      await this.ctx.storage.put("messages", messages);
      await this.ctx.storage.put("last:" + nick, now);
      return json({ ok: true, messages });
    }
    return json({ ok: false }, 405);
  }
}

export class ScoreCard {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }
    const row = (await this.ctx.storage.get("row")) || {
      unvested: 0,
      unlocked: 0,
      ads: 0,
      last: 0,
      lastT: 0,
    };
    if (request.method === "GET") {
      return json(scorePayload(row));
    }
    if (request.method !== "POST") {
      return json({ ok: false }, 405);
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "bad json" }, 400);
    }
    const now = Date.now();
    const playing = !!body.playing;
    const muted = !!body.muted;
    const t = Number(body.t);
    const duration = Number(body.d);
    const last = Number(row.last || 0);
    const lastT = Number(row.lastT || 0);
    let creditMin = 0;
    if (playing && last > 0 && now - last <= 20000) {
      const wallSec = Math.min(6, Math.max(0, (now - last) / 1000));
      let headSec = 0;
      if (Number.isFinite(t) && Number.isFinite(lastT)) {
        headSec = t - lastT;
        if (headSec < -1) {
          const nearEnd = Number.isFinite(duration) && lastT > duration - 3;
          headSec = nearEnd && t < 5 ? wallSec : 0;
        }
      }
      const credited = Math.min(wallSec, Math.max(0, headSec) * 1.15);
      let rate = 1;
      if (muted) rate = 0.25;
      creditMin = credited * rate / 60;
    }
    row.unvested = Number(row.unvested || 0) + creditMin;
    row.last = now;
    if (Number.isFinite(t)) row.lastT = t;
    row.title = String(body.title || "").slice(0, 40);
    await this.ctx.storage.put("row", row);
    return json(scorePayload(row));
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }
    if (url.pathname === "/points" || url.pathname.endsWith("/points")) {
      const sid = (url.searchParams.get("id") || "").replace(/[^\w\-]/g, "").slice(0, 64);
      if (sid.length < 8) return json({ ok: false, error: "id" }, 400);
      const stub = env.SCORE.idFromName(sid);
      return env.SCORE.get(stub).fetch(request);
    }
    const room = (url.searchParams.get("room") || "lobby").replace(/[^\w\-]/g, "").slice(0, 40) || "lobby";
    const id = env.CHAT_ROOM.idFromName(room);
    return env.CHAT_ROOM.get(id).fetch(request);
  },
};
