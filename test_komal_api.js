const https = require('https');

function fetchUrl(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'Habuild-OJT-Dashboard/2.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ rawText: data.substring(0, 300), statusCode: res.statusCode });
        }
      });
    }).on('error', err => resolve({ error: err.message }));
  });
}

async function run() {
  console.log('--- PROBING komal-ai.habuild.in ---');
  const r1 = await fetchUrl('https://komal-ai.habuild.in/api/analytics/team');
  console.log('team:', r1);
  const r2 = await fetchUrl('https://komal-ai.habuild.in/api/agent/metrics?name=Alisha');
  console.log('metrics:', r2);
}

run();
