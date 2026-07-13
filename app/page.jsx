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
  { key: "簡報",    tag: "每週三次", title: "免費簡報",   desc: "一到兩屏讀完的白話市場摘要,附深讀連結。" },
  { key: "市場觀察",tag: "每週三次", title: "市場觀察",   desc: "三區塊驅動力矩陣、板塊輪動、主線聚焦與多空劇本。" },
  { key: "美股",    tag: "每週三次", title: "美股分析",   desc: "REL5 / REL20 / WA 三層篩選,A 級強勢股與輪漲偵測。" },
  { key: "台股",    tag: "每週三次", title: "台股分析",   desc: "強勢股篩選疊加法人籌碼四型態:吸籌、反轉、換手、警示。" },
  { key: "AI泡沫",  tag: "不定期",  title: "AI 泡沫評估",desc: "8 維度加權相似度 + ROI 缺口模型,量化這輪牛市的泡沫程度。" },
  { key: "總經",    tag: "月更",    title: "總體經濟",   desc: "Fed、通膨、就業與景氣循環的監控儀表板。" },
];

/* ── 市場觀察四條溫度計 ── */
function TempBar({ name, label, labelColor, pct, bubbleColor }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
        <span style={{ fontSize:"calc(12px*var(--scale))", letterSpacing:".1em", textTransform:"uppercase", fontWeight:700, color:"var(--dim)" }}>{name}</span>
        <span style={{ fontSize:"calc(13px*var(--scale))", fontWeight:700, color:labelColor }}>{label}</span>
      </div>
      <div style={{ position:"relative", height:11, borderRadius:6, overflow:"visible",
        background:"linear-gradient(90deg,#22c55e 0%,#84cc16 20%,#f59e0b 50%,#f97316 75%,#ef4444 100%)",
        boxShadow:"0 2px 8px rgba(0,0,0,.25)" }}>
        {[25,50,75].map(p=><div key={p} style={{ position:"absolute",top:0,bottom:0,left:`${p}%`,width:1,background:"rgba(255,255,255,.18)" }}/>)}
        <div style={{ position:"absolute",left:`${pct}%`,top:"50%",transform:"translate(-50%,-50%)",zIndex:10 }}>
          <div style={{ position:"absolute",bottom:"calc(100% + 4px)",left:"50%",transform:"translateX(-50%)",
            background:bubbleColor,color:"#080b10",fontWeight:700,fontSize:"calc(11px*var(--scale))",
            padding:"1px 6px",borderRadius:3,whiteSpace:"nowrap" }}>{pct}</div>
          <div style={{ position:"absolute",bottom:"calc(100% - 2px)",left:"50%",transform:"translateX(-50%)",
            border:"4px solid transparent",borderTopColor:bubbleColor }}/>
          <div style={{ width:16,height:16,borderRadius:"50%",background:"#fff",
            border:`2.5px solid ${bubbleColor}`,boxShadow:`0 0 8px ${bubbleColor}66`,
            animation:"sig-pulse 2s ease-in-out infinite" }}/>
        </div>
      </div>
    </div>
  );
}

/* ── 總經景氣大循環溫度條 ── */
function CycleTempBar() {
  return (
    <div style={{ marginBottom:28 }}>
      <div style={{ fontSize:"calc(13px*var(--scale))", fontWeight:700, color:"var(--dim)",
        letterSpacing:".08em", textTransform:"uppercase", marginBottom:8 }}>景氣大循環溫度條</div>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
        {[["🌱 復甦期","#00c8a0"],["📈 成長期","#4d9fff"],["🔥 榮景期","#f0a500"],["⚠ 衰退期","#ff4d6d"]].map(([l,c])=>
          <span key={l} style={{ fontSize:"calc(11px*var(--scale))", fontWeight:600, color:c }}>{l}</span>)}
      </div>
      <div style={{ position:"relative", height:14, borderRadius:8, overflow:"visible",
        background:"linear-gradient(90deg,#00c8a0 0%,#1ac8b0 10%,#35b8c8 20%,#4da8e0 28%,#4d9fff 38%,#78a8f0 48%,#c0a040 58%,#f0a500 65%,#f07828 72%,#e84060 82%,#ff4d6d 100%)",
        boxShadow:"0 2px 12px rgba(0,0,0,.25)" }}>
        {[25,50,75].map(p=><div key={p} style={{ position:"absolute",top:0,bottom:0,left:`${p}%`,width:1,background:"rgba(255,255,255,.18)" }}/>)}
        <div style={{ position:"absolute",left:"65%",top:"50%",transform:"translate(-50%,-50%)",zIndex:10 }}>
          <div style={{ position:"absolute",bottom:"calc(100% + 7px)",left:"50%",transform:"translateX(-50%)",
            background:"#f0a500",color:"#080b10",fontWeight:700,fontSize:"calc(11px*var(--scale))",
            padding:"2px 8px",borderRadius:3,whiteSpace:"nowrap" }}>當前位置（7月更新）</div>
          <div style={{ position:"absolute",bottom:"calc(100% + 1px)",left:"50%",transform:"translateX(-50%)",
            border:"4px solid transparent",borderTopColor:"#f0a500" }}/>
          <div style={{ width:22,height:22,borderRadius:"50%",background:"#fff",
            border:"3px solid #f0a500",boxShadow:"0 0 4px 2px rgba(240,165,0,.2)",
            animation:"sig-pulse 2s ease-in-out infinite" }}/>
        </div>
      </div>
      <div style={{ display:"flex",justifyContent:"space-between",marginTop:6,fontSize:"calc(10px*var(--scale))",color:"var(--dim)" }}>
        <span>景氣低谷</span><span>溫和擴張</span><span>過熱加速</span><span>衰退收縮</span>
      </div>
    </div>
  );
}

/* ── 總經製造業週期溫度條 ── */
function MfgTempBar() {
  return (
    <div style={{ marginBottom:28 }}>
      <div style={{ fontSize:"calc(13px*var(--scale))", fontWeight:700, color:"var(--dim)",
        letterSpacing:".08em", textTransform:"uppercase", marginBottom:8 }}>製造業循環溫度條</div>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
        {[["⬇ 衰退（去庫存）","#ff4d6d"],["↑ 復甦（補庫存）","#00c8a0"],["↑↑ 擴張（擴產）","#4d9fff"],["△ 過熱（錯配）","#f0a500"]].map(([l,c])=>
          <span key={l} style={{ fontSize:"calc(11px*var(--scale))", fontWeight:600, color:c }}>{l}</span>)}
      </div>
      <div style={{ position:"relative", height:14, borderRadius:8, overflow:"visible",
        background:"linear-gradient(90deg,#ff4d6d 0%,#00c8a0 25%,#4d9fff 50%,#f0a500 100%)",
        boxShadow:"0 2px 12px rgba(0,0,0,.25)" }}>
        {[25,50,75].map(p=><div key={p} style={{ position:"absolute",top:0,bottom:0,left:`${p}%`,width:1,background:"rgba(255,255,255,.18)" }}/>)}
        <div style={{ position:"absolute",left:"67%",top:"50%",transform:"translate(-50%,-50%)",zIndex:10 }}>
          <div style={{ position:"absolute",bottom:"calc(100% + 7px)",left:"50%",transform:"translateX(-50%)",
            background:"#4d9fff",color:"#080b10",fontWeight:700,fontSize:"calc(11px*var(--scale))",
            padding:"2px 8px",borderRadius:3,whiteSpace:"nowrap" }}>當前位置（7月更新）</div>
          <div style={{ position:"absolute",bottom:"calc(100% + 1px)",left:"50%",transform:"translateX(-50%)",
            border:"4px solid transparent",borderTopColor:"#4d9fff" }}/>
          <div style={{ width:22,height:22,borderRadius:"50%",background:"#fff",
            border:"3px solid #4d9fff",boxShadow:"0 0 4px 2px rgba(77,159,255,.2)",
            animation:"sig-pulse 2s ease-in-out infinite" }}/>
        </div>
      </div>
      <div style={{ display:"flex",justifyContent:"space-between",marginTop:6,fontSize:"calc(10px*var(--scale))",color:"var(--dim)" }}>
        <span>庫存過高·砍CAPEX</span><span>庫存偏低·補庫存</span><span>訂單強勁·擴產線</span><span>需求降速·缺工</span>
      </div>
    </div>
  );
}

/* ── 總經 sin wave(market-wave-svg) ── */
function MarketWaveSvg() {
  return (
    <div style={{ marginTop:8 }}>
      <div style={{ fontSize:"calc(11px*var(--scale))", color:"var(--dim)", marginBottom:6, display:"flex", gap:16 }}>
        <span>放在一起看</span>
        <span style={{ opacity:.7 }}>白線 = 景氣大循環（7-10Y）　·　藍線 = 製造業週期（2-4Y）</span>
      </div>
      <svg viewBox="0 0 900 200" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none"
        style={{ width:"100%", height:"auto", display:"block" }}>
        <rect x="0"   y="0" width="120" height="200" fill="rgba(255,77,109,.09)"/>
        <rect x="120" y="0" width="190" height="200" fill="rgba(0,200,160,.09)"/>
        <rect x="310" y="0" width="180" height="200" fill="rgba(77,159,255,.09)"/>
        <rect x="490" y="0" width="190" height="200" fill="rgba(240,165,0,.09)"/>
        <rect x="680" y="0" width="220" height="200" fill="rgba(255,77,109,.09)"/>
        {[[120,0,120,200],[310,0,310,200],[490,0,490,200],[680,0,680,200]].map(([x1,y1,x2,y2],i)=>
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,.1)" strokeWidth="1" strokeDasharray="3,3"/>)}
        <line x1="0" y1="100" x2="900" y2="100" stroke="rgba(255,255,255,.07)" strokeWidth="1" strokeDasharray="4,4"/>
        {[["60","#ff4d6d","⚠ 衰退期"],["215","#00c8a0","🌱 復甦期"],["400","#4d9fff","📈 成長期"],["585","#f0a500","🔥 榮景期"],["790","#ff4d6d","⚠ 衰退期"]].map(([x,c,t])=>
          <text key={x} x={x} y="15" textAnchor="middle" fontFamily="monospace" fill={c} fontWeight="600" fontSize="11">{t}</text>)}
        <defs>
          <linearGradient id="lgGrad2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,.05)"/>
            <stop offset="100%" stopColor="rgba(255,255,255,0)"/>
          </linearGradient>
        </defs>
        {/* 景氣大循環曲線(琥珀橙) */}
        <path d="M 0,150.8 C 120,165 240,150 400,100 S 600,35 680,35 S 820,45 900,78.5"
          fill="none" stroke="#f0a500" strokeWidth="2.5" strokeLinejoin="round"/>
        {/* 製造業週期曲線(藍) */}
        <path d="M 0,170.8 C 60,185 120,165 200,140 S 300,135 350,121 S 450,78 540,52 S 640,28 680,35 S 760,28 840,40 S 880,65 900,98.5"
          fill="none" stroke="#4d9fff" strokeWidth="1.6" strokeLinejoin="round" opacity=".8"/>
        {/* 當前位置指示器(景氣大循環) */}
        <g transform="translate(604,40.8)">
          <circle r="9" fill="rgba(240,165,0,.25)" style={{ animation:"sig-pulse 2s ease-in-out infinite" }}/>
          <circle r="5" fill="#fff" stroke="#f0a500" strokeWidth="2.5"/>
          <rect x="-54" y="-36" width="108" height="18" rx="3" fill="#f0a500"/>
          <text x="0" y="-23" textAnchor="middle" fontFamily="monospace" fill="#080b10" fontWeight="700" fontSize="11">景氣大循環位階</text>
          <line x1="0" y1="-18" x2="0" y2="-5" stroke="#f0a500" strokeWidth="1.5"/>
        </g>
        {/* 當前位置指示器(製造業週期) */}
        <g transform="translate(545,47.9)">
          <circle r="7" fill="rgba(77,159,255,.25)" style={{ animation:"sig-pulse 2s ease-in-out infinite" }}/>
          <circle r="4.5" fill="#fff" stroke="#4d9fff" strokeWidth="2"/>
          <rect x="-54" y="10" width="108" height="18" rx="3" fill="#4d9fff"/>
          <text x="0" y="23" textAnchor="middle" fontFamily="monospace" fill="#080b10" fontWeight="700" fontSize="11">製造業週期位階</text>
          <line x1="0" y1="5" x2="0" y2="10" stroke="#4d9fff" strokeWidth="1.5"/>
        </g>
        {/* 圖例 */}
        <rect x="690" y="145" width="205" height="50" fill="rgba(0,0,0,.28)" rx="4"/>
        <line x1="698" y1="159" x2="728" y2="159" stroke="#f0a500" strokeWidth="2.5"/>
        <text x="734" y="163" fontFamily="monospace" fill="#f0a500" fontSize="11">景氣大循環（7-10Y）</text>
        <line x1="698" y1="178" x2="728" y2="178" stroke="#4d9fff" strokeWidth="1.8"/>
        <text x="734" y="182" fontFamily="monospace" fill="#4d9fff" fontSize="11">製造業週期（2-4Y）</text>
      </svg>
      <div style={{ fontSize:"calc(10px*var(--scale))", color:"#f0a500", marginTop:6, letterSpacing:".04em" }}>
        ▸ 當前：景氣大循環榮景期前中段（65%）·製造業週期擴張期（67%）（7月更新）
      </div>
    </div>
  );
}

/* ── AI 泡沫分數條(原版一比一) ── */
function BubbleScoreBar({ score, note }) {
  const pct = score;
  const dotColor = pct >= 75 ? "#ff4d6d" : pct >= 50 ? "#f0a500" : pct >= 25 ? "#4d9fff" : "#00c8a0";
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
        {[["🟢 理性成長","#00c8a0"],["🔵 溫和過熱","#4d9fff"],["🟡 泡沫警戒","#f0a500"],["🔴 崩盤風險","#ff4d6d"]].map(([l,c])=>
          <span key={l} style={{ fontSize:"calc(11px*var(--scale))", fontWeight:600, color:c }}>{l}</span>)}
      </div>
      <div style={{ position:"relative", height:14, borderRadius:8, overflow:"visible",
        background:"linear-gradient(90deg,#00c8a0 0%,#4d9fff 35%,#f0a500 65%,#ff4d6d 100%)",
        boxShadow:"0 2px 12px rgba(0,0,0,.25)" }}>
        {[25,50,75].map(p=><div key={p} style={{ position:"absolute",top:0,bottom:0,left:`${p}%`,width:1,background:"rgba(255,255,255,.2)" }}/>)}
        <div style={{ position:"absolute",left:`${pct}%`,top:"50%",transform:"translate(-50%,-50%)",zIndex:10 }}>
          <div style={{ position:"absolute",bottom:"calc(100% + 8px)",left:"50%",transform:"translateX(-50%)",
            background:dotColor,color:"#080b10",fontWeight:700,fontSize:"calc(11px*var(--scale))",
            padding:"2px 8px",borderRadius:3,whiteSpace:"nowrap" }}>當前 {score}/100</div>
          <div style={{ position:"absolute",bottom:"calc(100% + 2px)",left:"50%",transform:"translateX(-50%)",
            border:"4px solid transparent",borderTopColor:dotColor }}/>
          <div style={{ width:20,height:20,borderRadius:"50%",background:"#fff",
            border:`3px solid ${dotColor}`,
            boxShadow:`0 0 0 3px ${dotColor}33`,
            animation:"bubble-pulse 2s ease-in-out infinite" }}/>
        </div>
      </div>
      <div style={{ display:"flex",justifyContent:"space-between",marginTop:6,fontSize:"calc(10px*var(--scale))",color:"var(--dim)" }}>
        <span>0 — 基本面完全支撐</span><span>25 — 估值略偏高</span><span>50 — 泡沫特徵明顯</span><span>75+ — 崩盤前夕</span>
      </div>
      {note && <div style={{ fontSize:"calc(12px*var(--scale))", color:"var(--dim)", marginTop:10, lineHeight:1.75 }}>{note}</div>}
    </div>
  );
}

const DEFAULTS = {
  sig: ["綠燈", "var(--green)"],
  sigNote: "新資金週期進行中",
  updated: "數據更新:2026-07-13 收盤。",
  temp: [
    { name:"資金流判定",   label:"穩定",          labelColor:"#4da8e0", pct:56, bubbleColor:"#4da8e0" },
    { name:"情緒過熱觸發", label:"中性偏過熱",    labelColor:"#f59e0b", pct:65, bubbleColor:"#f59e0b" },
    { name:"Risk-on / off",label:"中性",          labelColor:"#00d4aa", pct:56, bubbleColor:"#00d4aa" },
    { name:"市場廣度",     label:"健康帶（62.1%）",labelColor:"#a855f7", pct:62, bubbleColor:"#a855f7" },
  ],
  bScore: 75,
  bNote: "PEG 0.73 與 EPS +28.6% 提供盈餘緩衝，但 CAPE 40.3x、巴菲特指標 236%、Mag-7 集中度 33.8%、CapEx ROI 缺口 -$1,850 億四重警示同步亮燈。Oracle FY2026 已實際轉負 FCF -$237 億，歷史相似度跳升至「極高相似」區間（0.96/0.92）。情緒面雖轉恐慌（CNN F&G 28），但市場結構與機構持倉訊號仍持續惡化。",
  bUrl: BASE + "/-/AI泡沫評估表_20260701.html",
  latestBrief: BASE + "/-/",
};

export default function Home() {
  const [d, setD] = useState(DEFAULTS);
  const [latest, setLatest] = useState({});
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState({ text:"", ok:true });

  useEffect(() => {
    fetch(BASE + "/-/reports.json", { cache:"no-store" })
      .then(r => { if (!r.ok) throw 0; return r.json(); })
      .then(data => {
        try {
          const db = data.dashboard || {};
          const next = { ...DEFAULTS };
          if (db.signal && SIG_MAP[db.signal]) next.sig = SIG_MAP[db.signal];
          if (db.signal_note) next.sigNote = db.signal_note;
          if (db.temp?.length === 4) next.temp = db.temp;
          if (data.updated) next.updated = "數據更新:" + data.updated + "。";
          const bb = data.bubble || {};
          if (bb.score != null) next.bScore = Number(bb.score);
          if (bb.note)  next.bNote = bb.note;
          if (bb.url)   next.bUrl  = bb.url;
          const lt = data.latest || {};
          if (lt["簡報"]?.file) next.latestBrief = BASE + "/-/" + encodeURIComponent(lt["簡報"].file);
          setD(next);
          setLatest(lt);
        } catch(e) {}
      }).catch(() => {});
  }, []);

  useEffect(() => {
    const io = new IntersectionObserver(es => {
      es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { threshold:0.12 });
    document.querySelectorAll(".reveal").forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);

  const subscribe = () => {
    const v = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { setMsg({ text:"請輸入有效的 Email", ok:false }); return; }
    setMsg({ text:"正在前往訂閱確認頁…", ok:true });
    window.open(SUBSTACK + "/subscribe?email=" + encodeURIComponent(v), "_blank");
  };

  return (
    <>
      {/* Hero */}
      <header className="hero">
        <h1 className="reveal">Yoda <span className="gold">Research</span></h1>
        <p className="reveal">用最清澈的白話，凌駕喧囂，解碼美股與台股的真實訊號</p>
        <div className="hero-cta reveal">
          <a className="btn btn-ghost" href="#subscribe" style={{ color:"var(--gold-lg)", borderColor:"var(--gold-lg)" }}>
            免費訂閱簡報　直送信箱
          </a>
        </div>
      </header>

      <div className="wrap">
        {/* 市場溫度儀表板 */}
        <section id="dashboard">
          <div className="eyebrow reveal">Market Temperature</div>
          <h2 className="reveal">市場溫度儀表板</h2>
          <div className="card reveal" style={{ padding:"calc(24px*var(--scale))" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:"calc(18px*var(--scale))" }}>
              <div style={{ fontWeight:600, fontSize:"calc(15px*var(--scale))" }}>市場溫度</div>
              <a href={latest["市場觀察"]?.file ? BASE + "/-/" + encodeURIComponent(latest["市場觀察"].file) : BASE + "/-/"}
                style={{ fontSize:"calc(12px*var(--scale))", color:"var(--accent)" }}>完整市場觀察 →</a>
            </div>
            {d.temp.map(t => <TempBar key={t.name} {...t} />)}
          </div>
          <div className="dash-note reveal"><span>{d.updated}</span>簡報發布時同步更新。</div>
        </section>

        {/* 最新研究 */}
        <section id="research">
          <div className="eyebrow reveal">Research</div>
          <h2 className="reveal">最新研究</h2>
          <div className="grid3">
            {CATS.map(c => {
              const e = latest[c.key];
              const has = e && e.file;
              const href = has ? BASE + "/-/" + encodeURIComponent(e.file) : BASE + "/-/";
              const desc = has && e.summary && e.summary.indexOf("占位") === -1 ? e.summary : c.desc;
              const go   = has && e.date ? `閱讀最新(${e.date})→` : "閱讀最新 →";
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
          <div style={{ textAlign:"center", marginTop:"calc(28px*var(--scale))" }}>
            <a className="btn btn-ghost" href="/archive">瀏覽全部報告 →</a>
          </div>
        </section>

        {/* 總經景氣位階 */}
        <section id="cycle">
          <div className="eyebrow reveal">Macro Cycle</div>
          <h2 className="reveal">總經景氣位階</h2>
          <div className="card reveal" style={{ padding:"calc(28px*var(--scale))" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:"calc(20px*var(--scale))" }}>
              <div style={{ fontWeight:600, fontSize:"calc(15px*var(--scale))" }}>市場位階總覽</div>
              <a href={latest["總經"]?.file ? BASE + "/-/" + encodeURIComponent(latest["總經"].file) : BASE + "/-/"}
                style={{ fontSize:"calc(12px*var(--scale))", color:"var(--accent)" }}>完整總經報告 →</a>
            </div>
            <CycleTempBar />
            <MfgTempBar />
            <MarketWaveSvg />
          </div>
        </section>

        {/* AI 泡沫監測 */}
        <section id="bubble">
          <div className="eyebrow reveal">AI Bubble Monitor</div>
          <h2 className="reveal">AI 泡沫監測</h2>
          <div className="card reveal" style={{ padding:"calc(28px*var(--scale))" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:"calc(18px*var(--scale))" }}>
              <div style={{ fontWeight:600, fontSize:"calc(15px*var(--scale))" }}>崩盤風險區（75/100）</div>
              <a href={d.bUrl} style={{ fontSize:"calc(12px*var(--scale))", color:"var(--accent)" }}>完整評估 →</a>
            </div>
            <BubbleScoreBar score={d.bScore} note={d.bNote} />
          </div>
        </section>

        {/* 訂閱 */}
        <section id="subscribe">
          <div className="sub-box">
            <div className="eyebrow reveal">Newsletter</div>
            <h2 className="reveal">市場簡報  直送信箱</h2>
            <p className="reveal">
  盤後解碼{"\u00A0\u00A0\u00A0"}洞察無價
  <br />
  每個交易日 收到一封真正值得閱讀的市場研究。
</p>
            <div className="sub-form reveal">
              <input type="email" placeholder="you@example.com" aria-label="Email"
                value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&subscribe()}/>
              <button className="btn btn-gold" onClick={subscribe}>免費訂閱</button>
            </div>
            <div className="sub-msg" role="status" style={{ color:msg.ok?"var(--green)":"var(--red)" }}>{msg.text}</div>
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
            免責聲明:本站所有內容僅為個人研究記錄與資訊分享,不構成任何投資建議或買賣邀約。投資有風險,任何決策請自行判斷並承擔結果。數據來源力求準確,但不保證即時與完整。<br/>© 2026 Yoda Research
          </div>
        </div>
      </footer>
    </>
  );
}
