require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('.'));
const quizDir = path.join(path.dirname(__dirname), 'habuild-quiz');
if (fs.existsSync(quizDir)) {
  const quizFile = path.join(quizDir, 'index.html');
  const typingTestFile = path.join(quizDir, 'typing-test.html');
  app.get('/quiz', (req, res) => { res.sendFile(quizFile); });
  app.get('/quiz/', (req, res) => { res.sendFile(quizFile); });
  app.get('/typing-test', (req, res) => { res.sendFile(typingTestFile); });
  app.get('/typing-test/', (req, res) => { res.sendFile(typingTestFile); });
}

const PORT = process.env.PORT || 3848;
const DATA_FILE = path.join(__dirname, 'data.json');
const CONFIG_FILE = path.join(__dirname, 'server-config.json');
const DATA_FILE_NAME = 'data.json';
const CONFIG_FILE_NAME = 'server-config.json';
const DRIVE_STATE_FOLDER_ID = process.env.DRIVE_STATE_FOLDER_ID || null;

// Ensure data.json exists
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ scanData: {}, leadsConfig: {} }, null, 2));
  console.log('[Init] Created empty data.json');
}

// ===== SERVER CONFIG (persistent) =====
function getConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return { leads: {}, sheets: {}, docs: {}, thresholds: {}, targets: {}, internPhones: {}, leadPhones: {}, pulseResponses: {}, tasks: {} }; }
}
function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  driveUploadFile(CONFIG_FILE_NAME, CONFIG_FILE).catch(e => console.error('[DriveSync] config upload failed:', e.message));
}
// Use this instead of a raw fs.writeFileSync(DATA_FILE, ...) anywhere below,
// so every data write also gets pushed to the Drive backup copy.
function writeDataFile(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  driveUploadFile(DATA_FILE_NAME, DATA_FILE).catch(e => console.error('[DriveSync] data upload failed:', e.message));
}

// ===== GOOGLE APIs =====
let google, sheets, docs, drive;
try {
  const { google: g } = require('googleapis');
  google = g;
  const scopes = [
    'https://www.googleapis.com/auth/spreadsheets.readonly',
    'https://www.googleapis.com/auth/documents.readonly',
    'https://www.googleapis.com/auth/drive'
  ];
  let auth;
  // Support env variable GOOGLE_CREDENTIALS_JSON (for Railway/cloud deployment)
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    auth = new google.auth.GoogleAuth({ credentials: creds, scopes });
    console.log('[Google] Using credentials from environment variable');
  } else {
    // Fallback to file-based credentials (local development)
    const credsFile = process.env.GOOGLE_CREDENTIALS_FILE || 'google-credentials.json';
    if (fs.existsSync(path.join(__dirname, credsFile))) {
      auth = new google.auth.GoogleAuth({ keyFile: path.join(__dirname, credsFile), scopes });
      console.log('[Google] Using credentials from file');
    }
  }
  if (auth) {
    sheets = google.sheets({ version: 'v4', auth });
    docs = google.docs({ version: 'v1', auth });
    drive = google.drive({ version: 'v3', auth });
    console.log('[Google] APIs initialized');
  } else {
    console.log('[Google] No credentials found. Google sync disabled.');
  }
} catch (e) {
  console.log('[Google] googleapis not installed or error:', e.message);
}

// ===== DRIVE-BACKED PERSISTENCE =====
// Render's free web service disk is wiped on every restart/redeploy.
// To keep data.json / server-config.json across restarts without a paid
// persistent disk, we mirror both files into a Google Drive folder that
// you own (share that folder with the service account email as Editor,
// then set its folder ID as DRIVE_STATE_FOLDER_ID in Render's environment).
let driveStateCache = {}; // fileName -> Drive file ID, filled in on first use
async function driveFindFileId(fileName) {
  if (!drive || !DRIVE_STATE_FOLDER_ID) return null;
  if (driveStateCache[fileName]) return driveStateCache[fileName];
  try {
    const q = `'${DRIVE_STATE_FOLDER_ID}' in parents and name = '${fileName}' and trashed = false`;
    const res = await drive.files.list({ q, fields: 'files(id, name)', spaces: 'drive' });
    const file = res.data.files && res.data.files[0];
    if (file) { driveStateCache[fileName] = file.id; return file.id; }
    return null;
  } catch (e) {
    console.error('[DriveSync] lookup failed for', fileName, ':', e.message);
    return null;
  }
}
async function driveDownloadFile(fileName, localPath) {
  if (!drive || !DRIVE_STATE_FOLDER_ID) return false;
  try {
    const fileId = await driveFindFileId(fileName);
    if (!fileId) { console.log(`[DriveSync] No backup found yet for ${fileName}, starting fresh.`); return false; }
    const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });
    fs.writeFileSync(localPath, typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2));
    console.log(`[DriveSync] Restored ${fileName} from Drive backup.`);
    return true;
  } catch (e) {
    console.error('[DriveSync] download failed for', fileName, ':', e.message);
    return false;
  }
}
async function driveUploadFile(fileName, localPath) {
  if (!drive || !DRIVE_STATE_FOLDER_ID) return false;
  try {
    const media = { mimeType: 'application/json', body: fs.createReadStream(localPath) };
    const fileId = await driveFindFileId(fileName);
    if (fileId) {
      await drive.files.update({ fileId, media });
    } else {
      const created = await drive.files.create({
        resource: { name: fileName, parents: [DRIVE_STATE_FOLDER_ID] },
        media, fields: 'id'
      });
      driveStateCache[fileName] = created.data.id;
    }
    return true;
  } catch (e) {
    console.error('[DriveSync] upload failed for', fileName, ':', e.message);
    return false;
  }
}
// Pull the latest backup down before the server starts serving requests.
async function restoreStateFromDrive() {
  if (!drive || !DRIVE_STATE_FOLDER_ID) {
    console.log('[DriveSync] DRIVE_STATE_FOLDER_ID not set — running on local disk only (data will not survive a restart on Render free tier).');
    return;
  }
  await driveDownloadFile(CONFIG_FILE_NAME, CONFIG_FILE);
  await driveDownloadFile(DATA_FILE_NAME, DATA_FILE);
}

// ===== TWILIO WHATSAPP =====
let twilioClient;
try {
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_ACCOUNT_SID !== 'your_account_sid_here') {
    const twilio = require('twilio');
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    console.log('[WhatsApp] Twilio initialized');
  } else {
    console.log('[WhatsApp] No Twilio credentials. WhatsApp disabled.');
  }
} catch (e) {
  console.log('[WhatsApp] Twilio not available:', e.message);
}

// ===== HELPER: Extract Sheet ID from URL =====
function extractSheetId(url) {
  if (!url) return null;
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}
function extractDocId(url) {
  if (!url) return null;
  const m = url.match(/\/document\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

// ===== HELPER: Parse date from various formats =====
function parseDate(v) {
  if (!v) return null;
  if (typeof v === 'number') {
    if (v <= 0) return null; // blank sheet cells sometimes come through as 0 -> was silently becoming 1899-12-30
    return new Date((v - 25569) * 86400000).toISOString().split('T')[0];
  }
  const s = String(v).trim();
  if (!s) return null;
  // Sheets in this org are entered DD/MM/YYYY or DD-MM-YYYY (Indian format).
  // Plain `new Date(s)` assumes US MM/DD/YYYY and silently swaps day/month
  // for any date where the day is 12 or less, which is how records ended up
  // scattered into wrong months (and even years) after sync.
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmy) {
    let [, day, month, year] = dmy;
    day = parseInt(day, 10); month = parseInt(month, 10); year = parseInt(year, 10);
    if (year < 100) year += 2000;
    if (month > 12 && day <= 12) { [day, month] = [month, day]; } // sheet actually had MM/DD, swap back
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(Date.UTC(year, month - 1, day));
    return isNaN(d) ? null : d.toISOString().split('T')[0];
  }
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().split('T')[0];
}
function parseNum(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }

// ===== GOOGLE SHEETS SYNC =====
async function syncSheet(leadName, sheetUrl) {
  if (!sheets) return { error: 'Google Sheets API not configured' };
  const sheetId = extractSheetId(sheetUrl);
  if (!sheetId) return { error: 'Invalid Google Sheet URL' };

  try {
    // Get all sheet names
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const tabNames = meta.data.sheets.map(s => s.properties.title);
    console.log(`[Sheets] ${leadName}: Found ${tabNames.length} tabs: ${tabNames.join(', ')}`);

    const result = {};
    let totalRecords = 0;

    for (const tabName of tabNames) {
      // Only process audit/scan tabs
      const tl = tabName.toLowerCase();
      if (!tl.includes('chat scan') && !tl.includes('cs b-') && !tl.includes('cs sheet') && !tl.includes('audit')) continue;
      if (tl.includes('count') || tl.includes('summary') || tl.includes('daily') || tl.includes('score') || tl.includes('update')) continue;

      // Extract batch number
      let batch = null;
      let m = tabName.match(/B[\s-]*(\d+)/i); if (m) batch = 'B-' + m[1];
      if (!batch) { m = tabName.match(/Batch[\s-]*(\d+)/i); if (m) batch = 'B-' + m[1]; }
      if (!batch) { m = tabName.match(/Audit[\s-]*(\d+)/i); if (m) batch = 'B-' + m[1]; }
      if (!batch) continue;

      // Read data
      const range = `'${tabName}'`;
      const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range });
      const rows = res.data.values;
      if (!rows || rows.length < 2) continue;

      const headers = rows[0].map(h => String(h || '').trim().toLowerCase());
      const records = [];

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const find = (patterns) => {
          for (const p of patterns) {
            const idx = headers.findIndex(h => h.includes(p.toLowerCase()));
            if (idx >= 0 && row[idx] !== undefined && row[idx] !== '') return row[idx];
          }
          return null;
        };

        const internName = find(['intern name', 'team memeber name', 'executive name', 'agent name', 'name']);
        if (!internName || internName.length < 2) continue;

        const impRaw = find(['improvements needed', 'needs improvement']);
        let improvementsNeeded = 'No';
        if (impRaw && String(impRaw).trim().toLowerCase().startsWith('y')) improvementsNeeded = 'Yes';

        records.push({
          scanDate: parseDate(find(['scan date', 'date'])),
          chatDate: parseDate(find(['chat date', 'date of conversation'])),
          internName: internName.trim(),
          number: String(find(['number', 'member contact number', 'whatsaap number']) || ''),
          chatType: find(['chat type', 'query type', 'categories']),
          leadRating: parseNum(find(["lead's rating", 'lead rating', 'average rating', 'avg. rating'])),
          aiRating: parseNum(find(['ai rating', 'ai- avg rating', 'dashboard rating'])),
          improvementsNeeded,
          summary: find(['summary of chat', 'feedback /description', 'feedback', 'remark', 'any additional observations']),
          lead: leadName,
          accuracyRating: parseNum(find(['accuracy rating', 'accuracy'])),
          empathyRating: parseNum(find(['empathy rating', 'empathy'])),
          grammarRating: parseNum(find(['grammar and spelling', 'grammer'])),
          problemSolvingRating: parseNum(find(['problem-solving skills', 'problem solving'])),
        });
      }

      if (records.length > 0) {
        if (!result[batch]) result[batch] = [];
        result[batch].push(...records);
        totalRecords += records.length;
        console.log(`[Sheets] ${leadName}/${tabName} -> ${batch}: ${records.length} records`);
      }
    }

    return { batches: result, totalRecords };
  } catch (e) {
    console.error('[Sheets] Error syncing', leadName, ':', e.message);
    return { error: e.message };
  }
}

// ===== GOOGLE DOCS SYNC (QC Document) =====
async function syncQCDoc(leadName, docUrl) {
  if (!docs) return { error: 'Google Docs API not configured' };
  const docId = extractDocId(docUrl);
  if (!docId) return { error: 'Invalid Google Doc URL' };

  try {
    const doc = await docs.documents.get({ documentId: docId });
    const content = doc.data.body.content;
    const title = doc.data.title;

    // Extract text content, organized by intern tabs/sections
    const internSections = {};
    let currentIntern = null;
    let currentText = '';

    for (const elem of content) {
      if (elem.paragraph) {
        const text = elem.paragraph.elements.map(e => e.textRun?.content || '').join('').trim();
        const style = elem.paragraph.paragraphStyle?.namedStyleType;

        // Detect intern name headers (typically HEADING_1, HEADING_2, or bold text)
        if (style && (style.includes('HEADING_1') || style.includes('HEADING_2'))) {
          if (currentIntern && currentText) {
            internSections[currentIntern] = currentText.trim();
          }
          currentIntern = text;
          currentText = '';
        } else {
          currentText += text + '\n';
        }
      }
      // Handle tables (QC errors are often in tables)
      if (elem.table) {
        for (const row of elem.table.tableRows || []) {
          const cells = (row.tableCells || []).map(cell =>
            (cell.content || []).map(c =>
              (c.paragraph?.elements || []).map(e => e.textRun?.content || '').join('')
            ).join(' ').trim()
          );
          currentText += cells.join(' | ') + '\n';
        }
      }
    }
    if (currentIntern && currentText) {
      internSections[currentIntern] = currentText.trim();
    }

    // Extract images (get image URLs from the doc)
    const images = [];
    for (const elem of content) {
      if (elem.paragraph) {
        for (const e of elem.paragraph.elements) {
          if (e.inlineObjectElement) {
            const objId = e.inlineObjectElement.inlineObjectId;
            const obj = doc.data.inlineObjects?.[objId];
            if (obj) {
              const imageProps = obj.inlineObjectProperties?.embeddedObject;
              const uri = imageProps?.imageProperties?.contentUri || imageProps?.imageProperties?.sourceUri;
              if (uri) images.push({ id: objId, uri, near: currentIntern });
            }
          }
        }
      }
    }

    console.log(`[Docs] ${leadName}: "${title}" - ${Object.keys(internSections).length} intern sections, ${images.length} images`);
    return { title, internSections, images, fullText: Object.values(internSections).join('\n\n') };
  } catch (e) {
    console.error('[Docs] Error syncing', leadName, ':', e.message);
    return { error: e.message };
  }
}

// ===== WHATSAPP MESSAGING =====
async function sendWhatsApp(to, message) {
  if (!twilioClient) {
    console.log('[WhatsApp] Would send to', to, ':', message.substring(0, 100) + '...');
    return { sent: false, reason: 'Twilio not configured' };
  }
  try {
    const result = await twilioClient.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM,
      to: to,
      body: message
    });
    console.log('[WhatsApp] Sent to', to, 'SID:', result.sid);
    return { sent: true, sid: result.sid };
  } catch (e) {
    console.error('[WhatsApp] Error:', e.message);
    return { sent: false, error: e.message };
  }
}

// ===== GOOGLE DRIVE ARCHIVING =====
async function archiveToDrive(batchName) {
  if (!drive) return { error: 'Google Drive API not configured' };
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const batchData = data.scanData[batchName];
    if (!batchData) return { error: 'Batch not found' };

    const month = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const folderName = `HaBuild — ${batchName} — Archive — ${month}`;

    // Create folder
    const folder = await drive.files.create({
      requestBody: { name: folderName, mimeType: 'application/vnd.google-apps.folder' },
      fields: 'id, webViewLink'
    });

    // Upload data as JSON
    const fileContent = JSON.stringify({ batch: batchName, records: batchData, archivedAt: new Date().toISOString() }, null, 2);
    await drive.files.create({
      requestBody: { name: `${batchName}_performance_data.json`, parents: [folder.data.id] },
      media: { mimeType: 'application/json', body: fileContent }
    });

    // Upload config
    const cfg = getConfig();
    await drive.files.create({
      requestBody: { name: `${batchName}_config.json`, parents: [folder.data.id] },
      media: { mimeType: 'application/json', body: JSON.stringify(cfg, null, 2) }
    });

    console.log('[Drive] Archived', batchName, 'to', folderName);

    // Notify admin
    if (process.env.ADMIN_WHATSAPP) {
      await sendWhatsApp(process.env.ADMIN_WHATSAPP,
        `✅ Archive Complete\n\nBatch: ${batchName}\nFolder: ${folderName}\nRecords: ${batchData.length}\nLink: ${folder.data.webViewLink || 'Check Google Drive'}`
      );
    }

    return { success: true, folderId: folder.data.id, folderName, link: folder.data.webViewLink };
  } catch (e) {
    console.error('[Drive] Archive error:', e.message);
    return { error: e.message };
  }
}

// ===== WEEKLY REPORT GENERATOR =====
function generateWeeklyReport(leadName) {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const now = new Date();
  const weekAgo = new Date(now - 7 * 86400000);
  const weekStr = weekAgo.toISOString().split('T')[0];

  let records = [];
  for (const [batch, recs] of Object.entries(data.scanData)) {
    const filtered = recs.filter(r => r.lead === leadName && r.scanDate >= weekStr);
    records.push(...filtered);
  }

  if (!records.length) return null;

  const interns = {};
  records.forEach(r => {
    if (!interns[r.internName]) interns[r.internName] = { total: 0, errors: 0, ratingSum: 0, ratingCount: 0 };
    interns[r.internName].total++;
    if (r.improvementsNeeded === 'Yes') interns[r.internName].errors++;
    if (r.leadRating) { interns[r.internName].ratingSum += r.leadRating; interns[r.internName].ratingCount++; }
  });

  let msg = `📊 *Weekly QC Report — ${leadName}*\n`;
  msg += `Week: ${weekStr} to ${now.toISOString().split('T')[0]}\n\n`;

  const totalAudits = records.length;
  const totalErrors = records.filter(r => r.improvementsNeeded === 'Yes').length;
  const avgError = totalAudits ? ((totalErrors / totalAudits) * 100).toFixed(1) : 0;
  msg += `Total Audits: ${totalAudits} | Errors: ${totalErrors} (${avgError}%)\n\n`;

  for (const [name, v] of Object.entries(interns)) {
    const errPct = v.total ? ((v.errors / v.total) * 100).toFixed(0) : 0;
    const avg = v.ratingCount ? (v.ratingSum / v.ratingCount).toFixed(2) : 'N/A';
    const trend = errPct > 15 ? '🔴' : errPct > 8 ? '🟡' : '🟢';
    msg += `${trend} *${name}*: ${v.total} audits, ${errPct}% errors, Rating: ${avg}\n`;
  }

  // Flag high risk
  const flagged = Object.entries(interns).filter(([, v]) => v.total >= 3 && (v.errors / v.total) > 0.15);
  if (flagged.length) {
    msg += `\n⚠️ *Flagged:*\n`;
    flagged.forEach(([name, v]) => {
      msg += `• ${name}: ${((v.errors / v.total) * 100).toFixed(0)}% error rate\n`;
    });
  }

  return msg;
}

// ===== PULSE SURVEY =====
async function sendPulseSurvey() {
  const cfg = getConfig();
  const phones = cfg.internPhones || {};
  let sent = 0;

  for (const [intern, phone] of Object.entries(phones)) {
    if (!phone) continue;
    const msg = `Hi ${intern}! 👋\n\nQuick pulse check: *How are you feeling about your work this week?*\n\nReply with a number:\n1️⃣ Very low\n2️⃣ Low\n3️⃣ Okay\n4️⃣ Good\n5️⃣ Very confident\n\n(Just reply with the number)`;
    await sendWhatsApp(phone, msg);
    sent++;
  }
  console.log(`[Pulse] Sent survey to ${sent} interns`);
  return { sent };
}

// ===== THRESHOLD CHECK =====
function checkThresholds() {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const cfg = getConfig();
  const thresholds = cfg.thresholds || { 1: 15, 2: 10, 3: 8, 4: 5, 5: 5 };
  const alerts = [];

  for (const [batch, recs] of Object.entries(data.scanData)) {
    const internMap = {};
    recs.forEach(r => {
      if (!internMap[r.internName]) internMap[r.internName] = { total: 0, errors: 0, firstDate: r.scanDate, lead: r.lead };
      internMap[r.internName].total++;
      if (r.improvementsNeeded === 'Yes') internMap[r.internName].errors++;
      if (r.scanDate && (!internMap[r.internName].firstDate || r.scanDate < internMap[r.internName].firstDate)) {
        internMap[r.internName].firstDate = r.scanDate;
      }
    });

    for (const [name, v] of Object.entries(internMap)) {
      if (v.total < 3) continue;
      const errPct = (v.errors / v.total) * 100;

      // Calculate OJT week
      const firstDate = new Date(v.firstDate);
      const now = new Date();
      const weeks = Math.ceil((now - firstDate) / (7 * 86400000));
      const week = Math.min(weeks, 5);
      const threshold = thresholds[week] || 5;

      if (errPct > threshold) {
        alerts.push({
          intern: name, batch, lead: v.lead, week,
          errPct: errPct.toFixed(1), threshold, total: v.total, errors: v.errors
        });
      }
    }
  }

  return alerts;
}

async function sendThresholdAlerts() {
  const alerts = checkThresholds();
  if (!alerts.length) return;

  const cfg = getConfig();
  const leadPhones = cfg.leadPhones || {};

  // Group by lead
  const byLead = {};
  alerts.forEach(a => {
    if (!byLead[a.lead]) byLead[a.lead] = [];
    byLead[a.lead].push(a);
  });

  for (const [lead, items] of Object.entries(byLead)) {
    let msg = `🚨 *QC Alert — ${lead}*\n\n`;
    items.forEach(a => {
      msg += `⚠️ *${a.intern}* (${a.batch})\nWeek ${a.week}: ${a.errPct}% errors (threshold: ${a.threshold}%)\n${a.errors}/${a.total} audits flagged\n\n`;
    });

    // Send to lead
    if (leadPhones[lead]) await sendWhatsApp(leadPhones[lead], msg);
    // Send to admin
    if (process.env.ADMIN_WHATSAPP) await sendWhatsApp(process.env.ADMIN_WHATSAPP, msg);
  }

  console.log(`[Alerts] Sent ${alerts.length} threshold alerts`);
}

// ===== ENHANCED QC DOC PARSING (morning/evening, errors vs suggestions) =====
async function syncQCDocEnhanced(batch, shift, docUrl) {
  if (!docs) return { error: 'Google Docs API not configured' };
  const docId = extractDocId(docUrl);
  if (!docId) return { error: 'Invalid Google Doc URL' };

  try {
    const doc = await docs.documents.get({ documentId: docId });
    const content = doc.data.body.content;
    const title = doc.data.title;

    // Parse by intern sections (tabs)
    const internData = {};
    let currentIntern = null;
    let currentSection = null; // 'qc_error' or 'suggestion'
    let currentLines = [];

    for (const elem of content) {
      if (elem.paragraph) {
        const text = elem.paragraph.elements.map(e => e.textRun?.content || '').join('').trim();
        const style = elem.paragraph.paragraphStyle?.namedStyleType;

        // Detect intern name (HEADING_1 or HEADING_2)
        if (style && (style.includes('HEADING_1') || style.includes('HEADING_2'))) {
          if (currentIntern) {
            saveSection(internData, currentIntern, currentSection, currentLines);
          }
          currentIntern = text;
          currentSection = null;
          currentLines = [];
          if (!internData[currentIntern]) internData[currentIntern] = { errors: [], suggestions: [], errorCount: 0, suggestionCount: 0 };
          continue;
        }

        // Detect section headers within intern
        const lower = text.toLowerCase();
        if (lower.includes('qc error') || lower.includes('quality error') || lower.includes('errors found')) {
          saveSection(internData, currentIntern, currentSection, currentLines);
          currentSection = 'qc_error';
          currentLines = [];
          continue;
        }
        if (lower.includes('suggestion') || lower.includes('improvements') || lower.includes('recommendations')) {
          saveSection(internData, currentIntern, currentSection, currentLines);
          currentSection = 'suggestion';
          currentLines = [];
          continue;
        }

        if (text) currentLines.push(text);
      }

      // Handle tables
      if (elem.table) {
        for (const row of elem.table.tableRows || []) {
          const cells = (row.tableCells || []).map(cell =>
            (cell.content || []).map(c =>
              (c.paragraph?.elements || []).map(e => e.textRun?.content || '').join('')
            ).join(' ').trim()
          );
          currentLines.push(cells.join(' | '));
        }
      }
    }
    if (currentIntern) saveSection(internData, currentIntern, currentSection, currentLines);

    // Extract images
    const images = [];
    let nearIntern = null;
    for (const elem of content) {
      if (elem.paragraph) {
        const text = elem.paragraph.elements.map(e => e.textRun?.content || '').join('').trim();
        const style = elem.paragraph.paragraphStyle?.namedStyleType;
        if (style && (style.includes('HEADING_1') || style.includes('HEADING_2'))) nearIntern = text;
        for (const e of elem.paragraph.elements) {
          if (e.inlineObjectElement) {
            const objId = e.inlineObjectElement.inlineObjectId;
            const obj = doc.data.inlineObjects?.[objId];
            if (obj) {
              const imageProps = obj.inlineObjectProperties?.embeddedObject;
              const uri = imageProps?.imageProperties?.contentUri || imageProps?.imageProperties?.sourceUri;
              if (uri) images.push({ id: objId, uri, near: nearIntern });
            }
          }
        }
      }
    }

    console.log(`[QCDoc] ${batch}/${shift}: "${title}" - ${Object.keys(internData).length} interns`);

    // Store in config
    const cfg = getConfig();
    if (!cfg.qcDocData) cfg.qcDocData = {};
    if (!cfg.qcDocData[batch]) cfg.qcDocData[batch] = {};
    cfg.qcDocData[batch][shift] = { interns: internData, images, title, syncedAt: new Date().toISOString() };
    saveConfig(cfg);

    return { success: true, title, interns: Object.keys(internData).length, images: images.length, data: internData };
  } catch (e) {
    console.error('[QCDoc] Error:', e.message);
    return { error: e.message };
  }
}

function saveSection(internData, intern, section, lines) {
  if (!intern || !internData[intern] || !lines.length) return;
  const text = lines.filter(l => l.trim()).join('\n');
  if (section === 'qc_error') {
    internData[intern].errors.push(...lines.filter(l => l.trim()));
    internData[intern].errorCount = internData[intern].errors.length;
  } else if (section === 'suggestion') {
    internData[intern].suggestions.push(...lines.filter(l => l.trim()));
    internData[intern].suggestionCount = internData[intern].suggestions.length;
  } else {
    // Auto-classify if no section header
    lines.forEach(l => {
      if (/error|incorrect|wrong|missed|not done|not shared/i.test(l)) {
        internData[intern].errors.push(l);
        internData[intern].errorCount++;
      } else if (/suggest|could have|should have|better to|ideally|additionally/i.test(l)) {
        internData[intern].suggestions.push(l);
        internData[intern].suggestionCount++;
      }
    });
  }
}

// ============================
// API ROUTES
// ============================

// --- Data ---
app.get('/api/data', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Sync Google Sheet ---
app.post('/api/sync-sheet', async (req, res) => {
  const { lead, url } = req.body;
  if (!lead || !url) return res.status(400).json({ error: 'lead and url required' });

  const result = await syncSheet(lead, url);
  if (result.error) return res.status(500).json(result);

  // Merge into data.json
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  for (const [batch, recs] of Object.entries(result.batches)) {
    if (!data.scanData[batch]) data.scanData[batch] = [];
    const existing = new Set(data.scanData[batch].map(r => `${r.internName}|${r.scanDate}|${r.number}`));
    let added = 0;
    recs.forEach(r => {
      const key = `${r.internName}|${r.scanDate}|${r.number}`;
      if (!existing.has(key)) { data.scanData[batch].push(r); existing.add(key); added++; }
    });
    console.log(`[Sync] ${batch}: +${added} new records`);
  }
  if (!data.leadsConfig) data.leadsConfig = {};
  data.leadsConfig[lead] = [...new Set(Object.keys(result.batches))].sort();
  writeDataFile(data);

  // Save sheet URL to config
  const cfg = getConfig();
  if (!cfg.sheets) cfg.sheets = {};
  cfg.sheets[lead] = url;
  saveConfig(cfg);

  res.json({ success: true, totalRecords: result.totalRecords, batches: Object.keys(result.batches) });
});

// --- Sync QC Document ---
app.post('/api/sync-doc', async (req, res) => {
  const { lead, url } = req.body;
  if (!lead || !url) return res.status(400).json({ error: 'lead and url required' });

  const result = await syncQCDoc(lead, url);
  if (result.error) return res.status(500).json(result);

  // Save doc URL and content to config
  const cfg = getConfig();
  if (!cfg.docs) cfg.docs = {};
  cfg.docs[lead] = { url, title: result.title, sections: result.internSections, images: result.images };
  saveConfig(cfg);

  res.json({ success: true, title: result.title, sections: Object.keys(result.internSections).length, images: result.images.length });
});

// --- Get QC Doc sections ---
app.get('/api/qc-doc/:lead', (req, res) => {
  const cfg = getConfig();
  const doc = cfg.docs?.[req.params.lead];
  if (!doc) return res.json({ sections: {}, images: [] });
  res.json({ title: doc.title, sections: doc.sections || {}, images: doc.images || [] });
});

// --- Send WhatsApp ---
app.post('/api/whatsapp/send', async (req, res) => {
  let { to, message } = req.body;
  if (!to || !message) return res.status(400).json({ error: 'to and message required' });
  // Look up phone from config if name given
  const cfg = getConfig();
  if (!to.startsWith('whatsapp:') && !to.startsWith('+')) {
    const phone = cfg.internPhones?.[to] || cfg.leadPhones?.[to];
    if (phone) to = phone;
    else if (to === 'admin' && process.env.ADMIN_WHATSAPP) to = process.env.ADMIN_WHATSAPP;
    else return res.json({ sent: false, reason: 'No phone number found for: ' + to });
  }
  if (!to.startsWith('whatsapp:')) to = 'whatsapp:' + to;
  const result = await sendWhatsApp(to, message);
  res.json(result);
});

// --- Weekly Report ---
app.post('/api/whatsapp/weekly-report', async (req, res) => {
  const cfg = getConfig();
  const leadPhones = cfg.leadPhones || {};
  const results = [];

  for (const lead of Object.keys(cfg.leads || {})) {
    const report = generateWeeklyReport(lead);
    if (!report) continue;

    // Send to lead
    if (leadPhones[lead]) {
      const r = await sendWhatsApp(leadPhones[lead], report);
      results.push({ lead, to: 'lead', ...r });
    }
    // Send to admin
    if (process.env.ADMIN_WHATSAPP) {
      const r = await sendWhatsApp(process.env.ADMIN_WHATSAPP, report);
      results.push({ lead, to: 'admin', ...r });
    }
  }
  res.json({ results });
});

// --- Preview Weekly Report ---
app.get('/api/weekly-report/:lead', (req, res) => {
  const report = generateWeeklyReport(req.params.lead);
  res.json({ report: report || 'No data for this lead this week' });
});

// --- Threshold Alerts ---
app.get('/api/alerts', (req, res) => {
  res.json({ alerts: checkThresholds() });
});

app.post('/api/alerts/send', async (req, res) => {
  await sendThresholdAlerts();
  res.json({ success: true });
});

// --- Pulse Survey ---
app.post('/api/pulse/send', async (req, res) => {
  const result = await sendPulseSurvey();
  res.json(result);
});

app.post('/api/pulse/response', (req, res) => {
  const { intern, score, week } = req.body;
  const cfg = getConfig();
  if (!cfg.pulseResponses) cfg.pulseResponses = {};
  if (!cfg.pulseResponses[intern]) cfg.pulseResponses[intern] = [];
  cfg.pulseResponses[intern].push({ score, week, date: new Date().toISOString() });
  saveConfig(cfg);

  // Flag low scores
  if (score <= 2 && process.env.ADMIN_WHATSAPP) {
    sendWhatsApp(process.env.ADMIN_WHATSAPP,
      `🔴 *Low Pulse Alert*\n${intern} reported ${score}/5 this week.\nPlease check in with them.`
    );
  }
  res.json({ success: true });
});

app.get('/api/pulse/responses', (req, res) => {
  const cfg = getConfig();
  res.json(cfg.pulseResponses || {});
});

// --- Archive ---
app.post('/api/archive', async (req, res) => {
  const { batch } = req.body;
  if (!batch) return res.status(400).json({ error: 'batch required' });
  const result = await archiveToDrive(batch);
  res.json(result);
});

// --- Config endpoints ---
app.get('/api/config', (req, res) => res.json({ ...getConfig(), googleEnabled: !!sheets, twilioEnabled: !!twilioClient }));

app.post('/api/config', (req, res) => {
  const cfg = { ...getConfig(), ...req.body };
  saveConfig(cfg);
  res.json({ success: true });
});

app.post('/api/config/leads', (req, res) => {
  const cfg = getConfig();
  if (!cfg.leads) cfg.leads = {};
  const { name, batches } = req.body;
  cfg.leads[name] = { batches: batches || [] };
  saveConfig(cfg);
  res.json({ success: true });
});

app.delete('/api/config/leads/:name', (req, res) => {
  const cfg = getConfig();
  delete cfg.leads?.[req.params.name];
  saveConfig(cfg);
  res.json({ success: true });
});

app.post('/api/config/phones', (req, res) => {
  const cfg = getConfig();
  const { type, name, phone } = req.body;
  if (type === 'intern') { if (!cfg.internPhones) cfg.internPhones = {}; cfg.internPhones[name] = phone; }
  if (type === 'lead') { if (!cfg.leadPhones) cfg.leadPhones = {}; cfg.leadPhones[name] = phone; }
  saveConfig(cfg);
  res.json({ success: true });
});

app.post('/api/config/thresholds', (req, res) => {
  const cfg = getConfig();
  cfg.thresholds = req.body;
  saveConfig(cfg);
  res.json({ success: true });
});

app.post('/api/config/targets', (req, res) => {
  const cfg = getConfig();
  cfg.targets = req.body;
  saveConfig(cfg);
  res.json({ success: true });
});

// --- Sync all sheets ---
app.post('/api/sync-all', async (req, res) => {
  const cfg = getConfig();
  const results = [];
  for (const [lead, url] of Object.entries(cfg.sheets || {})) {
    if (!url) continue;
    console.log(`[Sync] Syncing ${lead}...`);
    const r = await syncSheet(lead, url);
    if (!r.error) {
      // Merge
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      for (const [batch, recs] of Object.entries(r.batches)) {
        if (!data.scanData[batch]) data.scanData[batch] = [];
        const existing = new Set(data.scanData[batch].map(r2 => `${r2.internName}|${r2.scanDate}|${r2.number}`));
        recs.forEach(r2 => {
          const key = `${r2.internName}|${r2.scanDate}|${r2.number}`;
          if (!existing.has(key)) { data.scanData[batch].push(r2); existing.add(key); }
        });
      }
      writeDataFile(data);
    }
    results.push({ lead, ...(r.error ? { error: r.error } : { records: r.totalRecords }) });
  }
  // Also sync QC docs
  for (const [lead, docInfo] of Object.entries(cfg.docs || {})) {
    if (!docInfo?.url) continue;
    const r = await syncQCDoc(lead, docInfo.url);
    if (!r.error) {
      cfg.docs[lead] = { url: docInfo.url, title: r.title, sections: r.internSections, images: r.images };
    }
  }
  saveConfig(cfg);
  res.json({ results });
});

// --- Twilio Webhook (incoming WhatsApp messages) ---
app.post('/api/whatsapp/webhook', (req, res) => {
  const { From, Body } = req.body;
  console.log('[WhatsApp] Incoming from', From, ':', Body);

  // Check if it's a pulse survey response (1-5)
  const score = parseInt(Body?.trim());
  if (score >= 1 && score <= 5) {
    const cfg = getConfig();
    const phones = cfg.internPhones || {};
    const intern = Object.entries(phones).find(([, p]) => p === From)?.[0];
    if (intern) {
      const week = Math.ceil((new Date() - new Date('2025-01-01')) / (7 * 86400000));
      if (!cfg.pulseResponses) cfg.pulseResponses = {};
      if (!cfg.pulseResponses[intern]) cfg.pulseResponses[intern] = [];
      cfg.pulseResponses[intern].push({ score, week, date: new Date().toISOString() });
      saveConfig(cfg);

      if (score <= 2 && process.env.ADMIN_WHATSAPP) {
        sendWhatsApp(process.env.ADMIN_WHATSAPP,
          `🔴 *Low Pulse Alert*\n${intern} reported ${score}/5 this week.\nImmediate check-in recommended.`
        );
      }
      console.log(`[Pulse] ${intern} responded: ${score}/5`);
    }
  }
  res.status(200).send('OK');
});

// --- Sync QC Batch Docs (morning/evening) ---
app.post('/api/sync-qc-batch-docs', async (req, res) => {
  const { batch, shift, url } = req.body;
  if (!batch || !shift || !url) return res.status(400).json({ error: 'batch, shift, and url required' });
  const result = await syncQCDocEnhanced(batch, shift, url);
  res.json(result);
});

// --- Get QC doc data for a batch ---
app.get('/api/qc-doc-data/:batch', (req, res) => {
  const cfg = getConfig();
  const data = cfg.qcDocData?.[req.params.batch];
  if (!data) return res.json({ morning: {}, evening: {} });
  res.json(data);
});

// --- Get all QC doc data ---
app.get('/api/qc-doc-data', (req, res) => {
  const cfg = getConfig();
  res.json(cfg.qcDocData || {});
});

// --- Remove intern ---
app.post('/api/remove-intern', (req, res) => {
  const { intern } = req.body;
  if (!intern) return res.status(400).json({ error: 'intern name required' });
  const cfg = getConfig();
  // Remove from any task assignments
  if (cfg.tasks?.[intern]) delete cfg.tasks[intern];
  if (cfg.internPhones?.[intern]) delete cfg.internPhones[intern];
  saveConfig(cfg);
  res.json({ success: true, message: intern + ' removed' });
});

// --- Assign/reassign intern to lead+batch ---
app.post('/api/assign-team', (req, res) => {
  const { intern, lead, batch } = req.body;
  if (!intern || !lead) return res.status(400).json({ error: 'intern and lead required' });
  const cfg = getConfig();
  if (!cfg.assignments) cfg.assignments = {};
  cfg.assignments[intern] = { lead, batch, assignedAt: new Date().toISOString() };
  saveConfig(cfg);
  res.json({ success: true });
});

// ============================
// SCHEDULED TASKS
// ============================

// Monday 9:00 AM — Weekly reports
cron.schedule('0 9 * * 1', async () => {
  console.log('[Cron] Monday weekly report...');
  const cfg = getConfig();
  for (const lead of Object.keys(cfg.leads || {})) {
    const report = generateWeeklyReport(lead);
    if (!report) continue;
    if (cfg.leadPhones?.[lead]) await sendWhatsApp(cfg.leadPhones[lead], report);
    if (process.env.ADMIN_WHATSAPP) await sendWhatsApp(process.env.ADMIN_WHATSAPP, report);
  }
});

// Every 4 hours — Threshold alerts check
cron.schedule('0 */4 * * *', async () => {
  console.log('[Cron] Checking thresholds...');
  await sendThresholdAlerts();
});

// Friday 5:00 PM — Pulse survey
cron.schedule('0 17 * * 5', async () => {
  console.log('[Cron] Sending pulse survey...');
  await sendPulseSurvey();
});

// Every 30 minutes — Auto-sync sheets + QC batch docs
cron.schedule('*/30 * * * *', async () => {
  const cfg = getConfig();
  // Sync OJT Lead sheets
  const hasSheets = Object.values(cfg.sheets || {}).some(u => u);
  if (hasSheets) {
    console.log('[Cron] Auto-syncing sheets...');
    for (const [lead, url] of Object.entries(cfg.sheets || {})) {
      if (!url) continue;
      try {
        const r = await syncSheet(lead, url);
        if (!r.error && r.totalRecords > 0) {
          const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
          for (const [batch, recs] of Object.entries(r.batches)) {
            if (!data.scanData[batch]) data.scanData[batch] = [];
            const existing = new Set(data.scanData[batch].map(r2 => `${r2.internName}|${r2.scanDate}|${r2.number}`));
            recs.forEach(r2 => {
              const key = `${r2.internName}|${r2.scanDate}|${r2.number}`;
              if (!existing.has(key)) { data.scanData[batch].push(r2); existing.add(key); }
            });
          }
          writeDataFile(data);
        }
      } catch (e) { console.error('[Cron] Sync error for', lead, ':', e.message); }
    }
  }
  // Sync QC batch docs (morning/evening)
  // Read batch doc links from config
  const batchDocLinks = cfg.batchDocLinks || {};
  for (const [key, url] of Object.entries(batchDocLinks)) {
    if (!url) continue;
    const [batch, shift] = key.split('|');
    try {
      console.log(`[Cron] Syncing QC doc ${batch}/${shift}...`);
      await syncQCDocEnhanced(batch, shift, url);
    } catch (e) { console.error('[Cron] QC doc sync error:', key, e.message); }
  }
  // Also sync lead-level QC docs
  for (const [lead, docInfo] of Object.entries(cfg.docs || {})) {
    if (!docInfo?.url) continue;
    try {
      await syncQCDoc(lead, docInfo.url);
    } catch (e) { console.error('[Cron] Doc sync error:', lead, e.message); }
  }
});

// ============================
// START
// ============================
(async () => {
  // Pull the last saved data.json / server-config.json back from Drive
  // BEFORE we start serving requests or touching local disk further.
  await restoreStateFromDrive();

app.listen(PORT, async () => {
  console.log(`\n===================================`);
  console.log(`  Habuild OJT Dashboard`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`===================================`);
  console.log(`Google Sheets: ${sheets ? '✅ Ready' : '❌ Not configured'}`);
  console.log(`Google Docs:   ${docs ? '✅ Ready' : '❌ Not configured'}`);
  console.log(`Google Drive:  ${drive ? '✅ Ready' : '❌ Not configured'}`);
  console.log(`WhatsApp:      ${twilioClient ? '✅ Ready' : '❌ Not configured'}`);
  console.log(`\nScheduled:`);
  console.log(`  📅 Monday 9AM — Weekly reports via WhatsApp`);
  console.log(`  🔔 Every 4hrs — Threshold alerts check`);
  console.log(`  💬 Friday 5PM — Pulse survey to interns`);
  console.log(`  🔄 Every 30min — Auto-sync Google Sheets`);
  console.log(`===================================\n`);

  // Auto-sync on startup (after 10 seconds to let everything initialize)
  if (sheets) {
    setTimeout(async () => {
      const cfg = getConfig();
      const hasSheets = Object.values(cfg.sheets || {}).some(u => u);
      if (hasSheets) {
        console.log('[Startup] Auto-syncing all Google Sheets...');
        for (const [lead, url] of Object.entries(cfg.sheets || {})) {
          if (!url) continue;
          try {
            const r = await syncSheet(lead, url);
            if (!r.error && r.totalRecords > 0) {
              const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
              for (const [batch, recs] of Object.entries(r.batches)) {
                if (!data.scanData[batch]) data.scanData[batch] = [];
                const existing = new Set(data.scanData[batch].map(r2 => `${r2.internName}|${r2.scanDate}|${r2.number}`));
                recs.forEach(r2 => {
                  const key = `${r2.internName}|${r2.scanDate}|${r2.number}`;
                  if (!existing.has(key)) { data.scanData[batch].push(r2); existing.add(key); }
                });
              }
              writeDataFile(data);
              console.log(`[Startup] Synced ${lead}: ${r.totalRecords} records`);
            }
          } catch (e) { console.error('[Startup] Sync error for', lead, ':', e.message); }
        }
        // Also sync QC docs
        for (const [lead, docInfo] of Object.entries(cfg.docs || {})) {
          if (!docInfo?.url) continue;
          try {
            await syncQCDoc(lead, docInfo.url);
            console.log(`[Startup] Synced QC doc for ${lead}`);
          } catch (e) { console.error('[Startup] Doc sync error:', lead, e.message); }
        }
        console.log('[Startup] Auto-sync complete!');
      } else {
        console.log('[Startup] No sheet URLs configured. Add them in Admin > Settings.');
      }
    }, 10000);
  }
});

})();
