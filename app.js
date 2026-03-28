const express = require('express');
require('dotenv').config();

const ConferenceCallNotes = require('./src/ConferenceCallNotes');
const DocumentCleaner = require('./src/modules/DocumentCleaner');
const GuidanceTracker = require('./src/modules/GuidanceTracker');
const { fetchPDF, readPDF, readPDFFirstTwoPages } = require('./src/utils/pdfUtils');
const { ANNOUNCEMENT_CALENDAR_PROMPT, GUIDANCE_TABLE_PROMPT } = require('./src/config/prompts');
const fs = require('fs');

const app = express();

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// API Routes
const apiRoutes = require('./api-routes');
app.use('/api', apiRoutes);

// MongoDB setup for data migration
const { MongoClient, ServerApiVersion } = require('mongodb');

// MongoDB configuration from environment variables
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DATABASE = process.env.MONGODB_DATABASE || 'conference_calls';
const MONGODB_COLLECTION = process.env.MONGODB_COLLECTION || 'companies';
const MONGODB_CONNECT_TIMEOUT = parseInt(process.env.MONGODB_CONNECT_TIMEOUT) || 30000;
const MONGODB_SOCKET_TIMEOUT = parseInt(process.env.MONGODB_SOCKET_TIMEOUT) || 30000;
const MONGODB_SERVER_SELECTION_TIMEOUT = parseInt(process.env.MONGODB_SERVER_SELECTION_TIMEOUT) || 30000;

if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI environment variable is required');
    process.exit(1);
}

// Create a MongoClient with proper timeout settings from environment
const client = new MongoClient(MONGODB_URI, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
    connectTimeoutMS: MONGODB_CONNECT_TIMEOUT,
    socketTimeoutMS: MONGODB_SOCKET_TIMEOUT,
    serverSelectionTimeoutMS: MONGODB_SERVER_SELECTION_TIMEOUT,
});

async function testMongoConnection() {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await client.connect();

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("✅ Successfully connected to MongoDB!");

        return client; // Return the connected client for use in migrations
    } catch (error) {
        console.error('❌ MongoDB connection failed:', error.message);
        throw error;
    }
}

class MainProcessor extends ConferenceCallNotes {
    constructor() {
        super();
        this.documentCleaner = new DocumentCleaner(this.firebaseService);
        this.guidanceTracker = new GuidanceTracker(this.firebaseService, this.geminiService);
        this.mongoClient = null;
        this.mongoDb = null;
        this.mongoCollection = null;
    }

    // MongoDB Connection Management
    async initializeMongoConnection() {
        if (this.mongoClient) {
            console.log('🔄 MongoDB connection already exists, reusing...');
            return this.mongoClient;
        }

        try {
            console.log('🔌 Initializing MongoDB connection...');
            this.mongoClient = await testMongoConnection();
            this.mongoDb = this.mongoClient.db(MONGODB_DATABASE);
            this.mongoCollection = this.mongoDb.collection(MONGODB_COLLECTION);
            console.log(`✅ MongoDB initialized - Database: ${MONGODB_DATABASE}, Collection: ${MONGODB_COLLECTION}`);
            return this.mongoClient;
        } catch (error) {
            console.error('❌ Failed to initialize MongoDB connection:', error.message);
            throw error;
        }
    }

    async closeMongoConnection() {
        if (this.mongoClient) {
            try {
                await this.mongoClient.close();
                console.log('🔌 MongoDB connection closed');
                this.mongoClient = null;
                this.mongoDb = null;
                this.mongoCollection = null;
            } catch (error) {
                console.error('❌ Error closing MongoDB connection:', error.message);
            }
        }
    }

    async ensureMongoConnection() {
        if (!this.mongoClient) {
            await this.initializeMongoConnection();
        }
        return this.mongoCollection;
    }

    async cleanDuplicateDocuments() {
        return this.documentCleaner.cleanDuplicateDocuments();
    }

    async cleanDuplicateRawDocuments() {
        return this.documentCleaner.cleanDuplicateUsingRawDocuments();
    }

    /**
     * Merge duplicate concalls within a single company's document based on quarter
     * @param {string} companyCode - The company code to process
     * @returns {Promise<boolean>} - True if updates were made, false otherwise
     */
    async mergeDuplicateConcallsForCompany(companyCode) {
        try {
            console.log(`\n🔍 Checking for duplicate concalls in company: ${companyCode}`);

            const snapshot = await this.firebaseService.getDocumentsByCompanyCode(companyCode);

            if (snapshot.empty) {
                console.log(`📭 No document found for company code: ${companyCode}`);
                return false;
            }

            const doc = snapshot.docs[0];
            const docData = doc.data();
            const concalls = docData?.documents?.['Concalls'] || [];

            if (concalls.length === 0) {
                console.log('📭 No concalls found in this document');
                return false;
            }

            console.log(`📞 Found ${concalls.length} concalls. Checking for duplicates...`);

            // Helper function to create a unique key based on quarter
            const createConcallKey = (concall) => {
                if (concall.quarter) {
                    return `quarter:${concall.quarter}`;
                }
                return `links:${concall.link || 'no-link'}_${concall.pptLink || 'no-ppt'}`;
            };

            // Merge concalls with the same quarter
            const concallsMap = new Map();

            concalls.forEach(concall => {
                const key = createConcallKey(concall);

                if (!concallsMap.has(key)) {
                    concallsMap.set(key, concall);
                } else {
                    // Merge with existing entry
                    const existing = concallsMap.get(key);
                    const merged = {
                        ...existing,
                        // Merge links - prefer non-empty values
                        link: concall.link || existing.link,
                        pptLink: concall.pptLink || existing.pptLink,
                        recLink: concall.recLink || existing.recLink,
                        // Prefer processed content
                        markdownOutput: concall.markdownOutput || existing.markdownOutput,
                        summary: concall.summary || existing.summary,
                        isProcessed: concall.isProcessed || existing.isProcessed,
                        processingDate: concall.processingDate || existing.processingDate,
                        textLength: concall.textLength || existing.textLength,
                        isGuidanceTableStandardized: concall.isGuidanceTableStandardized || existing.isGuidanceTableStandardized,
                        guidanceTableStandardizedDate: concall.guidanceTableStandardizedDate || existing.guidanceTableStandardizedDate,
                        processingError: concall.processingError || existing.processingError,
                        guidanceTableStandardizationError: concall.guidanceTableStandardizationError || existing.guidanceTableStandardizationError
                    };
                    concallsMap.set(key, merged);
                    console.log(`🔄 Merged duplicate concall for quarter: ${concall.quarter || 'N/A'}`);
                }
            });

            const mergedConcalls = Array.from(concallsMap.values());

            if (mergedConcalls.length < concalls.length) {
                console.log(`✅ Reduced from ${concalls.length} to ${mergedConcalls.length} concalls`);

                await this.firebaseService.updateDocument(doc.id, {
                    'documents.Concalls': mergedConcalls,
                    lastProcessed: new Date().toISOString()
                });

                console.log(`💾 Updated document for company ${companyCode} (${docData.name})`);
                return true;
            } else {
                console.log('✨ No duplicate concalls found');
                return false;
            }

        } catch (error) {
            console.error(`❌ Error merging concalls for ${companyCode}:`, error.message);
            throw error;
        }
    }

    /**
     * Merge duplicate concalls for all companies
     * @returns {Promise<Object>} - Summary of processed companies
     */
    async mergeDuplicateConcallsForAllCompanies() {
        try {
            console.log('🚀 Starting concall deduplication for ALL companies...');

            const snapshot = await this.firebaseService.getAllDocuments();

            if (snapshot.empty) {
                console.log('📭 No documents found in collection');
                return {
                    total: 0,
                    updatedCount: 0,
                    skippedCount: 0,
                    errorCount: 0
                };
            }

            // Get unique company codes
            const companyCodesSet = new Set();
            snapshot.docs.forEach(doc => {
                const companyCode = doc.data().companyCode;
                if (companyCode) {
                    companyCodesSet.add(companyCode);
                }
            });

            const companyCodes = Array.from(companyCodesSet);
            console.log(`📋 Found ${companyCodes.length} unique companies to process`);

            let updatedCount = 0;
            let skippedCount = 0;
            let errorCount = 0;

            for (const companyCode of companyCodes) {
                try {
                    console.log(`\n📍 Processing company ${companyCodes.indexOf(companyCode) + 1}/${companyCodes.length}: ${companyCode}`);
                    const updated = await this.mergeDuplicateConcallsForCompany(companyCode);

                    if (updated) {
                        updatedCount++;
                    } else {
                        skippedCount++;
                    }

                    // Small delay to avoid rate limiting
                    await this.delay(500);

                } catch (error) {
                    errorCount++;
                    console.error(`❌ Error processing company ${companyCode}:`, error.message);
                }
            }

            console.log('\n📊 Concall Deduplication Summary:');
            console.log(`   ✅ Updated: ${updatedCount}`);
            console.log(`   ⏭️  Skipped (no duplicates): ${skippedCount}`);
            console.log(`   ❌ Errors: ${errorCount}`);
            console.log(`   📋 Total: ${companyCodes.length}`);

            return {
                total: companyCodes.length,
                updatedCount,
                skippedCount,
                errorCount
            };

        } catch (error) {
            console.error('❌ Error in mergeDuplicateConcallsForAllCompanies:', error.message);
            throw error;
        }
    }

    async generateGuidanceTracker(companyCode, forceRegenerate = false) {
        return this.guidanceTracker.generateGuidanceTracker(companyCode, forceRegenerate);
    }

    async generateTrackersForAllCompanies() {
        return this.guidanceTracker.generateTrackersForAllCompanies();
    }

    async deleteCompanyDocuments(companyCode) {
        try {
            console.log(`🗑️  Starting deletion process for company code: ${companyCode}`);
            const result = await this.firebaseService.deleteDocumentsByCompanyCode(companyCode);

            if (result.success) {
                console.log(`✅ Deletion completed successfully`);
                console.log(`📊 Total documents deleted: ${result.deletedCount}`);
            }

            return result;
        } catch (error) {
            console.error(`❌ Error deleting documents for company ${companyCode}:`, error.message);
            throw error;
        }
    }

    async processSingleAnnouncementLocal(filePath, prompt) {
        try {
            console.log(`📄 Reading PDF from local file: ${filePath}`);

            // Check if file exists
            if (!fs.existsSync(filePath)) {
                throw new Error(`File not found: ${filePath}`);
            }

            // Read the PDF file from local machine
            const pdfBuffer = fs.readFileSync(filePath);
            console.log(`📖 PDF file read successfully, size: ${pdfBuffer.length} bytes`);

            const pdfText = await readPDFFirstTwoPages(pdfBuffer);
            console.log(`📝 Extracted ${pdfText.length} characters from first two pages of PDF`);

            if (!pdfText || pdfText.trim().length === 0) {
                throw new Error('No text content extracted from PDF');
            }

            const { parsedResponse } = await this.generateEventWithGemini(pdfText, prompt);

            console.log('📊 parsedResponse type:', typeof parsedResponse);
            console.log('📊 parsedResponse content:', parsedResponse);

            return {
                filePath: filePath,
                fileName: require('path').basename(filePath),
                parsedResponse: parsedResponse,
                isProcessed: true,
                processingDate: new Date().toISOString(),
                textLength: pdfText.length
            };

        } catch (error) {
            console.error(`❌ Error processing local announcement file:`, error.message);
            throw error;
        }
    }

    async processMultipleLocalAnnouncements() {
        // Directory containing PDF files
        const pdfDirectory = './pdfs/announcements/';

        // Read all files from the directory
        let pdfFiles = [];
        try {
            const files = fs.readdirSync(pdfDirectory);
            // Filter only PDF files and create full paths
            pdfFiles = files
                .filter(file => file.toLowerCase().endsWith('.pdf'))
                .map(file => pdfDirectory + file);
        } catch (error) {
            console.error(`❌ Failed to read directory ${pdfDirectory}:`, error.message);
            return [];
        }

        if (pdfFiles.length === 0) {
            console.log(`⚠️  No PDF files found in ${pdfDirectory}`);
            return [];
        }

        console.log(`🚀 Starting to process ${pdfFiles.length} local PDF files from ${pdfDirectory}...`);

        const results = [];
        let successCount = 0;
        let failureCount = 0;

        for (const [index, filePath] of pdfFiles.entries()) {
            try {
                console.log(`\n📄 Processing file ${index + 1}/${pdfFiles.length}: ${filePath.split('/').pop()}`);

                const result = await this.processSingleAnnouncementLocal(filePath, ANNOUNCEMENT_CALENDAR_PROMPT);
                results.push({
                    success: true,
                    filePath: filePath,
                    fileName: filePath.split('/').pop(),
                    result: result
                });

                successCount++;
                console.log(`✅ Successfully processed: ${result.fileName}`);

                // Add a small delay between files to avoid overwhelming the API
                await this.delay(1000);

            } catch (error) {
                console.error(`❌ Failed to process ${filePath.split('/').pop()}:`, error.message);
                results.push({
                    success: false,
                    filePath: filePath,
                    fileName: filePath.split('/').pop(),
                    error: error.message
                });
                failureCount++;
            }
        }

        // Summary
        console.log(`\n📊 Processing Summary:`);
        console.log(`   ✅ Successful: ${successCount}`);
        console.log(`   ❌ Failed: ${failureCount}`);
        console.log(`   📈 Total: ${pdfFiles.length}`);

        // Save results to a JSON file
        const outputPath = './local-announcements-results.json';
        try {
            fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
            console.log(`💾 Results saved to: ${outputPath}`);
        } catch (saveError) {
            console.error(`❌ Failed to save results:`, saveError.message);
        }

        return results;
    }

    async standardizeGuidanceTableWithGemini(markdownInput) {
        try {
            console.log('🤖 Reformatting guidance section into a table with Gemini...');
            const prompt = GUIDANCE_TABLE_PROMPT.replace("[PASTE FULL MARKDOWN HERE]", markdownInput);

            // Use the existing retry logic to call the API
            const updatedMarkdown = await this.geminiService.callGeminiAPIWithRetry(prompt);

            // Basic check to see if the response is valid markdown
            if (updatedMarkdown && updatedMarkdown.includes('#')) {
                console.log('✅ Successfully reformatted markdown.');
                return updatedMarkdown;
            } else {
                console.warn('⚠️ Gemini did not return valid markdown, returning original.');
                return markdownInput; // Return original if response is strange
            }
        } catch (error) {
            console.error('❌ Error generating standardized guidance table with Gemini:', error.message);
            // In case of error, return the original markdown to avoid data loss
            return markdownInput;
        }
    }

    async standardizeGuidanceTableForCompany(companyCode) {
        try {
            console.log(`\n🔍 Standardizing guidance tables for company: ${companyCode}`);
            const snapshot = await this.firebaseService.getDocumentsByCompanyCode(companyCode);

            if (snapshot.empty) {
                console.log(`📭 No document found for company code: ${companyCode}`);
                return false;
            }

            const doc = snapshot.docs[0];
            const docData = doc.data();
            const conCallList = docData?.documents?.['Concalls'] || [];
            let needsUpdate = false;

            if (conCallList.length === 0) {
                console.log('No conference calls to process.');
                return false;
            }

            console.log(`📞 Found ${conCallList.length} conference calls. Processing...`);

            const updatedConCallList = await Promise.all(conCallList.map(async (call, index) => {
                // Skip if already processed for guidance table standardization
                if (call.isGuidanceTableStandardized) {
                    console.log(`⏭️  Conference call ${index + 1} guidance table already standardized`);
                    return call;
                }

                // Process only if markdownOutput exists and seems to contain guidance info
                if (call.markdownOutput && call.markdownOutput.toLowerCase().includes('guidance')) {
                    try {
                        const originalMarkdown = call.markdownOutput;
                        const updatedMarkdown = await this.standardizeGuidanceTableWithGemini(originalMarkdown);

                        // If Gemini returned a modified version, mark for update
                        if (originalMarkdown !== updatedMarkdown) {
                            needsUpdate = true;
                            console.log(`🔄 Markdown updated for concall (Quarter: ${call.quarter || 'N/A'})`);
                            return {
                                ...call,
                                markdownOutput: updatedMarkdown,
                                isGuidanceTableStandardized: true,
                                guidanceTableStandardizedDate: new Date().toISOString()
                            };
                        } else {
                            // Even if no changes were made, mark as processed to avoid reprocessing
                            needsUpdate = true;
                            console.log(`✨ No changes needed for concall (Quarter: ${call.quarter || 'N/A'})`);
                            return {
                                ...call,
                                isGuidanceTableStandardized: true,
                                guidanceTableStandardizedDate: new Date().toISOString()
                            };
                        }
                    } catch (error) {
                        console.error(`❌ Error processing concall ${index + 1}:`, error.message);
                        return {
                            ...call,
                            isGuidanceTableStandardized: false,
                            guidanceTableStandardizationError: error.message,
                            guidanceTableStandardizedDate: new Date().toISOString()
                        };
                    }
                } else {
                    // Mark as processed even if no guidance content found
                    needsUpdate = true;
                    console.log(`⏭️  No guidance content found for concall (Quarter: ${call.quarter || 'N/A'})`);
                    return {
                        ...call,
                        isGuidanceTableStandardized: true,
                        guidanceTableStandardizedDate: new Date().toISOString(),
                        guidanceTableStandardizationNote: 'No guidance content found'
                    };
                }
            }));

            if (needsUpdate) {
                await this.firebaseService.updateDocumentInFirestore(doc.id, updatedConCallList);
                console.log(`✅ Successfully updated document ${doc.id} with standardized guidance tables.`);
                return true;
            } else {
                console.log('✨ All guidance tables already standardized for this company.');
                return false;
            }

        } catch (error) {
            console.error(`❌ Error standardizing guidance tables for ${companyCode}:`, error.message);
            return false;
        }
    }

    /**
     * Standardizes guidance tables for a list of company codes.
     * @param {string[]} companyCodes - Array of company codes to process
     * @returns {Object} Summary of processed companies
     */
    async standardizeGuidanceTablesForCompanies(companyCodes) {
        try {
            console.log(`🚀 Starting guidance table standardization for ${companyCodes.length} companies...`);

            if (!Array.isArray(companyCodes) || companyCodes.length === 0) {
                console.log('❌ Invalid input: companyCodes must be a non-empty array');
                return {
                    total: 0,
                    successCount: 0,
                    noUpdateCount: 0,
                    errorCount: 0,
                    results: []
                };
            }

            let successCount = 0;
            let noUpdateCount = 0;
            let errorCount = 0;
            const results = [];

            for (const companyCode of companyCodes) {
                try {
                    console.log(`\n📍 Processing company ${companyCodes.indexOf(companyCode) + 1}/${companyCodes.length}: ${companyCode}`);
                    const updated = await this.standardizeGuidanceTableForCompany(companyCode);

                    if (updated) {
                        successCount++;
                        results.push({ companyCode, status: 'updated', success: true });
                    } else {
                        noUpdateCount++;
                        results.push({ companyCode, status: 'no_update', success: true });
                    }

                    // Optional: add a small delay to manage API rate limits
                    await this.delay(500);
                } catch (error) {
                    errorCount++;
                    console.error(`❌ Error processing company ${companyCode}:`, error.message);
                    results.push({ companyCode, status: 'error', success: false, error: error.message });
                }
            }

            console.log('\n📊 Batch Standardization Complete:');
            console.log(`   ✅ Successfully updated: ${successCount}`);
            console.log(`   ⏭️  No updates needed: ${noUpdateCount}`);
            console.log(`   ❌ Errors: ${errorCount}`);
            console.log(`   📋 Total processed: ${companyCodes.length}`);

            return {
                total: companyCodes.length,
                successCount,
                noUpdateCount,
                errorCount,
                results
            };

        } catch (error) {
            console.error('❌ Error in batch guidance table standardization:', error.message);
            throw error;
        }
    }

    async standardizeGuidanceTablesForAllCompanies() {
        try {
            console.log('🚀 Starting guidance table standardization for ALL companies...');
            const snapshot = await this.firebaseService.getAllDocuments();

            if (snapshot.empty) {
                console.log('📭 No documents found in collection.');
                return;
            }

            const companyCodes = [...new Set(snapshot.docs.map(doc => doc.data().companyCode).filter(Boolean))];
            console.log(`📋 Found ${companyCodes.length} unique companies to process.`);

            let successCount = 0;
            let noUpdateCount = 0;

            for (const companyCode of companyCodes) {
                const updated = await this.standardizeGuidanceTableForCompany(companyCode);
                if (updated) {
                    successCount++;
                } else {
                    noUpdateCount++;
                }
                // Optional: add a small delay to manage API rate limits
                await this.delay(500);
            }

            console.log('\n📊 Standardization Complete:');
            console.log(`   ✅ Companies Updated: ${successCount}`);
        } catch (error) {
            console.error('❌ A fatal error occurred during the batch standardization process:', error.message);
        }
    }

    /**
     * Process a single annual report to generate insights
     * @param {Object} report - Annual report object with link, title, description
     * @returns {Promise<Object>} - Processed annual report with insights
     */
    async processSingleAnnualReport(report) {
        try {
            console.log(`📄 Processing annual report: ${report.title}`);
            console.log(`🔗 Fetching PDF from: ${report.link}`);

            const pdfBuffer = await fetchPDF(report.link);
            console.log(`📖 PDF fetched successfully, size: ${pdfBuffer.length} bytes`);

            const pdfText = await readPDF(pdfBuffer);
            console.log(`📝 Extracted ${pdfText.length} characters from PDF`);

            if (!pdfText || pdfText.trim().length === 0) {
                throw new Error('No text content extracted from PDF');
            }

            const { insightsMarkdown } = await this.generateInsightsWithGemini(pdfText);

            return {
                ...report,
                insightsMarkdown: insightsMarkdown,
                isProcessed: true,
                processingDate: new Date().toISOString(),
                textLength: pdfText.length
            };

        } catch (error) {
            console.error(`❌ Error processing annual report:`, error.message);
            throw error;
        }
    }

    /**
     * Process all annual reports for a specific company
     * @param {string} companyCode - The company code to process
     * @param {boolean} forceReprocess - Whether to reprocess already processed reports
     * @returns {Promise<boolean>} - True if updates were made, false otherwise
     */
    async processAnnualReportsForCompany(companyCode, forceReprocess = false) {
        try {
            console.log(`\n🏢 Processing annual reports for company: ${companyCode}`);

            const snapshot = await this.firebaseService.getDocumentsByCompanyCode(companyCode);

            if (snapshot.empty) {
                console.log(`📭 No document found for company code: ${companyCode}`);
                return false;
            }

            const doc = snapshot.docs[0];
            const docData = doc.data();
            const annualReports = docData?.documents?.['Annual reports'] || [];

            if (annualReports.length === 0) {
                console.log('📭 No annual reports found for this company');
                return false;
            }

            console.log(`📊 Found ${annualReports.length} annual reports. Processing...`);

            let needsUpdate = false;
            const updatedReports = [];

            for (const [index, report] of annualReports.entries()) {
                try {
                    console.log(`\n📑 Processing report ${index + 1}/${annualReports.length}: ${report.title}`);

                    // Skip if already processed and not forcing reprocess
                    if (report.isProcessed && !forceReprocess) {
                        console.log(`⏭️  Annual report already processed`);
                        updatedReports.push(report);
                        continue;
                    }

                    if (!report.link) {
                        console.warn(`⚠️  No link found for annual report`);
                        updatedReports.push({
                            ...report,
                            isProcessed: false,
                            processingError: 'No PDF link available'
                        });
                        continue;
                    }

                    const processedReport = await this.processSingleAnnualReport(report);
                    updatedReports.push(processedReport);
                    needsUpdate = true;

                    console.log(`✅ Successfully processed: ${report.title}`);

                    // Add delay between reports to avoid rate limiting
                    await this.delay(2000);

                } catch (error) {
                    console.error(`❌ Error processing annual report ${index + 1}:`, error.message);
                    updatedReports.push({
                        ...report,
                        isProcessed: false,
                        processingError: error.message,
                        processingDate: new Date().toISOString()
                    });
                }
            }

            if (needsUpdate) {
                await this.firebaseService.updateDocument(doc.id, {
                    'documents.Annual reports': updatedReports,
                    lastProcessed: new Date().toISOString()
                });
                console.log(`💾 Updated annual reports for company ${companyCode} (${docData.name})`);
                return true;
            } else {
                console.log('✨ All annual reports already processed');
                return false;
            }

        } catch (error) {
            console.error(`❌ Error processing annual reports for ${companyCode}:`, error.message);
            throw error;
        }
    }

    /**
     * Process annual reports for all companies
     * @returns {Promise<Object>} - Summary of processed companies
     */
    async processAnnualReportsForAllCompanies() {
        try {
            console.log('🚀 Starting annual report processing for ALL companies...');

            const snapshot = await this.firebaseService.getAllDocuments();

            if (snapshot.empty) {
                console.log('📭 No documents found in collection');
                return {
                    total: 0,
                    updatedCount: 0,
                    skippedCount: 0,
                    errorCount: 0
                };
            }

            // Get unique company codes
            const companyCodesSet = new Set();
            snapshot.docs.forEach(doc => {
                const companyCode = doc.data().companyCode;
                if (companyCode) {
                    companyCodesSet.add(companyCode);
                }
            });

            const companyCodes = Array.from(companyCodesSet);
            console.log(`📋 Found ${companyCodes.length} unique companies to process`);

            let updatedCount = 0;
            let skippedCount = 0;
            let errorCount = 0;

            for (const companyCode of companyCodes) {
                try {
                    console.log(`\n📍 Processing company ${companyCodes.indexOf(companyCode) + 1}/${companyCodes.length}: ${companyCode}`);
                    const updated = await this.processAnnualReportsForCompany(companyCode);

                    if (updated) {
                        updatedCount++;
                    } else {
                        skippedCount++;
                    }

                    // Small delay to avoid rate limiting
                    await this.delay(1000);

                } catch (error) {
                    errorCount++;
                    console.error(`❌ Error processing company ${companyCode}:`, error.message);
                }
            }

            console.log('\n📊 Annual Report Processing Summary:');
            console.log(`   ✅ Updated: ${updatedCount}`);
            console.log(`   ⏭️  Skipped (already processed): ${skippedCount}`);
            console.log(`   ❌ Errors: ${errorCount}`);
            console.log(`   📋 Total: ${companyCodes.length}`);

            return {
                total: companyCodes.length,
                updatedCount,
                skippedCount,
                errorCount
            };

        } catch (error) {
            console.error('❌ Error in processAnnualReportsForAllCompanies:', error.message);
            throw error;
        }
    }

    /**
     * Fix all companies for a given industry path by force-reprocessing their concalls.
     * Resets isProcessed on all concalls, then runs them through Gemini with the industry prompt.
     * @param {string} industryPath - e.g. "/market/IN02/IN0206/IN020601/IN020601001/"
     */
    async fixCompaniesByIndustryPath(industryPath) {
        try {
            console.log(`\n🔧 Fixing companies for industryPath: ${industryPath}`);

            // Load industry prompts
            await this.readIndustryPrompts();

            const docs = await this.firebaseService.getCompaniesByIndustryPath(industryPath);

            if (docs.length === 0) {
                console.log('📭 No companies found');
                return { total: 0, processed: 0, errors: 0 };
            }

            console.log(`📋 Found ${docs.length} companies to fix`);

            let totalProcessed = 0;
            let totalErrors = 0;
            const companiesWithChanges = new Set();

            for (const [index, doc] of docs.entries()) {
                const data = doc.data();
                console.log(`\n📍 [${index + 1}/${docs.length}] Processing: ${data.name} (${data.companyCode})`);

                try {
                    // Reset isProcessed on all concalls to force reprocessing
                    const concalls = data?.documents?.['Concalls'] || [];
                    if (concalls.length === 0) {
                        console.log('⏭️  No concalls found, skipping');
                        continue;
                    }

                    const resetConcalls = concalls.map(c => ({
                        ...c,
                        isProcessed: false,
                        summary: undefined,
                        markdownOutput: undefined,
                        processingError: undefined,
                    }));

                    // Update Firestore with reset concalls first
                    await this.firebaseService.updateDocumentInFirestore(doc.id, resetConcalls);
                    console.log(`🔄 Reset ${concalls.length} concalls for reprocessing`);

                    // Re-fetch the doc so processConcallsDocument picks up the reset state
                    const refreshedSnapshot = await this.firebaseService.getDocumentsByCompanyCode(data.companyCode);
                    const refreshedDoc = refreshedSnapshot.docs[0];

                    const result = await this.processConcallsDocument(refreshedDoc);
                    if (result?.hasChanges && result?.companyCode) {
                        companiesWithChanges.add(result.companyCode);
                    }
                    totalProcessed++;
                } catch (error) {
                    console.error(`❌ Error processing ${data.name}:`, error.message);
                    totalErrors++;
                }

                // Delay between companies to avoid rate limiting
                if (index < docs.length - 1) {
                    await this.delay(2000);
                }
            }

            console.log('\n📊 Fix Summary:');
            console.log(`   📋 Total companies: ${docs.length}`);
            console.log(`   ✅ Processed: ${totalProcessed}`);
            console.log(`   ❌ Errors: ${totalErrors}`);

            // Run guidance tracker for companies that got new summaries
            if (companiesWithChanges.size > 0) {
                console.log(`\n📈 Regenerating guidance trackers for ${companiesWithChanges.size} companies...`);
                for (const companyCode of companiesWithChanges) {
                    try {
                        await this.guidanceTracker.generateGuidanceTracker(companyCode, true);
                        console.log(`✅ Tracker updated for: ${companyCode}`);
                        await this.delay(1000);
                    } catch (error) {
                        console.error(`❌ Tracker error for ${companyCode}:`, error.message);
                    }
                }
            }

            return { total: docs.length, processed: totalProcessed, errors: totalErrors };
        } catch (error) {
            console.error(`❌ Error fixing companies by industryPath:`, error.message);
            throw error;
        }
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // MongoDB Migration Methods
    // async migrateDataToMongoDB() {
    //     let mongoClient = null;
    //     try {
    //         console.log('🚀 Starting data migration to MongoDB...');

    //         // Connect to MongoDB
    //         mongoClient = await testMongoConnection();
    //         const db = mongoClient.db('specter-db'); // Replace with your desired database name
    //         const collection = db.collection('companies'); // Replace with your desired collection name

    //         // Get data from Firebase
    //         console.log('📥 Fetching data from Firebase...');
    //         const snapshot = await this.firebaseService.getAllDocuments();

    //         if (snapshot.empty) {
    //             console.log('📭 No documents found in Firebase to migrate');
    //             return;
    //         }

    //         console.log(`📋 Found ${snapshot.size} documents to migrate`);

    //         let successCount = 0;
    //         let failureCount = 0;

    //         for (const doc of snapshot.docs) {
    //             try {
    //                 const docData = doc.data();

    //                 // Add Firebase document ID to the data
    //                 const mongoDoc = {
    //                     firebaseId: doc.id,
    //                     ...docData,
    //                     migratedAt: new Date(),
    //                     migratedFrom: 'firebase'
    //                 };

    //                 // Insert into MongoDB
    //                 await collection.insertOne(mongoDoc);
    //                 successCount++;

    //                 console.log(`✅ Migrated document: ${docData.name || doc.id}`);

    //             } catch (error) {
    //                 console.error(`❌ Failed to migrate document ${doc.id}:`, error.message);
    //                 failureCount++;
    //             }
    //         }

    //         console.log('\n📊 Migration Summary:');
    //         console.log(`   ✅ Successful: ${successCount}`);
    //         console.log(`   ❌ Failed: ${failureCount}`);
    //         console.log(`   📈 Total: ${snapshot.size}`);

    //     } catch (error) {
    //         console.error('❌ Migration failed:', error.message);
    //         throw error;
    //     } finally {
    //         // Always close the MongoDB connection
    //         if (mongoClient) {
    //             await mongoClient.close();
    //             console.log('🔌 MongoDB connection closed');
    //         }
    //     }
    // }

    async migrateSpecificCompany(companyCode, useSharedConnection = true) {
        try {
            console.log(`🚀 Starting migration for company: ${companyCode}`);

            // Use shared connection or create new one
            let collection;
            let shouldCloseConnection = false;

            if (useSharedConnection) {
                collection = await this.ensureMongoConnection();
            } else {
                // Legacy mode - create new connection for this call only
                const mongoClient = await testMongoConnection();
                const db = mongoClient.db(MONGODB_DATABASE);
                collection = db.collection(MONGODB_COLLECTION);
                shouldCloseConnection = true;
            }

            // Get specific company data from Firebase
            const snapshot = await this.firebaseService.getDocumentsByCompanyCode(companyCode);

            if (snapshot.empty) {
                console.log(`📭 No document found for company code: ${companyCode}`);
                return false;
            }

            const doc = snapshot.docs[0];
            const docData = doc.data();
            const cData = {
                companyCode: docData?.companyCode,
                bseCode: docData?.bseCode,
                nseCode: docData?.nseCode,
                name: docData?.name
            };

            // Check if document already exists
            const existingDoc = await collection.findOne({
                $or: [
                    { firebaseId: doc.id },
                    { companyCode: companyCode }
                ]
            });

            if (existingDoc) {
                console.log(`⚠️  Company ${companyCode} already exists in MongoDB, skipping...`);
                return false;
            }

            // Prepare document for MongoDB
            const mongoDoc = {
                firebaseId: doc.id,
                ...cData,
                migratedAt: new Date(),
                migratedFrom: 'firebase'
            };

            console.log(`📄 Migrating document:`, mongoDoc);

            // Insert into MongoDB
            const result = await collection.insertOne(mongoDoc);
            console.log(`✅ Successfully migrated company ${companyCode} with MongoDB ID: ${result.insertedId}`);

            return true;

        } catch (error) {
            console.error(`❌ Failed to migrate company ${companyCode}:`, error.message);
            return false;
        }
    }

    async migrateCompaniesByArray(companyCodes) {
        try {
            console.log(`🚀 Starting migration for ${companyCodes.length} companies: [${companyCodes.join(', ')}]`);

            // Initialize MongoDB connection once
            const collection = await this.ensureMongoConnection();

            let successCount = 0;
            let failureCount = 0;
            let notFoundCount = 0;
            const results = [];

            for (const companyCode of companyCodes) {
                try {
                    console.log(`\n📋 Processing company: ${companyCode}`);

                    // Get specific company data from Firebase
                    const snapshot = await this.firebaseService.getDocumentsByCompanyCode(companyCode);

                    if (snapshot.empty) {
                        console.log(`📭 No document found for company code: ${companyCode}`);
                        notFoundCount++;
                        results.push({
                            companyCode,
                            status: 'not_found',
                            message: 'No document found in Firebase'
                        });
                        continue;
                    }

                    const doc = snapshot.docs[0];
                    const docData = doc.data();

                    // Check if document already exists in MongoDB
                    const existingDoc = await collection.findOne({
                        $or: [
                            { firebaseId: doc.id },
                            { companyCode: companyCode }
                        ]
                    });

                    if (existingDoc) {
                        console.log(`⚠️  Company ${companyCode} already exists in MongoDB, skipping...`);
                        results.push({
                            companyCode,
                            status: 'already_exists',
                            message: 'Document already exists in MongoDB',
                            mongoId: existingDoc._id
                        });
                        continue;
                    }

                    // Prepare document for MongoDB
                    const mongoDoc = {
                        firebaseId: doc.id,
                        ...docData,
                        migratedAt: new Date(),
                        migratedFrom: 'firebase',
                        batchMigration: true
                    };

                    // Insert into MongoDB
                    const result = await collection.insertOne(mongoDoc);
                    successCount++;

                    console.log(`✅ Successfully migrated company ${companyCode} (${docData.name || 'Unknown'}) with MongoDB ID: ${result.insertedId}`);

                    results.push({
                        companyCode,
                        status: 'success',
                        message: 'Successfully migrated',
                        mongoId: result.insertedId,
                        companyName: docData.name || 'Unknown'
                    });

                    // Small delay to avoid overwhelming the database
                    await this.delay(100);

                } catch (error) {
                    console.error(`❌ Failed to migrate company ${companyCode}:`, error.message);
                    failureCount++;
                    results.push({
                        companyCode,
                        status: 'error',
                        message: error.message
                    });
                }
            }

            // Summary
            console.log('\n📊 Batch Migration Summary:');
            console.log(`   ✅ Successfully migrated: ${successCount}`);
            console.log(`   📭 Not found in Firebase: ${notFoundCount}`);
            console.log(`   ❌ Failed: ${failureCount}`);
            console.log(`   📈 Total processed: ${companyCodes.length}`);

            // Save detailed results to file
            const outputPath = './migration-results.json';
            try {
                fs.writeFileSync(outputPath, JSON.stringify({
                    timestamp: new Date().toISOString(),
                    companyCodes,
                    summary: {
                        total: companyCodes.length,
                        successful: successCount,
                        notFound: notFoundCount,
                        failed: failureCount
                    },
                    results
                }, null, 2));
                console.log(`💾 Detailed results saved to: ${outputPath}`);
            } catch (saveError) {
                console.error(`❌ Failed to save results:`, saveError.message);
            }

            return {
                successful: successCount,
                notFound: notFoundCount,
                failed: failureCount,
                results
            };

        } catch (error) {
            console.error('❌ Batch migration failed:', error.message);
            throw error;
        }
    }

    async migrateAllCompanies() {
        try {
            console.log('🚀 Starting migration for ALL companies...');

            // Initialize MongoDB connection once for all operations
            await this.initializeMongoConnection();

            // Get all documents from Firebase to extract unique company codes
            const snapshot = await this.firebaseService.getAllDocuments();

            if (snapshot.empty) {
                console.log('📭 No documents found in Firebase collection.');
                return;
            }

            // Extract unique company codes, similar to generateTrackersForAllCompanies
            const companyCodes = [...new Set(snapshot.docs.map(doc => doc.data().companyCode).filter(Boolean))];
            console.log(`📋 Found ${companyCodes.length} unique companies to migrate.`);

            let successCount = 0;
            let failureCount = 0;

            // Process each company using the migrateSpecificCompany logic with shared connection
            for (const companyCode of companyCodes) {
                try {
                    console.log(`\n📋 Processing company: ${companyCode}`);

                    // Use the existing migrateSpecificCompany method with shared connection
                    const migrated = await this.migrateSpecificCompany(companyCode, true);

                    if (migrated) {
                        successCount++;
                    } else {
                        // Could be already exists or not found - we'll count as failure for now
                        failureCount++;
                    }

                    // Add a small delay to manage database load and avoid overwhelming MongoDB
                    await this.delay(500);

                } catch (error) {
                    console.error(`❌ Failed to migrate company ${companyCode}:`, error.message);
                    failureCount++;
                }
            }

            // Final summary
            console.log('\n📊 All Companies Migration Complete:');
            console.log(`   ✅ Successfully migrated: ${successCount}`);
            console.log(`   ❌ Failed or already exists: ${failureCount}`);
            console.log(`   📈 Total companies processed: ${companyCodes.length}`);

            // Save summary to file
            const summaryPath = './all-companies-migration-summary.json';
            try {
                const summary = {
                    timestamp: new Date().toISOString(),
                    totalCompanies: companyCodes.length,
                    successful: successCount,
                    failed: failureCount,
                    companyCodes: companyCodes,
                    migrationMethod: 'migrateAllCompanies'
                };

                fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
                console.log(`💾 Migration summary saved to: ${summaryPath}`);
            } catch (saveError) {
                console.error(`❌ Failed to save summary:`, saveError.message);
            }

            return {
                totalCompanies: companyCodes.length,
                successful: successCount,
                failed: failureCount,
                companyCodes
            };

        } catch (error) {
            console.error('❌ A fatal error occurred during the all companies migration process:', error.message);
            throw error;
        } finally {
            // Always close the connection when done with all companies
            await this.closeMongoConnection();
        }
    }

    async removeDuplicateCompanies() {
        try {
            console.log('🧹 Starting duplicate removal from MongoDB...');

            // Initialize MongoDB connection
            const collection = await this.ensureMongoConnection();

            // Find all documents and group by potential duplicate fields
            console.log('🔍 Analyzing documents for duplicates...');

            // Get all documents
            const allDocs = await collection.find({}).toArray();
            console.log(`📋 Found ${allDocs.length} total documents in MongoDB`);

            if (allDocs.length === 0) {
                console.log('📭 No documents found in MongoDB collection');
                return;
            }

            // Group documents by potential duplicate identifiers
            const duplicateGroups = new Map();

            for (const doc of allDocs) {
                // Create a key based on potential duplicate identifiers
                const keys = [];

                // Check for duplicates based on firebaseId
                if (doc.firebaseId) {
                    keys.push(`firebaseId:${doc.firebaseId}`);
                }

                // Check for duplicates based on companyCode
                if (doc.companyCode) {
                    keys.push(`companyCode:${doc.companyCode}`);
                }

                // Check for duplicates based on combination of bseCode and nseCode
                if (doc.bseCode && doc.nseCode) {
                    keys.push(`codes:${doc.bseCode}-${doc.nseCode}`);
                }

                // Check for duplicates based on company name (normalized)
                if (doc.name) {
                    const normalizedName = doc.name.toLowerCase().trim();
                    keys.push(`name:${normalizedName}`);
                }

                // Group documents by each key
                for (const key of keys) {
                    if (!duplicateGroups.has(key)) {
                        duplicateGroups.set(key, []);
                    }
                    duplicateGroups.get(key).push(doc);
                }
            }

            // Find actual duplicates (groups with more than one document)
            const duplicatesToRemove = [];
            const duplicateStats = {
                byFirebaseId: 0,
                byCompanyCode: 0,
                byCodes: 0,
                byName: 0
            };

            for (const [key, docs] of duplicateGroups.entries()) {
                if (docs.length > 1) {
                    console.log(`🔍 Found ${docs.length} duplicates for key: ${key}`);

                    // Sort by creation date (keep the oldest one, remove newer ones)
                    docs.sort((a, b) => {
                        const dateA = a.migratedAt ? new Date(a.migratedAt) : new Date(0);
                        const dateB = b.migratedAt ? new Date(b.migratedAt) : new Date(0);
                        return dateA - dateB;
                    });

                    // Keep the first (oldest) document, mark others for removal
                    const toKeep = docs[0];
                    const toRemove = docs.slice(1);

                    console.log(`   ✅ Keeping document: ${toKeep._id} (${toKeep.name || 'Unknown'})`);

                    for (const doc of toRemove) {
                        console.log(`   🗑️  Marking for removal: ${doc._id} (${doc.name || 'Unknown'})`);
                        duplicatesToRemove.push(doc._id);

                        // Update stats
                        if (key.startsWith('firebaseId:')) duplicateStats.byFirebaseId++;
                        else if (key.startsWith('companyCode:')) duplicateStats.byCompanyCode++;
                        else if (key.startsWith('codes:')) duplicateStats.byCodes++;
                        else if (key.startsWith('name:')) duplicateStats.byName++;
                    }
                }
            }

            // Remove duplicates (keep unique IDs only)
            const uniqueIdsToRemove = [...new Set(duplicatesToRemove)];

            if (uniqueIdsToRemove.length === 0) {
                console.log('✨ No duplicates found! Your collection is clean.');
                return {
                    totalDocuments: allDocs.length,
                    duplicatesFound: 0,
                    duplicatesRemoved: 0
                };
            }

            console.log(`\n🗑️  Removing ${uniqueIdsToRemove.length} duplicate documents...`);

            // Remove duplicates in batches
            let removedCount = 0;
            const batchSize = 10;

            for (let i = 0; i < uniqueIdsToRemove.length; i += batchSize) {
                const batch = uniqueIdsToRemove.slice(i, i + batchSize);

                try {
                    const result = await collection.deleteMany({
                        _id: { $in: batch }
                    });

                    removedCount += result.deletedCount;
                    console.log(`   🗑️  Removed batch ${Math.floor(i / batchSize) + 1}: ${result.deletedCount} documents`);

                    // Small delay between batches
                    await this.delay(100);

                } catch (error) {
                    console.error(`❌ Error removing batch ${Math.floor(i / batchSize) + 1}:`, error.message);
                }
            }

            // Final verification
            const remainingDocs = await collection.countDocuments();

            console.log('\n📊 Deduplication Summary:');
            console.log(`   📋 Original documents: ${allDocs.length}`);
            console.log(`   🗑️  Duplicates removed: ${removedCount}`);
            console.log(`   ✅ Remaining documents: ${remainingDocs}`);
            console.log(`   📈 Space saved: ${((removedCount / allDocs.length) * 100).toFixed(1)}%`);

            console.log('\n📊 Duplicate Types Removed:');
            console.log(`   🔗 By Firebase ID: ${duplicateStats.byFirebaseId}`);
            console.log(`   🏢 By Company Code: ${duplicateStats.byCompanyCode}`);
            console.log(`   📊 By BSE/NSE Codes: ${duplicateStats.byCodes}`);
            console.log(`   📝 By Company Name: ${duplicateStats.byName}`);

            // Save deduplication report
            const reportPath = './deduplication-report.json';
            try {
                const report = {
                    timestamp: new Date().toISOString(),
                    originalCount: allDocs.length,
                    duplicatesRemoved: removedCount,
                    remainingCount: remainingDocs,
                    spaceSavedPercentage: ((removedCount / allDocs.length) * 100).toFixed(1),
                    duplicateStats,
                    removedIds: uniqueIdsToRemove
                };

                fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
                console.log(`💾 Deduplication report saved to: ${reportPath}`);
            } catch (saveError) {
                console.error(`❌ Failed to save report:`, saveError.message);
            }

            return {
                totalDocuments: allDocs.length,
                duplicatesFound: uniqueIdsToRemove.length,
                duplicatesRemoved: removedCount,
                remainingDocuments: remainingDocs,
                duplicateStats
            };

        } catch (error) {
            console.error('❌ Error during duplicate removal:', error.message);
            throw error;
        } finally {
            // Close connection when done
            await this.closeMongoConnection();
        }
    }
}

async function main() {
    const processor = new MainProcessor();

    try {
        // Test Firebase connection
        const isConnected = await processor.testConnection();
        if (!isConnected) {
            console.error('❌ Cannot proceed without Firestore connection');
            process.exit(1);
        }

        // Display configuration information
        console.log('🔑 API Key Status:', processor.getKeyStatus());
        console.log('🤖 Model Configuration:', processor.geminiService.getModelConfig());

        // Fix hotel industry companies - force reprocess concalls
        // await processor.fixCompaniesByIndustryPath("/market/IN02/IN0206/IN020601/IN020601001/");

        // await processor.readIndustryPrompts();
        // await processor.readAllFilingDocuments();
        //
        // // Uncomment the operations you want to run:
        // // await processor.processMultipleLocalAnnouncements();
        // await processor.cleanDuplicateDocuments();
        await processor.cleanDuplicateRawDocuments();
        // await processor.generateGuidanceTracker("353946");
        // await processor.generateTrackersForAllCompanies();
        // await processor.standardizeGuidanceTableForCompany("1274917");
        // await processor.standardizeGuidanceTablesForAllCompanies();
        //
        // // Delete all documents for a specific company
        // await processor.deleteCompanyDocuments("1284485");

        // Merge duplicate concalls (quarter-based deduplication):
        // await processor.mergeDuplicateConcallsForCompany("1275168"); // For a specific company
        // await processor.mergeDuplicateConcallsForAllCompanies(); // For all companies

        // MongoDB Migration operations (connection will be managed automatically):
        // await processor.migrateSpecificCompany("3810"); // Migrate specific company
        // await processor.migrateCompaniesByArray(["52"]); // Migrate companies by array
        // await processor.migrateAllCompanies(); // Migrate all companies from Firebase to MongoDB
        // await processor.removeDuplicateCompanies(); // Remove duplicate entries from MongoDB

        // Process a specific company's annual reports
        // await processor.processAnnualReportsForCompany("519126");

        // Process all companies (add to main function in app.js)
        // await processor.processAnnualReportsForAllCompanies();


        console.log('✅ Main application completed successfully');
    } catch (error) {
        console.error('❌ Error in main application:', error.message);
        process.exit(1);
    } finally {
        // Ensure MongoDB connection is closed on exit
        await processor.closeMongoConnection();
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = app;