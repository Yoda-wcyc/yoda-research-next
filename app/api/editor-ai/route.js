import Anthropic from '@anthropic-ai/sdk';
import { EDITOR_SYSTEM } from '../../../lib/editor-rules';
import { readRules } from '../editor-rules/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

// 報告工作台的 Claude 路由。CONSOLE_TOKEN 保護；金鑰走 Vercel 環境變數 ANTHROPIC_API_KEY。
// 三種模式：
//   edit（預設） 一段文字＋指示＋前後文 → 只回改好的那段
//   outline      架構畫布：整份大綱 → 每節一句核心脈絡（JSON）
//   review       AI 先審一輪：一批段落 → 該改的地方＋改好的版本（JSON），工作台變成待認可標記
// 系統提示＝Yoda 寫作規範句子層（固定 → cache_control）＋「變成規則」累積的 writing 規則（每次讀）。
// 模型 claude-opus-5；refusal 走 server-side fallback。
const OUTLINE_SYSTEM = `你是 Yoda Research 的報告結構分析師。使用者給你一份財經報告的大綱：每個節點有編號、層級、標題、內容節錄。
任務：替每個節點寫一句「核心脈絡」——這一節在整份報告的論證裡扮演什麼角色、講了什麼判斷（不是複述標題）。
要求：繁體中文（台灣用語）、每句 12～40 字、有立場、不加套話；數字與代號原樣保留；不給操作建議。
只回傳 JSON 物件：{"<編號>":"<一句脈絡>", ...}，不要任何其他文字、不要 markdown 圍欄。`;

const REVIEW_SYSTEM = `你是 Yoda Research 的審稿官，要一次扮演三個視角：
(1) 審稿官：照下面的寫作規範逐條看——因果鍊、口語、禁用詞、一個數字一個家、不給操作建議、禁單日論斷。
(2) 讀者視角：付了月費的訂閱者讀這段，會不會看不懂、會不會跳過、哪句像廢話。
(3) 內部一致：同一批段落裡數字或方向互相打架、同一件事講兩次。
使用者給你一批段落（編號＋標籤＋原文）。只挑「真的該改」的段落，最多 12 處，依嚴重度排序；小毛病略過。
每處給：編號、一句問題（≤40 字，說清楚違反哪條或讀者哪裡卡住）、改好的整段（保留所有數字／代號／日期原值；不能改就留空字串）。
只回傳 JSON 陣列：[{"idx":"<編號>","issue":"<問題>","proposal":"<改好的整段或空字串>"}]，不要其他文字、不要 markdown 圍欄。

以下是寫作規範（同時適用於你的判斷與你的改寫）：
`;

function J(o, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
function textOf(res) {
  let out = '';
  for (const b of res.content) if (b.type === 'text') out += b.text;
  return out.trim().replace(/^```[a-z]*\n?|\n?```$/g, '').trim();
}
function parseJson(out, fallback) {
  try { return JSON.parse(out); } catch (e) {}
  const m = out.match(/[\[{][\s\S]*[\]}]/); if (m) { try { return JSON.parse(m[0]); } catch (e) {} }
  return fallback;
}

export async function POST(req) {
  const k = new URL(req.url).searchParams.get('k') || '';
  if (!process.env.CONSOLE_TOKEN || k !== process.env.CONSOLE_TOKEN) return new Response('Not found', { status: 404 });
  if (!process.env.ANTHROPIC_API_KEY) return J({ error: 'Vercel 環境變數缺 ANTHROPIC_API_KEY（Settings → Environment Variables 加上去再 redeploy）' }, 500);

  let body = {};
  try { body = await req.json(); } catch (e) { return J({ error: '內容無法解析' }, 400); }
  const mode = ['outline', 'review'].includes(body.mode) ? body.mode : 'edit';
  const rules = await readRules();
  const extra = rules.writing.length ? '\n\n【Yoda 追加的寫法規則（「變成規則」累積，一律遵守）】\n' + rules.writing.map((w, i) => `${i + 1}. ${typeof w === 'string' ? w : w.text}`).join('\n') : '';
  const client = new Anthropic();

  let system, user, max_tokens = 4000;
  if (mode === 'outline') {
    const nodes = Array.isArray(body.nodes) ? body.nodes : [];
    if (!nodes.length) return J({ error: '缺少 nodes' }, 400);
    user = `報告：${String(body.doc || '（未命名）')}\n\n` + nodes.map((n) =>
      `【${n.id}】層級${n.level}｜${String(n.title || '').slice(0, 120)}\n${String(n.snippet || '').slice(0, 700)}`).join('\n\n') +
      `\n\n回傳 JSON：{編號: 一句核心脈絡}，共 ${nodes.length} 個節點。`;
    system = OUTLINE_SYSTEM; max_tokens = 8000;
  } else if (mode === 'review') {
    const blocks = Array.isArray(body.blocks) ? body.blocks : [];
    if (!blocks.length) return J({ error: '缺少 blocks' }, 400);
    user = `報告：${String(body.doc || '（未命名）')}（第 ${body.part || 1} 批，共 ${blocks.length} 段）\n\n` +
      blocks.map((b) => `【${b.idx}】<${b.tag || 'p'}>\n${String(b.text || '').slice(0, 900)}`).join('\n\n') +
      `\n\n只回傳 JSON 陣列。`;
    system = REVIEW_SYSTEM + EDITOR_SYSTEM + extra; max_tokens = 12000;
  } else {
    const text = String(body.text || '').trim();
    if (!text) return J({ error: '缺少 text' }, 400);
    const ctx = body.context || {};
    user =
      `報告：${String(body.doc || '（未命名）')}\n段落類型：<${String(body.tag || 'p')}>\n` +
      (ctx.prev ? `前一段（只供理解脈絡，不要改它）：${ctx.prev}\n` : '') +
      (ctx.next ? `後一段（只供理解脈絡，不要改它）：${ctx.next}\n` : '') +
      `\n【要改的這一段】\n${text}\n\n【指示】\n${String(body.instruction || '').trim() || '（沒有特別指示：保留意思，依規範優化）'}\n\n只回傳改好的那一段。`;
    system = EDITOR_SYSTEM + extra;
  }

  try {
    const res = await client.beta.messages.create({
      model: 'claude-opus-5',
      max_tokens,
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
    if (mode === 'outline') return J({ gists: parseJson(out, {}), model: res.model, usage });
    if (mode === 'review') {
      const findings = parseJson(out, []);
      return J({ findings: Array.isArray(findings) ? findings : [], model: res.model, usage });
    }
    return J({ text: out, model: res.model, usage });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return J({ error: 'ANTHROPIC_API_KEY 無效' }, 500);
    if (e instanceof Anthropic.RateLimitError) return J({ error: 'Claude 速率限制，稍後再試' }, 429);
    if (e instanceof Anthropic.APIError) return J({ error: `Claude API ${e.status}：${e.message}` }, 502);
    return J({ error: '呼叫失敗：' + String((e && e.message) || e) }, 500);
  }
}
