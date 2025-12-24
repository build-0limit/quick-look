<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouteQuery } from 'vue-router';

const route = useRoute();
const raw = useRouteQuery('raw');

const code = ref(route.params.code as string);
const targetUrl = ref('');
const description = ref('');
const error = ref('');
const loading = ref(true);
const countdown = ref(3); // 默认3秒倒计时
const timer = ref<number | null>(null);

// 处理短链跳转，调用/s/{code}接口
const handleRedirect = async () => {
  try {
    loading.value = true;
    
    // 构建请求URL，使用?info=1获取JSON数据
    const requestUrl = `/s/${code.value}?info=1`;
    
    // 调用跳转入口接口
    const response = await fetch(requestUrl);
    
    if (!response.ok) {
      if (response.status === 404) {
        error.value = '短链不存在或已过期';
      } else {
        error.value = `接口请求失败: ${response.status}`;
      }
      return;
    }
    
    const data = await response.json();
    targetUrl.value = data.url;
    description.value = data.description;
    
    // A) 已经请求了JSON信息，直接使用数据
    
    // B) 强制原样跳转
    if (raw.value === '1') {
      window.location.href = targetUrl.value;
      return;
    }
    
    // C) 默认：显示预览页，并设置3秒后自动跳转
    startCountdown();
    
  } catch (err) {
    error.value = '处理短链时发生错误';
    console.error(err);
  } finally {
    loading.value = false;
  }
};

// 开始倒计时
const startCountdown = () => {
  countdown.value = 3; // 重置倒计时
  
  // 清除可能存在的旧定时器
  if (timer.value) {
    window.clearInterval(timer.value);
  }
  
  // 设置新定时器
  timer.value = window.setInterval(() => {
    countdown.value--;
    
    if (countdown.value <= 0) {
      window.clearInterval(timer.value!);
      timer.value = null;
      redirectToTarget();
    }
  }, 1000);
};

// 跳转到目标URL
const redirectToTarget = () => {
  if (targetUrl.value) {
    window.location.href = targetUrl.value;
  }
};

// 组件挂载时直接调用接口
onMounted(() => {
  handleRedirect();
});

// 组件卸载时清除定时器
onUnmounted(() => {
  if (timer.value) {
    window.clearInterval(timer.value);
    timer.value = null;
  }
});
</script>

<template>
  <div class="redirect-container">
    <div v-if="loading" class="loading">正在处理短链...</div>
    <div v-else-if="error" class="error">{{ error }}</div>
    <div v-else class="card">
      <div class="k">描述</div>
      <div class="desc">{{ description || '（无描述）' }}</div>

      <div class="k">目标链接</div>
      <div class="url">{{ targetUrl }}</div>

      <div class="countdown">
        <span v-if="countdown > 0">将在 {{ countdown }} 秒后自动跳转... </span>
        <span v-else>正在跳转...</span>
      </div>

      <a class="btn" :href="targetUrl" rel="noopener noreferrer" @click="timer && window.clearInterval(timer)">
        立即访问
      </a>
    </div>
  </div>
</template>

<style scoped>
.redirect-container {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  margin: 0;
  padding: 24px;
  background: #f7f7f8;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.loading {
  text-align: center;
  font-size: 16px;
  color: #666;
}

.error {
  text-align: center;
  color: #ff4d4f;
  font-size: 16px;
}

.card {
  max-width: 720px;
  width: 100%;
  background: #fff;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.06);
}

.k {
  color: #666;
  font-size: 13px;
  margin-bottom: 6px;
}

.desc {
  font-size: 16px;
  line-height: 1.6;
  margin: 10px 0 14px;
  white-space: pre-wrap;
  word-break: break-word;
}

.url {
  font-size: 13px;
  color: #444;
  background: #f2f3f5;
  padding: 10px;
  border-radius: 8px;
  word-break: break-all;
  margin-bottom: 14px;
}

.countdown {
  color: #1677ff;
  font-size: 14px;
  margin-bottom: 14px;
}

.btn {
  display: inline-block;
  padding: 10px 14px;
  border-radius: 10px;
  background: #1677ff;
  color: #fff;
  text-decoration: none;
}

.btn:hover {
  background: #4096ff;
}
</style>