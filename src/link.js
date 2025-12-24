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

// 清理文本
function sanitizeText(s, maxLen = 400) {
  if (typeof s !== "string") return "";
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

// 调用大模型API生成描述
async function generateDescriptionByLLM(url, hint = "", apiKey, model = "qwen-plus", endpoint = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions") {
  const targetUrl = url.trim();
  const hintText = sanitizeText(hint);

  if (!isHttpUrl(targetUrl)) {
    throw new Error("Invalid URL (must be http/https)");
  }

  if (!apiKey || apiKey.trim() === "") {
    throw new Error("API key is required");
  }

  try {
    const resp = await fetch(endpoint.trim(), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey.trim()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: model.trim() || "qwen-plus",
        messages: [
          { 
            role: "system", 
            content: "你是短链平台的描述生成助手。你只能基于用户给出的URL字符串与提示信息推断页面用途；不要臆造具体事实（例如价格、品牌、优惠、功能细节）。输出必须是一段中文短描述（20-80字），纯文本，不要Markdown，不要换行，不要包含URL。"
          },
          { 
            role: "user", 
            content: `URL：${targetUrl}\n提示信息（可能为空）：${hintText || "(空)"}\n\n任务：生成一段用于短链 description 的短描述。\n要求：\n1) 如果无法从URL/提示信息判断页面用途，直接输出：需要补充描述\n2) 若能判断，描述要中性、具体但不夸大，避免任何编造细节。\n`
          }
        ],
        temperature: 0.2
      })
    });

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`LLM 调用失败：HTTP ${resp.status} ${t.slice(0, 200)}`);
    }
    
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content;
    
    if (!content) throw new Error("LLM 返回为空或格式不符合预期");
    
    return sanitizeText(content, 120);
  } catch (e) {
    throw e;
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;


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
  
    // 4) 生成描述 API：POST /api/describe
    if (path === "/api/describe" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      if (!body) {
        return bad(400, "Invalid request body");
      }

      try {
        const description = await generateDescriptionByLLM(
          body.url,
          body.hint || "",
          body.apiKey,
          body.model || "qwen-plus",
          body.endpoint || "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
        );
        return json({ description }, 200);
      } catch (error) {
        return bad(400, error.message);
      }
    }

    // 默认：交给静态资源；若没有静态资源则返回 404（Pages 默认路由逻辑见文档）:contentReference[oaicite:11]{index=11}
    return bad(404, "Not Found");
  }
};
