const express = require('express');
const router = express.Router();
const ConferenceCallNotes = require('./src/ConferenceCallNotes');
const DocumentCleaner = require('./src/modules/DocumentCleaner');
const GuidanceTracker = require('./src/modules/GuidanceTracker');

class MainProcessor extends ConferenceCallNotes {
    constructor() {
        super();
        this.documentCleaner = new DocumentCleaner(this.firebaseService);
        this.guidanceTracker = new GuidanceTracker(this.firebaseService, this.claudeService);
    }
}

// Company search endpoint with clean response structure
router.post('/company/search', async (req, res) => {
    try {
        const { q: searchTerm } = req.body;

        if (!searchTerm || searchTerm.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: "Search term is required",
                timestamp: new Date().toISOString()
            });
        }

        // Create processor instance to access Firebase
        const processor = new MainProcessor();

        // Search for companies in Firebase
        const snapshot = await processor.firebaseService.getAllDocuments();

        if (snapshot.empty) {
            return res.json({
                success: true,
                message: "Company search completed successfully",
                companies: [],
                count: 0,
                searchTerm: searchTerm.toLowerCase(),
                timestamp: new Date().toISOString()
            });
        }

        // Filter companies based on search term
        const searchResults = [];
        const searchLower = searchTerm.toLowerCase();

        snapshot.docs.forEach(doc => {
            const data = doc.data();
            const name = data.name || '';
            const companyCode = data.companyCode || '';
            const nseCode = data.nseCode || '';
            const bseCode = data.bseCode || '';

            // Search in name, company code, NSE code, or BSE code
            if (name.toLowerCase().includes(searchLower) ||
                companyCode.toLowerCase().includes(searchLower) ||
                nseCode.toLowerCase().includes(searchLower) ||
                bseCode.toLowerCase().includes(searchLower)) {

                searchResults.push({
                    name: name,
                    companyCode: companyCode,
                    nseCode: nseCode,
                    bseCode: bseCode
                });
            }
        });

        // Clean response structure - NO nested data field
        res.json({
            success: true,
            message: "Company search completed successfully",
            companies: searchResults,
            count: searchResults.length,
            searchTerm: searchTerm.toLowerCase(),
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Company search error:', error.message);
        res.status(500).json({
            success: false,
            message: "Internal server error during company search",
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * POST /api/tracker/generate/:companyCode
 * Trigger guidance tracker generation for a single company.
 * - Generates a tracker if none exists yet.
 * - Regenerates if new concall summaries were added since the last run.
 * - Returns immediately with { queued: true } and runs in the background,
 *   so the caller never waits for the (potentially long) Claude API call.
 *
 * Query param: ?force=true  → force regeneration even if tracker is current.
 */
router.post('/tracker/generate/:companyCode', async (req, res) => {
    const { companyCode } = req.params;
    const force = req.query.force === 'true';

    if (!companyCode || !companyCode.trim()) {
        return res.status(400).json({
            success: false,
            message: 'companyCode is required',
            timestamp: new Date().toISOString(),
        });
    }

    // Respond immediately so the client isn't blocked
    res.json({
        success: true,
        message: `Guidance tracker generation queued for company ${companyCode}`,
        companyCode,
        force,
        timestamp: new Date().toISOString(),
    });

    // Run tracker generation in the background after responding
    try {
        const processor = new MainProcessor();
        const generated = await processor.guidanceTracker.generateGuidanceTracker(companyCode, force);
        console.log(`✅ [tracker-api] ${companyCode}: ${generated ? 'tracker generated/updated' : 'no update needed'}`);
    } catch (error) {
        console.error(`❌ [tracker-api] ${companyCode}:`, error.message);
    }
});

/**
 * POST /api/tracker/backfill
 * Generates guidance trackers for ALL companies that have processed concalls
 * but no tracker yet. Safe to call repeatedly — already-tracked companies are skipped.
 */
router.post('/tracker/backfill', async (req, res) => {
    // Respond immediately
    res.json({
        success: true,
        message: 'Guidance tracker backfill started. Check server logs for progress.',
        timestamp: new Date().toISOString(),
    });

    try {
        const processor = new MainProcessor();
        const snapshot = await processor.firebaseService.getAllDocuments();
        if (snapshot.empty) {
            console.log('[tracker-backfill] No documents found');
            return;
        }

        const needsTracker = new Set();
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            if (!data.companyCode) return;
            const hasProcessed = (data?.documents?.['Concalls'] || [])
                .some(c => c.markdownOutput && c.markdownOutput.trim().length > 0);
            if (!hasProcessed) return;
            const hasTracker = data?.tracker?.guidance_tracker?.length > 0;
            if (!hasTracker) needsTracker.add(data.companyCode);
        });

        console.log(`[tracker-backfill] ${needsTracker.size} companies need a tracker`);

        for (const companyCode of needsTracker) {
            try {
                await processor.guidanceTracker.generateGuidanceTracker(companyCode);
                await new Promise(r => setTimeout(r, 1000));
            } catch (err) {
                console.error(`[tracker-backfill] Error for ${companyCode}:`, err.message);
            }
        }
        console.log('[tracker-backfill] Done');
    } catch (error) {
        console.error('[tracker-backfill] Fatal error:', error.message);
    }
});

module.exports = router;