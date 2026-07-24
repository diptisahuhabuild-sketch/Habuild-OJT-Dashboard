const fs = require('fs');
const path = require('path');
const googleService = require('./googleService');

const rootDir = path.resolve(__dirname, '../../');
const DATA_FILE = path.join(rootDir, 'data.json');
const CONFIG_FILE = path.join(rootDir, 'server-config.json');

/**
 * Parses DD/MM/YYYY or YYYY-MM-DD explicit date strings
 * Treats 0 or blank cells as null
 */
function parseDDMMYYYYDate(val) {
  if (val === undefined || val === null || val === '' || val === 0 || val === '0') {
    return null;
  }
  const str = String(val).trim();
  if (!str) return null;

  if (str.includes('/') || (str.includes('-') && str.split('-')[0].length <= 2)) {
    const parts = str.split(/[\/-]/);
    if (parts.length === 3) {
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1; // 0-indexed month
      let year = parseInt(parts[2], 10);
      if (year < 100) year += 2000;
      if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
        const d = new Date(Date.UTC(year, month, day));
        return d.toISOString().split('T')[0];
      }
    }
  }

  if (str.match(/^\d{4}-\d{2}-\d{2}/)) {
    return str.substring(0, 10);
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

/**
 * Reads server configuration
 */
function getConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[GoogleSyncService] Error reading config:', e.message);
  }
  return { sheets: {}, docs: {}, leads: {}, thresholds: { passRate: 85 } };
}

/**
 * Parses raw sheet rows into structured batch scan records using dynamic header indexing
 */
function parseSheetRowsIntoMergedData(sheetName, rows, leadOwner, internIdx, headers, mergedData, internBatchMap) {
  const scanDateIdx = headers.findIndex(h => h.includes('scan date') || h.includes('date'));
  const chatDateIdx = headers.findIndex(h => h.includes('chat date') || h.includes('date of conversation') || h.includes('conversation date'));
  const auditorIdx = headers.findIndex(h => h.includes('auditor') || h.includes('reviewer'));
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

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const internName = row[internIdx] ? String(row[internIdx]).trim() : '';
    if (!internName || internName.toLowerCase() === 'intern' || internName.toLowerCase() === 'executive name') continue;

    // Resolve correct batch using map or tab
    const cleanName = internName.toLowerCase().trim();
    let resolvedBatch = 'B-20'; // default fallback
    if (internBatchMap.has(cleanName)) {
      resolvedBatch = internBatchMap.get(cleanName);
    } else {
      const cleanTab = sheetName.toLowerCase();
      if (cleanTab.includes('20')) resolvedBatch = 'B-20';
      else if (cleanTab.includes('19')) resolvedBatch = 'B-19';
      else if (cleanTab.includes('18')) resolvedBatch = 'B-18';
      else if (cleanTab.includes('17')) resolvedBatch = 'B-17';
      else if (cleanTab.includes('16')) resolvedBatch = 'B-16';
      else if (cleanTab.includes('15')) resolvedBatch = 'B-15';
      else if (cleanTab.includes('12')) resolvedBatch = 'B-12';
    }

    if (!mergedData[resolvedBatch]) {
      mergedData[resolvedBatch] = [];
    }

    const scanDate = scanDateIdx >= 0 ? parseDDMMYYYYDate(row[scanDateIdx]) : null;
    const chatDate = chatDateIdx >= 0 ? parseDDMMYYYYDate(row[chatDateIdx]) : null;
    const auditor = auditorIdx >= 0 && row[auditorIdx] ? String(row[auditorIdx]).trim() : leadOwner;

    mergedData[resolvedBatch].push({
      scanDate: scanDate || new Date().toISOString().split('T')[0],
      chatDate: chatDate || scanDate || new Date().toISOString().split('T')[0],
      internName,
      auditor,
      lead: leadOwner,
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

  // Load intern batch registry for fast lookup
  const internBatchMap = new Map();
  const regList = config.internsRegistry || [];
  regList.forEach(i => {
    if (i.name && i.batch) {
      internBatchMap.set(i.name.toLowerCase().trim(), normalizeBatchName(i.batch));
    }
  });

  // Extract OJT Leads spreadsheet IDs from config
  const spreadsheetIds = [];
  if (config.sheets) {
    Object.entries(config.sheets).forEach(([key, url]) => {
      // Exclude masterId from leads list loop
      if (url && typeof url === 'string' && key !== 'masterId') {
        const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (match) {
          spreadsheetIds.push({ lead: key, id: match[1] });
        }
      }
    });
  }

  // Include OJT Audit Performance Sheet explicitly
  const auditPerformanceId = '12l-8GZZ5-Hf9dIuU_g0Wev1GN-SrN7hPh11RLNwBPI0';
  if (!spreadsheetIds.some(s => s.id === auditPerformanceId)) {
    spreadsheetIds.push({ lead: 'AuditPerformance', id: auditPerformanceId });
  }

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
      
      // Delay 1500ms to avoid quota limits
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetObj.id });
      const tabNames = meta.data.sheets.map(s => s.properties.title);

      for (const tabName of tabNames) {
        // Skip non-audit sheets to save read quota
        const lowerTab = tabName.toLowerCase();
        const skipKeywords = ['attendance', 'assigned', 'kpi', 'email', 'topic', 'schedule', 'template', 'rough', 'week off'];
        if (skipKeywords.some(kw => lowerTab.includes(kw))) {
          continue;
        }

        console.log(`[GoogleSyncService] Reading tab "${tabName}" in spreadsheet "${sheetObj.lead}"...`);
        
        // Delay 1500ms to avoid quota limits
        await new Promise(resolve => setTimeout(resolve, 1500));

        try {
          const res = await sheets.spreadsheets.values.get({
            spreadsheetId: sheetObj.id,
            range: `'${tabName}'!A1:AE500`
          });
          const rows = res.data.values || [];
          if (rows.length < 2) continue;

          const rawHeaders = rows[0].map(h => String(h || '').trim());
          const headers = rawHeaders.map(h => h.toLowerCase());

          // Verify if it contains trainee/intern name column
          const internIdx = headers.findIndex(h => h.includes('intern name') || h.includes('name') || h.includes('trainee') || h.includes('executive name') || h.includes('agent name'));
          if (internIdx < 0) continue;

          // Parse and merge rows into mergedScanData
          parseSheetRowsIntoMergedData(tabName, rows, sheetObj.lead, internIdx, headers, mergedScanData, internBatchMap);
        } catch (tabErr) {
          console.warn(`[GoogleSyncService] Failed to read tab "${tabName}" in "${sheetObj.lead}":`, tabErr.message);
        }
      }
    }

    currentData.scanData = mergedScanData;

    // 2. Fetch HR Attendance details
    const attendId = '1WtHDgoi-lNe_WxKDWQ0YKW3OfeOHawIMMb8VR1FrgLY';
    const parsedAttendance = {};
    try {
      console.log(`[GoogleSyncService] Fetching metadata for HR Attendance spreadsheet...`);
      await new Promise(resolve => setTimeout(resolve, 1500));
      const attendMeta = await sheets.spreadsheets.get({ spreadsheetId: attendId });
      const attendTabs = attendMeta.data.sheets.map(s => s.properties.title);
      
      const activeAttendTabs = attendTabs.filter(t => t.includes('2026') || t.includes('Dec') || t.includes('Status'));
      
      for (const tab of activeAttendTabs) {
        console.log(`[GoogleSyncService] Reading HR Attendance tab "${tab}"...`);
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: attendId,
          range: `'${tab}'!A1:AF300`
        });
        const rows = res.data.values || [];
        if (rows.length === 0) continue;
        
        let dateHeaderRow = null;
        let dates = [];
        
        for (let r = 0; r < rows.length; r++) {
          const row = rows[r];
          const dateCells = row.filter(c => parseDDMMYYYYDate(c));
          if (dateCells.length > 5) {
            dateHeaderRow = r;
            dates = row.map(c => parseDDMMYYYYDate(c));
            break;
          }
        }
        
        if (dateHeaderRow === null) continue;
        
        for (let r = dateHeaderRow + 1; r < rows.length; r++) {
          const row = rows[r];
          if (!row || row.length === 0 || !row[0]) continue;
          
          const rawName = String(row[0]).trim();
          if (rawName.toLowerCase().startsWith('date') || rawName.toLowerCase().startsWith('total') || rawName.toLowerCase().startsWith('available') || rawName.toLowerCase().startsWith('success squad') || rawName.toLowerCase().startsWith('squad') || rawName.toLowerCase().startsWith('employee name')) {
            continue;
          }
          
          const cleanName = rawName.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
          if (!parsedAttendance[cleanName]) {
            parsedAttendance[cleanName] = {};
          }
          
          for (let col = 1; col < row.length; col++) {
            const dateStr = dates[col];
            if (dateStr) {
              parsedAttendance[cleanName][dateStr] = String(row[col] || '').trim();
            }
          }
        }
      }
      currentData.attendanceData = parsedAttendance;
      console.log(`[GoogleSyncService] Synced attendance for ${Object.keys(parsedAttendance).length} interns`);
    } catch (attendErr) {
      console.error('[GoogleSyncService] Attendance sync error:', attendErr.message);
    }

    // 3. Fetch Comms Chat counts (Success Squad morning/evening)
    const commsId = '1kXppDZk3t44-fALRBZAJ6IGsmjsJO_DeAqARGEXU0WE';
    const parsedComms = {};
    try {
      const commsTabs = [' Success Squad MORNING ', 'Success Squad Evening'];
      for (const tab of commsTabs) {
        console.log(`[GoogleSyncService] Reading Comms Chat Count tab "${tab}"...`);
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: commsId,
          range: `'${tab}'!A1:AF300`
        });
        const rows = res.data.values || [];
        if (rows.length === 0) continue;
        
        let dateHeaderRow = null;
        let dates = [];
        
        for (let r = 0; r < rows.length; r++) {
          const row = rows[r];
          const dateCells = row.filter(c => parseDDMMYYYYDate(c));
          if (dateCells.length > 5) {
            dateHeaderRow = r;
            dates = row.map(c => parseDDMMYYYYDate(c));
            break;
          }
        }
        
        if (dateHeaderRow === null) continue;
        
        for (let r = dateHeaderRow + 1; r < rows.length; r++) {
          const row = rows[r];
          if (!row || row.length === 0 || !row[0]) continue;
          
          const rawName = String(row[0]).trim();
          if (rawName.toLowerCase().startsWith('date') || rawName.toLowerCase().startsWith('total') || rawName.toLowerCase().startsWith('available') || rawName.toLowerCase().startsWith('success squad') || rawName.toLowerCase().startsWith('squad')) {
            continue;
          }
          
          const cleanName = rawName.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
          if (!parsedComms[cleanName]) {
            parsedComms[cleanName] = {};
          }
          
          for (let col = 1; col < row.length; col++) {
            const dateStr = dates[col];
            if (dateStr) {
              const val = String(row[col] || '').trim();
              const chats = parseInt(val.replace(/,/g, ''), 10) || 0;
              parsedComms[cleanName][dateStr] = chats;
            }
          }
        }
      }
      currentData.commsChatData = parsedComms;
      console.log(`[GoogleSyncService] Synced comms chat count for ${Object.keys(parsedComms).length} interns`);
    } catch (commsErr) {
      console.error('[GoogleSyncService] Comms chat count sync error:', commsErr.message);
    }

    currentData.lastSyncedAt = new Date().toISOString();
    currentData.syncStatus = 'SUCCESS';
    saveDataToDisk(currentData);
    console.log('[GoogleSyncService] All data sync operations completed successfully!');

  } catch (err) {
    console.error('[GoogleSyncService] Google Sheets multi-fetch error:', err.message);
    currentData.syncStatus = 'ERROR';
    currentData.lastSyncError = err.message;
  }

  return currentData;
}

/**
 * Save state to data.json and trigger Drive mirror
 */
function saveDataToDisk(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    googleService.driveUploadFile('data.json', DATA_FILE).catch(e => {
      console.error('[GoogleSyncService] Drive upload note:', e.message);
    });
  } catch (e) {
    console.error('[GoogleSyncService] Error saving data.json:', e.message);
  }
}

module.exports = {
  fetchAndSyncGoogleSheetsData,
  parseDDMMYYYYDate,
  saveDataToDisk
};
