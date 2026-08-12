import { upsertMember, sql } from '../../../lib/db';
import { J, preflight } from '../../../lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function OPTIONS() { return preflight(); }

// GAS 寫入會員後呼叫：upsert 該會員進 Neon（del:true 則從 Neon 刪除）。共享密鑰保護。
export async function POST(req) {
  let body = {};
  try { body = await req.json(); } catch (e) {}
  if (!process.env.GAS_SHARED_SECRET || body.secret !== process.env.GAS_SHARED_SECRET) {
    return J({ ok: false, error: 'forbidden' }, 403);
  }
  try {
    if (body.del && body.member_id) {
      await sql`DELETE FROM members WHERE member_id = ${String(body.member_id)}`;
      return J({ ok: true, deleted: String(body.member_id) });
    }
    const m = body.member;
    if (!m || !m.member_id) return J({ ok: false, error: '缺 member 資料' });
    await upsertMember(m);
    return J({ ok: true, member_id: m.member_id });
  } catch (e) { return J({ ok: false, error: String((e && e.message) || e) }); }
}
