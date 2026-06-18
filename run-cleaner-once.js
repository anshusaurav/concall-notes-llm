/**
 * One-off script: run DocumentCleaner then print the Firestore document
 * for a specific companyCode.
 *
 * Usage:
 *   node run-cleaner-once.js [companyCode]
 *
 * Example:
 *   node run-cleaner-once.js 1275369
 */

require('dotenv').config();
const FirebaseService = require('./src/services/FirebaseService');
const DocumentCleaner = require('./src/modules/DocumentCleaner');

const COMPANY_CODE = process.argv[2] || '1275369';

async function run() {
    const fb = new FirebaseService();
    fb.initializeFirebase();

    const connected = await fb.testConnection();
    if (!connected) {
        console.error('❌ Cannot connect to Firestore');
        process.exit(1);
    }

    // ── Step 1: run the cleaner ───────────────────────────────────────────────
    console.log('\n══════════════════════════════════════════');
    console.log(' STEP 1 — Clean & merge rawDocuments');
    console.log('══════════════════════════════════════════\n');

    const cleaner = new DocumentCleaner(fb);
    await cleaner.cleanDuplicateUsingRawDocuments();

    // ── Step 2: fetch the company document ───────────────────────────────────
    console.log('\n══════════════════════════════════════════');
    console.log(` STEP 2 — Fetch company ${COMPANY_CODE}`);
    console.log('══════════════════════════════════════════\n');

    const snapshot = await fb.getDocumentsByCompanyCode(COMPANY_CODE);

    if (snapshot.empty) {
        console.log(`📭 No document found for companyCode: ${COMPANY_CODE}`);
        process.exit(0);
    }

    const doc = snapshot.docs[0];
    const data = doc.data();

    // Print a structured summary so it's readable in the terminal
    console.log(`📋 Firestore doc ID : ${doc.id}`);
    console.log(`🏢 Company name     : ${data.name}`);
    console.log(`🔢 companyCode      : ${data.companyCode}`);
    console.log(`📅 lastProcessed    : ${data.lastProcessed}`);
    console.log(`📅 scrapedAt        : ${data.scrapedAt || '(not set)'}`);

    // Concalls
    const concalls = data.documents?.Concalls || [];
    console.log(`\n📞 Concalls (${concalls.length} total):`);
    concalls.forEach((c, i) => {
        const note = c.isProcessed ? '✅ processed' : '⏳ pending';
        console.log(`   [${i + 1}] ${c.quarter || '(no quarter)'} — ${note}`);
    });

    // Announcements
    const announcements = data.documents?.Announcements || [];
    console.log(`\n📣 Announcements: ${announcements.length}`);

    // Insights
    if (data.insights) {
        const tabs = Object.keys(data.insights);
        console.log(`\n📊 Insights (tabs: ${tabs.join(', ')}):`);
        tabs.forEach(tab => {
            const t = data.insights[tab];
            if (!t) return;
            console.log(`   [${tab}] periods: ${t.periods?.length ?? 0}, rows: ${t.rows?.length ?? 0}`);
            if (t.periods?.length) {
                console.log(`         period labels: ${t.periods.map(p => p.label).join(' | ')}`);
            }
            if (t.rows?.length) {
                console.log(`         sample metrics: ${t.rows.slice(0, 5).map(r => r.metric + (r.unit ? ` (${r.unit})` : '')).join(', ')}`);
            }
        });
    } else {
        console.log('\n📊 Insights: (none — #insights section may not exist for this company)');
    }

    console.log('\n✅ Done');
    process.exit(0);
}

run().catch(err => {
    console.error('❌ Fatal error:', err.message);
    process.exit(1);
});
