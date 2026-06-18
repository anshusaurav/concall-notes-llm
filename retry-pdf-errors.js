/**
 * Finds all unprocessed concalls with non-Claude/Gemini processingErrors,
 * clears those errors, and immediately reprocesses them.
 *
 * Safe to run alongside run-by-year.js — uses fresh Firestore reads per company.
 *
 * Run:       node retry-pdf-errors.js
 * Dry run:   node retry-pdf-errors.js --dry-run
 */
require('dotenv').config();

process.on('unhandledRejection', (r) =>
    console.error('⚠️  Unhandled rejection:', r?.message || r)
);

const FirebaseService     = require('./src/services/FirebaseService');
const ConferenceCallNotes = require('./src/ConferenceCallNotes');

const CONCURRENCY = 3;

function yearFromQuarter(q) {
    if (!q) return 0;
    const m = q.match(/(\d{4})/);
    if (m) return parseInt(m[1]);
    const fy = q.match(/FY(\d{2})/i);
    if (fy) return 2000 + parseInt(fy[1]);
    return 0;
}

function isFixableError(err) {
    if (!err) return false;
    // Skip only permanent "no data" errors — PDF doesn't exist or no link at all
    if (err.includes('No PDF link available')) return false;
    if (err.includes('NoPDF') || err.includes('No PDF found')) return false;
    // Everything else (incl. Claude/Gemini 401s, timeouts, PDF parse errors) is transient — retry
    return true;
}

async function runPool(tasks, concurrency) {
    let i = 0, running = 0, done = 0;
    const total = tasks.length;
    return new Promise((resolve, reject) => {
        function next() {
            while (running < concurrency && i < total) {
                const task = tasks[i++];
                running++;
                task()
                    .then(() => { running--; done++; next(); })
                    .catch(err => { running--; done++; console.error('❌ task error:', err.message); next(); });
            }
            if (done === total) resolve();
        }
        next();
    });
}

async function processCompany(notes, docId, name, dryRun, idx, total) {
    const snap = await notes.firebaseService.getDocumentsByCompanyCode(
        // re-fetch by doc id directly
        null
    );
    // Fetch fresh doc by ID
    const freshRef = notes.firebaseService.db
        .collection(notes.firebaseService.collectionName)
        .doc(docId);
    const freshSnap = await freshRef.get();
    if (!freshSnap.exists) { console.log(`[${idx}/${total}] ⚠️  ${name} — doc gone`); return; }

    const data     = freshSnap.data();
    const concalls = data?.documents?.Concalls || [];

    const toFix = concalls.filter(c => !c.isProcessed && isFixableError(c.processingError));
    if (toFix.length === 0) { console.log(`[${idx}/${total}] ⏭  ${name} — already clear`); return; }

    console.log(`[${idx}/${total}] 🔧 ${name} — clearing ${toFix.length} error(s):`);
    toFix.forEach(c => console.log(`     ${c.quarter}: ${c.processingError}`));

    if (dryRun) { console.log(`   [DRY RUN — skipping write]`); return; }

    // Clear errors
    const cleared = concalls.map(c => {
        if (!c.isProcessed && isFixableError(c.processingError)) {
            const { processingError, ...rest } = c;
            return rest;
        }
        return c;
    });

    const ilink = data.industryLink || '';
    const industryPrompt = notes.industryPromptsMap.get(ilink);
    if (!industryPrompt) {
        console.log(`[${idx}/${total}] ⚠️  ${name} — no industry prompt, clearing errors only`);
        await freshRef.update({ 'documents.Concalls': cleared });
        return;
    }

    // Sort newest first
    const sorted = [...cleared].sort((a, b) => {
        const ya = yearFromQuarter(a.quarter), yb = yearFromQuarter(b.quarter);
        return yb - ya || (b.quarter || '').localeCompare(a.quarter || '');
    });

    const { updatedConCalls, hasChanges } = await notes.processConferenceCalls(sorted, industryPrompt);

    if (hasChanges) {
        await notes.firebaseService.updateDocumentInFirestore(freshSnap.id, updatedConCalls);
        console.log(`[${idx}/${total}] ✅ ${name} — saved`);
    } else {
        console.log(`[${idx}/${total}] ⏭  ${name} — no changes after retry`);
    }
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    if (dryRun) console.log('🔍 DRY RUN — no writes\n');

    const notes = new ConferenceCallNotes();
    notes.standardizeGuidanceTable = async (md) => md;

    const ok = await notes.testConnection();
    if (!ok) { console.error('❌ Firestore connection failed'); process.exit(1); }

    console.log('📚 Loading industry prompts...');
    await notes.readIndustryPrompts();

    console.log('📄 Fetching all documents...');
    const snapshot = await notes.firebaseService.getAllDocuments();
    console.log(`✅ Loaded ${snapshot.size} company documents\n`);

    // Find companies with fixable errors
    const queue = [];
    snapshot.docs.forEach(doc => {
        const data    = doc.data();
        const concalls = data?.documents?.Concalls || [];
        const fixable  = concalls.filter(c => !c.isProcessed && isFixableError(c.processingError));
        if (fixable.length === 0) return;
        const maxYear  = Math.max(...fixable.map(c => yearFromQuarter(c.quarter)));
        queue.push({ docId: doc.id, name: data.name || doc.id, maxYear, count: fixable.length });
    });

    queue.sort((a, b) => b.maxYear - a.maxYear || b.count - a.count);

    console.log(`🗂  ${queue.length} companies have fixable PDF errors`);
    if (queue.length === 0) { console.log('Nothing to do.'); process.exit(0); }

    console.log(`   Newest year: ${queue[0]?.maxYear}  Oldest: ${queue[queue.length-1]?.maxYear}`);
    console.log(`   Concurrency: ${CONCURRENCY}\n`);

    const total = queue.length;
    const tasks = queue.map((entry, idx) =>
        () => processCompany(notes, entry.docId, entry.name, dryRun, idx + 1, total)
    );

    await runPool(tasks, CONCURRENCY);

    console.log('\n════════════════════════════════════════');
    console.log('  RETRY DONE');
    console.log('════════════════════════════════════════');
    process.exit(0);
}

main().catch(err => { console.error('❌ Fatal:', err.message); process.exit(1); });
