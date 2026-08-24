const fs = require('fs');
const path = require('path');
const { getConfig } = require('../utils/configResolver');
const http = require('http');
const https = require('https');

const rootDir = path.resolve(__dirname, '../../');
const CACHE_FILE = path.join(rootDir, 'komal-cache.json');
const DATA_FILE = path.join(rootDir, 'data.json');

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
 * Robust spelling-override name matcher
 */
function lastNamesMatch(lastA, lastB) {
  if (!lastA || !lastB) return true;
  const cleanA = lastA.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanB = lastB.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (cleanA === cleanB) return true;
  if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) return true;

  // Protect short last names from false positive overlap matches (like "naik" and "mandawkar")
  if (cleanA.length <= 4 || cleanB.length <= 4) {
    return false;
  }

  const setA = new Set(cleanA.split(''));
  const setB = new Set(cleanB.split(''));
  let common = 0;
  setA.forEach(c => { if (setB.has(c)) common++; });
  const pct = common / Math.min(setA.size, setB.size);
  return pct > 0.65;
}

function namesMatch(regName, targetName) {
  if (!regName || !targetName) return false;
  let cleanReg = regName.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  let cleanTarget = targetName.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleanReg === cleanTarget) return true;

  // Normalized words lists
  const regWords = cleanReg.split(/\s+/).filter(w => w.length > 0);
  const targetWords = cleanTarget.split(/\s+/).filter(w => w.length > 0);
  if (regWords.length === 0 || targetWords.length === 0) return false;

  // Handle "mohammad" vs "md" alias abbreviation explicitly
  const normalizeWord = (w) => {
    if (w === 'mohammad' || w === 'mohamad' || w === 'mohammed' || w === 'md') return 'md';
    return w;
  };
  const normRegWords = regWords.map(normalizeWord);
  const normTargetWords = targetWords.map(normalizeWord);

  // Concatenation & suffix removal logic (e.g. "Asawariganar Habuild" vs "Asawari Ganar")
  const cleanRegNoSpace = cleanReg.replace(/habuild/g, '').replace(/\s+/g, '');
  const cleanTargetNoSpace = cleanTarget.replace(/habuild/g, '').replace(/\s+/g, '');
  if (cleanRegNoSpace === cleanTargetNoSpace) return true;
  if (cleanRegNoSpace.length > 5 && cleanTargetNoSpace.includes(cleanRegNoSpace)) return true;
  if (cleanTargetNoSpace.length > 5 && cleanRegNoSpace.includes(cleanTargetNoSpace)) return true;

  // Explicit Alias mappings for known misspellings in the sheets
  if (cleanReg.includes('pareedhi') && cleanTarget.includes('paridhi')) return true;
  if (cleanReg.includes('paridhi') && cleanTarget.includes('pareedhi')) return true;
  if (cleanReg.includes('mahak') && cleanTarget.includes('mahek')) return true;
  if (cleanReg.includes('mahek') && cleanTarget.includes('mahak')) return true;
  if (cleanReg.includes('raichada') && cleanTarget.includes('raichadda')) return true;
  if (cleanReg.includes('raichadda') && cleanTarget.includes('raichada')) return true;
  if (cleanReg.includes('nagdev') && cleanTarget.includes('nagdeve')) return true;
  if (cleanReg.includes('nagdeve') && cleanTarget.includes('nagdev')) return true;
  if (cleanReg.includes('asawari') && cleanTarget.includes('asawri')) return true;
  if (cleanReg.includes('asawri') && cleanTarget.includes('asawari')) return true;

  // Surname and First name matching
  const getFirstName = (words) => {
    if (words.length > 1 && words[0] === 'md') return words[1];
    return words[0];
  };
  const getLastName = (words) => {
    if (words.length > 1) return words[words.length - 1];
    return null;
  };

  const regFirst = getFirstName(normRegWords);
  const regLast = getLastName(normRegWords);
  const targetFirst = getFirstName(normTargetWords);
  const targetLast = getLastName(normTargetWords);

  // If we have both first name and last name, check if they both match!
  if (regFirst && regLast && targetFirst && targetLast) {
    if (regFirst === targetFirst && lastNamesMatch(regLast, targetLast)) {
      return true;
    }
  }

  // Subset match: only if both names have at least 2 tokens (prevents single-word false positive overlaps)
  const regTokens = cleanReg.split(/\s+/).filter(t => t.length > 2);
  const targetTokens = cleanTarget.split(/\s+/).filter(t => t.length > 2);
  if (regTokens.length >= 2 && targetTokens.length >= 2) {
    if (regTokens.every(t => targetTokens.includes(t)) || targetTokens.every(t => regTokens.includes(t))) {
      return true;
    }
  }

  // Single word fallback
  if (regWords.length === 1) {
    return normRegWords[0] === normTargetWords[0];
  }
  if (targetWords.length === 1) {
    return normTargetWords[0] === normRegWords[0];
  }

  return false;
}

/**
 * Perform server-to-server HTTP/HTTPS request
 */
function requestUrl(urlStr, method = 'GET', bodyObj = null, headers = {}) {
  return new Promise((resolve) => {
    const parsed = new URL(urlStr);
    const client = parsed.protocol === 'https:' ? https : http;
    
    const options = {
      method: method,
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      headers: {
        ...headers,
        'User-Agent': 'Habuild-OJT-Dashboard/2.0'
      },
      timeout: 8000
    };

    let bodyStr = '';
    if (bodyObj) {
      bodyStr = JSON.stringify(bodyObj);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = client.request(options, (res) => {
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

    if (bodyObj) {
      req.write(bodyStr);
    }
    req.end();
  });
}

function hasRealActivity(internName) {
  let dataJson = {};
  try {
    if (fs.existsSync(DATA_FILE)) {
      dataJson = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[KomalService] Error reading data.json:', e.message);
  }

  let activity = false;

  if (dataJson.attendanceData) {
    const matchedAttKey = Object.keys(dataJson.attendanceData).find(k => namesMatch(internName, k));
    if (matchedAttKey) {
      const record = dataJson.attendanceData[matchedAttKey];
      const hasCheckedIn = Object.values(record).some(v => {
        if (v === undefined || v === null) return false;
        const u = String(v).toUpperCase().trim();
        return u !== '' && u !== '-' && u !== 'A' && u !== 'ABSENT';
      });
      if (hasCheckedIn) activity = true;
    }
  }

  if (!activity && dataJson.commsChatData) {
    const targetComms = dataJson.commsChatData.all || dataJson.commsChatData;
    const matchedCommsKey = Object.keys(targetComms).find(k => namesMatch(internName, k));
    if (matchedCommsKey) {
      const record = targetComms[matchedCommsKey];
      const hasChats = Object.values(record).some(v => {
        if (v === undefined || v === null || v === '') return false;
        const num = parseInt(String(v).replace(/,/g, ''), 10);
        return !isNaN(num) && num > 0;
      });
      if (hasChats) activity = true;
    }
  }

  return activity;
}

/**
 * Fetch team analytics and per-agent metrics from Komal AI Dashboard
 */
async function syncKomalAIData(sessionToken = null) {
  console.log('[KomalService] Syncing Komal AI metrics from external API...');
  
  const config = getConfig();
  const token = sessionToken || config.komalSessionToken;

  if (!token) {
    console.log('[KomalService] No Komal AI Session Token configured. Skipping sync.');
    memoryCache.syncStatus = 'IDLE';
    return memoryCache;
  }

  const headers = {
    'Authorization': `Bearer ${token}`
  };

  const ojtInterns = [];
  const batchesDir = path.join(rootDir, 'data', 'batches');
  if (fs.existsSync(batchesDir)) {
    const files = fs.readdirSync(batchesDir);
    for (const file of files) {
      if (file.endsWith('.json') && !file.includes('config')) {
        try {
          const content = JSON.parse(fs.readFileSync(path.join(batchesDir, file), 'utf8'));
          if (content && Array.isArray(content.interns)) {
            content.interns.forEach(i => {
              if (i && i.name && !ojtInterns.some(existing => existing.name.toLowerCase().trim() === i.name.toLowerCase().trim())) {
                ojtInterns.push(i);
              }
            });
          }
        } catch (e) {
          console.error(`[KomalService] Error reading batch file ${file}:`, e.message);
        }
      }
    }
  }

  if (Array.isArray(config.internsRegistry)) {
    config.internsRegistry.forEach(i => {
      if (i && i.name && !ojtInterns.some(existing => existing.name.toLowerCase().trim() === i.name.toLowerCase().trim())) {
        ojtInterns.push(i);
      }
    });
  }

  console.log(`[KomalService] Loaded ${ojtInterns.length} interns from registry and batch files for sync matching.`);

  const agentDataMap = memoryCache.agentMetrics || {};

  try {
    // 1. Fetch all agents from Komal AI API
    console.log('[KomalService] Fetching agent directory from Komal API...');
    const allAgentsRes = await requestUrl(`${KOMAL_API_BASE}/api/v1/agent/getAllAgents`, 'POST', {}, headers);

    if (allAgentsRes.error) {
      throw new Error(`Failed to fetch agents: ${allAgentsRes.error}`);
    }

    const komalAgents = Array.isArray(allAgentsRes) ? allAgentsRes : (allAgentsRes.agents || allAgentsRes.data || []);
    console.log(`[KomalService] Discovered ${komalAgents.length} agents on Komal AI platform.`);

    if (komalAgents.length === 0) {
      console.log('[KomalService] Discovered 0 agents (access is not granted). Initializing empty metrics.');
      
      for (const intern of ojtInterns) {
        const key = intern.name.trim().toLowerCase();
        agentDataMap[key] = {
          name: intern.name,
          batch: intern.batch,
          daily: {},
          lastUpdated: new Date().toISOString()
        };
      }
      
      memoryCache.agentMetrics = agentDataMap;
      memoryCache.lastSyncedAt = new Date().toISOString();
      memoryCache.syncStatus = 'SUCCESS';
      fs.writeFileSync(CACHE_FILE, JSON.stringify(memoryCache, null, 2));
      console.log('[KomalService] Komal AI sync complete (with simulated fallback).');
      return memoryCache;
    }

    // 2. Initialize empty daily logs for all registered interns
    for (const intern of ojtInterns) {
      const key = intern.name.trim().toLowerCase();
      if (!agentDataMap[key]) {
        agentDataMap[key] = {
          name: intern.name,
          batch: intern.batch,
          daily: {},
          lastUpdated: new Date().toISOString()
        };
      } else {
        agentDataMap[key].daily = {}; // Reset so we populate fresh
      }
    }

    // Build the list of date strings for the last 45 days
    const today = new Date();
    const datesToSync = [];
    for (let i = 0; i < 45; i++) {
      const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      datesToSync.push(`${y}-${m}-${day}`);
    }
    datesToSync.reverse(); // Sync chronologically

    console.log(`[KomalService] Fetching daily metrics via getRealTimeAgent for 45 days...`);

    for (const dateStr of datesToSync) {
      const realTimeRes = await requestUrl(
        `${KOMAL_API_BASE}/api/v1/agent/getRealTimeAgent`,
        'POST',
        {
          startDate: dateStr,
          endDate: dateStr,
          limit: 500,
          offset: 0
        },
        headers
      );

      if (realTimeRes && !realTimeRes.error) {
        const records = realTimeRes.data || [];
        records.forEach(rec => {
          const matchedIntern = ojtInterns.find(intern => intern.name && namesMatch(intern.name, rec.name));
          if (matchedIntern) {
            const key = matchedIntern.name.trim().toLowerCase();

            // Note: ARsT and ARpT are swapped in the Komal AI API!
            // - average_resolution_time contains Response Time (ARsT)
            // - average_response_time contains Resolution Time (ARpT)
            const rawArst = rec.average_resolution_time !== undefined ? rec.average_resolution_time : 0;
            const rawBreak = rec.total_break_time !== undefined ? rec.total_break_time : 0;
            const rawArpt = rec.average_response_time !== undefined ? rec.average_response_time : 0;
            const rawFrt = rec.max_first_response_time !== undefined ? rec.max_first_response_time : 0;

            agentDataMap[key].daily[dateStr] = {
              simpleQ: rec.total_simple_queries !== undefined ? rec.total_simple_queries : 0,
              complexQ: rec.total_complex_queries !== undefined ? rec.total_complex_queries : 0,
              break: rawBreak,
              arst: rawArst,
              arpt: rawArpt,
              aiRtg: rec.average_score !== undefined ? rec.average_score : 0,
              frt: rawFrt || rawArst,
              calculation_score: rec.calculation_score !== undefined ? rec.calculation_score : 0,
              shift: rec.shift || '-'
            };
          }
        });
      } else {
        console.warn(`[KomalService] Failed to fetch real-time metrics for date ${dateStr}:`, realTimeRes ? realTimeRes.error : 'Empty response');
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
  try {
    if (fs.existsSync(CACHE_FILE)) {
      memoryCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    }
  } catch (e) {
    console.warn('[KomalService] Cache file re-read warning:', e.message);
  }
  return memoryCache;
}

module.exports = {
  syncKomalAIData,
  getCachedMetrics,
  requestUrl
};

