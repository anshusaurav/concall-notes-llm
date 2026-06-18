/**
 * fetch-for-claude-any.js
 * Like fetch-for-claude.js but falls back to pptLink if link is absent.
 * Usage:  node fetch-for-claude-any.js <docId> <quarter>
 * Output: ./tmp-concall/<docId>_<quarter>.json
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const FirebaseService = require('./src/services/FirebaseService');
const { fetchPDF, readPDF } = require('./src/utils/pdfUtils');

const [,, docId, quarter] = process.argv;
if (!docId || !quarter) {
  console.error('Usage: node fetch-for-claude-any.js <docId> <quarter>');
  process.exit(1);
}

async function run() {
  const fb = new FirebaseService();
  fb.initializeFirebase();

  const docSnap = await fb.db.collection('documents').doc(docId).get();
  if (!docSnap.exists) { console.error('Doc not found:', docId); process.exit(1); }
  const data = docSnap.data();

  const concalls = data?.documents?.['Concalls'] || [];
  const concall  = concalls.find(c => c.quarter === quarter);
  if (!concall) { console.error('Quarter not found:', quarter); process.exit(1); }

  // Prefer link (transcript) over pptLink (slides)
  const pdfUrl = concall.link || concall.pptLink || concall.attachmentUrl;
  const urlType = concall.link ? 'transcript' : (concall.pptLink ? 'slides/ppt' : 'attachment');
  if (!pdfUrl) { console.error('No usable PDF link for this concall'); process.exit(1); }

  console.log(`📄 Company: ${data.name} (${data.companyCode})`);
  console.log(`📅 Quarter: ${quarter}`);
  console.log(`🔗 PDF (${urlType}): ${pdfUrl}`);

  // Industry prompt
  const industryPromptsMap = await fb.readIndustryPrompts();
  const industryPrompt = industryPromptsMap.get(data.industryLink);
  if (!industryPrompt) {
    console.warn(`⚠️  No industry prompt for: ${data.industryLink} — using generic`);
  }

  console.log('⬇️  Fetching PDF...');
  const pdfBuffer = await fetchPDF(pdfUrl);
  console.log(`📖 PDF size: ${pdfBuffer.length} bytes`);
  const pdfText = await readPDF(pdfBuffer);
  console.log(`📝 Extracted ${pdfText.length} chars`);

  if (!pdfText || pdfText.trim().length < 100) {
    console.error('PDF text too short or empty');
    process.exit(1);
  }

  const outDir  = path.join(__dirname, 'tmp-concall');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  const outFile = path.join(outDir, `${docId}_${quarter}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    docId, quarter,
    company: data.name,
    companyCode: data.companyCode,
    industryLink: data.industryLink,
    pdfLink: pdfUrl,
    pdfLinkType: urlType,
    industryPrompt: industryPrompt || '',
    pdfText: pdfText.trim()
  }, null, 2));

  console.log(`\n✅ Saved to: ${outFile}`);
  console.log(`   pdfText length: ${pdfText.trim().length}`);
  process.exit(0);
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
