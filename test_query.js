const https = require('https');
const pat = process.env.SUPABASE_PAT || 'YOUR_SUPABASE_PAT_HERE';
const ref = 'dsvuoovivysszdoiorch';

const payload = JSON.stringify({ query: 'SELECT 1 AS success;' });

const options = {
  hostname: 'api.supabase.com',
  path: `/v1/query`,
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${pat}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log(`Status: ${res.statusCode}`);
    console.log(`Response: ${data}`);
  });
});

req.on('error', (e) => console.error(e));
req.write(payload);
req.end();
