<script setup lang="ts">
import { ref } from 'vue';

// 表单数据
const url = ref('');
const code = ref('');
const note = ref('');
const hint = ref('');
const description = ref('');

// 添加短链域名配置
const SHORT_DOMAIN = "https://dark-disk-2692.1a0686cf.er.aliyun-esa.net";

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
const isLoading = ref(false);
const isCreating = ref(false);

// 设置状态信息
function setStatus(msg: string, type: string = "info") {
  status.value = msg;
  statusType.value = type;
  
  // 添加状态变化动画
  setTimeout(() => {
    const statusEl = document.querySelector('.status');
    if (statusEl) {
      statusEl.style.animation = 'none';
      statusEl.offsetHeight; // 触发重排
      statusEl.style.animation = 'statusPulse 0.5s ease-out';
    }
  }, 10);
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
  isLoading.value = true;
  setStatus("正在调用 LLM 生成描述（仅基于 URL + 提示信息）…");

  try {
    const resp = await fetch("/api/describe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        url: targetUrl,
        hint: hintText,
        apiKey: apiKey.value.trim(),
        model: model.value.trim() || "qwen-plus",
        endpoint: endpoint.value.trim()
      })
    });

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`LLM 调用失败：HTTP ${resp.status} ${t.slice(0, 200)}`);
    }
    
    const data = await resp.json();
    const content = data?.description;
    
    if (!content) throw new Error("LLM 返回为空或格式不符合预期");
    
    description.value = sanitizeText(content, 120);

    if (description.value === "需要补充描述") {
      setStatus("LLM 无法判断页面用途：请补充“提示信息”或手动填写 description。", "err");
    } else {
      setStatus("LLM 描述已生成并填入 description。", "ok");
      
      // 添加成功动画效果
      setTimeout(() => {
        const descTextarea = document.querySelector('textarea[placeholder*="生成描述"]') as HTMLTextAreaElement;
        if (descTextarea) {
          descTextarea.style.animation = 'none';
          descTextarea.offsetHeight;
          descTextarea.style.animation = 'fadeInUp 0.5s ease-out';
        }
      }, 100);
    }
  } catch (e) {
    setStatus(`生成描述失败：${(e as Error).message}`, "err");
  } finally {
    btnDescribeDisabled.value = false;
    isLoading.value = false;
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
  isCreating.value = true;
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

    const shortUrl = `${SHORT_DOMAIN}/s/${data.code}`;
    result.value = `
      <div><b>Short URL：</b> <a href="${shortUrl}" target="_blank" rel="noopener noreferrer">${shortUrl}</a></div>
      <div><b>原始 URL：</b> <span class="mono">${data.url}</span></div>
      <div><b>描述：</b> ${data.description || ""}</div>
    `;

    setStatus("短链创建成功。", "ok");
    
    // 添加成功创建动画效果
    setTimeout(() => {
      const resultDiv = document.querySelector('.result');
      if (resultDiv) {
        resultDiv.style.animation = 'none';
        resultDiv.offsetHeight;
        resultDiv.style.animation = 'resultSlideIn 0.5s ease-out';
      }
    }, 100);
  } catch (e) {
    setStatus(`创建失败：${(e as Error).message}`, "err");
  } finally {
    btnCreateDisabled.value = false;
    isCreating.value = false;
  }
}

// 清空表单
function clearForm() {
  // 添加清空动画效果
  const inputs = document.querySelectorAll('input, textarea');
  inputs.forEach((input, index) => {
    setTimeout(() => {
      (input as HTMLInputElement).style.animation = 'fadeOut 0.3s ease-out';
    }, index * 50);
  });
  
  setTimeout(() => {
    url.value = "";
    code.value = "";
    note.value = "";
    hint.value = "";
    description.value = "";
    apiKey.value = "";
    result.value = '<div class="status">尚未创建。</div>';
    lastCreateResponse.value = null;
    setStatus("");
    
    // 重新显示输入框
    inputs.forEach((input) => {
      (input as HTMLInputElement).style.animation = 'fadeIn 0.3s ease-out';
    });
  }, 300);
}

// 复制短链
async function copyShortUrl() {
  if (!lastCreateResponse.value?.code) return;
  const shortUrl = `${location.origin}/s/${lastCreateResponse.value.code}`;
  await navigator.clipboard.writeText(shortUrl);
  setStatus("短链已复制到剪贴板。", "ok");
  
  // 添加复制成功动画
  const button = event?.target as HTMLButtonElement;
  if (button) {
    const originalText = button.textContent;
    button.textContent = '✓ 已复制';
    button.style.background = 'var(--success)';
    setTimeout(() => {
      button.textContent = originalText;
      button.style.background = '';
    }, 2000);
  }
}

// 复制 JSON
async function copyJson() {
  if (!lastCreateResponse.value) return;
  await navigator.clipboard.writeText(JSON.stringify(lastCreateResponse.value, null, 2));
  setStatus("返回 JSON 已复制到剪贴板。", "ok");
  
  // 添加复制成功动画
  const button = event?.target as HTMLButtonElement;
  if (button) {
    const originalText = button.textContent;
    button.textContent = '✓ 已复制';
    button.style.background = 'var(--success)';
    setTimeout(() => {
      button.textContent = originalText;
      button.style.background = '';
    }, 2000);
  }
}
</script>

<template>
  <div class="wrap">
    <div class="row" style="justify-content:space-between; align-items:center;">
      <h1 class="main-title">
        <span class="title-icon">🔗</span>
        短链创建器：LLM（仅基于 URL）生成描述 → 创建短链
        <span class="title-sparkle">✨</span>
      </h1>
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
          <button class="btn" id="btnDescribe" @click="callLLM" :disabled="btnDescribeDisabled">
            <span v-if="isLoading" class="loading"></span>
            {{ isLoading ? '生成中...' : '1) 生成描述（LLM，仅基于 URL）' }}
          </button>
          <button class="btn secondary" id="btnCreate" @click="createShortLink" :disabled="btnCreateDisabled">
            <span v-if="isCreating" class="loading"></span>
            {{ isCreating ? '创建中...' : '2) 创建短链' }}
          </button>
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