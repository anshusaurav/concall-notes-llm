require('dotenv').config();
const fs = require('fs');
const FirebaseService = require('./src/services/FirebaseService');
const fb = new FirebaseService();
fb.initializeFirebase();

async function run() {
  console.log('Querying all documents for unprocessed 2025/2026 concalls with TRANSCRIPTS...');
  const snap = await fb.db.collection('documents').get();
  console.log('Total docs:', snap.size);

  const queue = [];

  snap.forEach(doc => {
    const data = doc.data();
    const concalls = data?.documents?.['Concalls'] || [];
    concalls.forEach(c => {
      const yr = parseInt((c.quarter||'').slice(-4));
      // Transcript-only: must have a `link` field (not just pptLink)
      if (yr >= 2025 && !c.isProcessed && c.link) {
        queue.push({
          docId: doc.id,
          company: data.name || data.companyName || doc.id,
          quarter: c.quarter,
          link: c.link,
          industryLink: data.industryLink || ''
        });
      }
    });
  });

  // Sort by quarter descending (newest first), then company
  queue.sort((a, b) => {
    if (b.quarter !== a.quarter) return b.quarter.localeCompare(a.quarter);
    return a.company.localeCompare(b.company);
  });

  fs.writeFileSync('./tmp-concall/unprocessed-queue.json', JSON.stringify(queue, null, 2));
  console.log(`\nFound ${queue.length} unprocessed 2025/2026 concalls WITH transcripts`);
  console.log('Saved to tmp-concall/unprocessed-queue.json');
  console.log('\nFirst 30:');
  queue.slice(0,30).forEach(i => console.log(`  ${i.quarter} | ${i.company} (${i.docId})`));
  process.exit(0);
}
run().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
