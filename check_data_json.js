const fs = require('fs');

try {
  const stats = fs.statSync('data.json');
  console.log('data.json Last Modified:', stats.mtime);
  
  const data = JSON.parse(fs.readFileSync('data.json', 'utf8'));
  
  // Verify attendance data
  const attendKeys = Object.keys(data.attendanceData || {});
  console.log('Attendance Interns Count in data.json:', attendKeys.length);
  if (attendKeys.length > 0) {
    console.log('Sample Attendance key (name):', attendKeys[0]);
    console.log('Sample Attendance record dates:', Object.keys(data.attendanceData[attendKeys[0]] || {}).slice(0, 5));
  }

  // Verify scanData batches
  const scanKeys = Object.keys(data.scanData || {});
  console.log('Scan Data Batches/Tabs Count in data.json:', scanKeys.length);
  if (scanKeys.length > 0) {
    console.log('Sample Scan Data Batch/Tab:', scanKeys[0]);
    console.log('Sample Scan Data record count:', data.scanData[scanKeys[0]].length);
  }
} catch (e) {
  console.error(e.message);
}
