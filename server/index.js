require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const googleService = require('./services/googleService');
const googleSyncService = require('./services/googleSyncService');
const googleDocSyncService = require('./services/googleDocSyncService');
const komalService = require('./services/komalService');
const apiRoutes = require('./routes/api');

const app = express();
app.use(compression());
const PORT = process.env.PORT || 3848;
const rootDir = path.resolve(__dirname, '../');

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static web application
app.use(express.static(path.join(rootDir, 'public')));
app.use('/assets', express.static(rootDir));

// Mount REST API Router
app.use('/api', apiRoutes);

// Optional Integration: quiz & typing test routes if existing
const quizDir = path.join(path.dirname(rootDir), 'habuild-quiz');
if (fs.existsSync(quizDir)) {
  const quizFile = path.join(quizDir, 'index.html');
  const typingTestFile = path.join(quizDir, 'typing-test.html');
  app.get('/quiz', (req, res) => { res.sendFile(quizFile); });
  app.get('/typing-test', (req, res) => { res.sendFile(typingTestFile); });
}

// Fallback for single-page app
app.get('*', (req, res) => {
  res.sendFile(path.join(rootDir, 'public', 'index.html'));
});

// Initial boot restore and sync
setTimeout(async () => {
  try {
    console.log('[ServerInit] Running startup Google Drive sync to restore data...');
    // Restore data.json, server-config.json, and komal-cache.json from Google Drive first!
    await googleService.syncDriveState();
    
    const DATA_FILE_PATH = path.join(rootDir, 'data.json');
    const KOMAL_CACHE_PATH = path.join(rootDir, 'komal-cache.json');
    
    if (!fs.existsSync(DATA_FILE_PATH)) {
      console.log('[ServerInit] data.json not found after restore. Running fresh sheets/doc sync...');
      await googleSyncService.fetchAndSyncGoogleSheetsData();
      await googleDocSyncService.syncAndParseAllDocs();
    }
    
    if (!fs.existsSync(KOMAL_CACHE_PATH)) {
      console.log('[ServerInit] komal-cache.json not found after restore. Running Komal AI sync...');
      await komalService.syncKomalAIData();
    }
    
    console.log('[ServerInit] Startup restore and sync completed successfully.');
  } catch (e) {
    console.error('[ServerInit] Startup restore/sync error:', e.message);
  }
}, 1000);
console.log('[ServerInit] Boot completed. Ready to serve dashboard. Continuous sync scheduled in the background.');

// Scheduled Continuous Sync (Every 2 Minutes)
cron.schedule('*/2 * * * *', async () => {
  console.log('[Cron] Continuous background data sync executing...');
  try {
    await googleSyncService.fetchAndSyncGoogleSheetsData();
    await googleDocSyncService.syncAndParseAllDocs();
    await googleService.syncDriveState();
    await komalService.syncKomalAIData();
  } catch (e) {
    console.error('[Cron] Sync execution error:', e.message);
  }
});

const server3040 = app.listen(3040, () => {
  console.log(`=======================================================`);
  console.log(`  Live OJT Dashboard running at http://localhost:3040`);
  console.log(`=======================================================`);
}).on('error', (err) => {
  console.log('Port 3040 note:', err.message);
});

const server3848 = app.listen(3848, () => {
  console.log(`  Secondary listener running at http://localhost:3848`);
}).on('error', (err) => {
  console.log('Port 3848 note:', err.message);
});
