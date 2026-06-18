require('dotenv').config();
const FirebaseService = require('./src/services/FirebaseService');
const fb = new FirebaseService();
fb.initializeFirebase();

async function run() {
  console.log('Querying Firestore...');

  // Try fetching just one document first
  const snap = await fb.db.collection('documents').limit(3).get();
  console.log('Docs fetched:', snap.size);

  snap.forEach(doc => {
    const data = doc.data();
    console.log('Doc id:', doc.id);
    console.log('Top keys:', Object.keys(data).join(', '));
    const concalls = data?.documents?.['Concalls'];
    if (concalls) {
      console.log('  Concalls count:', concalls.length);
      console.log('  Sample quarter:', concalls[0]?.quarter);
    }
  });
  process.exit(0);
}

run().catch(e => { console.error('ERROR:', e.message, e.stack); process.exit(1); });
