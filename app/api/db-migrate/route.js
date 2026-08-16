import { sql } from '../../../lib/db';
import { J, preflight } from '../../../lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function OPTIONS() { return preflight(); }

// 一次性 schema 遷移（ADMIN_KEY 保護·冪等）：補上 members.ex_founding 欄（回頭客/排除創始旗標）。
export async function POST(req) {
  let body = {};
  try { body = await req.json(); } catch (e) {}
  if (!process.env.ADMIN_KEY || body.key !== process.env.ADMIN_KEY) return J({ ok: false, error: '管理密碼錯誤' }, 403);
  try {
    await sql`ALTER TABLE members ADD COLUMN IF NOT EXISTS ex_founding text`;
    return J({ ok: true, migrated: 'members.ex_founding' });
  } catch (e) { return J({ ok: false, error: String((e && e.message) || e) }); }
}
export async function GET() { return J({ ok: false, error: 'POST with admin key' }); }
