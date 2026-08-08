const fs = require('fs');
const path = require('path');
const { getConfig } = require('../utils/configResolver');
const googleService = require('./googleService');

let sheetCacheMeta = {};


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
      fs.writeFileSync(batchFile, JSON.stringify(batchData, null, 2));
    }

    console.log(`[GoogleSyncService] Successfully synced ${registry.length} interns registry to modular batch files.`);

  } catch (err) {
    console.error('[GoogleSyncService] Error syncing Admin registry:', err.message);
  }
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
      
      let skipLead = false;
      if (drive) {
        try {
          const meta = await drive.files.get({ fileId: sheetObj.id, fields: 'modifiedTime' });
          if (meta && meta.data.modifiedTime) {
            if (sheetCacheMeta[sheetObj.id] === meta.data.modifiedTime) {
              console.log(`[GoogleSyncService] Skipping QC spreadsheet "${sheetObj.lead}" - Not modified.`);
              skipLead = true;
              
              Object.keys(currentData.scanData || {}).forEach(batch => {
                const leadRecords = currentData.scanData[batch].filter(record => record.lead === sheetObj.lead);
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
          const internIdx = headers.findIndex(h => 
            h.includes('intern') || 
            h.includes('name') || 
            h.includes('trainee') || 
            h.includes('executive') || 
            h.includes('agent')
          );
          if (internIdx < 0) continue;

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

          // Parse and merge rows into mergedScanData
          parseSheetRowsIntoMergedData(tabName, rows, resolvedLead, internIdx, headers, mergedScanData, internBatchMap);
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
      await new Promise(resolve => setTimeout(resolve, 1500));
      const attendMeta = await sheets.spreadsheets.get({ spreadsheetId: attendId });
      const attendTabs = attendMeta.data.sheets.map(s => s.properties.title);
      
      const activeAttendTabs = attendTabs.filter(t => {
        const cleanTab = t.toLowerCase().trim();
        if (cleanTab.includes('time') || cleanTab.includes('leave') || cleanTab.includes('late') || cleanTab.includes('lop') || cleanTab.includes('tracker') || cleanTab.includes('upload') || cleanTab.includes('import') || cleanTab.includes('change') || cleanTab.includes('department') || cleanTab.includes('sheet') || cleanTab.includes('check') || cleanTab.includes('ot') || cleanTab.includes('mastersheet')) {
          return false;
        }
        const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
        const hasMonth = months.some(m => cleanTab.includes(m));
        const isDetailedStatus = cleanTab.includes('detailed') && cleanTab.includes('status');
        return hasMonth || isDetailedStatus;
      });
      
      for (const tab of activeAttendTabs) {
        console.log(`[GoogleSyncService] Reading HR Attendance tab "${tab}"...`);
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: attendId,
          range: `'${tab}'!A1:AJ400`
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
            let lastSeenDate = null;
            dates = row.map(c => {
              const parsed = parseDDMMYYYYDate(c);
              if (parsed) lastSeenDate = parsed;
              return lastSeenDate;
            });
            break;
          }
        }
        
        if (dateHeaderRow === null) continue;
        
        for (let r = dateHeaderRow + 1; r < rows.length; r++) {
          const row = rows[r];
          if (!row || row.length === 0) continue;
          
          let rawName = '';
          let nameColIdx = -1;
          for (let colIdx = 0; colIdx <= 3; colIdx++) {
            const val = String(row[colIdx] || '').trim();
            if (!val) continue;
            
            const valLower = val.toLowerCase();
            // Exclude non-name markers
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
              if (parsedAttendance[cleanName][dateStr]) {
                const prev = parsedAttendance[cleanName][dateStr];
                if (val && val !== '-') {
                  if (prev === '-' || !prev) {
                    parsedAttendance[cleanName][dateStr] = val;
                  }
                }
              } else {
                parsedAttendance[cleanName][dateStr] = val;
              }
            }
          }
        }
      }
      }
    currentData.attendanceData = parsedAttendance;
      console.log(`[GoogleSyncService] Synced attendance for ${Object.keys(parsedAttendance).length} interns`);
    } catch (attendErr) {
      console.error('[GoogleSyncService] Attendance sync error:', attendErr.message);
    }

    // 3. Fetch Comms Chat counts (Success Squad morning/evening, Gifting, Payments, etc.)
    const commsId = '1kXppDZk3t44-fALRBZAJ6IGsmjsJO_DeAqARGEXU0WE';
    const parsedComms = {};
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
      await new Promise(resolve => setTimeout(resolve, 1500));
      const commsMeta = await sheets.spreadsheets.get({ spreadsheetId: commsId });
      const commsTabs = commsMeta.data.sheets.map(s => s.properties.title);
      
      for (const tab of commsTabs) {
        console.log(`[GoogleSyncService] Inspecting Master tab "${tab}" for chat counts...`);
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: commsId,
          range: `'${tab}'!A1:ZZ500`
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
        
        console.log(`[GoogleSyncService] Parsing chat counts from Master tab "${tab}" (Found ${dates.filter(Boolean).length} dates)`);
        for (let r = dateHeaderRow + 1; r < rows.length; r++) {
          const row = rows[r];
          if (!row || row.length === 0 || !row[0]) continue;
          
          let rawName = String(row[0]).trim();
          // Remove anything in parentheses like "Prachi (Evening)" -> "Prachi"
          rawName = rawName.replace(/\(.*?\)/g, '').trim();
          
          if (rawName.toLowerCase().startsWith('date') || rawName.toLowerCase().startsWith('total') || rawName.toLowerCase().startsWith('available') || rawName.toLowerCase().startsWith('success squad') || rawName.toLowerCase().startsWith('squad') || rawName.toLowerCase().startsWith('day')) {
            continue;
          }
          
          const cleanName = rawName.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
          if (!parsedComms[cleanName]) {
            parsedComms[cleanName] = {};
          }
          
          if (cleanName === 'aditya jaiswal') {
             console.log(`[DEBUG] Found Aditya in tab "${tab}" row ${r+1}, length: ${row.length}`);
          }
          
          for (let col = 1; col < row.length; col++) {
            const dateStr = dates[col];
            if (dateStr) {
              const val = String(row[col] || '').trim();
              const chats = parseInt(val.replace(/,/g, ''), 10) || 0;
              // If multiple tabs define the same date for the same intern name, add them up
              parsedComms[cleanName][dateStr] = (parsedComms[cleanName][dateStr] || 0) + chats;
              
              if (cleanName === 'aditya jaiswal' && chats > 0) {
                 console.log(`[DEBUG] Aditya col ${col}, date ${dateStr}, chats ${chats}`);
              }
            }
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
    await syncBatch20ReportingData();
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

/**
 * Syncs the specific "Batch-20 Weekly score card" and "Daily OJT Status"
 * specifically for Batch 20 as requested by the user, skipping dynamic computation.
 */
async function syncBatch20ReportingData() {
  const currentData = { daily: {}, weekly: {} };
  try {
    const spreadsheetId = '1zIWboejoQlUVGFlewYK0Ugtj7nUe8rR7cl29VOCJaB4';
    console.log(`[GoogleSyncService] Fetching Batch 20 Reporting Data...`);
    const sheets = googleService.getSheets();
    if (!sheets) throw new Error("Google Sheets API not initialized");

    // 1. Fetch Daily
    const dailyRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Daily OJT Status!A1:ZZ1000'
    });
    const dailyRows = dailyRes.data.values;
    
    if (dailyRows && dailyRows.length > 2) {
      const datesRow = dailyRows[0];
      const dayBlocks = [];
      for (let i = 0; i < datesRow.length; i++) {
        let dateStr = datesRow[i];
        if (dateStr && typeof dateStr === 'string' && dateStr.includes('Summary_Day')) {
          let match = dateStr.match(/(\d{1,2})(st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
          if (match) {
            const monthMap = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
            let month = monthMap[match[3].toLowerCase()];
            let d = new Date(2026, month, parseInt(match[1], 10));
            d.setHours(d.getHours() + 5); 
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
          const intern = row[idx];
          if (intern && intern.trim()) {
            const cleanName = intern.toLowerCase().trim();
            if (!currentData.daily[cleanName]) currentData.daily[cleanName] = {};
            currentData.daily[cleanName][block.date] = {
              aiRtg: row[idx+6] || "No Data",
              arst: row[idx+7] || "No Data",
              frt: row[idx+8] || "No Data",
              breakVal: row[idx+9] || "No Data"
            };
          }
        }
      }
    }

    // 2. Fetch Weekly
    const weeklyRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: ' Batch-20 Weekly score card!A1:N1000'
    });
    const rows = weeklyRes.data.values;
    let currentIntern = null;
    
    if (rows) {
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        if (!row || row.length === 0) continue;
        const col0 = (row[0] || '').trim();
        if (col0.toLowerCase() === 'intern' || col0.toLowerCase().startsWith('batch')) continue;
        
        if (col0 !== '') {
          currentIntern = col0.toLowerCase();
          currentData.weekly[currentIntern] = { weeks: [] };
        }
        
        if (currentIntern && currentData.weekly[currentIntern]) {
          const weekLabel = (row[3] || '').trim();
          if (weekLabel.toLowerCase().startsWith('week')) {
             const scanned = parseInt((row[7] || '0').replace(/,/g, ''), 10) || 0;
             const qcs = parseInt((row[8] || '0').replace(/,/g, ''), 10) || 0;
             const errorPctStr = row[9] || '0%';
             let errorPct = parseFloat(errorPctStr.replace('%', '')) || 0;
             const ojtRtg = parseFloat(row[10]) || 0;
             const trend = row[13] || '-';
             currentData.weekly[currentIntern].weeks.push({
               week: weekLabel,
               scanned, qcs, errorPct, ojtRtg, trend,
               valid: scanned > 0 || qcs > 0 || ojtRtg > 0
             });
          }
        }
      }
    }
    
    Object.keys(currentData.weekly).forEach(key => {
       const intern = currentData.weekly[key];
       const validWeeks = intern.weeks.filter(w => w.valid);
       let recent = validWeeks.length > 0 ? validWeeks[validWeeks.length - 1] : null;
       
       let totalScanned = 0, totalQCs = 0, totalOjtRtg = 0;
       validWeeks.forEach(w => {
         totalScanned += w.scanned;
         totalQCs += w.qcs;
         totalOjtRtg += w.ojtRtg;
       });
       
       let avg = null;
       if (validWeeks.length > 0) {
         avg = {
           scanned: totalScanned,
           qcs: totalQCs,
           errorPct: totalScanned > 0 ? (totalQCs / totalScanned) * 100 : 0,
           ojtRtg: totalOjtRtg / validWeeks.length,
           trend: recent ? recent.trend : '-'
         };
       }
       intern.recent = recent;
       intern.average = avg;
    });

    const outPath = path.join(rootDir, 'data/batches/b20-reporting.json');
    fs.writeFileSync(outPath, JSON.stringify(currentData, null, 2));
    console.log(`[GoogleSyncService] Successfully synced B20 Reporting Data to ${outPath}`);

  } catch (err) {
    console.error('[GoogleSyncService] Batch 20 Reporting sync error:', err.message);
  }
}

module.exports = {
  fetchAndSyncGoogleSheetsData,
  syncBatch20ReportingData,
  parseDDMMYYYYDate,
  saveDataToDisk
};
