import { useState } from "react";

const GREEN = "#16a34a";
const GREEN_BG = "#dcfce7";
const GREEN_BORDER = "#bbf7d0";
const BLUE = "#2563eb";
const RED = "#dc2626";
const RED_BG = "#fee2e2";
const GRAY_BG = "#f8f9fa";
const CARD_BG = "#ffffff";
const BORDER = "#e5e7eb";
const TEXT = "#111827";
const TEXT_SUB = "#6b7280";
const TEXT_MUTED = "#9ca3af";

// ─── Parser ───────────────────────────────────────────────────────────────

function parseNumber(str) {
  if (!str) return null;
  const n = parseFloat(String(str).replace(',', '.').trim());
  return isNaN(n) ? null : n;
}

function parseVenue(str) {
  if (!str) return "home";
  const s = str.toLowerCase();
  if (s.includes("dom") || s.includes("home")) return "home";
  if (s.includes("ext") || s.includes("away")) return "away";
  if (s.includes("neu") || s.includes("neutral")) return "neutral";
  return "home";
}

function parseType(str) {
  if (!str) return "official";
  const s = str.toLowerCase();
  if (s.includes("amical") || s.includes("friendly")) return "friendly";
  if (s.includes("mineur") || s.includes("minor") || s.includes("coupe")) return "minor";
  return "official";
}

function parseWeather(str) {
  if (!str) return "normal";
  const s = str.toLowerCase();
  if (s.includes("pluie") || s.includes("rain")) return "rain";
  if (s.includes("vent") || s.includes("wind")) return "wind";
  if (s.includes("froid") || s.includes("cold")) return "cold";
  if (s.includes("chaleur") || s.includes("heat") || s.includes("chaud")) return "heat";
  return "normal";
}

function parseEnjeu(str) {
  if (!str) return "normal";
  const s = str.toLowerCase();
  if (s.includes("fort") || s.includes("high") || s.includes("éliminatoire") || s.includes("eliminatoire")) return "high";
  if (s.includes("faible") || s.includes("low") || s.includes("sans enjeu")) return "low";
  return "normal";
}

function parseVenueMatch(str) {
  if (!str) return "home";
  const s = str.toLowerCase();
  if (s.includes("neutre") || s.includes("neutral")) return "neutral";
  if (s.includes("extérieur") || s.includes("exterieur") || s.includes("away") || s.includes("ext.")) return "away";
  return "home";
}

function parseMatchRows(text) {
  const matches = [];
  // Look for table rows with pipe characters
  const lines = text.split('\n');
  for (const line of lines) {
    if (!line.includes('│') && !line.includes('|')) continue;
    const sep = line.includes('│') ? '│' : '|';
    const cells = line.split(sep).map(c => c.trim()).filter(Boolean);
    if (cells.length < 6) continue;
    // Skip header/separator lines
    if (cells[0].toLowerCase().includes('adversaire') || cells[0].includes('─') || cells[0].includes('-') || cells[0].includes('═')) continue;
    if (cells[0].includes('┌') || cells[0].includes('├') || cells[0].includes('└')) continue;
    
    const scoredReal = parseNumber(cells[1]);
    const scoredXG = parseNumber(cells[2]);
    const concededReal = parseNumber(cells[3]);
    const concededXG = parseNumber(cells[4]);
    
    if (scoredReal === null && concededReal === null) continue;
    
    matches.push({
      opponent: cells[0].replace(/\[|\]/g, '').trim(),
      scoredReal: String(scoredReal ?? ""),
      scoredXG: String(scoredXG ?? scoredReal ?? ""),
      concededReal: String(concededReal ?? ""),
      concededXG: String(concededXG ?? concededReal ?? ""),
      venue: parseVenue(cells[5] || ""),
      type: parseType(cells[6] || ""),
    });
    
    if (matches.length >= 5) break;
  }
  return matches;
}

function parseSeason(text) {
  const scoredMatch = text.match(/buts\s+marqu[ée]s?\/match\s*[:：]\s*([\d.,]+)/i);
  const xgPlusMatch = text.match(/xg\+\s*[:：]\s*([\d.,]+)/i) || text.match(/xg\s+pour\s*[:：]\s*([\d.,]+)/i);
  const concededMatch = text.match(/buts\s+encaiss[ée]s?\/match\s*[:：]\s*([\d.,]+)/i);
  const xgMinusMatch = text.match(/xg-\s*[:：]\s*([\d.,]+)/i) || text.match(/xg\s+contre\s*[:：]\s*([\d.,]+)/i);
  
  return {
    scoredReal: String(parseNumber(scoredMatch?.[1]) ?? ""),
    scoredXG: String(parseNumber(xgPlusMatch?.[1]) ?? ""),
    concededReal: String(parseNumber(concededMatch?.[1]) ?? ""),
    concededXG: String(parseNumber(xgMinusMatch?.[1]) ?? ""),
  };
}

function parseH2H(text) {
  const h2h = [];
  const lines = text.split('\n');
  for (const line of lines) {
    // Match patterns like "2-1", "2 — 1", "2-0"
    const scoreMatch = line.match(/(\d+)\s*[—\-–]\s*(\d+)/);
    if (scoreMatch && !line.toLowerCase().includes('étape') && !line.toLowerCase().includes('step')) {
      h2h.push({
        goalsA: String(parseInt(scoreMatch[1])),
        goalsB: String(parseInt(scoreMatch[2])),
      });
      if (h2h.length >= 5) break;
    }
  }
  return h2h;
}

function parseText(text) {
  try {
    // Split into sections
    const sections = text.split(/ÉTAPE\s+\d+[A-B]?\s*[—\-–]\s*/i);
    
    // Find team names from match header
    const matchHeader = text.match(/MATCH\s*[:：]\s*(.+?)\s+vs\s+(.+?)(?:\n|$)/i);
    const teamAName = matchHeader?.[1]?.trim().replace(/[\[\]]/g, '') || "Équipe A";
    const teamBName = matchHeader?.[2]?.trim().replace(/[\[\]]/g, '') || "Équipe B";

    // Find venue and enjeu
    const venueMatch = text.match(/lieu\s*[:：]\s*(.+?)(?:\n|•|$)/i);
    const enjeuMatch = text.match(/enjeu\s*[:：]\s*(.+?)(?:\n|•|$)/i);
    const venue = parseVenueMatch(venueMatch?.[1] || "");
    const enjeu = parseEnjeu(enjeuMatch?.[1] || "");

    // Split team sections - find FORME sections
    const formeAIdx = text.search(/FORME\s+[A-Z\s\[\]]+\n/i);
    const formeBIdx = text.search(/FORME\s+[A-Z\s\[\]]+\n/i);
    
    // Find team A and B sections by looking for ÉTAPE 2A and 2B or FORME headers
    let textA = "", textB = "";
    const etape2A = text.match(/ÉTAPE\s+2A[^]*?(?=ÉTAPE\s+2B|ÉTAPE\s+3|H2H|$)/i);
    const etape2B = text.match(/ÉTAPE\s+2B[^]*?(?=ÉTAPE\s+3|H2H|$)/i);
    
    if (etape2A) textA = etape2A[0];
    if (etape2B) textB = etape2B[0];
    
    // If not found with 2A/2B, try FORME sections
    if (!textA || !textB) {
      const formeMatches = [...text.matchAll(/FORME\s+(.+?)\n([^]*?)(?=FORME\s+|ÉTAPE\s+3|H2H|═|$)/ig)];
      if (formeMatches[0]) textA = formeMatches[0][2];
      if (formeMatches[1]) textB = formeMatches[1][2];
    }

    const matchesA = parseMatchRows(textA || text);
    const matchesB = parseMatchRows(textB || "");
    const seasonA = parseSeason(textA || "");
    const seasonB = parseSeason(textB || "");

    // ELO
    const eloAMatch = (textA || text).match(/elo\s*[:：]\s*([\d]+)/i);
    const eloBMatch = (textB || "").match(/elo\s*[:：]\s*([\d]+)/i);
    
    // Days
    const daysAMatch = (textA || text).match(/(?:jours?\s+repos|repos|jours?)\s*[:：]\s*(\d+)/i);
    const daysBMatch = (textB || "").match(/(?:jours?\s+repos|repos|jours?)\s*[:：]\s*(\d+)/i);
    
    // Absent
    const absentAMatch = (textA || text).match(/absent\s*[:：]\s*(oui|yes)/i);
    const absentBMatch = (textB || "").match(/absent\s*[:：]\s*(oui|yes)/i);

    // H2H section
    const h2hSection = text.match(/(?:H2H|ÉTAPE\s+3)[^]*?(?=ÉTAPE\s+4|MÉTÉO|MARCHÉ|═|$)/i);
    const h2h = parseH2H(h2hSection?.[0] || "");

    // Weather
    const meteoSection = text.match(/(?:MÉTÉO|ÉTAPE\s+4)[^]*?(?=ÉTAPE\s+5|MARCHÉ|═|$)/i);
    const weatherMatch = (meteoSection?.[0] || text).match(/(?:météo|weather|conditions?)\s*[:：]\s*(.+?)(?:\n|•|$)/i);
    const weather = parseWeather(weatherMatch?.[1] || "");

    // Odds
    const marcheSection = text.match(/(?:MARCHÉ|ÉTAPE\s+5)[^]*/i);
    const oddsText = marcheSection?.[0] || text;
    
    const oddsAMatch = oddsText.match(/(?:cote\s+(?:victoire\s+)?(?:\[?équipe\s+a\]?|[A-Z][^:]+))\s*[:：]\s*([\d.,]+)/i);
    const oddsDrawMatch = oddsText.match(/cote\s+(?:match\s+)?nul\s*[:：]\s*([\d.,]+)/i);
    const oddsBMatch = oddsText.match(/(?:cote\s+(?:victoire\s+)?(?:\[?équipe\s+b\]?|[A-Z][^:]+))\s*[:：]\s*([\d.,]+)/i);
    
    const openAMatch = oddsText.match(/(?:ouverture|opening)[^:]*[:：]\s*([\d.,]+)/i);

    return {
      teamAName,
      teamBName,
      venue,
      enjeu,
      matchesA: matchesA.length > 0 ? matchesA : null,
      matchesB: matchesB.length > 0 ? matchesB : null,
      seasonA,
      seasonB,
      eloA: eloAMatch?.[1] || "",
      eloB: eloBMatch?.[1] || "",
      daysA: daysAMatch?.[1] || "",
      daysB: daysBMatch?.[1] || "",
      absentA: !!absentAMatch,
      absentB: !!absentBMatch,
      h2h: h2h.length > 0 ? h2h : null,
      weather,
      bookOddsA: String(parseNumber(oddsAMatch?.[1]) ?? ""),
      bookOddsDraw: String(parseNumber(oddsDrawMatch?.[1]) ?? ""),
      bookOddsB: String(parseNumber(oddsBMatch?.[1]) ?? ""),
    };
  } catch (e) {
    return null;
  }
}

// ─── Preview component ─────────────────────────────────────────────────────
function PreviewItem({ label, value, color }) {
  if (!value) return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `0.5px solid #f1f5f9` }}>
      <span style={{ fontSize: 12, color: TEXT_SUB }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 500, color: color || TEXT, fontFamily: "monospace" }}>{value}</span>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────
export default function PasteImport({ onImport }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [imported, setImported] = useState(false);

  const analyze = () => {
    setError(""); setPreview(null); setImported(false);
    if (!text.trim()) { setError("Colle le texte du prompt Scout ici."); return; }
    const result = parseText(text);
    if (!result) { setError("Impossible d'analyser ce texte. Vérifie que tu as bien collé la réponse complète du prompt."); return; }
    if (!result.matchesA || result.matchesA.length === 0) {
      setError("Aucun match trouvé pour l'équipe A. Vérifie le format du tableau.");
      return;
    }
    setPreview(result);
  };

  const handleImport = () => {
    if (!preview || !onImport) return;
    onImport(preview);
    setImported(true);
  };

  const venueLabel = { home: "Domicile A", neutral: "Terrain neutre", away: "Extérieur A" };
  const enjeuLabel = { high: "🔥 Fort", normal: "➡️ Normal", low: "😴 Faible" };
  const weatherLabel = { normal: "☀️ Normal", rain: "🌧️ Pluie", wind: "💨 Vent", cold: "🥶 Froid", heat: "🥵 Chaleur" };

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", color: TEXT }}>

      {/* Instructions */}
      <div style={{ background: BLUE + "10", border: `0.5px solid ${BLUE}33`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: BLUE, marginBottom: 6 }}>📋 Comment utiliser</div>
        <div style={{ fontSize: 12, color: TEXT_SUB, lineHeight: 1.7 }}>
          1. Ouvre une nouvelle discussion Claude.ai<br />
          2. Colle le prompt BetQuant Scout<br />
          3. Tape les deux équipes<br />
          4. Copie toute la réponse de Claude<br />
          5. Colle-la ci-dessous et clique "Analyser"
        </div>
      </div>

      {/* Paste zone */}
      <div style={{ background: CARD_BG, border: `0.5px solid ${BORDER}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: TEXT_MUTED, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
          Colle la réponse du prompt ici
        </div>
        <textarea
          value={text}
          onChange={e => { setText(e.target.value); setPreview(null); setImported(false); setError(""); }}
          placeholder="Colle ici la réponse complète du prompt BetQuant Scout depuis Claude.ai..."
          style={{
            width: "100%", boxSizing: "border-box", minHeight: 150,
            background: GRAY_BG, border: `0.5px solid ${BORDER}`,
            borderRadius: 8, color: TEXT, fontSize: 12, padding: "10px 12px",
            outline: "none", resize: "vertical", fontFamily: "monospace", lineHeight: 1.5
          }}
        />
        {text && (
          <div style={{ fontSize: 11, color: TEXT_MUTED, marginTop: 4 }}>
            {text.length} caractères collés
          </div>
        )}
      </div>

      {error && (
        <div style={{ background: RED_BG, border: `0.5px solid #fecaca`, borderRadius: 10, padding: "10px 12px", marginBottom: 12, fontSize: 12, color: RED }}>
          ⚠️ {error}
        </div>
      )}

      <button onClick={analyze} style={{ width: "100%", padding: "12px", borderRadius: 10, background: BLUE, color: "#fff", fontWeight: 500, fontSize: 14, border: "none", cursor: "pointer", marginBottom: 12 }}>
        Analyser le texte →
      </button>

      {/* Preview */}
      {preview && (
        <>
          <div style={{ background: CARD_BG, border: `0.5px solid ${GREEN_BORDER}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 500, color: GREEN, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
              ✅ Données détectées — Vérification
            </div>

            {/* Match */}
            <div style={{ fontSize: 12, fontWeight: 500, color: TEXT, marginBottom: 8 }}>🏟️ Match</div>
            <PreviewItem label="Équipe A" value={preview.teamAName} color={BLUE} />
            <PreviewItem label="Équipe B" value={preview.teamBName} color="#0d9488" />
            <PreviewItem label="Lieu" value={venueLabel[preview.venue]} />
            <PreviewItem label="Enjeu" value={enjeuLabel[preview.enjeu]} />

            {/* Team A matches */}
            {preview.matchesA && (
              <>
                <div style={{ fontSize: 12, fontWeight: 500, color: BLUE, marginTop: 12, marginBottom: 6 }}>⚽ {preview.teamAName} — {preview.matchesA.length} matchs</div>
                {preview.matchesA.map((m, i) => (
                  <div key={i} style={{ fontSize: 11, color: TEXT_SUB, padding: "3px 0", borderBottom: `0.5px solid #f9fafb` }}>
                    {i + 1}. vs {m.opponent} — {m.scoredReal}/{m.scoredXG} xG+ | {m.concededReal}/{m.concededXG} xG- | {m.venue} | {m.type}
                  </div>
                ))}
                {preview.seasonA.scoredReal && <PreviewItem label="Moy. saison mq./xG+" value={`${preview.seasonA.scoredReal} / ${preview.seasonA.scoredXG}`} />}
                {preview.seasonA.concededReal && <PreviewItem label="Moy. saison enc./xG-" value={`${preview.seasonA.concededReal} / ${preview.seasonA.concededXG}`} />}
                {preview.eloA && <PreviewItem label="ELO" value={preview.eloA} color={BLUE} />}
                {preview.daysA && <PreviewItem label="Jours repos" value={`${preview.daysA} jours`} />}
                <PreviewItem label="Absent" value={preview.absentA ? "⚠️ Oui" : "✅ Non"} color={preview.absentA ? RED : GREEN} />
              </>
            )}

            {/* Team B matches */}
            {preview.matchesB && preview.matchesB.length > 0 && (
              <>
                <div style={{ fontSize: 12, fontWeight: 500, color: "#0d9488", marginTop: 12, marginBottom: 6 }}>⚽ {preview.teamBName} — {preview.matchesB.length} matchs</div>
                {preview.matchesB.map((m, i) => (
                  <div key={i} style={{ fontSize: 11, color: TEXT_SUB, padding: "3px 0", borderBottom: `0.5px solid #f9fafb` }}>
                    {i + 1}. vs {m.opponent} — {m.scoredReal}/{m.scoredXG} xG+ | {m.concededReal}/{m.concededXG} xG- | {m.venue} | {m.type}
                  </div>
                ))}
                {preview.seasonB.scoredReal && <PreviewItem label="Moy. saison mq./xG+" value={`${preview.seasonB.scoredReal} / ${preview.seasonB.scoredXG}`} />}
                {preview.eloB && <PreviewItem label="ELO" value={preview.eloB} color="#0d9488" />}
                {preview.daysB && <PreviewItem label="Jours repos" value={`${preview.daysB} jours`} />}
                <PreviewItem label="Absent" value={preview.absentB ? "⚠️ Oui" : "✅ Non"} color={preview.absentB ? RED : GREEN} />
              </>
            )}

            {/* H2H */}
            {preview.h2h && preview.h2h.length > 0 && (
              <>
                <div style={{ fontSize: 12, fontWeight: 500, color: TEXT, marginTop: 12, marginBottom: 6 }}>⚔️ H2H — {preview.h2h.length} confrontations</div>
                {preview.h2h.map((m, i) => (
                  <div key={i} style={{ fontSize: 11, color: TEXT_SUB, padding: "3px 0" }}>
                    {i + 1}. {m.goalsA} — {m.goalsB}
                  </div>
                ))}
              </>
            )}

            {/* Conditions + Odds */}
            <div style={{ fontSize: 12, fontWeight: 500, color: TEXT, marginTop: 12, marginBottom: 6 }}>🌤️ Conditions & Marché</div>
            <PreviewItem label="Météo" value={weatherLabel[preview.weather]} />
            {preview.bookOddsA && <PreviewItem label={`Cote ${preview.teamAName}`} value={preview.bookOddsA} color={BLUE} />}
            {preview.bookOddsDraw && <PreviewItem label="Cote Nul" value={preview.bookOddsDraw} />}
            {preview.bookOddsB && <PreviewItem label={`Cote ${preview.teamBName}`} value={preview.bookOddsB} color="#0d9488" />}
          </div>

          <button onClick={handleImport} disabled={imported}
            style={{ width: "100%", padding: "14px", borderRadius: 10, background: imported ? "#9ca3af" : `linear-gradient(135deg, ${BLUE}, ${GREEN})`, color: "#fff", fontWeight: 500, fontSize: 14, border: "none", cursor: imported ? "not-allowed" : "pointer", marginBottom: 8 }}>
            {imported ? "✅ Importé dans BetQuant !" : "Importer dans BetQuant →"}
          </button>

          {imported && (
            <div style={{ textAlign: "center", fontSize: 12, color: GREEN }}>
              Va sur l'onglet "Analyser" — tout est pré-rempli !
            </div>
          )}
        </>
      )}
    </div>
  );
}