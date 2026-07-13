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
  { key: "市場觀察", tag: "每日", title: "市場觀察", desc: "三區塊驅動力矩陣、板塊輪動、主線聚焦與多空劇本。" },
  { key: "美股", tag: "每日", title: "美股分析", desc: "REL5 / REL20 / WA 三層篩選,A 級強勢股與輪漲偵測。" },
  { key: "台股", tag: "每日", title: "台股分析", desc: "強勢股篩選疊加法人籌碼四型態:吸籌、反轉、換手、警示。" },
  { key: "AI泡沫", tag: "週更", title: "AI 泡沫評估", desc: "8 維度加權相似度 + ROI 缺口模型,量化這輪牛市的泡沫程度。" },
  { key: "總經", tag: "月更", title: "總體經濟", desc: "Fed、通膨、就業與景氣循環的監控儀表板。" },
  { key: "簡報", tag: "不定期", title: "公開簡報", desc: "一到兩屏讀完的白話市場摘要,附深讀連結。" },
];

const DEFAULTS = {
  sig: ["綠燈", "var(--green)"],
  sigNote: "新資金週期進行中",
  vix: "16.4",
  spx: "7,380",
  anchor: "5Y 均值 P/E 錨:6,945",
  hl: [167, 122],
  breadth: "廣度確認:偏多",
  updated: "數據更新:2026-07-11 收盤。",
  bScore: "6.2",
  bHeadline: "估值偏熱,但 ROI 缺口尚未斷裂",
  bUrl: BASE + "/-/",
};

export default function Home() {
  const [d, setD] = useState(DEFAULTS);
  const [latest, setLatest] = useState({});
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState({ text: "", ok: true });

  // reports.json 動態載入(失敗則保留內建預設值)
  useEffect(() => {
    fetch(BASE + "/-/reports.json", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw 0;
        return r.json();
      })
      .then((data) => {
        try {
          const db = data.dashboard || {};
          const next = { ...DEFAULTS };
          if (db.signal && SIG_MAP[db.signal]) next.sig = SIG_MAP[db.signal];
          if (db.signal_note) next.sigNote = db.signal_note;
          if (db.vix != null) next.vix = String(db.vix);
          if (db.spx != null) next.spx = Number(db.spx).toLocaleString();
          if (db.spx_anchor_5y != null)
            next.anchor = "5Y 均值 P/E 錨:" + Number(db.spx_anchor_5y).toLocaleString();
          if (db.high_low) next.hl = db.high_low;
          if (db.breadth_note) next.breadth = db.breadth_note;
          if (data.updated) next.updated = "數據更新:" + data.updated + "。";
          const bb = data.bubble || {};
          if (bb.score != null) next.bScore = String(bb.score);
          if (bb.headline) next.bHeadline = bb.headline;
          if (bb.url) next.bUrl = bb.url;
          setD(next);
          setLatest(data.latest || {});
        } catch (e) {}
      })
      .catch(() => {
        /* 離線或未部署:維持內建預設 */
      });
  }, []);

  // 滾動漸入
  useEffect(() => {
    const io = new IntersectionObserver(
      (es) => {
        es.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const subscribe = () => {
    const v = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
      setMsg({ text: "請輸入有效的 Email", ok: false });
      return;
    }
    setMsg({ text: "正在前往訂閱確認頁…", ok: true });
    window.open(SUBSTACK + "/subscribe?email=" + encodeURIComponent(v), "_blank");
  };

  return (
    <>
      {/* 1. Hero */}
      <header className="hero">
        <h1 className="reveal">
          Yoda <span className="gold">Research</span>
        </h1>
        <p className="reveal">用可證偽的判斷,追蹤美股與台股的真實訊號</p>
        <div className="hero-cta reveal">
          <a className="btn btn-gold" href="https://yoda-wcyc.github.io/-/">
            今日簡報
          </a>
          <a className="btn btn-ghost" href="#subscribe">
            訂閱電子報
          </a>
        </div>
      </header>

      <div className="wrap">
        {/* 2. 今日市場儀表板 */}
        <section id="dashboard">
          <div className="eyebrow reveal">Market Dashboard</div>
          <h2 className="reveal">今日市場儀表板</h2>
          <div className="dash">
            <div className="card reveal">
              <div className="lbl">市場信號燈</div>
              <div className="val">
                <span className="sig-dot" style={{ background: d.sig[1] }}></span>
                <span>{d.sig[0]}</span>
              </div>
              <div className="sub">{d.sigNote}</div>
            </div>
            <div className="card reveal">
              <div className="lbl">VIX 恐慌指數</div>
              <div className="val">{d.vix}</div>
              <div className="sub">低波動區間</div>
            </div>
            <div className="card reveal">
              <div className="lbl">S&amp;P 500 vs 估值錨</div>
              <div className="val">{d.spx}</div>
              <div className="sub">{d.anchor}</div>
            </div>
            <div className="card reveal">
              <div className="lbl">52週 新高／新低</div>
              <div className="val">
                {d.hl[0]} <span style={{ color: "var(--dim)" }}>/</span> {d.hl[1]}
              </div>
              <div className="sub">{d.breadth}</div>
            </div>
          </div>
          <div className="dash-note reveal">
            <span>{d.updated}</span>簡報發布時同步更新。
          </div>
        </section>

        {/* 3. 最新研究 */}
        <section id="research">
          <div className="eyebrow reveal">Research</div>
          <h2 className="reveal">最新研究</h2>
          <div className="grid3">
            {CATS.map((c) => {
              const e = latest[c.key];
              const has = e && e.file;
              const href = has ? BASE + "/-/" + encodeURIComponent(e.file) : BASE + "/-/";
              const desc =
                has && e.summary && e.summary.indexOf("占位") === -1 ? e.summary : c.desc;
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
            <a className="btn btn-ghost" href="/archive">
              瀏覽全部報告 →
            </a>
          </div>
        </section>

        {/* 4. AI Bubble Monitor */}
        <section id="bubble">
          <div className="eyebrow reveal">AI Bubble Monitor</div>
          <h2 className="reveal">AI 泡沫監測</h2>
          <div className="bubble reveal">
            <div className="gauge">
              <div className="num">{d.bScore}</div>
              <div className="of">/ 10</div>
            </div>
            <div>
              <h3>{d.bHeadline}</h3>
              <p>
                以八個維度對照歷史泡沫的相似度計算,目前處於「擴張後期」而非「崩解前夕」。企業資本支出與實際回報的缺口是最需要盯的變數。
              </p>
              <a href={d.bUrl}>查看完整評估 →</a>
            </div>
          </div>
        </section>

        {/* 5. 訂閱 CTA */}
        <section id="subscribe">
          <div className="sub-box">
            <div className="eyebrow reveal">Newsletter</div>
            <h2 className="reveal">市場簡報,直送信箱</h2>
            <p className="reveal">盤後解碼,洞察無價,簡報永久免費訂閱。</p>
            <div className="sub-form reveal">
              <input
                type="email"
                placeholder="you@example.com"
                aria-label="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && subscribe()}
              />
              <button className="btn btn-gold" onClick={subscribe}>
                免費訂閱
              </button>
            </div>
            <div
              className="sub-msg"
              role="status"
              style={{ color: msg.ok ? "var(--green)" : "var(--red)" }}
            >
              {msg.text}
            </div>
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
            免責聲明:本站所有內容僅為個人研究記錄與資訊分享,不構成任何投資建議或買賣邀約。投資有風險,任何決策請自行判斷並承擔結果。數據來源力求準確,但不保證即時與完整。
            <br />© 2026 Yoda Research
          </div>
        </div>
      </footer>
    </>
  );
}
