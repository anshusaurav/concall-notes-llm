/**
 * clear-redis-cache.js
 *
 * Connects to Redis and deletes cached company data entries.
 * Usage:
 *   node clear-redis-cache.js [companyCode]   — clear one company
 *   node clear-redis-cache.js --all           — clear all company:* keys
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../ai-investment-service/.env') });
const { createClient } = require('redis');

async function run() {
    const arg = process.argv[2];

    const client = createClient({
        username: process.env.REDIS_USER || 'default',
        password: process.env.REDIS_PASSWORD,
        socket: {
            host: process.env.REDIS_HOST,
            port: parseInt(process.env.REDIS_PORT) || 6379,
            connectTimeout: 10000,
        },
    });

    client.on('error', err => console.error('Redis error:', err));
    await client.connect();
    console.log('✅ Connected to Redis');

    if (arg === '--all') {
        const keys = await client.keys('company:*');
        console.log(`Found ${keys.length} company:* key(s)`);
        if (keys.length > 0) {
            await client.del(keys);
            console.log(`✅ Deleted ${keys.length} key(s)`);
        }
    } else if (arg) {
        const key = `company:${arg}`;
        const existed = await client.del(key);
        console.log(existed ? `✅ Deleted key: ${key}` : `⚠️  Key not found: ${key}`);
    } else {
        // List all company keys
        const keys = await client.keys('company:*');
        console.log(`Found ${keys.length} company:* key(s):`);
        keys.slice(0, 20).forEach(k => console.log(' ', k));
        if (keys.length > 20) console.log(`  ... and ${keys.length - 20} more`);
    }

    await client.quit();
    console.log('Done');
}

run().catch(err => { console.error('❌', err.message); process.exit(1); });
