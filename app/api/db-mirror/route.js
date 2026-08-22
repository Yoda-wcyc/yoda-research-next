import { sql } from '../../../lib/db';
import { J, preflight } from '../../../lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export function OPTIONS() { return preflight(); }

const GAS = 'https://script.google.com/macros/s/AKfycbwQQ02EzseXtzvHxH3yegvgvQKncv7ReoGaqqsVxzco6cdagOCW13Tr7KlwX2UJtPc7/exec';
const MCOLS = ['member_id', 'pub_id', 'email', 'password_hash', 'ref_code', 'referred_by', 'status', 'start_date', 'paid_periods', 'referred_paid_count', 'earned_free_months', 'next_charge_date', 'notes', 'cert_mw', 'cert_tw', 'cert_us', 'cert_key', 'cert_macro', 'cert_flag', 'plan', 'fb_name', 'notify_off', 'ex_founding'];

async function ensureTables() {
  await sql`CREATE TABLE IF NOT EXISTS members (
    member_id text PRIMARY KEY, pub_id text, email text, password_hash text, ref_code text, referred_by text,
    status text, start_date text, paid_periods text, referred_paid_count text, earned_free_months text,
    next_charge_date text, notes text, cert_mw text, cert_tw text, cert_us text, cert_key text, cert_macro text,
    cert_flag text, plan text, fb_name text, notify_off text, ex_founding text, mirrored_at timestamptz DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS payments (
    id bigserial PRIMARY KEY, ts text, email text, amount text, trade_no text, note text, status text
  )`;
}

// ★Payments 分頁的欄名與語意不一定對得上：正式站用 member_id 這一欄裝 email、
//   custom_field 裝 note、neweb_trade_no 裝單號。只找 'email' 會整欄寫成空字串——
//   那等於鏡像裡沒有任何付款紀錄，而付費判定就是靠它。（2026-08-22 事故的同一個坑）
function payEmail(p) {
  const cands = [p.email, p.member_id, p['電子郵件'], p['信箱']];
  for (const c of cands) {
    const v = String(c == null ? '' : c).trim();
    if (v && v.indexOf('@') > 0) return v;
  }
  return '';
}

// 唯讀鏡像：從 GAS(正本)匯出 → 快照式寫入 Neon（清空後全量插入·冪等）。正本完全不動。
// ★欄位清單漏一欄就是「跑一次鏡像就把那欄清成空值」——ex_founding（永久排除創始）曾經漏掉。
//   新增 Members 欄位時，這裡的 MCOLS、CREATE TABLE、INSERT 三處都要一起補。
// ★TRUNCATE 之後才逐列插入，中途失敗會留下不完整的鏡像；此時名單會變少，
//   但登入與報告存取都有 GAS 正本可退回，不會擋到會員——重跑一次即可修復。
export async function POST(req) {
  let body = {};
  try { body = await req.json(); } catch (e) {}
  if (!process.env.ADMIN_KEY || body.key !== process.env.ADMIN_KEY) return J({ ok: false, error: '管理密碼錯誤' }, 403);
  if (!process.env.DATABASE_URL) return J({ ok: false, error: 'DATABASE_URL 未設定（Neon 沒連上專案或未 redeploy）' });

  let data;
  try {
    const r = await fetch(GAS, { method: 'POST', body: JSON.stringify({ action: 'adminExportAll', key: body.key }) });
    data = await r.json();
  } catch (e) { return J({ ok: false, error: '讀 GAS 匯出失敗：' + String((e && e.message) || e) }); }
  if (!data || !data.ok) return J({ ok: false, error: 'GAS 匯出回應異常：' + ((data && data.error) || 'unknown') });

  const members = (data.members && data.members.rows) || [];
  const payments = (data.payments && data.payments.rows) || [];

  try {
    await ensureTables();
    await sql`TRUNCATE members`;
    for (const m of members) {
      const g = (c) => (m[c] === undefined || m[c] === null) ? '' : String(m[c]);
      await sql`INSERT INTO members (member_id,pub_id,email,password_hash,ref_code,referred_by,status,start_date,paid_periods,referred_paid_count,earned_free_months,next_charge_date,notes,cert_mw,cert_tw,cert_us,cert_key,cert_macro,cert_flag,plan,fb_name,notify_off,ex_founding)
        VALUES (${g('member_id')},${g('pub_id')},${g('email')},${g('password_hash')},${g('ref_code')},${g('referred_by')},${g('status')},${g('start_date')},${g('paid_periods')},${g('referred_paid_count')},${g('earned_free_months')},${g('next_charge_date')},${g('notes')},${g('cert_mw')},${g('cert_tw')},${g('cert_us')},${g('cert_key')},${g('cert_macro')},${g('cert_flag')},${g('plan')},${g('fb_name')},${g('notify_off')},${g('ex_founding')})`;
    }
    await sql`TRUNCATE payments`;
    for (const p of payments) {
      await sql`INSERT INTO payments (ts,email,amount,trade_no,note,status)
        VALUES (${String(p.timestamp || p.ts || '')},${payEmail(p)},${String(p.amount || '')},${String(p.trade_no || p.neweb_trade_no || '')},${String(p.note || p.custom_field || '')},${String(p.status || '')})`;
    }
  } catch (e) { return J({ ok: false, error: '寫入 DB 失敗：' + String((e && e.message) || e) }); }

  let mc = null, pc = null;
  try { mc = (await sql`SELECT count(*)::int AS n FROM members`)[0].n; pc = (await sql`SELECT count(*)::int AS n FROM payments`)[0].n; } catch (e) {}
  return J({ ok: true, source: { members: members.length, payments: payments.length }, db: { members: mc, payments: pc } });
}
