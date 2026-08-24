const fs = require('fs');
const path = require('path');
require('dotenv').config();

const cacheMetaPath = path.join(__dirname, 'qc-doc-cache-meta.json');
const cachePath = path.join(__dirname, 'qc-doc-cache.json');

// Force full re-sync by deleting caches
if (fs.existsSync(cacheMetaPath)) {
  console.log('Deleting qc-doc-cache-meta.json...');
  fs.unlinkSync(cacheMetaPath);
}
if (fs.existsSync(cachePath)) {
  console.log('Deleting qc-doc-cache.json...');
  fs.unlinkSync(cachePath);
}

const googleSyncService = require('./server/services/googleSyncService');
const googleDocSyncService = require('./server/services/googleDocSyncService');

async function run() {
  console.log('Running Sync Sheets and Registry...');
  await googleSyncService.fetchAndSyncGoogleSheetsData();
  
  console.log('Running Sync and Parse All Docs...');
  await googleDocSyncService.syncAndParseAllDocs();
  
  console.log('Sync process completed successfully!');
}

run().catch(err => {
  console.error('Sync failed:', err);
  process.exit(1);
});
