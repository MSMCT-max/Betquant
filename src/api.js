const BASE_URL = 'https://v3.football.api-sports.io';

async function apiCall(endpoint, params, apiKey) {
  const url = new URL(`${BASE_URL}${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));
  const res = await fetch(url.toString(), {
    headers: {
      'x-apisports-key': apiKey,
    }
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = await res.json();
  if (data.errors && Object.keys(data.errors).length > 0) {
    throw new Error(Object.values(data.errors).join(', '));
  }
  return data.response;
}

// Search teams by name
export async function searchTeams(name, apiKey) {
  const results = await apiCall('/teams', { search: name }, apiKey);
  return results.map(r => ({
    id: r.team.id,
    name: r.team.name,
    logo: r.team.logo,
    country: r.team.country,
  }));
}

// Get last 5 fixtures for a team with stats
export async function getLastFixtures(teamId, apiKey) {
  const results = await apiCall('/fixtures', {
    team: teamId,
    last: 10,
    status: 'FT-AET-PEN',
  }, apiKey);

  const fixtures = [];
  for (const f of results.slice(0, 5)) {
    const isHome = f.teams.home.id === teamId;
    const scored = isHome ? f.goals.home : f.goals.away;
    const conceded = isHome ? f.goals.away : f.goals.home;
    const venue = isHome ? 'home' : 'away';

    // Determine type
    const leagueName = (f.league.name || '').toLowerCase();
    let type = 'official';
    if (leagueName.includes('friendly') || leagueName.includes('amical')) type = 'friendly';
    else if (leagueName.includes('cup') || leagueName.includes('coupe') || leagueName.includes('trophy')) type = 'minor';

    // xG from fixture stats
    let scoredXG = null, concededXG = null;
    try {
      const stats = await apiCall('/fixtures/statistics', { fixture: f.fixture.id }, apiKey);
      const teamStats = stats.find(s => s.team.id === teamId);
      const oppStats = stats.find(s => s.team.id !== teamId);
      if (teamStats) {
        const xgStat = teamStats.statistics.find(s => s.type === 'expected_goals' || s.type === 'Expected Goals');
        if (xgStat && xgStat.value) scoredXG = parseFloat(xgStat.value);
      }
      if (oppStats) {
        const xgStat = oppStats.statistics.find(s => s.type === 'expected_goals' || s.type === 'Expected Goals');
        if (xgStat && xgStat.value) concededXG = parseFloat(xgStat.value);
      }
    } catch (e) { /* xG not available for this fixture */ }

    fixtures.push({
      fixtureId: f.fixture.id,
      date: f.fixture.date,
      opponent: isHome ? f.teams.away.name : f.teams.home.name,
      scoredReal: scored ?? 0,
      scoredXG: scoredXG ?? scored ?? 0,
      concededReal: conceded ?? 0,
      concededXG: concededXG ?? conceded ?? 0,
      venue,
      type,
      leagueName: f.league.name,
    });
  }
  return fixtures;
}

// Get season averages for a team
export async function getSeasonStats(teamId, leagueId, season, apiKey) {
  const results = await apiCall('/teams/statistics', {
    team: teamId,
    league: leagueId,
    season: season,
  }, apiKey);

  if (!results || !results.goals) return null;

  const played = results.fixtures?.played?.total || 1;
  const scoredTotal = results.goals?.for?.total?.total || 0;
  const concededTotal = results.goals?.against?.total?.total || 0;

  return {
    scoredReal: scoredTotal / played,
    scoredXG: scoredTotal / played,
    concededReal: concededTotal / played,
    concededXG: concededTotal / played,
    leagueId,
    season,
  };
}

// Get H2H between two teams
export async function getH2H(teamAId, teamBId, apiKey) {
  const results = await apiCall('/fixtures/headtohead', {
    h2h: `${teamAId}-${teamBId}`,
    last: 5,
    status: 'FT-AET-PEN',
  }, apiKey);

  return results.slice(0, 5).map(f => ({
    date: f.fixture.date,
    goalsA: f.teams.home.id === teamAId ? (f.goals.home ?? 0) : (f.goals.away ?? 0),
    goalsB: f.teams.home.id === teamBId ? (f.goals.home ?? 0) : (f.goals.away ?? 0),
    leagueName: f.league.name,
  }));
}

// Get days since last fixture
export async function getDaysSinceLastMatch(teamId, apiKey) {
  const results = await apiCall('/fixtures', {
    team: teamId,
    last: 1,
    status: 'FT-AET-PEN',
  }, apiKey);
  if (!results || results.length === 0) return null;
  const lastDate = new Date(results[0].fixture.date);
  const now = new Date();
  const diff = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));
  return diff;
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