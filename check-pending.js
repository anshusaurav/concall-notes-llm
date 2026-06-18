/**
 * Lists all unprocessed concalls across all companies.
 * Outputs a summary count and saves details to pending-concalls.json
 */
require('dotenv').config();
const FirebaseService = require('./src/services/FirebaseService');
const fs = require('fs');

async function run() {
    const fb = new FirebaseService();
    fb.initializeFirebase();
    const connected = await fb.testConnection();
    if (!connected) { console.error('❌ Firestore connection failed'); process.exit(1); }

    console.log('📋 Fetching all documents...');
    const snapshot = await fb.getAllDocuments();
    console.log(`📋 Total companies: ${snapshot.size}`);

    const pending = [];

    snapshot.docs.forEach(doc => {
        const data = doc.data();
        const concalls = data.documents?.Concalls || [];
        const industryLink = data.industryLink || '';

        concalls.forEach(c => {
            if (!c.isProcessed && c.link) {
                pending.push({
                    docId: doc.id,
                    companyName: data.name,
                    companyCode: data.companyCode,
                    industryLink,
                    quarter: c.quarter,
                    link: c.link,
                    processingError: c.processingError || null
                });
            }
        });
    });

    console.log(`\n📊 Unprocessed concalls with PDF links: ${pending.length}`);

    // Group by company for readability
    const byCompany = {};
    pending.forEach(p => {
        if (!byCompany[p.companyName]) byCompany[p.companyName] = [];
        byCompany[p.companyName].push(p.quarter);
    });

    const companies = Object.keys(byCompany);
    console.log(`🏢 Across ${companies.length} companies`);
    console.log('\nSample (first 20 companies):');
    companies.slice(0, 20).forEach(name => {
        console.log(`  ${name}: ${byCompany[name].join(', ')}`);
    });

    fs.writeFileSync('./pending-concalls.json', JSON.stringify(pending, null, 2));
    console.log(`\n💾 Full list saved to pending-concalls.json`);
    process.exit(0);
}

run().catch(err => { console.error('❌', err.message); process.exit(1); });
