/**
 * Adds a verbatim-quotes instruction to all industry prompts that don't already have it.
 * Run: node update-prompts-verbatim.js [--dry-run]
 */
require('dotenv').config();
const FirebaseService = require('./src/services/FirebaseService');

const VERBATIM_INSTRUCTION = `
**Verbatim Evidence (CRITICAL):** For every key management statement, guidance figure, or important claim in your analysis, include the **exact verbatim quote** from the transcript in *italics* inside double quotes — e.g. *"We expect revenue to grow 15-20% in FY26."* — followed by the speaker's name/designation if identifiable (e.g. — *CFO*). This applies to all sections, but is especially critical for the Guidance & Targets section. Do NOT paraphrase management statements. Quote them directly from the source transcript.`;

const MARKER = 'Verbatim Evidence (CRITICAL)';

async function run() {
    const dryRun = process.argv.includes('--dry-run');
    if (dryRun) console.log('🔍 DRY RUN — no writes\n');

    const fb = new FirebaseService();
    fb.initializeFirebase();
    const ok = await fb.testConnection();
    if (!ok) { console.error('❌ Firestore connection failed'); process.exit(1); }

    const snap = await fb.db.collection('industryPrompts').get();
    console.log(`📋 Found ${snap.size} industry prompts\n`);

    let updated = 0, skipped = 0, errors = 0;

    for (const doc of snap.docs) {
        const data = doc.data();
        const original = data.analystPrompt;
        if (!original || typeof original !== 'string') { skipped++; continue; }

        if (original.includes(MARKER)) {
            console.log(`⏭️  Already has verbatim instruction: ${data.link}`);
            skipped++;
            continue;
        }

        const updated_prompt = original + '\n' + VERBATIM_INSTRUCTION;

        try {
            if (!dryRun) {
                await doc.ref.update({ analystPrompt: updated_prompt });
            }
            console.log(`✅ ${dryRun ? '[DRY] ' : ''}Updated: ${data.link}`);
            updated++;
        } catch (err) {
            console.error(`❌ Error on ${data.link}: ${err.message}`);
            errors++;
        }
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Updated:  ${updated}`);
    console.log(`   Skipped:  ${skipped}`);
    console.log(`   Errors:   ${errors}`);
    process.exit(0);
}

run().catch(err => { console.error('❌', err.message); process.exit(1); });
