"use client";
import { useEffect, useState } from "react";
import InstallApp from "../components/InstallApp";

const BASE = "https://yoda-wcyc.github.io";
const SUBSTACK = "https://iamtwispin.substack.com";

const SIG_MAP = {
  green: ["綠燈", "var(--green)"],
  yellow: ["黃燈", "var(--yellow)"],
  red: ["紅燈", "var(--red)"],
};

const CATS = [
  { key: "簡報", tag: "每週三次", title: "公開簡報", desc: "一到兩屏讀完的白話市場摘要,附深讀連結。" },
  { key: "市場觀察", tag: "每週三次", title: "市場觀察", desc: "三區塊驅動力矩陣、板塊輪動、主線聚焦與多空劇本。" },
  { key: "美股", tag: "每週三次", title: "美股分析", desc: "REL5 / REL20 / WA 三層篩選,A 級強勢股與輪漲偵測。" },
  { key: "台股", tag: "每週三次", title: "台股分析", desc: "強勢股篩選疊加法人籌碼四型態:吸籌、反轉、換手、警示。" },
  { key: "AI泡沫", tag: "不定期", title: "AI 泡沫評估", desc: "8 維度加權相似度 + ROI 缺口模型,量化這輪牛市的泡沫程度。" },
  { key: "總經", tag: "月更", title: "總體經濟", desc: "Fed、通膨、就業與景氣循環的監控儀表板。" },
];

// 溫度條：市場觀察四維度
function TempBar({ name, label, labelColor, pct, bubbleColor, noteColor, note }) {
  const stops = ["0%", "25%", "50%", "75%", "100%"];
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
        <span style={{ fontFamily: "var(--sans)", fontSize: "calc(12px*var(--scale))", letterSpacing: ".1em", textTransform: "uppercase", fontWeight: 700, color: "var(--dim)" }}>{name}</span>
        <span style={{ fontFamily: "var(--sans)", fontSize: "calc(13px*var(--scale))", fontWeight: 700, color: labelColor }}>{label}</span>
      </div>
      <div style={{ position: "relative", height: 11, borderRadius: 6, background: "linear-gradient(90deg,#22c55e 0%,#84cc16 20%,#f59e0b 50%,#f97316 75%,#ef4444 100%)", boxShadow: "0 2px 8px rgba(0,0,0,.25)", overflow: "visible" }}>
        {[25, 50, 75].map(p => <div key={p} style={{ position: "absolute", top: 0, bottom: 0, left: `${p}%`, width: 1, background: "rgba(255,255,255,.18)" }} />)}
        <div style={{ position: "absolute", left: `${pct}%`, top: "50%", transform: "translate(-50%,-50%)", zIndex: 10 }}>
          <div style={{ position: "absolute", bottom: "calc(100% + 4px)", left: "50%", transform: "translateX(-50%)", background: bubbleColor, color: "#080b10", fontWeight: 700, fontSize: "calc(11px*var(--scale))", padding: "1px 6px", borderRadius: 3, whiteSpace: "nowrap" }}>{pct}</div>
          <div style={{ position: "absolute", bottom: "calc(100% - 2px)", left: "50%", transform: "translateX(-50%)", border: "4px solid transparent", borderTopColor: bubbleColor }} />
          <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#fff", border: `2.5px solid ${bubbleColor}`, boxShadow: `0 0 8px ${bubbleColor}66`, animation: "sig-pulse 2s ease-in-out infinite" }} />
        </div>
      </div>
      {note && <div style={{ fontSize: "calc(11px*var(--scale))", color: "var(--dim)", marginTop: 5, lineHeight: 1.5 }}>{note}</div>}
    </div>
  );
}

// 景氣位階溫度條 (總經)
function CycleTempBar({ pct, label, note }) {
  const zones = [
    { label: "🌱 復甦期", color: "#00c8a0" },
    { label: "📈 成長期", color: "#4d9fff" },
    { label: "🔥 榮景期", color: "#f0a500" },
    { label: "⚠ 衰退期", color: "#ff4d6d" },
  ];
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        {zones.map(z => <span key={z.label} style={{ fontFamily: "var(--sans)", fontSize: "calc(11px*var(--scale))", fontWeight: 600, color: z.color }}>{z.label}</span>)}
      </div>
      <div style={{ position: "relative", height: 12, borderRadius: 7, background: "linear-gradient(90deg,#00c8a0 0%,#1ac8b0 10%,#35b8c8 20%,#4da8e0 28%,#4d9fff 38%,#78a8f0 48%,#c0a040 58%,#f0a500 65%,#f07828 72%,#e84060 82%,#ff4d6d 100%)", boxShadow: "0 2px 10px rgba(0,0,0,.25)", overflow: "visible" }}>
        {[25, 50, 75].map(p => <div key={p} style={{ position: "absolute", top: 0, bottom: 0, left: `${p}%`, width: 1, background: "rgba(255,255,255,.18)" }} />)}
        <div style={{ position: "absolute", left: `${pct}%`, top: "50%", transform: "translate(-50%,-50%)", zIndex: 10 }}>
          <div style={{ position: "absolute", bottom: "calc(100% + 5px)", left: "50%", transform: "translateX(-50%)", background: "#f0a500", color: "#080b10", fontWeight: 700, fontSize: "calc(11px*var(--scale))", padding: "2px 8px", borderRadius: 3, whiteSpace: "nowrap" }}>{label}</div>
          <div style={{ position: "absolute", bottom: "calc(100% - 2px)", left: "50%", transform: "translateX(-50%)", border: "4px solid transparent", borderTopColor: "#f0a500" }} />
          <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", border: "3px solid #f0a500", boxShadow: "0 0 6px rgba(240,165,0,.5)", animation: "sig-pulse 2s ease-in-out infinite" }} />
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, fontSize: "calc(10px*var(--scale))", color: "var(--dim)" }}>
        <span>景氣低谷</span><span>溫和擴張</span><span>過熱加速</span><span>衰退收縮</span>
      </div>
      {note && <div style={{ fontSize: "calc(12px*var(--scale))", color: "var(--dim)", marginTop: 8, lineHeight: 1.7 }}>{note}</div>}
    </div>
  );
}

// AI 泡沫分數條
function BubbleScoreBar({ score, note }) {
  const pct = score;
  const dotColor = pct >= 75 ? "#ff4d6d" : pct >= 50 ? "#f0a500" : pct >= 25 ? "#4d9fff" : "#00c8a0";
  const labels = [
    { label: "🟢 理性成長", color: "#00c8a0" },
    { label: "🔵 溫和過熱", color: "#4d9fff" },
    { label: "🟡 泡沫警戒", color: "#f0a500" },
    { label: "🔴 崩盤風險", color: "#ff4d6d" },
  ];
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        {labels.map(l => <span key={l.label} style={{ fontSize: "calc(11px*var(--scale))", fontWeight: 600, color: l.color }}>{l.label}</span>)}
      </div>
      <div style={{ position: "relative", height: 12, borderRadius: 7, background: "linear-gradient(90deg,#00c8a0 0%,#4d9fff 35%,#f0a500 65%,#ff4d6d 100%)", boxShadow: "0 2px 10px rgba(0,0,0,.25)", overflow: "visible" }}>
        {[25, 50, 75].map(p => <div key={p} style={{ position: "absolute", top: 0, bottom: 0, left: `${p}%`, width: 1, background: "rgba(255,255,255,.2)" }} />)}
        <div style={{ position: "absolute", left: `${pct}%`, top: "50%", transform: "translate(-50%,-50%)", zIndex: 10 }}>
          <div style={{ position: "absolute", bottom: "calc(100% + 5px)", left: "50%", transform: "translateX(-50%)", background: dotColor, color: "#080b10", fontWeight: 700, fontSize: "calc(11px*var(--scale))", padding: "2px 8px", borderRadius: 3, whiteSpace: "nowrap" }}>當前 {score}/100</div>
          <div style={{ position: "absolute", bottom: "calc(100% - 2px)", left: "50%", transform: "translateX(-50%)", border: "4px solid transparent", borderTopColor: dotColor }} />
          <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", border: `3px solid ${dotColor}`, boxShadow: `0 0 6px ${dotColor}88`, animation: "sig-pulse 2s ease-in-out infinite" }} />
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, fontSize: "calc(10px*var(--scale))", color: "var(--dim)" }}>
        <span>0 — 基本面支撐</span><span>25 — 估值略偏高</span><span>50 — 泡沫特徵明顯</span><span>75+ — 崩盤前夕</span>
      </div>
      {note && <div style={{ fontSize: "calc(12px*var(--scale))", color: "var(--dim)", marginTop: 8, lineHeight: 1.7 }}>{note}</div>}
    </div>
  );
}

const DEFAULTS = {
  sig: ["綠燈", "var(--green)"],
  sigNote: "新資金週期進行中",
  vix: "16.4",
  spx: "7,380",
  anchor: "5Y 均值 P/E 錨:6,945",
  hl: [167, 122],
  updated: "數據更新:2026-07-13 收盤。",
  // 市場觀察四溫度計預設
  temp: [
    { name: "資金流判定", label: "穩定", labelColor: "#4da8e0", pct: 56, bubbleColor: "#4da8e0" },
    { name: "情緒過熱觸發", label: "中性偏過熱", labelColor: "#f59e0b", pct: 65, bubbleColor: "#f59e0b" },
    { name: "Risk-on / off", label: "中性", labelColor: "#00d4aa", pct: 56, bubbleColor: "#00d4aa" },
    { name: "市場廣度", label: "健康帶（62.1%）", labelColor: "#a855f7", pct: 62, bubbleColor: "#a855f7" },
  ],
  // 景氣位階
  cycle: { pct: 65, label: "榮景期前中段", note: "景氣大循環位於榮景期前中段（7月更新）。Fed 主席 Warsh 轉鷹，升息機率升至 36%，但 7 月 FOMC 仍有 88% 機率按兵不動。消費端三項警示均未觸發，核心 PCE 3.3% 仍是最大隱患。製造業週期位於擴張期（67%），訂單強勁但需注意過熱錯配風險。整體判讀：距景氣頂點仍有緩衝，但容錯率正在下降，任何負面衝擊的傳導速度都會快於前兩年。" },
  // AI 泡沫
  bScore: 75,
  bHeadline: "崩盤風險區",
  bNote: "CAPE 40.3x、巴菲特指標 236%、Mag-7 集中度 33.8% 四重警示同步亮燈。EPS 成長提供緩衝，但容錯率極低，任何負面衝擊都可能觸發 15–30% 快速修正。",
  bUrl: BASE + "/-/AI泡沫評估_20260710.html",
  // 最新簡報連結(預設報告中心)
  latestBrief: BASE + "/-/",
};

export default function Home() {
  const [d, setD] = useState(DEFAULTS);
  const [latest, setLatest] = useState({});
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState({ text: "", ok: true });

  useEffect(() => {
    fetch(BASE + "/-/reports.json", { cache: "no-store" })
      .then(r => { if (!r.ok) throw 0; return r.json(); })
      .then(data => {
        try {
          const db = data.dashboard || {};
          const next = { ...DEFAULTS };
          if (db.signal && SIG_MAP[db.signal]) next.sig = SIG_MAP[db.signal];
          if (db.signal_note) next.sigNote = db.signal_note;
          if (db.vix != null) next.vix = String(db.vix);
          if (db.spx != null) next.spx = Number(db.spx).toLocaleString();
          if (db.spx_anchor_5y != null) next.anchor = "5Y 均值 P/E 錨:" + Number(db.spx_anchor_5y).toLocaleString();
          if (db.high_low) next.hl = db.high_low;
          if (data.updated) next.updated = "數據更新:" + data.updated + "。";
          const bb = data.bubble || {};
          if (bb.score != null) next.bScore = Number(bb.score);
          if (bb.headline) next.bHeadline = bb.headline;
          if (bb.url) next.bUrl = bb.url;
          // 最新簡報連結
          const lt = data.latest || {};
          if (lt["簡報"]?.file) next.latestBrief = BASE + "/-/" + encodeURIComponent(lt["簡報"].file);
          setD(next);
          setLatest(lt);
        } catch (e) {}
      }).catch(() => {});
  }, []);

  useEffect(() => {
    const io = new IntersectionObserver(es => {
      es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { threshold: 0.12 });
    document.querySelectorAll(".reveal").forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);

  const subscribe = () => {
    const v = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { setMsg({ text: "請輸入有效的 Email", ok: false }); return; }
    setMsg({ text: "正在前往訂閱確認頁…", ok: true });
    window.open(SUBSTACK + "/subscribe?email=" + encodeURIComponent(v), "_blank");
  };

  return (
    <>
      {/* 1. Hero */}
      <header className="hero">
        <h1 className="reveal">Yoda <span className="gold">Research</span></h1>
        <p className="reveal">用最清澈的白話，凌駕喧囂，解碼美股與台股的真實訊號</p>
        <div className="hero-cta reveal">
          <a className="btn btn-gold" href={d.latestBrief}>今日簡報</a>
          <a className="btn btn-ghost" href="#subscribe">訂閱電子報</a>
        </div>
      </header>

      <div className="wrap">
        {/* 2. 市場溫度儀表板 */}
        <section id="dashboard">
          <div className="eyebrow reveal">Market Temperature</div>
          <h2 className="reveal">市場溫度儀表板</h2>
          {/* 信號燈 + 大數字 */}
          <div className="dash reveal" style={{ marginBottom: "calc(20px*var(--scale))" }}>
            <div className="card">
              <div className="lbl">市場信號燈</div>
              <div className="val"><span className="sig-dot" style={{ background: d.sig[1] }}></span><span>{d.sig[0]}</span></div>
              <div className="sub">{d.sigNote}</div>
            </div>
            <div className="card">
              <div className="lbl">VIX 恐慌指數</div>
              <div className="val">{d.vix}</div>
              <div className="sub">低波動區間</div>
            </div>
            <div className="card">
              <div className="lbl">S&amp;P 500 vs 估值錨</div>
              <div className="val">{d.spx}</div>
              <div className="sub">{d.anchor}</div>
            </div>
            <div className="card">
              <div className="lbl">52週 新高／新低</div>
              <div className="val">{d.hl[0]} <span style={{ color: "var(--dim)" }}>/</span> {d.hl[1]}</div>
              <div className="sub">廣度確認:偏多</div>
            </div>
          </div>
          {/* 四條市場溫度計 */}
          <div className="card reveal" style={{ padding: "calc(24px*var(--scale))" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "calc(18px*var(--scale))" }}>
              <div style={{ fontFamily: "var(--sans)", fontWeight: 600, fontSize: "calc(15px*var(--scale))", color: "var(--text)" }}>四維度市場溫度</div>
              <a href={latest["市場觀察"]?.file ? BASE + "/-/" + encodeURIComponent(latest["市場觀察"].file) : BASE + "/-/"} style={{ fontSize: "calc(12px*var(--scale))", color: "var(--accent)" }}>完整市場觀察 →</a>
            </div>
            {d.temp.map(t => <TempBar key={t.name} {...t} />)}
          </div>
          <div className="dash-note reveal"><span>{d.updated}</span>簡報發布時同步更新。</div>
        </section>

        {/* 3. 最新研究 */}
        <section id="research">
          <div className="eyebrow reveal">Research</div>
          <h2 className="reveal">最新研究</h2>
          <div className="grid3">
            {CATS.map(c => {
              const e = latest[c.key];
              const has = e && e.file;
              const href = has ? BASE + "/-/" + encodeURIComponent(e.file) : BASE + "/-/";
              const desc = has && e.summary && e.summary.indexOf("占位") === -1 ? e.summary : c.desc;
              const go = has && e.date ? `閱讀最新(${e.date})→` : "閱讀最新 →";
              return (
                <a key={c.key} className="card cat reveal" href={href}>
                  <span className="tag">{c.tag}</span>
                  <h3>{c.title}</h3>
                  <p>{desc}</p>
                  <span className="go">{go}</span>
                </a>
              );
            })}
          </div>
          <div style={{ textAlign: "center", marginTop: "calc(28px*var(--scale))" }}>
            <a className="btn btn-ghost" href="/archive">瀏覽全部報告 →</a>
          </div>
        </section>

        {/* 4. 景氣位階(總經) */}
        <section id="cycle">
          <div className="eyebrow reveal">Macro Cycle</div>
          <h2 className="reveal">總經景氣位階</h2>
          <div className="card reveal" style={{ padding: "calc(28px*var(--scale))" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "calc(18px*var(--scale))" }}>
              <div style={{ fontWeight: 600, fontSize: "calc(15px*var(--scale))" }}>景氣大循環位階</div>
              <a href={latest["總經"]?.file ? BASE + "/-/" + encodeURIComponent(latest["總經"].file) : BASE + "/-/"} style={{ fontSize: "calc(12px*var(--scale))", color: "var(--accent)" }}>完整總經報告 →</a>
            </div>
            <CycleTempBar pct={d.cycle.pct} label={d.cycle.label} note={d.cycle.note} />
          </div>
        </section>

        {/* 5. AI Bubble Monitor */}
        <section id="bubble">
          <div className="eyebrow reveal">AI Bubble Monitor</div>
          <h2 className="reveal">AI 泡沫監測</h2>
          <div className="card reveal" style={{ padding: "calc(28px*var(--scale))" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "calc(18px*var(--scale))" }}>
              <div style={{ fontWeight: 600, fontSize: "calc(15px*var(--scale))" }}>{d.bHeadline}</div>
              <a href={d.bUrl} style={{ fontSize: "calc(12px*var(--scale))", color: "var(--accent)" }}>完整評估 →</a>
            </div>
            <BubbleScoreBar score={d.bScore} note={d.bNote} />
          </div>
        </section>

        {/* 6. 訂閱 */}
        <section id="subscribe">
          <div className="sub-box">
            <div className="eyebrow reveal">Newsletter</div>
            <h2 className="reveal">市場簡報,直送信箱</h2>
            <p className="reveal">盤後解碼,洞察無價,簡報永久免費訂閱。</p>
            <div className="sub-form reveal">
              <input type="email" placeholder="you@example.com" aria-label="Email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && subscribe()} />
              <button className="btn btn-gold" onClick={subscribe}>免費訂閱</button>
            </div>
            <div className="sub-msg" role="status" style={{ color: msg.ok ? "var(--green)" : "var(--red)" }}>{msg.text}</div>
            <InstallApp />
          </div>
        </section>
      </div>

      <footer>
        <div className="wrap">
          <div className="links">
            <a href="https://www.facebook.com/profile.php?id=100069223220386" target="_blank" rel="noopener">Facebook 粉專</a>
            <a href="https://yoda-wcyc.github.io/-/">研究報告中心</a>
          </div>
          <div className="disc">
            免責聲明:本站所有內容僅為個人研究記錄與資訊分享,不構成任何投資建議或買賣邀約。投資有風險,任何決策請自行判斷並承擔結果。數據來源力求準確,但不保證即時與完整。<br />© 2026 Yoda Research
          </div>
        </div>
      </footer>
    </>
  );
}
