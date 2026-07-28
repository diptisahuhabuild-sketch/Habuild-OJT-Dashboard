const fs = require('fs');
try {
  const cache = JSON.parse(fs.readFileSync('komal-cache.json', 'utf8'));
  console.log('--- KOMAL CACHE SUMMARY ---');
  console.log('Sync status:', cache.syncStatus);
  console.log('Last synced:', cache.lastSyncedAt);
  const keys = Object.keys(cache.agentMetrics || {});
  console.log('Number of agents in cache:', keys.length);
  if (keys.length > 0) {
    console.log('Sample Agent metrics:', cache.agentMetrics[keys[0]]);
  }
} catch (e) {
  console.error(e.message);
}
