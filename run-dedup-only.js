/**
 * Deduplication-only script — no Gemini / LLM calls.
 *
 * Step 1: cleanDuplicateUsingRawDocuments()
 *   Merges rawDocuments → documents collection, then deletes rawDocuments.
 *
 * Step 2: cleanDuplicateDocuments()
 *   Deduplicates concalls within the documents collection (per-company and
 *   across multiple docs for the same company).
 *
 * Usage:
 *   node run-dedup-only.js
 */

require('dotenv').config();
const FirebaseService = require('./src/services/FirebaseService');
const DocumentCleaner = require('./src/modules/DocumentCleaner');

async function run() {
    const fb = new FirebaseService();
    fb.initializeFirebase();

    const connected = await fb.testConnection();
    if (!connected) {
        console.error('❌ Cannot connect to Firestore');
        process.exit(1);
    }

    const cleaner = new DocumentCleaner(fb);

    // ── Step 1: merge rawDocuments into documents ─────────────────────────────
    console.log('\n══════════════════════════════════════════════════');
    console.log(' STEP 1 — Merge rawDocuments → documents');
    console.log('══════════════════════════════════════════════════\n');
    await cleaner.cleanDuplicateUsingRawDocuments();

    // ── Step 2: deduplicate within documents collection ───────────────────────
    console.log('\n══════════════════════════════════════════════════');
    console.log(' STEP 2 — Deduplicate within documents collection');
    console.log('══════════════════════════════════════════════════\n');
    await cleaner.cleanDuplicateDocuments();

    console.log('\n✅ Deduplication complete — no Gemini calls made');
    process.exit(0);
}

run().catch(err => {
    console.error('❌ Fatal error:', err.message);
    process.exit(1);
});
