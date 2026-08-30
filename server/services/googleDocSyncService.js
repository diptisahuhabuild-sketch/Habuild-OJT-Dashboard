const fs = require('fs');
const path = require('path');
const axios = require('axios');
const googleService = require('./googleService');

const rootDir = path.resolve(__dirname, '../../');
const QC_DOC_CACHE_FILE = path.join(rootDir, 'qc-doc-cache-meta.json');
const DATA_FILE = path.join(rootDir, 'data.json');
const CONFIG_FILE = path.join(rootDir, 'server-config.json');
const CACHE_FILE = path.join(rootDir, 'qc-doc-cache.json');

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

  const regTokens = cleanReg.split(/\s+/).filter(t => t.length > 2);
  const targetTokens = cleanTarget.split(/\s+/).filter(t => t.length > 2);

  const levDist = (s1, s2) => {
    const len1 = s1.length;
    const len2 = s2.length;
    const matrix = Array.from({ length: len1 + 1 }, () => Array(len2 + 1).fill(0));
    for (let i = 0; i <= len1; i++) matrix[i][0] = i;
    for (let j = 0; j <= len2; j++) matrix[0][j] = j;
    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }
    return matrix[len1][len2];
  };

  const tokMatch = (t1, t2) => {
    if (t1 === t2) return true;
    if (t1.length <= 4 || t2.length <= 4) return levDist(t1, t2) <= 1;
    return levDist(t1, t2) <= 2;
  };

  if (regTokens.length > 0 && targetTokens.length > 0) {
    if (regTokens.every(t => targetTokens.some(t2 => tokMatch(t, t2))) ||
        targetTokens.every(t => regTokens.some(t2 => tokMatch(t, t2)))) {
      return true;
    }
  }

  return false;
}

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
  const globalNameMap = new Map(); // lowercase -> { originalName, batchName }
  const batchesDir = path.join(rootDir, 'data', 'batches');

  try {
    if (fs.existsSync(batchesDir)) {
      const files = fs.readdirSync(batchesDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const batchKey = file.replace('.json', '');
        const batchData = JSON.parse(fs.readFileSync(path.join(batchesDir, file), 'utf8'));
        
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
          
          globalNameMap.set(clean, { originalName: name, batchName: batchKey });

          const first = clean.split(/\s+/)[0];
          if (first && first.length > 2) {
            if (!globalNameMap.has(first)) {
              globalNameMap.set(first, { originalName: name, batchName: batchKey });
            }
          }
        });
      }
    }
  } catch (e) {
    console.error('[DocSync] Batches dir read error:', e.message);
  }

  const globalSearchKeys = Array.from(globalNameMap.keys()).sort((a, b) => b.length - a.length);
  return { globalNameMap, globalSearchKeys };
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
    
    if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
      let finalDay, finalMonth;
      if (day > 12) {
        finalDay = day;
        finalMonth = month;
      } else if (month + 1 > 12) {
        finalDay = month + 1;
        finalMonth = day - 1;
      } else {
        finalDay = day;
        finalMonth = month;
      }
      const yStr = String(year);
      const mStr = String(finalMonth + 1).padStart(2, '0');
      const dStr = String(finalDay).padStart(2, '0');
      return `${yStr}-${mStr}-${dStr}`;
    }
  }
  return null;
}

function extractChatDate(text) {
  if (!text) return null;
  
  // Pre-process common typos like 26/62026 -> 26/6/2026 and 26/062026 -> 26/06/2026
  let normalizedText = text.replace(/\b(\d{1,2})\/(\d)(\d{4})\b/g, '$1/$2/$3')
                           .replace(/\b(\d{1,2})\/(\d{2})(\d{4})\b/g, '$1/$2/$3');

  const clean = normalizedText.toLowerCase().replace(/\s+/g, ' ');
  
  // 1. Try matching "chat date <date>" or "chat date - <date>"
  const matchChatDate = clean.match(/chat\s*date\s*[-–:]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i);
  if (matchChatDate && matchChatDate[1]) {
    const parsed = parseDDMMYYYYDate(matchChatDate[1]);
    if (parsed) return parsed;
  }

  // 2. Scan for any date pattern like dd/mm/yyyy
  const dateMatches = normalizedText.match(/\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/g);
  if (dateMatches && dateMatches.length > 0) {
    if (clean.includes('chat date') && dateMatches.length >= 2) {
      const idx = clean.indexOf('chat date');
      for (const dm of dateMatches) {
        if (normalizedText.indexOf(dm) > idx) {
          const parsed = parseDDMMYYYYDate(dm);
          if (parsed) return parsed;
        }
      }
    }
    const parsed = parseDDMMYYYYDate(dateMatches[0]);
    if (parsed) return parsed;
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
    const { globalNameMap, globalSearchKeys } = nameResolver;

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

    function flattenTabs(tabsArray, parentTitle = null, result = []) {
      if (!tabsArray) return result;
      for (const t of tabsArray) {
        let tabInlineObjects = rootInlineObjects;
        if (t.documentTab && t.documentTab.inlineObjects) {
          tabInlineObjects = { ...rootInlineObjects, ...t.documentTab.inlineObjects };
        }
        
        const currentTitle = t.tabProperties && t.tabProperties.title ? t.tabProperties.title.trim() : '';
        let resolvedTitle = currentTitle;
        if (currentTitle.toLowerCase().includes('suggestion') && parentTitle) {
          resolvedTitle = parentTitle;
        }
        
        result.push({
          title: resolvedTitle,
          originalTitle: currentTitle,
          content: t.documentTab && t.documentTab.body ? t.documentTab.body.content : [],
          inlineObjects: tabInlineObjects
        });
        if (t.childTabs) {
          flattenTabs(t.childTabs, resolvedTitle, result);
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
            const lines = txt.split(/[\u000b\r\n]/);
            lines.forEach((line, lineIdx) => {
              const cleaned = line.trim();
              if (cleaned) {
                rawParagraphs.push({ text: cleaned, index: index + (lineIdx * 0.001) });
              }
            });
          }
        }
      });

      const isSuggestionTab = (tabData.originalTitle || tabData.title).toLowerCase().trim().includes('suggestion');
      let currentDate = null;
      let pendingPhone = null;
      let pendingIndex = -1;
      let foundSuggestion = false;
      let suggestionText = '';

      if (isSuggestionTab) {
        // Line-by-line parsing for Suggestions tab (allow null phone numbers)
        for (let i = 0; i < rawParagraphs.length; i++) {
          const p = rawParagraphs[i];

          // 1. Check if date line (has date but no phone number, like "26/06/2026 chat date")
          const hasDate = p.text.match(/\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/);
          const hasPhone = p.text.match(/\b\d{10,13}\b/);
          if (hasDate && !hasPhone) {
            const parsed = extractChatDate(p.text);
            if (parsed) {
              currentDate = parsed;
              continue;
            }
          }

          // 2. Extract phone number and process immediately as a separate record
          const phoneMatches = p.text.match(/\b\d{10,13}\b/g) || [];
          const phone = phoneMatches.length > 0 ? phoneMatches[0].trim() : null;

          pendingPhone = phone;
          pendingIndex = p.index;
          suggestionText = phone ? p.text.replace(phone, '').trim() : p.text;

          saveParsedRecord();
        }
      } else {
        // Robust phone-centric parser for Main tabs (merges non-phone feedback text into preceding record)
        for (let i = 0; i < rawParagraphs.length; i++) {
          const p = rawParagraphs[i];

          // 1. Check if date line
          const hasDate = p.text.match(/\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/);
          const hasPhone = p.text.match(/\b\d{10,13}\b/);
          if (hasDate && !hasPhone) {
            const parsed = extractChatDate(p.text);
            if (parsed) {
              if (pendingPhone) {
                saveParsedRecord();
              }
              currentDate = parsed;
              continue;
            }
          }

          // 2. Check if phone number
          const phoneMatches = p.text.match(/\b\d{10,13}\b/g) || [];
          if (phoneMatches.length > 0) {
            if (pendingPhone) {
              saveParsedRecord();
            }
            pendingPhone = phoneMatches[0].trim();
            pendingIndex = p.index;
            suggestionText = p.text.replace(pendingPhone, '').trim();
            continue;
          }

          // 3. Append feedback text to preceding phone number
          if (pendingPhone) {
            suggestionText += (suggestionText ? ' ' : '') + p.text;
          }
        }
        
        // Flush any trailing record
        if (pendingPhone) {
          saveParsedRecord();
        }
      }

      function saveParsedRecord() {
        let matchedIntern = 'Unassigned';
        let resolvedBatch = batchName;
        
        // Strategy A: Check if Tab Title matches an intern name perfectly
        const cleanTabTitle = tabData.title.toLowerCase().trim();
        for (const nameKey of globalSearchKeys) {
          if (namesMatch(nameKey, cleanTabTitle)) {
            const entry = globalNameMap.get(nameKey);
            matchedIntern = entry.originalName;
            resolvedBatch = entry.batchName;
            break;
          }
        }
        
        // Strategy B: Scan the feedback text for intern mentions
        if (matchedIntern === 'Unassigned') {
          const lowerText = suggestionText.toLowerCase();
          for (const nameKey of globalSearchKeys) {
            if (lowerText.includes(nameKey)) {
              const entry = globalNameMap.get(nameKey);
              matchedIntern = entry.originalName;
              resolvedBatch = entry.batchName;
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

        let recordDate = extractChatDate(suggestionText) || currentDate || new Date().toISOString().split('T')[0];
        const isSuggestionTab = (tabData.originalTitle || tabData.title).toLowerCase().trim().includes('suggestion');

        parsedRecords.push({
          internName: matchedIntern,
          chatDate: recordDate,
          number: pendingPhone,
          summary: suggestionText || pendingPhone,
          index: pendingIndex,
          batch: resolvedBatch,
          auditor: leadName,
          screenshotTempUrl: screenshotFallback,
          type: isSuggestionTab ? 'suggestion' : 'qc'
        });
        
        pendingPhone = null;
        pendingIndex = -1;
        suggestionText = '';
        foundSuggestion = false;
      }
    });

    // Download closest images locally in chunks (using URL hash to avoid duplicate downloads)
    const crypto = require('crypto');
    const chunkSize = 5;
    for (let i = 0; i < parsedRecords.length; i += chunkSize) {
      const chunk = parsedRecords.slice(i, i + chunkSize);
      await Promise.all(chunk.map(async (rec) => {
        if (rec.screenshotTempUrl) {
          const urlHash = crypto.createHash('md5').update(rec.screenshotTempUrl).digest('hex');
          const imgName = `${urlHash}.png`;
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
  return {
    'B-21': '1u_6OehVk7mu8-kshSZ-y0P1ZD70J2rB4JovBis28zls',
    'B-20': '1m9cnG_wNubNG7sy2zaTtnpmIfy_7Wv26udBKgHFbPOE'
  };
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
