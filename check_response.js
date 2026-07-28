const fs = require('fs');
try {
  const data = JSON.parse(fs.readFileSync('server-config.json', 'utf8'));
  console.log('Keys of server-config.json:', Object.keys(data));
  if (data.qcDocData) {
    console.log('qcDocData size:', JSON.stringify(data.qcDocData).length);
  }
} catch (e) {
  console.error(e.message);
}
