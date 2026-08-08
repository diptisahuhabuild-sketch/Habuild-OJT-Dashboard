const googleService = require('./server/services/googleService.js');
const fs = require('fs');

setTimeout(async () => {
  const sheets = googleService.getSheets();
  const spreadsheetId = '1zIWboejoQlUVGFlewYK0Ugtj7nUe8rR7cl29VOCJaB4';

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: ' Batch-20 Weekly score card!A1:N1000'
  });
  const rows = res.data.values;
  
  const weeklyData = {};
  let currentIntern = null;
  
  if (rows) {
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length === 0) continue;
      
      const col0 = (row[0] || '').trim();
      if (col0.toLowerCase() === 'intern' || col0.toLowerCase().startsWith('batch')) continue;
      
      if (col0 !== '') {
        currentIntern = col0.toLowerCase();
        weeklyData[currentIntern] = { weeks: [] };
      }
      
      if (currentIntern) {
        const weekLabel = (row[3] || '').trim();
        if (weekLabel.toLowerCase().startsWith('week')) {
           const scanned = parseInt((row[7] || '0').replace(/,/g, ''), 10) || 0;
           const qcs = parseInt((row[8] || '0').replace(/,/g, ''), 10) || 0;
           const errorPctStr = row[9] || '0%';
           let errorPct = parseFloat(errorPctStr.replace('%', '')) || 0;
           const ojtRtg = parseFloat(row[10]) || 0;
           const trend = row[13] || '-';
           
           weeklyData[currentIntern].weeks.push({
             week: weekLabel,
             scanned,
             qcs,
             errorPct,
             ojtRtg,
             trend,
             valid: scanned > 0 || qcs > 0 || ojtRtg > 0
           });
        }
      }
    }
  }
  
  // Now compute recent and average
  Object.keys(weeklyData).forEach(key => {
     const intern = weeklyData[key];
     const validWeeks = intern.weeks.filter(w => w.valid);
     
     let recent = null;
     if (validWeeks.length > 0) {
       recent = validWeeks[validWeeks.length - 1]; // last valid week
     }
     
     let totalScanned = 0;
     let totalQCs = 0;
     let totalOjtRtg = 0;
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
  
  console.log("Syed Weekly Data:", weeklyData['syed khizar ali']);
}, 2000);
