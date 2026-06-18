/**
 * save-concall-analysis.js
 * Saves Claude Code's generated summary + markdownOutput back to Firestore
 * for a specific concall.
 *
 * Usage:
 *   node save-concall-analysis.js <docId> <quarter> <path-to-result.json>
 *
 * result.json must be: { "summary": "...", "markdownOutput": "..." }
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const FirebaseService = require('./src/services/FirebaseService');

const [,, docId, quarter, resultFile] = process.argv;
if (!docId || !quarter || !resultFile) {
  console.error('Usage: node save-concall-analysis.js <docId> <quarter> <result.json>');
  process.exit(1);
}

async function run() {
  const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  if (!result.summary || !result.markdownOutput) {
    console.error('result.json must have "summary" and "markdownOutput" fields');
    process.exit(1);
  }

  const fb = new FirebaseService();
  fb.initializeFirebase();

  // Get document
  const docSnap = await fb.db.collection('documents').doc(docId).get();
  if (!docSnap.exists) { console.error('Doc not found:', docId); process.exit(1); }
  const data = docSnap.data();

  // Update the matching concall
  const concalls = data?.documents?.['Concalls'] || [];
  let updated = false;
  const updatedConcalls = concalls.map(c => {
    if (c.quarter === quarter) {
      updated = true;
      return {
        ...c,
        summary: result.summary,
        markdownOutput: result.markdownOutput,
        isProcessed: true,
        processingDate: new Date().toISOString(),
        textLength: result.textLength || 0
      };
    }
    return c;
  });

  if (!updated) {
    console.error('Quarter not found in concalls:', quarter);
    process.exit(1);
  }

  await fb.updateDocumentInFirestore(docId, updatedConcalls);
  console.log(`✅ Saved analysis for ${data.name} / ${quarter}`);
  process.exit(0);
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
