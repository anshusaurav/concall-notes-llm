/**
 * save-results.js
 *
 * Reads a JSON array from stdin (or a file path as argv[2]) where each item is:
 *   { docId, quarter, summary, markdownOutput, textLength }
 *
 * Updates the corresponding concall entry in Firestore.
 *
 * Usage:
 *   echo '<json>' | node save-results.js
 *   node save-results.js results.json
 */
require('dotenv').config();
const FirebaseService = require('./src/services/FirebaseService');
const fs = require('fs');

async function run() {
    const fb = new FirebaseService();
    fb.initializeFirebase();
    const connected = await fb.testConnection();
    if (!connected) { console.error('❌ Firestore connection failed'); process.exit(1); }

    let raw;
    if (process.argv[2]) {
        raw = fs.readFileSync(process.argv[2], 'utf8');
    } else {
        raw = fs.readFileSync('/dev/stdin', 'utf8');
    }

    const results = JSON.parse(raw);
    console.log(`📋 Saving ${results.length} results...`);

    for (const r of results) {
        const { docId, quarter, summary, shortSummary, textLength } = r;
        // markdownOutput field is what the frontend reads for "AI Summary" display.
        // Older build-batch scripts emit { summary: short, markdownOutput: long }.
        // Newer build-batch scripts emit { summary: long, shortSummary: short }.
        // Normalise: always write markdownOutput (fall back to summary if absent).
        const markdownOutput = r.markdownOutput || summary || null;
        if (!docId || !quarter) { console.warn('⚠️  Skipping invalid entry'); continue; }

        // Fetch current document
        const docRef = fb.db.collection('documents').doc(docId);
        const snap = await docRef.get();
        if (!snap.exists) { console.warn(`⚠️  Document ${docId} not found`); continue; }

        const data = snap.data();
        const concalls = data.documents?.Concalls || [];
        const idx = concalls.findIndex(c => c.quarter === quarter);
        if (idx === -1) { console.warn(`⚠️  Quarter ${quarter} not found in ${docId}`); continue; }

        concalls[idx] = {
            ...concalls[idx],
            summary,
            markdownOutput,
            ...(shortSummary ? { shortSummary } : {}),
            isProcessed: true,
            isGuidanceTableStandardized: true,
            guidanceTableStandardizedDate: new Date().toISOString(),
            processingDate: new Date().toISOString(),
            textLength: textLength || 0,
            processingError: null,
        };

        await docRef.update({ 'documents.Concalls': concalls });
        console.log(`✅ Saved ${data.name} ${quarter}`);
    }

    console.log('✅ Done');
    process.exit(0);
}

run().catch(err => { console.error('❌', err.message); process.exit(1); });
