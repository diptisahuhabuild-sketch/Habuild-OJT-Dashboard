const fs = require('fs');
const path = require('path');
let google, sheets, docs, drive;

const rootDir = path.resolve(__dirname, '../../');
const DATA_FILE = path.join(rootDir, 'data.json');
const CONFIG_FILE = path.join(rootDir, 'server-config.json');
const DRIVE_STATE_FOLDER_ID = process.env.DRIVE_STATE_FOLDER_ID || null;

try {
  const { google: g } = require('googleapis');
  google = g;
  const scopes = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/documents.readonly',
    'https://www.googleapis.com/auth/drive'
  ];
  let auth;
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    auth = new google.auth.GoogleAuth({ credentials: creds, scopes });
    console.log('[GoogleService] Using credentials from environment variable');
  } else {
    const credsFile = process.env.GOOGLE_CREDENTIALS_FILE || 'google-credentials.json';
    const filePath = path.join(rootDir, credsFile);
    if (fs.existsSync(filePath)) {
      auth = new google.auth.GoogleAuth({ keyFile: filePath, scopes });
      console.log('[GoogleService] Using credentials from file:', credsFile);
    }
  }
  if (auth) {
    sheets = google.sheets({ version: 'v4', auth });
    docs = google.docs({ version: 'v1', auth });
    drive = google.drive({ version: 'v3', auth });
    console.log('[GoogleService] Google APIs initialized successfully');
  } else {
    console.log('[GoogleService] No credentials found. Google sync disabled.');
  }
} catch (e) {
  console.log('[GoogleService] Googleapis initialization note:', e.message);
}

let driveStateCache = {};

async function driveFindFileId(fileName) {
  if (!drive || !DRIVE_STATE_FOLDER_ID) return null;
  if (driveStateCache[fileName]) return driveStateCache[fileName];
  try {
    const q = `'${DRIVE_STATE_FOLDER_ID}' in parents and name = '${fileName}' and trashed = false`;
    const res = await drive.files.list({ q, fields: 'files(id, name)', spaces: 'drive' });
    if (res.data.files && res.data.files.length > 0) {
      driveStateCache[fileName] = res.data.files[0].id;
      return driveStateCache[fileName];
    }
  } catch (err) {
    console.error(`[GoogleService] Drive list failed for ${fileName}:`, err.message);
  }
  return null;
}

async function driveUploadFile(fileName, localFilePath) {
  if (!drive || !DRIVE_STATE_FOLDER_ID) return;
  try {
    const existingId = await driveFindFileId(fileName);
    const media = { mimeType: 'application/json', body: fs.createReadStream(localFilePath) };
    if (existingId) {
      await drive.files.update({ fileId: existingId, media });
      console.log(`[GoogleService] Drive updated: ${fileName}`);
    } else {
      const res = await drive.files.create({
        requestBody: { name: fileName, parents: [DRIVE_STATE_FOLDER_ID] },
        media,
        fields: 'id'
      });
      driveStateCache[fileName] = res.data.id;
      console.log(`[GoogleService] Drive created: ${fileName}`);
    }
  } catch (err) {
    console.error(`[GoogleService] Drive upload error for ${fileName}:`, err.message);
  }
}

async function syncDriveState() {
  if (!drive || !DRIVE_STATE_FOLDER_ID) return;
  const filesToSync = [
    { name: 'data.json', localPath: DATA_FILE },
    { name: 'server-config.json', localPath: CONFIG_FILE }
  ];
  for (const item of filesToSync) {
    try {
      const fileId = await driveFindFileId(item.name);
      if (fileId) {
        const fileMetadata = await drive.files.get({ fileId, fields: 'modifiedTime' });
        const remoteTime = new Date(fileMetadata.data.modifiedTime).getTime();
        let localTime = 0;
        if (fs.existsSync(item.localPath)) {
          localTime = fs.statSync(item.localPath).mtimeMs;
        }
        if (remoteTime > localTime) {
          const dest = fs.createWriteStream(item.localPath);
          const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
          await new Promise((resolve, reject) => {
            res.data.pipe(dest).on('finish', resolve).on('error', reject);
          });
          console.log(`[GoogleService] Downloaded newer state from Drive: ${item.name}`);
        }
      }
    } catch (e) {
      console.error(`[GoogleService] Sync state error for ${item.name}:`, e.message);
    }
  }
}

module.exports = {
  getSheets: () => sheets,
  getDocs: () => docs,
  getDrive: () => drive,
  driveUploadFile,
  syncDriveState,
  isInitialized: () => !!(sheets && drive)
};
