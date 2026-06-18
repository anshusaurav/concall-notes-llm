require('dotenv').config();
const FirebaseService = require('./src/services/FirebaseService');
const fb = new FirebaseService();
fb.initializeFirebase();

const docId = process.argv[2] || 'xbYfrb1S5ZCmeSKWH7N4';

async function run() {
  const docSnap = await fb.db.collection('documents').doc(docId).get();
  const data = docSnap.data();
  console.log('Company:', data.name, '|', data.industryLink);
  const concalls = data?.documents?.['Concalls'] || [];
  const recent = concalls.filter(c => {
    const yr = parseInt((c.quarter||'').slice(-4));
    return yr >= 2025;
  });
  recent.forEach(c => {
    console.log('\n--- ' + c.quarter + ' | processed: ' + c.isProcessed);
    console.log('  link:', c.link || 'NONE');
    console.log('  pptLink:', c.pptLink || 'NONE');
    console.log('  recLink:', c.recLink || 'NONE');
    console.log('  attachmentUrl:', c.attachmentUrl || 'NONE');
    // print all keys
    console.log('  keys:', Object.keys(c).join(', '));
  });
  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
