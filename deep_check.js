const fs = require('fs');
const path = require('path');
const dir = 'n8n-workflows';
const issues = {};

fs.readdirSync(dir).filter(f => f.endsWith('.json')).forEach(file => {
    const data = JSON.parse(fs.readFileSync(path.join(dir, file)));
    const fileIssues = [];

    data.nodes.forEach(node => {
        // ExecuteWorkflow missing workflowId
        if (node.type === 'n8n-nodes-base.executeWorkflow') {
            if (!node.parameters || !node.parameters.workflowId) {
                fileIssues.push(`ExecuteWorkflow node '${node.name}' is missing workflowId.`);
            }
        }

        // Check if any native nodes have empty properties
        if (node.type.startsWith('n8n-nodes-base.')) {
            if (node.parameters) {
                Object.entries(node.parameters).forEach(([key, val]) => {
                    if (val === '' && key !== 'operation' && key !== 'resource') {
                        // some empty strings are fine, but might be suspicious
                    }
                });
            }
        }
    });

    if (fileIssues.length > 0) {
        issues[file] = fileIssues;
    }
});

console.log(JSON.stringify(issues, null, 2));
