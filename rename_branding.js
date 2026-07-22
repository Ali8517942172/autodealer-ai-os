const fs = require('fs');
const path = require('path');

const rootDir = "C:\\Users\\user\\Desktop\\MY RESUMES\\nexus-os";
const excludeDirs = new Set(['.git', 'node_modules', '.next', 'build', '__pycache__', 'venv', '.env', '.venv', '.gemini']);

const orderedReplacements = [
    ["NEXUS OS", "NEXUS OS"],
    ["NEXUS OS", "NEXUS OS"],
    ["nexus os", "nexus os"],
    ["nexus-os", "nexus-os"],
    ["nexus-os", "nexus-os"],
    ["NEXUS OS", "NEXUS OS"],
    ["NEXUS", "NEXUS"],
    ["nexus", "nexus"]
];

function processFile(filepath) {
    try {
        let content = fs.readFileSync(filepath, 'utf8');
        let newContent = content;
        
        for (const [oldStr, newStr] of orderedReplacements) {
            newContent = newContent.split(oldStr).join(newStr);
        }
        
        if (newContent !== content) {
            fs.writeFileSync(filepath, newContent, 'utf8');
            console.log(`Updated: ${filepath}`);
        }
    } catch (e) {
        // console.error(`Skipping ${filepath}: non-utf8 or error`);
    }
}

function walkSync(dir, filelist = []) {
    let files;
    try {
        files = fs.readdirSync(dir);
    } catch(e) { return filelist; }
    
    files.forEach(function(file) {
        if (excludeDirs.has(file)) return;
        const filepath = path.join(dir, file);
        
        let stat;
        try { stat = fs.statSync(filepath); } catch(e) { return; }
        
        if (stat.isDirectory()) {
            filelist = walkSync(filepath, filelist);
        } else {
            if (!filepath.match(/\.(pyc|png|jpg|jpeg|gif|mp4|pdf|zip|tar|gz)$/)) {
                processFile(filepath);
            }
        }
    });
    return filelist;
}

walkSync(rootDir);
console.log("Renaming complete.");
