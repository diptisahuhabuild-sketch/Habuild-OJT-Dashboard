const fs = require('fs');

function namesMatch(regName, targetName) {
  if (!regName || !targetName) return false;
  
  const cleanReg = regName.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  const cleanTarget = targetName.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  
  if (cleanReg === cleanTarget) return true;

  // Concatenation & suffix removal logic
  const cleanRegNoSpace = cleanReg.replace(/habuild/g, '').replace(/\s+/g, '');
  const cleanTargetNoSpace = cleanTarget.replace(/habuild/g, '').replace(/\s+/g, '');
  if (cleanRegNoSpace === cleanTargetNoSpace) return true;
  if (cleanRegNoSpace.length > 5 && cleanTargetNoSpace.includes(cleanRegNoSpace)) return true;
  if (cleanTargetNoSpace.length > 5 && cleanRegNoSpace.includes(cleanTargetNoSpace)) return true;
  
  const regTokens = cleanReg.split(' ').filter(t => t.length > 2);
  const targetTokens = cleanTarget.split(' ').filter(t => t.length > 2);
  
  if (regTokens.length === 0 || targetTokens.length === 0) return false;
  
  const allRegTokensInTarget = regTokens.every(t => targetTokens.includes(t));
  if (allRegTokensInTarget) return true;

  const allTargetTokensInReg = targetTokens.every(t => regTokens.includes(t));
  if (allTargetTokensInReg) return true;

  if (regTokens.length >= 2) {
    const first = regTokens[0];
    const last = regTokens[regTokens.length - 1];
    if (targetTokens.includes(first) && targetTokens.includes(last)) {
      return true;
    }
  }
  
  return false;
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

try {
  const cache = JSON.parse(fs.readFileSync('komal-cache.json', 'utf8'));
  const config = JSON.parse(fs.readFileSync('server-config.json', 'utf8'));
  const registryNames = (config.internsRegistry || []).map(i => i.name.toLowerCase().trim());
  const agentKeys = Object.keys(cache.agentMetrics || {});

  console.log('--- KOMAL AI NAME MATCHES ---');
  let matchedCount = 0;
  registryNames.forEach(regName => {
    const matches = agentKeys.filter(k => namesMatch(regName, k));
    if (matches.length > 0) {
      matchedCount++;
      console.log(`Registry Name: "${regName}" | Matches:`, matches);
    } else {
      console.log(`Registry Name: "${regName}" | ❌ NO MATCH`);
    }
  });
  console.log(`Total Matched: ${matchedCount} / ${registryNames.length}`);
} catch (e) {
  console.error(e.message);
}
