const FirebaseService = require('./services/FirebaseService');
const ClaudeService = require('./services/ClaudeService');
const GuidanceTracker = require('./modules/GuidanceTracker');
const { fetchPDF, readPDF, readPDFFirstTwoPages, readPDFFromFile, removeMarkdownCodeBlock } = require('./utils/pdfUtils');
const { TRACKER_PROMPT, ANNOUNCEMENT_CALENDAR_PROMPT, GUIDANCE_TABLE_PROMPT, ANNUAL_REPORT_INSIGHTS_PROMPT } = require('./config/prompts');
const fs = require('fs');

// ── Processing limits (override via environment variables) ────────────────────
const MAX_CONCALLS_TO_PROCESS = parseInt(process.env.MAX_CONCALLS_TO_PROCESS) || 16;
const MAX_ANNOUNCEMENTS_TO_PROCESS = parseInt(process.env.MAX_ANNOUNCEMENTS_TO_PROCESS) || 10;

// Comma-separated company codes to skip entirely.
// Set EXCLUDED_COMPANY_CODES="406,295" in the environment to exclude companies.
const EXCLUDED_COMPANY_CODES = new Set(
    (process.env.EXCLUDED_COMPANY_CODES || '')
        .split(',')
        .map(c => c.trim())
        .filter(Boolean)
);

console.log(`⚙️  Processing limits — concalls: ${MAX_CONCALLS_TO_PROCESS}, announcements: ${MAX_ANNOUNCEMENTS_TO_PROCESS}`);
if (EXCLUDED_COMPANY_CODES.size > 0) {
    console.log(`⚙️  Excluded company codes: [${[...EXCLUDED_COMPANY_CODES].join(', ')}]`);
}
// ─────────────────────────────────────────────────────────────────────────────

class ConferenceCallNotes {
    constructor() {
        this.firebaseService = new FirebaseService();
        this.claudeService = new ClaudeService();
        this.industryPromptsMap = new Map();
        this.guidanceTracker = new GuidanceTracker(this.firebaseService, this.claudeService);

        this.firebaseService.initializeFirebase();
    }

    async testConnection() {
        return this.firebaseService.testConnection();
    }

    async readIndustryPrompts() {
        this.industryPromptsMap = await this.firebaseService.readIndustryPrompts();
    }

    async readAllFilingDocuments() {
        try {
            console.log('🚀 Starting to process filing documents in batches...');

            const snapshot = await this.firebaseService.getAllDocuments();

            if (snapshot.empty) {
                console.log('📭 No documents found in collection');
                return;
            }

            const totalDocs = snapshot.size;
            const batchSize = Math.ceil(totalDocs / 10); // Divide into 10 batches
            const allDocs = snapshot.docs;

            console.log(`📋 Found ${totalDocs} documents to process in 10 batches of ~${batchSize} documents each`);

            let totalProcessed = 0;
            let totalErrors = 0;
            const companiesWithChanges = new Set();

            for (let batchIndex = 0; batchIndex < 10; batchIndex++) {
                const startIndex = batchIndex * batchSize;
                const endIndex = Math.min(startIndex + batchSize, totalDocs);
                const batchDocs = allDocs.slice(startIndex, endIndex);

                if (batchDocs.length === 0) break; // No more documents to process

                console.log(`\n📦 Processing Batch ${batchIndex + 1}/10 (Documents ${startIndex + 1}-${endIndex})`);
                console.log(`📄 Batch contains ${batchDocs.length} documents`);

                let batchProcessed = 0;
                let batchErrors = 0;

                for (const doc of batchDocs) {
                    try {
                        const result = await this.processConcallsDocument(doc);
                        // await this.processAnnouncementDocument(doc);
                        if (result?.hasChanges && result?.companyCode) {
                            companiesWithChanges.add(result.companyCode);
                        }
                        batchProcessed++;
                        totalProcessed++;
                    } catch (error) {
                        console.error(`❌ Error processing document ${doc.id}:`, error.message);
                        batchErrors++;
                        totalErrors++;
                        continue;
                    }
                }

                console.log(`✅ Batch ${batchIndex + 1} completed: ${batchProcessed} processed, ${batchErrors} errors`);

                // Add delay between batches to prevent timeout
                if (batchIndex < 9) { // Don't delay after the last batch
                    console.log('⏳ Waiting 30 seconds before next batch...');
                    await this.delay(30000); // 30 second delay between batches
                }
            }

            console.log('\n📊 Final Summary:');
            console.log(`   📈 Total Documents: ${totalDocs}`);
            console.log(`   ✅ Successfully Processed: ${totalProcessed}`);
            console.log(`   ❌ Errors: ${totalErrors}`);
            console.log('✅ Finished processing all documents in batches');

            // Run guidance tracker only for companies with new concall summaries
            if (companiesWithChanges.size > 0) {
                console.log(`\n📊 Running guidance tracker for ${companiesWithChanges.size} companies with new summaries...`);
                console.log(`🏢 Companies: [${Array.from(companiesWithChanges).join(', ')}]`);

                for (const companyCode of companiesWithChanges) {
                    try {
                        console.log(`\n📈 Generating guidance tracker for company: ${companyCode}`);
                        await this.guidanceTracker.generateGuidanceTracker(companyCode);
                        console.log(`✅ Guidance tracker updated for company: ${companyCode}`);
                        await this.delay(1000); // Small delay between companies
                    } catch (error) {
                        console.error(`❌ Error generating guidance tracker for ${companyCode}:`, error.message);
                    }
                }

                console.log('\n✅ Finished generating guidance trackers for companies with changes');
            } else {
                console.log('\n⏭️  No companies had new concall summaries, skipping guidance tracker generation');
            }

        } catch (error) {
            console.error('❌ Error in readAllFilingDocuments:', error.message);
            throw error;
        }
    }

    async readFilingDocumentsByCompanyCode(companyCode) {
        try {
            console.log(`🚀 Starting to process filing documents for company code: ${companyCode}...`);

            const snapshot = await this.firebaseService.getDocumentsByCompanyCode(companyCode);

            if (snapshot.empty) {
                console.log(`📭 No documents found for company code: ${companyCode}`);
                return;
            }

            const totalDocs = snapshot.size;
            const allDocs = snapshot.docs;

            console.log(`📋 Found ${totalDocs} document(s) to process for company code: ${companyCode}`);

            let totalProcessed = 0;
            let totalErrors = 0;

            for (const doc of allDocs) {
                try {
                    console.log(`\n📄 Processing document ${totalProcessed + 1}/${totalDocs}`);
                    await this.processConcallsDocument(doc);
                    // await this.processAnnouncementDocument(doc);
                    totalProcessed++;
                } catch (error) {
                    console.error(`❌ Error processing document ${doc.id}:`, error.message);
                    totalErrors++;
                    continue;
                }
            }

            console.log('\n📊 Final Summary:');
            console.log(`   🏢 Company Code: ${companyCode}`);
            console.log(`   📈 Total Documents: ${totalDocs}`);
            console.log(`   ✅ Successfully Processed: ${totalProcessed}`);
            console.log(`   ❌ Errors: ${totalErrors}`);
            console.log(`✅ Finished processing documents for company code: ${companyCode}`);

        } catch (error) {
            console.error(`❌ Error in readFilingDocumentsByCompanyCode for company ${companyCode}:`, error.message);
            throw error;
        }
    }

    async processAnnouncementDocument(doc) {
        const docData = doc.data();
        const name = docData?.name || '';
        const companyCode = docData?.companyCode || '';
        const announcementList = docData?.documents?.['Announcements'] || [];
        const industryLink = docData?.['industryLink'] || '';

        console.log(`📢 Processing announcements for: ${name}`);
        console.log(`🏭 Industry link: ${industryLink}`);
        console.log(`📋 Announcements found: ${announcementList.length}`);

        if (EXCLUDED_COMPANY_CODES.has(companyCode)) {
            console.log(`⏭️  Company ${companyCode} (${name}) is excluded from processing`);
            return;
        }

        if (announcementList.length === 0) {
            console.log(`⏭️  No announcements found for document ${doc.id}`);
            return;
        }

        const updatedAnnouncements = await this.processAnnouncements(announcementList, ANNOUNCEMENT_CALENDAR_PROMPT);

        if (updatedAnnouncements.some(announcement => announcement.isProcessed)) {
            await this.firebaseService.updateAnnouncementsInFirestore(doc.id, updatedAnnouncements);
            console.log(`💾 Updated announcements for document ${doc.id} in Firestore`);
        }
    }

    async processConcallsDocument(doc) {
        const docData = doc.data();
        const name = docData?.name || '';
        const companyCode = docData?.companyCode || '';
        const conCallList = docData?.documents?.['Concalls'] || [];
        const industryLink = docData?.['industryLink'] || '';

        console.log(`📄 Processing documents for : ${name}`);
        console.log(`🏭 Industry link: ${industryLink}`);
        console.log(`📞 Conference calls found: ${conCallList.length}`);

        if (EXCLUDED_COMPANY_CODES.has(companyCode)) {
            console.log(`⏭️  Company ${companyCode} (${name}) is excluded from processing`);
            return { companyCode, hasChanges: false };
        }
        if (conCallList.length === 0) {
            console.log(`⏭️  No conference calls found for document ${doc.id}`);
            return { companyCode, hasChanges: false };
        }

        const industryPrompt = this.industryPromptsMap.get(industryLink);
        if (!industryPrompt) {
            console.warn(`⚠️  No industry prompt found for link: ${industryLink}`);
            return { companyCode, hasChanges: false };
        }

        const { updatedConCalls, hasChanges } = await this.processConferenceCalls(conCallList, industryPrompt);

        // Save only if any call was newly processed or has a new error
        if (hasChanges) {
            await this.firebaseService.updateDocumentInFirestore(doc.id, updatedConCalls);
            console.log(`💾 Updated document ${doc.id} in Firestore`);
        } else {
            console.log(`⏭️  No changes for document ${doc.id}, skipping update`);
        }

        return { companyCode, hasChanges };
    }

    async processAnnouncements(announcementList, prompt) {
        const updatedAnnouncements = [];

        for (const [index, announcement] of announcementList.entries()) {
            if (index < MAX_ANNOUNCEMENTS_TO_PROCESS) {
                try {
                    console.log(`📢 Processing announcement ${index + 1}/${announcementList.length}`);

                    if (announcement.isExtracted) {
                        console.log(`⏭️  Announcement ${index + 1} already processed`);
                        updatedAnnouncements.push(announcement);
                        continue;
                    }

                    if (!announcement.link) {
                        console.warn(`⚠️  No link found for announcement ${index + 1}`);
                        updatedAnnouncements.push({
                            ...announcement,
                            isExtracted: true,
                            processingError: 'No PDF link available'
                        });
                        continue;
                    }

                    const processedAnnouncement = await this.processSingleAnnouncement(announcement, prompt);
                    updatedAnnouncements.push(processedAnnouncement);

                } catch (error) {
                    console.error(`❌ Error processing announcement ${index + 1}:`, error.message);
                    updatedAnnouncements.push({
                        ...announcement,
                        isExtracted: false,
                        processingError: error.message,
                        processingDate: new Date().toISOString()
                    });
                }
            } else {
                updatedAnnouncements.push(announcement);
            }
        }

        return updatedAnnouncements;
    }

    async processConferenceCalls(conCallList, industryPrompt) {
        const updatedConCalls = [];
        let hasChanges = false;

        for (const [index, conCall] of conCallList.entries()) {
            if (index < MAX_CONCALLS_TO_PROCESS) {
                try {
                    console.log(`📞 Processing conference call ${index + 1}/${conCallList.length}`);

                    if (conCall.isProcessed) {
                        console.log(`⏭️  Conference call ${index + 1} already processed`);
                        updatedConCalls.push(conCall);
                        continue;
                    }

                    // Skip documents with non-LLM errors (timeout, etc.)
                    // Only retry if it's an LLM API error, "No PDF link available" error, or never processed
                    if (conCall.processingError &&
                        !conCall.processingError.includes('Gemini') &&
                        !conCall.processingError.includes('Claude') &&
                        !conCall.processingError.includes('No PDF link available')) {
                        console.log(`⏭️  Conference call ${index + 1} skipped - previous error: ${conCall.processingError}`);
                        updatedConCalls.push(conCall);
                        continue;
                    }

                    if (!conCall.link) {
                        console.warn(`⚠️  No link found for conference call ${index + 1}`);
                        updatedConCalls.push({
                            ...conCall,
                            isProcessed: false,
                            processingError: 'No PDF link available'
                        });
                        hasChanges = true;
                        continue;
                    }

                    const processedCall = await this.processSingleConferenceCall(conCall, industryPrompt);
                    updatedConCalls.push(processedCall);
                    hasChanges = true;

                } catch (error) {
                    console.error(`❌ Error processing conference call ${index + 1}:`, error.message);
                    updatedConCalls.push({
                        ...conCall,
                        isProcessed: false,
                        processingError: error.message,
                        processingDate: new Date().toISOString()
                    });
                    hasChanges = true;
                }
            } else {
                updatedConCalls.push(conCall);
            }
        }

        return { updatedConCalls, hasChanges };
    }

    async processSingleAnnouncement(announcement, prompt) {
        try {
            console.log(`🔗 Fetching PDF from: ${announcement.link}`);

            const pdfBuffer = await fetchPDF(announcement.link);
            console.log(`📖 PDF fetched successfully, size: ${pdfBuffer.length} bytes`);

            const pdfText = await readPDFFirstTwoPages(pdfBuffer);
            console.log(`📝 Extracted ${pdfText.length} characters from first two pages of PDF`);

            if (!pdfText || pdfText.trim().length === 0) {
                throw new Error('No text content extracted from PDF');
            }
            const updatedPrompt = prompt.replace("NOTIFICATION_TEXT_HERE", pdfText.trim())
            const { parsedResponse } = await this.generateEventWithClaude(pdfText, updatedPrompt);

            console.log('📊 parsedResponse type:', typeof parsedResponse);
            console.log('📊 parsedResponse content:', parsedResponse);

            return {
                ...announcement,
                parsedResponse: parsedResponse,
                isExtracted: true,
                processingDate: new Date().toISOString(),
                textLength: pdfText.length
            };

        } catch (error) {
            console.error(`❌ Error processing single announcement:`, error.message);
            throw error;
        }
    }

    async processSingleConferenceCall(conCall, industryPrompt) {
        try {
            console.log(`🔗 Fetching PDF from: ${conCall.link}`);

            const pdfBuffer = await fetchPDF(conCall.link);
            console.log(`📖 PDF fetched successfully, size: ${pdfBuffer.length} bytes`);

            const pdfText = await readPDF(pdfBuffer);
            console.log(`📝 Extracted ${pdfText.length} characters from PDF`);

            if (!pdfText || pdfText.trim().length === 0) {
                throw new Error('No text content extracted from PDF');
            }

            const { summary, markdownOutput } = await this.generateSummaryWithClaude(pdfText, industryPrompt);

            // Standardize guidance section as a Markdown table inline
            let finalMarkdown = markdownOutput;
            let isGuidanceTableStandardized = false;
            if (markdownOutput && markdownOutput.toLowerCase().includes('guidance')) {
                try {
                    finalMarkdown = await this.standardizeGuidanceTable(markdownOutput);
                    isGuidanceTableStandardized = true;
                    console.log('📊 Guidance table standardized');
                } catch (err) {
                    console.warn(`⚠️  Guidance table standardization failed: ${err.message}`);
                }
            } else {
                isGuidanceTableStandardized = true;
            }

            return {
                ...conCall,
                summary: summary,
                markdownOutput: finalMarkdown,
                isProcessed: true,
                isGuidanceTableStandardized,
                guidanceTableStandardizedDate: new Date().toISOString(),
                processingDate: new Date().toISOString(),
                textLength: pdfText.length
            };

        } catch (error) {
            console.error(`❌ Error processing single conference call:`, error.message);
            throw error;
        }
    }

    async standardizeGuidanceTable(markdownInput) {
        const prompt = GUIDANCE_TABLE_PROMPT.replace('[PASTE FULL MARKDOWN HERE]', markdownInput);
        const result = await this.claudeService.callClaudeAPIWithRetry(prompt);
        const cleaned = this.stripCodeFence(result);
        return (cleaned && cleaned.includes('#')) ? cleaned : markdownInput;
    }

    async generateSummaryWithClaude(pdfText, industryPrompt) {
        try {
            console.log('🤖 Generating summary with Claude API...');

            // Debug: check what placeholder the prompt uses
            const hasPlaceholder = industryPrompt.includes("[Paste Transcript Here]");
            console.log(`📝 Prompt length: ${industryPrompt.length}, has [Paste Transcript Here]: ${hasPlaceholder}`);
            if (!hasPlaceholder) {
                // Find what the actual placeholder might be
                const bracketMatch = industryPrompt.match(/\[.*?paste.*?\]/i) || industryPrompt.match(/\[.*?transcript.*?\]/i);
                console.log(`⚠️  Placeholder not found! Possible match: ${bracketMatch ? bracketMatch[0] : 'NONE'}`);
                console.log(`📝 Prompt preview (first 500 chars):\n${industryPrompt.substring(0, 500)}`);
            }

            industryPrompt = industryPrompt.replace("[Paste Transcript Here]", pdfText);

            const prompt = `${industryPrompt}
                Please analyze the conference call transcript and provide your response in the following EXACT format:
                
                ===SUMMARY_START===
                [Write a comprehensive summary of the key points discussed in the conference call]
                ===SUMMARY_END===
                
                ===MARKDOWN_START===
                [Write a detailed markdown report analyzing the content based on the industry context]
                ===MARKDOWN_END===
                
                Important: 
                - Use the exact delimiters shown above
                - Do not include any other formatting or text outside these sections
                - Make the summary comprehensive but concise
                - Make the markdown analysis detailed and industry-focused`;

            const response = await this.claudeService.callClaudeAPIWithRetry(prompt);
            const parsedResponse = this.parseStructuredResponse(response);

            return {
                summary: parsedResponse.summary || 'Summary generation failed',
                markdownOutput: parsedResponse.markdownOutput || '# Analysis\n\nMarkdown generation failed'
            };

        } catch (error) {
            console.error('❌ Error generating summary with Claude:', error.message);
            throw new Error(`Claude API error: ${error.message}`);
        }
    }

    async generateEventWithClaude(pdfText, prompt) {
        try {
            console.log('🤖 Generating event with Claude API...');
            const calendarPrompt = prompt.replace("[Paste Announcement Here]", pdfText);

            const response = await this.claudeService.callClaudeAPIWithRetry(calendarPrompt);

            // Parse the JSON response
            let parsedResponse = removeMarkdownCodeBlock(response);
            parsedResponse = JSON.parse(parsedResponse);

            console.log(parsedResponse);
            return {
                parsedResponse
            };

        } catch (error) {
            console.error('❌ Error generating event with Claude:', error.message);
            throw new Error(`Claude API error: ${error.message}`);
        }
    }

    async generateInsightsWithClaude(pdfText) {
        try {
            console.log('🤖 Generating annual report insights with Claude API...');
            const insightsPrompt = ANNUAL_REPORT_INSIGHTS_PROMPT.replace("[Paste Annual Report Text Here]", pdfText);

            const response = await this.claudeService.callClaudeAPIWithRetry(insightsPrompt);
            const parsedResponse = this.parseInsightsResponse(response);

            return {
                insightsMarkdown: parsedResponse.insightsMarkdown || '# Annual Report Insights\n\nInsights generation failed'
            };

        } catch (error) {
            console.error('❌ Error generating insights with Claude:', error.message);
            throw new Error(`Claude API error: ${error.message}`);
        }
    }

    parseInsightsResponse(response) {
        try {
            console.log('📝 Parsing insights response...');

            const insightsMatch = response.match(/===INSIGHTS_START===([\s\S]*?)===INSIGHTS_END===/);

            const insightsMarkdown = insightsMatch ? insightsMatch[1].trim() : null;

            if (insightsMarkdown) {
                console.log('✅ Successfully parsed insights response');
                return { insightsMarkdown };
            }

            console.warn('⚠️  Insights parsing failed, using full response');
            return {
                insightsMarkdown: `# Annual Report Insights\n\n${response}`
            };

        } catch (error) {
            console.error('Error parsing insights response:', error.message);
            return {
                insightsMarkdown: `# Annual Report Insights\n\n${response}`
            };
        }
    }

    stripCodeFence(text) {
        if (!text) return text;
        // LLMs sometimes wrap markdown output in ```markdown ... ``` or ``` ... ```
        return text.replace(/^```(?:markdown)?\s*\n/, '').replace(/\n```\s*$/, '').trim();
    }

    parseStructuredResponse(response) {
        try {
            console.log('📝 Parsing structured response...');

            const summaryMatch = response.match(/===SUMMARY_START===([\s\S]*?)===SUMMARY_END===/);
            const markdownMatch = response.match(/===MARKDOWN_START===([\s\S]*?)===MARKDOWN_END===/);

            const summary = summaryMatch ? summaryMatch[1].trim() : null;
            const rawMarkdown = markdownMatch ? markdownMatch[1].trim() : null;
            const markdownOutput = this.stripCodeFence(rawMarkdown);

            if (summary && markdownOutput) {
                console.log('✅ Successfully parsed structured response');
                return { summary, markdownOutput };
            }

            console.warn('⚠️  Structured parsing failed, using fallback method');
            return this.parseAlternativeFormat(response);

        } catch (error) {
            console.error('Error parsing structured response:', error.message);
            return this.parseAlternativeFormat(response);
        }
    }

    parseAlternativeFormat(response) {
        try {
            const cleaned = this.stripCodeFence(response.trim());
            const paragraphs = cleaned.split('\n\n').filter(p => p.trim().length > 0);
            const summary = paragraphs.slice(0, 2).join(' ').substring(0, 1000);
            const markdownOutput = `# Conference Call Analysis\n\n## Executive Summary\n\n${paragraphs.slice(0, 2).join('\n\n')}\n\n## Detailed Analysis\n\n${paragraphs.slice(2).join('\n\n')}`;

            return { summary, markdownOutput };

        } catch (error) {
            console.error('Alternative parsing failed:', error.message);
            return {
                summary: response.substring(0, 500) + '...',
                markdownOutput: `# Conference Call Analysis\n\n${this.stripCodeFence(response.trim())}`
            };
        }
    }

    // Method to get current API key status
    getKeyStatus() {
        return this.claudeService.getKeyStatus();
    }

    // Method to manually reset a specific key
    resetKey(keyName) {
        return this.claudeService.resetKey(keyName);
    }
    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = ConferenceCallNotes;