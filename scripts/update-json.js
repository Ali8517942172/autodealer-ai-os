const fs = require('fs');

// 1. Update ask_ai_rag.json
const askAiPath = 'n8n-workflows/ask_ai_rag.json';
const askAi = JSON.parse(fs.readFileSync(askAiPath, 'utf8'));

// Add executeWorkflowTrigger node
const executeTriggerNode1 = {
  "parameters": {},
  "id": "execute-trigger-ask-ai",
  "name": "Execute Workflow Trigger",
  "type": "n8n-nodes-base.executeWorkflowTrigger",
  "typeVersion": 1,
  "position": [0, -200]
};

askAi.nodes.push(executeTriggerNode1);

// Connect it to Extract Question
if (!askAi.connections["Execute Workflow Trigger"]) {
  askAi.connections["Execute Workflow Trigger"] = {
    "main": [
      [
        {
          "node": "Extract Question",
          "type": "main",
          "index": 0
        }
      ]
    ]
  };
}

// Modify Extract Question JS Code
const extractQuestionNode = askAi.nodes.find(n => n.name === 'Extract Question');
extractQuestionNode.parameters.jsCode = `const raw = $input.first().json;
const body = raw.body || raw;
const question = String(body.question || body.query || body.q || '').trim();

if (!question) {
  throw new Error('No question provided.');
}

const STOP = new Set(['what','which','who','whom','whose','when','where','why','how','is','are','was','were','be','been','being','do','does','did','the','a','an','and','or','of','to','in','on','for','with','about','our','my','your','their','we','i','you','they','it','this','that','these','those','can','could','should','would','will','shall','may','might','must','have','has','had','if','at','by','from','as','me','tell','explain','please']);

const terms = question
  .toLowerCase()
  .replace(/[^a-z0-9\\s]/g, ' ')
  .split(/\\s+/)
  .filter(t => t.length > 2 && !STOP.has(t));

const unique = [...new Set(terms)];
const finalTerms = unique.length ? unique : question.toLowerCase().replace(/[^a-z0-9\\s]/g, ' ').split(/\\s+/).filter(Boolean);

if (!finalTerms.length) {
  throw new Error('Could not derive any searchable terms from the question: ' + question);
}

return [{ json: { question, tsquery: finalTerms.join(' | ') } }];`;

fs.writeFileSync(askAiPath, JSON.stringify(askAi, null, 2));


// 2. Update finance_calc.json
const financeCalcPath = 'n8n-workflows/finance_calc.json';
const financeCalc = JSON.parse(fs.readFileSync(financeCalcPath, 'utf8'));

const executeTriggerNode2 = {
  "parameters": {},
  "id": "execute-trigger-finance-calc",
  "name": "Execute Workflow Trigger",
  "type": "n8n-nodes-base.executeWorkflowTrigger",
  "typeVersion": 1,
  "position": [250, 100]
};

financeCalc.nodes.push(executeTriggerNode2);

if (!financeCalc.connections["Execute Workflow Trigger"]) {
  financeCalc.connections["Execute Workflow Trigger"] = {
    "main": [
      [
        {
          "node": "Calculate Equity & Tier",
          "type": "main",
          "index": 0
        }
      ]
    ]
  };
}

fs.writeFileSync(financeCalcPath, JSON.stringify(financeCalc, null, 2));


// 3. Update whatsapp_bdc.json
const whatsappBdcPath = 'n8n-workflows/whatsapp_bdc.json';
const whatsappBdc = JSON.parse(fs.readFileSync(whatsappBdcPath, 'utf8'));

// Add Call Workflow Tool for ask_ai_rag
const tool1 = {
  "parameters": {
    "name": "ask_policy_rag",
    "description": "Call this tool to answer any questions about dealership policy, warranty, free service packages, or any documentation queries.",
    "workflowId": {
      "__rl": true,
      "value": "qHAtd3RckAKRBUkE",
      "mode": "id"
    },
    "workflowInputs": {
      "mappingMode": "defineBelow",
      "value": {},
      "matchingColumns": [],
      "schema": [],
      "attemptToConvertTypes": false,
      "convertFieldsToString": false
    }
  },
  "id": "tool-ask-ai-rag",
  "name": "ask_policy_rag",
  "type": "@n8n/n8n-nodes-langchain.toolWorkflow",
  "typeVersion": 1.1,
  "position": [704, 700]
};

// Add Call Workflow Tool for finance_calc
const tool2 = {
  "parameters": {
    "name": "calculate_finance",
    "description": "Call this tool to calculate EMI, APR, Trade-in equity, and loan-to-value percentage. Requires vehicleValue, loanPayoffAmount, and creditScore.",
    "workflowId": {
      "__rl": true,
      "value": "unMMpeL9uuPO79pp",
      "mode": "id"
    },
    "workflowInputs": {
      "mappingMode": "defineBelow",
      "value": {},
      "matchingColumns": [],
      "schema": [],
      "attemptToConvertTypes": false,
      "convertFieldsToString": false
    }
  },
  "id": "tool-finance-calc",
  "name": "calculate_finance",
  "type": "@n8n/n8n-nodes-langchain.toolWorkflow",
  "typeVersion": 1.1,
  "position": [704, 900]
};

whatsappBdc.nodes.push(tool1, tool2);

if (!whatsappBdc.connections["ask_policy_rag"]) {
  whatsappBdc.connections["ask_policy_rag"] = {
    "ai_tool": [
      [
        {
          "node": "AI BDC Sales Agent",
          "type": "ai_tool",
          "index": 0
        }
      ]
    ]
  };
}

if (!whatsappBdc.connections["calculate_finance"]) {
  whatsappBdc.connections["calculate_finance"] = {
    "ai_tool": [
      [
        {
          "node": "AI BDC Sales Agent",
          "type": "ai_tool",
          "index": 0
        }
      ]
    ]
  };
}

// Update the AI Agent system prompt to ensure it uses the new tools
const agentNode = whatsappBdc.nodes.find(n => n.name === 'AI BDC Sales Agent');
if(agentNode && agentNode.parameters && agentNode.parameters.options) {
    agentNode.parameters.options.systemMessage += " You now have access to MULTIPLE TOOLS. If a customer asks a complex question involving finance and policy, you MUST call BOTH tools (calculate_finance AND ask_policy_rag) to get the required information, and then synthesize a single, combined response.";
}

fs.writeFileSync(whatsappBdcPath, JSON.stringify(whatsappBdc, null, 2));

console.log("Updated ask_ai_rag.json, finance_calc.json, and whatsapp_bdc.json");
