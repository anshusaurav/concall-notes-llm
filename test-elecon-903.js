require('dotenv').config();

const ConferenceCallNotes = require('./src/ConferenceCallNotes');
const DocumentCleaner = require('./src/modules/DocumentCleaner');
const GuidanceTracker = require('./src/modules/GuidanceTracker');

class MainProcessor extends ConferenceCallNotes {
    constructor() {
        super();
        this.documentCleaner = new DocumentCleaner(this.firebaseService);
        this.guidanceTracker = new GuidanceTracker(this.firebaseService, this.geminiService);
    }

    async generateGuidanceTracker(companyCode, forceRegenerate = false) {
        return this.guidanceTracker.generateGuidanceTracker(companyCode, forceRegenerate);
    }
}

async function testEleconEngineering() {
    const processor = new MainProcessor();
    const companyCode = "903"; // Elecon Engineering

    try {
        console.log('🔍 Testing Elecon Engineering (Code: 903) - Guidance Tracker Generation\n');
        console.log('=' .repeat(80));

        // Test Firebase connection
        const isConnected = await processor.testConnection();
        if (!isConnected) {
            console.error('❌ Cannot proceed without Firestore connection');
            process.exit(1);
        }

        // Fetch BEFORE data
        console.log('\n📋 Step 1: Fetching CURRENT state (BEFORE)...\n');
        const beforeSnapshot = await processor.firebaseService.getDocumentsByCompanyCode(companyCode);

        if (beforeSnapshot.empty) {
            console.log('❌ Company code 903 not found in database');
            process.exit(1);
        }

        const beforeDoc = beforeSnapshot.docs[0];
        const beforeData = beforeDoc.data();

        console.log(`✅ Company: ${beforeData.name}`);
        console.log(`   BSE Code: ${beforeData.bseCode || 'N/A'}`);
        console.log(`   NSE Code: ${beforeData.nseCode || 'N/A'}`);

        // Check concalls
        const concalls = beforeData.documents?.Concalls || [];
        const processedConcalls = concalls.filter(c => c.markdownOutput && c.markdownOutput.trim().length > 0);

        console.log(`\n📞 Conference Calls:`);
        console.log(`   Total: ${concalls.length}`);
        console.log(`   Processed (with markdown): ${processedConcalls.length}`);

        if (processedConcalls.length > 0) {
            console.log(`   Quarters: [${processedConcalls.slice(0, 16).map(c => c.quarter || 'N/A').join(', ')}]`);

            // Show processing dates
            console.log(`\n   Processing Dates:`);
            processedConcalls.slice(0, 5).forEach((c, i) => {
                console.log(`      ${i + 1}. ${c.quarter || 'N/A'}: ${c.processingDate || 'No date'}`);
            });
        }

        // Check BEFORE tracker state
        console.log('\n📊 CURRENT Tracker State (BEFORE):');
        console.log('─'.repeat(80));

        const beforeTrackerArray = beforeData.tracker?.guidance_tracker || beforeData.tracker?.guidanceTracker;
        if (beforeTrackerArray && beforeTrackerArray.length > 0) {
            console.log(`✅ EXISTING TRACKER FOUND`);
            console.log(`   Total Items: ${beforeTrackerArray.length}`);
            console.log(`   Generated At: ${beforeData.trackerGeneratedAt || beforeData.tracker?.trackerGeneratedAt || 'Unknown'}`);

            console.log(`\n   First 3 Commitments:`);
            beforeTrackerArray.slice(0, 3).forEach((item, i) => {
                console.log(`   ${i + 1}. Metric: ${item.metric || 'N/A'}`);
                console.log(`      Origin: ${item.origin_period || 'N/A'}`);
                console.log(`      Status: ${item.final_status || 'N/A'}`);
                console.log(`      Updates: ${item.historical_tracker_and_evolution?.length || 0} period(s)`);
                console.log('');
            });
        } else {
            console.log(`❌ NO EXISTING TRACKER`);
        }

        // Run the new tracker generation logic
        console.log('\n' + '='.repeat(80));
        console.log('\n🚀 Step 2: Running Tracker Generation with NEW LOGIC...\n');
        console.log('='.repeat(80) + '\n');

        const success = await processor.generateGuidanceTracker(companyCode);

        // Wait for Firestore to propagate
        console.log('\n⏳ Waiting 2 seconds for Firestore to propagate...');
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Fetch AFTER data
        console.log('\n' + '='.repeat(80));
        console.log('\n📊 Step 3: Checking NEW state (AFTER)...\n');
        console.log('─'.repeat(80));

        const afterSnapshot = await processor.firebaseService.getDocumentsByCompanyCode(companyCode);

        if (!afterSnapshot.empty) {
            const afterDoc = afterSnapshot.docs[0];
            const afterData = afterDoc.data();

            const afterTrackerArray = afterData.tracker?.guidance_tracker || afterData.tracker?.guidanceTracker;
            if (afterTrackerArray && afterTrackerArray.length > 0) {
                console.log(`✅ TRACKER STATUS: ${success ? 'UPDATED/CREATED' : 'UNCHANGED'}`);
                console.log(`   Total Items: ${afterTrackerArray.length}`);
                console.log(`   Generated At: ${afterData.trackerGeneratedAt || 'Just now'}`);

                console.log(`\n   First 5 Commitments:`);
                afterTrackerArray.slice(0, 5).forEach((item, i) => {
                    console.log(`   ${i + 1}. Metric: ${item.metric || 'N/A'}`);
                    console.log(`      Target: ${item.original_target || 'N/A'}`);
                    console.log(`      Origin: ${item.origin_period || 'N/A'}`);
                    console.log(`      Status: ${item.final_status || 'N/A'}`);
                    console.log(`      Updates: ${item.historical_tracker_and_evolution?.length || 0} period(s)`);
                    console.log('');
                });

                // Show comparison
                console.log('─'.repeat(80));
                console.log('\n📈 COMPARISON:');
                const beforeCount = beforeTrackerArray?.length || 0;
                const afterCount = afterTrackerArray.length;

                console.log(`   Before: ${beforeCount} items`);
                console.log(`   After:  ${afterCount} items`);
                console.log(`   Change: ${afterCount - beforeCount > 0 ? '+' : ''}${afterCount - beforeCount} items`);

                if (success) {
                    console.log(`\n   ✅ Tracker was ${beforeCount === 0 ? 'CREATED' : 'REGENERATED'}`);
                } else {
                    console.log(`\n   ⏭️  Tracker was SKIPPED (no new concalls)`);
                }
            } else {
                console.log(`❌ No tracker found after generation`);
            }
        }

        console.log('\n' + '='.repeat(80));
        console.log('\n✅ Test completed!\n');

    } catch (error) {
        console.error('\n❌ Error during test:', error.message);
        console.error(error.stack);
    } finally {
        process.exit(0);
    }
}

// Run the test
testEleconEngineering().catch(console.error);