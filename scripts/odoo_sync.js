/**
 * Odoo to Supabase Vehicle Inventory Sync Script
 * 
 * This script synchronizes vehicle inventory data from an Odoo ERP instance
 * to a Supabase PostgreSQL database. It handles authentication, data extraction,
 * transformation, and upsertion to maintain an up-to-date inventory state.
 * 
 * Environment variables required:
 * - ODOO_URL: Base URL of the Odoo instance (e.g., https://my-company.odoo.com)
 * - ODOO_DB: Odoo database name
 * - ODOO_USERNAME: Odoo user email/username
 * - ODOO_PASSWORD: Odoo password or API key
 * - SUPABASE_URL: Supabase project URL
 * - SUPABASE_SERVICE_KEY: Supabase service role key (for bypass RLS)
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const xmlrpc = require('xmlrpc'); // Standard library for Odoo XML-RPC

// Configuration validation
const REQUIRED_ENVS = [
    'ODOO_URL', 'ODOO_DB', 'ODOO_USERNAME', 'ODOO_PASSWORD',
    'SUPABASE_URL', 'SUPABASE_SERVICE_KEY'
];

for (const env of REQUIRED_ENVS) {
    if (!process.env[env]) {
        console.error(`Fatal: Missing required environment variable: ${env}`);
        process.exit(1);
    }
}

const {
    ODOO_URL,
    ODOO_DB,
    ODOO_USERNAME,
    ODOO_PASSWORD,
    SUPABASE_URL,
    SUPABASE_SERVICE_KEY
} = process.env;

// Initialize Supabase Client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

/**
 * Creates an XML-RPC client for Odoo
 */
function createOdooClient(endpoint) {
    const url = new URL(ODOO_URL);
    const clientOptions = {
        host: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `/xmlrpc/2/${endpoint}`,
        secure: url.protocol === 'https:'
    };
    
    return url.protocol === 'https:' 
        ? xmlrpc.createSecureClient(clientOptions)
        : xmlrpc.createClient(clientOptions);
}

/**
 * Authenticates with Odoo and returns the user ID (uid)
 */
function authenticateOdoo() {
    return new Promise((resolve, reject) => {
        const client = createOdooClient('common');
        client.methodCall('authenticate', [ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD, {}], (error, uid) => {
            if (error) {
                return reject(new Error(`Odoo authentication failed: ${error.message}`));
            }
            if (!uid) {
                return reject(new Error('Odoo authentication failed: Invalid credentials.'));
            }
            resolve(uid);
        });
    });
}

/**
 * Fetches vehicle inventory records from Odoo
 */
function fetchOdooVehicles(uid) {
    return new Promise((resolve, reject) => {
        const client = createOdooClient('object');
        // Standard Odoo model for fleet vehicles
        const model = 'fleet.vehicle';
        const method = 'search_read';
        
        // Fetch active vehicles with specific relevant fields
        const domain = [['active', '=', true]];
        const fields = ['id', 'name', 'model_id', 'license_plate', 'vin_sn', 'state_id', 'company_id'];
        
        client.methodCall('execute_kw', [ODOO_DB, uid, ODOO_PASSWORD, model, method, [domain], { fields }], (error, records) => {
            if (error) {
                return reject(new Error(`Failed to fetch vehicles from Odoo: ${error.message}`));
            }
            resolve(records);
        });
    });
}

/**
 * Transforms Odoo records into Supabase schema format
 * Ensure your Supabase `vehicles` table matches these column names
 */
function transformVehicleData(odooRecords) {
    return odooRecords.map(record => ({
        odoo_id: record.id,
        name: record.name,
        model_name: record.model_id ? record.model_id[1] : null,
        license_plate: record.license_plate || null,
        vin: record.vin_sn || null,
        status: record.state_id ? record.state_id[1] : null,
        company_name: record.company_id ? record.company_id[1] : null,
        updated_at: new Date().toISOString()
    }));
}

/**
 * Upserts transformed records into Supabase
 */
async function syncToSupabase(vehicles) {
    if (vehicles.length === 0) {
        console.log('No vehicles to sync.');
        return;
    }

    const { data, error } = await supabase
        .from('vehicles')
        .upsert(vehicles, { onConflict: 'odoo_id' });

    if (error) {
        throw new Error(`Supabase upsert failed: ${error.message}`);
    }

    console.log(`Successfully synced ${vehicles.length} vehicles to Supabase.`);
}

/**
 * Main execution function orchestrating the sync workflow
 */
async function main() {
    console.log(`[${new Date().toISOString()}] Starting Odoo to Supabase vehicle inventory sync...`);
    
    try {
        // Step 1: Authenticate with Odoo
        console.log('Authenticating with Odoo...');
        const uid = await authenticateOdoo();
        console.log(`Authenticated successfully with UID: ${uid}`);

        // Step 2: Fetch Data
        console.log('Fetching vehicle inventory from Odoo...');
        const odooVehicles = await fetchOdooVehicles(uid);
        console.log(`Retrieved ${odooVehicles.length} vehicles from Odoo.`);

        // Step 3: Transform Data
        console.log('Transforming data...');
        const transformedVehicles = transformVehicleData(odooVehicles);

        // Step 4: Sync to Supabase
        console.log('Syncing data to Supabase...');
        await syncToSupabase(transformedVehicles);

        console.log(`[${new Date().toISOString()}] Sync completed successfully.`);
        process.exit(0);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error during sync process:`, error);
        process.exit(1);
    }
}

// Execute script
main();
