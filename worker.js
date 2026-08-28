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

export class IpPool {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }
    if (request.method !== "POST") return json({ ok: false }, 405);
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "bad json" }, 400);
    }
    const sid = String(body.sid || "").slice(0, 64);
    const want = Math.max(0, Number(body.want) || 0);
    const now = Date.now();
    let window = (await this.ctx.storage.get("w")) || [];
    window = window.filter((x) => now - x.t < 60000);
    const sids = new Set(window.map((x) => x.sid));
    if (sid) sids.add(sid);
    const n = Math.max(1, sids.size);
    const used = window.reduce((s, x) => s + Number(x.a || 0), 0);
    const cap = 1;
    const share = want / n;
    const allow = Math.max(0, Math.min(share, cap - used, want));
    if (sid) window.push({ t: now, a: allow, sid });
    if (window.length > 400) window = window.slice(-300);
    await this.ctx.storage.put("w", window);
    return json({ ok: true, allow, n });
  }
}

export class ScoreCard {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
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
    const ipk = request.headers.get("X-Ox-Ip") || "";
    const sid = request.headers.get("X-Ox-Sid") || "";
    if (creditMin > 0 && ipk && this.env && this.env.IPPOOL) {
      try {
        const gate = this.env.IPPOOL.get(this.env.IPPOOL.idFromName(ipk));
        const g = await gate.fetch(
          new Request("https://ippool/admit", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sid, want: creditMin }),
          })
        );
        const admitted = await g.json();
        if (typeof admitted.allow === "number") creditMin = Math.max(0, admitted.allow);
      } catch (_) {
        creditMin = 0;
      }
    }
    row.unvested = Number(row.unvested || 0) + creditMin;
    row.last = now;
    if (Number.isFinite(t)) row.lastT = t;
    row.title = String(body.title || "").slice(0, 40);
    await this.ctx.storage.put("row", row);
    return json(scorePayload(row));
  }
}

async function hashIp(ip) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("0xwatch:" + ip));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
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
      const rawIp =
        request.headers.get("CF-Connecting-IP") ||
        (request.headers.get("X-Forwarded-For") || "").split(",")[0].trim() ||
        "unknown";
      const ipk = await hashIp(rawIp);
      const headers = new Headers(request.headers);
      headers.set("X-Ox-Ip", ipk);
      headers.set("X-Ox-Sid", sid);
      const stub = env.SCORE.idFromName(sid);
      return env.SCORE.get(stub).fetch(new Request(request, { headers }));
    }
    const room = (url.searchParams.get("room") || "lobby").replace(/[^\w\-]/g, "").slice(0, 40) || "lobby";
    const id = env.CHAT_ROOM.idFromName(room);
    return env.CHAT_ROOM.get(id).fetch(request);
  },
};
