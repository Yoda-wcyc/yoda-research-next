import { get, put } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 報告工作台「變成規則」的雲端存放：rules/phrase_rules.json（replace／ban／writing）。CONSOLE_TOKEN 保護。
// 本機正本 Skill/rules/phrase_rules.json，用 yoda_tokens.py push/pull 同步；editor-ai 每次呼叫讀 writing 併進系統提示。
const PATH = 'rules/phrase_rules.json';
const EMPTY = { replace: [], ban: [], writing: [] };

function J(o, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
export async function readRules() {
  try {
    const r = await get(PATH, { access: 'private' });
    if (!r) return { ...EMPTY };
    const j = JSON.parse(await new Response(r.stream).text());
    return { replace: j.replace || [], ban: j.ban || [], writing: j.writing || [] };
  } catch (e) { return { ...EMPTY }; }
}
export async function GET(req) {
  const k = new URL(req.url).searchParams.get('k') || '';
  if (!process.env.CONSOLE_TOKEN || k !== process.env.CONSOLE_TOKEN) return new Response('Not found', { status: 404 });
  return J(await readRules());
}
export async function POST(req) {
  const k = new URL(req.url).searchParams.get('k') || '';
  if (!process.env.CONSOLE_TOKEN || k !== process.env.CONSOLE_TOKEN) return new Response('Not found', { status: 404 });
  let body = {};
  try { body = await req.json(); } catch (e) { return J({ error: '內容無法解析' }, 400); }
  const doc = { replace: body.replace || [], ban: body.ban || [], writing: body.writing || [] };
  try {
    await put(PATH, JSON.stringify(doc, null, 2), { access: 'private', contentType: 'application/json; charset=utf-8', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 });
    return J({ ok: true, counts: { replace: doc.replace.length, ban: doc.ban.length, writing: doc.writing.length } });
  } catch (e) { return J({ error: '存檔失敗：' + String((e && e.message) || e) }, 500); }
}
