/**
 * Standalone script: generate guidance trackers ONLY.
 * Skips all Firestore merging and concall processing so we hit Claude
 * within seconds — before the OAuth token can expire.
 */
require('dotenv').config();

process.on('unhandledRejection', (reason) => {
    console.error('⚠️  Unhandled rejection (non-fatal):', reason?.message || reason);
});

const FirebaseService = require('./src/services/FirebaseService');
const ClaudeService = require('./src/services/ClaudeService');
const GuidanceTracker = require('./src/modules/GuidanceTracker');

async function main() {
    const firebaseService = new FirebaseService();
    const claudeService = new ClaudeService();
    const guidanceTracker = new GuidanceTracker(firebaseService, claudeService);

    firebaseService.initializeFirebase();

    console.log('🔑 API Key Status:', claudeService.getKeyStatus ? claudeService.getKeyStatus() : 'N/A');

    // Test connection
    const ok = await firebaseService.testConnection();
    if (!ok) {
        console.error('❌ Cannot connect to Firestore');
        process.exit(1);
    }

    console.log('\n🔍 Scanning for companies with processed concalls but no guidance tracker...');

    const snapshot = await firebaseService.getAllDocuments();
    if (snapshot.empty) {
        console.log('📭 No documents found');
        return;
    }

    const needsTracker = new Set();
    snapshot.docs.forEach(doc => {
        const data = doc.data();
        const companyCode = data.companyCode;
        if (!companyCode) return;

        const concalls = data?.documents?.['Concalls'] || [];
        const hasProcessed = concalls.some(c => c.markdownOutput && c.markdownOutput.trim().length > 0);
        if (!hasProcessed) return;

        // Check both field name variants (guidance_tracker and guidanceTracker)
        const hasTracker =
            (data?.tracker?.guidance_tracker && Array.isArray(data.tracker.guidance_tracker) && data.tracker.guidance_tracker.length > 0) ||
            (data?.tracker?.guidanceTracker  && Array.isArray(data.tracker.guidanceTracker)  && data.tracker.guidanceTracker.length  > 0);
        if (hasTracker) return;

        needsTracker.add(companyCode);
    });

    const total = needsTracker.size;
    console.log(`📋 Found ${total} companies needing a tracker.\n`);

    if (total === 0) {
        console.log('✅ All companies already have guidance trackers.');
        return;
    }

    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;
    let index = 0;

    for (const companyCode of needsTracker) {
        index++;
        console.log(`\n[${index}/${total}] 🏢 ${companyCode}`);
        try {
            const generated = await guidanceTracker.generateGuidanceTracker(companyCode);
            if (generated) {
                successCount++;
                console.log(`✅ Tracker saved for ${companyCode}`);
            } else {
                skipCount++;
                console.log(`⏭️  Skipped ${companyCode} (no eligible concalls)`);
            }
            // Delay between companies to stay within OAuth rate limits
            await new Promise(r => setTimeout(r, 3000));
        } catch (err) {
            errorCount++;
            console.error(`❌ Error for ${companyCode}:`, err.message);
        }
    }

    console.log('\n📊 Tracker generation summary:');
    console.log(`   ✅ Generated: ${successCount}`);
    console.log(`   ⏭️  Skipped:   ${skipCount}`);
    console.log(`   ❌ Errors:    ${errorCount}`);
    console.log(`   📋 Total:     ${total}`);
}

main().catch(console.error);
