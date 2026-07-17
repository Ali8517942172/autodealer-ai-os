const https = require('https');
const fs = require('fs');
const token = process.env.MAKE_TOKEN;
const bpData = fs.readFileSync('c:\\Users\\user\\Desktop\\MY RESUMES\\alba-ai-platform\\make-workflows\\master_router_blueprint.json', 'utf8');

const bpObj = JSON.parse(bpData);
delete bpObj.platform;
delete bpObj.version;
// Ensure we keep the name consistent
bpObj.name = "AutoDealer Master Router";

const patchPayload = JSON.stringify({
    name: "AutoDealer Master Router",
    blueprint: JSON.stringify(bpObj)
});

const patchOptions = {
    hostname: 'eu1.make.com',
    path: `/api/v2/scenarios/6524643`,
    method: 'PATCH',
    headers: {
        'Authorization': `Token ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(patchPayload)
    }
};

const req = https.request(patchOptions, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        console.log(`PATCH Status: ${res.statusCode}`);
        console.log(`PATCH Body: ${data.substring(0, 500)}`);
    });
});
req.write(patchPayload);
req.end();
