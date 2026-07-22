const fs = require('fs');
const path = require('path');

const dirs = ['n8n-workflows', 'zapier-workflows', 'make-workflows'];
let allOk = true;

dirs.forEach(d => {
    const dirPath = path.join(__dirname, d);
    if (!fs.existsSync(dirPath)) return;
    
    fs.readdirSync(dirPath).forEach(f => {
        if(f.endsWith('.json')) {
            try {
                const content = fs.readFileSync(path.join(dirPath, f), 'utf8');
                JSON.parse(content);
                console.log(`[OK] ${d}/${f}`);
            } catch(e) {
                console.error(`[ERROR] ${d}/${f} BROKEN: ${e.message}`);
                allOk = false;
            }
        }
    });
});

if (allOk) {
    console.log("All JSON workflows are valid.");
} else {
    console.log("Some JSON workflows are broken!");
}
