const fs = require('fs');
const path = require('path');
const { getConfig } = require('../utils/configResolver');
const googleService = require('./googleService');

let sheetCacheMeta = {};


const rootDir = path.resolve(__dirname, '../../');
const DATA_FILE = path.join(rootDir, 'data.json');
const CONFIG_FILE = path.join(rootDir, 'server-config.json');

/**
 * Performs atomic file writing to prevent empty reads or file corruption.
 */
function safeWriteFileSync(filePath, content) {
  const tempPath = filePath + '.tmp';
  fs.writeFileSync(tempPath, content);
  fs.renameSync(tempPath, filePath);
}

/**
 * Scans date columns to dynamically detect if a tab uses DD/MM/YYYY or MM/DD/YYYY format.
 */
function detectDateFormat(rows, headers) {
  const dateCols = [];
  headers.forEach((h, idx) => {
    const hl = String(h || '').toLowerCase();
    if (hl.includes('date') || hl.includes('conversation')) {
      dateCols.push(idx);
    }
  });
  if (dateCols.length === 0) return 'DDMM';

  for (let r = 1; r < Math.min(rows.length, 100); r++) {
    const row = rows[r];
    if (!row) continue;
    for (const colIdx of dateCols) {
      const val = String(row[colIdx] || '').trim();
      if (val.includes('/') || val.includes('-')) {
        const parts = val.split(/[\/-]/);
        if (parts.length === 3) {
          const p0 = parseInt(parts[0], 10);
          const p1 = parseInt(parts[1], 10);
          if (!isNaN(p0) && !isNaN(p1)) {
            if (p0 > 12) return 'DDMM'; // p0 is day -> DD/MM
            if (p1 > 12) return 'MMDD'; // p1 is day -> MM/DD
          }
        }
      }
    }
  }
  return 'DDMM'; // default fallback
}

/**
 * Parses DD/MM/YYYY or YYYY-MM-DD explicit date strings
 * Treats 0 or blank cells as null
 */
function parseDDMMYYYYDate(val, preferMMDDYYYY = false) {
  if (val === undefined || val === null || val === '' || val === 0 || val === '0') {
    return null;
  }
  const str = String(val).trim();
  if (!str) return null;

  if (str.match(/^\d{4}-\d{2}-\d{2}/)) {
    return str.substring(0, 10);
  }

  // Handle slashes and dashes
  if (str.includes('/') || str.includes('-')) {
    const parts = str.split(/[\/-]/);
    if (parts.length === 3) {
      let p0 = parseInt(parts[0], 10);
      let p1 = parseInt(parts[1], 10);
      let p2 = parseInt(parts[2], 10);
      if (!isNaN(p0) && !isNaN(p1) && !isNaN(p2)) {
        if (p2 < 100) p2 += 2000;
        let day, month;
        // Check which token is the day vs month:
        if (p0 > 12) {
          day = p0;
          month = p1 - 1;
        } else if (p1 > 12) {
          day = p1;
          month = p0 - 1;
        } else {
          // If both <= 12, use sheet format preference
          if (preferMMDDYYYY) {
            day = p1;
            month = p0 - 1;
          } else {
            day = p0;
            month = p1 - 1;
          }
        }
        if (!isNaN(day) && !isNaN(month) && !isNaN(p2)) {
          const d = new Date(Date.UTC(p2, month, day));
          return d.toISOString().split('T')[0];
        }
      }
    }
  }

  // Try parsing directly as fallback
  const parsedTime = Date.parse(str);
  if (!isNaN(parsedTime)) {
    const d = new Date(parsedTime);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return null;
}

function normalizeBatchName(batchStr) {
  if (!batchStr) return 'B-20';
  const clean = batchStr.trim().toUpperCase();
  const m = clean.match(/^BATCH\s*(\d+)/i);
  if (m) return `B-${m[1]}`;
  const mB = clean.match(/^B\s*(\d+)/i);
  if (mB) return `B-${mB[1]}`;
  return clean;
}

// Removed getConfig since it's now imported from configResolver

/**
 * Syncs the Interns Registry dynamically from the Admin Panel spreadsheet
 */
async function syncInternsRegistryFromGoogleSheet() {
  const sheets = googleService.getSheets();
  const drive = googleService.getDrive();
  if (!sheets) return;

  const spreadsheetId = '1mTMYp54L6FkV-qHaH5EBJYM4Pkr41ogxQ_f5OAtnlwY';
  
  if (drive) {
    try {
      const meta = await drive.files.get({ fileId: spreadsheetId, fields: 'modifiedTime' });
      if (meta && meta.data.modifiedTime) {
        if (sheetCacheMeta[spreadsheetId] === meta.data.modifiedTime) {
          console.log(`[GoogleSyncService] Skipping Admin Registry "${spreadsheetId}" - Not modified since last sync.`);
          return;
        }
        sheetCacheMeta[spreadsheetId] = meta.data.modifiedTime;
      }
    } catch (e) { }
  }
  console.log('[GoogleSyncService] Fetching Interns Registry from Admin spreadsheet...');

  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const tabName = meta.data.sheets[0].properties.title;
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tabName}'!A1:L1000`
    });

    const rows = res.data.values || [];
    if (rows.length < 3) return;

    // Locate header row containing 'your name' or 'name'
    let headerRowIdx = -1;
    for (let r = 0; r < rows.length; r++) {
      const rLower = (rows[r] || []).map(c => String(c || '').toLowerCase().trim());
      if (rLower.includes('your name') || rLower.includes('name')) {
        headerRowIdx = r;
        break;
      }
    }

    if (headerRowIdx === -1) {
      console.warn('[GoogleSyncService] Could not find header row in Admin spreadsheet');
      return;
    }

    const headers = rows[headerRowIdx].map(h => String(h || '').trim().toLowerCase());
    const nameIdx = headers.findIndex(h => h.includes('name'));
    const batchIdx = headers.findIndex(h => h.includes('batch'));
    const shiftIdx = headers.findIndex(h => h.includes('shift'));
    const processIdx = headers.findIndex(h => h.includes('process'));
    const designationIdx = headers.findIndex(h => h.includes('designation'));
    const leadIdx = headers.findIndex(h => h.includes('lead'));
    const phoneIdx = headers.findIndex(h => h.includes('number') || h.includes('phone'));
    const emailIdx = headers.findIndex(h => h.includes('email'));
    const remarkIdx = headers.findIndex(h => h.includes('remark') || h.includes('exit') || h.includes('concern'));

    if (nameIdx === -1) {
      console.warn('[GoogleSyncService] "Name" column not found in Admin spreadsheet');
      return;
    }

    const registry = [];
    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length === 0 || !row[nameIdx]) continue;

      const name = String(row[nameIdx]).trim();
      const lowerName = name.toLowerCase();
      // Skip helper headings or totals
      if (lowerName === 'your name' || lowerName.startsWith('date') || lowerName.startsWith('total') || lowerName.startsWith('available')) {
        continue;
      }

      const batch = batchIdx >= 0 && row[batchIdx] ? String(row[batchIdx]).trim() : '';
      
      // Feature: Ignore old batches prior to 15
      let batchNum = 0;
      const bMatch = batch.match(/\d+/);
      if (bMatch) batchNum = parseInt(bMatch[0], 10);
      if (batchNum > 0 && batchNum < 15) {
        continue;
      }

      const shift = shiftIdx >= 0 && row[shiftIdx] ? String(row[shiftIdx]).trim() : '';
      const processName = processIdx >= 0 && row[processIdx] ? String(row[processIdx]).trim() : 'Success Squad';
      const designation = designationIdx >= 0 && row[designationIdx] ? String(row[designationIdx]).trim() : 'OJT Intern';
      const lead = leadIdx >= 0 && row[leadIdx] ? String(row[leadIdx]).trim() : '';
      const phone = phoneIdx >= 0 && row[phoneIdx] ? String(row[phoneIdx]).trim() : '';
      const email = emailIdx >= 0 && row[emailIdx] ? String(row[emailIdx]).trim() : '';
      const remark = remarkIdx >= 0 && row[remarkIdx] ? String(row[remarkIdx]).trim() : '';

      registry.push({
        name,
        batch,
        shift,
        process: processName,
        designation,
        lead,
        phone,
        email,
        remark,
        status: [name, batch, shift, processName, designation, lead, remark]
          .some(val => String(val || '').toLowerCase().includes('exit')) ? 'inactive' : 'active'
      });
    }

    // Group by Batch
    const batches = {};
    registry.forEach(intern => {
      let batchName = intern.batch || 'UNASSIGNED';
      if (batchName.toLowerCase().startsWith('batch ')) {
        batchName = 'B-' + batchName.split(' ')[1];
      }
      if (!batches[batchName]) batches[batchName] = [];
      batches[batchName].push(intern);
    });

    // Write to data/batches/*.json
    const batchesDir = path.join(rootDir, 'data', 'batches');
    if (!fs.existsSync(batchesDir)) fs.mkdirSync(batchesDir, { recursive: true });

    for (const [batchName, interns] of Object.entries(batches)) {
      const batchFile = path.join(batchesDir, `${batchName}.json`);
      let batchData = { interns: [], qcDocs: [], sheets: [] };
      if (fs.existsSync(batchFile)) {
        try {
          batchData = JSON.parse(fs.readFileSync(batchFile, 'utf8'));
        } catch (e) {}
      }
      batchData.interns = interns;
      safeWriteFileSync(batchFile, JSON.stringify(batchData, null, 2));
    }

    // Write back to server-config.json to persist registry
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const configJson = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        configJson.internsRegistry = registry;
        safeWriteFileSync(CONFIG_FILE, JSON.stringify(configJson, null, 2));
        console.log(`[GoogleSyncService] Successfully updated server-config.json with ${registry.length} registry interns.`);
      } catch (configErr) {
        console.error('[GoogleSyncService] Failed to write config registry:', configErr.message);
      }
    }

    console.log(`[GoogleSyncService] Successfully synced ${registry.length} interns registry to modular batch files.`);

  } catch (err) {
    console.error('[GoogleSyncService] Error syncing Admin registry:', err.message);
  }
}

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
 * Parses raw sheet rows into structured batch scan records using dynamic header indexing
 */
function parseSheetRowsIntoMergedData(sheetName, rows, leadOwner, internIdx, headers, mergedData, internBatchMap, sourceSheet) {
  const isMMDD = detectDateFormat(rows, headers) === 'MMDD';
  const scanDateIdx = headers.findIndex(h => h.includes('scan date') || h.includes('date'));
  const chatDateIdx = headers.findIndex(h => h.includes('chat date') || h.includes('date of conversation') || h.includes('conversation date'));
  const auditorIdx = headers.findIndex(h => h.includes('auditor') || h.includes('reviewer'));
  const numberIdx = headers.findIndex(h => h === 'number' || h === 'member number' || h === 'contact' || h === 'client number' || h === 'phone');
  const chatCountIdx = headers.findIndex(h => h.includes('chat count') || h.includes('chats') || h.includes('scanned'));
  const auditCountIdx = headers.findIndex(h => h.includes('audit count') || h.includes('audits'));
  const qcFoundIdx = headers.findIndex(h => h.includes('qc found') || h.includes('qcs'));
  const errorRateIdx = headers.findIndex(h => h.includes('error %') || h.includes('error rate'));
  const complexQIdx = headers.findIndex(h => h.includes('complex query'));
  const weakChatIdx = headers.findIndex(h => h.includes('weak chat'));
  const impatientChatIdx = headers.findIndex(h => h.includes('impatient chat'));
  const leadRtgIdx = headers.findIndex(h => h.includes("lead's rating") || h.includes('lead rating') || h.includes('ojt rtg') || h.includes('average rating'));
  const aiRtgIdx = headers.findIndex(h => h.includes('ai rating') || h.includes('ai rtg'));
  const arstIdx = headers.findIndex(h => h.includes('arst'));
  const breakIdx = headers.findIndex(h => h.includes('break'));
  const needsImpIdx = headers.findIndex(h => h.includes('needs improvement') || h.includes('improvements needed') || h.includes('observations or recommendations'));
  const feedbackIdx = headers.findIndex(h => h.includes('overall feedback') || h.includes('summary') || h.includes('feedback'));
  const screenshotIdx = headers.findIndex(h => h.includes('screenshot') || h.includes('image') || h.includes('proof') || h.includes('link'));

  let lastSeenScanDate = null;
  let lastSeenChatDate = null;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const internName = row[internIdx] ? String(row[internIdx]).trim() : '';
    if (!internName || internName.toLowerCase() === 'intern' || internName.toLowerCase() === 'executive name') continue;

    // Resolve correct batch: Prioritize sheet tab title batch numbers if present
    const cleanName = internName.toLowerCase().trim();
    const cleanTab = sheetName.toLowerCase();
    let resolvedBatch = null;

    if (cleanTab.includes('21')) resolvedBatch = 'B-21';
    else if (cleanTab.includes('20')) resolvedBatch = 'B-20';
    else if (cleanTab.includes('19')) resolvedBatch = 'B-19';
    else if (cleanTab.includes('18')) resolvedBatch = 'B-18';
    else if (cleanTab.includes('17')) resolvedBatch = 'B-17';
    else if (cleanTab.includes('16')) resolvedBatch = 'B-16';
    else if (cleanTab.includes('15')) resolvedBatch = 'B-15';
    else if (cleanTab.includes('12')) resolvedBatch = 'B-12';

    // Fallback to registry registry lookup if tab name doesn't specify a batch
    if (!resolvedBatch) {
      for (const [regName, batchVal] of internBatchMap.entries()) {
        if (namesMatch(regName, cleanName)) {
          resolvedBatch = batchVal;
          break;
        }
      }
    }

    if (!resolvedBatch) {
      resolvedBatch = 'B-20'; // default fallback
    }

    if (!mergedData[resolvedBatch]) {
      mergedData[resolvedBatch] = [];
    }

    let scanDate = scanDateIdx >= 0 ? parseDDMMYYYYDate(row[scanDateIdx], isMMDD) : null;
    let chatDate = chatDateIdx >= 0 ? parseDDMMYYYYDate(row[chatDateIdx], isMMDD) : null;

    if (scanDate) {
      lastSeenScanDate = scanDate;
    } else {
      scanDate = lastSeenScanDate;
    }

    if (chatDate) {
      lastSeenChatDate = chatDate;
    } else {
      chatDate = lastSeenChatDate;
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const finalScanDate = scanDate || todayStr;
    const finalChatDate = chatDate || finalScanDate;

    const auditor = auditorIdx >= 0 && row[auditorIdx] ? String(row[auditorIdx]).trim() : leadOwner;

    mergedData[resolvedBatch].push({
      scanDate: finalScanDate,
      chatDate: finalChatDate,
      internName,
      auditor,
      lead: leadOwner,
      source: sourceSheet,
      number: numberIdx >= 0 && row[numberIdx] ? String(row[numberIdx]).trim() : '',
      chatCount: chatCountIdx >= 0 && row[chatCountIdx] ? parseInt(row[chatCountIdx], 10) || 0 : 0,
      auditCount: auditCountIdx >= 0 && row[auditCountIdx] ? parseInt(row[auditCountIdx], 10) || 1 : 1,
      qcFound: qcFoundIdx >= 0 && row[qcFoundIdx] ? parseInt(row[qcFoundIdx], 10) || 0 : 0,
      errorPct: errorRateIdx >= 0 && row[errorRateIdx] ? parseFloat(String(row[errorRateIdx]).replace('%', '')) || 0 : 0,
      complexQuery: complexQIdx >= 0 && row[complexQIdx] ? parseInt(row[complexQIdx], 10) || 0 : 0,
      weakChat: weakChatIdx >= 0 && row[weakChatIdx] ? parseInt(row[weakChatIdx], 10) || 0 : 0,
      impatientChat: impatientChatIdx >= 0 && row[impatientChatIdx] ? parseInt(row[impatientChatIdx], 10) || 0 : 0,
      leadRating: leadRtgIdx >= 0 && row[leadRtgIdx] ? parseFloat(row[leadRtgIdx]) || null : null,
      aiRating: aiRtgIdx >= 0 && row[aiRtgIdx] ? parseFloat(row[aiRtgIdx]) || null : null,
      arst: arstIdx >= 0 && row[arstIdx] ? String(row[arstIdx]).trim() : '1.5 Min',
      break: breakIdx >= 0 && row[breakIdx] ? String(row[breakIdx]).trim() : '10 hours',
      improvementsNeeded: needsImpIdx >= 0 && row[needsImpIdx] ? String(row[needsImpIdx]).trim() : 'No',
      summary: feedbackIdx >= 0 && row[feedbackIdx] ? String(row[feedbackIdx]).trim() : '',
      screenshot: screenshotIdx >= 0 && row[screenshotIdx] ? String(row[screenshotIdx]).trim() : '',
      batch: resolvedBatch
    });
  }
}

/**
 * Fetch and parse data from Google Sheets API across all OJT Lead spreadsheets
 */
async function fetchAndSyncGoogleSheetsData() {
  const sheets = googleService.getSheets();
  const drive = googleService.getDrive();
  const config = getConfig();

  console.log('[GoogleSyncService] Starting continuous multi-spreadsheet Google Sheets data sync...');

  let currentData = {
    scanData: {},
    attendanceData: {},
    commsChatData: {},
    milestones: {},
    lastSyncedAt: new Date().toISOString(),
    syncStatus: 'SUCCESS'
  };

  try {
    if (fs.existsSync(DATA_FILE)) {
      const fileData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (fileData) {
        currentData = { ...currentData, ...fileData };
      }
    }
  } catch (e) {
    console.warn('[GoogleSyncService] Data file parse note:', e.message);
  }

  if (!sheets) {
    console.log('[GoogleSyncService] Google Sheets API not initialized (no credentials file or env). Using cached/mock sync mode.');
    currentData.lastSyncedAt = new Date().toISOString();
    currentData.syncStatus = 'CACHED_MODE';
    saveDataToDisk(currentData);
    return currentData;
  }

  // 0. Update config registry from Admin spreadsheet dynamically
  try {
    await syncInternsRegistryFromGoogleSheet();
  } catch (err) {
    console.warn('[GoogleSyncService] Dynamic registry sync note:', err.message);
  }

  // Reload config to get the newly synced registry!
  const updatedConfig = getConfig();

  // Load intern batch registry for fast lookup
  const internBatchMap = new Map();
  const regList = updatedConfig.internsRegistry || [];
  regList.forEach(i => {
    if (i.name && i.batch) {
      internBatchMap.set(i.name.toLowerCase().trim(), normalizeBatchName(i.batch));
    }
  });

  // Extract OJT Leads spreadsheet IDs from config - Limit to only AuditPerformance and Master for performance
  const spreadsheetIds = [];

  // Include OJT Audit Performance Sheet explicitly
  const auditPerformanceId = '12l-8GZZ5-Hf9dIuU_g0Wev1GN-SrN7hPh11RLNwBPI0';
  spreadsheetIds.push({ lead: 'AuditPerformance', id: auditPerformanceId });

  // Include Master Spreadsheet as well
  if (config.sheets && config.sheets.masterId) {
    spreadsheetIds.push({ lead: 'Master', id: config.sheets.masterId });
  } else if (process.env.SPREADSHEET_ID) {
    spreadsheetIds.push({ lead: 'Master', id: process.env.SPREADSHEET_ID });
  }

  const mergedScanData = {};

  try {
    // 1. Fetch Audit/Scan logs
    for (const sheetObj of spreadsheetIds) {
      console.log(`[GoogleSyncService] Fetching metadata for spreadsheet "${sheetObj.lead}" (${sheetObj.id})...`);
      
      let skipLead = false;
      if (drive) {
        try {
          const meta = await drive.files.get({ fileId: sheetObj.id, fields: 'modifiedTime' });
          if (meta && meta.data.modifiedTime) {
            if (sheetCacheMeta[sheetObj.id] === meta.data.modifiedTime) {
              console.log(`[GoogleSyncService] Skipping QC spreadsheet "${sheetObj.lead}" - Not modified.`);
              skipLead = true;
              
              Object.keys(currentData.scanData || {}).forEach(batch => {
                const leadRecords = currentData.scanData[batch].filter(record => record.source === sheetObj.lead);
                if (leadRecords.length > 0) {
                  if (!mergedScanData[batch]) mergedScanData[batch] = [];
                  mergedScanData[batch].push(...leadRecords);
                }
              });
              continue;
            }
            sheetCacheMeta[sheetObj.id] = meta.data.modifiedTime;
          }
        } catch(e) {}
      }

      // Delay 1500ms to avoid quota limits
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetObj.id });
      const tabNames = meta.data.sheets.map(s => s.properties.title);

      const activeAuditTabs = tabNames.filter(tabName => {
        const lowerTab = tabName.toLowerCase();
        const skipKeywords = ['attendance', 'assigned', 'kpi', 'email', 'topic', 'schedule', 'template', 'rough', 'week off'];
        return !skipKeywords.some(kw => lowerTab.includes(kw));
      });

      if (activeAuditTabs.length > 0) {
        console.log(`[GoogleSyncService] Fetching ${activeAuditTabs.length} tabs for spreadsheet "${sheetObj.lead}" via batchGet...`);
        const auditRanges = activeAuditTabs.map(t => `'${t.replace(/'/g, "''")}'!A1:AE500`);
        try {
          const auditBatchRes = await sheets.spreadsheets.values.batchGet({
            spreadsheetId: sheetObj.id,
            ranges: auditRanges
          });

          (auditBatchRes.data.valueRanges || []).forEach((vr, tIdx) => {
            const tabName = activeAuditTabs[tIdx];
            const rows = vr.values || [];
            if (rows.length < 2) return;

            const rawHeaders = rows[0].map(h => String(h || '').trim());
            const headers = rawHeaders.map(h => h.toLowerCase());

            const internIdx = headers.findIndex(h => 
              h.includes('intern') || 
              h.includes('name') || 
              h.includes('trainee') || 
              h.includes('executive') || 
              h.includes('agent')
            );
            if (internIdx < 0) return;

            let resolvedLead = sheetObj.lead;
            if (resolvedLead === 'AuditPerformance') {
              const lowerTab = tabName.toLowerCase();
              if (lowerTab.includes('samiksha')) resolvedLead = 'SAMIKSHA';
              else if (lowerTab.includes('nilesh')) resolvedLead = 'NILESH';
              else if (lowerTab.includes('sonali')) resolvedLead = 'SONALI';
              else if (lowerTab.includes('diksha')) resolvedLead = 'DIKSHA';
              else if (lowerTab.includes('rashi')) resolvedLead = 'RASHI';
              else if (lowerTab.includes('priyanshu')) resolvedLead = 'PRIYANSHU';
              else if (lowerTab.includes('namrata')) resolvedLead = 'NAMRATA';
              else if (lowerTab.includes('damini')) resolvedLead = 'DAMINI';
              else if (lowerTab.includes('disha')) resolvedLead = 'DISHA';
              else if (lowerTab.includes('pooja')) resolvedLead = 'POOJA';
              else if (lowerTab.includes('jayshree')) resolvedLead = 'JAYSHREE';
              else if (lowerTab.includes('harsh')) resolvedLead = 'HARSH';
            }

            parseSheetRowsIntoMergedData(tabName, rows, resolvedLead, internIdx, headers, mergedScanData, internBatchMap, sheetObj.lead);
          });
        } catch (tabErr) {
          console.warn(`[GoogleSyncService] Failed batchGet in "${sheetObj.lead}":`, tabErr.message);
        }
      }
    }

    currentData.scanData = mergedScanData;

    // 2. Fetch HR Attendance details
    const attendId = '1WtHDgoi-lNe_WxKDWQ0YKW3OfeOHawIMMb8VR1FrgLY';
    const parsedAttendance = {};
    try {
      console.log(`[GoogleSyncService] Fetching metadata for HR Attendance spreadsheet...`);
      let skipAttend = false;
      if (drive) {
        try {
          const meta = await drive.files.get({ fileId: attendId, fields: 'modifiedTime' });
          if (meta && meta.data.modifiedTime) {
            if (sheetCacheMeta[attendId] === meta.data.modifiedTime) {
              console.log(`[GoogleSyncService] Skipping HR Attendance - Not modified.`);
              skipAttend = true;
              Object.assign(parsedAttendance, currentData.attendanceData || {});
            } else {
              sheetCacheMeta[attendId] = meta.data.modifiedTime;
            }
          }
        } catch(e) {}
      }
      
      if (!skipAttend) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const attendMeta = await sheets.spreadsheets.get({ spreadsheetId: attendId });
        const attendTabs = attendMeta.data.sheets.map(s => s.properties.title);
        
        const activeAttendTabs = attendTabs.filter(t => {
          const cleanTab = t.toLowerCase().trim();
          if (cleanTab === 'hide sheet') return true;
          if (cleanTab.includes('time') || cleanTab.includes('leave') || cleanTab.includes('late') || cleanTab.includes('lop') || cleanTab.includes('tracker') || cleanTab.includes('upload') || cleanTab.includes('import') || cleanTab.includes('change') || cleanTab.includes('department') || cleanTab.includes('sheet') || cleanTab.includes('check') || cleanTab.includes('ot') || cleanTab.includes('mastersheet')) {
            return false;
          }
          const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
          return months.some(m => cleanTab.includes(m));
        });
        
        console.log(`[GoogleSyncService] Fetching ${activeAttendTabs.length} HR Attendance tabs via batchGet...`);
        const attendRanges = activeAttendTabs.map(t => `'${t.replace(/'/g, "''")}'!A1:FJ400`);
        const attendBatchRes = await sheets.spreadsheets.values.batchGet({
          spreadsheetId: attendId,
          ranges: attendRanges
        });

        (attendBatchRes.data.valueRanges || []).forEach(vr => {
          const rows = vr.values || [];
          if (rows.length === 0) return;

          // Detect date format for this tab dynamically
          let isMMDD = false;
          for (let r = 0; r < Math.min(rows.length, 15); r++) {
            const row = rows[r];
            if (!row) continue;
            for (const cell of row) {
              const val = String(cell || '').trim();
              if (val.includes('/') || val.includes('-')) {
                const parts = val.split(/[\/-]/);
                if (parts.length === 3) {
                  const p0 = parseInt(parts[0], 10);
                  const p1 = parseInt(parts[1], 10);
                  if (!isNaN(p0) && !isNaN(p1)) {
                    if (p0 > 12) { isMMDD = false; break; }
                    if (p1 > 12) { isMMDD = true; break; }
                  }
                }
              }
            }
          }

          let dateHeaderRow = null;
          let dates = [];

          for (let r = 0; r < rows.length; r++) {
            const row = rows[r];
            const dateCells = row.filter(c => parseDDMMYYYYDate(c, isMMDD));
            if (dateCells.length > 5) {
              dateHeaderRow = r;
              let lastSeenDate = null;
              dates = row.map(c => {
                const parsed = parseDDMMYYYYDate(c, isMMDD);
                if (parsed) lastSeenDate = parsed;
                return lastSeenDate;
              });
              break;
            }
          }

          if (dateHeaderRow === null) return;

          const subHeaderRow = rows[dateHeaderRow + 1] || [];
          const isRealSubHeader = subHeaderRow.some(c => {
            const val = String(c || '').toLowerCase().trim();
            return val.includes('in time') || val.includes('out time') || val.includes('status') || val.includes('attendance');
          });

          const startDataRow = isRealSubHeader ? dateHeaderRow + 2 : dateHeaderRow + 1;

          for (let r = startDataRow; r < rows.length; r++) {
            const row = rows[r];
            if (!row || row.length === 0) continue;

            let rawName = '';
            let nameColIdx = -1;
            for (let colIdx = 0; colIdx <= 3; colIdx++) {
              const val = String(row[colIdx] || '').trim();
              if (!val) continue;

              const valLower = val.toLowerCase();
              if (valLower.includes('date') || valLower.includes('total') || valLower.includes('available') || 
                  valLower.includes('squad') || valLower.includes('employee') || valLower.includes('escalation') || 
                  valLower.includes('in time') || valLower.includes('out time') || valLower.includes('sorted') ||
                  valLower.match(/^\d{2}:\d{2}$/) || valLower.match(/^\d+$/) || valLower === '-') {
                continue;
              }

              rawName = val;
              nameColIdx = colIdx;
              break;
            }

            if (!rawName || nameColIdx === -1) continue;

            const cleanName = rawName.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
            if (!parsedAttendance[cleanName]) {
              parsedAttendance[cleanName] = {};
            }

            for (let col = nameColIdx + 1; col < row.length; col++) {
              const dateStr = dates[col];
              if (dateStr) {
                const val = String(row[col] || '').trim();

                if (!parsedAttendance[cleanName][dateStr]) {
                  parsedAttendance[cleanName][dateStr] = {
                    status: '-',
                    inTime: '-',
                    outTime: '-'
                  };
                }

                if (isRealSubHeader) {
                  const subHeaderVal = String(subHeaderRow[col] || '').toLowerCase().trim();
                  if (subHeaderVal.includes('in time')) {
                    if (val && val !== '-') parsedAttendance[cleanName][dateStr].inTime = val;
                  } else if (subHeaderVal.includes('out time')) {
                    if (val && val !== '-') parsedAttendance[cleanName][dateStr].outTime = val;
                  } else if (subHeaderVal.includes('status') || subHeaderVal.includes('attendance')) {
                    if (val && val !== '-') parsedAttendance[cleanName][dateStr].status = val;
                  }
                } else {
                  // Direct status mapping
                  if (val && val !== '-') parsedAttendance[cleanName][dateStr].status = val;
                }
              }
            }
          }
        });

        // Compile all parsed attendance details into final string status representations after processing all tabs
        Object.keys(parsedAttendance).forEach(cleanName => {
          Object.keys(parsedAttendance[cleanName]).forEach(dateStr => {
            const obj = parsedAttendance[cleanName][dateStr];
            if (obj && typeof obj === 'object') {
              const status = obj.status || '-';
              const inTime = obj.inTime || '-';
              const outTime = obj.outTime || '-';
              if (inTime !== '-' || outTime !== '-') {
                parsedAttendance[cleanName][dateStr] = `${status}|${inTime}|${outTime}`;
              } else {
                parsedAttendance[cleanName][dateStr] = status;
              }
            }
          });
        });
      }
      currentData.attendanceData = parsedAttendance;
      console.log(`[GoogleSyncService] Synced attendance for ${Object.keys(parsedAttendance).length} interns`);
    } catch (attendErr) {
      console.error('[GoogleSyncService] Attendance sync error:', attendErr.message);
    }

    // 3. Fetch Comms Chat counts (Success Squad morning/evening, Gifting, Payments, etc.)
    const commsId = '1kXppDZk3t44-fALRBZAJ6IGsmjsJO_DeAqARGEXU0WE';
    const parsedComms = { morning: {}, evening: {}, all: {} };
    try {
      console.log(`[GoogleSyncService] Fetching metadata for Master spreadsheet...`);
      let skipComms = false;
      if (drive) {
        try {
          const meta = await drive.files.get({ fileId: commsId, fields: 'modifiedTime' });
          if (meta && meta.data.modifiedTime) {
            if (sheetCacheMeta[commsId] === meta.data.modifiedTime) {
              console.log(`[GoogleSyncService] Skipping Master spreadsheet - Not modified.`);
              skipComms = true;
              Object.assign(parsedComms, currentData.commsChatData || {});
            } else {
              sheetCacheMeta[commsId] = meta.data.modifiedTime;
            }
          }
        } catch(e) {}
      }
      
      if (!skipComms) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const commsMeta = await sheets.spreadsheets.get({ spreadsheetId: commsId });
        const commsTabs = commsMeta.data.sheets.map(s => s.properties.title);
        
        console.log(`[GoogleSyncService] Fetching ${commsTabs.length} Master spreadsheet tabs via batchGet...`);
        const commsRanges = commsTabs.map(t => `'${t}'!A1:ZZ500`);
        const commsBatchRes = await sheets.spreadsheets.values.batchGet({
          spreadsheetId: commsId,
          ranges: commsRanges
        });

        (commsBatchRes.data.valueRanges || []).forEach((vr, tabIdx) => {
          const tabName = commsTabs[tabIdx] || '';
          const isMorningTab = tabName.toLowerCase().includes('morning');
          const isEveningTab = tabName.toLowerCase().includes('evening');
          const rows = vr.values || [];
          if (rows.length === 0) return;

          let dateHeaderRow = null;
          let dates = [];

          // Detect date format dynamically for this Comms tab
          let isMMDD = false;
          for (let r = 0; r < Math.min(rows.length, 15); r++) {
            const row = rows[r];
            if (!row) continue;
            for (const cell of row) {
              const val = String(cell || '').trim();
              if (val.includes('/') || val.includes('-')) {
                const parts = val.split(/[\/-]/);
                if (parts.length === 3) {
                  const p0 = parseInt(parts[0], 10);
                  const p1 = parseInt(parts[1], 10);
                  if (!isNaN(p0) && !isNaN(p1)) {
                    if (p0 > 12) { isMMDD = false; break; }
                    if (p1 > 12) { isMMDD = true; break; }
                  }
                }
              }
            }
          }

          for (let r = 0; r < rows.length; r++) {
            const row = rows[r];
            const dateCells = row.filter(c => parseDDMMYYYYDate(c, isMMDD));
            if (dateCells.length > 5) {
              dateHeaderRow = r;
              dates = row.map(c => parseDDMMYYYYDate(c, isMMDD));
              break;
            }
          }

          if (dateHeaderRow === null) return;

          for (let r = dateHeaderRow + 1; r < rows.length; r++) {
            const row = rows[r];
            if (!row || row.length === 0 || !row[0]) continue;

            let rawName = String(row[0]).trim();
            rawName = rawName.replace(/\(.*?\)/g, '').trim();

            if (rawName.toLowerCase().startsWith('date') || rawName.toLowerCase().startsWith('total') || rawName.toLowerCase().startsWith('available') || rawName.toLowerCase().startsWith('success squad') || rawName.toLowerCase().startsWith('squad') || rawName.toLowerCase().startsWith('day')) {
              continue;
            }

            const cleanName = rawName.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

            if (!parsedComms.all[cleanName]) parsedComms.all[cleanName] = {};
            if (isMorningTab && !parsedComms.morning[cleanName]) parsedComms.morning[cleanName] = {};
            if (isEveningTab && !parsedComms.evening[cleanName]) parsedComms.evening[cleanName] = {};

            for (let col = 1; col < row.length; col++) {
              const dateStr = dates[col];
              if (dateStr) {
                const val = String(row[col] || '').trim();
                const chats = parseInt(val.replace(/,/g, ''), 10) || 0;

                parsedComms.all[cleanName][dateStr] = (parsedComms.all[cleanName][dateStr] || 0) + chats;

                if (isMorningTab) {
                  parsedComms.morning[cleanName][dateStr] = (parsedComms.morning[cleanName][dateStr] || 0) + chats;
                }
                if (isEveningTab) {
                  parsedComms.evening[cleanName][dateStr] = (parsedComms.evening[cleanName][dateStr] || 0) + chats;
                }
              }
            }
          }
        });

        // Populate root-level keys for backwards compatibility
        Object.keys(parsedComms.all).forEach(k => {
          if (!parsedComms[k]) parsedComms[k] = parsedComms.all[k];
        });
      }

      currentData.commsChatData = parsedComms;
      console.log(`[GoogleSyncService] Synced comms chat count for ${Object.keys(parsedComms.all).length} interns`);
    } catch (commsErr) {
      console.error('[GoogleSyncService] Comms chat count sync error:', commsErr.message);
    }

    currentData.lastSyncedAt = new Date().toISOString();
    currentData.syncStatus = 'SUCCESS';
    await syncBatch20ReportingData();
    saveDataToDisk(currentData);
    console.log('[GoogleSyncService] All data sync operations completed successfully!');

  } catch (err) {
    console.error('[GoogleSyncService] Google Sheets multi-fetch error:', err.message);
    currentData.syncStatus = 'ERROR';
    currentData.lastSyncError = err.message;
    try {
      safeWriteFileSync(DATA_FILE, JSON.stringify(currentData, null, 2));
    } catch (saveErr) {
      console.error('[GoogleSyncService] Error saving error state:', saveErr.message);
    }
  }

  return currentData;
}

let lastDriveUploadTime = 0;

/**
 * Save state to data.json and trigger Drive mirror
 */
function saveDataToDisk(data) {
  try {
    safeWriteFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    const now = Date.now();
    // Only upload to Google Drive at most once every 12 hours to conserve bandwidth
    if (now - lastDriveUploadTime > 12 * 60 * 60 * 1000) {
      googleService.driveUploadFile('data.json', DATA_FILE).then(() => {
        lastDriveUploadTime = now;
        console.log('[GoogleSyncService] Successfully backed up data.json to Google Drive.');
      }).catch(e => {
        console.error('[GoogleSyncService] Drive upload note:', e.message);
      });
    } else {
      console.log('[GoogleSyncService] Skipping Google Drive upload to conserve bandwidth (last upload was < 12h ago).');
    }
  } catch (e) {
    console.error('[GoogleSyncService] Error saving data.json:', e.message);
  }
}

function cleanRatingVal(val) {
  if (!val || val === '-' || val === 'No Data') return null;
  const num = parseFloat(String(val).replace(/[^0-9.]/g, ''));
  if (isNaN(num)) return null;
  if (num > 5.0) return null; // Rating must be between 0 and 5
  return num;
}

function cleanNumVal(val) {
  if (!val || val === '-' || val === 'No Data') return 0;
  const num = parseInt(String(val).replace(/,/g, ''), 10);
  return isNaN(num) ? 0 : num;
}

function cleanFloatVal(val) {
  if (!val || val === '-' || val === 'No Data') return 0;
  const num = parseFloat(String(val).replace(/%/g, '').trim());
  return isNaN(num) ? 0 : num;
}

/**
 * Syncs Batch 20, Batch 19, and ALL team weekly scorecards + Daily OJT Status
 */
async function syncBatch20ReportingData() {
  try {
    const spreadsheetId = '1zIWboejoQlUVGFlewYK0Ugtj7nUe8rR7cl29VOCJaB4';
    console.log(`[GoogleSyncService] Fetching Batch 20 & Batch 19 Reporting Data...`);
    const sheets = googleService.getSheets();
    if (!sheets) throw new Error("Google Sheets API not initialized");

    const batchSheets = [
      { key: 'B-20', sheet: ' Batch-20 Weekly score card', outFile: 'data/batches/b20-reporting.json' },
      { key: 'B-19', sheet: 'Batch-19 Weekly score card', outFile: 'data/batches/b19-reporting.json' }
    ];

    for (const bInfo of batchSheets) {
      const currentData = { daily: {}, weekly: {} };

      // Fetch weekly sheet + ALL team's weekly scorecard with full ZZ column range
      const weeklyRes = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: [`'${bInfo.sheet}'!A1:ZZ500`, `'ALL team's weekly scorecard'!A1:ZZ500`]
      });

      if (weeklyRes.data.valueRanges) {
        for (const rangeData of weeklyRes.data.valueRanges) {
          const rows = rangeData.values || [];
          let currentInternLeft = null;
          let currentInternRight = null;

          for (let r = 0; r < rows.length; r++) {
            const row = rows[r];
            if (!row || row.length === 0) continue;

            // Left Table (Cols 0..16)
            const col0 = (row[0] || '').trim();
            if (col0 && col0.toLowerCase() !== 'intern' && !col0.toLowerCase().startsWith('batch')) {
              const cleanName = col0.replace(/\(.*?\)/g, '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
              currentInternLeft = cleanName;
              if (!currentData.weekly[currentInternLeft]) {
                currentData.weekly[currentInternLeft] = { weeks: [] };
              }
            }

            if (currentInternLeft && currentData.weekly[currentInternLeft]) {
              const weekLabel = (row[3] || '').trim();
              if (weekLabel.toLowerCase().startsWith('week') || weekLabel.toLowerCase().includes('ojt')) {
                const scanned = cleanNumVal(row[7]);
                const qcs = cleanNumVal(row[8]);
                const errorPct = cleanFloatVal(row[9]);
                const ojtRtg = cleanRatingVal(row[10]);
                const aiRtg = cleanRatingVal(row[11]);
                const arst = (row[12] || '-').trim();
                const trend = (row[13] || '-').trim();
                const avail = (row[4] || '-').trim();
                const avgChat = cleanNumVal(row[5]);
                const chats = cleanNumVal(row[6]);

                currentData.weekly[currentInternLeft].weeks.push({
                  week: weekLabel,
                  avail, avgChat, chats, scanned, qcs, errorPct, ojtRtg, aiRtg, arst, trend,
                  valid: scanned > 0 || qcs > 0 || (ojtRtg !== null && ojtRtg > 0) || (aiRtg !== null && aiRtg > 0)
                });
              } else if (weekLabel.toLowerCase().replace(/\s+/g, ' ').includes('ojt all')) {
                currentData.weekly[currentInternLeft].allTimeTrend = (row[13] || '-').trim();
              }
            }

            // Right Table (Cols 18..34)
            const col18 = (row[18] || '').trim();
            if (col18 && col18.toLowerCase() !== 'intern' && !col18.toLowerCase().startsWith('batch')) {
              const cleanNameR = col18.replace(/\(.*?\)/g, '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
              currentInternRight = cleanNameR;
              if (!currentData.weekly[currentInternRight]) {
                currentData.weekly[currentInternRight] = { weeks: [] };
              }
            }

            if (currentInternRight && currentData.weekly[currentInternRight] && row.length > 21) {
              const weekLabelR = (row[21] || '').trim();
              if (weekLabelR.toLowerCase().startsWith('week') || weekLabelR.toLowerCase().includes('ojt')) {
                const scanned = cleanNumVal(row[25]);
                const qcs = cleanNumVal(row[26]);
                const errorPct = cleanFloatVal(row[27]);
                const ojtRtg = cleanRatingVal(row[28]);
                const aiRtg = cleanRatingVal(row[29]);
                const arst = (row[30] || '-').trim();
                const trend = (row[31] || '-').trim();
                const avail = (row[22] || '-').trim();
                const avgChat = cleanNumVal(row[23]);
                const chats = cleanNumVal(row[24]);

                currentData.weekly[currentInternRight].weeks.push({
                  week: weekLabelR,
                  avail, avgChat, chats, scanned, qcs, errorPct, ojtRtg, aiRtg, arst, trend,
                  valid: scanned > 0 || qcs > 0 || (ojtRtg !== null && ojtRtg > 0) || (aiRtg !== null && aiRtg > 0)
                });
              } else if (weekLabelR.toLowerCase().replace(/\s+/g, ' ').includes('ojt all')) {
                currentData.weekly[currentInternRight].allTimeTrend = (row[31] || '-').trim();
              }
            }
          }
        }
      }

      // Calculate Averages per intern
      Object.keys(currentData.weekly).forEach(key => {
        const intern = currentData.weekly[key];
        const validWeeks = intern.weeks.filter(w => w.valid);
        let recent = validWeeks.length > 0 ? validWeeks[validWeeks.length - 1] : null;

        let totalScanned = 0, totalQCs = 0, totalOjtRtg = 0, countOjt = 0;
        let totalAiRtg = 0, countAi = 0;

        validWeeks.forEach(w => {
          totalScanned += w.scanned;
          totalQCs += w.qcs;
          if (w.ojtRtg !== null) { totalOjtRtg += w.ojtRtg; countOjt++; }
          if (w.aiRtg !== null) { totalAiRtg += w.aiRtg; countAi++; }
        });

        let avg = null;
        if (validWeeks.length > 0) {
          avg = {
            scanned: totalScanned,
            qcs: totalQCs,
            errorPct: totalScanned > 0 ? parseFloat(((totalQCs / totalScanned) * 100).toFixed(2)) : 0,
            ojtRtg: countOjt > 0 ? parseFloat((totalOjtRtg / countOjt).toFixed(2)) : null,
            aiRtg: countAi > 0 ? parseFloat((totalAiRtg / countAi).toFixed(2)) : null,
            trend: intern.allTimeTrend || (recent ? recent.trend : '-')
          };
        }
        intern.recent = recent;
        intern.average = avg;
      });

      // Daily OJT Status Parsing for B20 & B19
      if (bInfo.key === 'B-20') {
        const dailyRes = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: 'Daily OJT Status!A1:ZZ500'
        });
        const dailyRows = dailyRes.data.values;
        if (dailyRows && dailyRows.length > 2) {
          const datesRow = dailyRows[0];
          const headersRow = dailyRows[1] || [];
          const dayBlocks = [];

          for (let i = 0; i < datesRow.length; i++) {
            let dateCell = datesRow[i];
            if (dateCell && typeof dateCell === 'string') {
              let match = dateCell.match(/(\d{1,2})(st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)'?(\d{2})?/i);
              if (match) {
                const monthMap = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
                let month = monthMap[match[3].toLowerCase()];
                let yr = match[4] ? 2000 + parseInt(match[4], 10) : 2026;
                let d = new Date(Date.UTC(yr, month, parseInt(match[1], 10)));
                let parsedDate = d.toISOString().split('T')[0];
                dayBlocks.push({ date: parsedDate, startIndex: i });
              }
            }
          }
          
          for (let r = 2; r < dailyRows.length; r++) {
            const row = dailyRows[r];
            if (!row || row.length === 0) continue;

            for (const block of dayBlocks) {
              const idx = block.startIndex;
              // Find intern column in this block
              let internName = '';
              let internColIdx = idx;

              for (let offset = 0; offset <= 2; offset++) {
                const hVal = (headersRow[idx + offset] || '').toLowerCase().trim();
                if (hVal === 'intern') {
                  internName = (row[idx + offset] || '').trim();
                  internColIdx = idx + offset;
                  break;
                }
              }

              if (internName) {
                const cleanName = internName.replace(/\(.*?\)/g, '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
                if (cleanName && cleanName !== 'intern') {
                  if (!currentData.daily[cleanName]) currentData.daily[cleanName] = {};

                  let rawAi = null;
                  let arst = "No Data", frt = "No Data", breakVal = "No Data";

                  for (let offset = 1; offset <= 11; offset++) {
                    const cIdx = internColIdx + offset;
                    if (cIdx >= headersRow.length) break;
                    const hName = (headersRow[cIdx] || '').toLowerCase().trim();
                    const cellVal = (row[cIdx] || '').trim();

                    if (hName.includes('rating by ai') || hName.includes('ai rating') || hName.includes('ai rtg')) {
                      const parsed = cleanRatingVal(cellVal);
                      if (parsed !== null) rawAi = parsed;
                    } else if (hName === 'arst') {
                      if (cellVal && cellVal !== '-') arst = cellVal;
                    } else if (hName === 'frt') {
                      if (cellVal && cellVal !== '-') frt = cellVal;
                    } else if (hName.includes('break')) {
                      if (cellVal && cellVal !== '-') breakVal = cellVal;
                    }
                  }

                  currentData.daily[cleanName][block.date] = {
                    aiRtg: rawAi !== null ? rawAi : "No Data",
                    arst: arst,
                    frt: frt,
                    breakVal: breakVal
                  };
                }
              }
            }
          }
        }
      }

      const outPath = path.join(rootDir, bInfo.outFile);
      safeWriteFileSync(outPath, JSON.stringify(currentData, null, 2));
      console.log(`[GoogleSyncService] Successfully synced ${bInfo.key} Reporting Data to ${outPath}`);
    }

  } catch (err) {
    console.error('[GoogleSyncService] Batch Reporting sync error:', err.message);
  }
}

module.exports = {
  fetchAndSyncGoogleSheetsData,
  syncBatch20ReportingData,
  parseDDMMYYYYDate,
  saveDataToDisk
};
