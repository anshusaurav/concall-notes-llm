require('dotenv').config();
const FirebaseService = require('./src/services/FirebaseService');
const fb = new FirebaseService();
fb.initializeFirebase();

const docId = process.argv[2] || 'xbYfrb1S5ZCmeSKWH7N4';

async function run() {
  const docSnap = await fb.db.collection('documents').doc(docId).get();
  if (!docSnap.exists) { console.log('Not found:', docId); process.exit(1); }
  const data = docSnap.data();
  console.log('Company:', data.name || data.companyName, '|', docId);
  const concalls = data?.documents?.['Concalls'] || [];
  console.log('Total concalls:', concalls.length);
  const recent = concalls.filter(c => {
    const yr = parseInt((c.quarter||'').slice(-4));
    return yr >= 2025;
  });
  console.log('\n2025+ concalls:');
  recent.forEach(c => console.log('  ' + c.quarter + ' | processed: ' + c.isProcessed));
  const unprocessed = concalls.filter(c => !c.isProcessed);
  console.log('\nAll unprocessed:');
  unprocessed.forEach(c => console.log('  ' + c.quarter));
  process.exit(0);
}
run().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
