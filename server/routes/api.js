const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const googleService = require('../services/googleService');
const googleSyncService = require('../services/googleSyncService');
const googleDocSyncService = require('../services/googleDocSyncService');
const komalService = require('../services/komalService');
const notificationService = require('../services/notificationService');
const { getConfig } = require('../utils/configResolver');

const rootDir = path.resolve(__dirname, '../../');
const DATA_FILE = path.join(rootDir, 'data.json');
const CONFIG_FILE = path.join(rootDir, 'server-config.json');

function getData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[API Router] Error reading data.json:', e.message);
  }
  return { scanData: {}, milestones: {}, eodUpdates: [], lastSyncedAt: null };
}

// Removed getConfig since it's now imported from configResolver

/**
 * Deep merge utility to prevent overwriting nested config objects
 */
function deepMerge(target, source) {
  if (typeof target !== 'object' || target === null) return source;
  if (typeof source !== 'object' || source === null) return target;

  for (const key of Object.keys(source)) {
    if (Array.isArray(source[key])) {
      target[key] = source[key];
    } else if (typeof source[key] === 'object' && source[key] !== null) {
      if (!target[key]) target[key] = {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

// Health Check & Backend Connection Status
router.get('/health', (req, res) => {
  const config = getConfig();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    connections: {
      google: {
        connected: googleService.isInitialized(),
        details: googleService.isInitialized() ? 'Google API Credentials active' : 'Google Credentials missing or unconfigured'
      },
      whatsapp: {
        connected: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_NUMBER),
        details: (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) ? `Twilio active (${process.env.TWILIO_WHATSAPP_NUMBER})` : 'Simulation Mode (Add Twilio credentials in .env)'
      },
      email: {
        connected: !!(process.env.SMTP_HOST && process.env.SMTP_USER),
        details: (process.env.SMTP_HOST && process.env.SMTP_USER) ? `SMTP active (${process.env.SMTP_HOST})` : 'Simulation Mode (Add SMTP settings in .env)'
      }
    }
  });
});

// Dashboard Data Endpoint
router.get('/data', (req, res) => {
  const data = getData();
  const config = getConfig();

  // Pre-calculate daily audit scanned counts from data.scanData
  const dailyAuditScanned = {};
  if (data.scanData) {
    Object.entries(data.scanData).forEach(([batchKey, rows]) => {
      if (!Array.isArray(rows)) return;
      const bKey = batchKey.toUpperCase().trim();
      dailyAuditScanned[bKey] = {};
      
      rows.forEach(row => {
        if (!row.internName) return;
        const nameKey = row.internName.toLowerCase().trim();
        const dateStr = row.chatDate || row.scanDate;
        if (!dateStr) return;
        
        if (!dailyAuditScanned[bKey][nameKey]) {
          dailyAuditScanned[bKey][nameKey] = {};
        }
        
        if (!dailyAuditScanned[bKey][nameKey][dateStr]) {
          dailyAuditScanned[bKey][nameKey][dateStr] = { scanned: 0, ratingSum: 0, ratingCount: 0 };
        }
        
        // Increment by 1 per row (each row in sheet = 1 chat scanned/audited)
        dailyAuditScanned[bKey][nameKey][dateStr].scanned += 1;
        
        const rating = parseFloat(row.leadRating);
        if (!isNaN(rating) && rating !== null) {
          dailyAuditScanned[bKey][nameKey][dateStr].ratingSum += rating;
          dailyAuditScanned[bKey][nameKey][dateStr].ratingCount += 1;
        }
      });
    });
  }

  // Step 1: Return lightweight data objects to avoid heavy 38MB payload downloads over localtunnel
  const lightweightData = {
    lastSyncedAt: data.lastSyncedAt,
    syncStatus: data.syncStatus,
    lastSyncError: data.lastSyncError || null,
    scanData: {},
    dailyAuditScanned,
    attendanceData: data.attendanceData || {},
    commsChatData: data.commsChatData || {},
    milestones: {},
    b20Reporting: {},
    b19Reporting: {}
  };

  try {
    const b20Path = path.join(rootDir, 'data/batches/b20-reporting.json');
    if (fs.existsSync(b20Path)) {
      lightweightData.b20Reporting = JSON.parse(fs.readFileSync(b20Path, 'utf8'));
    }
    const b19Path = path.join(rootDir, 'data/batches/b19-reporting.json');
    if (fs.existsSync(b19Path)) {
      lightweightData.b19Reporting = JSON.parse(fs.readFileSync(b19Path, 'utf8'));
    }
  } catch (e) { }

  res.json({
    success: true,
    data: lightweightData,
    config,
    komalMetrics: komalService.getCachedMetrics() || {},
    qcDocData: [],
    serverTime: new Date().toISOString()
  });
});


// Debug route to check Komal AI connectivity and raw responses
router.get('/test-komal', async (req, res) => {
  try {
    const config = getConfig();
    const token = config.komalSessionToken;
    if (!token) {
      return res.json({ success: false, error: 'No token configured in server-config.json' });
    }
    const headers = { 'Authorization': `Bearer ${token}` };
    const agents = await komalService.requestUrl('https://komal-api.habuild.in/api/v1/agent/getAllAgents', 'POST', {}, headers);
    
    let sampleMetrics = null;
    if (Array.isArray(agents) && agents.length > 0) {
      // Fetch metrics for the first agent as a sample
      sampleMetrics = await komalService.requestUrl(
        'https://komal-api.habuild.in/api/v1/agentmetric/agentMetric/all',
        'POST',
        { agentId: agents[0].id, startDate: '2026-08-01', endDate: '2026-08-17' },
        headers
      );
    }
    
    res.json({ success: true, agentsCount: Array.isArray(agents) ? agents.length : 0, agents, sampleMetrics });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// Route to trigger email login on Komal AI API
router.post('/komal/login-email', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }
    console.log(`[KomalService] Requesting login OTP for email: ${email}`);
    const response = await komalService.requestUrl('https://komal-api.habuild.in/api/v1/user/login', 'POST', { email });
    if (response.error) {
      return res.status(500).json({ success: false, error: response.error, raw: response });
    }
    res.json({ success: true, data: response });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Route to verify login OTP and save JWT token
router.post('/komal/verify-otp', async (req, res) => {
  try {
    const { otp, jwtToken } = req.body;
    if (!otp || !jwtToken) {
      return res.status(400).json({ success: false, error: 'OTP and jwtToken are required' });
    }
    console.log('[KomalService] Verifying OTP token...');
    const headers = { 'Authorization': `Bearer ${jwtToken}` };
    const response = await komalService.requestUrl('https://komal-api.habuild.in/api/v1/user/verify-otp', 'PUT', { emailToken: otp }, headers);
    if (response.error) {
      return res.status(500).json({ success: false, error: response.error, raw: response });
    }
    
    // Extract the final token
    const rawData = response.data || response;
    const finalToken = rawData.jwtToken || rawData.token;
    if (finalToken) {
      const config = getConfig();
      config.komalSessionToken = finalToken;
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
      
      // Sync metrics in background
      await komalService.syncKomalAIData(finalToken);
      
      res.json({ success: true, message: 'Authentication successful & cache synced!', token: finalToken });
    } else {
      res.json({ success: false, error: 'Failed to parse authorization token from verify response', raw: response });
    }
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Dedicated QC Docs Endpoint (Lazy Loaded by UI)
router.get('/qc-docs', (req, res) => {
  const qcDocData = googleDocSyncService.getCachedQCMistakes();
  res.json({
    success: true,
    data: qcDocData
  });
});

// Real-Time Webhook Endpoint for Google Apps Script triggers
router.post('/webhook-sync', async (req, res) => {
  console.log('[API Router] Webhook triggered! Initiating background sync...');

  // Respond immediately so Google Apps Script doesn't timeout
  res.json({ success: true, message: 'Sync triggered successfully.' });

  // Trigger background updates
  try {
    await googleSyncService.syncInternsRegistryFromGoogleSheet();
    await googleSyncService.syncAllSheets();
    await googleDocSyncService.syncAndParseAllDocs();
    console.log('[API Router] Webhook background sync completed.');
  } catch (err) {
    console.error('[API Router] Webhook sync error:', err.message);
  }
});

function getBatchDocMap() {
  const batchesDir = path.join(rootDir, 'data/batches');
  const map = {};

  try {
    if (fs.existsSync(batchesDir)) {
      const files = fs.readdirSync(batchesDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const batchData = JSON.parse(fs.readFileSync(path.join(batchesDir, file), 'utf8'));
        const batchKey = file.replace('.json', '');

        if (batchData.qcDocs && Array.isArray(batchData.qcDocs)) {
          if (batchData.qcDocs.length > 0) {
            const match = batchData.qcDocs[0].match(/\/d\/([a-zA-Z0-9-_]+)/);
            if (match && match[1]) {
              map[batchKey.toUpperCase().trim()] = match[1];
            }
          }
        }
      }
    }
  } catch (e) {
    console.error('[API getBatchDocMap] Error parsing modular batches:', e);
  }

  const fallback = {
    'B-20': '1m9cnG_wNubNG7sy2zaTtnpmIfy_7Wv26udBKgHFbPOE',
    'B-19': '1dWLPyDnXWW3YTnoyaztIh_89s1Jcdg_5j1hQEN85-pc',
    'B-18': '1iVBQ7fG3IhVcNJew5VhxqdmgRTSrL_FmvIl1VulChqY',
    'B-17': '1fvPUWGBMYkk2swjulkaUvYTvyolvfSSI-vJpjUIqu30',
    'B-16': '1bz5IC3feRcesHnDfcfdflatF8_j8XDs3sqdCNR2KnMs',
    'B-15': '1n1dtuJpJGanvpgas0d9uoJLxA9_4DyBNr6DL_cRuMyM'
  };

  return { ...fallback, ...map };
}


// Real-time QC Google Doc image parser endpoint
router.get('/qc-images', async (req, res) => {
  const batch = req.query.batch || 'B-19';
  const batchMap = getBatchDocMap();
  const docId = batchMap[batch.toUpperCase().trim()] || batchMap['B-19'];
  const docs = googleService.getDocs();

  if (!docs) {
    return res.json({ success: false, error: 'Google Docs API not initialized' });
  }

  try {
    const docRes = await docs.documents.get({ documentId: docId });
    const doc = docRes.data;
    const inlineObjects = doc.inlineObjects || {};
    const bodyContent = doc.body.content || [];

    const images = [];
    const numbers = [];

    bodyContent.forEach((el, index) => {
      if (el.paragraph) {
        el.paragraph.elements.forEach(e => {
          if (e.inlineObjectElement) {
            const objId = e.inlineObjectElement.inlineObjectId;
            const obj = inlineObjects[objId];
            const embeddedObj = obj && obj.inlineObjectProperties && obj.inlineObjectProperties.embeddedObject;
            const srcUrl = embeddedObj && embeddedObj.imageProperties && embeddedObj.imageProperties.contentUri;
            if (srcUrl) {
              images.push({ url: srcUrl, index });
            }
          }
        });

        const txt = el.paragraph.elements.map(e => e.textRun ? e.textRun.content : '').join('');
        const matches = txt.match(/\b\d{10,13}\b/g) || [];
        matches.forEach(num => {
          numbers.push({ phone: num.trim(), index });
        });
      }
    });

    const phoneImageMap = {};
    images.forEach(img => {
      if (numbers.length === 0) return;

      let closestNum = numbers[0];
      let minDistance = Math.abs(img.index - closestNum.index);

      for (let k = 1; k < numbers.length; k++) {
        const dist = Math.abs(img.index - numbers[k].index);
        if (dist < minDistance) {
          minDistance = dist;
          closestNum = numbers[k];
        }
      }

      const numVal = closestNum.phone;
      if (!phoneImageMap[numVal]) phoneImageMap[numVal] = [];
      phoneImageMap[numVal].push(img.url);
    });

    res.json({ success: true, images: phoneImageMap });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Trigger Continuous Google Sync
router.post('/sync', async (req, res) => {
  try {
    const updatedData = await googleSyncService.fetchAndSyncGoogleSheetsData();
    await googleDocSyncService.syncAndParseAllDocs();
    await googleService.syncDriveState();
    await komalService.syncKomalAIData();
    res.json({
      success: true,
      message: 'Google Sheets data, QC Google Docs, Komal AI metrics, and Drive persistence synchronized successfully',
      lastSyncedAt: updatedData.lastSyncedAt,
      syncStatus: updatedData.syncStatus
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Trigger Komal AI Sync Endpoint
router.post('/komal/sync', async (req, res) => {
  try {
    const { sessionToken } = req.body;
    const metrics = await komalService.syncKomalAIData(sessionToken);
    res.json({ success: true, metrics });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Save Komal AI Session Token configuration
router.post('/config/komal-token', async (req, res) => {
  try {
    const { token } = req.body;
    if (token === undefined) {
      return res.status(400).json({ success: false, error: 'Token is required' });
    }

    let config = {};
    if (fs.existsSync(CONFIG_FILE)) {
      config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }

    config.komalSessionToken = token.trim();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

    // Trigger sync in background immediately
    komalService.syncKomalAIData(config.komalSessionToken);

    res.json({ success: true, message: 'Komal AI Session Token saved successfully' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});


// Save Daily EOD Update
router.post('/eod', (req, res) => {
  const eodData = req.body;
  if (!eodData || !eodData.leadName) {
    return res.status(400).json({ success: false, error: 'Lead name and report content required' });
  }

  const currentData = getData();
  if (!currentData.eodUpdates) currentData.eodUpdates = [];

  const formattedTemplate = notificationService.formatEODWhatsAppTemplate(eodData);
  const record = {
    id: 'EOD_' + Date.now(),
    leadName: eodData.leadName,
    batch: eodData.batch || 'B-20',
    date: eodData.date || new Date().toISOString().split('T')[0],
    attendance: eodData.attendance || '0/0',
    teamChatCount: eodData.teamChatCount || 0,
    callingAttendance: eodData.callingAttendance || '0/0',
    chats: eodData.chats || 0,
    calls: eodData.calls || 0,
    personalChatsDone: eodData.personalChatsDone || 0,
    chatScan: eodData.chatScan || 0,
    qcPosted: eodData.qcPosted || 0,
    summary: eodData.summary || '',
    formattedTemplate,
    internCounts: eodData.internCounts || [],
    refresherLog: eodData.refresherLog || '',
    createdAt: new Date().toISOString()
  };

  currentData.eodUpdates.unshift(record);
  googleSyncService.saveDataToDisk(currentData);

  res.json({ success: true, message: 'Daily EOD update saved successfully', record });
});

// Send WhatsApp Notification (Single or Bulk)
router.post('/notify/whatsapp', async (req, res) => {
  const { phone, phones, message, leadName, eodData } = req.body;
  const targetPhones = phones || [phone || '+919876543210'];

  let messageBody = message;
  if (!messageBody && eodData) {
    messageBody = notificationService.formatEODWhatsAppTemplate(eodData);
  } else if (!messageBody) {
    messageBody = notificationService.formatEODWhatsAppTemplate({ leadName: leadName || 'Team Lead' });
  }

  const results = [];
  for (const target of targetPhones) {
    if (target) {
      const result = await notificationService.sendWhatsAppMessage(target, messageBody);
      results.push(result);
    }
  }

  res.json({ success: true, count: results.length, results, previewMessage: messageBody });
});

// Send Email Report (Single or Bulk)
router.post('/notify/email', async (req, res) => {
  const { email, emails, subject, htmlContent, leadName } = req.body;
  const targetEmails = emails || [email || 'lead@habuild.in'];
  const emailSubject = subject || `[Habuild OJT] Performance Report - ${leadName || 'Team Lead'}`;

  const bodyHtml = htmlContent || `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
      <h2 style="color: #0284c7;">Habuild OJT Daily Performance Update</h2>
      <p>Hello <strong>${leadName || 'Team Lead'}</strong>,</p>
      <p>Here is your daily OJT performance summary automatically generated by Habuild OJT Analytics Engine.</p>
      <div style="background-color: #f8fafc; padding: 15px; border-radius: 6px; margin: 15px 0;">
        <p><strong>System Status:</strong> All sheets and Komal AI metrics synchronized.</p>
      </div>
      <p><a href="http://localhost:3848" style="background-color: #0284c7; color: white; padding: 10px 18px; text-decoration: none; border-radius: 4px; display: inline-block;">Open OJT Dashboard</a></p>
    </div>
  `;

  const results = [];
  for (const target of targetEmails) {
    if (target) {
      const result = await notificationService.sendEmailReport(target, emailSubject, bodyHtml);
      results.push(result);
    }
  }

  res.json({ success: true, count: results.length, results });
});

// Connection Test Endpoints
router.post('/test/whatsapp', async (req, res) => {
  const { phone } = req.body;
  const target = phone || '+919876543210';
  const testMsg = `🔔 *Habuild OJT Test Connection*\nWhatsApp notification service test triggered at ${new Date().toLocaleTimeString()}`;
  const result = await notificationService.sendWhatsAppMessage(target, testMsg);
  res.json({ success: true, result });
});

router.post('/test/email', async (req, res) => {
  const { email } = req.body;
  const target = email || 'admin@habuild.in';
  const testSub = `[Test] Habuild OJT Email Connection Check`;
  const testHtml = `<h3>Habuild OJT Email Connection Test</h3><p>This is a live connection test sent at ${new Date().toLocaleString()}.</p>`;
  const result = await notificationService.sendEmailReport(target, testSub, testHtml);
  res.json({ success: true, result });
});

router.post('/test/google', async (req, res) => {
  try {
    const isInit = googleService.isInitialized();
    if (isInit) {
      await googleSyncService.fetchAndSyncGoogleSheetsData();
      res.json({ success: true, message: 'Google Service connection verified & sheets synced' });
    } else {
      res.json({ success: false, message: 'Google API credentials not configured or initialized' });
    }
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Deep Merge Config Update Endpoint (Prevents shallow merge deletion!)
router.post('/config', (req, res) => {
  const newPartialConfig = req.body;
  if (!newPartialConfig) return res.status(400).json({ success: false, error: 'No config provided' });

  try {
    const existingConfig = getConfig();
    const mergedConfig = deepMerge(existingConfig, newPartialConfig);

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(mergedConfig, null, 2));
    googleService.driveUploadFile('server-config.json', CONFIG_FILE).catch(e => {
      console.error('[API Router] Config drive upload note:', e.message);
    });

    res.json({ success: true, message: 'Configuration updated and deep merged successfully', config: mergedConfig });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Intern Registry Management Endpoints
router.post('/interns', (req, res) => {
  const { intern } = req.body;
  if (!intern || !intern.name) return res.status(400).json({ success: false, error: 'Intern name required' });

  try {
    const config = getConfig();
    if (!config.internsRegistry) config.internsRegistry = [];

    const record = {
      name: intern.name.trim(),
      batch: intern.batch || 'B-20',
      shift: intern.shift || 'AM',
      process: intern.process || 'Success Squad',
      designation: intern.designation || 'OJT Intern',
      lead: intern.lead || 'SONALI',
      phone: intern.phone || '',
      email: intern.email || '',
      type: intern.type || 'chat'
    };

    // Check if updating existing or adding new
    const idx = config.internsRegistry.findIndex(i => i.name.trim().toLowerCase() === record.name.toLowerCase());
    if (idx >= 0) {
      config.internsRegistry[idx] = { ...config.internsRegistry[idx], ...record };
    } else {
      config.internsRegistry.push(record);
    }

    // Handle lead assignment
    if (record.lead) {
      if (!config.assignments) config.assignments = {};
      config.assignments[record.name] = {
        lead: record.lead.toLowerCase(),
        batch: record.batch,
        assignedAt: new Date().toISOString()
      };
    }

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

    // Auto-fetch Komal AI metrics for the newly added/updated intern
    try {
      komalService.syncKomalAIData();
    } catch (err) {
      console.warn('[API Router] Komal AI sync trigger note:', err.message);
    }

    res.json({ success: true, message: 'Intern saved and Komal AI metrics synced successfully', interns: config.internsRegistry });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Bulk Intern Registry Add Endpoint
router.post('/interns/bulk', (req, res) => {
  const { interns } = req.body;
  if (!Array.isArray(interns) || interns.length === 0) {
    return res.status(400).json({ success: false, error: 'Array of interns required' });
  }

  try {
    const config = getConfig();
    if (!config.internsRegistry) config.internsRegistry = [];
    if (!config.assignments) config.assignments = {};

    let addedCount = 0;
    interns.forEach(item => {
      if (!item.name || !item.name.trim()) return;
      const cleanName = item.name.trim();
      const record = {
        name: cleanName,
        batch: item.batch || 'B-20',
        shift: item.shift || 'AM',
        process: item.process || 'Success Squad',
        designation: item.designation || 'OJT Intern',
        lead: item.lead || 'SONALI',
        phone: item.phone || '',
        email: item.email || '',
        type: item.type || 'chat'
      };

      const idx = config.internsRegistry.findIndex(i => i.name.trim().toLowerCase() === cleanName.toLowerCase());
      if (idx >= 0) {
        config.internsRegistry[idx] = { ...config.internsRegistry[idx], ...record };
      } else {
        config.internsRegistry.push(record);
      }

      if (record.lead) {
        config.assignments[cleanName] = {
          lead: record.lead.toLowerCase(),
          batch: record.batch,
          assignedAt: new Date().toISOString()
        };
      }
      addedCount++;
    });

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

    // Auto-fetch Komal AI metrics for all new interns
    try {
      komalService.syncKomalAIData();
    } catch (err) {
      console.warn('[API Router] Bulk Komal AI sync note:', err.message);
    }

    res.json({ success: true, count: addedCount, message: `${addedCount} interns saved and synced successfully!`, interns: config.internsRegistry });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.delete('/interns/:name', (req, res) => {
  const nameParam = decodeURIComponent(req.params.name).trim().toLowerCase();
  try {
    const config = getConfig();
    if (config.internsRegistry) {
      config.internsRegistry = config.internsRegistry.filter(i => i.name.trim().toLowerCase() !== nameParam);
    }
    if (config.assignments) {
      delete config.assignments[req.params.name];
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    res.json({ success: true, message: 'Intern removed successfully' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

const axios = require('axios');

router.get('/proxy-image', async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) {
    return res.status(400).send('Missing url parameter');
  }

  try {
    const response = await axios.get(imageUrl, {
      responseType: 'stream',
      timeout: 10000
    });

    res.setHeader('Content-Type', response.headers['content-type'] || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=1800');
    response.data.pipe(res);
  } catch (err) {
    console.error('[Proxy Image] Error proxying image:', err.message);
    res.status(500).send('Error loading image');
  }
});

// OJT Batch Completion Endpoint
router.post('/batch/complete', (req, res) => {
  const { batch, endDate } = req.body;
  if (!batch) {
    return res.status(400).json({ success: false, error: 'Batch identifier is required' });
  }

  try {
    let rawConfig = {};
    if (fs.existsSync(CONFIG_FILE)) {
      rawConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }

    if (!rawConfig.completedBatches) {
      rawConfig.completedBatches = {};
    }

    const cleanBatch = batch.toUpperCase().trim();
    const effectiveEndDate = endDate || new Date().toISOString().split('T')[0];

    rawConfig.completedBatches[cleanBatch] = {
      batch: cleanBatch,
      name: cleanBatch.startsWith('B-') ? `Batch ${cleanBatch.replace('B-', '')}` : cleanBatch,
      endDate: effectiveEndDate,
      completedAt: new Date().toISOString()
    };

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(rawConfig, null, 2));

    const updatedConfig = getConfig();
    res.json({
      success: true,
      message: `OJT period for ${cleanBatch} successfully marked as completed on ${effectiveEndDate}!`,
      completedBatches: updatedConfig.completedBatches,
      config: updatedConfig
    });
  } catch (e) {
    console.error('[API Router] Error completing batch:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Dynamic range metrics fetch endpoint
router.get('/komal/range-metrics', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'startDate and endDate are required' });
    }

    const config = getConfig();
    const token = config.komalSessionToken;
    if (!token) {
      return res.status(500).json({ success: false, error: 'Komal session token not configured' });
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };

    console.log(`[API Router] Fetching range metrics from Komal AI: ${startDate} to ${endDate}`);
    const realTimeRes = await komalService.requestUrl(
      'https://komal-api.habuild.in/api/v1/agent/getRealTimeAgent',
      'POST',
      {
        startDate,
        endDate,
        limit: 500,
        offset: 0
      },
      headers
    );

    if (realTimeRes && !realTimeRes.error) {
      const records = realTimeRes.data || [];
      const rangeData = {};
      
      records.forEach(rec => {
        if (!rec.name) return;
        const key = rec.name.trim().toLowerCase();
        
        // Note: ARsT and ARpT are swapped in the API!
        // - average_resolution_time contains Response Time (ARST)
        // - average_response_time contains Resolution Time (ARPT)
        const rawArst = rec.average_resolution_time !== undefined ? rec.average_resolution_time : 0;
        const rawBreak = rec.total_break_time !== undefined ? rec.total_break_time : 0;
        const rawArpt = rec.average_response_time !== undefined ? rec.average_response_time : 0;
        const rawFrt = rec.max_first_response_time !== undefined ? rec.max_first_response_time : 0;

        rangeData[key] = {
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
      });

      return res.json({ success: true, data: rangeData });
    } else {
      return res.status(500).json({ success: false, error: realTimeRes ? realTimeRes.error : 'Failed to fetch from Komal AI' });
    }
  } catch (err) {
    console.error('[API Router] Error fetching range metrics:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
