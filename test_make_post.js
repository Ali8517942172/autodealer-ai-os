const https = require('https');
const token = process.env.MAKE_TOKEN;

const postPayload = JSON.stringify({
    name: "NEXUS OS Master Router",
    teamId: 2111305,
    scheduling: '{"type":"immediately"}',
    blueprint: '{"name":"NEXUS OS Master Router","flow":[]}'
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
        console.log(`POST Status: ${res.statusCode}`);
        console.log(`POST Body: ${data}`);
    });
});
req.write(postPayload);
req.end();
