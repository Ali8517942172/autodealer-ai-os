const https = require('https');
const fs = require('fs');

const token = process.env.MAKE_TOKEN;
const bpPath = 'C:\\Users\\user\\Desktop\\MY RESUMES\\nexus-os\\make-workflows\\master_router_blueprint.json';
const bpData = fs.readFileSync(bpPath, 'utf8');

const payload = JSON.stringify({ blueprint: JSON.parse(bpData) });

const options = {
    hostname: 'eu1.make.com',
    path: '/api/v2/scenarios/6524643/blueprint', // Pushing to the existing master scenario
    method: 'PUT',
    headers: {
        'Authorization': `Token ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
    }
};

const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        console.log(`Make.com Upload Status: ${res.statusCode}`);
        if(res.statusCode < 300) {
            console.log("Successfully uploaded master router blueprint to Make.com!");
        } else {
            console.error(`Error Body: ${data}`);
        }
    });
});

req.on('error', (e) => {
    console.error(e);
});

req.write(payload);
req.end();
