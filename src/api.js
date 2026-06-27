const BASE_URL = 'https://v3.football.api-sports.io';

async function apiCall(endpoint, params, apiKey) {
  const url = new URL(`${BASE_URL}${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));
  const res = await fetch(url.toString(), {
    headers: { 'x-apisports-key': apiKey }
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = await res.json();
  if (data.errors && Object.keys(data.errors).length > 0) {
    throw new Error(Object.values(data.errors).join(', '));
  }
  return data.response;
}

// Get seasons to try in order of preference
function getSeasons(national = false) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (national) {
    return year >= 2026 ? [2026, 2025] : [2025, 2024];
  }
  // Club football: season starts in August
  // En juin 2026, la saison en cours est 2025 (commencée août 2025)
  const current = month >= 8 ? year : year - 1;
  return [current, current - 1, current - 2];
}

// Search teams by name
export async function searchTeams(name, apiKey) {
  const results = await apiCall('/teams', { search: name }, apiKey);
  return results.map(r => ({
    id: r.team.id,
    name: r.team.name,
    logo: r.team.logo,
    country: r.team.country,
    national: r.team.national === true,
  }));
}

// Get fixtures for a team using season
async function getFixturesBySeason(teamId, season, apiKey) {
  const results = await apiCall('/fixtures', {
    team: teamId,
    season: season,
    status: 'FT-AET-PEN',
  }, apiKey);
  return results.sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date));
}

// Try to get xG for a fixture
async function getFixtureXG(fixtureId, teamId, apiKey) {
  try {
    const stats = await apiCall('/fixtures/statistics', { fixture: fixtureId }, apiKey);
    const teamStats = stats.find(s => s.team.id === teamId);
    const oppStats = stats.find(s => s.team.id !== teamId);
    let scoredXG = null, concededXG = null;
    if (teamStats) {
      const xg = teamStats.statistics.find(s => s.type === 'expected_goals' || s.type === 'Expected Goals');
      if (xg?.value) scoredXG = parseFloat(xg.value);
    }
    if (oppStats) {
      const xg = oppStats.statistics.find(s => s.type === 'expected_goals' || s.type === 'Expected Goals');
      if (xg?.value) concededXG = parseFloat(xg.value);
    }
    return { scoredXG, concededXG };
  } catch (e) {
    return { scoredXG: null, concededXG: null };
  }
}

// Determine match type from league name
function getMatchType(leagueName) {
  const n = (leagueName || '').toLowerCase();
  if (n.includes('friendly') || n.includes('amical') || n.includes('test match')) return 'friendly';
  if (n.includes('world cup') || n.includes('coupe du monde') || n.includes('euro') ||
      n.includes('copa america') || n.includes('nations league') || n.includes('champions')) return 'official';
  if (n.includes('cup') || n.includes('coupe') || n.includes('trophy') || n.includes('league')) return 'minor';
  return 'official';
}

// Main function: get last 5 fixtures — tries multiple seasons
export async function getLastFixtures(teamId, apiKey, national = false) {
  const seasons = getSeasons(national);
  let allFixtures = [];

  for (const season of seasons) {
    try {
      const fixtures = await getFixturesBySeason(teamId, season, apiKey);
      if (fixtures.length > 0) {
        allFixtures = [...allFixtures, ...fixtures];
        // If we have enough, stop
        if (allFixtures.length >= 5) break;
      }
    } catch (e) {
      // Try next season
    }
  }

  // Take 5 most recent
  const recent = allFixtures.slice(0, 5);
  const result = [];

  for (const f of recent) {
    const isHome = f.teams.home.id === teamId;
    const scored = isHome ? (f.goals.home ?? 0) : (f.goals.away ?? 0);
    const conceded = isHome ? (f.goals.away ?? 0) : (f.goals.home ?? 0);
    const venue = isHome ? 'home' : 'away';
    const type = getMatchType(f.league.name);

    const { scoredXG, concededXG } = await getFixtureXG(f.fixture.id, teamId, apiKey);

    result.push({
      fixtureId: f.fixture.id,
      date: f.fixture.date,
      opponent: isHome ? f.teams.away.name : f.teams.home.name,
      scoredReal: scored,
      scoredXG: scoredXG ?? scored,
      concededReal: conceded,
      concededXG: concededXG ?? conceded,
      venue,
      type,
      leagueName: f.league.name,
    });
  }

  return result;
}

// Get season averages
export async function getSeasonStats(teamId, apiKey, national = false) {
  const seasons = getSeasons(national);

  for (const season of seasons) {
    try {
      const leagues = await apiCall('/leagues', { team: teamId, season }, apiKey);
      if (!leagues || leagues.length === 0) continue;

      const league = leagues.find(l => l.league.type === 'League') || leagues[0];
      const stats = await apiCall('/teams/statistics', {
        team: teamId,
        league: league.league.id,
        season,
      }, apiKey);

      if (!stats || !stats.goals) continue;

      const played = stats.fixtures?.played?.total || 1;
      const scoredTotal = stats.goals?.for?.total?.total || 0;
      const concededTotal = stats.goals?.against?.total?.total || 0;

      if (played > 0) {
        return {
          scoredReal: scoredTotal / played,
          scoredXG: scoredTotal / played,
          concededReal: concededTotal / played,
          concededXG: concededTotal / played,
          season,
        };
      }
    } catch (e) {
      // Try next season
    }
  }
  return null;
}

// Get H2H
export async function getH2H(teamAId, teamBId, apiKey) {
  try {
    const results = await apiCall('/fixtures/headtohead', {
      h2h: `${teamAId}-${teamBId}`,
      status: 'FT-AET-PEN',
    }, apiKey);

    return results
      .sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date))
      .slice(0, 5)
      .map(f => ({
        date: f.fixture.date,
        goalsA: f.teams.home.id === teamAId ? (f.goals.home ?? 0) : (f.goals.away ?? 0),
        goalsB: f.teams.home.id === teamBId ? (f.goals.home ?? 0) : (f.goals.away ?? 0),
        leagueName: f.league.name,
      }));
  } catch (e) {
    return [];
  }
}

// Get days since last match
export async function getDaysSinceLastMatch(teamId, apiKey, national = false) {
  try {
    const seasons = getSeasons(national);
    for (const season of seasons) {
      const fixtures = await getFixturesBySeason(teamId, season, apiKey);
      if (fixtures && fixtures.length > 0) {
        const lastDate = new Date(fixtures[0].fixture.date);
        const now = new Date();
        return Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

// Validate API key
export async function validateApiKey(apiKey) {
  try {
    const results = await apiCall('/status', {}, apiKey);
    return { valid: true, requests: results?.requests };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}