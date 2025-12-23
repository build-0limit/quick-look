<script setup lang="ts">
import { ref } from 'vue';

// 表单数据
const url = ref('');
const code = ref('');
const note = ref('');
const hint = ref('');
const description = ref('');

// LLM 设置
const apiKey = ref('');
const model = ref('qwen-plus');
const endpoint = ref('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');

// 状态信息
const status = ref('');
const statusType = ref('info');
const lastCreateResponse = ref<any>(null);
const result = ref('<div class="status">尚未创建。</div>');
const btnDescribeDisabled = ref(false);
const btnCreateDisabled = ref(false);

// 设置状态信息
function setStatus(msg: string, type: string = "info") {
  status.value = msg;
  statusType.value = type;
}

// 验证 URL
function isHttpUrl(u: string): boolean {
  try {
    const x = new URL(u);
    return x.protocol === "http:" || x.protocol === "https:";
  } catch {
    return false;
  }
}

// 清理文本
function sanitizeText(s: string, maxLen: number = 400): string {
  if (typeof s !== "string") return "";
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

// 调用 LLM 生成描述
async function callLLM() {
  const targetUrl = url.value.trim();
  const hintText = sanitizeText(hint.value, 500);

  if (!isHttpUrl(targetUrl)) {
    setStatus("请输入合法的 http/https URL。", "err");
    return;
  }

  if (!apiKey.value.trim()) {
    setStatus("请先填写 DashScope API Key，或改为后端代调用方案。", "err");
    return;
  }

  btnDescribeDisabled.value = true;
  setStatus("正在调用 LLM 生成描述（仅基于 URL + 提示信息）…");

  try {
    const resp = await fetch(endpoint.value.trim(), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey.value.trim()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: model.value.trim() || "qwen-plus",
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
    
    description.value = sanitizeText(content, 120);

    if (description.value === "需要补充描述") {
      setStatus("LLM 无法判断页面用途：请补充“提示信息”或手动填写 description。", "err");
    } else {
      setStatus("LLM 描述已生成并填入 description。", "ok");
    }
  } catch (e) {
    setStatus(`生成描述失败：${(e as Error).message}`, "err");
  } finally {
    btnDescribeDisabled.value = false;
  }
}

// 创建短链
async function createShortLink() {
  const targetUrl = url.value.trim();
  const codeValue = code.value.trim();
  const noteValue = note.value.trim();
  const descValue = description.value.trim();

  if (!isHttpUrl(targetUrl)) {
    setStatus("请输入合法的 http/https URL。", "err");
    return;
  }
  
  if (!descValue) {
    setStatus("description 必填。请先生成描述或手动填写。", "err");
    return;
  }
  
  if (descValue === "需要补充描述") {
    setStatus("当前 description 为“需要补充描述”，请补充后再创建。", "err");
    return;
  }
  
  if (codeValue && !/^[0-9a-zA-Z_-]{3,64}$/.test(codeValue)) {
    setStatus("code 格式不合法：仅允许 3-64 位 [0-9a-zA-Z_-]。", "err");
    return;
  }

  btnCreateDisabled.value = true;
  setStatus("正在创建短链…");

  try {
    const resp = await fetch("/api/links", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json; charset=utf-8" 
      },
      body: JSON.stringify({
        url: targetUrl,
        code: codeValue || undefined,
        note: noteValue || undefined,
        description: descValue
      })
    });
    
    const data = await resp.json().catch(() => null);
    
    if (!resp.ok) {
      const msg = data?.error || `创建失败：HTTP ${resp.status}`;
      throw new Error(msg);
    }

    lastCreateResponse.value = data;

    const shortUrl = `${location.origin}/s/${data.code}`;
    result.value = `
      <div><b>Short URL：</b> <a href="${shortUrl}" target="_blank" rel="noopener noreferrer">${shortUrl}</a></div>
      <div><b>原始 URL：</b> <span class="mono">${data.url}</span></div>
      <div><b>描述：</b> ${data.description || ""}</div>
    `;

    setStatus("短链创建成功。", "ok");
  } catch (e) {
    setStatus(`创建失败：${(e as Error).message}`, "err");
  } finally {
    btnCreateDisabled.value = false;
  }
}

// 清空表单
function clearForm() {
  url.value = "";
  code.value = "";
  note.value = "";
  hint.value = "";
  description.value = "";
  apiKey.value = "";
  result.value = '<div class="status">尚未创建。</div>';
  lastCreateResponse.value = null;
  setStatus("");
}

// 复制短链
async function copyShortUrl() {
  if (!lastCreateResponse.value?.code) return;
  const shortUrl = `${location.origin}/s/${lastCreateResponse.value.code}`;
  await navigator.clipboard.writeText(shortUrl);
  setStatus("短链已复制到剪贴板。", "ok");
}

// 复制 JSON
async function copyJson() {
  if (!lastCreateResponse.value) return;
  await navigator.clipboard.writeText(JSON.stringify(lastCreateResponse.value, null, 2));
  setStatus("返回 JSON 已复制到剪贴板。", "ok");
}
</script>

<template>
  <div class="wrap">
    <div class="row" style="justify-content:space-between; align-items:center;">
      <h1>短链创建器：LLM（仅基于 URL）生成描述 → 创建短链</h1>
      <span class="pill">API：<span class="mono">POST /api/links</span></span>
    </div>

    <div class="grid">
      <!-- 左侧：表单 -->
      <div class="card">
        <label>原始链接 URL</label>
        <input v-model="url" placeholder="https://example.com/landing" />

        <div class="row">
          <div style="flex:1 1 220px;">
            <label>自定义 code（可选）</label>
            <input v-model="code" placeholder="abc123（可留空自动生成）" />
          </div>
          <div style="flex:1 1 220px;">
            <label>note（可选）</label>
            <input v-model="note" placeholder="内部备注（可选）" />
          </div>
        </div>

        <label>提示信息（可选，但强烈建议填写）</label>
        <textarea v-model="hint" placeholder="例如：这是12月促销活动落地页；用于教育产品投放；目标受众为…（越具体，描述越可靠）"></textarea>

        <label>描述 description（必填）</label>
        <textarea v-model="description" placeholder="可先点击“生成描述”，也可以手动填写"></textarea>

        <div class="row" style="margin-top:10px;">
          <button class="btn" id="btnDescribe" @click="callLLM" :disabled="btnDescribeDisabled">1) 生成描述（LLM，仅基于 URL）</button>
          <button class="btn secondary" id="btnCreate" @click="createShortLink" :disabled="btnCreateDisabled">2) 创建短链</button>
          <button class="btn ghost" id="btnClear" type="button" @click="clearForm">清空</button>
        </div>

        <div class="hint">
          说明：本页不会抓取目标网页内容，仅把 URL（以及你填写的提示信息）交给大模型生成短描述。为避免模型“编造”，若无法判断，它会返回“需要补充描述”，你需要手动补充后才能创建短链。
        </div>

        <div class="hr"></div>
        <div class="status" :class="statusType">{{ status }}</div>
      </div>

      <!-- 右侧：LLM 配置 & 结果 -->
      <div class="card">
        <h1 style="font-size:16px;">LLM 设置（演示用）</h1>

        <label>DashScope API Key（仅前端演示，不推荐生产）</label>
        <input v-model="apiKey" type="password" placeholder="sk-...（建议改为后端代调用）" />

        <label>模型（示例：qwen-plus / qwen-max 等）</label>
        <input v-model="model" />

        <label>OpenAI 兼容接口地址</label>
        <input v-model="endpoint" />

        <div class="hint">
          安全建议：生产环境不要把 API Key 放在前端。最佳实践是新增 <span class="mono">POST /api/describe</span> 由后端持有 Key 调用模型；前端只调用你自己的 API。
        </div>

        <div class="hr"></div>

        <h1 style="font-size:16px;">创建结果</h1>
        <div class="result" v-html="result"></div>

        <div class="row" style="margin-top:10px;">
          <button class="btn ghost" @click="copyShortUrl" :disabled="!lastCreateResponse">复制短链</button>
          <button class="btn ghost" @click="copyJson" :disabled="!lastCreateResponse">复制返回 JSON</button>
        </div>
      </div>
    </div>
  </div>
</template>