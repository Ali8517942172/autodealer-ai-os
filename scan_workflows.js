const fs = require('fs');
const path = require('path');
const dir = 'n8n-workflows';
const issues = {};

fs.readdirSync(dir).filter(f => f.endsWith('.json')).forEach(file => {
    const data = JSON.parse(fs.readFileSync(path.join(dir, file)));
    const fileIssues = [];

    data.nodes.forEach(node => {
        // Native nodes missing credentials
        if (/n8n-nodes-base\.(supabase|odoo|slack|gmail|resend)/.test(node.type)) {
            if (!node.credentials) {
                fileIssues.push(`Node '${node.name}' (${node.type}) is MISSING credentials mapping.`);
            }
        }

        // Langchain prompts not enforcing strict JSON
        if (node.type === '@n8n/n8n-nodes-langchain.agent') {
            if (node.parameters.text && !node.parameters.text.includes('STRICT JSON')) {
                fileIssues.push(`Agent '${node.name}' prompt might not enforce strict JSON output.`);
            }
        }

        // Search for suspicious expressions
        Object.keys(node.parameters || {}).forEach(key => {
            const val = node.parameters[key];
            if (typeof val === 'string' && val.startsWith('=')) {
                if (!val.includes('$json') && !val.includes('$env') && !val.includes('$item') && !val.includes('$fromAI')) {
                    fileIssues.push(`Node '${node.name}' has a suspicious expression in '${key}': ${val}`);
                }
            }
        });
    });

    if (fileIssues.length > 0) {
        issues[file] = fileIssues;
    }
});

console.log(JSON.stringify(issues, null, 2));
