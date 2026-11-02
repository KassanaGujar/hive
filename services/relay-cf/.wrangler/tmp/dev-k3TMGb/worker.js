var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/worker.ts
import { DurableObject } from "cloudflare:workers";
var MAX_MEMBERS = 10;
var MAX_LOG = 2e4;
var CHUNK = 1e6;
var INVITE_TTL = 24 * 60 * 60 * 1e3;
async function sha256(s) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256, "sha256");
var send = /* @__PURE__ */ __name((ws, m) => {
  try {
    ws.send(JSON.stringify(m));
  } catch {
  }
}, "send");
var worker_default = {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.headers.get("Upgrade") !== "websocket") {
      if (url.pathname === "/" || url.pathname === "/health") {
        return Response.json({ ok: true, service: "hive-relay", runtime: "cloudflare" });
      }
      return new Response("Not found", { status: 404 });
    }
    if (url.searchParams.get("invite")) return env.INVITES.get(env.INVITES.idFromName("global")).fetch(req);
    const room = url.searchParams.get("room") ?? "";
    if (!/^[a-f0-9]{8,64}$/.test(room)) return new Response("room required", { status: 400 });
    return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(req);
  }
};
var Room = class extends DurableObject {
  static {
    __name(this, "Room");
  }
  sql;
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS log (seq INTEGER, part INTEGER, data TEXT, PRIMARY KEY (seq, part));
      CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, json TEXT);
      CREATE TABLE IF NOT EXISTS banned (id TEXT PRIMARY KEY);
    `);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }
  async fetch(req) {
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({});
    const room = new URL(req.url).searchParams.get("room");
    if (!this.meta("id")) this.setMeta("id", room);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  // ---------- storage helpers ----------
  meta(k) {
    const r = this.sql.exec("SELECT v FROM meta WHERE k = ?", k).toArray()[0];
    return r ? r.v : null;
  }
  setMeta(k, v) {
    this.sql.exec("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, v);
  }
  seq() {
    return Number(this.meta("seq") ?? 0);
  }
  append(seq, data) {
    for (let i = 0, part = 0; i < data.length || part === 0; i += CHUNK, part++) {
      this.sql.exec("INSERT OR REPLACE INTO log (seq, part, data) VALUES (?, ?, ?)", seq, part, data.slice(i, i + CHUNK));
    }
  }
  readLog() {
    const out = [];
    for (const r of this.sql.exec("SELECT seq, data FROM log ORDER BY seq, part")) {
      const last = out[out.length - 1];
      if (last && last.seq === r.seq) last.data += r.data;
      else out.push({ seq: r.seq, data: r.data });
    }
    return out;
  }
  members() {
    const m = /* @__PURE__ */ new Map();
    for (const r of this.sql.exec("SELECT json FROM members")) {
      const info = JSON.parse(r.json);
      m.set(info.id, info);
    }
    return m;
  }
  saveMember(info) {
    this.sql.exec("INSERT OR REPLACE INTO members (id, json) VALUES (?, ?)", info.id, JSON.stringify(info));
  }
  socketsOf(memberId) {
    return this.ctx.getWebSockets().filter((ws) => ws.deserializeAttachment()?.memberId === memberId);
  }
  memberList() {
    const online = new Set(this.ctx.getWebSockets().map((ws) => ws.deserializeAttachment()?.memberId).filter(Boolean));
    return [...this.members().values()].map((m) => ({ ...m, online: online.has(m.id) }));
  }
  broadcast(m, except) {
    const s = JSON.stringify(m);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except || !ws.deserializeAttachment()?.memberId) continue;
      try {
        ws.send(s);
      } catch {
      }
    }
  }
  async isAdmin(token) {
    const h = this.meta("adminHash");
    return !!h && h === await sha256(token);
  }
  attach(ws, member, role) {
    const members = this.members();
    let info = members.get(member.id);
    if (!info) {
      if (members.size >= MAX_MEMBERS) return send(ws, { t: "error", message: `This project is full (${MAX_MEMBERS} people max).` });
      info = { ...member, role, online: true };
    } else {
      info = { ...info, name: member.name, color: member.color, avatar: member.avatar, role: role === "host" ? "host" : info.role };
    }
    this.saveMember(info);
    ws.serializeAttachment({ memberId: info.id });
    send(ws, { t: "joined", room: this.meta("id"), you: info.id, members: this.memberList(), log: this.readLog() });
    this.broadcast({ t: "members", members: this.memberList() }, ws);
  }
  // ---------- protocol ----------
  async webSocketMessage(ws, raw) {
    let msg;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return send(ws, { t: "error", message: "bad message" });
    }
    const att = ws.deserializeAttachment() ?? {};
    const me = att.memberId;
    switch (msg.t) {
      case "ping":
        return send(ws, { t: "pong" });
      case "create": {
        if (typeof msg.adminToken !== "string" || msg.adminToken.length < 16) return send(ws, { t: "error", message: "bad room" });
        const existing = this.meta("adminHash");
        if (existing && !await this.isAdmin(msg.adminToken)) return send(ws, { t: "error", message: "Room exists and you are not its host." });
        if (!existing) this.setMeta("adminHash", await sha256(msg.adminToken));
        return this.attach(ws, msg.member, "host");
      }
      case "join": {
        if (!this.meta("adminHash")) return send(ws, { t: "error", message: "That project was not found on this relay. Check the invite." });
        if (this.sql.exec("SELECT 1 FROM banned WHERE id = ?", msg.member?.id).toArray().length) return send(ws, { t: "kicked" });
        return this.attach(ws, msg.member, "editor");
      }
      case "update": {
        if (!me) return;
        if (this.members().get(me)?.role === "viewer") return send(ws, { t: "error", message: "Viewers can not edit." });
        const seq = this.seq() + 1;
        this.setMeta("seq", String(seq));
        this.append(seq, String(msg.data));
        const count = this.sql.exec("SELECT COUNT(DISTINCT seq) AS n FROM log").one().n;
        if (count > MAX_LOG) this.sql.exec("DELETE FROM log WHERE seq <= ?", seq - MAX_LOG);
        this.broadcast({ t: "update", seq, from: me, data: msg.data }, ws);
        return;
      }
      case "awareness":
        if (me) this.broadcast({ t: "awareness", from: me, data: msg.data }, ws);
        return;
      case "snapshot": {
        if (!me) return;
        const upTo = Number(msg.upTo);
        this.sql.exec("DELETE FROM log WHERE seq <= ?", upTo);
        this.append(upTo, String(msg.data));
        return;
      }
      case "invite:create": {
        if (!me || !await this.isAdmin(msg.adminToken)) return send(ws, { t: "error", message: "Only the host can invite." });
        if (!/^[A-Z0-9]{6}$/.test(msg.code)) return;
        await this.env.INVITES.get(this.env.INVITES.idFromName("global")).put(msg.code, String(msg.sealed), Date.now() + INVITE_TTL);
        return;
      }
      case "role": {
        if (!await this.isAdmin(msg.adminToken)) return;
        const m = this.members().get(msg.memberId);
        if (m && m.role !== "host" && (msg.role === "editor" || msg.role === "viewer")) {
          this.saveMember({ ...m, role: msg.role });
          this.broadcast({ t: "members", members: this.memberList() });
        }
        return;
      }
      case "kick": {
        if (!await this.isAdmin(msg.adminToken)) return;
        const m = this.members().get(msg.memberId);
        if (!m || m.role === "host") return;
        this.sql.exec("INSERT OR IGNORE INTO banned (id) VALUES (?)", m.id);
        this.sql.exec("DELETE FROM members WHERE id = ?", m.id);
        for (const s of this.socketsOf(m.id)) {
          send(s, { t: "kicked" });
          s.close(1e3, "removed");
        }
        this.broadcast({ t: "members", members: this.memberList() });
        return;
      }
    }
  }
  async webSocketClose(ws) {
    ws.serializeAttachment({});
    this.broadcast({ t: "members", members: this.memberList() });
  }
  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }
};
var Invites = class extends DurableObject {
  static {
    __name(this, "Invites");
  }
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS invites (code TEXT PRIMARY KEY, sealed TEXT, expires INTEGER)");
  }
  async put(code, sealed, expires) {
    const sql = this.ctx.storage.sql;
    sql.exec("DELETE FROM invites WHERE expires < ?", Date.now());
    sql.exec("INSERT OR REPLACE INTO invites (code, sealed, expires) VALUES (?, ?, ?)", code, sealed, expires);
  }
  async fetch() {
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({});
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  async webSocketMessage(ws, raw) {
    let msg;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    if (msg.t !== "invite:get") return;
    const att = ws.deserializeAttachment() ?? {};
    const now = Date.now();
    if (att.lastInviteGet && now - att.lastInviteGet < 1e3) return send(ws, { t: "invite", code: msg.code, sealed: null });
    ws.serializeAttachment({ ...att, lastInviteGet: now });
    const code = String(msg.code ?? "").toUpperCase();
    const row = this.ctx.storage.sql.exec("SELECT sealed FROM invites WHERE code = ? AND expires > ?", code, now).toArray()[0];
    send(ws, { t: "invite", code: msg.code, sealed: row ? row.sealed : null });
  }
};

// ../../node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-Ibf3AJ/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-Ibf3AJ/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  Invites,
  Room,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
