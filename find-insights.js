require('dotenv').config();
const FirebaseService = require('./src/services/FirebaseService');

async function find() {
  const fb = new FirebaseService();
  fb.initializeFirebase();
  await fb.testConnection();

  // Fetch 100 docs and find first 10 with insights
  const snap = await fb.db.collection('documents').limit(100).get();
  const results = [];

  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.insights && Object.keys(d.insights).length > 0) {
      results.push({ name: d.name, companyCode: d.companyCode, nseCode: d.nseCode });
      if (results.length === 10) break;
    }
  }

  console.log(`Found ${results.length} companies with insights (scanned ${snap.docs.length} docs):\n`);
  results.forEach((r, i) => console.log(`${i+1}. ${r.name} — code: ${r.companyCode}, NSE: ${r.nseCode}`));
  process.exit(0);
}

find().catch(e => { console.error(e.message); process.exit(1); });
