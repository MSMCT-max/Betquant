import { useState } from "react";

const GREEN = "#16a34a";
const GREEN_BG = "#dcfce7";
const GREEN_BORDER = "#bbf7d0";
const BLUE = "#2563eb";
const BLUE_BG = "#eff6ff";
const TEAL = "#0d9488";
const RED = "#dc2626";
const RED_BG = "#fee2e2";
const GRAY_BG = "#f8f9fa";
const CARD_BG = "#ffffff";
const BORDER = "#e5e7eb";
const TEXT = "#111827";
const TEXT_SUB = "#6b7280";
const TEXT_MUTED = "#9ca3af";

const API_KEY = import.meta.env.VITE_ANTHROPIC_KEY;

const SYSTEM_PROMPT = `Tu es BetQuant Scout, un assistant spécialisé dans la collecte de données football pour l'analyse quantitative de paris sportifs.

Quand on te donne deux équipes, tu dois rechercher sur le web et retourner UNIQUEMENT un objet JSON valide avec cette structure exacte, sans texte avant ou après :

{
  "teamA": {
    "name": "Nom exact équipe A",
    "national": true/false,
    "elo": 1850,
    "matches": [
      {
        "opponent": "Nom adversaire",
        "scoredReal": 2,
        "scoredXG": 1.8,
        "concededReal": 1,
        "concededXG": 0.9,
        "venue": "home/away/neutral",
        "type": "official/minor/friendly",
        "date": "DD/MM/YYYY",
        "competition": "Nom compétition"
      }
    ],
    "season": {
      "scoredReal": 1.8,
      "scoredXG": 1.9,
      "concededReal": 0.9,
      "concededXG": 1.0
    },
    "daysSinceLastMatch": 5,
    "absentPlayers": "Nom joueur blessé ou null"
  },
  "teamB": {
    "name": "Nom exact équipe B",
    "national": true/false,
    "elo": 1790,
    "matches": [...],
    "season": {...},
    "daysSinceLastMatch": 3,
    "absentPlayers": null
  },
  "h2h": [
    {
      "goalsA": 2,
      "goalsB": 1,
      "date": "DD/MM/YYYY",
      "competition": "Nom"
    }
  ],
  "venue": "home/neutral/away",
  "weather": "normal/rain/wind/cold/heat",
  "enjeu": "high/normal/low",
  "matchDate": "DD/MM/YYYY HH:MM",
  "competition": "Nom de la compétition",
  "odds": {
    "A": 2.10,
    "draw": 3.40,
    "B": 3.20
  },
  "notes": "Informations importantes sur le match"
}

Règles importantes :
- matches : toujours les 5 derniers matchs joués, du plus récent au plus ancien
- xG : utilise les données de FBref, Sofascore ou WhoScored. Si indisponible, estime à partir des buts
- elo : cherche sur eloratings.net ou clubelo.com
- odds : cherche les cotes actuelles sur Oddschecker ou Betfair
- weather : cherche la météo prévue au lieu et à l'heure du match
- enjeu : high si match éliminatoire/derby/titre, low si sans enjeu, normal sinon
- venue : du point de vue de l'équipe A (home si A joue à domicile, away si A joue à l'extérieur, neutral si terrain neutre)
- Retourne UNIQUEMENT le JSON, rien d'autre`;

async function callClaude(teamA, teamB) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [
        {
          role: "user",
          content: `Collecte toutes les données nécessaires pour analyser le match : ${teamA} vs ${teamB}. 
          
Recherche sur le web :
1. Les 5 derniers matchs de ${teamA} avec scores et xG
2. Les 5 derniers matchs de ${teamB} avec scores et xG  
3. Les ELO des deux équipes (eloratings.net)
4. Le H2H entre ${teamA} et ${teamB} (5 dernières confrontations)
5. Les cotes actuelles pour ce match
6. La météo prévue au stade
7. Les absences/blessures connues
8. La compétition et la date du match
9. Les moyennes de la saison en cours pour les deux équipes

Retourne uniquement le JSON structuré.`
        }
      ]
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || `Erreur API: ${response.status}`);
  }

  const data = await response.json();
  const text = data.content
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("");

  // Extract JSON
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Impossible d'extraire les données du match.");
  
  return JSON.parse(jsonMatch[0]);
}

function MatchCard({ match, color, idx }) {
  const typeLabel = { official: "🏆 Officiel", minor: "🥈 Mineur", friendly: "🤝 Amical" };
  const venueLabel = { home: "🏠 Dom.", away: "✈️ Ext.", neutral: "⚖️ Neutre" };
  return (
    <div style={{ background: GRAY_BG, borderRadius: 8, padding: 10, marginBottom: 6, border: `0.5px solid ${idx === 0 ? color + "44" : BORDER}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: idx === 0 ? color : TEXT_SUB }}>
          vs {match.opponent}{idx === 0 ? " · récent" : ""}
        </span>
        <span style={{ fontSize: 10, color: TEXT_MUTED }}>{match.date} · {match.competition}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, marginBottom: 6 }}>
        {[["⚽ Mq.", match.scoredReal], ["📐 xG+", match.scoredXG], ["🛡 Enc.", match.concededReal], ["📐 xG-", match.concededXG]].map(([l, v]) => (
          <div key={l} style={{ textAlign: "center", background: CARD_BG, borderRadius: 6, padding: "4px 2px", border: `0.5px solid ${BORDER}` }}>
            <div style={{ fontSize: 9, color: TEXT_MUTED, marginBottom: 2 }}>{l}</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: TEXT, fontFamily: "monospace" }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, background: BLUE_BG, color: BLUE, fontWeight: 500 }}>{venueLabel[match.venue]}</span>
        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, background: GREEN_BG, color: GREEN, fontWeight: 500 }}>{typeLabel[match.type]}</span>
      </div>
    </div>
  );
}

function TeamSection({ team, color, title }) {
  if (!team) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 500, color, marginBottom: 8 }}>{title} — {team.name}</div>
      
      {/* Stats rapides */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 10 }}>
        {[
          ["ELO", team.elo || "—", BLUE],
          ["Repos", team.daysSinceLastMatch ? `${team.daysSinceLastMatch}j` : "—", GREEN],
          ["Absent", team.absentPlayers ? "⚠️ Oui" : "✅ Non", team.absentPlayers ? RED : GREEN],
        ].map(([l, v, c]) => (
          <div key={l} style={{ background: CARD_BG, border: `0.5px solid ${BORDER}`, borderRadius: 8, padding: "8px 6px", textAlign: "center" }}>
            <div style={{ fontSize: 9, color: TEXT_MUTED, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>{l}</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: c, fontFamily: "monospace" }}>{v}</div>
          </div>
        ))}
      </div>

      {team.absentPlayers && (
        <div style={{ background: RED_BG, border: `0.5px solid #fecaca`, borderRadius: 8, padding: "8px 10px", marginBottom: 10, fontSize: 12, color: RED }}>
          🚑 {team.absentPlayers}
        </div>
      )}

      {/* 5 derniers matchs */}
      <div style={{ fontSize: 11, color: TEXT_MUTED, marginBottom: 6 }}>5 derniers matchs</div>
      {(team.matches || []).map((m, i) => <MatchCard key={i} match={m} color={color} idx={i} />)}

      {/* Moyenne saison */}
      {team.season && (
        <div style={{ background: CARD_BG, border: `0.5px solid ${color}33`, borderRadius: 8, padding: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 500, color, marginBottom: 8 }}>📊 Moyenne saison</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6 }}>
            {[["⚽ Mq.", team.season.scoredReal], ["📐 xG+", team.season.scoredXG], ["🛡 Enc.", team.season.concededReal], ["📐 xG-", team.season.concededXG]].map(([l, v]) => (
              <div key={l} style={{ textAlign: "center", background: GRAY_BG, borderRadius: 6, padding: "4px 2px" }}>
                <div style={{ fontSize: 9, color: TEXT_MUTED, marginBottom: 2 }}>{l}</div>
                <div style={{ fontSize: 13, fontWeight: 500, color: TEXT, fontFamily: "monospace" }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Scout({ onImport }) {
  const [teamAInput, setTeamAInput] = useState("");
  const [teamBInput, setTeamBInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [imported, setImported] = useState(false);

  const analyze = async () => {
    if (!teamAInput.trim() || !teamBInput.trim()) {
      setError("Entre les deux équipes.");
      return;
    }
    if (!API_KEY) {
      setError("Clé API Anthropic manquante. Vérifie la configuration Vercel.");
      return;
    }
    setLoading(true);
    setError("");
    setData(null);
    setImported(false);

    const steps = [
      "Recherche des 5 derniers matchs...",
      "Collecte des xG et statistiques...",
      "Récupération des ELO...",
      "Recherche du H2H...",
      "Vérification des absences...",
      "Collecte des cotes bookmaker...",
      "Météo et conditions du match...",
      "Structuration des données...",
    ];

    let stepIdx = 0;
    setLoadingStep(steps[0]);
    const interval = setInterval(() => {
      stepIdx = (stepIdx + 1) % steps.length;
      setLoadingStep(steps[stepIdx]);
    }, 3000);

    try {
      const result = await callClaude(teamAInput.trim(), teamBInput.trim());
      setData(result);
    } catch (e) {
      setError(`Erreur : ${e.message}`);
    } finally {
      clearInterval(interval);
      setLoading(false);
      setLoadingStep("");
    }
  };

  const handleImport = () => {
    if (!data || !onImport) return;
    onImport(data);
    setImported(true);
  };

  const venueLabels = { home: `${data?.teamA?.name} dom.`, neutral: "Terrain neutre", away: `${data?.teamA?.name} ext.` };
  const weatherLabels = { normal: "☀️ Normal", rain: "🌧️ Pluie", wind: "💨 Vent", cold: "🥶 Froid", heat: "🥵 Chaleur" };
  const enjeuLabels = { high: "🔥 Fort", normal: "➡️ Normal", low: "😴 Faible" };

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", color: TEXT }}>

      {/* Search */}
      <div style={{ background: CARD_BG, border: `0.5px solid ${BORDER}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: TEXT_MUTED, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
          Analyse automatique d'un match
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 8, alignItems: "center", marginBottom: 12 }}>
          <input value={teamAInput} onChange={e => setTeamAInput(e.target.value)}
            placeholder="Équipe A (dom.)"
            style={{ background: teamAInput ? BLUE_BG : GRAY_BG, border: `0.5px solid ${teamAInput ? BLUE : BORDER}`, borderRadius: 8, color: teamAInput ? BLUE : TEXT, fontSize: 13, fontWeight: teamAInput ? 500 : 400, padding: "9px 10px", outline: "none" }} />
          <span style={{ fontSize: 11, color: TEXT_MUTED, fontWeight: 500 }}>VS</span>
          <input value={teamBInput} onChange={e => setTeamBInput(e.target.value)}
            placeholder="Équipe B (ext.)"
            style={{ background: teamBInput ? "#f0fdfa" : GRAY_BG, border: `0.5px solid ${teamBInput ? TEAL : BORDER}`, borderRadius: 8, color: teamBInput ? TEAL : TEXT, fontSize: 13, fontWeight: teamBInput ? 500 : 400, padding: "9px 10px", outline: "none" }} />
        </div>
        <button onClick={analyze} disabled={loading}
          style={{ width: "100%", padding: "12px", borderRadius: 10, background: loading ? "#9ca3af" : GREEN, color: "#fff", fontWeight: 500, fontSize: 14, border: "none", cursor: loading ? "not-allowed" : "pointer" }}>
          {loading ? "Analyse en cours..." : "Analyser le match →"}
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ background: BLUE_BG, border: `0.5px solid #bfdbfe`, borderRadius: 12, padding: 16, marginBottom: 12, textAlign: "center" }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>🔍</div>
          <div style={{ fontSize: 13, fontWeight: 500, color: BLUE, marginBottom: 4 }}>Claude Scout analyse le match</div>
          <div style={{ fontSize: 12, color: TEXT_SUB }}>{loadingStep}</div>
          <div style={{ marginTop: 12, background: "#bfdbfe", borderRadius: 4, height: 4, overflow: "hidden" }}>
            <div style={{ height: "100%", background: BLUE, borderRadius: 4, animation: "progress 3s ease-in-out infinite", width: "60%" }} />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ background: RED_BG, border: `0.5px solid #fecaca`, borderRadius: 10, padding: "12px 14px", marginBottom: 12, fontSize: 12, color: RED }}>
          ⚠️ {error}
        </div>
      )}

      {/* Results */}
      {data && !loading && (
        <>
          {/* Match header */}
          <div style={{ background: CARD_BG, border: `0.5px solid ${BORDER}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: BLUE }}>{data.teamA?.name}</span>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 10, color: TEXT_MUTED }}>{data.matchDate}</div>
                <div style={{ fontSize: 11, fontWeight: 500, color: TEXT_SUB }}>{data.competition}</div>
              </div>
              <span style={{ fontSize: 14, fontWeight: 500, color: TEAL }}>{data.teamB?.name}</span>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[
                [venueLabels[data.venue] || "—", BLUE],
                [enjeuLabels[data.enjeu] || "Normal", GREEN],
                [weatherLabels[data.weather] || "☀️ Normal", "#0ea5e9"],
              ].map(([l, c]) => (
                <span key={l} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 20, background: c + "15", color: c, fontWeight: 500 }}>{l}</span>
              ))}
            </div>
          </div>

          {/* Cotes */}
          {data.odds && (
            <div style={{ background: CARD_BG, border: `0.5px solid ${BORDER}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: TEXT_MUTED, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>🏦 Cotes bookmaker</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                {[[data.teamA?.name, data.odds.A, BLUE], ["Nul", data.odds.draw, TEXT_SUB], [data.teamB?.name, data.odds.B, TEAL]].map(([l, v, c]) => (
                  <div key={l} style={{ textAlign: "center", background: GRAY_BG, borderRadius: 8, padding: "8px 4px" }}>
                    <div style={{ fontSize: 10, color: TEXT_MUTED, marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l}</div>
                    <div style={{ fontSize: 18, fontWeight: 500, color: c, fontFamily: "monospace" }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Teams data */}
          <div style={{ background: CARD_BG, border: `0.5px solid ${BORDER}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
            <TeamSection team={data.teamA} color={BLUE} title="Équipe A" />
            <TeamSection team={data.teamB} color={TEAL} title="Équipe B" />
          </div>

          {/* H2H */}
          {data.h2h && data.h2h.length > 0 && (
            <div style={{ background: CARD_BG, border: `0.5px solid ${BORDER}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: TEXT_MUTED, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>⚔️ H2H</div>
              {data.h2h.map((m, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: i < data.h2h.length - 1 ? `0.5px solid #f1f5f9` : "none" }}>
                  <span style={{ fontSize: 12, color: TEXT_SUB }}>{m.date}</span>
                  <span style={{ fontSize: 14, fontWeight: 500, color: TEXT, fontFamily: "monospace" }}>{m.goalsA} — {m.goalsB}</span>
                  <span style={{ fontSize: 11, color: TEXT_MUTED }}>{m.competition}</span>
                </div>
              ))}
            </div>
          )}

          {/* Notes */}
          {data.notes && (
            <div style={{ background: "#fefce8", border: `0.5px solid #fef08a`, borderRadius: 10, padding: "10px 12px", marginBottom: 12, fontSize: 12, color: "#854d0e" }}>
              ℹ️ {data.notes}
            </div>
          )}

          {/* Import button */}
          <button onClick={handleImport} disabled={imported}
            style={{ width: "100%", padding: "14px", borderRadius: 10, background: imported ? "#9ca3af" : `linear-gradient(135deg, #4f46e5, ${GREEN})`, color: "#fff", fontWeight: 500, fontSize: 14, border: "none", cursor: imported ? "not-allowed" : "pointer", marginBottom: 8 }}>
            {imported ? "✅ Données importées dans BetQuant !" : "Importer dans BetQuant →"}
          </button>

          {imported && (
            <div style={{ textAlign: "center", fontSize: 12, color: GREEN }}>
              Va sur l'onglet "Analyser" — toutes les données sont pré-remplies !
            </div>
          )}
        </>
      )}

      <style>{`
        @keyframes progress {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(100%); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
    </div>
  );
}