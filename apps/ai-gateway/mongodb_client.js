/**
 * MongoDB Client for AI Gateway
 * 
 * Provides robust connectivity to MongoDB Atlas and specialized functions 
 * for data lake operations, including logging raw webhook payloads.
 * 
 * @module mongodb_client
 */

const { MongoClient, ServerApiVersion } = require('mongodb');

// Ensure the MONGODB_URI is provided in the environment variables
const uri = process.env.MONGODB_URI;

if (!uri) {
    console.warn('WARNING: MONGODB_URI environment variable is not defined.');
}

/**
 * Singleton instance of the MongoClient
 * @type {MongoClient}
 */
let client = null;

/**
 * Retrieves or initializes the MongoDB client instance.
 * 
 * @returns {MongoClient} The connected MongoClient instance.
 */
function getClient() {
    if (!client && uri) {
        client = new MongoClient(uri, {
            serverApi: {
                version: ServerApiVersion.v1,
                strict: true,
                deprecationErrors: true,
            }
        });
    }
    return client;
}

/**
 * Connects to the MongoDB Atlas cluster.
 * 
 * @throws {Error} If connection fails.
 */
async function connect() {
    const mongoClient = getClient();
    if (!mongoClient) {
        throw new Error('MongoDB client could not be initialized. Check MONGODB_URI.');
    }
    
    try {
        await mongoClient.connect();
        // Send a ping to confirm a successful connection
        await mongoClient.db('admin').command({ ping: 1 });
        console.log('Successfully connected to MongoDB Atlas.');
    } catch (error) {
        console.error('Failed to connect to MongoDB Atlas:', error);
        throw error;
    }
}

/**
 * Disconnects from the MongoDB Atlas cluster.
 */
async function disconnect() {
    if (client) {
        await client.close();
        console.log('Disconnected from MongoDB Atlas.');
    }
}

/**
 * Logs a raw webhook payload to the data lake collections.
 * 
 * @param {Object} payload - The raw payload received from the webhook.
 * @param {string} [source='unknown'] - The source of the webhook.
 * @returns {Promise<string>} The inserted document's ID.
 * @throws {Error} If logging fails.
 */
async function logWebhookPayload(payload, source = 'unknown') {
    const mongoClient = getClient();
    if (!mongoClient) {
         throw new Error('Database connection not established.');
    }

    // Sanitize payload keys to prevent MongoDB insertion errors with dots or dollars
    // and to mitigate NoSQL injection vectors in the data lake.
    function sanitizePayload(data) {
        if (data === null || typeof data !== 'object') {
            return data;
        }
        if (Array.isArray(data)) {
            return data.map(sanitizePayload);
        }
        
        const sanitized = {};
        for (const [key, value] of Object.entries(data)) {
            let safeKey = key.replace(/\./g, '_dot_');
            if (safeKey.startsWith('$')) {
                safeKey = '_' + safeKey;
            }
            sanitized[safeKey] = sanitizePayload(value);
        }
        return sanitized;
    }

    try {
        const db = mongoClient.db('data_lake');
        const collection = db.collection('webhook_logs');
        
        const document = {
            source,
            payload: sanitizePayload(payload),
            timestamp: new Date(),
        };

        const result = await collection.insertOne(document);
        console.info(`Successfully logged webhook payload from source: ${source} with ID: ${result.insertedId}`);
        return result.insertedId;
    } catch (error) {
        console.error('Error logging webhook payload:', error);
        throw error;
    }
}

module.exports = {
    connect,
    disconnect,
    logWebhookPayload,
    getClient
};
