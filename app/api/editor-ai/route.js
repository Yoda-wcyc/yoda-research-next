import Anthropic from '@anthropic-ai/sdk';
import { EDITOR_SYSTEM } from '../../../lib/editor-rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// 報告編輯器的「用 Claude 改」：把一段文字＋指示＋前後文送給 Claude，只回改好的那段。
// CONSOLE_TOKEN 保護；金鑰走 Vercel 環境變數 ANTHROPIC_API_KEY。
// 模型：claude-opus-5（adaptive thinking 預設開啟）；系統提示固定 → cache_control 讓重複請求只付 1/10。
// 拒答保險：server-side fallback（refusal 時自動換模型續跑）。
function J(o, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export async function POST(req) {
  const k = new URL(req.url).searchParams.get('k') || '';
  if (!process.env.CONSOLE_TOKEN || k !== process.env.CONSOLE_TOKEN) return new Response('Not found', { status: 404 });
  if (!process.env.ANTHROPIC_API_KEY) return J({ error: 'Vercel 環境變數缺 ANTHROPIC_API_KEY（Settings → Environment Variables 加上去再 redeploy）' }, 500);

  let body = {};
  try { body = await req.json(); } catch (e) { return J({ error: '內容無法解析' }, 400); }
  const text = String(body.text || '').trim();
  if (!text) return J({ error: '缺少 text' }, 400);
  const instruction = String(body.instruction || '').trim();
  const tag = String(body.tag || 'p');
  const ctx = body.context || {};
  const doc = String(body.doc || '');

  const user =
    `報告：${doc || '（未命名）'}\n段落類型：<${tag}>\n` +
    (ctx.prev ? `前一段（只供理解脈絡，不要改它）：${ctx.prev}\n` : '') +
    (ctx.next ? `後一段（只供理解脈絡，不要改它）：${ctx.next}\n` : '') +
    `\n【要改的這一段】\n${text}\n\n【指示】\n${instruction || '（沒有特別指示：保留意思，依規範優化）'}\n\n只回傳改好的那一段。`;

  const client = new Anthropic();
  try {
    const res = await client.beta.messages.create({
      model: 'claude-opus-5',
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: EDITOR_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
    });
    if (res.stop_reason === 'refusal') {
      return J({ error: 'Claude 拒絕處理這一段' + (res.stop_details && res.stop_details.explanation ? '：' + res.stop_details.explanation : '') }, 422);
    }
    let out = '';
    for (const b of res.content) if (b.type === 'text') out += b.text;
    out = out.trim().replace(/^```[a-z]*\n?|\n?```$/g, '').trim();
    return J({ text: out, model: res.model, usage: { in: res.usage.input_tokens, out: res.usage.output_tokens, cached: res.usage.cache_read_input_tokens || 0 } });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return J({ error: 'ANTHROPIC_API_KEY 無效' }, 500);
    if (e instanceof Anthropic.RateLimitError) return J({ error: 'Claude 速率限制，稍後再試' }, 429);
    if (e instanceof Anthropic.APIError) return J({ error: `Claude API ${e.status}：${e.message}` }, 502);
    return J({ error: '呼叫失敗：' + String((e && e.message) || e) }, 500);
  }
}
