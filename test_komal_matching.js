const fs = require('fs');

function namesMatch(regName, targetName) {
  if (!regName || !targetName) return false;
  
  const cleanReg = regName.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  const cleanTarget = targetName.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  
  if (cleanReg === cleanTarget) return true;
  
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
