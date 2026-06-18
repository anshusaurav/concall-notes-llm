/**
 * Lists all industry prompts stored in Firebase.
 * Saves to industry-prompts-dump.json
 */
require('dotenv').config();
const FirebaseService = require('./src/services/FirebaseService');
const fs = require('fs');

async function run() {
    const fb = new FirebaseService();
    fb.initializeFirebase();
    const connected = await fb.testConnection();
    if (!connected) { console.error('❌ Firestore connection failed'); process.exit(1); }

    const map = await fb.readIndustryPrompts();
    console.log(`📋 Total industry prompts: ${map.size}`);

    const result = {};
    map.forEach((prompt, link) => {
        result[link] = prompt;
    });

    const keys = Object.keys(result);
    keys.forEach((k, i) => {
        const val = result[k];
        if (!val || typeof val !== 'string') {
            console.log(`\n[${i+1}] ${k}\n    ⚠️  (undefined or non-string value)`);
            return;
        }
        const preview = val.substring(0, 120).replace(/\n/g, ' ');
        console.log(`\n[${i+1}] ${k}\n    "${preview}..."`);
    });

    fs.writeFileSync('./industry-prompts-dump.json', JSON.stringify(result, null, 2));
    console.log(`\n💾 Full dump saved to industry-prompts-dump.json`);
    process.exit(0);
}

run().catch(err => { console.error('❌', err.message); process.exit(1); });
