const fs = require('fs');
const path = require('path');
const axios = require('axios');
const googleService = require('./googleService');

const rootDir = path.resolve(__dirname, '../../');
const DATA_FILE = path.join(rootDir, 'data.json');
const CONFIG_FILE = path.join(rootDir, 'server-config.json');
const CACHE_FILE = path.join(rootDir, 'qc-doc-cache.json');

const defaultInternNames = [
  'smit', 'mahak', 'aditya', 'anjali', 'kunal', 'papiha', 'palak', 'mosin', 'tina', 'babasaheb', 'jaya',
  'fuzail', 'samyak', 'alisha', 'kalpik', 'shivam', 'sohail', 'kapil', 'simran', 'farheen', 'gayatri',
  'sagar', 'aman', 'sayli', 'sayali', 'ishika', 'piyush', 'vaibhav', 'sana', 'sumeet', 'jeffin', 'damini',
  'bushra', 'danish', 'kshitij', 'preeti', 'kartik', 'prakhar', 'shahid', 'nikhilesh', 'charul',
  'ashwin', 'darshana', 'geetika', 'prachi', 'samiksha', 'nitesh', 'aashutosh', 'ritika', 'vaishnavi'
];

const BATCH_OVERRIDES = {
  'ketki motghare': 'B-12',
  'ketki': 'B-12',
  'charul': 'B-15',
  'sana': 'B-17',
  'vaishnavi': 'B-15',
  'simran s': 'B-16',
  'alisha': 'B-19',
  'alisha dupare': 'B-19',
  'sayali': 'B-19',
  'sayli': 'B-19',
  'vishal kawle': 'B-15',
  'vishal': 'B-15',
  'ishika': 'B-15'
};

/**
 * Dynamically builds a helper map of intern names from registry and sheets.
 * Maps lowercase substrings (first names and full names) to original properly-cased full names.
 */
function buildInternNameResolver() {
  const nameMap = new Map(); // lowercase -> original full name
  const rawNames = new Set(defaultInternNames);

  // Read config registry
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (Array.isArray(config.internsRegistry)) {
        config.internsRegistry.forEach(i => {
          if (i.name) rawNames.add(i.name.trim());
        });
      }
    }
  } catch (e) {
    console.error('[DocSync] Config read error:', e.message);
  }

  // Read sheet data scan logs
  try {
    if (fs.existsSync(DATA_FILE)) {
      const db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (db && db.scanData) {
        Object.values(db.scanData).forEach(rows => {
          if (Array.isArray(rows)) {
            rows.forEach(r => {
              if (r.internName) rawNames.add(r.internName.trim());
            });
          }
        });
      }
    }
  } catch (e) {
    console.error('[DocSync] Data.json read error:', e.message);
  }

  // Populate resolver maps
  rawNames.forEach(name => {
    const clean = name.toLowerCase().trim();
    if (!clean || clean === 'intern name' || clean === 'wati id' || clean === 'batch 19' || clean === 'calling morning') return;
    
    // Map full name
    nameMap.set(clean, name);

    // Map first name (if not already mapped or ambiguous)
    const first = clean.split(/\s+/)[0];
    if (first && first.length > 2) {
      if (!nameMap.has(first)) {
        nameMap.set(first, name);
      }
    }
  });

  return nameMap;
}

function parseDDMMYYYYDate(str) {
  if (!str) return null;
  const clean = str.trim().replace(/[\[\]]/g, '');
  const parts = clean.split(/[\/\-\.]/);
  if (parts.length === 3) {
    let day = parseInt(parts[0], 10);
    let month = parseInt(parts[1], 10) - 1;
    let year = parseInt(parts[2], 10);
    if (year < 100) year += 2000;
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0];
    }
  }
  return null;
}

/**
 * Parses a single Google Doc and returns structured records
 */
async function parseDoc(docs, docId, batchName, nameResolver) {
  try {
    const docRes = await docs.documents.get({ documentId: docId });
    const doc = docRes.data;
    const inlineObjects = doc.inlineObjects || {};
    const bodyContent = doc.body.content || [];

    const images = [];
    const rawParagraphs = [];

    bodyContent.forEach((el, index) => {
      if (el.paragraph) {
        const txt = el.paragraph.elements.map(e => e.textRun ? e.textRun.content : '').join('').trim();
        
        // Collect images
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

        if (txt) {
          rawParagraphs.push({ text: txt, index });
        }
      }
    });

    let currentDate = null;
    const parsedRecords = [];

    // Sort nameResolver keys by length descending to match full names first
    const searchKeys = Array.from(nameResolver.keys()).sort((a, b) => b.length - a.length);

    rawParagraphs.forEach(p => {
      // Check if paragraph is just a date
      const dateMatch = p.text.match(/^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/);
      if (dateMatch) {
        const parsed = parseDDMMYYYYDate(p.text);
        if (parsed) {
          currentDate = parsed;
          return;
        }
      }

      // Check if paragraph contains a phone number
      const phoneMatches = p.text.match(/\b\d{10,13}\b/g) || [];
      if (phoneMatches.length > 0) {
        const lowerText = p.text.toLowerCase();
        let matchedIntern = 'Unassigned';
        
        for (const nameKey of searchKeys) {
          if (lowerText.includes(nameKey)) {
            matchedIntern = nameResolver.get(nameKey);
            break;
          }
        }

        // Fallback checks for common spelling variations
        if (matchedIntern === 'Unassigned') {
          if (lowerText.includes('sayali')) {
            matchedIntern = 'Sayali';
          }
        }

        let resolvedBatch = batchName;
        const cleanName = matchedIntern.toLowerCase().trim();
        if (BATCH_OVERRIDES[cleanName]) {
          resolvedBatch = BATCH_OVERRIDES[cleanName];
        }

        phoneMatches.forEach(num => {
          parsedRecords.push({
            internName: matchedIntern,
            chatDate: currentDate || new Date().toISOString().split('T')[0],
            number: num.trim(),
            summary: p.text,
            index: p.index,
            batch: resolvedBatch,
            auditor: 'OJT Lead'
          });
        });
      }
    });

    // Map closest images to records and download locally in rate-limit safe chunks of 5
    const chunkSize = 5;
    for (let i = 0; i < parsedRecords.length; i += chunkSize) {
      const chunk = parsedRecords.slice(i, i + chunkSize);
      await Promise.all(chunk.map(async (rec) => {
        if (images.length === 0) return;
        let closestImg = images[0];
        let minDistance = Math.abs(rec.index - closestImg.index);
        for (let k = 1; k < images.length; k++) {
          const dist = Math.abs(rec.index - images[k].index);
          if (dist < minDistance) {
            minDistance = dist;
            closestImg = images[k];
          }
        }
        if (minDistance <= 10) {
          const imgName = `${rec.number || rec.index}.png`;
          const localRelPath = `/qc-images/${rec.batch}/${imgName}`;
          const localAbsPath = path.join(rootDir, 'public', 'qc-images', rec.batch, imgName);

          const dir = path.dirname(localAbsPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          if (fs.existsSync(localAbsPath) && fs.statSync(localAbsPath).size > 0) {
            rec.screenshot = localRelPath;
          } else {
            try {
              const response = await axios.get(closestImg.url, { responseType: 'arraybuffer', timeout: 10000 });
              fs.writeFileSync(localAbsPath, Buffer.from(response.data));
              rec.screenshot = localRelPath; // Save static local path
            } catch (err) {
              console.warn(`[DocSync] Failed to download image for ${rec.internName} (${rec.number}):`, err.message);
              rec.screenshot = closestImg.url; // Expired fallback
            }
          }
        }
      }));
    }

    return parsedRecords;
  } catch (err) {
    console.error(`[DocSync] Error parsing doc ${docId} for batch ${batchName}:`, err.message);
    return [];
  }
}

/**
 * Dynamically queries Google Drive for all shared Google Docs, auto-detects batches, and parses them
 */
async function syncAndParseAllDocs() {
  const docs = googleService.getDocs();
  const drive = googleService.getDrive();
  if (!docs || !drive) {
    console.warn('[DocSync] Google Docs or Drive API not initialized');
    return [];
  }

  const nameResolver = buildInternNameResolver();
  let allRecords = [];

  console.log('[DocSync] Searching Google Drive for shared QC Google Docs...');
  let driveDocs = [];
  try {
    const res = await drive.files.list({
      q: "mimeType = 'application/vnd.google-apps.document' and trashed = false",
      fields: "files(id, name)",
      pageSize: 100
    });
    
    const files = res.data.files || [];
    files.forEach(f => {
      let batch = 'B-20'; // default fallback
      const name = f.name.toLowerCase();
      if (name.includes('batch 20') || name.includes('b-20') || name.includes('b20')) batch = 'B-20';
      else if (name.includes('batch 19') || name.includes('b-19') || name.includes('b19')) batch = 'B-19';
      else if (name.includes('batch 18') || name.includes('b-18') || name.includes('b18')) batch = 'B-18';
      else if (name.includes('batch 17') || name.includes('b-17') || name.includes('b17')) batch = 'B-17';
      else if (name.includes('batch 16') || name.includes('b-16') || name.includes('b16')) batch = 'B-16';
      else if (name.includes('batch 15') || name.includes('b-15') || name.includes('b-15') || name.includes("vishal's")) batch = 'B-15';
      
      driveDocs.push({ id: f.id, name: f.name, batch });
    });
    console.log(`[DocSync] Discovered ${driveDocs.length} shared Google Docs to parse.`);
  } catch (err) {
    console.error('[DocSync] Error discovering docs from Drive:', err.message);
  }

  // Parse all discovered documents
  for (const doc of driveDocs) {
    console.log(`[DocSync] Parsing Doc "${doc.name}" for batch ${doc.batch}...`);
    const records = await parseDoc(docs, doc.id, doc.batch, nameResolver);
    allRecords = allRecords.concat(records);
    console.log(`[DocSync] Parsed ${records.length} records from Doc "${doc.name}"`);
  }

  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(allRecords, null, 2));
    console.log(`[DocSync] Cached ${allRecords.length} total QC records successfully.`);
  } catch (e) {
    console.error('[DocSync] Error writing cache file:', e.message);
  }

  return allRecords;
}

/**
 * Returns cached QC mistakes
 */
function getCachedQCMistakes() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[DocSync] Error reading cache file:', e.message);
  }
  return [];
}

module.exports = {
  syncAndParseAllDocs,
  getCachedQCMistakes
};
