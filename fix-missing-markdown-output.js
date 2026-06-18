/**
 * fix-missing-markdown-output.js
 *
 * Patches all company documents in Firestore where a concall is
 * isProcessed: true but markdownOutput is absent/null/empty.
 * In those cases, sets markdownOutput = summary (the long markdown content).
 *
 * This fixes companies processed by newer build-batch scripts that
 * emit { summary, shortSummary } instead of { summary, markdownOutput }.
 *
 * The frontend (ConferenceCallsTable.tsx) reads `call.markdownOutput`
 * to decide whether to show "View Summary" or "Not available".
 *
 * Usage:
 *   node fix-missing-markdown-output.js [--company-code CODE]
 *
 * Without --company-code, patches ALL companies (slow).
 * With --company-code, patches only that company (e.g. 1273562 for VBL).
 */
require('dotenv').config();
const FirebaseService = require('./src/services/FirebaseService');

async function run() {
    const targetCode = (() => {
        const idx = process.argv.indexOf('--company-code');
        return idx !== -1 ? process.argv[idx + 1] : null;
    })();

    const fb = new FirebaseService();
    fb.initializeFirebase();
    const connected = await fb.testConnection();
    if (!connected) { console.error('❌ Firestore connection failed'); process.exit(1); }

    let docs;
    if (targetCode) {
        console.log(`🔍 Fetching documents for companyCode: ${targetCode}`);
        const snap = await fb.db.collection('documents')
            .where('companyCode', '==', targetCode)
            .get();
        docs = snap.docs;
    } else {
        console.log('🔍 Fetching ALL documents (paginated)...');
        const snap = await fb.getAllDocuments();
        docs = snap.docs;
    }

    console.log(`📋 Found ${docs.length} document(s) to inspect`);

    let totalPatched = 0;
    let totalSkipped = 0;

    for (const doc of docs) {
        const data = doc.data();
        const concalls = data.documents?.Concalls || [];
        if (!concalls.length) continue;

        let changed = false;
        const updated = concalls.map(c => {
            if (
                c.isProcessed &&
                !c.markdownOutput &&
                c.summary
            ) {
                console.log(`  🔧 ${data.name || doc.id} [${c.quarter}]: setting markdownOutput = summary (${c.summary.length} chars)`);
                changed = true;
                totalPatched++;
                return { ...c, markdownOutput: c.summary };
            }
            totalSkipped++;
            return c;
        });

        if (changed) {
            await fb.db.collection('documents').doc(doc.id).update({
                'documents.Concalls': updated,
            });
            console.log(`  ✅ Saved ${data.name || doc.id}`);
        }
    }

    console.log(`\n✅ Done. Patched ${totalPatched} concall entry(ies); ${totalSkipped} already had markdownOutput or were unprocessed.`);
    process.exit(0);
}

run().catch(err => { console.error('❌', err.message); process.exit(1); });
