require('dotenv').config();
const FirebaseService = require('./src/services/FirebaseService');

async function count() {
  const fb = new FirebaseService();
  fb.initializeFirebase();
  await fb.testConnection();
  
  let total = 0, fenced = 0, good = 0, empty = 0;
  let lastSnapshot = null;
  
  do {
    let query = fb.db.collection('documents').orderBy('__name__').limit(200);
    if (lastSnapshot) query = query.startAfter(lastSnapshot);
    
    const snap = await query.get();
    if (snap.empty) break;
    lastSnapshot = snap.docs[snap.docs.length - 1];
    
    for (const doc of snap.docs) {
      const data = doc.data();
      const concalls = data.documents?.Concalls || [];
      for (const c of concalls) {
        if (!c.markdownOutput) { empty++; continue; }
        total++;
        if (c.markdownOutput.trimStart().startsWith('```')) fenced++;
        else good++;
      }
    }
    
    if (snap.docs.length < 200) break;
  } while (true);
  
  console.log(`Total with markdownOutput: ${total}`);
  console.log(`  Good (no code fence):    ${good}`);
  console.log(`  Fenced (broken):         ${fenced}`);
  console.log(`  Empty/no markdown:       ${empty}`);
  process.exit(0);
}

count().catch(e => { console.error(e.message); process.exit(1); });
