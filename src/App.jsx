import { useState, useEffect, useRef } from "react";
import { searchTeams, getLastFixtures, getSeasonStats, getH2H, getDaysSinceLastMatch, validateApiKey } from "./api.js";

// ─── Constants ────────────────────────────────────────────────────────────
const TYPE_WEIGHT = { official: 1.0, minor: 0.7, friendly: 0.3 };
const RECENCY_WEIGHT = [1.0, 0.85, 0.7, 0.55, 0.4];
const FORM_WEIGHT = 0.6;
const SEASON_WEIGHT = 0.4;

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

function toOdds(p) {
  if (p <= 0.001) return "∞";
  return (1 / p).toFixed(2);
}

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

const WEATHER_FACTOR = { normal: 1.0, rain: 0.92, wind: 0.90, cold: 0.95, heat: 0.96 };
const HOME_BONUS = { home: 0.3, away: -0.15, neutral: 0 };
const ENJEU_FACTOR = { high: 1.05, normal: 1.0, low: 0.90 };

// ─── UI Primitives ────────────────────────────────────────────────────────
const C = { bg: "#020c1b", surface: "#0a1628", deep: "#07111f", border: "#1e293b", textMain: "#f1f5f9", textSub: "#64748b", textMuted: "#334155", indigo: "#6366f1", indigoLight: "#818cf8", amber: "#f59e0b", green: "#4ade80", red: "#f87171", teal: "#2dd4bf" };

const s = {
  label: { fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textSub, display: "block", marginBottom: 4 },
  input: { background: C.deep, border: `1px solid ${C.border}`, borderRadius: 8, color: C.textMain, fontSize: 14, padding: "9px 11px", width: "100%", boxSizing: "border-box", outline: "none", fontFamily: "inherit" },
  numInput: { background: C.deep, border: `1px solid ${C.border}`, borderRadius: 6, color: C.textMain, fontSize: 13, padding: "7px 9px", width: "100%", boxSizing: "border-box", fontFamily: "monospace", outline: "none" },
  section: { background: C.surface, borderRadius: 12, padding: 14, border: `1px solid ${C.border}`, marginBottom: 12 },
  btn: (bg, color = "#fff") => ({ width: "100%", padding: "13px", borderRadius: 10, background: bg, color, fontWeight: 800, fontSize: 14, border: "none", cursor: "pointer" }),
  smallBtn: (active, color) => ({ flex: 1, padding: "5px 4px", borderRadius: 6, fontSize: 10, fontWeight: 700, border: `1px solid ${active ? color : C.border}`, background: active ? `${color}22` : C.deep, color: active ? color : C.textSub, cursor: "pointer" }),
};

const Lbl = ({ children }) => <span style={s.label}>{children}</span>;
const Num = ({ value, onChange, placeholder }) => <input type="number" min="0" step="0.01" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={s.numInput} />;
const Tabs = ({ options, value, onChange, color }) => <div style={{ display: "flex", gap: 4 }}>{options.map(([v, l]) => <button key={v} onClick={() => onChange(v)} style={s.smallBtn(value === v, color)}>{l}</button>)}</div>;

// ─── Team Search ──────────────────────────────────────────────────────────
function TeamSearch({ label, color, onSelect, selected, apiKey }) {
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
      try {
        const teams = await searchTeams(q, apiKey);
        setResults(teams.slice(0, 5));
      } catch (e) { setResults([]); }
      setLoading(false);
    }, 600);
  };

  return (
    <div style={{ position: "relative" }}>
      <Lbl>{label}</Lbl>
      <div style={{ position: "relative" }}>
        <input value={query} onChange={e => search(e.target.value)} placeholder="Tape le nom de l'équipe..." style={{ ...s.input, borderColor: selected ? color : C.border, color: selected ? color : C.textMain, fontWeight: selected ? 700 : 400 }} />
        {loading && <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: C.textSub }}>...</span>}
      </div>
      {results.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, zIndex: 100, overflow: "hidden", marginTop: 4 }}>
          {results.map(t => (
            <div key={t.id} onClick={() => { onSelect(t); setQuery(t.name); setResults([]); }}
              style={{ padding: "10px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${C.border}` }}
              onMouseEnter={e => e.currentTarget.style.background = C.deep}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              {t.logo && <img src={t.logo} alt="" style={{ width: 20, height: 20, objectFit: "contain" }} />}
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.textMain }}>{t.name}</div>
                <div style={{ fontSize: 10, color: C.textSub }}>{t.country}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Setup Screen ─────────────────────────────────────────────────────────
function SetupScreen({ onSave }) {
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const validate = async () => {
    if (!key.trim()) { setError("Entre ta clé API."); return; }
    setLoading(true); setError("");
    const result = await validateApiKey(key.trim());
    setLoading(false);
    if (result.valid) {
      localStorage.setItem("betquant_api_key", key.trim());
      onSave(key.trim());
    } else {
      setError("Clé invalide. Vérifie sur api-sports.io → Mon accès.");
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ maxWidth: 380, width: "100%" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>⚽</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: C.textMain, letterSpacing: "-0.03em" }}>BetQuant</div>
          <div style={{ fontSize: 13, color: C.textSub, marginTop: 6 }}>Outil de paris quantitatif football</div>
        </div>

        <div style={s.section}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.textMain, marginBottom: 6 }}>🔑 Ta clé API-Football</div>
            <div style={{ fontSize: 12, color: C.textSub, lineHeight: 1.6 }}>
              Récupère ta clé sur <span style={{ color: C.indigoLight }}>api-sports.io</span> → Tableau de bord → Mon accès
            </div>
          </div>
          <input
            type="password"
            value={key}
            onChange={e => setKey(e.target.value)}
            placeholder="Colle ta clé ici..."
            style={{ ...s.input, marginBottom: 12, fontFamily: "monospace", fontSize: 13 }}
          />
          {error && <div style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>⚠️ {error}</div>}
          <button onClick={validate} disabled={loading} style={s.btn(`linear-gradient(135deg, #4f46e5, #6366f1)`)}>
            {loading ? "Vérification..." : "Valider et démarrer →"}
          </button>
        </div>

        <div style={{ fontSize: 11, color: C.textMuted, textAlign: "center", lineHeight: 1.6 }}>
          Ta clé est stockée uniquement sur ton appareil.<br />Elle n'est jamais envoyée à nos serveurs.
        </div>
      </div>
    </div>
  );
}

// ─── Loading overlay ──────────────────────────────────────────────────────
function LoadingOverlay({ message }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(2,12,27,0.92)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ fontSize: 36, marginBottom: 16, animation: "spin 1s linear infinite" }}>⚽</div>
      <div style={{ fontSize: 14, color: C.textSub }}>{message}</div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── Step bar ─────────────────────────────────────────────────────────────
function StepBar({ current }) {
  const steps = ["Match", "Contexte", "Marché"];
  return (
    <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
      {steps.map((s, i) => (
        <div key={i} style={{ flex: 1 }}>
          <div style={{ height: 3, borderRadius: 2, marginBottom: 3, background: i <= current ? C.indigo : C.border }} />
          <span style={{ fontSize: 9, fontWeight: 700, color: i === current ? C.indigoLight : i < current ? C.indigo : C.border, textTransform: "uppercase", letterSpacing: "0.06em" }}>{s}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Match row ────────────────────────────────────────────────────────────
const VENUE_OPTS = [["home", "🏠 Dom."], ["away", "✈️ Ext."], ["neutral", "⚖️ Ntr."]];
const TYPE_OPTS = [["official", "🏆 Off."], ["minor", "🥈 Min."], ["friendly", "🤝 Am."]];

function MatchRow({ idx, match, onChange, color }) {
  return (
    <div style={{ background: C.deep, borderRadius: 8, padding: 10, marginBottom: 6, border: `1px solid ${idx === 0 ? color + "44" : C.border}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: idx === 0 ? color : C.textSub }}>
          {match.opponent ? `vs ${match.opponent}` : `Match ${idx + 1}`}{idx === 0 ? " · récent" : ""}
        </span>
        <span style={{ fontSize: 9, color: "#1e3a5f" }}>×{(TYPE_WEIGHT[match.type] * RECENCY_WEIGHT[idx]).toFixed(2)}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 5, marginBottom: 6 }}>
        <div><Lbl>⚽ Mq.</Lbl><Num value={match.scoredReal} onChange={v => onChange({ ...match, scoredReal: v })} placeholder="2" /></div>
        <div><Lbl>📐 xG+</Lbl><Num value={match.scoredXG} onChange={v => onChange({ ...match, scoredXG: v })} placeholder="1.8" /></div>
        <div><Lbl>🛡️ Enc.</Lbl><Num value={match.concededReal} onChange={v => onChange({ ...match, concededReal: v })} placeholder="1" /></div>
        <div><Lbl>📐 xG-</Lbl><Num value={match.concededXG} onChange={v => onChange({ ...match, concededXG: v })} placeholder="0.7" /></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
        <div><Lbl>Lieu</Lbl><Tabs options={VENUE_OPTS} value={match.venue} onChange={v => onChange({ ...match, venue: v })} color={color} /></div>
        <div><Lbl>Type</Lbl><Tabs options={TYPE_OPTS} value={match.type} onChange={v => onChange({ ...match, type: v })} color={color} /></div>
      </div>
    </div>
  );
}

// ─── Prob bar ─────────────────────────────────────────────────────────────
function ProbBar({ label, prob, bookOdds, color }) {
  const v = bookOdds ? valueInfo(prob, bookOdds) : null;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.textMain }}>{label}</span>
        <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
          <span style={{ fontSize: 21, fontWeight: 800, color, fontFamily: "monospace" }}>{(prob * 100).toFixed(1)}%</span>
          <span style={{ fontSize: 11, color: C.textSub, fontFamily: "monospace" }}>cote {toOdds(prob)}</span>
        </div>
      </div>
      <div style={{ background: C.border, borderRadius: 4, height: 5, overflow: "hidden", marginBottom: v ? 5 : 0 }}>
        <div style={{ width: `${Math.min(prob * 100, 100)}%`, height: "100%", background: color, borderRadius: 4 }} />
      </div>
      {v && (
        <div style={{ padding: "4px 10px", borderRadius: 6, display: "inline-flex", alignItems: "center", gap: 5, background: v.isValue ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.07)", border: `1px solid ${v.isValue ? "rgba(74,222,128,0.25)" : "rgba(248,113,113,0.15)"}` }}>
          <span style={{ fontSize: 13 }}>{v.isValue ? "✅" : "❌"}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: v.isValue ? C.green : C.red }}>
            {v.isValue ? `Value bet · edge +${v.edge.toFixed(1)}%` : `Pas de value · edge ${v.edge.toFixed(1)}%`}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────
const emptyMatch = () => ({ scoredReal: "", scoredXG: "", concededReal: "", concededXG: "", venue: "home", type: "official", opponent: "" });
const emptySeason = () => ({ scoredReal: "", scoredXG: "", concededReal: "", concededXG: "" });
const emptyH2H = () => ({ goalsA: "", goalsB: "" });

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("betquant_api_key") || "");
  const [step, setStep] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [error, setError] = useState("");

  // Teams
  const [teamA, setTeamA] = useState(null);
  const [teamB, setTeamB] = useState(null);

  // Step 0
  const [venue, setVenue] = useState("home");
  const [enjeu, setEnjeu] = useState("normal");

  // Matches
  const [matchesA, setMatchesA] = useState(Array.from({ length: 5 }, emptyMatch));
  const [matchesB, setMatchesB] = useState(Array.from({ length: 5 }, emptyMatch));
  const [seasonA, setSeasonA] = useState(emptySeason());
  const [seasonB, setSeasonB] = useState(emptySeason());
  const [activeTeam, setActiveTeam] = useState("A");

  // Context
  const [absentA, setAbsentA] = useState(false);
  const [absentB, setAbsentB] = useState(false);
  const [eloA, setEloA] = useState("");
  const [eloB, setEloB] = useState("");
  const [daysA, setDaysA] = useState("");
  const [daysB, setDaysB] = useState("");
  const [weather, setWeather] = useState("normal");
  const [h2h, setH2H] = useState(Array.from({ length: 5 }, emptyH2H));

  // Market
  const [bookOdds, setBookOdds] = useState({ A: "", draw: "", B: "" });
  const [openOdds, setOpenOdds] = useState({ A: "", draw: "", B: "" });

  const [result, setResult] = useState(null);

  // Auto-load team data
  const loadTeamData = async (team, side) => {
    if (!team || !apiKey) return;
    setLoading(true);
    const national = team.national === true;
    try {
      setLoadingMsg(`Chargement des matchs de ${team.name}...`);
      const fixtures = await getLastFixtures(team.id, apiKey, national);
      const mapped = fixtures.map(f => ({
        scoredReal: String(f.scoredReal),
        scoredXG: f.scoredXG ? String(f.scoredXG) : String(f.scoredReal),
        concededReal: String(f.concededReal),
        concededXG: f.concededXG ? String(f.concededXG) : String(f.concededReal),
        venue: f.venue,
        type: f.type,
        opponent: f.opponent,
      }));
      while (mapped.length < 5) mapped.push(emptyMatch());
      if (side === "A") setMatchesA(mapped);
      else setMatchesB(mapped);

      setLoadingMsg(`Chargement fatigue ${team.name}...`);
      const days = await getDaysSinceLastMatch(team.id, apiKey, national);
      if (days !== null) {
        if (side === "A") setDaysA(String(days));
        else setDaysB(String(days));
      }
    } catch (e) {
      setError(`Erreur chargement ${team.name}: ${e.message}`);
    }
    setLoading(false);
    setLoadingMsg("");
  };

  const loadH2HData = async () => {
    if (!teamA || !teamB || !apiKey) return;
    setLoading(true);
    setLoadingMsg("Chargement de l'historique H2H...");
    try {
      const data = await getH2H(teamA.id, teamB.id, apiKey);
      const mapped = data.map(m => ({ goalsA: String(m.goalsA), goalsB: String(m.goalsB) }));
      while (mapped.length < 5) mapped.push(emptyH2H());
      setH2H(mapped);
    } catch (e) { /* H2H not critical */ }
    setLoading(false);
    setLoadingMsg("");
  };

  const handleTeamSelect = async (team, side) => {
    if (side === "A") setTeamA(team);
    else setTeamB(team);
    await loadTeamData(team, side);
  };

  const goToContext = async () => {
    if (!teamA || !teamB) { setError("Sélectionne les deux équipes."); return; }
    setError("");
    await loadH2HData();
    setStep(1);
  };

  // H2H factor
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
    const formA = weightedFormAvg(matchesA);
    const formB = weightedFormAvg(matchesB);
    const sA = { scoredReal: parseFloat(seasonA.scoredReal), scoredXG: parseFloat(seasonA.scoredXG), concededReal: parseFloat(seasonA.concededReal), concededXG: parseFloat(seasonA.concededXG) };
    const sB = { scoredReal: parseFloat(seasonB.scoredReal), scoredXG: parseFloat(seasonB.scoredXG), concededReal: parseFloat(seasonB.concededReal), concededXG: parseFloat(seasonB.concededXG) };
    const hasSeasonA = !Object.values(sA).some(isNaN);
    const hasSeasonB = !Object.values(sB).some(isNaN);
    const ldA = combinedLambda(formA, hasSeasonA ? sA : null);
    const ldB = combinedLambda(formB, hasSeasonB ? sB : null);
    if (!ldA) { setError(`Saisis au moins 1 match pour ${teamA?.name || "Équipe A"}.`); return; }
    if (!ldB) { setError(`Saisis au moins 1 match pour ${teamB?.name || "Équipe B"}.`); return; }
    const leagueAvg = (ldA.scored + ldB.scored) / 2 || 1;
    const enjeuF = ENJEU_FACTOR[enjeu];
    const elo = eloFactor(eloA, eloB);
    const fatA = fatigueFactor(daysA);
    const fatB = fatigueFactor(daysB);
    const wx = WEATHER_FACTOR[weather];
    const h2hF = h2hFactor();
    let lA = ((ldA.scored / leagueAvg) * (ldB.conceded / leagueAvg) * leagueAvg + HOME_BONUS[venue]) * enjeuF * elo.factorA * fatA * wx * h2hF.factorA;
    let lB = ((ldB.scored / leagueAvg) * (ldA.conceded / leagueAvg) * leagueAvg) * enjeuF * elo.factorB * fatB * wx * h2hF.factorB;
    if (absentA) lA *= 0.85;
    if (absentB) lB *= 0.85;
    lA = Math.max(0.1, lA); lB = Math.max(0.1, lB);
    const res = computeMatch(lA, lB);
    setResult({ ...res, lambdaA: lA, lambdaB: lB, elo, fatA, fatB, wx, h2hF });
    setShowResults(true);
  };

  const reset = () => {
    setStep(0); setShowResults(false); setResult(null); setError("");
    setTeamA(null); setTeamB(null);
    setMatchesA(Array.from({ length: 5 }, emptyMatch));
    setMatchesB(Array.from({ length: 5 }, emptyMatch));
    setSeasonA(emptySeason()); setSeasonB(emptySeason());
    setAbsentA(false); setAbsentB(false);
    setEloA(""); setEloB(""); setDaysA(""); setDaysB("");
    setWeather("normal"); setH2H(Array.from({ length: 5 }, emptyH2H));
    setBookOdds({ A: "", draw: "", B: "" }); setOpenOdds({ A: "", draw: "", B: "" });
    setActiveTeam("A"); setVenue("home"); setEnjeu("normal");
  };

  const top5 = result ? [...result.grid].sort((a, b) => b.p - a.p).slice(0, 5) : [];
  const nameA = teamA?.name || "Équipe A";
  const nameB = teamB?.name || "Équipe B";

  const ENJEU_OPTS = [["high", "🔥 Fort"], ["normal", "➡️ Normal"], ["low", "😴 Faible"]];
  const WEATHER_OPTS = [["normal", "☀️"], ["rain", "🌧️"], ["wind", "💨"], ["cold", "🥶"], ["heat", "🥵"]];

  if (!apiKey) return <SetupScreen onSave={setApiKey} />;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.textMain, fontFamily: "'Inter', system-ui, sans-serif", padding: "18px 14px", maxWidth: 480, margin: "0 auto" }}>
      {loading && <LoadingOverlay message={loadingMsg} />}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 20 }}>⚽</span>
          <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.03em" }}>BetQuant</span>
          <span style={{ fontSize: 10, fontWeight: 700, background: "rgba(251,146,60,0.15)", color: "#fb923c", padding: "2px 8px", borderRadius: 20, textTransform: "uppercase" }}>V3</span>
        </div>
        <button onClick={() => { localStorage.removeItem("betquant_api_key"); setApiKey(""); }}
          style={{ fontSize: 10, color: C.textSub, background: "transparent", border: "none", cursor: "pointer" }}>🔑 Changer clé</button>
      </div>

      {!showResults && <StepBar current={step} />}

      {/* ── STEP 0 : Match + Équipes ── */}
      {!showResults && step === 0 && (
        <>
          <div style={s.section}>
            <div style={{ marginBottom: 12 }}>
              <TeamSearch label={`⚽ ${nameA} (domicile)`} color={C.indigo} selected={teamA} onSelect={t => handleTeamSelect(t, "A")} apiKey={apiKey} />
            </div>
            <TeamSearch label={`⚽ ${nameB} (extérieur)`} color={C.amber} selected={teamB} onSelect={t => handleTeamSelect(t, "B")} apiKey={apiKey} />
          </div>

          <div style={s.section}>
            <Lbl>📍 Lieu</Lbl>
            <Tabs options={[[`home`, `🏠 ${nameA} dom.`], ["neutral", "⚖️ Neutre"], ["away", `✈️ ${nameA} ext.`]]} value={venue} onChange={setVenue} color={C.indigo} />
          </div>

          <div style={s.section}>
            <Lbl>🎯 Enjeu du match</Lbl>
            <Tabs options={ENJEU_OPTS} value={enjeu} onChange={setEnjeu} color="#10b981" />
            <div style={{ marginTop: 6, fontSize: 11, color: C.textMuted, fontFamily: "monospace" }}>
              {enjeu === "high" ? "→ ×1.05 (élimination, derby, titre)" : enjeu === "low" ? "→ ×0.90 (sans enjeu, rotation)" : "→ ×1.00"}
            </div>
          </div>

          {error && <div style={{ padding: "10px 12px", background: "rgba(248,113,113,0.08)", borderRadius: 8, border: "1px solid rgba(248,113,113,0.2)", marginBottom: 10 }}><span style={{ fontSize: 12, color: C.red }}>⚠️ {error}</span></div>}

          <button onClick={goToContext} style={s.btn("linear-gradient(135deg, #4f46e5, #6366f1)")}>
            Suivant → Contexte & stats
          </button>
        </>
      )}

      {/* ── STEP 1 : Contexte ── */}
      {!showResults && step === 1 && (
        <>
          {/* Team tabs */}
          <div style={{ display: "flex", gap: 0, marginBottom: 12, background: C.surface, borderRadius: 10, padding: 3, border: `1px solid ${C.border}` }}>
            {[["A", nameA, C.indigo], ["B", nameB, C.amber]].map(([key, name, color]) => (
              <button key={key} onClick={() => setActiveTeam(key)} style={{ flex: 1, padding: "9px", borderRadius: 8, fontSize: 13, fontWeight: 700, border: "none", cursor: "pointer", background: activeTeam === key ? color : "transparent", color: activeTeam === key ? "#fff" : C.textSub }}>
                {name}
              </button>
            ))}
          </div>

          {activeTeam === "A" ? (
            <>
              <div style={{ fontSize: 11, color: C.textSub, marginBottom: 8 }}>5 derniers matchs — <span style={{ color: C.indigoLight }}>{nameA}</span></div>
              {matchesA.map((m, i) => <MatchRow key={i} idx={i} match={m} color={C.indigo} onChange={v => { const n = [...matchesA]; n[i] = v; setMatchesA(n); }} />)}
              <div style={{ background: C.deep, borderRadius: 8, padding: 10, border: `1px solid ${C.indigo}22`, marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.indigo, marginBottom: 8 }}>📊 Moyenne saison <span style={{ color: C.textMuted, fontWeight: 400 }}>· poids ×{SEASON_WEIGHT}</span></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 5 }}>
                  <div><Lbl>⚽ Mq.</Lbl><Num value={seasonA.scoredReal} onChange={v => setSeasonA(s => ({ ...s, scoredReal: v }))} placeholder="1.7" /></div>
                  <div><Lbl>📐 xG+</Lbl><Num value={seasonA.scoredXG} onChange={v => setSeasonA(s => ({ ...s, scoredXG: v }))} placeholder="1.9" /></div>
                  <div><Lbl>🛡️ Enc.</Lbl><Num value={seasonA.concededReal} onChange={v => setSeasonA(s => ({ ...s, concededReal: v }))} placeholder="0.9" /></div>
                  <div><Lbl>📐 xG-</Lbl><Num value={seasonA.concededXG} onChange={v => setSeasonA(s => ({ ...s, concededXG: v }))} placeholder="1.1" /></div>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: C.deep, borderRadius: 8, padding: "10px 12px", border: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 13, color: "#94a3b8" }}>🚑 Joueur clé absent (−15%)</span>
                <button onClick={() => setAbsentA(a => !a)} style={{ padding: "4px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700, border: `1px solid ${absentA ? C.red : C.border}`, background: absentA ? "rgba(248,113,113,0.15)" : C.surface, color: absentA ? C.red : C.textSub, cursor: "pointer" }}>
                  {absentA ? "Oui −15%" : "Non"}
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 11, color: C.textSub, marginBottom: 8 }}>5 derniers matchs — <span style={{ color: C.amber }}>{nameB}</span></div>
              {matchesB.map((m, i) => <MatchRow key={i} idx={i} match={m} color={C.amber} onChange={v => { const n = [...matchesB]; n[i] = v; setMatchesB(n); }} />)}
              <div style={{ background: C.deep, borderRadius: 8, padding: 10, border: `1px solid ${C.amber}22`, marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.amber, marginBottom: 8 }}>📊 Moyenne saison <span style={{ color: C.textMuted, fontWeight: 400 }}>· poids ×{SEASON_WEIGHT}</span></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 5 }}>
                  <div><Lbl>⚽ Mq.</Lbl><Num value={seasonB.scoredReal} onChange={v => setSeasonB(s => ({ ...s, scoredReal: v }))} placeholder="1.7" /></div>
                  <div><Lbl>📐 xG+</Lbl><Num value={seasonB.scoredXG} onChange={v => setSeasonB(s => ({ ...s, scoredXG: v }))} placeholder="1.9" /></div>
                  <div><Lbl>🛡️ Enc.</Lbl><Num value={seasonB.concededReal} onChange={v => setSeasonB(s => ({ ...s, concededReal: v }))} placeholder="0.9" /></div>
                  <div><Lbl>📐 xG-</Lbl><Num value={seasonB.concededXG} onChange={v => setSeasonB(s => ({ ...s, concededXG: v }))} placeholder="1.1" /></div>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: C.deep, borderRadius: 8, padding: "10px 12px", border: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 13, color: "#94a3b8" }}>🚑 Joueur clé absent (−15%)</span>
                <button onClick={() => setAbsentB(a => !a)} style={{ padding: "4px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700, border: `1px solid ${absentB ? C.red : C.border}`, background: absentB ? "rgba(248,113,113,0.15)" : C.surface, color: absentB ? C.red : C.textSub, cursor: "pointer" }}>
                  {absentB ? "Oui −15%" : "Non"}
                </button>
              </div>
            </>
          )}

          {/* ELO + Fatigue */}
          <div style={{ ...s.section, marginTop: 12 }}>
            <div style={{ marginBottom: 10 }}><Lbl>📊 ELO <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(clubelo.com · optionnel)</span></Lbl></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
              <div><Lbl>{nameA}</Lbl><Num value={eloA} onChange={setEloA} placeholder="ex: 1820" /></div>
              <div><Lbl>{nameB}</Lbl><Num value={eloB} onChange={setEloB} placeholder="ex: 1740" /></div>
            </div>
            <div style={{ marginBottom: 10 }}><Lbl>😴 Jours depuis dernier match</Lbl></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
              <div><Lbl>{nameA}</Lbl><Num value={daysA} onChange={setDaysA} placeholder="ex: 3" /></div>
              <div><Lbl>{nameB}</Lbl><Num value={daysB} onChange={setDaysB} placeholder="ex: 7" /></div>
            </div>
            <div style={{ marginBottom: 8 }}><Lbl>🌤️ Météo</Lbl></div>
            <Tabs options={WEATHER_OPTS} value={weather} onChange={setWeather} color="#0ea5e9" />
          </div>

          {/* H2H */}
          <div style={s.section}>
            <div style={{ marginBottom: 10 }}><Lbl>⚔️ H2H — 5 dernières confrontations</Lbl></div>
            {h2h.map((m, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto 1fr", gap: 6, alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: C.textMuted, width: 50 }}>Match {i + 1}</span>
                <div><Lbl>{nameA}</Lbl><Num value={m.goalsA} onChange={v => { const n = [...h2h]; n[i] = { ...m, goalsA: v }; setH2H(n); }} placeholder="2" /></div>
                <span style={{ fontSize: 11, color: C.border, textAlign: "center" }}>–</span>
                <div><Lbl>{nameB}</Lbl><Num value={m.goalsB} onChange={v => { const n = [...h2h]; n[i] = { ...m, goalsB: v }; setH2H(n); }} placeholder="1" /></div>
              </div>
            ))}
            {(() => { const f = h2hFactor(); return f.valid > 0 ? <div style={{ marginTop: 8, padding: "8px 10px", background: C.deep, borderRadius: 8, fontSize: 11, color: C.textSub, fontFamily: "monospace" }}>{nameA} {f.winsA}V · {f.draws}N · {f.winsB}D {nameB}</div> : null; })()}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button onClick={() => setStep(0)} style={{ ...s.btn("transparent", C.textSub), border: `1px solid ${C.border}` }}>← Retour</button>
            <button onClick={() => setStep(2)} style={s.btn("linear-gradient(135deg, #4f46e5, #6366f1)")}>Suivant →</button>
          </div>
        </>
      )}

      {/* ── STEP 2 : Marché ── */}
      {!showResults && step === 2 && (
        <>
          <div style={s.section}>
            <div style={{ marginBottom: 10 }}><Lbl>🏦 Cotes actuelles</Lbl></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {[["A", nameA], ["draw", "Nul"], ["B", nameB]].map(([k, l]) => <div key={k}><Lbl>{l}</Lbl><Num value={bookOdds[k]} onChange={v => setBookOdds(o => ({ ...o, [k]: v }))} placeholder="1.80" /></div>)}
            </div>
          </div>

          <div style={s.section}>
            <div style={{ marginBottom: 10 }}><Lbl>📉 Mouvement de cotes <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(cotes d'ouverture)</span></Lbl></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
              {[["A", nameA], ["draw", "Nul"], ["B", nameB]].map(([k, l]) => <div key={k}><Lbl>{l} ouv.</Lbl><Num value={openOdds[k]} onChange={v => setOpenOdds(o => ({ ...o, [k]: v }))} placeholder="2.10" /></div>)}
            </div>
            {["A", "draw", "B"].map(k => {
              const mv = oddsMovement(k);
              if (!mv) return null;
              const label = k === "A" ? nameA : k === "draw" ? "Nul" : nameB;
              return <div key={k} style={{ fontSize: 11, fontFamily: "monospace", color: mv.dropping ? C.green : mv.rising ? C.red : C.textSub, marginBottom: 3 }}>
                {mv.dropping ? "📉" : mv.rising ? "📈" : "→"} {label} : {mv.dropping ? `−${mv.move.toFixed(1)}% → argent intelligent ici` : mv.rising ? `+${Math.abs(mv.move).toFixed(1)}% → marché fuit` : "stable"}
              </div>;
            })}
          </div>

          {error && <div style={{ padding: "10px 12px", background: "rgba(248,113,113,0.08)", borderRadius: 8, border: "1px solid rgba(248,113,113,0.2)", marginBottom: 10 }}><span style={{ fontSize: 12, color: C.red }}>⚠️ {error}</span></div>}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button onClick={() => setStep(1)} style={{ ...s.btn("transparent", C.textSub), border: `1px solid ${C.border}` }}>← Retour</button>
            <button onClick={compute} style={s.btn("linear-gradient(135deg, #059669, #10b981)")}>Calculer →</button>
          </div>
        </>
      )}

      {/* ── RESULTS ── */}
      {showResults && result && (
        <>
          <div style={{ background: C.surface, borderRadius: 10, padding: "10px 14px", marginBottom: 12, border: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 3 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {teamA?.logo && <img src={teamA.logo} alt="" style={{ width: 18, height: 18, objectFit: "contain" }} />}
                <span style={{ color: C.indigoLight, fontWeight: 700 }}>{nameA}</span>
              </div>
              <span style={{ color: C.textSub, fontSize: 11 }}>VS</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: C.amber, fontWeight: 700 }}>{nameB}</span>
                {teamB?.logo && <img src={teamB.logo} alt="" style={{ width: 18, height: 18, objectFit: "contain" }} />}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            {[{ label: nameA, val: result.lambdaA, color: C.indigo }, { label: nameB, val: result.lambdaB, color: C.amber }].map(({ label, val, color }) => (
              <div key={label} style={{ background: C.surface, borderRadius: 10, padding: 12, border: `1px solid ${C.border}`, textAlign: "center" }}>
                <div style={{ fontSize: 9, color: C.textSub, fontWeight: 700, textTransform: "uppercase", marginBottom: 3 }}>λ {label}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color, fontFamily: "monospace" }}>{val.toFixed(2)}</div>
                <div style={{ fontSize: 9, color: C.textMuted }}>buts attendus</div>
              </div>
            ))}
          </div>

          <div style={s.section}>
            <div style={{ marginBottom: 12 }}><Lbl>📈 Probabilités & Value bets</Lbl></div>
            <ProbBar label={`Victoire ${nameA}`} prob={result.winA} bookOdds={bookOdds.A} color={C.indigo} />
            <ProbBar label="Match nul" prob={result.draw} bookOdds={bookOdds.draw} color="#94a3b8" />
            <ProbBar label={`Victoire ${nameB}`} prob={result.winB} bookOdds={bookOdds.B} color={C.amber} />
          </div>

          <div style={s.section}>
            <div style={{ marginBottom: 10 }}><Lbl>🎯 Scores les plus probables</Lbl></div>
            {top5.map(({ i, j, p }, idx) => (
              <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: idx < 4 ? `1px solid ${C.deep}` : "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 10, color: "#1e3a5f", width: 14 }}>{idx + 1}.</span>
                  <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 15 }}>{i} – {j}</span>
                  <span style={{ fontSize: 10, color: C.textMuted }}>{i > j ? nameA : i === j ? "Nul" : nameB}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ background: C.border, borderRadius: 3, height: 4, width: 44, overflow: "hidden" }}>
                    <div style={{ width: `${(p / top5[0].p) * 100}%`, height: "100%", background: C.indigo, borderRadius: 3 }} />
                  </div>
                  <span style={{ fontFamily: "monospace", fontSize: 12, color: C.textSub, minWidth: 34, textAlign: "right" }}>{(p * 100).toFixed(1)}%</span>
                </div>
              </div>
            ))}
          </div>

          {/* Verdict */}
          {(() => {
            const values = [];
            [["A", result.winA, nameA], ["draw", result.draw, "Match nul"], ["B", result.winB, nameB]].forEach(([k, prob, label]) => {
              const v = valueInfo(prob, bookOdds[k]);
              if (v && v.isValue) values.push({ label, edge: v.edge, prob });
            });
            values.sort((a, b) => b.edge - a.edge);
            return (
              <div style={{ background: values.length > 0 ? "rgba(74,222,128,0.07)" : "rgba(100,116,139,0.07)", borderRadius: 12, padding: 16, marginBottom: 14, border: `1px solid ${values.length > 0 ? "rgba(74,222,128,0.2)" : C.border}` }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: values.length > 0 ? C.green : C.textSub, marginBottom: 10 }}>
                  {values.length > 0 ? "🎯 VERDICT — Value bet(s) détecté(s)" : "🔍 VERDICT — Aucune value détectée"}
                </div>
                {values.map((v, i) => (
                  <div key={i} style={{ background: "rgba(74,222,128,0.1)", borderRadius: 8, padding: "8px 12px", marginBottom: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.green }}>✅ {v.label}</div>
                    <div style={{ fontSize: 11, color: "#86efac", fontFamily: "monospace" }}>Prob. modèle : {(v.prob * 100).toFixed(1)}% · Edge : +{v.edge.toFixed(1)}%</div>
                  </div>
                ))}
                {values.length === 0 && !bookOdds.A && <div style={{ fontSize: 11, color: C.textSub }}>Renseigne les cotes pour détecter les value bets.</div>}
              </div>
            );
          })()}

          <button onClick={reset} style={{ ...s.btn("transparent", C.textSub), border: `1px solid ${C.border}` }}>← Nouveau match</button>
        </>
      )}

      <p style={{ textAlign: "center", fontSize: 10, color: C.deep, marginTop: 18 }}>BetQuant V3 · Usage personnel</p>
    </div>
  );
}