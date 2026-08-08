const googleService = require('./server/services/googleService.js');
const fs = require('fs');

setTimeout(async () => {
  const sheets = googleService.getSheets();
  const spreadsheetId = '1zIWboejoQlUVGFlewYK0Ugtj7nUe8rR7cl29VOCJaB4';

  const dailyRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Daily OJT Status!A1:ZZ1000'
  });
  const dailyRows = dailyRes.data.values;
  
  const dailyData = {};
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
    
    // Test mapping for Syed
    for (let r = 2; r < dailyRows.length; r++) {
      const row = dailyRows[r];
      if (!row || row.length === 0) continue;
      for (const block of dayBlocks) {
        const idx = block.startIndex;
        const intern = row[idx];
        if (intern && intern.trim() && intern.toLowerCase().includes('syed khizar ali')) {
           console.log(`[${block.date}] AI: ${row[idx+6]}, ARST: ${row[idx+7]}, FRT: ${row[idx+8]}, Break: ${row[idx+9]}`);
        }
      }
    }
  }
}, 2000);
