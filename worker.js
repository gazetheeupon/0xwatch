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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }
    const room = (url.searchParams.get("room") || "lobby").replace(/[^\w\-]/g, "").slice(0, 40) || "lobby";
    const id = env.CHAT_ROOM.idFromName(room);
    return env.CHAT_ROOM.get(id).fetch(request);
  },
};
