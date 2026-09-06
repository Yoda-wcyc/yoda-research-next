import Anthropic from '@anthropic-ai/sdk';
import { EDITOR_SYSTEM } from '../../../lib/editor-rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// 報告編輯器的 Claude 路由。CONSOLE_TOKEN 保護；金鑰走 Vercel 環境變數 ANTHROPIC_API_KEY。
// 兩種模式：
//   mode 省略／'edit'   把一段文字＋指示＋前後文送給 Claude，只回改好的那段（系統提示＝Yoda 寫作規範句子層）
//   mode 'outline'      架構畫布：給整份大綱（每節標題＋內容節錄），回每節一句「核心脈絡」的 JSON
// 模型 claude-opus-5（adaptive thinking 預設開）；系統提示固定 → cache_control；refusal 走 server-side fallback。
const OUTLINE_SYSTEM = `你是 Yoda Research 的報告結構分析師。使用者給你一份財經報告的大綱：每個節點有編號、層級、標題、內容節錄。
任務：替每個節點寫一句「核心脈絡」——這一節在整份報告的論證裡扮演什麼角色、講了什麼判斷（不是複述標題）。
要求：繁體中文（台灣用語）、每句 12～40 字、有立場、不加套話；數字與代號原樣保留；不給操作建議。
只回傳 JSON 物件：{"<編號>":"<一句脈絡>", ...}，不要任何其他文字、不要 markdown 圍欄。`;

function J(o, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
function textOf(res) {
  let out = '';
  for (const b of res.content) if (b.type === 'text') out += b.text;
  return out.trim().replace(/^```[a-z]*\n?|\n?```$/g, '').trim();
}

export async function POST(req) {
  const k = new URL(req.url).searchParams.get('k') || '';
  if (!process.env.CONSOLE_TOKEN || k !== process.env.CONSOLE_TOKEN) return new Response('Not found', { status: 404 });
  if (!process.env.ANTHROPIC_API_KEY) return J({ error: 'Vercel 環境變數缺 ANTHROPIC_API_KEY（Settings → Environment Variables 加上去再 redeploy）' }, 500);

  let body = {};
  try { body = await req.json(); } catch (e) { return J({ error: '內容無法解析' }, 400); }
  const mode = body.mode === 'outline' ? 'outline' : 'edit';
  const client = new Anthropic();

  let system, user;
  if (mode === 'outline') {
    const nodes = Array.isArray(body.nodes) ? body.nodes : [];
    if (!nodes.length) return J({ error: '缺少 nodes' }, 400);
    user = `報告：${String(body.doc || '（未命名）')}\n\n` + nodes.map((n) =>
      `【${n.id}】層級${n.level}｜${String(n.title || '').slice(0, 120)}\n${String(n.snippet || '').slice(0, 700)}`).join('\n\n') +
      `\n\n回傳 JSON：{編號: 一句核心脈絡}，共 ${nodes.length} 個節點。`;
    system = OUTLINE_SYSTEM;
  } else {
    const text = String(body.text || '').trim();
    if (!text) return J({ error: '缺少 text' }, 400);
    const ctx = body.context || {};
    user =
      `報告：${String(body.doc || '（未命名）')}\n段落類型：<${String(body.tag || 'p')}>\n` +
      (ctx.prev ? `前一段（只供理解脈絡，不要改它）：${ctx.prev}\n` : '') +
      (ctx.next ? `後一段（只供理解脈絡，不要改它）：${ctx.next}\n` : '') +
      `\n【要改的這一段】\n${text}\n\n【指示】\n${String(body.instruction || '').trim() || '（沒有特別指示：保留意思，依規範優化）'}\n\n只回傳改好的那一段。`;
    system = EDITOR_SYSTEM;
  }

  try {
    const res = await client.beta.messages.create({
      model: 'claude-opus-5',
      max_tokens: mode === 'outline' ? 8000 : 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
    });
    if (res.stop_reason === 'refusal') {
      return J({ error: 'Claude 拒絕處理' + (res.stop_details && res.stop_details.explanation ? '：' + res.stop_details.explanation : '') }, 422);
    }
    const out = textOf(res);
    const usage = { in: res.usage.input_tokens, out: res.usage.output_tokens, cached: res.usage.cache_read_input_tokens || 0 };
    if (mode === 'outline') {
      let gists = {};
      try { gists = JSON.parse(out); } catch (e) {
        const m = out.match(/\{[\s\S]*\}/); if (m) { try { gists = JSON.parse(m[0]); } catch (e2) {} }
      }
      return J({ gists, model: res.model, usage });
    }
    return J({ text: out, model: res.model, usage });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return J({ error: 'ANTHROPIC_API_KEY 無效' }, 500);
    if (e instanceof Anthropic.RateLimitError) return J({ error: 'Claude 速率限制，稍後再試' }, 429);
    if (e instanceof Anthropic.APIError) return J({ error: `Claude API ${e.status}：${e.message}` }, 502);
    return J({ error: '呼叫失敗：' + String((e && e.message) || e) }, 500);
  }
}
