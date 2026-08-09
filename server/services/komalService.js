const fs = require('fs');
const path = require('path');
const { getConfig } = require('../utils/configResolver');
const http = require('http');
const https = require('https');

const rootDir = path.resolve(__dirname, '../../');
const CACHE_FILE = path.join(rootDir, 'komal-cache.json');
const CONFIG_FILE = path.join(rootDir, 'server-config.json');

const KOMAL_API_BASE = process.env.KOMAL_API_URL || 'https://komal-api.habuild.in';

let memoryCache = {
  teamAnalytics: null,
  agentMetrics: {},
  lastSyncedAt: null,
  syncStatus: 'IDLE'
};

// Load persistent cache from disk if available
try {
  if (fs.existsSync(CACHE_FILE)) {
    memoryCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  }
} catch (e) {
  console.warn('[KomalService] Cache file read note:', e.message);
}

/**
 * Perform server-to-server HTTP/HTTPS GET request
 */
function fetchUrl(urlStr, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(urlStr, { headers, timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            resolve({ rawText: data, statusCode: res.statusCode });
          }
        } else {
          resolve({ error: `HTTP ${res.statusCode}`, statusCode: res.statusCode, rawText: data });
        }
      });
    });

    req.on('error', err => resolve({ error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'Request timeout' }); });
  });
}

/**
 * Fetch team analytics and per-agent metrics from Komal AI Dashboard
 */
async function syncKomalAIData(sessionToken = null) {
  console.log('[KomalService] Syncing Komal AI metrics from external API...');
  const headers = { 'User-Agent': 'Habuild-OJT-Dashboard/2.0' };
  if (sessionToken) {
    headers['Authorization'] = `Bearer ${sessionToken}`;
  }

  const config = getConfig();
  const ojtInterns = config.internsRegistry || [];

  try {
    // 1. Fetch team-level analytics endpoint
    const teamData = await fetchUrl(`${KOMAL_API_BASE}/api/analytics/team`, headers);

    // 2. Fetch per-agent metrics for registered OJT interns
    const agentDataMap = memoryCache.agentMetrics || {};

    if (!teamData.error) {
      memoryCache.teamAnalytics = teamData;
    }

    // Process/merge metrics per registered intern
    for (const intern of ojtInterns) {
      const key = intern.name.trim().toLowerCase();
      // Call per-agent endpoint if active API endpoint available
      const agentRes = await fetchUrl(`${KOMAL_API_BASE}/api/agent/metrics?name=${encodeURIComponent(intern.name)}`, headers);

      if (agentRes && !agentRes.error && agentRes.simpleQueries !== undefined) {
        agentDataMap[key] = {
          name: intern.name,
          batch: intern.batch,
          shift: agentRes.shift || '-',
          simpleQ: agentRes.simpleQueries || 0,
          complexQ: agentRes.complexQueries || 0,
          break: agentRes.breakTimeMinutes || 0,
          arst: agentRes.arstMinutes || 0,
          aiRtg: agentRes.aiRating || 4.2,
          lastUpdated: new Date().toISOString()
        };
      }
    }

    memoryCache.agentMetrics = agentDataMap;
    memoryCache.lastSyncedAt = new Date().toISOString();
    memoryCache.syncStatus = 'SUCCESS';

    // Save cache to disk
    fs.writeFileSync(CACHE_FILE, JSON.stringify(memoryCache, null, 2));
    console.log('[KomalService] Komal AI sync complete.');

  } catch (err) {
    console.error('[KomalService] Sync error:', err.message);
    memoryCache.syncStatus = 'ERROR';
    memoryCache.lastSyncError = err.message;
  }

  return memoryCache;
}

function getCachedMetrics() {
  return memoryCache;
}

module.exports = {
  syncKomalAIData,
  getCachedMetrics
};
