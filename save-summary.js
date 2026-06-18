/**
 * Saves a Claude-generated concall summary back to Firebase.
 *
 * Usage:
 *   node save-summary.js <docId> <quarter> <summaryText> <markdownText>
 *
 * Or pipe a JSON file:
 *   node save-summary.js --file result.json
 *
 * JSON file format:
 * {
 *   "docId": "...",
 *   "quarter": "Q3FY25",
 *   "summary": "...",
 *   "markdownOutput": "..."
 * }
 */
require('dotenv').config();
const FirebaseService = require('./src/services/FirebaseService');
const fs = require('fs');

async function run() {
    const fb = new FirebaseService();
    fb.initializeFirebase();
    const connected = await fb.testConnection();
    if (!connected) { console.error('❌ Firestore connection failed'); process.exit(1); }

    let docId, quarter, summary, markdownOutput;

    if (process.argv[2] === '--file') {
        const data = JSON.parse(fs.readFileSync(process.argv[3], 'utf-8'));
        docId = data.docId;
        quarter = data.quarter;
        summary = data.summary;
        markdownOutput = data.markdownOutput;
    } else {
        docId = process.argv[2];
        quarter = process.argv[3];
        summary = process.argv[4];
        markdownOutput = process.argv[5];
    }

    if (!docId || !quarter || !markdownOutput) {
        console.error('Usage: node save-summary.js --file result.json');
        console.error('  or:  node save-summary.js <docId> <quarter> <summary> <markdown>');
        process.exit(1);
    }

    // Fetch the current document
    const ref = fb.db.collection('documents').doc(docId);
    const snap = await ref.get();
    if (!snap.exists) { console.error(`❌ Document ${docId} not found`); process.exit(1); }

    const data = snap.data();
    const concalls = data.documents?.Concalls || [];

    // Find the matching concall by quarter
    const idx = concalls.findIndex(c => c.quarter === quarter);
    if (idx === -1) {
        console.error(`❌ Quarter ${quarter} not found in document ${docId}`);
        process.exit(1);
    }

    concalls[idx] = {
        ...concalls[idx],
        summary,
        markdownOutput,
        isProcessed: true,
        processingDate: new Date().toISOString(),
        processedBy: 'claude-code'
    };

    await ref.update({ 'documents.Concalls': concalls });
    console.log(`✅ Saved summary for ${data.name} — ${quarter}`);
    process.exit(0);
}

run().catch(err => { console.error('❌', err.message); process.exit(1); });
