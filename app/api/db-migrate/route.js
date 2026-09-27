import { sql } from '../../../lib/db';
import { J, preflight } from '../../../lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function OPTIONS() { return preflight(); }

// 一次性 schema 遷移（ADMIN_KEY 保護·冪等）：補上 members.ex_founding 欄（回頭客/排除創始旗標）、ecpay_notify_log、ta_access。
export async function POST(req) {
  let body = {};
  try { body = await req.json(); } catch (e) {}
  if (!process.env.ADMIN_KEY || body.key !== process.env.ADMIN_KEY) return J({ ok: false, error: '管理密碼錯誤' }, 403);
  try {
    await sql`ALTER TABLE members ADD COLUMN IF NOT EXISTS ex_founding text`;
    // 綠界回拋留痕表：每一筆背景通知都落地一列（成功失敗都寫），GAS 沒寫成時至少查得到發生過。
    await sql`CREATE TABLE IF NOT EXISTS ecpay_notify_log (
      id serial PRIMARY KEY,
      received_at timestamptz DEFAULT now(),
      rtn_code text,
      rtn_msg text,
      merchant_trade_no text,
      gwsr text,
      email text,
      amount text,
      total_success_times text,
      gas_ok boolean,
      gas_error text,
      attempts int,
      raw jsonb
    )`;
    // 技術分析名單（2026-09-27）：獨立一張表，不加在 members——db-mirror 每次 TRUNCATE members，新欄位會被洗回預設值。
    // 同時存 member_id 與 pub_id：JWT 的 sub 是 pub_id（沒有才是 member_id），判斷時兩個都比，不必 JOIN members。
    await sql`CREATE TABLE IF NOT EXISTS ta_access (
      member_id text PRIMARY KEY,
      pub_id text,
      email text,
      enabled boolean NOT NULL DEFAULT false,
      updated_at timestamptz DEFAULT now(),
      note text
    )`;
    await sql`CREATE INDEX IF NOT EXISTS ta_access_pub ON ta_access (pub_id)`;
    return J({ ok: true, migrated: 'members.ex_founding, ecpay_notify_log, ta_access' });
  } catch (e) { return J({ ok: false, error: String((e && e.message) || e) }); }
}
export async function GET() { return J({ ok: false, error: 'POST with admin key' }); }
