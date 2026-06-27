import { useState, useRef } from "react";
import Tracker from "./Tracker.jsx";
import { searchTeams, getLastFixtures, getH2H, getDaysSinceLastMatch, validateApiKey } from "./api.js";

// ─── Constants ────────────────────────────────────────────────────────────
const TYPE_WEIGHT = { official: 1.0, minor: 0.7, friendly: 0.3 };
const RECENCY_WEIGHT = [1.0, 0.85, 0.7, 0.55, 0.4];
const FORM_WEIGHT = 0.6;
const SEASON_WEIGHT = 0.4;
const WEATHER_FACTOR = { normal: 1.0, rain: 0.92, wind: 0.90, cold: 0.95, heat: 0.96 };
const HOME_BONUS = { home: 0.3, away: -0.15, neutral: 0 };
const ENJEU_FACTOR = { high: 1.05, normal: 1.0, low: 0.90 };

// ─── Colors ───────────────────────────────────────────────────────────────
const BLUE = "#2563eb";
const BLUE_BG = "#eff6ff";
const TEAL = "#0d9488";
const TEAL_BG = "#f0fdfa";
const GREEN = "#16a34a";
const GREEN_BG = "#dcfce7";
const GREEN_LIGHT = "#f0fdf4";
const GREEN_BORDER = "#bbf7d0";
const GRAY_BG = "#f8f9fa";
const CARD_BG = "#ffffff";
const BORDER = "#e5e7eb";
const BAR_BG = "#f1f5f9";
const TEXT = "#111827";
const TEXT_SUB = "#6b7280";
const TEXT_MUTED = "#9ca3af";
const RED = "#dc2626";
const RED_BG = "#fef2f2";
const RED_BORDER = "#fecaca";

// ─── Poisson ──────────────────────────────────────────────────────────────
function poissonProb(lambda, k) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

function computeMatch(lambdaA, lambdaB, maxGoals = 8) {
  let winA = 0, draw = 0, winB = 0;
  const grid = [];
  for (let i = 0; i <= maxGoals; i++) {
    for (let j = 0; j <= maxGoals; j++) {
      const p = poissonProb(lambdaA, i) * poissonProb(lambdaB, j);
      grid.push({ i, j, p });
      if (i > j) winA += p;
      else if (i === j) draw += p;
      else winB += p;
    }
  }
  return { winA, draw, winB, grid };
}

function toOdds(p) { return p <= 0.001 ? "∞" : (1 / p).toFixed(2); }

function weightedFormAvg(matches) {
  let sumSR = 0, sumSX = 0, sumCR = 0, sumCX = 0, totalW = 0, validCount = 0;
  matches.forEach((m, idx) => {
    const sr = parseFloat(m.scoredReal), cr = parseFloat(m.concededReal);
    if (isNaN(sr) || isNaN(cr)) return;
    const sx = isNaN(parseFloat(m.scoredXG)) ? sr : parseFloat(m.scoredXG);
    const cx = isNaN(parseFloat(m.concededXG)) ? cr : parseFloat(m.concededXG);
    const w = TYPE_WEIGHT[m.type] * RECENCY_WEIGHT[idx] * (m.venue === "home" ? 1.0 : m.venue === "away" ? 0.9 : 0.95);
    sumSR += sr * w; sumSX += sx * w; sumCR += cr * w; sumCX += cx * w;
    totalW += w; validCount++;
  });
  if (validCount < 1) return null;
  return { scoredReal: sumSR / totalW, scoredXG: sumSX / totalW, concededReal: sumCR / totalW, concededXG: sumCX / totalW };
}

function combinedLambda(form, season) {
  if (!form) return null;
  const fS = form.scoredReal * 0.4 + form.scoredXG * 0.6;
  const fC = form.concededReal * 0.4 + form.concededXG * 0.6;
  if (!season) return { scored: fS, conceded: fC };
  const sS = season.scoredReal * 0.4 + (season.scoredXG || season.scoredReal) * 0.6;
  const sC = season.concededReal * 0.4 + (season.concededXG || season.concededReal) * 0.6;
  return { scored: fS * FORM_WEIGHT + sS * SEASON_WEIGHT, conceded: fC * FORM_WEIGHT + sC * SEASON_WEIGHT };
}

function eloFactor(eloA, eloB) {
  if (!eloA || !eloB) return { factorA: 1, factorB: 1 };
  const diff = parseFloat(eloA) - parseFloat(eloB);
  return { factorA: Math.max(0.7, Math.min(1.3, 1 + diff / 4000)), factorB: Math.max(0.7, Math.min(1.3, 1 - diff / 4000)) };
}

function fatigueFactor(days) {
  const d = parseInt(days);
  if (isNaN(d)) return 1;
  if (d <= 2) return 0.88; if (d <= 4) return 0.94; if (d <= 6) return 0.98;
  return 1;
}

function valueInfo(myP, bookOdds) {
  if (!bookOdds || parseFloat(bookOdds) <= 1) return null;
  const impliedP = 1 / parseFloat(bookOdds);
  const edge = ((myP - impliedP) / impliedP) * 100;
  return { edge, isValue: myP > impliedP };
}

// ─── UI Primitives ────────────────────────────────────────────────────────
const Card = ({ children, style }) => (
  <div style={{ background: CARD_BG, border: `0.5px solid ${BORDER}`, borderRadius: 12, padding: 16, marginBottom: 12, ...style }}>
    {children}
  </div>
);

const SectionLabel = ({ children }) => (
  <div style={{ fontSize: 11, fontWeight: 500, color: TEXT_MUTED, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
    {children}
  </div>
);

const NumInput = ({ value, onChange, placeholder }) => (
  <input type="number" min="0" step="0.01" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
    style={{ background: GRAY_BG, border: `0.5px solid ${BORDER}`, borderRadius: 6, color: TEXT, fontSize: 13, padding: "7px 9px", width: "100%", boxSizing: "border-box", fontFamily: "monospace", outline: "none" }} />
);

const TabGroup = ({ options, value, onChange, color }) => (
  <div style={{ display: "flex", gap: 4 }}>
    {options.map(([v, l]) => (
      <button key={v} onClick={() => onChange(v)} style={{
        flex: 1, padding: "6px 4px", borderRadius: 6, fontSize: 11, fontWeight: 500,
        border: `0.5px solid ${value === v ? color : BORDER}`,
        background: value === v ? `${color}15` : GRAY_BG,
        color: value === v ? color : TEXT_MUTED, cursor: "pointer",
      }}>{l}</button>
    ))}
  </div>
);

const Toggle = ({ value, onChange, label }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0" }}>
    <span style={{ fontSize: 13, color: TEXT }}>{label}</span>
    <button onClick={() => onChange(!value)} style={{
      padding: "4px 14px", borderRadius: 20, fontSize: 12, fontWeight: 500,
      border: `0.5px solid ${value ? RED : BORDER}`,
      background: value ? RED_BG : GRAY_BG,
      color: value ? RED : TEXT_MUTED, cursor: "pointer",
    }}>{value ? "Oui −15%" : "Non"}</button>
  </div>
);

// ─── Step indicator ───────────────────────────────────────────────────────
function StepBar({ current }) {
  const steps = ["Match", "Contexte", "Marché"];
  return (
    <div style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: `1.5px solid ${BORDER}` }}>
      {steps.map((s, i) => (
        <div key={i} style={{ padding: "8px 16px", fontSize: 13, fontWeight: i === current ? 500 : 400, color: i === current ? GREEN : TEXT_MUTED, borderBottom: i === current ? `2px solid ${GREEN}` : "none", marginBottom: -1.5, cursor: "default" }}>{s}</div>
      ))}
    </div>
  );
}

// ─── Team search ──────────────────────────────────────────────────────────
function TeamSearch({ label, color, colorBg, onSelect, selected, apiKey }) {
  const [query, setQuery] = useState(selected?.name || "");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const debounce = useRef(null);

  const search = (q) => {
    setQuery(q);
    if (debounce.current) clearTimeout(debounce.current);
    if (q.length < 3) { setResults([]); return; }
    debounce.current = setTimeout(async () => {
      setLoading(true);
      try { setResults((await searchTeams(q, apiKey)).slice(0, 5)); }
      catch (e) { setResults([]); }
      setLoading(false);
    }, 600);
  };

  return (
    <div style={{ position: "relative", marginBottom: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 500, color: TEXT_MUTED, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{label}</div>
      <div style={{ position: "relative" }}>
        <input value={query} onChange={e => search(e.target.value)} placeholder="Tape le nom de l'équipe..."
          style={{ width: "100%", boxSizing: "border-box", padding: "10px 36px 10px 12px", background: selected ? colorBg : GRAY_BG, border: `0.5px solid ${selected ? color : BORDER}`, borderRadius: 8, fontSize: 13, fontWeight: selected ? 500 : 400, color: selected ? color : TEXT, outline: "none" }} />
        {loading && <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: TEXT_MUTED }}>…</span>}
        {selected && !loading && <i className="ti ti-check" style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: GREEN, fontSize: 16 }} aria-hidden="true" />}
      </div>
      {results.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: CARD_BG, border: `0.5px solid ${BORDER}`, borderRadius: 8, zIndex: 100, overflow: "hidden", marginTop: 4, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
          {results.map(t => (
            <div key={t.id} onClick={() => { onSelect(t); setQuery(t.name); setResults([]); }}
              style={{ padding: "10px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, borderBottom: `0.5px solid ${BORDER}` }}
              onMouseEnter={e => e.currentTarget.style.background = GRAY_BG}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              {t.logo && <img src={t.logo} alt="" style={{ width: 22, height: 22, objectFit: "contain" }} />}
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: TEXT }}>{t.name}</div>
                <div style={{ fontSize: 11, color: TEXT_MUTED }}>{t.national ? "Équipe nationale" : "Club"} · {t.country}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Setup screen ─────────────────────────────────────────────────────────
function SetupScreen({ onSave }) {
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const validate = async () => {
    if (!key.trim()) { setError("Entre ta clé API."); return; }
    setLoading(true); setError("");
    const result = await validateApiKey(key.trim());
    setLoading(false);
    if (result.valid) { localStorage.setItem("betquant_api_key", key.trim()); onSave(key.trim()); }
    else setError("Clé invalide. Vérifie sur api-sports.io → Mon accès.");
  };

  return (
    <div style={{ minHeight: "100vh", background: GRAY_BG, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 360, width: "100%" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ width: 56, height: 56, background: GREEN, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
            <i className="ti ti-ball-football" style={{ color: "#fff", fontSize: 26 }} aria-hidden="true" />
          </div>
          <div style={{ fontSize: 22, fontWeight: 500, color: TEXT, letterSpacing: "-0.03em" }}>BetQuant</div>
          <div style={{ fontSize: 13, color: TEXT_MUTED, marginTop: 4 }}>Analyse quantitative football</div>
        </div>
        <Card>
          <SectionLabel>Clé API-Football</SectionLabel>
          <div style={{ fontSize: 12, color: TEXT_SUB, marginBottom: 12, lineHeight: 1.6 }}>
            Récupère ta clé sur <span style={{ color: BLUE }}>api-sports.io</span> → Tableau de bord → Mon accès
          </div>
          <input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder="Colle ta clé ici..."
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", background: GRAY_BG, border: `0.5px solid ${BORDER}`, borderRadius: 8, fontSize: 13, fontFamily: "monospace", outline: "none", marginBottom: error ? 8 : 12 }} />
          {error && <div style={{ fontSize: 12, color: RED, marginBottom: 10 }}>⚠ {error}</div>}
          <button onClick={validate} disabled={loading} style={{ width: "100%", padding: "12px", borderRadius: 8, background: GREEN, color: "#fff", fontWeight: 500, fontSize: 14, border: "none", cursor: "pointer" }}>
            {loading ? "Vérification..." : "Démarrer →"}
          </button>
        </Card>
        <div style={{ fontSize: 11, color: TEXT_MUTED, textAlign: "center", lineHeight: 1.6 }}>
          Ta clé est stockée uniquement sur ton appareil.
        </div>
      </div>
    </div>
  );
}

// ─── Loading overlay ──────────────────────────────────────────────────────
function LoadingOverlay({ message }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(248,249,250,0.92)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ width: 44, height: 44, background: GREEN, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
        <i className="ti ti-ball-football" style={{ color: "#fff", fontSize: 22 }} aria-hidden="true" />
      </div>
      <div style={{ fontSize: 13, color: TEXT_SUB }}>{message}</div>
    </div>
  );
}

// ─── Match row ────────────────────────────────────────────────────────────
const VENUE_OPTS = [["home", "🏠 Dom."], ["away", "✈️ Ext."], ["neutral", "⚖️ Ntr."]];
const TYPE_OPTS = [["official", "🏆 Off."], ["minor", "🥈 Min."], ["friendly", "🤝 Am."]];

function MatchRow({ idx, match, onChange, color }) {
  return (
    <div style={{ background: GRAY_BG, borderRadius: 8, padding: 10, marginBottom: 6, border: `0.5px solid ${idx === 0 ? color + "44" : BORDER}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
        <span style={{ fontSize: 11, fontWeight: 500, color: idx === 0 ? color : TEXT_MUTED }}>
          {match.opponent ? `vs ${match.opponent}` : `Match ${idx + 1}`}{idx === 0 ? " · récent" : ""}
        </span>
        <span style={{ fontSize: 10, color: TEXT_MUTED }}>×{(TYPE_WEIGHT[match.type] * RECENCY_WEIGHT[idx]).toFixed(2)}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 5, marginBottom: 7 }}>
        <div><div style={{ fontSize: 10, color: TEXT_MUTED, marginBottom: 3 }}>⚽ Mq.</div><NumInput value={match.scoredReal} onChange={v => onChange({ ...match, scoredReal: v })} placeholder="2" /></div>
        <div><div style={{ fontSize: 10, color: TEXT_MUTED, marginBottom: 3 }}>📐 xG+</div><NumInput value={match.scoredXG} onChange={v => onChange({ ...match, scoredXG: v })} placeholder="1.8" /></div>
        <div><div style={{ fontSize: 10, color: TEXT_MUTED, marginBottom: 3 }}>🛡 Enc.</div><NumInput value={match.concededReal} onChange={v => onChange({ ...match, concededReal: v })} placeholder="1" /></div>
        <div><div style={{ fontSize: 10, color: TEXT_MUTED, marginBottom: 3 }}>📐 xG-</div><NumInput value={match.concededXG} onChange={v => onChange({ ...match, concededXG: v })} placeholder="0.7" /></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
        <TabGroup options={VENUE_OPTS} value={match.venue} onChange={v => onChange({ ...match, venue: v })} color={color} />
        <TabGroup options={TYPE_OPTS} value={match.type} onChange={v => onChange({ ...match, type: v })} color={color} />
      </div>
    </div>
  );
}

// ─── Prob bar ─────────────────────────────────────────────────────────────
function ProbBar({ label, prob, bookOdds, color }) {
  const v = bookOdds ? valueInfo(prob, bookOdds) : null;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
        <span style={{ fontSize: 13, color: TEXT }}>{label}</span>
        <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
          <span style={{ fontSize: 22, fontWeight: 500, color, fontFamily: "monospace" }}>{(prob * 100).toFixed(1)}%</span>
          <span style={{ fontSize: 12, color: TEXT_MUTED, fontFamily: "monospace" }}>cote {toOdds(prob)}</span>
        </div>
      </div>
      <div style={{ height: 5, background: BAR_BG, borderRadius: 3, overflow: "hidden", marginBottom: v ? 6 : 0 }}>
        <div style={{ width: `${Math.min(prob * 100, 100)}%`, height: "100%", background: color, borderRadius: 3 }} />
      </div>
      {v && (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 6, background: v.isValue ? GREEN_BG : RED_BG, border: `0.5px solid ${v.isValue ? GREEN_BORDER : RED_BORDER}` }}>
          <i className={`ti ti-${v.isValue ? "trending-up" : "trending-down"}`} style={{ color: v.isValue ? GREEN : RED, fontSize: 13 }} aria-hidden="true" />
          <span style={{ fontSize: 11, fontWeight: 500, color: v.isValue ? GREEN : RED }}>
            {v.isValue ? `Value bet · edge +${v.edge.toFixed(1)}%` : `Pas de value · edge ${v.edge.toFixed(1)}%`}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────
const emptyMatch = () => ({ scoredReal: "", scoredXG: "", concededReal: "", concededXG: "", venue: "home", type: "official", opponent: "" });
const emptySeason = () => ({ scoredReal: "", scoredXG: "", concededReal: "", concededXG: "" });
const emptyH2H = () => ({ goalsA: "", goalsB: "" });

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("betquant_api_key") || "");
  const [mainTab, setMainTab] = useState("analyse");
  const [step, setStep] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [error, setError] = useState("");

  const [teamA, setTeamA] = useState(null);
  const [teamB, setTeamB] = useState(null);
  const [venue, setVenue] = useState("home");
  const [enjeu, setEnjeu] = useState("normal");

  const [matchesA, setMatchesA] = useState(Array.from({ length: 5 }, emptyMatch));
  const [matchesB, setMatchesB] = useState(Array.from({ length: 5 }, emptyMatch));
  const [seasonA, setSeasonA] = useState(emptySeason());
  const [seasonB, setSeasonB] = useState(emptySeason());
  const [activeTeam, setActiveTeam] = useState("A");

  const [absentA, setAbsentA] = useState(false);
  const [absentB, setAbsentB] = useState(false);
  const [eloA, setEloA] = useState("");
  const [eloB, setEloB] = useState("");
  const [daysA, setDaysA] = useState("");
  const [daysB, setDaysB] = useState("");
  const [weather, setWeather] = useState("normal");
  const [h2h, setH2H] = useState(Array.from({ length: 5 }, emptyH2H));

  const [bookOdds, setBookOdds] = useState({ A: "", draw: "", B: "" });
  const [openOdds, setOpenOdds] = useState({ A: "", draw: "", B: "" });
  const [result, setResult] = useState(null);

  const nameA = teamA?.name || "Équipe A";
  const nameB = teamB?.name || "Équipe B";

  const loadTeamData = async (team, side) => {
    if (!team || !apiKey) return;
    setLoading(true);
    const national = team.national === true;
    try {
      setLoadingMsg(`Chargement des matchs de ${team.name}...`);
      const fixtures = await getLastFixtures(team.id, apiKey, national);
      const mapped = fixtures.map(f => ({
        scoredReal: String(f.scoredReal), scoredXG: String(f.scoredXG ?? f.scoredReal),
        concededReal: String(f.concededReal), concededXG: String(f.concededXG ?? f.concededReal),
        venue: f.venue, type: f.type, opponent: f.opponent,
      }));
      while (mapped.length < 5) mapped.push(emptyMatch());
      if (side === "A") setMatchesA(mapped); else setMatchesB(mapped);

      setLoadingMsg(`Chargement fatigue ${team.name}...`);
      const days = await getDaysSinceLastMatch(team.id, apiKey, national);
      if (days !== null) { if (side === "A") setDaysA(String(days)); else setDaysB(String(days)); }
    } catch (e) {
      setError(`Erreur chargement ${team.name}: ${e.message}`);
    }
    setLoading(false); setLoadingMsg("");
  };

  const loadH2HData = async () => {
    if (!teamA || !teamB || !apiKey) return;
    setLoading(true); setLoadingMsg("Chargement H2H...");
    try {
      const data = await getH2H(teamA.id, teamB.id, apiKey);
      const mapped = data.map(m => ({ goalsA: String(m.goalsA), goalsB: String(m.goalsB) }));
      while (mapped.length < 5) mapped.push(emptyH2H());
      setH2H(mapped);
    } catch (e) { }
    setLoading(false); setLoadingMsg("");
  };

  const handleTeamSelect = async (team, side) => {
    if (side === "A") setTeamA(team); else setTeamB(team);
    await loadTeamData(team, side);
  };

  const goToContext = async () => {
    if (!teamA || !teamB) { setError("Sélectionne les deux équipes."); return; }
    setError("");
    await loadH2HData();
    setStep(1);
  };

  function h2hFactor() {
    let wA = 0, wB = 0, valid = 0;
    h2h.forEach(m => {
      const a = parseFloat(m.goalsA), b = parseFloat(m.goalsB);
      if (isNaN(a) || isNaN(b)) return;
      valid++; if (a > b) wA++; else if (b > a) wB++;
    });
    if (valid === 0) return { factorA: 1, factorB: 1, winsA: 0, winsB: 0, draws: 0, valid: 0 };
    return { factorA: 1 + (wA / valid - 0.33) * 0.15, factorB: 1 + (wB / valid - 0.33) * 0.15, winsA: wA, winsB: wB, draws: valid - wA - wB, valid };
  }

  function oddsMovement(key) {
    const open = parseFloat(openOdds[key]), close = parseFloat(bookOdds[key]);
    if (isNaN(open) || isNaN(close) || open <= 0) return null;
    const move = ((open - close) / open) * 100;
    return { move, dropping: move > 5, rising: move < -5 };
  }

  const compute = () => {
    setError("");
    const formA = weightedFormAvg(matchesA), formB = weightedFormAvg(matchesB);
    const sA = { scoredReal: parseFloat(seasonA.scoredReal), scoredXG: parseFloat(seasonA.scoredXG), concededReal: parseFloat(seasonA.concededReal), concededXG: parseFloat(seasonA.concededXG) };
    const sB = { scoredReal: parseFloat(seasonB.scoredReal), scoredXG: parseFloat(seasonB.scoredXG), concededReal: parseFloat(seasonB.concededReal), concededXG: parseFloat(seasonB.concededXG) };
    const ldA = combinedLambda(formA, !Object.values(sA).some(isNaN) ? sA : null);
    const ldB = combinedLambda(formB, !Object.values(sB).some(isNaN) ? sB : null);
    if (!ldA) { setError(`Saisis au moins 1 match pour ${nameA}.`); return; }
    if (!ldB) { setError(`Saisis au moins 1 match pour ${nameB}.`); return; }
    const leagueAvg = (ldA.scored + ldB.scored) / 2 || 1;
    const elo = eloFactor(eloA, eloB);
    const fatA = fatigueFactor(daysA), fatB = fatigueFactor(daysB);
    const wx = WEATHER_FACTOR[weather];
    const h2hF = h2hFactor();
    let lA = ((ldA.scored / leagueAvg) * (ldB.conceded / leagueAvg) * leagueAvg + HOME_BONUS[venue]) * ENJEU_FACTOR[enjeu] * elo.factorA * fatA * wx * h2hF.factorA;
    let lB = ((ldB.scored / leagueAvg) * (ldA.conceded / leagueAvg) * leagueAvg) * ENJEU_FACTOR[enjeu] * elo.factorB * fatB * wx * h2hF.factorB;
    if (absentA) lA *= 0.85;
    if (absentB) lB *= 0.85;
    lA = Math.max(0.1, lA); lB = Math.max(0.1, lB);
    const res = computeMatch(lA, lB);
    setResult({ ...res, lambdaA: lA, lambdaB: lB });
    setShowResults(true);
  };

  const reset = () => {
    setStep(0); setShowResults(false); setResult(null); setError("");
    setTeamA(null); setTeamB(null);
    setMatchesA(Array.from({ length: 5 }, emptyMatch)); setMatchesB(Array.from({ length: 5 }, emptyMatch));
    setSeasonA(emptySeason()); setSeasonB(emptySeason());
    setAbsentA(false); setAbsentB(false);
    setEloA(""); setEloB(""); setDaysA(""); setDaysB("");
    setWeather("normal"); setH2H(Array.from({ length: 5 }, emptyH2H));
    setBookOdds({ A: "", draw: "", B: "" }); setOpenOdds({ A: "", draw: "", B: "" });
    setActiveTeam("A"); setVenue("home"); setEnjeu("normal");
  };

  const top5 = result ? [...result.grid].sort((a, b) => b.p - a.p).slice(0, 5) : [];

  const ENJEU_OPTS = [["high", "🔥 Fort"], ["normal", "➡️ Normal"], ["low", "😴 Faible"]];
  const WEATHER_OPTS = [["normal", "☀️ Normal"], ["rain", "🌧️ Pluie"], ["wind", "💨 Vent"], ["cold", "🥶 Froid"], ["heat", "🥵 Chaleur"]];

  if (!apiKey) return <SetupScreen onSave={setApiKey} />;

  return (
    <div style={{ minHeight: "100vh", background: GRAY_BG, color: TEXT, fontFamily: "system-ui, sans-serif", padding: "18px 14px", maxWidth: 480, margin: "0 auto" }}>
      {loading && <LoadingOverlay message={loadingMsg} />}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, background: GREEN, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <i className="ti ti-ball-football" style={{ color: "#fff", fontSize: 18 }} aria-hidden="true" />
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 500, color: TEXT, letterSpacing: "-0.03em" }}>BetQuant</div>
            <div style={{ fontSize: 10, color: TEXT_MUTED, letterSpacing: "0.05em", textTransform: "uppercase" }}>Analyse quantitative</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 500, background: GREEN_BG, color: GREEN, padding: "3px 10px", borderRadius: 20 }}>V4</span>
          <button onClick={() => { localStorage.removeItem("betquant_api_key"); setApiKey(""); }}
            style={{ fontSize: 11, color: TEXT_MUTED, background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
            <i className="ti ti-key" style={{ fontSize: 14 }} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Main nav tabs */}
      <div style={{ display: "flex", gap: 0, marginBottom: 16, background: CARD_BG, borderRadius: 10, padding: 3, border: `0.5px solid ${BORDER}` }}>
        {[["analyse", "Analyser"], ["tracker", "Tracker"]].map(([k, l]) => (
          <button key={k} onClick={() => setMainTab(k)} style={{ flex: 1, padding: "9px", borderRadius: 8, fontSize: 13, fontWeight: mainTab === k ? 500 : 400, border: "none", cursor: "pointer", background: mainTab === k ? GREEN : "transparent", color: mainTab === k ? "#fff" : TEXT_MUTED }}>
            {l}
          </button>
        ))}
      </div>

      {mainTab === "tracker" && <Tracker prefillMatch={teamA && teamB ? `${teamA.name} — ${teamB.name}` : ""} />}

      {mainTab === "analyse" && <>

      {!showResults && <StepBar current={step} />}

      {/* ── STEP 0 : Match ── */}
      {!showResults && step === 0 && (
        <>
          <Card>
            <TeamSearch label={`Équipe A — domicile`} color={BLUE} colorBg={BLUE_BG} selected={teamA} onSelect={t => handleTeamSelect(t, "A")} apiKey={apiKey} />
            <TeamSearch label={`Équipe B — extérieur`} color={TEAL} colorBg={TEAL_BG} selected={teamB} onSelect={t => handleTeamSelect(t, "B")} apiKey={apiKey} />
          </Card>

          <Card>
            <SectionLabel>📍 Lieu du match</SectionLabel>
            <TabGroup options={[["home", `🏠 ${nameA} dom.`], ["neutral", "⚖️ Neutre"], ["away", `✈️ ${nameA} ext.`]]} value={venue} onChange={setVenue} color={GREEN} />
            <div style={{ marginTop: 6, fontSize: 11, color: TEXT_MUTED, fontFamily: "monospace" }}>
              {venue === "home" ? `→ ${nameA} +0.30 buts` : venue === "away" ? `→ ${nameA} −0.15 buts` : "→ Aucun bonus terrain"}
            </div>
          </Card>

          <Card>
            <SectionLabel>🎯 Enjeu</SectionLabel>
            <TabGroup options={ENJEU_OPTS} value={enjeu} onChange={setEnjeu} color={GREEN} />
            <div style={{ marginTop: 6, fontSize: 11, color: TEXT_MUTED, fontFamily: "monospace" }}>
              {enjeu === "high" ? "→ ×1.05 (élimination, derby, titre)" : enjeu === "low" ? "→ ×0.90 (rotation probable)" : "→ ×1.00"}
            </div>
          </Card>

          {error && <div style={{ padding: "10px 12px", background: RED_BG, border: `0.5px solid ${RED_BORDER}`, borderRadius: 8, fontSize: 12, color: RED, marginBottom: 12 }}>⚠ {error}</div>}

          <button onClick={goToContext} style={{ width: "100%", padding: "13px", borderRadius: 10, background: GREEN, color: "#fff", fontWeight: 500, fontSize: 14, border: "none", cursor: "pointer" }}>
            Suivant → Contexte & stats
          </button>
        </>
      )}

      {/* ── STEP 1 : Contexte ── */}
      {!showResults && step === 1 && (
        <>
          {/* Team tabs */}
          <div style={{ display: "flex", gap: 0, marginBottom: 14, background: CARD_BG, borderRadius: 10, padding: 3, border: `0.5px solid ${BORDER}` }}>
            {[["A", nameA, BLUE], ["B", nameB, TEAL]].map(([key, name, color]) => (
              <button key={key} onClick={() => setActiveTeam(key)} style={{ flex: 1, padding: "9px", borderRadius: 8, fontSize: 13, fontWeight: activeTeam === key ? 500 : 400, border: "none", cursor: "pointer", background: activeTeam === key ? color : "transparent", color: activeTeam === key ? "#fff" : TEXT_MUTED }}>
                {name}
              </button>
            ))}
          </div>

          {[["A", nameA, BLUE, matchesA, setMatchesA, seasonA, setSeasonA, absentA, setAbsentA], ["B", nameB, TEAL, matchesB, setMatchesB, seasonB, setSeasonB, absentB, setAbsentB]].map(([key, name, color, matches, setMatches, season, setSeason, absent, setAbsent]) => activeTeam === key && (
            <div key={key}>
              <div style={{ fontSize: 11, color: TEXT_MUTED, marginBottom: 8 }}>5 derniers matchs — <span style={{ color, fontWeight: 500 }}>{name}</span></div>
              {matches.map((m, i) => <MatchRow key={i} idx={i} match={m} color={color} onChange={v => { const n = [...matches]; n[i] = v; setMatches(n); }} />)}
              <Card>
                <div style={{ fontSize: 11, fontWeight: 500, color, marginBottom: 8 }}>📊 Moyenne saison <span style={{ color: TEXT_MUTED, fontWeight: 400 }}>· poids ×{SEASON_WEIGHT}</span></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 5 }}>
                  <div><div style={{ fontSize: 10, color: TEXT_MUTED, marginBottom: 3 }}>⚽ Mq.</div><NumInput value={season.scoredReal} onChange={v => setSeason(s => ({ ...s, scoredReal: v }))} placeholder="1.7" /></div>
                  <div><div style={{ fontSize: 10, color: TEXT_MUTED, marginBottom: 3 }}>📐 xG+</div><NumInput value={season.scoredXG} onChange={v => setSeason(s => ({ ...s, scoredXG: v }))} placeholder="1.9" /></div>
                  <div><div style={{ fontSize: 10, color: TEXT_MUTED, marginBottom: 3 }}>🛡 Enc.</div><NumInput value={season.concededReal} onChange={v => setSeason(s => ({ ...s, concededReal: v }))} placeholder="0.9" /></div>
                  <div><div style={{ fontSize: 10, color: TEXT_MUTED, marginBottom: 3 }}>📐 xG-</div><NumInput value={season.concededXG} onChange={v => setSeason(s => ({ ...s, concededXG: v }))} placeholder="1.1" /></div>
                </div>
                <div style={{ borderTop: `0.5px solid ${BORDER}`, marginTop: 10, paddingTop: 10 }}>
                  <Toggle value={absent} onChange={setAbsent} label="🚑 Joueur clé absent (−15%)" />
                </div>
              </Card>
            </div>
          ))}

          <Card>
            <SectionLabel>📊 ELO <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, fontSize: 11 }}>(clubelo.com · optionnel)</span></SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
              <div><div style={{ fontSize: 11, color: TEXT_MUTED, marginBottom: 4 }}>{nameA}</div><NumInput value={eloA} onChange={setEloA} placeholder="ex: 1820" /></div>
              <div><div style={{ fontSize: 11, color: TEXT_MUTED, marginBottom: 4 }}>{nameB}</div><NumInput value={eloB} onChange={setEloB} placeholder="ex: 1740" /></div>
            </div>
            <SectionLabel>😴 Jours depuis dernier match</SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
              <div><div style={{ fontSize: 11, color: TEXT_MUTED, marginBottom: 4 }}>{nameA}</div><NumInput value={daysA} onChange={setDaysA} placeholder="ex: 3" /></div>
              <div><div style={{ fontSize: 11, color: TEXT_MUTED, marginBottom: 4 }}>{nameB}</div><NumInput value={daysB} onChange={setDaysB} placeholder="ex: 7" /></div>
            </div>
            <SectionLabel>🌤️ Météo</SectionLabel>
            <TabGroup options={WEATHER_OPTS} value={weather} onChange={setWeather} color="#0ea5e9" />
          </Card>

          <Card>
            <SectionLabel>⚔️ H2H — 5 dernières confrontations</SectionLabel>
            {h2h.map((m, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto 1fr", gap: 6, alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: TEXT_MUTED, width: 48 }}>Match {i + 1}</span>
                <div><div style={{ fontSize: 10, color: TEXT_MUTED, marginBottom: 3 }}>{nameA}</div><NumInput value={m.goalsA} onChange={v => { const n = [...h2h]; n[i] = { ...m, goalsA: v }; setH2H(n); }} placeholder="2" /></div>
                <span style={{ fontSize: 11, color: BORDER, textAlign: "center" }}>–</span>
                <div><div style={{ fontSize: 10, color: TEXT_MUTED, marginBottom: 3 }}>{nameB}</div><NumInput value={m.goalsB} onChange={v => { const n = [...h2h]; n[i] = { ...m, goalsB: v }; setH2H(n); }} placeholder="1" /></div>
              </div>
            ))}
          </Card>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button onClick={() => setStep(0)} style={{ padding: "12px", borderRadius: 10, background: CARD_BG, color: TEXT_SUB, fontWeight: 500, fontSize: 13, border: `0.5px solid ${BORDER}`, cursor: "pointer" }}>← Retour</button>
            <button onClick={() => setStep(2)} style={{ padding: "12px", borderRadius: 10, background: GREEN, color: "#fff", fontWeight: 500, fontSize: 13, border: "none", cursor: "pointer" }}>Suivant →</button>
          </div>
        </>
      )}

      {/* ── STEP 2 : Marché ── */}
      {!showResults && step === 2 && (
        <>
          <Card>
            <SectionLabel>🏦 Cotes actuelles</SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {[["A", nameA], ["draw", "Nul"], ["B", nameB]].map(([k, l]) => (
                <div key={k}><div style={{ fontSize: 11, color: TEXT_MUTED, marginBottom: 4 }}>{l}</div><NumInput value={bookOdds[k]} onChange={v => setBookOdds(o => ({ ...o, [k]: v }))} placeholder="1.80" /></div>
              ))}
            </div>
          </Card>

          <Card>
            <SectionLabel>📉 Mouvement de cotes <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, fontSize: 11 }}>(cotes d'ouverture)</span></SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
              {[["A", nameA], ["draw", "Nul"], ["B", nameB]].map(([k, l]) => (
                <div key={k}><div style={{ fontSize: 11, color: TEXT_MUTED, marginBottom: 4 }}>{l} ouv.</div><NumInput value={openOdds[k]} onChange={v => setOpenOdds(o => ({ ...o, [k]: v }))} placeholder="2.10" /></div>
              ))}
            </div>
            {["A", "draw", "B"].map(k => {
              const mv = oddsMovement(k);
              if (!mv) return null;
              const label = k === "A" ? nameA : k === "draw" ? "Nul" : nameB;
              return <div key={k} style={{ fontSize: 11, color: mv.dropping ? GREEN : mv.rising ? RED : TEXT_MUTED, marginBottom: 3, fontFamily: "monospace" }}>
                {mv.dropping ? "📉" : mv.rising ? "📈" : "→"} {label} : {mv.dropping ? `−${mv.move.toFixed(1)}% → signal positif` : mv.rising ? `+${Math.abs(mv.move).toFixed(1)}% → signal négatif` : "stable"}
              </div>;
            })}
          </Card>

          {error && <div style={{ padding: "10px 12px", background: RED_BG, border: `0.5px solid ${RED_BORDER}`, borderRadius: 8, fontSize: 12, color: RED, marginBottom: 12 }}>⚠ {error}</div>}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button onClick={() => setStep(1)} style={{ padding: "12px", borderRadius: 10, background: CARD_BG, color: TEXT_SUB, fontWeight: 500, fontSize: 13, border: `0.5px solid ${BORDER}`, cursor: "pointer" }}>← Retour</button>
            <button onClick={compute} style={{ padding: "12px", borderRadius: 10, background: GREEN, color: "#fff", fontWeight: 500, fontSize: 13, border: "none", cursor: "pointer" }}>Calculer →</button>
          </div>
        </>
      )}

      {/* ── RESULTS ── */}
      {showResults && result && (
        <>
          {/* Match header */}
          <Card style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {teamA?.logo && <img src={teamA.logo} alt="" style={{ width: 24, height: 24, objectFit: "contain" }} />}
                <span style={{ fontSize: 14, fontWeight: 500, color: BLUE }}>{nameA}</span>
              </div>
              <span style={{ fontSize: 11, color: TEXT_MUTED, padding: "3px 10px", background: GRAY_BG, borderRadius: 6 }}>VS</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 500, color: TEAL }}>{nameB}</span>
                {teamB?.logo && <img src={teamB.logo} alt="" style={{ width: 24, height: 24, objectFit: "contain" }} />}
              </div>
            </div>
          </Card>

          {/* Lambda */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            {[{ label: nameA, val: result.lambdaA, color: BLUE }, { label: nameB, val: result.lambdaB, color: TEAL }].map(({ label, val, color }) => (
              <div key={label} style={{ background: CARD_BG, border: `0.5px solid ${BORDER}`, borderRadius: 12, padding: 12, textAlign: "center" }}>
                <div style={{ fontSize: 10, color: TEXT_MUTED, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>λ {label}</div>
                <div style={{ fontSize: 26, fontWeight: 500, color, fontFamily: "monospace" }}>{val.toFixed(2)}</div>
                <div style={{ fontSize: 10, color: TEXT_MUTED }}>buts attendus</div>
              </div>
            ))}
          </div>

          {/* Probabilities */}
          <Card>
            <SectionLabel>📈 Probabilités & value bets</SectionLabel>
            <ProbBar label={`Victoire ${nameA}`} prob={result.winA} bookOdds={bookOdds.A} color={BLUE} />
            <ProbBar label="Match nul" prob={result.draw} bookOdds={bookOdds.draw} color="#94a3b8" />
            <ProbBar label={`Victoire ${nameB}`} prob={result.winB} bookOdds={bookOdds.B} color={TEAL} />
          </Card>

          {/* Top 5 scores */}
          <Card>
            <SectionLabel>🎯 Scores les plus probables</SectionLabel>
            {top5.map(({ i, j, p }, idx) => (
              <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: idx < 4 ? `0.5px solid ${BORDER}` : "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 11, color: TEXT_MUTED, width: 14 }}>{idx + 1}.</span>
                  <span style={{ fontFamily: "monospace", fontWeight: 500, fontSize: 15, color: TEXT }}>{i} – {j}</span>
                  <span style={{ fontSize: 11, color: TEXT_MUTED }}>{i > j ? nameA : i === j ? "Nul" : nameB}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ background: BAR_BG, borderRadius: 3, height: 4, width: 44, overflow: "hidden" }}>
                    <div style={{ width: `${(p / top5[0].p) * 100}%`, height: "100%", background: GREEN, borderRadius: 3 }} />
                  </div>
                  <span style={{ fontFamily: "monospace", fontSize: 12, color: TEXT_SUB, minWidth: 36, textAlign: "right" }}>{(p * 100).toFixed(1)}%</span>
                </div>
              </div>
            ))}
          </Card>

          {/* Verdict */}
          {(() => {
            const values = [["A", result.winA, nameA], ["draw", result.draw, "Match nul"], ["B", result.winB, nameB]]
              .map(([k, prob, label]) => { const v = valueInfo(prob, bookOdds[k]); return v && v.isValue ? { label, edge: v.edge, prob } : null; })
              .filter(Boolean).sort((a, b) => b.edge - a.edge);
            return (
              <div style={{ background: values.length > 0 ? GREEN_LIGHT : GRAY_BG, border: `0.5px solid ${values.length > 0 ? GREEN_BORDER : BORDER}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: values.length > 0 ? GREEN : TEXT_SUB, marginBottom: values.length > 0 ? 10 : 0, display: "flex", alignItems: "center", gap: 6 }}>
                  <i className={`ti ti-${values.length > 0 ? "target" : "search"}`} aria-hidden="true" />
                  {values.length > 0 ? "Verdict — value bet détecté" : "Verdict — aucune value détectée"}
                </div>
                {values.map((v, i) => (
                  <div key={i} style={{ background: CARD_BG, border: `0.5px solid ${GREEN_BORDER}`, borderRadius: 8, padding: "10px 12px", marginBottom: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: GREEN }}>{v.label}</div>
                    <div style={{ fontSize: 11, color: GREEN, marginTop: 2 }}>Prob. modèle {(v.prob * 100).toFixed(1)}% · Edge +{v.edge.toFixed(1)}%</div>
                  </div>
                ))}
                {values.length === 0 && !bookOdds.A && <div style={{ fontSize: 11, color: TEXT_MUTED, marginTop: 4 }}>Renseigne les cotes pour détecter les value bets.</div>}
              </div>
            );
          })()}

          {/* Odds movement */}
          {["A", "draw", "B"].some(k => oddsMovement(k)) && (
            <Card>
              <SectionLabel>📉 Signaux marché</SectionLabel>
              {["A", "draw", "B"].map(k => {
                const mv = oddsMovement(k);
                if (!mv) return null;
                const label = k === "A" ? nameA : k === "draw" ? "Nul" : nameB;
                return <div key={k} style={{ fontSize: 12, color: mv.dropping ? GREEN : mv.rising ? RED : TEXT_SUB, marginBottom: 4, fontFamily: "monospace" }}>
                  {mv.dropping ? "📉" : mv.rising ? "📈" : "→"} {label} : {mv.dropping ? `cote en baisse ${mv.move.toFixed(1)}% → signal positif` : `cote en hausse ${Math.abs(mv.move).toFixed(1)}% → signal négatif`}
                </div>;
              })}
            </Card>
          )}

          <button onClick={reset} style={{ width: "100%", padding: "12px", borderRadius: 10, background: CARD_BG, color: TEXT_SUB, fontWeight: 500, fontSize: 14, border: `0.5px solid ${BORDER}`, cursor: "pointer" }}>
            ← Nouveau match
          </button>
        </>
      )}

      </>}

      <div style={{ textAlign: "center", fontSize: 10, color: TEXT_MUTED, marginTop: 20, opacity: 0.5 }}>BetQuant V4 · Usage personnel</div>
    </div>
  );
}