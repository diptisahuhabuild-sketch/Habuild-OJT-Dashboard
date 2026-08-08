const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'server-config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const batchesDir = path.join(__dirname, 'data', 'batches');
const teamsDir = path.join(__dirname, 'data', 'teams');

// 1. Group interns by batch
const batches = {};
if (config.internsRegistry) {
  config.internsRegistry.forEach(intern => {
    let batchName = intern.batch || 'UNASSIGNED';
    // standardize batch name
    if (batchName.toLowerCase().startsWith('batch ')) {
      batchName = 'B-' + batchName.split(' ')[1];
    }
    if (!batches[batchName]) batches[batchName] = { interns: [], qcDocs: [], sheets: [] };
    batches[batchName].interns.push(intern);
  });
}

// 2. Map existing batchDocLinks
if (config.batchDocLinks) {
  for (const [key, link] of Object.entries(config.batchDocLinks)) {
    const batchName = key.split('|')[0];
    if (!batches[batchName]) batches[batchName] = { interns: [], qcDocs: [], sheets: [] };
    if (!batches[batchName].qcDocs.includes(link)) {
      batches[batchName].qcDocs.push(link);
    }
  }
}

// 3. Add the 9 missing links to an UNASSIGNED_DOCS batch file
const missingDocs = [
  "https://docs.google.com/document/d/1QV7WcqR1utaZHN4QeFLza_bkglMmP-ZTyQQ55Z-CY4w/edit",
  "https://docs.google.com/document/d/187hU2SndrjWjDpDmJWQTXsC7JSgxWbnqCl7nMWgJM-w/edit",
  "https://docs.google.com/document/d/1dY6LMbwEOCE9MOIeH9Z_OpuCHJNOyf9JufN32cVJEbc/edit",
  "https://docs.google.com/document/d/1FxNFq6zMx-BtVPuthjGEntc6qHPjmQeMeB1Vj4K18B0/edit",
  "https://docs.google.com/document/d/1mnQ2XVbLcRkga2JTyBOWzzGy1CIrWfk6aV1qaqloD_U/edit",
  "https://docs.google.com/document/d/1Q9zJ_AzLTkNL4EB1zakdR6o5HopoXuSDW8gYgFQGHhA/edit",
  "https://docs.google.com/document/d/1hEeplyrBy6wh8cqkr5w_r2Twz_0Vqtz4hZgXRV2V4ug/edit",
  "https://docs.google.com/document/d/11DLvt-pt9ligWDE6mP6BdtT23XWuYJ2UYwiValnJIQw/edit",
  "https://docs.google.com/document/d/1j2r2gU_L-2GIDm0zB_LfUbSS3e1i_frz3w-GzH4kzc4/edit"
];
if (!batches['UNASSIGNED']) batches['UNASSIGNED'] = { interns: [], qcDocs: [], sheets: [] };
missingDocs.forEach(link => {
  batches['UNASSIGNED'].qcDocs.push(link);
});

// Write batch files
for (const [batchName, data] of Object.entries(batches)) {
  fs.writeFileSync(path.join(batchesDir, `${batchName}.json`), JSON.stringify(data, null, 2));
}

// 4. Group sheets by leads into teams
const teams = {};
if (config.sheets) {
  for (const [lead, url] of Object.entries(config.sheets)) {
    if (lead === 'masterId' || lead === 'masterUrl') continue;
    teams[lead] = { members: [], sheets: [url], docs: [] };
  }
}
if (config.docs) {
  for (const [lead, docData] of Object.entries(config.docs)) {
    if (!teams[lead]) teams[lead] = { members: [], sheets: [], docs: [] };
    if (docData && docData.url) {
      teams[lead].docs.push(docData.url);
    }
  }
}

// Write team files
for (const [teamName, data] of Object.entries(teams)) {
  fs.writeFileSync(path.join(teamsDir, `${teamName}.json`), JSON.stringify(data, null, 2));
}

// 5. Clean up server-config.json
delete config.internsRegistry;
delete config.batchDocLinks;
delete config.sheets;
delete config.docs;
delete config.qcDocData;
delete config.tasks;
delete config.pulseResponses;
delete config.assignments;

fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log('Split successful!');
