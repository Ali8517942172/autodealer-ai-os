const axios = require('axios');

const CRM_API_URL = 'http://localhost:5000';
const AI_GATEWAY_URL = 'http://localhost:5010';

async function simulateZapierGmailWebhook() {
  console.log('--- Simulating Zapier Gmail to CRM Workflow ---');
  try {
    // Step 1: Send to AI Gateway to parse email
    console.log('1. Sending raw email text to AI Gateway...');
    const emailBody = "Hi, I'm John Doe. I'm very interested in scheduling a test drive for the new Toyota Land Cruiser. You can reach me at john.doe@example.com or 555-0198.";
    
    // Simulating Zapier Webhook POST to AI Gateway
    const gatewayRes = await axios.post(`${AI_GATEWAY_URL}/api/v1/agent/run`, {
      agent: "sales",
      input: `Extract customer name, phone, email, and vehicle interest from this email: ${emailBody}`
    });
    
    console.log('AI Gateway Response:', gatewayRes.data);
    
    // Step 2: Send structured data to CRM API
    console.log('\n2. Pushing structured lead to CRM API...');
    const crmRes = await axios.post(`${CRM_API_URL}/api/v1/leads`, {
      name: gatewayRes.data.parsed_name || "John Doe",
      email: "john.doe@example.com",
      phone: gatewayRes.data.parsed_phone || "555-0198",
      vehicle_interest: gatewayRes.data.parsed_vehicle || "Toyota Land Cruiser",
      source: "gmail",
      ai_parsed: true
    });
    
    console.log('CRM API Response:', crmRes.data);
    console.log('✅ Zapier Workflow Simulation Complete\n');
  } catch (error) {
    console.error('❌ Error in Zapier Simulation:', error.message);
  }
}

async function simulateMakeSheetsWebhook() {
  console.log('--- Simulating Make Google Sheets to CRM Workflow ---');
  try {
    // Simulating Make HTTP Module POST to CRM API
    console.log('1. Syncing new Google Sheet row to CRM...');
    const crmRes = await axios.post(`${CRM_API_URL}/api/v1/leads`, {
      name: "Jane Smith",
      email: "jane.smith@example.com",
      phone: "555-0200",
      vehicle_interest: "BMW X5",
      source: "google_sheets_Walk-in"
    }, {
      headers: {
        'Authorization': 'Bearer test-api-key',
        'Content-Type': 'application/json'
      }
    });
    
    console.log('CRM API Response:', crmRes.data);
    console.log('2. Make would now trigger a Slack message to #new-leads');
    console.log('✅ Make Workflow Simulation Complete\n');
  } catch (error) {
    console.error('❌ Error in Make Simulation:', error.message);
  }
}

async function runAll() {
  await simulateZapierGmailWebhook();
  await simulateMakeSheetsWebhook();
}

runAll();
