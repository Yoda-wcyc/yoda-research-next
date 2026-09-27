import { sql } from '../../../lib/db';
import { J, preflight } from '../../../lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function OPTIONS() { return preflight(); }

// 技術分析名單開關（主控台會員表的「技術分析」勾選框打這裡）。ADMIN_KEY 保護。
//
//   設定：POST {key, member_id, enabled:true|false}
//         （也接受 memberId／email 找人、on 代替 enabled）
//         → {ok:true, member_id, pub_id, email, enabled}
//   列出：POST {key, action:'list'} → {ok:true, rows:[{member_id,pub_id,email,enabled,updated_at,note}]}
//
// 開關寫進獨立的 ta_access 表（members 會被 db-mirror TRUNCATE，欄位存不住）。
// 授權當下同時存 member_id 與 pub_id：登入票的 sub 是 pub_id（沒有才是 member_id），兩個都要比得到。
export async function POST(req) {
  let body = {};
  try { body = await req.json(); } catch (e) {}
  if (!process.env.ADMIN_KEY || body.key !== process.env.ADMIN_KEY) return J({ ok: false, error: '管理密碼錯誤' }, 403);

  try {
    if (body.action === 'list') {
      const rows = await sql`SELECT member_id, pub_id, email, enabled, updated_at, note FROM ta_access ORDER BY enabled DESC, updated_at DESC`;
      return J({ ok: true, rows });
    }

    const enabledRaw = body.enabled !== undefined ? body.enabled : body.on;
    if (typeof enabledRaw !== 'boolean') return J({ ok: false, error: 'enabled 必須是 true 或 false' });
    const mid = String(body.member_id || body.memberId || '').trim();
    const em = String(body.email || '').trim().toLowerCase();
    if (!mid && !em) return J({ ok: false, error: '缺 member_id 或 email' });

    const found = mid
      ? await sql`SELECT member_id, pub_id, email FROM members WHERE member_id = ${mid} LIMIT 1`
      : await sql`SELECT member_id, pub_id, email FROM members WHERE lower(email) = ${em} LIMIT 1`;
    const m = found[0];
    if (!m) return J({ ok: false, error: '查無此會員' });

    const note = body.note === undefined ? null : String(body.note);
    await sql`INSERT INTO ta_access (member_id, pub_id, email, enabled, updated_at, note)
      VALUES (${m.member_id}, ${m.pub_id || ''}, ${m.email || ''}, ${enabledRaw}, now(), ${note})
      ON CONFLICT (member_id) DO UPDATE SET
        enabled = EXCLUDED.enabled, pub_id = EXCLUDED.pub_id, email = EXCLUDED.email, updated_at = now(),
        note = COALESCE(EXCLUDED.note, ta_access.note)`;
    return J({ ok: true, member_id: m.member_id, pub_id: m.pub_id || '', email: m.email || '', enabled: enabledRaw });
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (/ta_access/.test(msg) && /does not exist/.test(msg)) {
      return J({ ok: false, error: 'ta_access 表還沒建立，請先跑 /api/db-migrate' });
    }
    return J({ ok: false, error: msg });
  }
}
export async function GET() { return J({ ok: false, error: 'POST with admin key' }); }
