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
  { key: "專題",    tag: "不定期",  title: "專題研究",   desc: "單一主題深度分析：動能因子、事件驅動、產業結構與市場機制拆解。" },
];

/* ── 判斷紀錄 track record（覆盤 2026-08-02；資料靜態，不吃 reports.json）── */
const RC = { "✅":"var(--green)", "❌":"var(--red)", "➖":"var(--yellow)", "⏸":"var(--dim)" };
const TRACK = {
  asOf: "2026-08-02",
  overall: { rate: 56, total: 8, note: "✅ 命中 ×4　➖ 部分 ×1　❌ 未達 ×3　·　⏸ 條件未觸發 ×3（不計入）" },
  cats: [
    { name: "事件反應", w: "2 / 3" },
    { name: "廣度轉折", w: "1.5 / 3" },
    { name: "殖利率方向", w: "1 / 1" },
    { name: "板塊輪動", w: "0 / 1" },
  ],
  // 依登錄日降序（最新在上）；d=登錄日、v=到期驗證日
  items: [
    { d:"7/10", v:"7/15", r:"✅", t:"CPI 當天先別追，等隔天看清楚再說", c:"事件反應", note:"公布前市場 Call 買到爆、樂觀到有點過頭；我們選擇不追。結果 7/16–17 一路反轉下殺，這個『先按住手』的紀律剛好躲過。" },
    { d:"7/10", v:"7/14", r:"✅", t:"CPI 前，US10Y 會守在 4.50–4.57%、不破 4.60%", c:"殖利率方向", note:"整段就黏在 4.55–4.57% 這個窄帶裡，沒有往上失控，最關鍵的那道利率防線守住了。" },
    { d:"7/09", v:"7/14", r:"❌", t:"SP20、RSP、SOXX 三條件湊齊，就是底部、可以加碼", c:"廣度轉折", note:"三個條件週中一度真的到齊，但那是假底——兩天內全部吐回、NQ 廣度還跌破 50%。照這訊號加碼會挨刀，這次最該記住。" },
    { d:"7/09", v:"7/14", r:"❌", t:"SOXX 五日翻正，就升格成強勢主線", c:"板塊輪動", note:"五日是翻正沒錯，但同一天月線又翻回負，之後 SOXX 一路深跌，根本沒站穩。升格沒發生。" },
    { d:"7/09", v:"7/10", r:"✅", t:"IWM 月線再翻負，廣度架構就正式降一級", c:"廣度轉折", note:"隔天 IWM 月線果然翻負，撐盤的最後一條腿也倒了，該降的級如期降。這條是高信心，也真的中了。" },
    { d:"7/08", v:"7/14", r:"❌", t:"CPI 只要溫和，QQQ 就會上攻 740–750", c:"事件反應", note:"價位是看錯了——CPI 真的溫和，QQQ 卻不漲反跌到 695。但這個『錯』本身就是最強的訊號：利多都出來了還跌，正是天秤在喊偏空（利多不漲＝賣壓在後面等），事後看就是那波轉折的起點。判斷失手，卻讀到了對的方向。" },
    { d:"7/08", v:"7/10", r:"➖", t:"MDY 跟 RSP 月線一起翻負，廣度就往 S−/M− 降", c:"廣度轉折", note:"兩個條件確實都到位、架構也照降了；只是那幾天回調沒有立刻擴大，市場短線還撐著，所以只能算對一半。" },
    { d:"7/08", v:"7/14", r:"⏸", t:"US10Y 在 CPI 前，自己回落到 4.527% 以下", c:"殖利率方向", note:"一樣沒回落到那，條件沒成立，不計入。" },
    { d:"7/07", v:"7/10", r:"⏸", t:"US10Y 在紀要後兩天內，收復到 4.527% 以下", c:"殖利率方向", note:"US10Y 沒收復到那個位置，設定的條件沒被觸發，不計入。" },
    { d:"7/07", v:"7/14", r:"⏸", t:"SOXX 沒回收的話，QQQ 會被拖去測 675–690", c:"板塊輪動", note:"但 SOXX 提早就自己回收了，前提根本沒成立，所以這條不列入計分。" },
    { d:"6/29", v:"7/15", r:"✅", t:"6/27–30 那波是技術性賣壓，不是基本面壞掉", c:"事件反應", note:"整段期間信用利差都穩穩的、沒有異常，代表底層沒破洞；7 月一開月，市場也照著回神了。" },
  ],
};

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
  heroNote: "",
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
  const [showGuide, setShowGuide] = useState(false);

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
          if (db.hero_note) next.heroNote = db.hero_note;
          if (data.updated) next.updated = "數據更新:" + data.updated + "。";
          const bb = data.bubble || {};
          if (bb.score != null) next.bScore = Number(bb.score);
          if (bb.note)  next.bNote = bb.note;
          if (bb.url)   next.bUrl  = bb.url;
          const lt = data.latest || {};
          if (lt["簡報"]?.file) next.latestBrief = BASE + "/-/" + lt["簡報"].file;
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

  const doSubscribe = () => {
    window.open(SUBSTACK + "/subscribe?email=" + encodeURIComponent(email.trim()), "_blank");
    setShowGuide(false);
  };
  const subscribe = () => {
    const v = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { setMsg({ text:"請輸入有效的 Email", ok:false }); return; }
    setMsg({ text:"", ok:true });
    setShowGuide(true);
  };

  return (
    <>
      {/* Hero */}
      <header className="hero">
        <h1 className="reveal hero-title"><span className="sr-only">Yoda Research</span></h1>
        {d.heroNote ? (
          <p className="reveal" style={{ fontSize:"calc(17px*var(--scale))", color:"var(--gold-lg)", marginBottom:4 }}>{d.heroNote}</p>
        ) : null}
       <p className="reveal">
  用最清澈的白話，凌駕喧囂
  <br />
  解碼美股與台股的真實訊號
</p>
        <div className="hero-cta reveal" style={{ flexDirection:"column", gap:"14px" }}>
          <a className="btn btn-gold" href={d.latestBrief} style={{ minWidth:220 }}>
            今日簡報
          </a>
          <a className="btn btn-ghost" href="#subscribe" style={{ color:"var(--gold-lg)", borderColor:"var(--gold-lg)", minWidth:220 }}>
            免費訂閱簡報　直送信箱
          </a>
        </div>
      <div style={{ position:"fixed", bottom:"18px", left:0, right:0, textAlign:"center", pointerEvents:"none", zIndex:50 }}>
          <span style={{ fontSize:"calc(24px*var(--scale))", color:"var(--gold-lg)", opacity:.75, display:"block", lineHeight:1, animation:"arrow-bob 2s ease-in-out infinite" }}>⌄</span>
          <span style={{ fontSize:"calc(24px*var(--scale))", color:"var(--gold-lg)", opacity:.45, display:"block", lineHeight:1, marginTop:"-8px", animation:"arrow-bob 2s ease-in-out infinite", animationDelay:"0.15s" }}>⌄</span>
          <span style={{ fontSize:"calc(24px*var(--scale))", color:"var(--gold-lg)", opacity:.2, display:"block", lineHeight:1, marginTop:"-8px", animation:"arrow-bob 2s ease-in-out infinite", animationDelay:"0.3s" }}>⌄</span>
        </div>
      </header>

      <div className="wrap">

{/* Manifesto */}
<section id="manifesto" style={{ borderLeft: "3px solid #e0a526", paddingLeft: "2rem", margin: "calc(48px*var(--scale)) 0" }}>

  

  <div style={{ paddingTop: "1.5rem", borderTop: "0.5px solid var(--border)", textAlign: "center" }}>
    <p style={{ fontSize: "calc(16px*var(--scale))", lineHeight: 1.9, color: "var(--text)", fontWeight: 500, margin: "0 0 0.4rem" }}>這裡不做預言，只做一件事：告訴你該踩油門，還是踩煞車。</p>
    <p style={{ fontSize: "calc(16px*var(--scale))", lineHeight: 1.9, color: "var(--dim)", margin: "0 0 1.6rem" }}>因為股市沒有答案，只有地圖。這裡適不適合你，玩一次就知道。</p>
    <a href="https://yoda-wcyc.github.io/game/answer-or-map.html"
       target="_blank" rel="noopener noreferrer"
       style={{ display: "inline-block", padding: "0.95rem 2.8rem", borderRadius: 8,
         background: "#e0a526", color: "#080b10", fontWeight: 700,
         fontSize: "calc(16px*var(--scale))", letterSpacing: "0.02em", textDecoration: "none",
         boxShadow: "0 4px 20px rgba(224,165,38,.35)", transition: "transform .18s, box-shadow .18s" }}
       onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 6px 26px rgba(224,165,38,.5)"; }}
       onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 4px 20px rgba(224,165,38,.35)"; }}>
      🎮 玩玩看，你適不適合這裡 →
    </a>
  </div>

</section>

        {/* 市場溫度儀表板 */}
        <section id="dashboard">
          <br />
          <br />
          <div className="eyebrow reveal">Market Temperature</div>
          <h2 className="reveal">市場溫度儀表板</h2>
          <div className="card reveal" style={{ padding:"calc(24px*var(--scale))" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:"calc(18px*var(--scale))" }}>
              <div style={{ fontWeight:600, fontSize:"calc(15px*var(--scale))" }}>市場溫度</div>
              <a href={latest["市場觀察"]?.file ? BASE + "/-/" + latest["市場觀察"].file : BASE + "/-/"}
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
              const href = has ? BASE + "/-/" + e.file : BASE + "/-/";
              const desc = has && e.summary && e.summary.indexOf("占位") === -1 ? e.summary : c.desc;
              const go   = has && e.date ? `閱讀最新(${e.date})→` : "閱讀最新 →";
              return (
                <a key={c.key} className="card cat reveal" href={href}>
                  <span className="tag">{c.tag}</span>
                  <h3>{c.title}<span className="ttl-arrow" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></span></h3>
                  <p>{desc}</p>
                  <span className="go">{go}</span>
                </a>
              );
            })}
            {/* 遊戲庫（固定卡片，不吃 latest 動態資料） */}
            <a className="card cat reveal"
               href="https://yoda-wcyc.github.io/game/"
               target="_blank" rel="noopener noreferrer">
              <span className="tag">玩玩看</span>
              <h3>🎮 遊戲庫<span className="ttl-arrow" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></span></h3>
              <p>用遊戲體會投資世界裡的道理與心法。</p>
              <span className="go">進遊戲庫 →</span>
            </a>
          </div>
          <div style={{ textAlign:"center", marginTop:"calc(28px*var(--scale))" }}>
            <a className="btn btn-ghost" href="/archive">瀏覽全部報告 →</a>
          </div>
        </section>

        {/* 判斷紀錄 Track Record */}
        <section id="track">
          <div className="eyebrow reveal">Track Record</div>
          <h2 className="reveal">判斷紀錄</h2>
          <p className="reveal" style={{ fontSize:"calc(16px*var(--scale))", color:"var(--dim)", lineHeight:1.85, maxWidth:760, marginBottom:"calc(24px*var(--scale))" }}>
            我們每天在報告裡下的判斷，都寫成有明確方向、有時間窗、事後能對答案的樣子。這裡就是到期之後、一條一條翻出來對過的成績單——不是挑好看的講，是連沒中的也擺在同一張表上。
          </p>
          <div className="card reveal" style={{ padding:"calc(28px*var(--scale))" }}>

            {/* 標頭：整體命中 */}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:"12px 20px", marginBottom:"calc(4px*var(--scale))" }}>
              <div style={{ display:"flex", alignItems:"baseline", gap:14 }}>
                <span style={{ fontSize:"calc(52px*var(--scale))", fontWeight:700, letterSpacing:"-.02em", color:"var(--gold-lg)", lineHeight:1 }}>{TRACK.overall.rate}%</span>
                <span style={{ fontSize:"calc(15px*var(--scale))", color:"var(--dim)", lineHeight:1.4 }}>整體命中率<br/>{TRACK.overall.total} 條已到期驗證</span>
              </div>
              <span style={{ fontSize:"calc(14px*var(--scale))", color:"var(--text)", fontWeight:600 }}>對的、錯的，全部攤開</span>
            </div>
            <div style={{ fontSize:"calc(12px*var(--scale))", color:"var(--dim)", marginBottom:"calc(24px*var(--scale))" }}>{TRACK.overall.note}</div>

            {/* 四類命中 */}
            <div className="dash" style={{ marginBottom:"calc(24px*var(--scale))" }}>
              {TRACK.cats.map(c => (
                <div key={c.name} style={{ background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:12, padding:"calc(14px*var(--scale))" }}>
                  <div style={{ fontSize:"calc(11px*var(--scale))", color:"var(--dim)", letterSpacing:".04em", marginBottom:6 }}>{c.name}</div>
                  <div style={{ fontSize:"calc(22px*var(--scale))", fontWeight:700, letterSpacing:"-.01em" }}>{c.w}</div>
                </div>
              ))}
            </div>

            {/* 逐條判斷（依時間排序；左欄＝登錄日／驗證日）*/}
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {TRACK.items.map((it,i) => (
                <div key={i} style={{ display:"flex", gap:12, alignItems:"flex-start", padding:"calc(11px*var(--scale)) calc(13px*var(--scale))", background:"var(--surface2)", borderLeft:`3px solid ${RC[it.r]}`, borderRadius:"0 8px 8px 0" }}>
                  <div style={{ width:"calc(46px*var(--scale))", flexShrink:0, textAlign:"right", lineHeight:1.35, paddingTop:1 }}>
                    <div style={{ fontSize:"calc(13px*var(--scale))", fontWeight:700, color:"var(--text)" }}>{it.d}</div>
                    <div style={{ fontSize:"calc(10px*var(--scale))", color:"var(--dim)" }}>驗 {it.v}</div>
                  </div>
                  <span style={{ fontSize:"calc(15px*var(--scale))", lineHeight:1.5, flexShrink:0 }}>{it.r}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:"calc(14px*var(--scale))", fontWeight:600, lineHeight:1.55 }}>{it.t}</div>
                    <div style={{ fontSize:"calc(12.5px*var(--scale))", color:"var(--dim)", marginTop:3, lineHeight:1.65 }}>
                      <span style={{ color:RC[it.r], fontWeight:700 }}>{it.c}</span>　{it.note}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* 概念鉤子：落底訊號遊戲（飛輪 §0-4，接「假底」那一條）*/}
            <a href="https://yoda-wcyc.github.io/game/%E8%90%BD%E5%BA%95%E8%A8%8A%E8%99%9F-20260729.html"
               target="_blank" rel="noopener noreferrer"
               style={{ display:"inline-flex", alignItems:"center", gap:8, marginTop:"calc(18px*var(--scale))",
                 padding:"calc(10px*var(--scale)) calc(18px*var(--scale))", borderRadius:9999,
                 background:"var(--surface2)", border:"1px solid var(--gold-dim)", color:"var(--gold-lg)",
                 fontSize:"calc(13px*var(--scale))", fontWeight:600, textDecoration:"none" }}>
              🎮 這張表最痛的一條，是把「假底」當成真底——玩〈落底訊號〉，練怎麼分 →
            </a>

            <div style={{ fontSize:"calc(12px*var(--scale))", color:"var(--dim)", marginTop:"calc(20px*var(--scale))", lineHeight:1.75 }}>
              ▸ 這些判斷都是在報告當下就寫死的，一條方向配一個時間窗；時間到了用實際行情對答案：✅ 命中、➖ 部分對、❌ 沒中、⏸ 當初設的條件根本沒發生、所以不計分。寫過的一律留著、不回頭改一個字。截至 {TRACK.asOf}。
            </div>
          </div>
        </section>

        {/* 總經景氣位階 */}
        <section id="cycle">
          <div className="eyebrow reveal">Macro Cycle</div>
          <h2 className="reveal">總經景氣位階</h2>
          <div className="card reveal" style={{ padding:"calc(28px*var(--scale))" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:"calc(20px*var(--scale))" }}>
              <div style={{ fontWeight:600, fontSize:"calc(15px*var(--scale))" }}>市場位階總覽</div>
              <a href={latest["總經"]?.file ? BASE + "/-/" + latest["總經"].file : BASE + "/-/"}
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
          <div className="score-bar-section reveal">
            <div className="score-bar-header">
              <div className="score-bar-header-title">崩盤風險區（75/100）</div>
              <a href="https://yoda-wcyc.github.io/-/AI%E6%B3%A1%E6%B2%AB%E8%A9%95%E4%BC%B0%E8%A1%A8_20260701.html"
                style={{ fontSize:"calc(12px*var(--scale))", color:"var(--accent)" }}>完整評估 →</a>
            </div>
            <div className="score-bar-label-row">
              <span className="score-bar-label sbl-safe">🟢 理性成長</span>
              <span className="score-bar-label sbl-caution">🔵 溫和過熱</span>
              <span className="score-bar-label sbl-warn">🟡 泡沫警戒</span>
              <span className="score-bar-label sbl-bubble">🔴 崩盤風險</span>
            </div>
            <div className="score-bar-track">
              <div className="score-zone-div" style={{left:"25%"}}></div>
              <div className="score-zone-div" style={{left:"50%"}}></div>
              <div className="score-zone-div" style={{left:"75%"}}></div>
              <div className="score-pointer" style={{left:"75%"}}>
                <div className="score-pointer-label">當前 75/100</div>
                <div className="score-pointer-dot"></div>
              </div>
            </div>
            <div className="score-bar-footer">
              <span>0 — 基本面完全支撐</span>
              <span>25 — 估值略偏高</span>
              <span>50 — 泡沫特徵明顯</span>
              <span>75+ — 崩盤前夕</span>
            </div>
            <div className="score-note">▸ PEG 0.73 與 EPS +28.6% 提供盈餘緩衝，但 CAPE 40.3x、巴菲特指標 236%、Mag-7 集中度 33.8%、CapEx ROI 缺口 -$1,850 億四重警示同步亮燈，Oracle FY2026 已實際轉負 FCF -$237 億，BofA 泡沫風險指標逼近 0.8 警戒線且 Kospi/Nikkei 已進入極端區，歷史相似度同步跳升至「極高相似」區間（0.96/0.92）。情緒面雖轉向恐慌（CNN F&G 28），但市場結構/機構持倉訊號仍持續惡化。</div>
          </div>
        </section>

        {/* 訂閱 */}
        <section id="subscribe">
          <div className="sub-box">
            <div className="eyebrow reveal">Newsletter</div>
            <h2 className="reveal">市場簡報&ensp;&ensp;直送信箱</h2>
            <p className="reveal">盤後解碼&ensp;洞察無價&ensp;簡報永久免費訂閱。</p>
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

      {/* 訂閱引導 Modal */}
      {showGuide && (
        <div onClick={()=>setShowGuide(false)}
          style={{ position:"fixed", inset:0, zIndex:300, background:"rgba(0,0,0,.65)",
            backdropFilter:"blur(4px)", display:"flex", alignItems:"center",
            justifyContent:"center", padding:24 }}>
          <div onClick={e=>e.stopPropagation()}
            style={{ background:"var(--surface)", border:"1px solid var(--border)",
              borderRadius:18, padding:"calc(28px*var(--scale))", maxWidth:440, width:"100%" }}>
            <div style={{ fontWeight:700, fontSize:"calc(19px*var(--scale))", marginBottom:16 }}>
              訂閱步驟
            </div>
            <ol style={{ paddingLeft:"1.3em", fontSize:"calc(15px*var(--scale))", lineHeight:2, color:"var(--text)" }}>
              <li>點下方「前往訂閱」，會開啟 Substack 訂閱頁</li>
              <li>在頁面上按下 <b>Subscribe</b> 即完成</li>
              <li>前往信箱確認訂閱信，點一下確認連結</li>
              <li>之後每次發布簡報，會直接寄到你的信箱</li>
            </ol>
            <div style={{ fontSize:"calc(13px*var(--scale))", color:"var(--dim)", margin:"12px 0 20px", lineHeight:1.8 }}>
              ✦ 不需要安裝 Substack App，也不需要建立帳號<br/>
              ✦ 隨時可以取消訂閱，完全免費
            </div>
            <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
              <button className="btn btn-gold" style={{ flex:1 }} onClick={doSubscribe}>
                前往訂閱 →
              </button>
              <button className="btn btn-ghost" style={{ flex:1 }} onClick={()=>setShowGuide(false)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      <footer>
        <div className="wrap">
          <div className="links">
            <a href="https://www.facebook.com/profile.php?id=100069223220386" target="_blank" rel="noopener"
               style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"5px 14px", background:"#1a3a5c", border:"1px solid #2a4a6c", borderRadius:9999, color:"#e8f2ff", fontWeight:700, textDecoration:"none", fontSize:"calc(13px*var(--scale))", letterSpacing:".02em" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink:0 }}><path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.235 2.686.235v2.97h-1.513c-1.491 0-1.956.93-1.956 1.874v2.25h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/></svg>
              粉專
            </a>
                      </div>
          <div className="disc">
            免責聲明:本站所有內容僅為個人研究記錄與資訊分享,不構成任何投資建議或買賣邀約。投資有風險,任何決策請自行判斷並承擔結果。數據來源力求準確,但不保證即時與完整。<br/>© 2026 Yoda Research
          </div>
        </div>
      </footer>
    </>
  );
}
