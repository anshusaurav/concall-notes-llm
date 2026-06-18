/**
 * One-shot script: run deduplication then print companies with insights.
 * Does NOT generate any new concall summaries.
 */
require('dotenv').config();

const FirebaseService = require('./src/services/FirebaseService');
const DocumentCleaner = require('./src/modules/DocumentCleaner');

async function main() {
    const firebaseService = new FirebaseService();
    firebaseService.initializeFirebase();

    const ok = await firebaseService.testConnection();
    if (!ok) { console.error('❌ Cannot connect to Firestore'); process.exit(1); }

    // ── Step 1: Deduplication ─────────────────────────────────────────────────
    console.log('\n════════════════════════════════════════');
    console.log('  STEP 1: Deduplication');
    console.log('════════════════════════════════════════\n');

    const cleaner = new DocumentCleaner(firebaseService);
    await cleaner.cleanDuplicateUsingRawDocuments();

    // ── Step 2: Companies with insights ──────────────────────────────────────
    console.log('\n════════════════════════════════════════');
    console.log('  STEP 2: Companies with insights');
    console.log('════════════════════════════════════════\n');

    const snapshot = await firebaseService.getAllDocuments();

    const rows = [];

    snapshot.docs.forEach(doc => {
        const data = doc.data();
        const code = data.companyCode;
        const name = data.name || '';

        // insights = Chrome extension field (tab-keyed object)
        const insights = data.insights;
        if (!insights || typeof insights !== 'object' || Object.keys(insights).length === 0) return;

        const tabs = Object.keys(insights);
        const concalls = data?.documents?.['Concalls'] || [];
        const processed = concalls.filter(c => c.markdownOutput && c.markdownOutput.trim().length > 0);
        const tracker = data?.tracker?.guidance_tracker || data?.tracker?.guidanceTracker || [];

        rows.push({
            code,
            name,
            insightsTabs: tabs.join(', '),
            processedConcalls: processed.length,
            trackerItems: Array.isArray(tracker) ? tracker.length : 0,
        });
    });

    // Sort by company code numerically
    rows.sort((a, b) => Number(a.code) - Number(b.code));

    console.log(`📊 ${rows.length} companies have insights (Chrome extension data):\n`);
    console.log('Code\tProcessed Concalls\tTracker Items\tInsights Tabs\tCompany Name');
    console.log('────\t──────────────────\t─────────────\t─────────────\t────────────');
    rows.forEach(r => {
        console.log(`${r.code}\t${r.processedConcalls}\t${r.trackerItems}\t${r.insightsTabs}\t${r.name}`);
    });

    console.log(`\n✅ Done. ${rows.length} companies with insights.`);
}

main().catch(err => { console.error('❌ Fatal:', err.message); process.exit(1); });
