require('dotenv').config();
const FirebaseService = require('./src/services/FirebaseService');

async function check() {
  const fb = new FirebaseService();
  fb.initializeFirebase();
  await fb.testConnection();
  
  // Check both companies
  const companies = ['1285116', '1274653'];
  
  for (const companyCode of companies) {
    const snap = await fb.db.collection('documents')
      .where('companyCode', '==', companyCode)
      .limit(1)
      .get();
    
    if (snap.empty) {
      console.log(`Company ${companyCode}: NOT FOUND`);
      continue;
    }
    
    const doc = snap.docs[0].data();
    const concalls = doc.documents?.Concalls || [];
    console.log(`\n=== Company ${companyCode} (${doc.name}) - ${concalls.length} concalls ===`);
    
    for (const c of concalls.slice(0, 5)) {
      const hasMarkdown = !!c.markdownOutput;
      const markdownLen = c.markdownOutput ? c.markdownOutput.length : 0;
      const preview = c.markdownOutput ? c.markdownOutput.substring(0, 100).replace(/\n/g, '↵') : 'N/A';
      console.log(`  ${c.quarter}: markdownOutput=${hasMarkdown} (${markdownLen} chars) | preview: "${preview}"`);
    }
  }
  
  process.exit(0);
}

check().catch(e => { console.error(e.message); process.exit(1); });
