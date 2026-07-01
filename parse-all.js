const XLSX = require('xlsx');
const fs = require('fs');

const files = [
  { lead: 'DIKSHA', path: 'C:/Users/dipti/Downloads/Interns Details Sheet- DIKSHA.xlsx' },
  { lead: 'SONALI', path: 'C:/Users/dipti/Downloads/Intern batch 19 sheet sonali.xlsx' },
  { lead: 'RASHI', path: 'C:/Users/dipti/Downloads/Rashi - Interns Details sheet .xlsx' },
  { lead: 'PRIYANSHU', path: 'C:/Users/dipti/Downloads/interns details sheet - Priyanshu .xlsx' },
  { lead: 'SAMIKSHA', path: 'C:/Users/dipti/Downloads/Interns Details Sheet- Samiksha.xlsx' },
  { lead: 'NILESH', path: 'C:/Users/dipti/Downloads/Interns Details Sheet Nilesh.xlsx' },
];

// Tabs that contain actual audit/scan data (match by name patterns)
function isAuditTab(name) {
  const n = name.toLowerCase();
  return (n.includes('chat scan') || n.includes('cs b-') || n.includes('cs sheet') || n.includes('audit'))
    && !n.includes('count') && !n.includes('summary') && !n.includes('daily') && !n.includes('score')
    && !n.includes('update') && !n.includes('attendance') && !n.includes('week') && !n.includes('final')
    && !n.includes('rapid') && !n.includes('schedule') && !n.includes('session');
}

// Extract batch number from tab name
function getBatch(tabName) {
  const n = tabName;
  let m;
  m = n.match(/B[\s-]*(\d+)/i); if (m) return 'B-' + m[1];
  m = n.match(/Batch[\s-]*(\d+)/i); if (m) return 'B-' + m[1];
  m = n.match(/Audit[\s-]*(\d+)/i); if (m) return 'B-' + m[1];
  return null;
}

// Parse date value from Excel
function parseDate(v) {
  if (!v) return null;
  if (typeof v === 'number') {
    const d = new Date((v - 25569) * 86400000);
    return d.toISOString().split('T')[0];
  }
  const s = String(v).trim();
  // Try various date formats
  let d = new Date(s);
  if (!isNaN(d) && d.getFullYear() > 2000) return d.toISOString().split('T')[0];
  // DD/MM/YYYY
  const m = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    const yr = m[3].length === 2 ? '20' + m[3] : m[3];
    d = new Date(yr + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0'));
    if (!isNaN(d)) return d.toISOString().split('T')[0];
    // Try MM/DD/YYYY
    d = new Date(yr + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0'));
    if (!isNaN(d)) return d.toISOString().split('T')[0];
  }
  return null;
}

function parseNum(v) {
  if (v === null || v === undefined) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

// Map row to standard schema - handles BOTH old and new format
function mapRow(row, keys) {
  const kl = keys.map(k => k.toLowerCase().replace(/[^a-z0-9]/g, ''));

  function find(patterns) {
    for (const p of patterns) {
      const pl = p.toLowerCase().replace(/[^a-z0-9]/g, '');
      const idx = kl.findIndex(k => k.includes(pl));
      if (idx >= 0) return row[keys[idx]];
    }
    return null;
  }

  const internName = find(['Intern Name', 'Team Memeber Name', 'Executive Name', 'Name', 'Agent Name']);
  if (!internName || typeof internName !== 'string' || internName.trim().length < 2) return null;

  const scanDate = parseDate(find(['Scan Date', 'Date']));
  const chatDate = parseDate(find(['Chat date', 'Date of conversation', 'chat Date']));

  // New format fields
  const leadRating = parseNum(find(["Lead's Rating", 'Lead Rating', 'Average Rating', 'Avg. Rating', 'OVer all Rating', 'Average rating']));
  const aiRating = parseNum(find(['AI Rating', 'AI- Avg Rating', 'Dashboard Rating', 'AI Dashboard Rating']));

  // Improvements needed
  let impRaw = find(['Improvements Needed', 'Needs Improvement']);
  let improvementsNeeded = 'No';
  if (impRaw) {
    const s = String(impRaw).trim().toLowerCase();
    if (s === 'yes' || s === 'y' || s === 'true' || s === '1') improvementsNeeded = 'Yes';
  }

  const summary = find(['Summary of chat', 'Feedback /Description', 'Feedback', 'Remark',
    'Any Additional Observations or Recommendations From QC Executive Comments/Feedback',
    'Overall Summerry', 'Overall feedback']);

  const number = String(find(['Number', 'Member Contact Number', 'Whatsaap Number (Member)', 'Whatsaap Number']) || '');
  const chatType = find(['Chat type', 'Query Type', 'Categories', 'Member Query Summary', 'Query Summary']);

  // Old format detailed ratings
  const accuracyRating = parseNum(find(['Accuracy Rating', 'Accuracy', 'Clarity of messages']));
  const empathyRating = parseNum(find(['Empathy Rating', 'Empathy', 'Empathy and understanding']));
  const grammarRating = parseNum(find(['Grammar and Spelling', 'Grammer', 'Language proficiency']));
  const problemSolvingRating = parseNum(find(['Problem-Solving Skills Rating', 'Problem solving', 'Depth of understanding']));
  const resolutionRating = parseNum(find(['Resolution and Followup', 'Resoulation', 'Clarity in providig Next steps']));

  const shift = find(['Shift']);
  const department = find(['Department details', 'Department']);

  return {
    scanDate, chatDate, internName: internName.trim(), number, chatType,
    leadRating, aiRating, improvementsNeeded, summary: summary ? String(summary).trim() : null,
    shift, department, accuracyRating, empathyRating, grammarRating, problemSolvingRating, resolutionRating
  };
}

// Parse Rashi's headerless sheets
function parseHeaderless(ws) {
  const range = XLSX.utils.decode_range(ws['!ref']);
  const rows = [];
  // Find header row by looking for "Scan Date" or "Intern Name"
  let headerRow = -1;
  for (let r = range.s.r; r <= Math.min(range.s.r + 5, range.e.r); r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && String(cell.v).toLowerCase().includes('scan date')) { headerRow = r; break; }
      if (cell && String(cell.v).toLowerCase().includes('intern name')) { headerRow = r; break; }
    }
    if (headerRow >= 0) break;
  }
  if (headerRow < 0) return [];
  const json = XLSX.utils.sheet_to_json(ws, { range: headerRow, defval: null });
  return json;
}

// ===== MAIN =====
const result = { scanData: {}, leads: {} };

files.forEach(f => {
  console.log(`\nParsing ${f.lead}...`);
  const wb = XLSX.readFile(f.path);
  result.leads[f.lead] = [];

  wb.SheetNames.forEach(tabName => {
    if (!isAuditTab(tabName)) return;

    const batch = getBatch(tabName);
    if (!batch) {
      console.log(`  SKIP (no batch): ${tabName}`);
      return;
    }

    const ws = wb.Sheets[tabName];
    let json = XLSX.utils.sheet_to_json(ws, { defval: null });

    // Check if first row has meaningful headers
    if (json.length > 0) {
      const firstKey = Object.keys(json[0])[0] || '';
      if (firstKey.startsWith('__EMPTY')) {
        // Try headerless parse
        json = parseHeaderless(ws);
      }
    }

    if (!json.length) {
      console.log(`  SKIP (empty): ${tabName}`);
      return;
    }

    const keys = Object.keys(json[0]);
    let count = 0;

    json.forEach(row => {
      const mapped = mapRow(row, keys);
      if (!mapped || !mapped.internName) return;

      mapped.lead = f.lead;
      if (!result.scanData[batch]) result.scanData[batch] = [];
      result.scanData[batch].push(mapped);
      count++;
    });

    if (!result.leads[f.lead].includes(batch)) result.leads[f.lead].push(batch);
    console.log(`  ${tabName} -> ${batch}: ${count} records`);
  });
});

// Deduplicate within each batch
for (const [batch, rows] of Object.entries(result.scanData)) {
  const seen = new Set();
  const unique = [];
  rows.forEach(r => {
    const key = (r.internName || '') + '|' + (r.scanDate || '') + '|' + (r.number || '');
    if (!seen.has(key)) { seen.add(key); unique.push(r); }
  });
  result.scanData[batch] = unique;
}

// Summary
console.log('\n===== SUMMARY =====');
let totalAll = 0;
for (const [batch, rows] of Object.entries(result.scanData)) {
  const names = [...new Set(rows.map(r => r.internName))];
  const leads = [...new Set(rows.map(r => r.lead))];
  const errors = rows.filter(r => r.improvementsNeeded === 'Yes').length;
  console.log(`${batch}: ${rows.length} audits, ${names.length} interns, ${leads.length} leads (${leads.join(',')}), ${errors} errors`);
  totalAll += rows.length;
}
console.log(`\nTOTAL: ${totalAll} audit records`);
console.log('Leads:', JSON.stringify(result.leads));

// Write data.json
const output = { scanData: result.scanData, leadsConfig: result.leads };
fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
console.log('\ndata.json written!');
