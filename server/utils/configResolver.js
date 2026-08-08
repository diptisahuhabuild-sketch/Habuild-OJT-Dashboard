const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '../../');
const CONFIG_FILE = path.join(rootDir, 'server-config.json');

function getConfig() {
  let config = { leads: {}, sheets: {}, docs: {}, batchDocLinks: {}, thresholds: {}, leadPhones: {}, internsRegistry: [] };
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
    }
    
    // Dynamically reconstruct from modular data stores
    const batchesDir = path.join(rootDir, 'data', 'batches');
    if (fs.existsSync(batchesDir)) {
      const files = fs.readdirSync(batchesDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const batchData = JSON.parse(fs.readFileSync(path.join(batchesDir, file), 'utf8'));
        const batchKey = file.replace('.json', '');
        
        // Append interns
        if (batchData.interns && Array.isArray(batchData.interns)) {
          config.internsRegistry.push(...batchData.interns);
        }
        
        // Reconstruct batchDocLinks
        if (batchData.qcDocs && Array.isArray(batchData.qcDocs)) {
          // Assume the first doc link is for morning and evening for now, or just map the first one
          if (batchData.qcDocs.length > 0) {
            config.batchDocLinks[`${batchKey}|morning`] = batchData.qcDocs[0];
            config.batchDocLinks[`${batchKey}|evening`] = batchData.qcDocs[0];
          }
        }
      }
    }

    const teamsDir = path.join(rootDir, 'data', 'teams');
    if (fs.existsSync(teamsDir)) {
      const files = fs.readdirSync(teamsDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const teamData = JSON.parse(fs.readFileSync(path.join(teamsDir, file), 'utf8'));
        const teamKey = file.replace('.json', '');
        
        // Reconstruct sheets
        if (teamData.sheets && teamData.sheets.length > 0) {
          config.sheets[teamKey] = teamData.sheets[0]; // just taking the first one for backwards compatibility
        }
        
        // Reconstruct docs
        if (teamData.docs && teamData.docs.length > 0) {
          config.docs[teamKey] = { url: teamData.docs[0], title: `QC ${teamKey}`, sections: {}, images: [] };
        }
      }
    }
    
    // Inject OJT Lead from scan data (the sheet they are assigned to)
    const dataPath = path.join(rootDir, 'data.json');
    if (fs.existsSync(dataPath)) {
      const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      const ojtLeadMap = {};
      
      if (data.scanData) {
        Object.values(data.scanData).forEach(batchRecords => {
          if (Array.isArray(batchRecords)) {
            batchRecords.forEach(r => {
              if (r.internName && r.auditor && r.auditor !== 'Master') {
                const key = r.internName.toLowerCase().trim();
                if (key.length > 2) {
                  // Only overwrite with uppercase if not already set, or if it's explicitly set by a main sheet
                  ojtLeadMap[key] = r.auditor;
                }
              }
            });
          }
        });
      }
      
      config.internsRegistry.forEach(intern => {
        const key = (intern.name || '').toLowerCase().trim();
        if (ojtLeadMap[key]) {
          intern.ojtLead = ojtLeadMap[key];
        }
      });
    }
    
  } catch (e) {
    console.error('[ConfigResolver] Error reading modular configs:', e.message);
  }
  return config;
}

module.exports = { getConfig };
