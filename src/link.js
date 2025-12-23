// src/index.js
const LINKS_NS = "quick-look";

// 简单 base62
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
function base62(bytes) {
  let x = 0n;
  for (const b of bytes) x = (x << 8n) + BigInt(b);
  let out = "";
  while (x > 0n) {
    out = ALPHABET[Number(x % 62n)] + out;
    x = x / 62n;
  }
  return out || "0";
}

function json(res, status = 200, headers = {}) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers }
  });
}

function bad(status, msg) {
  return json({ error: msg }, status);
}

function isHttpUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === "http:" || x.protocol === "https:";
  } catch {
    return false;
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderPreviewPage({ code, targetUrl, description }) {
  const safeDesc = escapeHtml(description || "");
  const safeUrl = escapeHtml(targetUrl || "");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>链接预览 - ${escapeHtml(code)}</title>
  <meta name="referrer" content="no-referrer" />
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; margin: 0; padding: 24px; background:#f7f7f8; }
    .card { max-width: 720px; margin: 0 auto; background:#fff; border-radius: 12px; padding: 20px; box-shadow: 0 6px 18px rgba(0,0,0,.06); }
    .k { color:#666; font-size: 13px; margin-bottom: 6px; }
    .desc { font-size: 16px; line-height: 1.6; margin: 10px 0 14px; white-space: pre-wrap; word-break: break-word; }
    .url { font-size: 13px; color:#444; background:#f2f3f5; padding: 10px; border-radius: 8px; word-break: break-all; }
    .btn { display:inline-block; margin-top: 14px; padding: 10px 14px; border-radius: 10px; background:#1677ff; color:#fff; text-decoration:none; }
    .muted { color:#888; font-size: 12px; margin-top: 10px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="k">描述</div>
    <div class="desc">${safeDesc || "（无描述）"}</div>

    <div class="k">目标链接</div>
    <div class="url">${safeUrl}</div>

    <a class="btn" href="${safeUrl}" rel="noopener noreferrer">继续访问</a>
    <div class="muted">提示：如需直接跳转，可在链接后追加 <code>?raw=1</code></div>
  </div>
</body>
</html>`;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 1) 跳转入口：/s/{code}
    const m = path.match(/^\/s\/([0-9a-zA-Z_-]{3,64})$/);
    if (m) {
    const code = m[1];
    const kv = new EdgeKV({ namespace: LINKS_NS });

    const data = await kv.get(`link:${code}`, { type: "json" });
    if (!data || !data.url) return bad(404, "Short link not found");

    const targetUrl = data.url;
    const description = typeof data.description === "string" ? data.description : "";

    // A) 显式请求 JSON 信息：/s/{code}?info=1
    if (url.searchParams.get("info") === "1") {
        return json({ code, url: targetUrl, description }, 200);
    }

    // B) 强制原样跳转：/s/{code}?raw=1
    if (url.searchParams.get("raw") === "1") {
        return new Response(null, {
        status: 302,
        headers: {
            Location: targetUrl,
            // 可选：把描述带在 header 里（需要的话）
            "X-Shortlink-Description": description
        }
        });
    }

    // C) 默认：浏览器访问返回预览页（展示 description），程序访问保持跳转
    const accept = request.headers.get("accept") || "";
    const wantsHtml = accept.includes("text/html");

    if (wantsHtml) {
        const html = renderPreviewPage({ code, targetUrl, description });
        return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" }
        });
    }

    // 非浏览器：保持 302 跳转
    return Response.redirect(targetUrl, 302);
    }


    // 2) 管理 API：创建短链 POST /api/links
    if (path === "/api/links" && request.method === "POST") {

      const body = await request.json().catch(() => null);
      if (!body || typeof body.url !== "string" || !isHttpUrl(body.url)) {
        return bad(400, "Invalid url (must be http/https)");
      }

      if (!body.description || body.description.trim() === '') {
        return bad(400, "Invalid description");
      }

      const kv = new EdgeKV({ namespace: LINKS_NS });

      // 支持自定义 code；否则随机生成
      let code = (body.code && String(body.code)) || "";
      if (code) {
        if (!/^[0-9a-zA-Z_-]{3,64}$/.test(code)) return bad(400, "Invalid code");
        const exists = await kv.get(`link:${code}`, { type: "json" });
        if (exists) return bad(409, "Code already exists");
      } else {
        for (let i = 0; i < 5; i++) {
          const rnd = crypto.getRandomValues(new Uint8Array(6));
          code = base62(rnd).slice(0, 7);
          const exists = await kv.get(`link:${code}`, { type: "json" });
          if (!exists) break;
        }
      }

      const record = {
        url: body.url,
        createdAt: Date.now(),
        note: body.note ? String(body.note) : "",
        description: body.description
      };

      await kv.put(`link:${code}`, JSON.stringify(record));
      return json({ code, ...record }, 201);
    }

    // 3) 查询短链 GET /api/links/{code}
    const m2 = path.match(/^\/api\/links\/([0-9a-zA-Z_-]{3,64})$/);
    if (m2 && request.method === "GET") {
      const code = m2[1];
      const kv = new EdgeKV({ namespace: LINKS_NS });
      const data = await kv.get(`link:${code}`, { type: "json" });
      if (!data) return bad(404, "Not found");
      return json({ code, ...data });
    }

    // 默认：交给静态资源；若没有静态资源则返回 404（Pages 默认路由逻辑见文档）:contentReference[oaicite:11]{index=11}
    return bad(404, "Not Found");
  }
};
