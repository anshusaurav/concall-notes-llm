/**
 * fetch-batch.js <batchSize>
 *
 * Fetches the next N unprocessed concalls from Firestore, downloads their
 * PDFs, extracts text, and prints a JSON array to stdout.
 *
 * Each item:
 *   { docId, companyName, companyCode, quarter, industryLink, industryPrompt,
 *     pdfText, link, pptLink, recLink }
 *
 * Usage: node fetch-batch.js 2
 */
require('dotenv').config();

// Redirect console.log → stderr so stdout carries only the JSON output
const _origLog = console.log.bind(console);
console.log = (...args) => process.stderr.write(args.join(' ') + '\n');

const FirebaseService = require('./src/services/FirebaseService');
const { fetchPDF, readPDF } = require('./src/utils/pdfUtils');

const MAX_PDF_CHARS = 60000; // keep context manageable

// Only process concalls from 2025 or 2026
// Quarter formats: "May2026", "Q4FY26", "Nov2025", "Q2FY25", "Feb2025", etc.
function isRecentQuarter(quarter) {
    if (!quarter) return false;
    return /2025|2026|FY25|FY26/.test(quarter);
}

async function run() {
    const batchSize = parseInt(process.argv[2]) || 2;

    const fb = new FirebaseService();
    fb.initializeFirebase();
    const connected = await fb.testConnection();
    if (!connected) { process.stderr.write('❌ Firestore connection failed\n'); process.exit(1); }

    // Load all industry prompts
    const promptsMap = await fb.readIndustryPrompts();

    const snapshot = await fb.getAllDocuments();

    const pending = [];

    for (const doc of snapshot.docs) {
        if (pending.length >= batchSize) break;
        const data = doc.data();
        const concalls = data.documents?.Concalls || [];
        const industryLink = data.industryLink || '';
        const industryPrompt = promptsMap.get(industryLink);

        if (!industryPrompt) continue;

        for (const c of concalls) {
            if (pending.length >= batchSize) break;
            if (c.isProcessed) continue;
            // Use link as primary; fall back to pptLink if link is absent
            const pdfSource = c.link || c.pptLink || null;
            if (!pdfSource) continue;
            // Only process 2025/2026 concalls
            if (!isRecentQuarter(c.quarter)) continue;
            // Skip non-LLM errors (network, etc.) — only retry LLM/link errors
            if (c.processingError &&
                !c.processingError.includes('Claude') &&
                !c.processingError.includes('Gemini') &&
                !c.processingError.includes('No PDF link available')) {
                continue;
            }

            process.stderr.write(`📥 Fetching PDF for ${data.name} ${c.quarter}${!c.link ? ' (pptLink fallback)' : ''}...\n`);
            try {
                const buf = await fetchPDF(pdfSource);
                let pdfText = await readPDF(buf);
                if (pdfText.length > MAX_PDF_CHARS) pdfText = pdfText.substring(0, MAX_PDF_CHARS);

                pending.push({
                    docId: doc.id,
                    companyName: data.name,
                    companyCode: data.companyCode,
                    quarter: c.quarter,
                    industryLink,
                    industryPrompt,
                    pdfText,
                    link: pdfSource,
                    pptLink: c.pptLink || null,
                    recLink: c.recLink || null,
                });
                process.stderr.write(`✅ Fetched ${data.name} ${c.quarter} (${pdfText.length} chars)\n`);
            } catch (err) {
                process.stderr.write(`⚠️  Failed to fetch ${data.name} ${c.quarter}: ${err.message}\n`);
            }
        }
    }

    process.stdout.write(JSON.stringify(pending, null, 2));
    process.exit(0);
}

run().catch(err => { process.stderr.write('❌ ' + err.message + '\n'); process.exit(1); });
