import { neon } from '@neondatabase/serverless';

// Neon Postgres 連線（DATABASE_URL 由 Vercel 連接 Neon 時自動注入）。
export const sql = neon(process.env.DATABASE_URL);

// 綠界回拋留痕（不管成功失敗一律寫一筆）。
// 為什麼要有這張表：2026-09-10 同一分鐘十幾筆回拋，其中兩筆 GAS 沒寫成（withLock_ 逾時），
// Vercel 不看 GAS 回應就照回 1|OK，於是那兩期在我們系統裡完全無痕——連「發生過」都查不到。
// 這張表就是那個「至少發生過」的憑據：先落地，再去打 GAS，結果回頭更新同一列。
// 回傳新列的 id，讓呼叫端重試完可以更新同一筆。
export async function logEcpayNotify(row) {
  const s = (k) => (row[k] === undefined || row[k] === null) ? '' : String(row[k]);
  const rows = await sql`INSERT INTO ecpay_notify_log
      (rtn_code, rtn_msg, merchant_trade_no, gwsr, email, amount, total_success_times, gas_ok, gas_error, attempts, raw)
    VALUES (${s('rtn_code')},${s('rtn_msg')},${s('merchant_trade_no')},${s('gwsr')},${s('email')},${s('amount')},${s('total_success_times')},
            ${row.gas_ok === undefined ? null : row.gas_ok},${s('gas_error')},${Number(row.attempts) || 0},
            ${JSON.stringify(row.raw || {})}::jsonb)
    RETURNING id`;
  return (rows && rows[0] && rows[0].id) || null;
}

// 打完 GAS（含重試）之後，把結果補回同一列。
export async function updateEcpayNotifyResult(id, { gas_ok, gas_error, attempts }) {
  if (!id) return;
  await sql`UPDATE ecpay_notify_log
       SET gas_ok=${gas_ok === undefined ? null : gas_ok},
           gas_error=${gas_error == null ? '' : String(gas_error)},
           attempts=${Number(attempts) || 0}
     WHERE id=${id}`;
}

// upsert 單一會員（付款/異動後同步 Neon 用）。member_id 為主鍵。
export async function upsertMember(m) {
  const g = (c) => (m[c] === undefined || m[c] === null) ? '' : String(m[c]);
  await sql`INSERT INTO members (member_id,pub_id,email,password_hash,ref_code,referred_by,status,start_date,paid_periods,referred_paid_count,earned_free_months,next_charge_date,notes,cert_mw,cert_tw,cert_us,cert_key,cert_macro,cert_flag,plan,fb_name,notify_off,ex_founding,mirrored_at)
    VALUES (${g('member_id')},${g('pub_id')},${g('email')},${g('password_hash')},${g('ref_code')},${g('referred_by')},${g('status')},${g('start_date')},${g('paid_periods')},${g('referred_paid_count')},${g('earned_free_months')},${g('next_charge_date')},${g('notes')},${g('cert_mw')},${g('cert_tw')},${g('cert_us')},${g('cert_key')},${g('cert_macro')},${g('cert_flag')},${g('plan')},${g('fb_name')},${g('notify_off')},${g('ex_founding')}, now())
    ON CONFLICT (member_id) DO UPDATE SET
      pub_id=EXCLUDED.pub_id, email=EXCLUDED.email, password_hash=EXCLUDED.password_hash, ref_code=EXCLUDED.ref_code,
      referred_by=EXCLUDED.referred_by, status=EXCLUDED.status, start_date=EXCLUDED.start_date, paid_periods=EXCLUDED.paid_periods,
      referred_paid_count=EXCLUDED.referred_paid_count, earned_free_months=EXCLUDED.earned_free_months, next_charge_date=EXCLUDED.next_charge_date,
      notes=EXCLUDED.notes, cert_mw=EXCLUDED.cert_mw, cert_tw=EXCLUDED.cert_tw, cert_us=EXCLUDED.cert_us, cert_key=EXCLUDED.cert_key,
      cert_macro=EXCLUDED.cert_macro, cert_flag=EXCLUDED.cert_flag, plan=EXCLUDED.plan, fb_name=EXCLUDED.fb_name, notify_off=EXCLUDED.notify_off, ex_founding=EXCLUDED.ex_founding, mirrored_at=now()`;
}
