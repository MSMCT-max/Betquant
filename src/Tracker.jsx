import { useState, useEffect, useRef } from "react";

const GREEN = "#16a34a";
const GREEN_BG = "#dcfce7";
const GREEN_BORDER = "#bbf7d0";
const GREEN_LIGHT = "#f0fdf4";
const BLUE = "#2563eb";
const BLUE_BG = "#eff6ff";
const RED = "#dc2626";
const RED_BG = "#fee2e2";
const RED_BORDER = "#fecaca";
const AMBER = "#92400e";
const AMBER_BG = "#fef9c3";
const GRAY_BG = "#f8f9fa";
const CARD_BG = "#ffffff";
const BORDER = "#e5e7eb";
const TEXT = "#111827";
const TEXT_SUB = "#6b7280";
const TEXT_MUTED = "#9ca3af";
const BAR_BG = "#f1f5f9";

const STORAGE_BETS = "bq_bets_v2";
const STORAGE_BANKROLL = "bq_bankroll";
const DEFAULT_BANKROLL = 500;

function loadBets() { try { return JSON.parse(localStorage.getItem(STORAGE_BETS) || "[]"); } catch { return []; } }
function saveBets(b) { localStorage.setItem(STORAGE_BETS, JSON.stringify(b)); }
function loadBankroll() { try { return JSON.parse(localStorage.getItem(STORAGE_BANKROLL) || JSON.stringify({ start: DEFAULT_BANKROLL, current: DEFAULT_BANKROLL })); } catch { return { start: DEFAULT_BANKROLL, current: DEFAULT_BANKROLL }; } }
function saveBankroll(b) { localStorage.setItem(STORAGE_BANKROLL, JSON.stringify(b)); }

function kellyStake(bankroll, edge, odds) {
  if (!edge || !odds || odds <= 1) return null;
  const e = edge / 100;
  const kelly = (e / (odds - 1));
  return {
    full: Math.max(0, bankroll * kelly),
    half: Math.max(0, bankroll * kelly / 2),
    quarter: Math.max(0, bankroll * kelly / 4),
  };
}

const Card = ({ children, style }) => (
  <div style={{ background: CARD_BG, border: `0.5px solid ${BORDER}`, borderRadius: 12, padding: 14, marginBottom: 10, ...style }}>{children}</div>
);

const Lbl = ({ children }) => (
  <div style={{ fontSize: 10, fontWeight: 500, color: TEXT_MUTED, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5 }}>{children}</div>
);

const NumIn = ({ value, onChange, placeholder, style }) => (
  <input type="number" min="0" step="0.01" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
    style={{ background: GRAY_BG, border: `0.5px solid ${BORDER}`, borderRadius: 6, color: TEXT, fontSize: 13, padding: "7px 9px", width: "100%", boxSizing: "border-box", fontFamily: "monospace", outline: "none", ...style }} />
);

const TextIn = ({ value, onChange, placeholder }) => (
  <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
    style={{ background: GRAY_BG, border: `0.5px solid ${BORDER}`, borderRadius: 6, color: TEXT, fontSize: 13, padding: "7px 9px", width: "100%", boxSizing: "border-box", outline: "none" }} />
);

function ResultBadge({ result }) {
  const cfg = { win: [GREEN_BG, GREEN, "Gagné"], lose: [RED_BG, RED, "Perdu"], pending: [AMBER_BG, AMBER, "En attente"] };
  const [bg, color, label] = cfg[result] || cfg.pending;
  return <span style={{ fontSize: 10, fontWeight: 500, padding: "2px 8px", borderRadius: 20, background: bg, color }}>{label}</span>;
}

function MiniChart({ bets }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resolved = [...bets].reverse().filter(b => b.result !== "pending");
    if (resolved.length < 2) { const ctx = canvas.getContext("2d"); ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
    let cum = 0;
    const data = resolved.map(b => { cum += b.gain; return parseFloat(cum.toFixed(2)); });
    const min = Math.min(0, ...data), max = Math.max(0, ...data);
    const range = max - min || 1;
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    const color = data[data.length - 1] >= 0 ? GREEN : RED;
    const px = (i) => (i / (data.length - 1)) * (w - 4) + 2;
    const py = (v) => h - 4 - ((v - min) / range) * (h - 8);
    ctx.beginPath();
    ctx.moveTo(px(0), py(data[0]));
    data.forEach((v, i) => { if (i > 0) ctx.lineTo(px(i), py(v)); });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    // Fill
    ctx.lineTo(px(data.length - 1), py(0));
    ctx.lineTo(px(0), py(0));
    ctx.closePath();
    ctx.fillStyle = color + "18";
    ctx.fill();
    // Zero line
    ctx.beginPath();
    ctx.moveTo(2, py(0));
    ctx.lineTo(w - 2, py(0));
    ctx.strokeStyle = BORDER;
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }, [bets]);
  return <canvas ref={canvasRef} width={340} height={80} style={{ width: "100%", height: 80 }} />;
}

export default function Tracker({ prefillMatch, prefillEdge, prefillOdds, prefillType }) {
  const [activeTab, setActiveTab] = useState("add");
  const [bets, setBets] = useState(loadBets);
  const [bankroll, setBankroll] = useState(loadBankroll);
  const [editingBankroll, setEditingBankroll] = useState(false);
  const [newBankrollStart, setNewBankrollStart] = useState("");

  // Form
  const [match, setMatch] = useState(prefillMatch || "");
  const [comp, setComp] = useState("");
  const [betType, setBetType] = useState(prefillType || "Match nul");
  const [odds, setOdds] = useState(prefillOdds || "");
  const [stake, setStake] = useState("");
  const [edge, setEdge] = useState(prefillEdge || "");
  const [kellyFraction, setKellyFraction] = useState("quarter");
  const [result, setResult] = useState("pending");
  const [msg, setMsg] = useState("");

  useEffect(() => { if (prefillMatch) setMatch(prefillMatch); }, [prefillMatch]);
  useEffect(() => { if (prefillEdge) setEdge(String(prefillEdge)); }, [prefillEdge]);
  useEffect(() => { if (prefillOdds) setOdds(String(prefillOdds)); }, [prefillOdds]);
  useEffect(() => { if (prefillType) setBetType(prefillType); }, [prefillType]);

  const kelly = kellyStake(bankroll.current, parseFloat(edge), parseFloat(odds));
  const kellyValue = kelly ? kelly[kellyFraction] : null;

  const applyKelly = () => { if (kellyValue) setStake(kellyValue.toFixed(2)); };

  const addBet = () => {
    if (!match || !odds || !stake) { setMsg("Remplis le match, la cote et la mise."); setTimeout(() => setMsg(""), 3000); return; }
    const o = parseFloat(odds), s = parseFloat(stake), e = parseFloat(edge);
    if (s > bankroll.current && result === "pending") { setMsg(`Mise supérieure à la bankroll (${bankroll.current.toFixed(2)}€)`); setTimeout(() => setMsg(""), 3000); return; }
    const gain = result === "win" ? parseFloat(((o - 1) * s).toFixed(2)) : result === "lose" ? -s : 0;
    const newBet = { id: Date.now(), date: new Date().toLocaleDateString("fr-FR"), match, comp: comp || "—", type: betType, odds: o, stake: s, edge: isNaN(e) ? null : e, result, gain, bankrollBefore: bankroll.current };

    // Update bankroll — mise toujours déduite immédiatement (argent engagé)
    // En attente : bankroll - mise
    // Gagné : bankroll - mise + (cote × mise) = bankroll + gain net
    // Perdu : bankroll - mise
    let newCurrent = parseFloat((bankroll.current - s).toFixed(2));
    if (result === "win") newCurrent = parseFloat((bankroll.current - s + (o * s)).toFixed(2));
    const newBankroll = { ...bankroll, current: Math.max(0, newCurrent) };

    const newBets = [newBet, ...bets];
    setBets(newBets); saveBets(newBets);
    setBankroll(newBankroll); saveBankroll(newBankroll);

    setMatch(""); setComp(""); setOdds(""); setStake(""); setEdge(""); setResult("pending");
    setMsg("Pari enregistré !"); setTimeout(() => setMsg(""), 2500);
  };

  const updateResult = (id, newResult) => {
    const bet = bets.find(b => b.id === id);
    if (!bet || bet.result !== "pending") return;
    const o = bet.odds, s = bet.stake;
    const gain = newResult === "win" ? parseFloat(((o - 1) * s).toFixed(2)) : -s;
    // La mise est DÉJÀ déduite de la bankroll lors de l'enregistrement
    // En attente → Gagné : on rembourse la mise + on ajoute le gain = on crédite cote × mise
    // En attente → Perdu : rien à faire, la mise est déjà déduite
    let newCurrent = bankroll.current;
    if (newResult === "win") newCurrent = parseFloat((bankroll.current + (o * s)).toFixed(2));
    const newBankroll = { ...bankroll, current: Math.max(0, newCurrent) };
    const newBets = bets.map(b => b.id === id ? { ...b, result: newResult, gain } : b);
    setBets(newBets); saveBets(newBets);
    setBankroll(newBankroll); saveBankroll(newBankroll);
  };

  const deleteBet = (id) => {
    const bet = bets.find(b => b.id === id);
    if (!bet) return;
    // Inverse l'effet sur la bankroll selon le statut
    // Gagné : on avait crédité cote×mise → on retire cote×mise
    // Perdu : on avait déduit la mise → on rembourse la mise
    // En attente : on avait déduit la mise → on rembourse la mise
    let newCurrent = bankroll.current;
    if (bet.result === "win") newCurrent = parseFloat((bankroll.current - (bet.odds * bet.stake)).toFixed(2));
    else newCurrent = parseFloat((bankroll.current + bet.stake).toFixed(2));
    const newBankroll = { ...bankroll, current: Math.max(0, newCurrent) };
    const newBets = bets.filter(b => b.id !== id);
    setBets(newBets); saveBets(newBets);
    setBankroll(newBankroll); saveBankroll(newBankroll);
  };

  const resetBankroll = () => {
    const v = parseFloat(newBankrollStart);
    if (isNaN(v) || v <= 0) return;
    const nb = { start: v, current: v };
    setBankroll(nb); saveBankroll(nb);
    setBets([]); saveBets([]);
    setEditingBankroll(false); setNewBankrollStart("");
  };

  // Stats
  const resolved = bets.filter(b => b.result !== "pending");
  const wins = bets.filter(b => b.result === "win");
  const losses = bets.filter(b => b.result === "lose");
  const pending = bets.filter(b => b.result === "pending");
  const totalStake = bets.reduce((s, b) => s + b.stake, 0);
  // Profit = bankroll actuelle - bankroll de départ (inclut paris en attente)
  const profit = parseFloat((bankroll.current - bankroll.start).toFixed(2));
  const roi = totalStake > 0 ? (profit / totalStake * 100) : null;
  const winRate = resolved.length > 0 ? (wins.length / resolved.length * 100) : null;
  const avgEdge = bets.filter(b => b.edge).length > 0 ? bets.filter(b => b.edge).reduce((s, b) => s + b.edge, 0) / bets.filter(b => b.edge).length : null;

  const brDiff = bankroll.current - bankroll.start;
  const brPct = bankroll.start > 0 ? (brDiff / bankroll.start * 100) : 0;

  const tabStyle = (t) => ({ padding: "8px 14px", fontSize: 13, cursor: "pointer", borderBottom: `2px solid ${activeTab === t ? GREEN : "transparent"}`, marginBottom: -1.5, color: activeTab === t ? GREEN : TEXT_MUTED, fontWeight: activeTab === t ? 500 : 400 });

  const BET_TYPES = ["Victoire A", "Match nul", "Victoire B", "BTTS", "Plus de 2.5", "Moins de 2.5", "Autre"];

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", color: TEXT }}>
      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: `1.5px solid ${BORDER}`, marginBottom: 16 }}>
        {[["add", "Ajouter"], ["track", "Suivi"], ["stats", "Stats"], ["bank", "Bankroll"]].map(([k, l]) => (
          <div key={k} style={tabStyle(k)} onClick={() => setActiveTab(k)}>{l}</div>
        ))}
      </div>

      {/* ── ADD ── */}
      {activeTab === "add" && (
        <>
          <Card>
            <Lbl>Match</Lbl>
            <TextIn value={match} onChange={setMatch} placeholder="ex: PSG — Lyon" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
              <div><Lbl>Compétition</Lbl><TextIn value={comp} onChange={setComp} placeholder="ex: Ligue 1" /></div>
              <div>
                <Lbl>Type de pari</Lbl>
                <select value={betType} onChange={e => setBetType(e.target.value)}
                  style={{ background: GRAY_BG, border: `0.5px solid ${BORDER}`, borderRadius: 6, color: TEXT, fontSize: 13, padding: "7px 9px", width: "100%", outline: "none" }}>
                  {BET_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
            </div>
          </Card>

          <Card>
            <Lbl>Cote & edge</Lbl>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
              <div><Lbl>Cote bookmaker</Lbl><NumIn value={odds} onChange={setOdds} placeholder="ex: 3.90" /></div>
              <div><Lbl>Edge BetQuant (%)</Lbl><NumIn value={edge} onChange={setEdge} placeholder="ex: 67" /></div>
            </div>

            {/* Kelly recommendation */}
            {kelly && (
              <div style={{ background: BLUE_BG, border: `0.5px solid #bfdbfe`, borderRadius: 8, padding: 10, marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 500, color: BLUE, marginBottom: 8 }}>
                  Mise recommandée par Kelly
                </div>
                <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                  {[["quarter", "¼ Kelly", kelly.quarter], ["half", "½ Kelly", kelly.half], ["full", "Kelly", kelly.full]].map(([k, l, v]) => (
                    <button key={k} onClick={() => setKellyFraction(k)} style={{ flex: 1, padding: "6px 4px", borderRadius: 6, fontSize: 11, fontWeight: 500, border: `0.5px solid ${kellyFraction === k ? BLUE : BORDER}`, background: kellyFraction === k ? "#dbeafe" : CARD_BG, color: kellyFraction === k ? BLUE : TEXT_MUTED, cursor: "pointer" }}>
                      {l}<br /><span style={{ fontFamily: "monospace", fontSize: 12 }}>{v.toFixed(2)}€</span>
                    </button>
                  ))}
                </div>
                <button onClick={applyKelly} style={{ width: "100%", padding: "7px", borderRadius: 6, background: BLUE, color: "#fff", fontWeight: 500, fontSize: 12, border: "none", cursor: "pointer" }}>
                  Utiliser {kelly[kellyFraction].toFixed(2)}€ comme mise →
                </button>
              </div>
            )}

            <div><Lbl>Mise (€) — bankroll dispo : <span style={{ color: GREEN, fontFamily: "monospace" }}>{bankroll.current.toFixed(2)}€</span></Lbl>
              <NumIn value={stake} onChange={setStake} placeholder="ex: 25" /></div>
          </Card>

          <Card>
            <Lbl>Résultat</Lbl>
            <div style={{ display: "flex", gap: 6 }}>
              {[["pending", "En attente", AMBER_BG, AMBER], ["win", "Gagné", GREEN_BG, GREEN], ["lose", "Perdu", RED_BG, RED]].map(([v, l, bg, color]) => (
                <button key={v} onClick={() => setResult(v)} style={{ flex: 1, padding: "8px 4px", borderRadius: 6, fontSize: 11, fontWeight: 500, border: `0.5px solid ${result === v ? color : BORDER}`, background: result === v ? bg : GRAY_BG, color: result === v ? color : TEXT_MUTED, cursor: "pointer" }}>{l}</button>
              ))}
            </div>
          </Card>

          <button onClick={addBet} style={{ width: "100%", padding: "13px", borderRadius: 10, background: GREEN, color: "#fff", fontWeight: 500, fontSize: 14, border: "none", cursor: "pointer" }}>
            Enregistrer →
          </button>
          {msg && <div style={{ textAlign: "center", fontSize: 12, color: msg.includes("!") ? GREEN : RED, marginTop: 8 }}>{msg}</div>}
        </>
      )}

      {/* ── TRACK ── */}
      {activeTab === "track" && (
        <Card>
          {bets.length === 0 ? (
            <div style={{ textAlign: "center", padding: 24, color: TEXT_MUTED, fontSize: 13 }}>Aucun pari enregistré.</div>
          ) : bets.map(b => (
            <div key={b.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "10px 0", borderBottom: `0.5px solid ${BAR_BG}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: TEXT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.match}</div>
                <div style={{ fontSize: 11, color: TEXT_MUTED, marginTop: 2 }}>{b.date} · {b.type} · cote {b.odds}</div>
                <div style={{ fontSize: 11, color: TEXT_MUTED }}>{b.comp} · mise {b.stake}€{b.edge ? ` · edge +${b.edge}%` : ""}</div>
                {b.result === "pending" && (
                  <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                    <button onClick={() => updateResult(b.id, "win")} style={{ padding: "3px 10px", borderRadius: 6, fontSize: 11, background: GREEN_BG, color: GREEN, border: `0.5px solid ${GREEN_BORDER}`, cursor: "pointer", fontWeight: 500 }}>Gagné</button>
                    <button onClick={() => updateResult(b.id, "lose")} style={{ padding: "3px 10px", borderRadius: 6, fontSize: 11, background: RED_BG, color: RED, border: `0.5px solid ${RED_BORDER}`, cursor: "pointer", fontWeight: 500 }}>Perdu</button>
                  </div>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, marginLeft: 10 }}>
                <ResultBadge result={b.result} />
                <span style={{ fontSize: 12, fontWeight: 500, color: b.result === "win" ? GREEN : b.result === "lose" ? RED : TEXT_MUTED, fontFamily: "monospace" }}>
                  {b.result === "win" ? `+${b.gain}€` : b.result === "lose" ? `-${b.stake}€` : "—"}
                </span>
                <button onClick={() => deleteBet(b.id)} style={{ fontSize: 11, color: TEXT_MUTED, background: "none", border: "none", cursor: "pointer", padding: 0 }}>✕</button>
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* ── STATS ── */}
      {activeTab === "stats" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
            {[
              ["Paris total", bets.length, TEXT],
              ["Taux réussite", winRate !== null ? `${winRate.toFixed(0)}%` : "—", BLUE],
              ["Profit net", resolved.length ? `${profit >= 0 ? "+" : ""}${profit.toFixed(2)}€` : "—", profit >= 0 ? GREEN : RED],
              ["ROI", roi !== null ? `${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%` : "—", roi !== null ? (roi >= 0 ? GREEN : RED) : TEXT_MUTED],
            ].map(([label, val, color]) => (
              <div key={label} style={{ background: CARD_BG, border: `0.5px solid ${BORDER}`, borderRadius: 12, padding: 12, textAlign: "center" }}>
                <div style={{ fontSize: 10, color: TEXT_MUTED, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 500, color, fontFamily: "monospace" }}>{val}</div>
              </div>
            ))}
          </div>

          <Card>
            {[
              ["Gagnés", wins.length, GREEN],
              ["Perdus", losses.length, RED],
              ["En attente", pending.length, AMBER],
              ["Mise totale", `${totalStake.toFixed(0)}€`, TEXT],
              ["Edge moyen", avgEdge ? `+${avgEdge.toFixed(1)}%` : "—", BLUE],
            ].map(([l, v, c]) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `0.5px solid ${BAR_BG}` }}>
                <span style={{ fontSize: 13, color: TEXT_SUB }}>{l}</span>
                <span style={{ fontSize: 13, fontWeight: 500, color: c, fontFamily: "monospace" }}>{v}</span>
              </div>
            ))}
          </Card>

          <Card>
            <div style={{ fontSize: 11, fontWeight: 500, color: TEXT_MUTED, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Évolution du profit</div>
            <MiniChart bets={bets} />
            {bets.filter(b => b.result !== "pending").length < 2 && (
              <div style={{ textAlign: "center", fontSize: 12, color: TEXT_MUTED, marginTop: 8 }}>Enregistre au moins 2 paris résolus pour voir le graphique.</div>
            )}
          </Card>
        </>
      )}

      {/* ── BANKROLL ── */}
      {activeTab === "bank" && (
        <>
          <Card style={{ background: brDiff >= 0 ? GREEN_LIGHT : "#fff5f5", border: `0.5px solid ${brDiff >= 0 ? GREEN_BORDER : RED_BORDER}` }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: brDiff >= 0 ? GREEN : RED, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Bankroll fictive actuelle</div>
              <div style={{ fontSize: 40, fontWeight: 500, color: brDiff >= 0 ? GREEN : RED, fontFamily: "monospace" }}>{bankroll.current.toFixed(2)}€</div>
              <div style={{ fontSize: 13, color: TEXT_MUTED, marginTop: 6 }}>
                Départ : {bankroll.start.toFixed(2)}€ ·
                <span style={{ color: brDiff >= 0 ? GREEN : RED, fontFamily: "monospace", marginLeft: 4 }}>
                  {brDiff >= 0 ? "+" : ""}{brDiff.toFixed(2)}€ ({brPct >= 0 ? "+" : ""}{brPct.toFixed(1)}%)
                </span>
              </div>
            </div>
            {/* Progress bar */}
            <div style={{ marginTop: 14, background: BAR_BG, borderRadius: 4, height: 6, overflow: "hidden" }}>
              <div style={{ width: `${Math.min(100, Math.max(0, (bankroll.current / bankroll.start) * 100))}%`, height: "100%", background: brDiff >= 0 ? GREEN : RED, borderRadius: 4 }} />
            </div>
          </Card>

          <Card>
            <div style={{ fontSize: 11, fontWeight: 500, color: TEXT_MUTED, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Évolution de la bankroll</div>
            <MiniChart bets={bets} />
          </Card>

          <Card>
            {[
              ["Mises totales engagées", `${bets.reduce((s,b) => s+b.stake, 0).toFixed(2)}€`, TEXT],
              ["Gains encaissés", `+${wins.reduce((s,b) => s+b.gain, 0).toFixed(2)}€`, GREEN],
              ["Pertes subies", `-${losses.reduce((s,b) => s+b.stake, 0).toFixed(2)}€`, RED],
              ["Paris en attente", `${pending.reduce((s,b) => s+b.stake, 0).toFixed(2)}€ engagés`, AMBER],
            ].map(([l, v, c]) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `0.5px solid ${BAR_BG}` }}>
                <span style={{ fontSize: 13, color: TEXT_SUB }}>{l}</span>
                <span style={{ fontSize: 13, fontWeight: 500, color: c, fontFamily: "monospace" }}>{v}</span>
              </div>
            ))}
          </Card>

          {/* Reset bankroll */}
          {!editingBankroll ? (
            <button onClick={() => setEditingBankroll(true)} style={{ width: "100%", padding: "11px", borderRadius: 10, background: CARD_BG, color: TEXT_SUB, fontWeight: 500, fontSize: 13, border: `0.5px solid ${BORDER}`, cursor: "pointer" }}>
              Réinitialiser la bankroll
            </button>
          ) : (
            <Card style={{ border: `0.5px solid ${RED_BORDER}`, background: RED_BG }}>
              <div style={{ fontSize: 12, color: RED, marginBottom: 10, fontWeight: 500 }}>⚠ Réinitialisation — tous les paris seront supprimés</div>
              <Lbl>Nouveau montant de départ (€)</Lbl>
              <NumIn value={newBankrollStart} onChange={setNewBankrollStart} placeholder="ex: 500" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
                <button onClick={() => setEditingBankroll(false)} style={{ padding: "10px", borderRadius: 8, background: CARD_BG, color: TEXT_SUB, fontWeight: 500, fontSize: 13, border: `0.5px solid ${BORDER}`, cursor: "pointer" }}>Annuler</button>
                <button onClick={resetBankroll} style={{ padding: "10px", borderRadius: 8, background: RED, color: "#fff", fontWeight: 500, fontSize: 13, border: "none", cursor: "pointer" }}>Confirmer</button>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}