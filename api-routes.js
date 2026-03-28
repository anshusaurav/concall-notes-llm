const express = require('express');
const router = express.Router();
const ConferenceCallNotes = require('./src/ConferenceCallNotes');
const DocumentCleaner = require('./src/modules/DocumentCleaner');
const GuidanceTracker = require('./src/modules/GuidanceTracker');

class MainProcessor extends ConferenceCallNotes {
    constructor() {
        super();
        this.documentCleaner = new DocumentCleaner(this.firebaseService);
        this.guidanceTracker = new GuidanceTracker(this.firebaseService, this.geminiService);
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

module.exports = router;