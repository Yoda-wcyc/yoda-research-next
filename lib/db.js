import { neon } from '@neondatabase/serverless';

// Neon Postgres 連線（DATABASE_URL 由 Vercel 連接 Neon 時自動注入）。
export const sql = neon(process.env.DATABASE_URL);

// upsert 單一會員（付款/異動後同步 Neon 用）。member_id 為主鍵。
export async function upsertMember(m) {
  const g = (c) => (m[c] === undefined || m[c] === null) ? '' : String(m[c]);
  await sql`INSERT INTO members (member_id,pub_id,email,password_hash,ref_code,referred_by,status,start_date,paid_periods,referred_paid_count,earned_free_months,next_charge_date,notes,cert_mw,cert_tw,cert_us,cert_key,cert_macro,cert_flag,plan,fb_name,notify_off,mirrored_at)
    VALUES (${g('member_id')},${g('pub_id')},${g('email')},${g('password_hash')},${g('ref_code')},${g('referred_by')},${g('status')},${g('start_date')},${g('paid_periods')},${g('referred_paid_count')},${g('earned_free_months')},${g('next_charge_date')},${g('notes')},${g('cert_mw')},${g('cert_tw')},${g('cert_us')},${g('cert_key')},${g('cert_macro')},${g('cert_flag')},${g('plan')},${g('fb_name')},${g('notify_off')}, now())
    ON CONFLICT (member_id) DO UPDATE SET
      pub_id=EXCLUDED.pub_id, email=EXCLUDED.email, password_hash=EXCLUDED.password_hash, ref_code=EXCLUDED.ref_code,
      referred_by=EXCLUDED.referred_by, status=EXCLUDED.status, start_date=EXCLUDED.start_date, paid_periods=EXCLUDED.paid_periods,
      referred_paid_count=EXCLUDED.referred_paid_count, earned_free_months=EXCLUDED.earned_free_months, next_charge_date=EXCLUDED.next_charge_date,
      notes=EXCLUDED.notes, cert_mw=EXCLUDED.cert_mw, cert_tw=EXCLUDED.cert_tw, cert_us=EXCLUDED.cert_us, cert_key=EXCLUDED.cert_key,
      cert_macro=EXCLUDED.cert_macro, cert_flag=EXCLUDED.cert_flag, plan=EXCLUDED.plan, fb_name=EXCLUDED.fb_name, notify_off=EXCLUDED.notify_off, mirrored_at=now()`;
}
