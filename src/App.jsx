import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from "react";

/* ──────────────────────────────────────────────────────────
   AI 활동지 메이커 (배포용 · BYOK)
   - 주제(차시 제목)만 넣으면 어울리는 활동 3~5개를 자동 구성
   - 미리보기·출력 모두 정확한 A4(210×297mm) 페이지 단위로 자동 분할
   - PDF 저장: html2pdf.js(클라이언트 생성)라 어디서든 파일로 저장 가능
   - 인쇄: 브라우저 인쇄 대화상자
   ────────────────────────────────────────────────────────── */

const GRADES = [1, 2, 3, 4, 5, 6];
const SUBJECTS = ["국어", "수학", "사회", "과학", "영어", "실과", "도덕", "음악", "미술", "체육", "통합교과", "창체"];
const LEVELS = ["기초", "보통", "심화"];
const EXTRAS = [
  { key: "game", label: "놀이·게임 요소" },
  { key: "pair", label: "짝·모둠 활동 포함" },
  { key: "draw", label: "그리기 활동 포함" },
  { key: "realLife", label: "실생활과 연결" },
];
const HEAD_FIELDS = [
  { key: "school", label: "학교칸" },
  { key: "ban", label: "반칸" },
  { key: "beon", label: "번칸" },
  { key: "name", label: "이름칸" },
  { key: "date", label: "날짜칸" },
  { key: "score", label: "점수칸" },
  { key: "stamp", label: "확인칸" },
];

const DEFAULT_OPTS = {
  grade: 3,
  subject: "사회",
  topic: "",
  intent: "",
  level: "보통",
  count: 4,
  extras: { game: false, pair: false, draw: false, realLife: false },
  design: {
    title: "",
    fields: { school: false, ban: true, beon: true, name: true, date: false, score: false, stamp: false },
  },
};

/* ── 저장소: LocalStorage 우선, 막힌 환경에선 대체 저장소 ── */
const mem = {};
async function loadKey(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    if (v != null) return JSON.parse(v);
  } catch { /* localStorage 차단 환경 */ }
  try {
    const r = await window.storage.get(key);
    if (r && r.value) return JSON.parse(r.value);
  } catch {}
  return key in mem ? mem[key] : fallback;
}
async function saveKey(key, value) {
  mem[key] = value;
  try { localStorage.setItem(key, JSON.stringify(value)); return; } catch {}
  try { await window.storage.set(key, JSON.stringify(value)); } catch {}
}

/* ── html2pdf 로더 (cdnjs) ── */
function ensureHtml2pdf() {
  if (window.html2pdf) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("PDFLIB"));
    document.head.appendChild(s);
  });
}

/* ── 프롬프트 ── */
function buildPrompt(opts, count) {
  const extras = EXTRAS.filter((e) => opts.extras[e.key]).map((e) => e.label);
  const lines = [
    `당신은 대한민국 초등학교 ${opts.grade}학년 담임교사이자 수업 설계 전문가입니다.`,
    `아래 차시에 어울리는 '활동지'를 설계해 주세요. 문제집이 아니라, 학생이 쓰고 그리고 이야기하며 참여하는 활동 중심 학습지입니다.`,
    ``,
    `[수업 정보]`,
    `- 학년: ${opts.grade}학년`,
    `- 과목: ${opts.subject}`,
    `- 주제(차시 제목): ${opts.topic}`,
    opts.intent ? `- 수업 의도·성취기준: ${opts.intent}` : null,
    `- 수준: ${opts.level}`,
    `- 활동 수: ${count}개`,
    extras.length ? `- 반영할 요소: ${extras.join(", ")}` : null,
    ``,
    `[설계 원칙]`,
    `- 활동들은 생각 열기 → 탐구·표현 → 정리·나눔의 자연스러운 흐름을 이루도록 배치`,
    `- 활동마다 형태(layout)가 서로 다르게, 40분 차시 안에 A4 1~2장으로 가능한 분량`,
    `- 안내문(instruction)은 ${opts.grade}학년이 혼자 읽고 이해할 수 있는 쉽고 다정한 말로 1~2문장 ("~해 보세요" 문체)`,
    `- 2022 개정 교육과정 수준을 지키고 오개념 표현 금지`,
    `- tip은 교사를 위한 구체적 지도 팁 1~2문장, example은 학생 반응 예시 답안 1~2문장`,
    ``,
    `[layout 종류 — 활동 성격에 맞는 것을 하나씩 선택]`,
    `- "write": 글로 쓰는 활동. lines(밑줄 줄 수, 3~6) 지정`,
    `- "draw": 그리기·꾸미기 활동. 빈 그리기 칸 제공`,
    `- "table": 표 채우기. columns(열 제목 배열 2~3개), rows(빈 줄 수 2~4) 지정`,
    `- "mindmap": 생각 그물. center(가운데 낱말), branches(빈 가지 수 4~6) 지정`,
    `- "checklist": 항목 점검·고르기. items(항목 문장 배열 3~5개) 지정`,
    `- "pair": 짝 토의. 내 생각/짝 생각을 나누어 적는 칸 제공`,
    ``,
    `[출력 형식] 아래 JSON만 출력하세요. 코드블록·설명·머리말 금지.`,
    `{"activities":[{"title":"활동 이름(짧고 재미있게)","goal":"이 활동의 목표 한 줄","instruction":"학생 안내문","layout":{"type":"write","lines":4,"columns":[],"rows":0,"center":"","branches":0,"items":[]},"tip":"교사 지도 팁","example":"예시 답안"}]}`,
    `- layout에서 해당 type에 필요 없는 값은 빈 배열/0/빈 문자열로 두세요.`,
  ];
  return lines.filter(Boolean).join("\n");
}

/* ── 응답 텍스트 → activities 배열 ── */
function parseActivities(text) {
  const clean = String(text).replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("JSON 파싱 실패");
  const parsed = JSON.parse(clean.slice(start, end + 1));
  if (!Array.isArray(parsed.activities)) throw new Error("activities 누락");
  return parsed.activities;
}

/* ── 활동 데이터 보정(누락 필드 기본값) ── */
function normalize(a, i) {
  const l = a.layout || {};
  const type = ["write", "draw", "table", "mindmap", "checklist", "pair"].includes(l.type) ? l.type : "write";
  return {
    number: i + 1,
    title: a.title || `활동 ${i + 1}`,
    goal: a.goal || "",
    instruction: a.instruction || "",
    tip: a.tip || "",
    example: a.example || "",
    layout: {
      type,
      lines: Math.min(Math.max(+l.lines || 4, 2), 8),
      columns: Array.isArray(l.columns) && l.columns.length ? l.columns.slice(0, 4) : ["구분", "내용"],
      rows: Math.min(Math.max(+l.rows || 3, 2), 5),
      center: l.center || "",
      branches: Math.min(Math.max(+l.branches || 5, 3), 6),
      items: Array.isArray(l.items) ? l.items.slice(0, 6) : [],
    },
  };
}

/* ── Gemini API ── */
async function callGemini(apiKey, model, prompt, signal) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.9, maxOutputTokens: 8192, responseMimeType: "application/json" },
      }),
    });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new Error("NETWORK");
  }
  if (!res.ok) {
    if (res.status === 400 || res.status === 403) throw new Error("BADKEY");
    if (res.status === 429) throw new Error("QUOTA");
    throw new Error(`Gemini 응답 오류 (${res.status})`);
  }
  const data = await res.json();
  const text = ((data.candidates || [])[0]?.content?.parts || []).map((p) => p.text || "").join("");
  if (!text) throw new Error("응답이 비어 있습니다");
  return text;
}

/* ── Claude 미리보기 (claude.ai 아티팩트 안에서만 동작) ── */
async function callClaude(prompt, signal) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`미리보기 API 오류 (${res.status})`);
  const data = await res.json();
  return (data.content || []).map((b) => (b.type === "text" ? b.text : "")).join("\n");
}

function friendlyError(e) {
  if (e.name === "AbortError") return "생성을 취소했습니다.";
  if (e.message === "BADKEY") return "API 키가 올바르지 않아요. 'API 설정'에서 키를 다시 확인해 주세요.";
  if (e.message === "QUOTA") return "오늘 사용량을 초과했어요. 잠시 후 다시 시도해 주세요.";
  if (e.message === "PDFLIB") return "PDF 도구를 불러오지 못했어요. 네트워크를 확인한 뒤 다시 시도해 주세요.";
  if (e.message === "NETWORK")
    return "네트워크 연결에 실패했어요. API 키와 인터넷 연결을 확인해 주세요.";
  return "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.";
}

/* ══════════════════════════ 메인 앱 ══════════════════════════ */
export default function App() {
  const [opts, setOpts] = useState(DEFAULT_OPTS);
  const [dark, setDark] = useState(false);
  const [tab, setTab] = useState("student");
  const [fitOnePage, setFitOnePage] = useState(true);
  const [activities, setActivities] = useState(null);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [history, setHistory] = useState([]);
  const [tplName, setTplName] = useState("");
  const [ready, setReady] = useState(false);

  const [apiKey, setApiKey] = useState("");
  const [provider, setProvider] = useState("gemini");
  const [model, setModel] = useState("gemini-2.0-flash");
  const [showSetup, setShowSetup] = useState(false);
  const [setupDone, setSetupDone] = useState(false);

  const abortRef = useRef(null);
  const tickRef = useRef(null);
  const pagesRef = useRef(null);

  useEffect(() => {
    (async () => {
      const api = await loadKey("awm:api", null);
      if (api) {
        setApiKey(api.key || "");
        setProvider(api.provider || "gemini");
        setModel(api.model || "gemini-2.0-flash");
        setSetupDone(true);
      }
      const saved = await loadKey("awm:settings", null);
      if (saved) {
        if (saved.opts) setOpts(mergeOpts(saved.opts));
        if (typeof saved.dark === "boolean") setDark(saved.dark);
        if (typeof saved.fitOnePage === "boolean") setFitOnePage(saved.fitOnePage);
      }
      setTemplates(await loadKey("awm:templates", []));
      setHistory(await loadKey("awm:history", []));
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => saveKey("awm:settings", { opts, dark, fitOnePage }), 600);
    return () => clearTimeout(t);
  }, [opts, dark, fitOnePage, ready]);

  const set = (patch) => setOpts((o) => ({ ...o, ...patch }));
  const setField = (k) =>
    setOpts((o) => ({ ...o, design: { ...o.design, fields: { ...o.design.fields, [k]: !o.design.fields[k] } } }));
  const setTitle = (title) => setOpts((o) => ({ ...o, design: { ...o.design, title } }));
  const toggleExtra = (k) => setOpts((o) => ({ ...o, extras: { ...o.extras, [k]: !o.extras[k] } }));

  const sheetTitle = opts.design.title || (opts.topic ? opts.topic : `${opts.subject} 활동지`);
  const promptPreview = useMemo(() => buildPrompt(opts, opts.count), [opts]);
  const needSetup = ready && !setupDone;

  /* ── 생성 ── */
  const generate = useCallback(async () => {
    if (!opts.topic.trim()) {
      setError("주제(차시 제목)를 먼저 입력해 주세요. 예: 우리 고장의 문화유산");
      return;
    }
    if (provider === "gemini" && !apiKey) {
      setShowSetup(true);
      return;
    }
    setError(null);
    setLoading(true);
    setProgress(0);
    setEditing(false);
    const controller = new AbortController();
    abortRef.current = controller;

    if (provider === "gemini") {
      tickRef.current = setInterval(() => setProgress((p) => Math.min(p + Math.ceil(Math.random() * 4), 92)), 350);
    }

    try {
      let all = [];
      if (provider === "gemini") {
        all = parseActivities(await callGemini(apiKey, model, buildPrompt(opts, opts.count), controller.signal));
      } else {
        /* Claude 미리보기: 응답 길이 제한이 있어 활동 2개씩 나눠 생성 */
        const CHUNK = 2;
        const chunks = [];
        for (let left = opts.count; left > 0; left -= CHUNK) chunks.push(Math.min(CHUNK, left));
        for (let i = 0; i < chunks.length; i++) {
          const prompt =
            buildPrompt(opts, chunks[i]) +
            (all.length
              ? `\n\n[이미 만든 활동 — 아래와 형태·내용이 겹치지 않게, 수업 흐름상 그 다음에 올 활동만 생성]\n` +
                all.map((a, idx) => `${idx + 1}. ${a.title} (${(a.layout || {}).type || ""})`).join("\n")
              : "");
          let acts;
          try {
            acts = parseActivities(await callClaude(prompt, controller.signal));
          } catch (e) {
            if (e.name === "AbortError") throw e;
            acts = parseActivities(await callClaude(prompt, controller.signal));
          }
          all.push(...acts.slice(0, chunks[i]));
          setProgress(Math.round(((i + 1) / chunks.length) * 100));
        }
      }

      const final = all.slice(0, opts.count).map(normalize);
      setProgress(100);
      setActivities(final);
      const snapshot = mergeOpts(opts);
      setMeta(snapshot);
      setTab("student");
      const entry = {
        id: Date.now(),
        date: new Date().toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }),
        label: `${snapshot.subject} · ${snapshot.topic.slice(0, 14)}${snapshot.topic.length > 14 ? "…" : ""}`,
        opts: snapshot,
        activities: final,
      };
      const next = [entry, ...history].slice(0, 10);
      setHistory(next);
      saveKey("awm:history", next);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
      setLoading(false);
      abortRef.current = null;
    }
  }, [opts, history, provider, apiKey, model]);

  const cancel = () => abortRef.current && abortRef.current.abort();

  const saveTemplate = () => {
    const name = tplName.trim() || `${opts.grade}학년 ${opts.subject}`;
    const next = [{ id: Date.now(), name, opts: mergeOpts(opts) }, ...templates].slice(0, 12);
    setTemplates(next);
    saveKey("awm:templates", next);
    setTplName("");
  };
  const deleteTemplate = (id) => {
    const next = templates.filter((t) => t.id !== id);
    setTemplates(next);
    saveKey("awm:templates", next);
  };
  const loadHistory = (h) => {
    setActivities(h.activities);
    setMeta(mergeOpts(h.opts));
    setOpts(mergeOpts(h.opts));
    setTab("student");
    setEditing(false);
  };

  /* ── 인쇄 ── */
  const print = () => {
    try { window.print(); } catch {
      setError("이 환경에서는 인쇄 창이 차단됐어요. 'PDF 저장' 버튼을 이용해 주세요.");
    }
  };

  /* ── PDF 저장 (html2pdf) ── */
  const exportPDF = async () => {
    if (!pagesRef.current || exporting) return;
    setExporting(true);
    setError(null);
    const el = pagesRef.current;
    el.classList.add("exporting");
    try {
      await ensureHtml2pdf();
      const filename = `${(meta && (meta.design.title || meta.topic)) || "활동지"}${tab === "teacher" ? "_교사용" : ""}.pdf`;
      await window
        .html2pdf()
        .set({
          margin: 0,
          filename,
          image: { type: "jpeg", quality: 0.96 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            backgroundColor: "#ffffff",
            onclone: (doc) => doc.querySelectorAll(".no-print").forEach((n) => n.remove()),
          },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
          pagebreak: { mode: ["css", "legacy"] },
        })
        .from(el)
        .save();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      el.classList.remove("exporting");
      setExporting(false);
    }
  };

  const view = meta || opts;
  const viewTitle = meta ? (meta.design.title || meta.topic || `${meta.subject} 활동지`) : sheetTitle;
  const F = view.design.fields;
  const teacher = tab === "teacher";

  /* ── 시트 머리글 요소 (측정·표시에 동일하게 사용) ── */
  const headerEl = (
    <div className="hwrap">
      <div className="sheet-head">
        <div className="sheet-eyebrow">
          {view.grade}학년 {view.subject}{teacher ? " · 지도 자료" : ""}
        </div>
        <h1 className="sheet-title">{activities ? viewTitle : sheetTitle}</h1>
        {!teacher && (F.school || F.ban || F.beon || F.name || F.date || F.score || F.stamp) && (
          <div className="sheet-info right">
            {F.school && <span className="blank wide">학교 <u /></span>}
            {F.ban && <span className="blank"><u className="short" /> 반</span>}
            {F.beon && <span className="blank"><u className="short" /> 번</span>}
            {F.name && <span className="blank">이름 <u /></span>}
            {F.date && <span className="blank">날짜 <u /></span>}
            {F.score && <span className="blank">점수 <u className="short" /></span>}
            {F.stamp && <span className="stamp-slot">확인</span>}
          </div>
        )}
      </div>
    </div>
  );

  /* ── 활동 블록 요소들 (측정·표시에 동일하게 사용) ── */
  const blockEls = (activities || []).map((a) => (
    <div className="blockwrap" key={(teacher ? "t" : "s") + a.number}>
      {teacher ? <ActivityTeacher a={a} /> : <ActivityStudent a={a} />}
    </div>
  ));

  return (
    <div className={dark ? "app dark" : "app"}>
      <style>{CSS}</style>

      {(needSetup || showSetup) && (
        <Setup
          apiKey={apiKey}
          provider={provider}
          model={model}
          canClose={setupDone}
          onClose={() => setShowSetup(false)}
          onSave={(cfg) => {
            setApiKey(cfg.key);
            setProvider(cfg.provider);
            setModel(cfg.model);
            setSetupDone(true);
            setShowSetup(false);
            saveKey("awm:api", cfg);
          }}
        />
      )}

      {/* ── 상단 바 ── */}
      <header className="topbar no-print">
        <div className="logo">
          <span className="logo-mark">가나</span>
          <div>
            <div className="logo-title">AI 활동지 메이커</div>
            <div className="logo-sub">주제만 넣으면 어울리는 활동이 뚝딱!</div>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="btn ghost" onClick={() => setShowSetup(true)}>API 설정</button>
          <button className="btn ghost" onClick={() => setDark((d) => !d)}>{dark ? "라이트 모드" : "다크 모드"}</button>
          <button className="btn ghost" onClick={() => setEditing((e) => !e)} disabled={!activities}>
            {editing ? "편집 끝내기" : "결과 편집"}
          </button>
          <button className="btn" onClick={print} disabled={!activities}>인쇄</button>
          <button className="btn primary" onClick={exportPDF} disabled={!activities || exporting}>
            {exporting ? "PDF 만드는 중…" : "PDF 저장"}
          </button>
        </div>
      </header>

      <div className="body">
        {/* ── 좌측: 옵션 패널 ── */}
        <aside className="panel no-print">
          <Section title="수업 정보">
            <div className="row2">
              <Field label="학년">
                <select value={opts.grade} onChange={(e) => set({ grade: +e.target.value })}>
                  {GRADES.map((g) => <option key={g} value={g}>{g}학년</option>)}
                </select>
              </Field>
              <Field label="과목">
                <select value={opts.subject} onChange={(e) => set({ subject: e.target.value })}>
                  {SUBJECTS.map((s) => <option key={s}>{s}</option>)}
                </select>
              </Field>
            </div>
            <Field label="주제 · 차시 제목 (필수)">
              <input value={opts.topic} placeholder="우리 고장의 문화유산" onChange={(e) => set({ topic: e.target.value })} />
            </Field>
            <Field label="수업 의도 · 성취기준 (선택)">
              <input value={opts.intent} placeholder="문화유산을 조사하고 소중함을 느끼게 하고 싶어요" onChange={(e) => set({ intent: e.target.value })} />
            </Field>
          </Section>

          <Section title="활동 구성">
            <Field label={`활동 수 — ${opts.count}가지`}>
              <input type="range" min="3" max="5" step="1" value={opts.count} onChange={(e) => set({ count: +e.target.value })} />
            </Field>
            <Field label="수준">
              <div className="seg">
                {LEVELS.map((d) => (
                  <button key={d} className={opts.level === d ? "on" : ""} onClick={() => set({ level: d })}>{d}</button>
                ))}
              </div>
            </Field>
            <span className="field-label">이런 요소를 꼭 넣어 주세요</span>
            {EXTRAS.map((x) => (
              <label className="check" key={x.key}>
                <input type="checkbox" checked={opts.extras[x.key]} onChange={() => toggleExtra(x.key)} />
                {x.label}
              </label>
            ))}
            <p className="hint">활동 형태(마인드맵, 표, 그리기, 짝 토의…)는 AI가 주제와 흐름에 맞게 골라 구성해요.</p>
          </Section>

          <Section title="활동지 서식">
            <Field label="활동지 제목 (비우면 주제가 제목이 돼요)">
              <input value={opts.design.title} placeholder={sheetTitle} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <span className="field-label">머리글에 넣을 칸</span>
            <div className="chips">
              {HEAD_FIELDS.map((f) => (
                <button key={f.key} className={"chip" + (opts.design.fields[f.key] ? " on" : "")} onClick={() => setField(f.key)}>
                  {f.label}
                </button>
              ))}
            </div>
          </Section>

          <Section title="템플릿">
            <div className="tpl-save">
              <input value={tplName} placeholder="템플릿 이름" onChange={(e) => setTplName(e.target.value)} />
              <button className="btn small" onClick={saveTemplate}>저장</button>
            </div>
            {templates.length === 0 && <p className="hint">자주 쓰는 설정을 템플릿으로 저장해 두세요.</p>}
            {templates.map((t) => (
              <div className="tpl" key={t.id}>
                <button className="tpl-load" onClick={() => setOpts(mergeOpts(t.opts))}>{t.name}</button>
                <button className="tpl-del" onClick={() => deleteTemplate(t.id)} aria-label={`${t.name} 삭제`}>×</button>
              </div>
            ))}
          </Section>

          {history.length > 0 && (
            <Section title="최근 만든 활동지">
              {history.map((h) => (
                <button className="hist" key={h.id} onClick={() => loadHistory(h)}>
                  <span>{h.label}</span>
                  <span className="hist-date">{h.date}</span>
                </button>
              ))}
            </Section>
          )}

          <details className="prompt-box">
            <summary>AI에게 보내는 프롬프트 보기</summary>
            <pre>{promptPreview}</pre>
          </details>
        </aside>

        {/* ── 우측: 미리보기 ── */}
        <main className="desk">
          <div className="desk-head no-print">
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={tab === "student"} className={tab === "student" ? "on" : ""} onClick={() => setTab("student")}>
                학생용
              </button>
              <button role="tab" aria-selected={tab === "teacher"} className={tab === "teacher" ? "on" : ""} onClick={() => setTab("teacher")}>
                교사용 (지도 팁 · 예시)
              </button>
            </div>
            <div className="tabs page-mode" role="tablist" aria-label="페이지 방식">
              <button role="tab" aria-selected={fitOnePage} className={fitOnePage ? "on" : ""} onClick={() => setFitOnePage(true)}>
                한 장에 맞추기
              </button>
              <button role="tab" aria-selected={!fitOnePage} className={!fitOnePage ? "on" : ""} onClick={() => setFitOnePage(false)}>
                여러 쪽 허용
              </button>
            </div>
            <button className="btn primary big" onClick={generate} disabled={loading}>
              {loading ? "생성 중…" : "활동지 생성"}
            </button>
          </div>

          {error && (
            <div className="error no-print" role="alert">
              <span>{error}</span>
              <button className="btn small" onClick={() => setError(null)}>닫기</button>
            </div>
          )}

          <div className="sheet-scroll">
            {!activities ? (
              <div className="pages" ref={pagesRef}>
                <div className="page">
                  {headerEl}
                  <div className="empty">
                    <div className="empty-face" aria-hidden="true">✎</div>
                    <p className="empty-title">아직 만들어진 활동이 없어요</p>
                    <p>왼쪽에 <b>주제(차시 제목)</b>를 적고 <b>활동지 생성</b>을 눌러 주세요.<br />주제에 어울리는 활동 3~5가지가 흐름에 맞게 만들어져요.</p>
                  </div>
                </div>
                <div className="page-num no-print">A4 · 210 × 297 mm</div>
              </div>
            ) : fitOnePage ? (
              <FitSheet
                key={"fit" + (teacher ? "T" : "S") + activities.map((a) => a.number).join("") + viewTitle + JSON.stringify(F)}
                headerEl={headerEl}
                blockEls={blockEls}
                teacher={teacher}
                editing={editing}
                pagesRef={pagesRef}
              />
            ) : (
              <PaginatedSheet
                key={(teacher ? "T" : "S") + activities.map((a) => a.number).join("") + viewTitle + JSON.stringify(F)}
                headerEl={headerEl}
                blockEls={blockEls}
                teacher={teacher}
                editing={editing}
                pagesRef={pagesRef}
              />
            )}
          </div>

          {loading && (
            <div className="overlay no-print" role="status">
              <div className="overlay-card">
                <div className="spinner" aria-hidden="true" />
                <p className="overlay-title">활동을 구상하고 있어요</p>
                <div className="bar"><div className="bar-fill" style={{ width: `${Math.max(progress, 6)}%` }} /></div>
                <p className="overlay-sub">{progress}% · 수업 흐름에 맞춰 활동을 고르는 중</p>
                <button className="btn small" onClick={cancel}>취소</button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

/* ── A4 자동 분할: 각 블록 높이를 재서 297mm 페이지에 배치 ── */
function PaginatedSheet({ headerEl, blockEls, teacher, editing, pagesRef }) {
  const measureRef = useRef(null);
  const probeRef = useRef(null);
  const [pages, setPages] = useState(null); // [[blockIdx,...], ...]

  const compute = useCallback(() => {
    if (!measureRef.current || !probeRef.current) return;
    const cap = probeRef.current.offsetHeight; // 297mm - 상하 여백의 px 환산값
    const kids = Array.from(measureRef.current.children);
    if (!kids.length) return;
    const hHeader = kids[0].offsetHeight;
    const hs = kids.slice(1).map((k) => k.offsetHeight);
    const out = [];
    let cur = [];
    let used = hHeader; // 1쪽에는 머리글 포함
    hs.forEach((h, i) => {
      if (cur.length > 0 && used + h > cap) {
        out.push(cur);
        cur = [];
        used = 0;
      }
      cur.push(i);
      used += h;
      /* 블록 하나가 한 쪽보다 커도 그 쪽에 두고 넘김 */
      if (used > cap) {
        out.push(cur);
        cur = [];
        used = 0;
      }
    });
    if (cur.length || out.length === 0) out.push(cur);
    setPages(out);
  }, []);

  useLayoutEffect(() => {
    compute();
    const onResize = () => compute();
    window.addEventListener("resize", onResize);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(compute).catch(() => {});
    return () => window.removeEventListener("resize", onResize);
  }, [compute]);

  return (
    <>
      {/* 측정용(화면 밖) — 실제 페이지와 같은 폭·여백에서 높이를 잰다 */}
      <div className="measure" ref={measureRef} aria-hidden="true">
        {headerEl}
        {blockEls}
      </div>
      <div className="probe" ref={probeRef} aria-hidden="true" />

      <div className="pages" ref={pagesRef}>
        {(pages || [[]]).map((idxs, p, arr) => (
          <React.Fragment key={p}>
            <div
              className={"page" + (teacher ? " teacher" : "")}
              contentEditable={editing}
              suppressContentEditableWarning
            >
              {teacher && p === 0 && <div className="stamp">교사용</div>}
              {p === 0 && headerEl}
              {idxs.map((i) => blockEls[i])}
            </div>
            <div className="page-num no-print">{p + 1} / {arr.length} · A4</div>
          </React.Fragment>
        ))}
      </div>
    </>
  );
}

/* ── 한 장에 맞추기: 내용이 넘치면 균일한 비율로 축소해 A4 한 장 안에 채운다 ── */
function FitSheet({ headerEl, blockEls, teacher, editing, pagesRef }) {
  const measureRef = useRef(null);
  const probeRef = useRef(null);
  const [scale, setScale] = useState(1);

  const compute = useCallback(() => {
    if (!measureRef.current || !probeRef.current) return;
    const cap = probeRef.current.offsetHeight; // 297mm - 상하 여백의 px 환산값
    const natural = measureRef.current.offsetHeight; // 축소 없이 쌓았을 때 실제 높이
    if (!natural) return;
    setScale(natural > cap ? cap / natural : 1);
  }, []);

  useLayoutEffect(() => {
    compute();
    const onResize = () => compute();
    window.addEventListener("resize", onResize);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(compute).catch(() => {});
    return () => window.removeEventListener("resize", onResize);
  }, [compute]);

  return (
    <>
      {/* 측정용(화면 밖) — 실제 페이지와 같은 폭·여백에서 자연 높이를 잰다 */}
      <div className="measure" ref={measureRef} aria-hidden="true">
        {headerEl}
        {blockEls}
      </div>
      <div className="probe" ref={probeRef} aria-hidden="true" />

      <div className="pages" ref={pagesRef}>
        <div className={"page" + (teacher ? " teacher" : "")}>
          {teacher && <div className="stamp">교사용</div>}
          <div
            className="fit-scaler"
            style={{ transform: `scale(${scale})`, width: scale < 1 ? `${100 / scale}%` : "100%" }}
            contentEditable={editing}
            suppressContentEditableWarning
          >
            {headerEl}
            {blockEls}
          </div>
        </div>
        <div className="page-num no-print">1 / 1 · A4{scale < 1 ? ` · ${Math.round(scale * 100)}% 축소로 한 장에 맞춤` : ""}</div>
      </div>
    </>
  );
}

/* ── 학생용 활동 블록 ── */
function ActivityStudent({ a }) {
  const L = a.layout;
  return (
    <div className="act">
      <div className="a-head">
        <span className="a-num">{a.number}</span>
        <div>
          <p className="a-title">{a.title}</p>
          {a.goal && <p className="a-goal">{a.goal}</p>}
        </div>
      </div>
      {a.instruction && <p className="a-inst">{a.instruction}</p>}

      {L.type === "write" && (
        <div className="lay-write" style={{ height: `${L.lines * 34}px` }} aria-hidden="true" />
      )}
      {L.type === "draw" && <div className="lay-draw" aria-hidden="true"><span>여기에 그려 보세요</span></div>}
      {L.type === "table" && (
        <table className="lay-table">
          <thead>
            <tr>{L.columns.map((c, i) => <th key={i}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {Array.from({ length: L.rows }).map((_, r) => (
              <tr key={r}>{L.columns.map((_, c) => <td key={c} />)}</tr>
            ))}
          </tbody>
        </table>
      )}
      {L.type === "mindmap" && (
        <div className="lay-mind">
          {Array.from({ length: Math.ceil(L.branches / 2) }).map((_, i) => <span className="bubble empty" key={"t" + i} />)}
          <span className="bubble center">{L.center || "주제"}</span>
          {Array.from({ length: Math.floor(L.branches / 2) }).map((_, i) => <span className="bubble empty" key={"b" + i} />)}
        </div>
      )}
      {L.type === "checklist" && (
        <ul className="lay-check">
          {L.items.map((it, i) => (
            <li key={i}><span className="box" aria-hidden="true" /> {it}</li>
          ))}
        </ul>
      )}
      {L.type === "pair" && (
        <div className="lay-pair">
          <div className="pair-box"><span className="pair-label">내 생각</span></div>
          <div className="pair-box friend"><span className="pair-label">짝의 생각</span></div>
        </div>
      )}
    </div>
  );
}

/* ── 교사용 활동 블록 ── */
function ActivityTeacher({ a }) {
  return (
    <div className="t-act">
      <div className="a-head">
        <span className="a-num">{a.number}</span>
        <div>
          <p className="a-title">{a.title}</p>
          {a.goal && <p className="a-goal">{a.goal}</p>}
        </div>
      </div>
      <p className="t-inst">{a.instruction}</p>
      <div className="answer">
        {a.tip && <p><b>지도 팁</b> {a.tip}</p>}
        {a.example && <p><b>예시 답안</b> {a.example}</p>}
      </div>
    </div>
  );
}

/* ── 옵션 병합(구버전 저장분 호환) ── */
function mergeOpts(saved) {
  return {
    ...DEFAULT_OPTS,
    ...saved,
    extras: { ...DEFAULT_OPTS.extras, ...(saved.extras || {}) },
    design: {
      ...DEFAULT_OPTS.design,
      ...(saved.design || {}),
      fields: { ...DEFAULT_OPTS.design.fields, ...((saved.design || {}).fields || {}) },
    },
  };
}

/* ── API 설정 화면 ── */
function Setup({ apiKey, provider, model, canClose, onClose, onSave }) {
  const [key, setKey] = useState(apiKey);
  const [prov, setProv] = useState(provider);
  const [mdl, setMdl] = useState(model);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState(null);

  const test = async () => {
    setTesting(true);
    setTestMsg(null);
    try {
      if (prov === "claude") {
        await callClaude("안녕하세요 라고만 답해 주세요.", undefined);
        setTestMsg({ ok: true, text: "연결 성공! Claude 미리보기를 사용할 수 있어요." });
      } else {
        await callGemini(key.trim(), mdl, "안녕하세요 라고만 답해 주세요.", undefined);
        setTestMsg({ ok: true, text: "연결 성공! 이 키로 활동지를 만들 수 있어요." });
      }
    } catch (e) {
      setTestMsg({ ok: false, text: friendlyError(e) });
    } finally {
      setTesting(false);
    }
  };

  const save = () => {
    if (prov === "gemini" && !key.trim()) {
      setTestMsg({ ok: false, text: "API 키를 입력해 주세요." });
      return;
    }
    onSave({ key: key.trim(), provider: prov, model: mdl.trim() || "gemini-2.0-flash" });
  };

  return (
    <div className="setup no-print" role="dialog" aria-label="API 설정">
      <div className="setup-card">
        <div className="setup-head">
          <span className="logo-mark">가나</span>
          <div>
            <h1>AI 활동지 메이커 시작하기</h1>
            <p>선생님의 Gemini API 키를 연결하면 바로 사용할 수 있어요.</p>
          </div>
        </div>

        <div className="setup-provider">
          <label className={"prov" + (prov === "gemini" ? " on" : "")}>
            <input type="radio" name="prov" checked={prov === "gemini"} onChange={() => setProv("gemini")} />
            <span><b>Gemini API 키 사용</b><small>배포용 · 각자 자신의 키로 이용 (BYOK)</small></span>
          </label>
          <label className={"prov" + (prov === "claude" ? " on" : "")}>
            <input type="radio" name="prov" checked={prov === "claude"} onChange={() => setProv("claude")} />
            <span><b>Claude 미리보기</b><small>키 없이 테스트 · claude.ai 안에서만 동작</small></span>
          </label>
        </div>

        {prov === "gemini" && (
          <>
            <ol className="setup-steps">
              <li><a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">Google AI Studio</a>에서 무료 API 키를 발급받아요.</li>
              <li>발급받은 키를 아래에 붙여 넣어요.</li>
              <li>연결 테스트 후 저장하면 끝!</li>
            </ol>
            <label className="field">
              <span className="field-label">Gemini API Key</span>
              <input type="password" value={key} placeholder="AIza..." onChange={(e) => setKey(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">모델 (기본값 권장)</span>
              <input value={mdl} onChange={(e) => setMdl(e.target.value)} />
            </label>
            <p className="hint">키는 이 브라우저(LocalStorage)에만 저장되며 별도 서버로 전송되지 않아요. Gemini 호출 시 Google에만 전달됩니다. 'API 설정'에서 언제든 바꿀 수 있어요.</p>
          </>
        )}

        {testMsg && <p className={"test-msg" + (testMsg.ok ? " ok" : " bad")}>{testMsg.text}</p>}

        <div className="setup-actions">
          {canClose && <button className="btn" onClick={onClose}>닫기</button>}
          <button className="btn" onClick={test} disabled={testing || (prov === "gemini" && !key.trim())}>
            {testing ? "테스트 중…" : "연결 테스트"}
          </button>
          <button className="btn primary" onClick={save}>저장하고 시작하기</button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="sec">
      <h2 className="sec-title">{title}</h2>
      {children}
    </section>
  );
}
function Field({ label, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

/* ══════════════════════════ 스타일 ══════════════════════════ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Jua&display=swap');

.app{
  --bg:#F2F7FB; --panel:#FFFFFF; --ink:#33383D; --muted:#7A828A;
  --sky:#4B9CD3; --sky-deep:#2F7AAE; --sky-soft:#E4F0F9;
  --sun:#FFC94D; --sun-soft:#FFF3D6; --pink:#F79BB1;
  --red:#E05555; --line:#DFE7ED; --focus:#4B9CD3;
  min-height:100vh; background:var(--bg); color:var(--ink);
  font-family:'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif;
  font-size:14px; line-height:1.6;
}
.app.dark{
  --bg:#171B1F; --panel:#20262C; --ink:#E8EBEE; --muted:#98A2AB;
  --sky:#6FB4E2; --sky-deep:#9CCDEE; --sky-soft:#233240;
  --sun:#E8B23F; --sun-soft:#3A3222; --line:#2E363D;
}
.app *{box-sizing:border-box}
button,input,select{font:inherit;color:inherit}
button{cursor:pointer}
:focus-visible{outline:2px solid var(--focus);outline-offset:2px}

/* 상단 바 */
.topbar{display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:12px 20px;background:var(--panel);border-bottom:1px solid var(--line);flex-wrap:wrap}
.logo{display:flex;align-items:center;gap:12px}
.logo-mark{width:42px;height:42px;border-radius:14px;background:var(--sun);color:#6B4A00;
  display:inline-flex;align-items:center;justify-content:center;font-family:'Jua';font-size:16px;
  transform:rotate(-4deg);flex:none}
.logo-title{font-family:'Jua',sans-serif;font-size:19px}
.logo-sub{font-size:12px;color:var(--muted)}
.topbar-actions{display:flex;gap:8px;flex-wrap:wrap}

/* 버튼 */
.btn{border:1.5px solid var(--line);background:var(--panel);border-radius:12px;
  padding:8px 14px;transition:background .15s}
.btn:hover:not(:disabled){background:var(--sky-soft)}
.btn:disabled{opacity:.45;cursor:not-allowed}
.btn.ghost{border-color:transparent}
.btn.primary{background:var(--sky);border-color:var(--sky);color:#fff;font-family:'Jua'}
.btn.primary:hover:not(:disabled){background:var(--sky-deep);color:#fff}
.btn.big{padding:10px 24px;font-size:16px;letter-spacing:.5px}
.btn.small{padding:4px 10px;font-size:12px;border-radius:8px}

/* 본문 2단 */
.body{display:flex;align-items:stretch;min-height:calc(100vh - 67px)}
.panel{width:380px;min-width:300px;padding:18px;overflow-y:auto;max-height:calc(100vh - 67px);
  background:var(--panel);border-right:1px solid var(--line)}
@media (max-width: 860px){
  .body{flex-direction:column}
  .panel{width:100%;max-height:none;border-right:none;border-bottom:1px solid var(--line)}
}

/* 섹션 / 필드 */
.sec{margin-bottom:22px;padding-bottom:18px;border-bottom:1.5px dashed var(--line)}
.sec-title{font-family:'Jua';font-size:14px;color:var(--sky-deep);margin:0 0 10px;font-weight:400}
.field{display:block;margin-bottom:10px}
.field-label{display:block;font-size:12px;color:var(--muted);margin-bottom:4px}
.field input:not([type=range]):not([type=checkbox]),.field select,.tpl-save input{
  width:100%;padding:8px 12px;border:1.5px solid var(--line);border-radius:10px;background:var(--panel)}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
input[type=range]{width:100%;accent-color:var(--sky)}

/* 세그먼트 / 체크 / 칩 */
.seg{display:flex;border:1.5px solid var(--line);border-radius:12px;overflow:hidden}
.seg button{flex:1;padding:7px 4px;background:var(--panel);border:none;border-right:1.5px solid var(--line)}
.seg button:last-child{border-right:none}
.seg button.on{background:var(--sky);color:#fff}
.check{display:flex;align-items:center;gap:8px;padding:5px 2px;font-size:13px}
.check input{accent-color:var(--sky);width:15px;height:15px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
.chip{border:1.5px solid var(--line);background:var(--panel);border-radius:999px;padding:5px 13px;font-size:12px}
.chip.on{background:var(--sun-soft);border-color:var(--sun);color:inherit}

/* 템플릿 / 기록 / 프롬프트 */
.tpl-save{display:flex;gap:6px;margin-bottom:8px}
.tpl{display:flex;gap:6px;margin-bottom:6px}
.tpl-load{flex:1;text-align:left;border:1.5px solid var(--line);background:var(--panel);border-radius:10px;padding:7px 12px}
.tpl-load:hover{background:var(--sky-soft)}
.tpl-del{border:none;background:none;color:var(--muted);font-size:16px;padding:0 6px}
.tpl-del:hover{color:var(--red)}
.hist{display:flex;justify-content:space-between;gap:8px;width:100%;text-align:left;
  border:none;background:none;padding:6px 2px;border-bottom:1px dotted var(--line);font-size:13px}
.hist:hover{color:var(--sky-deep)}
.hist-date{color:var(--muted);font-size:11px;white-space:nowrap}
.hint{font-size:12px;color:var(--muted);margin:6px 0;line-height:1.55}
.prompt-box summary{cursor:pointer;font-size:12px;color:var(--muted);padding:4px 0}
.prompt-box pre{white-space:pre-wrap;font-size:11px;line-height:1.5;background:var(--bg);
  border:1.5px solid var(--line);border-radius:10px;padding:10px;max-height:240px;overflow:auto}

/* 미리보기 책상 */
.desk{flex:1;position:relative;display:flex;flex-direction:column;min-width:0;
  background-image:radial-gradient(var(--line) 1.2px, transparent 1.2px);background-size:24px 24px}
.desk-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 22px;flex-wrap:wrap}
.tabs{display:flex;background:var(--panel);border:1.5px solid var(--line);border-radius:14px;overflow:hidden}
.tabs button{padding:9px 18px;border:none;background:transparent;font-size:14px}
.tabs button.on{background:var(--sky);color:#fff;font-family:'Jua'}
.error{margin:0 22px 10px;background:var(--panel);border:1.5px solid var(--red);color:var(--red);
  border-radius:12px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;gap:10px}

/* ── A4 페이지 (정확히 210 × 297 mm) ── */
.sheet-scroll{flex:1;overflow:auto;padding:6px 22px 40px}
.pages{display:flex;flex-direction:column;align-items:center;gap:6px}
.page{position:relative;flex:none;width:210mm;height:297mm;overflow:hidden;
  background:#fff;color:#33383D;padding:14mm 14mm;border-radius:4px;
  box-shadow:0 1px 2px rgba(0,0,0,.07),0 14px 34px rgba(40,70,100,.14)}
.page[contenteditable=true]{outline:2px dashed var(--sky);outline-offset:4px}
.fit-scaler{transform-origin:top left}
.fit-scaler[contenteditable=true]{outline:2px dashed var(--sky);outline-offset:4px}
.tabs.page-mode{margin-left:2px}
.tabs.page-mode button{padding:9px 14px;font-size:13px}
.page-num{font-size:11px;color:var(--muted);margin:0 0 14px;font-family:'Jua';letter-spacing:.5px}
.exporting{gap:0 !important}
.exporting .page{box-shadow:none;border-radius:0}

/* 측정용 요소(화면 밖) — 페이지와 같은 내용 폭에서 높이를 잰다 */
.measure{position:absolute;left:-9999px;top:0;width:210mm;padding:0 14mm;
  visibility:hidden;pointer-events:none;background:#fff;color:#33383D}
.probe{position:absolute;left:-9999px;top:0;width:1px;height:calc(297mm - 28mm);
  visibility:hidden;pointer-events:none}

/* 머리글 */
.hwrap{padding-bottom:18px;overflow:hidden}
.sheet-head{border:2.5px solid #4B9CD3;border-radius:18px;padding:13px 18px 11px;margin:0;
  position:relative;background:
    radial-gradient(circle at 12px 12px,#FFF3D6 6px,transparent 7px),
    radial-gradient(circle at calc(100% - 12px) 12px,#FDE3EA 6px,transparent 7px),#fff}
.sheet-eyebrow{display:inline-block;font-family:'Jua';font-size:12px;color:#2F7AAE;
  background:#E4F0F9;border-radius:999px;padding:3px 12px;margin-bottom:6px}
.sheet-title{font-family:'Jua',sans-serif;font-weight:400;font-size:26px;margin:0 0 8px;line-height:1.3;color:#33383D;text-align:center}
.sheet-info{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:13.5px;color:#4A5157;align-items:flex-end}
.sheet-info.right{width:100%;justify-content:flex-end}
.blank{display:inline-flex;align-items:flex-end;gap:6px;white-space:nowrap}
.blank u{display:inline-block;width:90px;border-bottom:1.5px solid #9DB4C4;text-decoration:none;height:1.1em}
.blank u.short{width:38px}
.blank.wide u{width:130px}
.stamp-slot{width:50px;height:50px;border:2px dashed #F79BB1;border-radius:50%;
  display:inline-flex;align-items:center;justify-content:center;font-size:11px;color:#D97A94;margin-left:auto}

/* ── 활동 블록 ── */
.blockwrap{padding-bottom:20px;overflow:hidden}
.act,.t-act{break-inside:avoid}
.a-head{display:flex;gap:11px;align-items:flex-start}
.a-num{flex:none;width:30px;height:30px;border-radius:50%;background:#FFC94D;color:#6B4A00;
  display:flex;align-items:center;justify-content:center;font-family:'Jua';font-size:15px;margin-top:2px}
.a-title{margin:0;font-family:'Jua';font-size:17.5px;color:#2F7AAE;line-height:1.4}
.a-goal{margin:1px 0 0;font-size:12px;color:#8A949C}
.a-inst,.t-inst{margin:8px 0 10px 41px;font-size:14.5px;line-height:1.7}

/* 활동 유형별 기록 공간 */
.lay-write{margin-left:41px;border-radius:4px;
  background:repeating-linear-gradient(#fff,#fff 32px,#B9CBD8 32px,#B9CBD8 33.5px);
  border-bottom:1.5px solid #B9CBD8}
.lay-draw{margin-left:41px;height:150px;border:2px dashed #F0AEC0;border-radius:16px;
  display:flex;align-items:flex-end;justify-content:flex-end;padding:8px 12px}
.lay-draw span{font-size:11px;color:#D9A5B4}
.lay-table{margin-left:41px;width:calc(100% - 41px);border-collapse:collapse;font-size:13.5px}
.lay-table th{background:#E4F0F9;color:#2F7AAE;font-family:'Jua';font-weight:400;
  border:1.5px solid #A9C9E0;padding:7px 10px}
.lay-table td{border:1.5px solid #A9C9E0;height:44px;padding:6px 10px}
.lay-mind{margin-left:41px;display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:center;
  padding:14px 6px;border:2px dashed #C4D6E3;border-radius:16px}
.bubble{display:inline-flex;align-items:center;justify-content:center;border-radius:999px;text-align:center}
.bubble.center{background:#4B9CD3;color:#fff;font-family:'Jua';font-size:15px;padding:12px 22px}
.bubble.empty{width:104px;height:52px;border:2px dashed #F0AEC0;background:#fff}
.lay-check{list-style:none;margin:0 0 0 41px;padding:0;font-size:14px}
.lay-check li{display:flex;gap:10px;align-items:flex-start;padding:6px 0;line-height:1.6}
.lay-check .box{flex:none;width:18px;height:18px;border:2px solid #4B9CD3;border-radius:5px;margin-top:2px}
.lay-pair{margin-left:41px;display:grid;grid-template-columns:1fr 1fr;gap:12px}
.pair-box{height:110px;border:2px solid #A9C9E0;border-radius:16px;padding:8px 12px;position:relative}
.pair-box.friend{border-color:#F0AEC0}
.pair-label{font-family:'Jua';font-size:12px;color:#2F7AAE;background:#E4F0F9;
  border-radius:999px;padding:2px 10px}
.pair-box.friend .pair-label{color:#C56B85;background:#FDE3EA}

/* ── 교사용 ── */
.t-act .a-title{color:#C0392E}
.answer{margin:6px 0 0 41px;border:1.5px dashed #E05555;border-radius:12px;padding:8px 14px;
  background:#FEF4F3;font-size:13.5px;color:#C0392E;line-height:1.65}
.answer p{margin:3px 0}
.answer b{margin-right:6px;font-family:'Jua';font-weight:400}
.page.teacher .sheet-head{border-color:#E05555}
.page.teacher .sheet-eyebrow{color:#C0392E;background:#FDEBEA}
.page.teacher .a-num{background:#F7C6C0;color:#8E2A21}
.stamp{position:absolute;top:11mm;right:12mm;transform:rotate(7deg);z-index:2;
  border:2.5px solid #E05555;color:#E05555;border-radius:10px;padding:4px 12px;
  font-family:'Jua';font-size:15px;letter-spacing:4px;opacity:.85}

/* 빈 상태 */
.empty{border:2px dashed #C4D6E3;border-radius:18px;padding:44px 24px;text-align:center;color:#84909A}
.empty-face{width:52px;height:52px;border-radius:50%;background:#E4F0F9;color:#2F7AAE;
  display:inline-flex;align-items:center;justify-content:center;font-size:22px;margin-bottom:12px}
.empty-title{font-family:'Jua';font-size:17px;color:#2F7AAE;margin:0 0 8px}
.empty b{color:#2F7AAE}

/* 로딩 */
.overlay{position:absolute;inset:0;background:rgba(25,40,55,.35);
  display:flex;align-items:center;justify-content:center;z-index:20}
.overlay-card{background:var(--panel);border-radius:18px;padding:26px 30px;width:300px;
  text-align:center;border:1.5px solid var(--line)}
.spinner{width:36px;height:36px;border-radius:50%;margin:0 auto 12px;
  border:4px solid var(--sun-soft);border-top-color:var(--sun);animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.overlay-title{font-family:'Jua';margin:0 0 10px;font-size:15px}
.bar{height:8px;border-radius:99px;background:var(--sky-soft);overflow:hidden;margin-bottom:8px}
.bar-fill{height:100%;background:var(--sky);transition:width .4s;border-radius:99px}
.overlay-sub{font-size:12px;color:var(--muted);margin:0 0 14px}
@media (prefers-reduced-motion: reduce){.spinner{animation:none}}

/* ── API 설정 화면 ── */
.setup{position:fixed;inset:0;background:rgba(25,40,55,.45);z-index:50;
  display:flex;align-items:center;justify-content:center;padding:20px;overflow:auto}
.setup-card{background:var(--panel);border-radius:22px;padding:28px;width:520px;max-width:100%;
  border:1.5px solid var(--line)}
.setup-head{display:flex;gap:14px;align-items:flex-start;margin-bottom:18px}
.setup-head h1{font-family:'Jua';font-weight:400;font-size:20px;margin:0 0 4px}
.setup-head p{margin:0;font-size:13px;color:var(--muted)}
.setup-provider{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px}
@media (max-width:560px){.setup-provider{grid-template-columns:1fr}}
.prov{display:flex;gap:10px;align-items:flex-start;border:1.5px solid var(--line);border-radius:14px;
  padding:12px;cursor:pointer}
.prov.on{border-color:var(--sky);background:var(--sky-soft)}
.prov input{accent-color:var(--sky);margin-top:3px}
.prov b{display:block;font-size:13.5px}
.prov small{display:block;font-size:11.5px;color:var(--muted);line-height:1.4;margin-top:2px}
.setup-steps{margin:0 0 14px;padding-left:20px;font-size:13px;line-height:1.9}
.setup-steps a{color:var(--sky-deep)}
.test-msg{font-size:13px;border-radius:10px;padding:8px 12px;margin:4px 0 0}
.test-msg.ok{background:#E7F5EA;color:#2E7D46;border:1.5px solid #A8D8B4}
.test-msg.bad{background:#FDEBEA;color:#C0392E;border:1.5px solid #EFB0AA}
.app.dark .test-msg.ok{background:#20362A;border-color:#3B6B4C;color:#8FD3A3}
.app.dark .test-msg.bad{background:#3A2422;border-color:#7A4440;color:#EE9B93}
.setup-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}

/* ── 인쇄: A4 페이지 그대로, 워터마크 없음 ── */
@media print{
  .no-print{display:none !important}
  .app{background:#fff;min-height:0}
  .body{display:block;min-height:0}
  .panel{display:none}
  .desk{background:none;display:block}
  .sheet-scroll{overflow:visible;padding:0}
  .pages{gap:0;display:block}
  .page{width:210mm;height:296.5mm;margin:0 auto;box-shadow:none;border-radius:0;
    page-break-after:always;break-after:page}
  .page:last-of-type{page-break-after:auto;break-after:auto}
}
@page{size:A4 portrait;margin:0}
`;
