/**
 * Processes unprocessed concall transcripts in year-priority order:
 *   2026 → 2025 → 2024 → older
 *
 * Optimisations vs. the default pipeline:
 *  - Processes CONCURRENCY companies in parallel (default 3)
 *  - Skips guidance-table standardisation (extra Claude call per concall)
 *  - No per-company tracker generation (run run-trackers-only.js after)
 *
 * Run:   node run-by-year.js
 * Resume: idempotent — already-processed calls are skipped.
 */
require('dotenv').config();

process.on('unhandledRejection', (r) =>
    console.error('⚠️  Unhandled rejection:', r?.message || r)
);

const FirebaseService     = require('./src/services/FirebaseService');
const ConferenceCallNotes = require('./src/ConferenceCallNotes');

const CONCURRENCY = 3;   // companies processed in parallel

// ── Year extraction ───────────────────────────────────────────────────────────
function yearFromQuarter(q) {
    if (!q) return 0;
    const m = q.match(/(\d{4})/);           // "Mar 2025", "Jun 2024"
    if (m) return parseInt(m[1]);
    const fy = q.match(/FY(\d{2})/i);       // "Q4FY26"
    if (fy) return 2000 + parseInt(fy[1]);
    return 0;
}

// ── Process one company ───────────────────────────────────────────────────────
async function processCompany(notes, entry, idx, total) {
    const { doc, maxYear } = entry;
    const data  = doc.data();
    const name  = data.name || doc.id;
    const code  = data.companyCode;
    const ilink = data.industryLink || '';

    const industryPrompt = notes.industryPromptsMap.get(ilink);
    if (!industryPrompt) {
        console.log(`[${idx}/${total}] ⚠️  ${name} — no industry prompt, skip`);
        return;
    }

    // Fresh read so we don't race with another worker
    const freshSnap = await notes.firebaseService.getDocumentsByCompanyCode(code);
    if (freshSnap.empty) {
        console.log(`[${idx}/${total}] ⚠️  ${name} — doc not found`);
        return;
    }

    const freshDoc  = freshSnap.docs[0];
    const freshData = freshDoc.data();
    const concalls  = freshData?.documents?.Concalls || [];

    // Sort newest-year first within the company
    const sorted = [...concalls].sort((a, b) => {
        const ya = yearFromQuarter(a.quarter);
        const yb = yearFromQuarter(b.quarter);
        return yb - ya || (b.quarter || '').localeCompare(a.quarter || '');
    });

    console.log(`[${idx}/${total}] ▶  ${name} (${code}) year:${maxYear} calls:${sorted.length}`);

    const { updatedConCalls, hasChanges } = await notes.processConferenceCalls(sorted, industryPrompt);

    if (hasChanges) {
        await notes.firebaseService.updateDocumentInFirestore(freshDoc.id, updatedConCalls);
        console.log(`[${idx}/${total}] ✅ ${name} — saved`);
    } else {
        console.log(`[${idx}/${total}] ⏭  ${name} — no changes`);
    }
}

// ── Run a pool of N concurrent promises ──────────────────────────────────────
async function runPool(tasks, concurrency) {
    let i = 0;
    let running = 0;
    let done = 0;
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

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    const notes = new ConferenceCallNotes();

    // Patch out guidance-table standardisation — saves ~1 extra Claude call per concall
    notes.standardizeGuidanceTable = async (md) => md;

    const ok = await notes.testConnection();
    if (!ok) { console.error('❌ Firestore connection failed'); process.exit(1); }

    console.log('📚 Loading industry prompts...');
    await notes.readIndustryPrompts();

    console.log('📄 Fetching all documents...');
    const snapshot = await notes.firebaseService.getAllDocuments();
    console.log(`✅ Loaded ${snapshot.size} company documents\n`);

    // Build sorted queue
    const queue = [];
    snapshot.docs.forEach(doc => {
        const data = doc.data();
        const concalls = data?.documents?.Concalls || [];
        const unprocessed = concalls.filter(c =>
            c.link &&
            !c.isProcessed &&
            !(c.processingError &&
              !c.processingError.includes('Gemini') &&
              !c.processingError.includes('Claude') &&
              !c.processingError.includes('No PDF link available'))
        );
        if (unprocessed.length === 0) return;
        const maxYear = Math.max(...unprocessed.map(c => yearFromQuarter(c.quarter)));
        queue.push({ doc, maxYear, count: unprocessed.length });
    });

    queue.sort((a, b) => b.maxYear - a.maxYear || b.count - a.count);

    console.log(`🗂  ${queue.length} companies have unprocessed concalls`);
    console.log(`   Newest: ${queue[0]?.maxYear}  Oldest: ${queue[queue.length - 1]?.maxYear}`);
    console.log(`   Concurrency: ${CONCURRENCY} companies at once\n`);

    const total = queue.length;
    const tasks = queue.map((entry, idx) =>
        () => processCompany(notes, entry, idx + 1, total)
    );

    await runPool(tasks, CONCURRENCY);

    console.log('\n════════════════════════════════════════');
    console.log('  ALL SUMMARIES DONE');
    console.log('  Run: node run-trackers-only.js   ← update trackers');
    console.log('════════════════════════════════════════');
    process.exit(0);
}

main().catch(err => { console.error('❌ Fatal:', err.message); process.exit(1); });
