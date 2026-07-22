const https = require('https');
const fs = require('fs');

const token = process.env.MAKE_TOKEN;
const bpPath = 'c:\\Users\\user\\Desktop\\MY RESUMES\\nexus-os\\make-workflows\\master_router_blueprint.json';
const bpData = fs.readFileSync(bpPath, 'utf8');

const bpObj = JSON.parse(bpData);
delete bpObj.platform;
delete bpObj.version;

const postPayload = JSON.stringify({
    name: "NEXUS OS Master Router",
    teamId: 2111305
});

const postOptions = {
    hostname: 'eu1.make.com',
    path: '/api/v2/scenarios',
    method: 'POST',
    headers: {
        'Authorization': `Token ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postPayload)
    }
};

const req = https.request(postOptions, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
            const scenarioId = JSON.parse(data).scenario.id;
            console.log(`Created scenario ID: ${scenarioId}`);
            
            const patchPayload = JSON.stringify({
                blueprint: JSON.stringify(bpObj)
            });
            
            const patchOptions = {
                hostname: 'eu1.make.com',
                path: `/api/v2/scenarios/${scenarioId}`,
                method: 'PATCH',
                headers: {
                    'Authorization': `Token ${token}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(patchPayload)
                }
            };
            
            const patchReq = https.request(patchOptions, (patchRes) => {
                let pData = '';
                patchRes.on('data', chunk => pData += chunk);
                patchRes.on('end', () => {
                    console.log(`PATCH Status: ${patchRes.statusCode}`);
                    console.log(`PATCH Body: ${pData}`);
                });
            });
            patchReq.write(patchPayload);
            patchReq.end();
            
        } else {
            console.log(`POST Status: ${res.statusCode}`);
            console.log(`POST Body: ${data}`);
        }
    });
});

req.on('error', (e) => {
    console.error(e);
});

req.write(postPayload);
req.end();
