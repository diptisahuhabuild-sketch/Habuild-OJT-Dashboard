const path = require('path');
const service = require('./server/services/googleDocSyncService');

const serviceDir = path.resolve(__dirname, 'server/services');
const rootDir = path.resolve(serviceDir, '../../');
const QC_DOC_CACHE_FILE = path.join(rootDir, 'qc-doc-cache-meta.json');

console.log('__dirname of script:', __dirname);
console.log('serviceDir:', serviceDir);
console.log('rootDir resolved inside service:', rootDir);
console.log('QC_DOC_CACHE_FILE resolved inside service:', QC_DOC_CACHE_FILE);
