/**
 * Clears the processingError on Laurus Labs Jan2026 concall and reprocesses it.
 * Run: node fix-laurus-jan2026.js
 */
require('dotenv').config();

const FirebaseService     = require('./src/services/FirebaseService');
const ConferenceCallNotes = require('./src/ConferenceCallNotes');

async function main() {
    const notes = new ConferenceCallNotes();
    notes.standardizeGuidanceTable = async (md) => md;

    const ok = await notes.testConnection();
    if (!ok) { console.error('❌ Firestore connection failed'); process.exit(1); }

    await notes.readIndustryPrompts();

    // Try numeric code first, then string form
    let snap = await notes.firebaseService.getDocumentsByCompanyCode(1273603);
    if (snap.empty) snap = await notes.firebaseService.getDocumentsByCompanyCode('1273603');
    // Fallback: search by name
    if (snap.empty) {
        const all = await notes.firebaseService.getAllDocuments();
        const match = all.docs.filter(d => (d.data().name || '').toLowerCase().includes('laurus'));
        if (match.length === 0) { console.error('❌ Laurus Labs not found by code or name'); process.exit(1); }
        snap = { empty: false, docs: match };
        console.log(`Found by name: ${match.map(d => d.data().name).join(', ')}`);
    }

    const doc  = snap.docs[0];
    const data = doc.data();
    const concalls = data?.documents?.Concalls || [];

    console.log(`Found ${concalls.length} concalls for ${data.name}`);

    // Find Jan2026 entries that have processingError but are not processed
    const targets = concalls.filter(c =>
        !c.isProcessed &&
        c.processingError &&
        !c.processingError.includes('Gemini') &&
        !c.processingError.includes('Claude') &&
        !c.processingError.includes('No PDF link available')
    );

    console.log(`Found ${targets.length} skipped concall(s) with fixable errors:`);
    targets.forEach(c => console.log(`  ${c.quarter} — ${c.processingError} — link: ${c.link}`));

    if (targets.length === 0) {
        console.log('Nothing to fix.');
        process.exit(0);
    }

    // Clear processingError so the processor will attempt them
    const cleared = concalls.map(c => {
        if (targets.includes(c)) {
            const { processingError, ...rest } = c;
            console.log(`  Clearing error for ${c.quarter}`);
            return rest;
        }
        return c;
    });

    // Reprocess with cleared errors
    const industryLink = data.industryLink || '';
    const industryPrompt = notes.industryPromptsMap.get(industryLink);
    if (!industryPrompt) {
        console.error(`❌ No industry prompt for ${industryLink}`);
        process.exit(1);
    }

    console.log('\nReprocessing...');
    const { updatedConCalls, hasChanges } = await notes.processConferenceCalls(cleared, industryPrompt);

    if (hasChanges) {
        await notes.firebaseService.updateDocumentInFirestore(doc.id, updatedConCalls);
        console.log('✅ Laurus Labs updated in Firestore');
    } else {
        console.log('⏭  No changes (may have failed again)');
    }

    process.exit(0);
}

main().catch(err => { console.error('❌ Fatal:', err.message); process.exit(1); });
