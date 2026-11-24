// OpenAI 兼容 API 客户端（默认对接 DeepSeek 官方地址，用户可在配置中修改）。
// fetchImpl 可注入：测试用 mock，不发真实网络请求。
export function createApiClient({ baseUrl, apiKey, model, fetchImpl = globalThis.fetch, timeoutMs = 60000 }) {
  if (!baseUrl) throw new Error('缺少 API 地址（apiBaseUrl）');
  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';

  async function chat(messages, { temperature = 0.2 } = {}) {
    if (!apiKey) throw new Error('缺少 API key，请先在设置中填写');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, temperature }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`API 请求失败（${res.status}）：${text.slice(0, 300)}`);
      }
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('API 返回格式异常：缺少 choices[0].message.content');
      return content;
    } finally {
      clearTimeout(timer);
    }
  }

  // 要求模型返回 JSON；容忍 markdown 围栏与前后杂文字
  async function chatJson(system, user) {
    const content = await chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]);
    const cleaned = content.replace(/^\s*```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
    try { return JSON.parse(cleaned); } catch { /* 继续尝试提取 */ }
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { /* 落到报错 */ }
    }
    throw new Error('API 未返回有效 JSON：' + content.slice(0, 200));
  }

  return { chat, chatJson };
}