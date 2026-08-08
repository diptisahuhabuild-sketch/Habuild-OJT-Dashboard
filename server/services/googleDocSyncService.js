const fs = require('fs');
const path = require('path');
const axios = require('axios');
const googleService = require('./googleService');

const rootDir = path.resolve(__dirname, '../../');
const QC_DOC_CACHE_FILE = path.join(rootDir, 'qc-doc-cache-meta.json');
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

function buildInternNameResolver() {
  const batchNameMap = new Map(); // batchKey -> Map<lowercase -> original full name>
  const batchesDir = path.join(rootDir, 'data', 'batches');

  try {
    if (fs.existsSync(batchesDir)) {
      const files = fs.readdirSync(batchesDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const batchKey = file.replace('.json', '');
        const batchData = JSON.parse(fs.readFileSync(path.join(batchesDir, file), 'utf8'));
        
        const nameMap = new Map();
        const rawNames = new Set();
        
        if (batchData.interns && Array.isArray(batchData.interns)) {
          batchData.interns.forEach(i => {
            if (i.name) rawNames.add(i.name.trim());
          });
        }
        
        // Add hardcoded fallback names for legacy data or edge cases
        defaultInternNames.forEach(name => rawNames.add(name));

        rawNames.forEach(name => {
          const clean = name.toLowerCase().trim();
          if (!clean || clean === 'intern name' || clean === 'wati id' || clean === 'batch 19' || clean === 'calling morning') return;
          
          nameMap.set(clean, name);

          const first = clean.split(/\s+/)[0];
          if (first && first.length > 2) {
            if (!nameMap.has(first)) {
              nameMap.set(first, name);
            }
          }
        });
        
        batchNameMap.set(batchKey, nameMap);
      }
    }
  } catch (e) {
    console.error('[DocSync] Batches dir read error:', e.message);
  }

  return batchNameMap;
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
    const docRes = await docs.documents.get({ 
      documentId: docId,
      includeTabsContent: true 
    });
    const doc = docRes.data;
    const parsedRecords = [];
    const batchResolver = nameResolver.get(batchName) || new Map();
    const searchKeys = Array.from(batchResolver.keys()).sort((a, b) => b.length - a.length);

    // Default root properties
    const rootInlineObjects = doc.inlineObjects || {};
    let tabsToProcess = [];
    
    let leadName = 'OJT Lead'; // Default fallback
    
    if (doc.tabs && doc.tabs.length > 0) {
      // First tab title usually contains the Lead's name based on organizational format
      if (doc.tabs[0].tabProperties && doc.tabs[0].tabProperties.title) {
        leadName = doc.tabs[0].tabProperties.title.trim();
      }
    }

    function flattenTabs(tabsArray, result = []) {
      if (!tabsArray) return result;
      for (const t of tabsArray) {
        let tabInlineObjects = rootInlineObjects;
        if (t.documentTab && t.documentTab.inlineObjects) {
          tabInlineObjects = { ...rootInlineObjects, ...t.documentTab.inlineObjects };
        }
        
        result.push({
          title: t.tabProperties.title,
          content: t.documentTab && t.documentTab.body ? t.documentTab.body.content : [],
          inlineObjects: tabInlineObjects
        });
        if (t.childTabs) {
          flattenTabs(t.childTabs, result);
        }
      }
      return result;
    }

    if (doc.tabs && doc.tabs.length > 0) {
      tabsToProcess = flattenTabs(doc.tabs);
    } else if (doc.body && doc.body.content) {
      tabsToProcess.push({
        title: 'Unassigned',
        content: doc.body.content,
        inlineObjects: rootInlineObjects
      });
    }

    tabsToProcess.forEach(tabData => {
      const rawParagraphs = [];
      const images = [];

      let index = 0;
      tabData.content.forEach(el => {
        if (el.paragraph) {
          index++;
          let txt = '';
          el.paragraph.elements.forEach(e => {
            if (e.textRun && e.textRun.content) {
              txt += e.textRun.content;
            }
            if (e.inlineObjectElement) {
              const objId = e.inlineObjectElement.inlineObjectId;
              const obj = tabData.inlineObjects[objId];
              const embeddedObj = obj && obj.inlineObjectProperties && obj.inlineObjectProperties.embeddedObject;
              const srcUrl = embeddedObj && embeddedObj.imageProperties && embeddedObj.imageProperties.contentUri;
              if (srcUrl) {
                images.push({ url: srcUrl, index });
              }
            }
          });

          if (txt.trim()) {
            rawParagraphs.push({ text: txt.trim(), index });
          }
        }
      });

      let currentDate = null;
      let pendingPhone = null;
      let pendingIndex = -1;
      let foundSuggestion = false;
      let suggestionText = '';

      for (let i = 0; i < rawParagraphs.length; i++) {
        const p = rawParagraphs[i];

        // 1. Check if date
        const dateMatch = p.text.match(/^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/);
        if (dateMatch) {
          const parsed = parseDDMMYYYYDate(p.text);
          if (parsed) currentDate = parsed;
          continue;
        }

        // 2. Check if phone number
        const phoneMatches = p.text.match(/\b\d{10,13}\b/g) || [];
        if (phoneMatches.length > 0) {
          // If we had a previous pending phone but no feedback followed, save it as is.
          if (pendingPhone) {
            saveParsedRecord();
          }
          pendingPhone = phoneMatches[0].trim();
          pendingIndex = p.index;
          suggestionText = p.text.replace(pendingPhone, '').trim();
          foundSuggestion = suggestionText.length > 10;
          continue;
        }

        // 3. If we have a pending phone and need feedback text
        if (pendingPhone && !foundSuggestion) {
          suggestionText += (suggestionText ? ' ' : '') + p.text;
          // Keep reading paragraphs until we hit the next phone number or date
          // For simplicity, we assume the next non-date, non-phone paragraph is the full feedback
          saveParsedRecord();
        }
      }
      
      // Flush any trailing record
      if (pendingPhone) {
        saveParsedRecord();
      }

      function saveParsedRecord() {
        let matchedIntern = 'Unassigned';
        
        // Strategy A: Check if Tab Title matches an intern name perfectly
        const cleanTabTitle = tabData.title.toLowerCase().trim();
        for (const nameKey of searchKeys) {
          if (cleanTabTitle.includes(nameKey)) {
            matchedIntern = batchResolver.get(nameKey);
            break;
          }
        }
        
        // Strategy B: Scan the feedback text for intern mentions
        if (matchedIntern === 'Unassigned') {
          const lowerText = suggestionText.toLowerCase();
          for (const nameKey of searchKeys) {
            if (lowerText.includes(nameKey)) {
              matchedIntern = batchResolver.get(nameKey);
              break;
            }
          }
        }

        // Fallback checks
        if (matchedIntern === 'Unassigned' && suggestionText.toLowerCase().includes('sayali')) {
          matchedIntern = 'Sayali';
        }

        // Apply Tab Owner Default if still Unassigned (and not a generic lead title)
        if (matchedIntern === 'Unassigned' && !cleanTabTitle.includes('team') && cleanTabTitle !== leadName.toLowerCase()) {
           // We assign it to the tab title exactly if we couldn't match it in registry
           matchedIntern = tabData.title.trim();
        }

        let resolvedBatch = batchName;
        const cleanName = matchedIntern.toLowerCase().trim();
        if (BATCH_OVERRIDES[cleanName]) {
          resolvedBatch = BATCH_OVERRIDES[cleanName];
        }
        
        // Grab nearby images
        const nearbyImages = images.filter(img => Math.abs(img.index - pendingIndex) <= 15);
        let screenshotFallback = null;
        if (nearbyImages.length > 0) {
          // Sort by proximity
          nearbyImages.sort((a, b) => Math.abs(a.index - pendingIndex) - Math.abs(b.index - pendingIndex));
          screenshotFallback = nearbyImages[0].url;
        }

        parsedRecords.push({
          internName: matchedIntern,
          chatDate: currentDate || new Date().toISOString().split('T')[0],
          number: pendingPhone,
          summary: suggestionText || pendingPhone,
          index: pendingIndex,
          batch: resolvedBatch,
          auditor: leadName,
          screenshotTempUrl: screenshotFallback
        });
        
        pendingPhone = null;
        pendingIndex = -1;
        suggestionText = '';
        foundSuggestion = false;
      }
    });

    // Download closest images locally in chunks
    const chunkSize = 5;
    for (let i = 0; i < parsedRecords.length; i += chunkSize) {
      const chunk = parsedRecords.slice(i, i + chunkSize);
      await Promise.all(chunk.map(async (rec) => {
        if (rec.screenshotTempUrl) {
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
              const response = await axios.get(rec.screenshotTempUrl, { responseType: 'arraybuffer', timeout: 10000 });
              fs.writeFileSync(localAbsPath, Buffer.from(response.data));
              rec.screenshot = localRelPath;
            } catch (err) {
              console.warn(`[DocSync] Failed to download image for ${rec.internName} (${rec.number}):`, err.message);
              rec.screenshot = rec.screenshotTempUrl;
            }
          }
        }
        delete rec.screenshotTempUrl;
      }));
    }

    return parsedRecords;
  } catch (err) {
    console.error(`[DocSync] Error parsing doc ${docId} for batch ${batchName}:`, err.message);
    return [];
  }
}

function getBatchDocMap() {
  const batchesDir = path.join(__dirname, '../../data/batches');
  const map = {};
  
  try {
    if (fs.existsSync(batchesDir)) {
      const files = fs.readdirSync(batchesDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const batchData = JSON.parse(fs.readFileSync(path.join(batchesDir, file), 'utf8'));
        const batchKey = file.replace('.json', '');
        
        if (batchData.qcDocs && Array.isArray(batchData.qcDocs)) {
          // We can map multiple docs to one batch in the future, 
          // but for now, just map the first one and extract the ID
          if (batchData.qcDocs.length > 0) {
            const match = batchData.qcDocs[0].match(/\/d\/([a-zA-Z0-9-_]+)/);
            if (match && match[1]) {
              map[batchKey] = match[1];
            }
          }
        }
      }
    }
  } catch(e) {
    console.error('[DocSync] Error parsing modular batches:', e);
  }
  return map;
}

/**
 * Parses all specific Google Docs in the BATCH_DOC_MAP
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

  console.log('[DocSync] Fetching specific QC Google Docs...');
  let driveDocs = [];
  const batchDocMap = getBatchDocMap();
  try {
    const fetchPromises = Object.entries(batchDocMap).map(async ([batch, id]) => {
      try {
        const res = await drive.files.get({
          fileId: id,
          fields: 'id, name, modifiedTime'
        });
        if (res.data) {
          driveDocs.push({ id: res.data.id, name: res.data.name, batch, modifiedTime: res.data.modifiedTime });
        }
      } catch (err) {
        console.warn(`[DocSync] Could not fetch Drive metadata for ${batch} doc (${id}):`, err.message);
      }
    });
    
    await Promise.all(fetchPromises);
    console.log(`[DocSync] Discovered ${driveDocs.length} shared Google Docs to parse.`);
  } catch (err) {
    console.error('[DocSync] Error fetching docs from Drive:', err.message);
  }

  // Parse all discovered documents
  let qcDocCacheMeta = {};
  if (fs.existsSync(QC_DOC_CACHE_FILE)) {
    try {
      qcDocCacheMeta = JSON.parse(fs.readFileSync(QC_DOC_CACHE_FILE, 'utf8'));
    } catch(e) {}
  }
  
  for (const doc of driveDocs) {
    if (doc.modifiedTime && qcDocCacheMeta[doc.id] && qcDocCacheMeta[doc.id].modifiedTime === doc.modifiedTime) {
       console.log(`[DocSync] Skipping Doc "${doc.name}" - Not modified since last sync.`);
       if (qcDocCacheMeta[doc.id].data) {
         allRecords = allRecords.concat(qcDocCacheMeta[doc.id].data);
       }
       continue;
    }
    console.log(`[DocSync] Parsing Doc "${doc.name}" for batch ${doc.batch}...`);
    const records = await parseDoc(docs, doc.id, doc.batch, nameResolver);
    allRecords = allRecords.concat(records);
    console.log(`[DocSync] Parsed ${records.length} records from Doc "${doc.name}"`);
    if (doc.modifiedTime) {
      qcDocCacheMeta[doc.id] = { modifiedTime: doc.modifiedTime, data: records };
    }
  }
  fs.writeFileSync(QC_DOC_CACHE_FILE, JSON.stringify(qcDocCacheMeta, null, 2));

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
