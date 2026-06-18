/**
 * fetch-for-claude.js
 * Fetches a concall's PDF text + industry prompt for a given company,
 * so Claude Code can analyze it inline and produce summary + markdown.
 *
 * Usage:
 *   node fetch-for-claude.js <docId> <quarter>
 *
 * Output:
 *   ./tmp-concall/<docId>_<quarter>.json  — { docId, quarter, company, industryPrompt, pdfText }
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const FirebaseService = require('./src/services/FirebaseService');
const { fetchPDF, readPDF } = require('./src/utils/pdfUtils');

const [,, docId, quarter] = process.argv;
if (!docId || !quarter) {
  console.error('Usage: node fetch-for-claude.js <docId> <quarter>');
  process.exit(1);
}

async function run() {
  const fb = new FirebaseService();
  fb.initializeFirebase();

  // Get document
  const docSnap = await fb.db.collection('documents').doc(docId).get();
  if (!docSnap.exists) { console.error('Doc not found:', docId); process.exit(1); }
  const data = docSnap.data();

  // Find the concall
  const concalls = data?.documents?.['Concalls'] || [];
  const concall = concalls.find(c => c.quarter === quarter);
  if (!concall) { console.error('Quarter not found:', quarter); process.exit(1); }
  if (!concall.link) { console.error('No link for this concall'); process.exit(1); }

  console.log(`📄 Company: ${data.name} (${data.companyCode})`);
  console.log(`📅 Quarter: ${quarter}`);
  console.log(`🔗 PDF: ${concall.link}`);

  // Get industry prompt
  const industryPromptsMap = await fb.readIndustryPrompts();
  const industryPrompt = industryPromptsMap.get(data.industryLink);
  if (!industryPrompt) {
    console.error('No industry prompt for:', data.industryLink);
    process.exit(1);
  }

  // Fetch and parse PDF
  console.log('⬇️  Fetching PDF...');
  const pdfBuffer = await fetchPDF(concall.link);
  console.log(`📖 PDF size: ${pdfBuffer.length} bytes`);
  const pdfText = await readPDF(pdfBuffer);
  console.log(`📝 Extracted ${pdfText.length} chars`);

  if (!pdfText || pdfText.trim().length < 100) {
    console.error('PDF text too short or empty');
    process.exit(1);
  }

  // Save to tmp file
  const outDir = path.join(__dirname, 'tmp-concall');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  const outFile = path.join(outDir, `${docId}_${quarter}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    docId, quarter,
    company: data.name,
    companyCode: data.companyCode,
    industryLink: data.industryLink,
    pdfLink: concall.link,
    industryPrompt,
    pdfText: pdfText.trim()
  }, null, 2));

  console.log(`\n✅ Saved to: ${outFile}`);
  console.log('📋 Now Claude Code should read this file, generate summary + markdown, then run:');
  console.log(`   node save-concall-analysis.js ${docId} ${quarter} <summary_text> <markdown_text>`);
  process.exit(0);
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
