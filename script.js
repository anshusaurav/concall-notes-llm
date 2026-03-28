const express = require('express');
const axios = require('axios');
const pdf = require('pdf-parse');
const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
require('dotenv').config();
const app = express();

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

const AUTH_STATE_PATH = 'state.json';
const TARGET_URL = 'https://www.screener.in/announcements/user-filters/174962/';
const OUTPUT_PATH = 'results.json';
const DAYS_TO_FETCH = 7;
const EVENT_KEYWORDS = [
    'earnings call', 'quarterly call', 'results call', 'financial results call',
    'investor call', 'earnings conference call', 'quarterly earnings call',
    'results conference call', 'financial call'
];

/**
 * Function to fetch PDF from URL
 * @param {string} url - PDF URL
 * @returns {Promise<Buffer>} PDF buffer
 */
async function fetchPDF(url) {
    try {
        console.log(`Fetching PDF from: ${url}`);
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 30000, // 30 second timeout
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        return Buffer.from(response.data);
    } catch (error) {
        console.error(`Error fetching PDF from ${url}:`, error.message);
        throw new Error(`Failed to fetch PDF: ${error.message}`);
    }
}

/**
 * Function to read PDF content
 * @param {Buffer} pdfBuffer - PDF buffer
 * @returns {Promise<string>} Extracted text
 */
async function readPDF(pdfBuffer) {
    try {
        console.log('Reading PDF content...');
        const data = await pdf(pdfBuffer);
        return data.text;
    } catch (error) {
        console.error('Error reading PDF:', error.message);
        throw new Error(`Failed to read PDF: ${error.message}`);
    }
}

/**
 * Function to read only first two pages of PDF content
 * @param {Buffer} pdfBuffer - PDF buffer
 * @returns {Promise<string>} Extracted text from first two pages
 */
async function readPDFFirstTwoPages(pdfBuffer) {
    try {
        console.log('Reading first two pages of PDF content...');
        const data = await pdf(pdfBuffer, {
            max: 2  // Limit to first 2 pages
        });
        return data.text;
    } catch (error) {
        console.error('Error reading PDF first two pages:', error.message);
        throw new Error(`Failed to read PDF first two pages: ${error.message}`);
    }
}
function removeMarkdownCodeBlock(str) {
    // Remove ```json from beginning and ``` from end
    return str.replace(/^```json\s*\n?/, '').replace(/\n?```\s*$/, '');
}

const TRACKER_PROMPT = `
    The Universal Multi-Period Guidance & Commitment Tracker Prompt (V4 - Final, Clear Delimiters)
    Role and Goal:
    You are an expert financial accountability analyst. Your primary objective is to create a comprehensive, multi-period tracker of a company's guidance and commitments. You will be given a single text input containing a chronological series of historical earnings call summaries, each clearly separated by unique delimiters.
    Your task is to identify ALL distinct, forward-looking targets and commitments made across ALL provided periods, and for each one, trace its history from the point of introduction to the most recent update, assigning a precise final status from a predefined list.
    Input:
    [Paste your historical summaries here. You MUST follow the exact format below, using the unique start and end delimiters to separate each summary. This is crucial for correct analysis.]
    Required Input Format Template:
    --- START OF SUMMARY: Q1 FY25 ---
    [Full text of the Q1 FY25 earnings call summary, which must include a 'Key Targets & Commitments' section...]
    --- END OF SUMMARY: Q1 FY25 ---
    --- START OF SUMMARY: Q2 FY25 ---
    [Full text of the Q2 FY25 earnings call summary, including any updates on previous targets or new commitments...]
    --- END OF SUMMARY: Q2 FY25 ---
    --- START OF SUMMARY: Q3 FY25 ---
    [Full text of the Q3 FY25 earnings call summary, which may introduce new targets...]
    --- END OF SUMMARY: Q3 FY25 ---
    --- START OF SUMMARY: Q4 FY25 ---
    [Full text of the most recent (Q4 FY25) earnings call summary...]
    --- END OF SUMMARY: Q4 FY25 ---
    (Continue this pattern for all summaries you want to analyze)
    Instructions for Analysis and Output Generation:
    Parse and Identify All Unique Targets:
    Go through each summary block, identified by its --- START OF SUMMARY... and --- END OF SUMMARY... delimiters, in chronological order.
    In each summary's "Key Targets & Commitments" section, identify every commitment listed.
    Create a master list of all unique commitments. A commitment is unique based on its metric (e.g., "EBITDA Margin," "Raipur Hospital Commissioning"). If a target for the same metric is introduced with a new timeframe (e.g., FY26 guidance after FY25 guidance is complete), treat it as a new, distinct commitment.
    Trace Each Commitment Forward:
    For each unique commitment from your master list, find the period in which it was first introduced. This is its "origin period."
    Then, trace its history through all subsequent summary blocks up to the most recent one.
    Construct the Historical Narrative:
    For each commitment, create a bulleted historical log under the "Historical Tracker & Evolution" column.
    The first bullet point should always be its introduction, starting with the origin period (e.g., "Q3 FY25 (Introduced):").
    Subsequent bullet points should detail updates from later periods (e.g., "Q4 FY25:").
    Each bullet point must provide a concise summary of the update and include a direct quote or key data point from that period's summary as evidence.
    If there is no update in a specific period after its introduction, note it (e.g., "Q4 FY25: No specific update mentioned.").
    Determine and Assign Final Status:
    Based only on the information in the latest summary block provided, assign a final status to the commitment.
    You MUST use one, and only one, of the following predefined status tags:
    Achieved: The target was explicitly met or exceeded.
    On Track: Positive progress is reported, and the goal is likely to be met.
    Delayed/Revised: The timeline or value of the target was explicitly changed.
    At Risk: Performance is lagging or concerns have been raised.
    Missed: The deadline passed without achievement.
    Abandoned: The goal is no longer mentioned for multiple periods or has been explicitly dropped.
    In Progress: The target is long-term and still in progress with no negative indicators.
    Structure the Output:
    Present your findings as a single, well-formatted JSON object.
    The JSON should have a single key, guidance_tracker, whose value is an array of objects.
    Each object in the array represents a tracked commitment and must have exactly four fields: metric, original_target_and_period, historical_tracker_and_evolution, and final_status.
    Organize the commitment objects in the array logically, preferably in the chronological order of their introduction.
    Do not include any extra conversational text, introductions, or Markdown formatting (like json) in your final output. Simply provide the raw JSON.
        `
const ANNOUNCEMENT_CALENDAR_PROMPT = `
    The Unified Notification Segregation Prompt (Version 5.0)
    Objective: To accurately classify and extract key information from any given notification from India's National Stock Exchange (NSE) or BSE Limited (BSE), producing a clean, machine-parsable JSON output.
    
    Instructions:
    
    You are an expert financial data analyst. Your task is to process a raw text notification from an Indian stock exchange (NSE or BSE) and classify it according to the multi-layered model below. Your final output must be in a structured JSON format, adhering strictly to the specified formatting rules.
    
    Step 0: Preliminary Analysis & Context Filtering
    
    Before classification, perform a preliminary analysis of the entire text to identify the primary subject company of the notification. This is the company name mentioned in the letterhead, the subject line, or the introductory paragraph.
    
    Crucially, if the document contains a section that is a newspaper clipping (identifiable by its distinct layout, multiple columns, and varied headlines), you must apply a filter: Your analysis for classification and data extraction should focus ONLY on the text related to the primary subject company. IGNORE all other advertisements, public notices, or articles within the newspaper clipping that pertain to different companies. This step is vital to prevent misclassification based on irrelevant information. 
    
    Step 1: Determine the Notification Source
    
    First, identify the origin of the notification.
    
    If the text contains identifiers such as Circular Ref. No, Download Ref. No, Department:, or reference numbers with prefixes like NSE/CML/, NCL/CMPT/, or NSE/INVG/, classify the source as 'Exchange Circular'.
    
    Otherwise, classify the source as 'Corporate Filing'.
    
    Step 2: Classify the Notification by Category and Specific Event
    
    Based on the source identified in Step 1 and the filtered text from Step 0, use the following keyword-based rules to determine the primaryCategory and specificEvent.
    
    A. If source = 'Exchange Circular'
    Analyze the subject line and body for the following keywords to assign a primaryCategory:
    
    Trading Status: Keywords include "Suspension of Trading," "Revocation of Suspension," "Discontinuation of weekly trading," or "Delisting".
    
    Risk & Margins: Keywords include "Margin," "MWPL" (Market-Wide Position Limit), "Position Limit," "SPAN," "Exposure Margin," or "ban period".
    
    Market Operations: Keywords include "Adjustment of...Contracts," "Exclusion of...contract," "Settlement Calendar," or "Pre-Trade risk controls".
    
    Listing Actions: Keywords include "Listing of...securities," "Listing of further issues," or "Listing of privately placed securities".
    
    B. If source = 'Corporate Filing'
    Analyze the subject line and body for the following keywords to assign a primaryCategory and specificEvent:
    
    Primary Category: Financial Results
    
    Keywords: "Financial Results," "Unaudited," "Audited," "Reg. 33".
    
    Specific Event:
    
    Quarterly/Annual Results: If the document contains the financial statements.
    
    Newspaper Publication: If keywords include "Newspaper publication," "Regulation 47".
    
    Primary Category: Board Meeting
    
    Keywords: "Board Meeting Intimation," "Outcome of Board Meeting," "Reg. 29".
    
    Specific Event:
    
    Intimation: If the subject contains "Intimation".
    
    Outcome: If the subject contains "Outcome".
    
    Primary Category: AGM/EGM
    
    Keywords: "Annual General Meeting," "Extra-ordinary General Meeting," "AGM," "EGM," "Voting Results," "Scrutinizer's Report," "Reg. 44". 
    
    Specific Event:
    
    Notice: If the document is a notice calling for a meeting.
    
    Voting Results: If the document provides the outcome and voting details of a concluded meeting.
    
    Primary Category: Corporate Action
    
    Keywords: "Dividend," "Bonus," "Split," "Sub-division," "Rights Issue," "Buyback," "Takeover," "Merger," "Amalgamation," "Scheme of Arrangement," "Record Date," "Preferential Issue," "Warrants".
    
    Specific Event: Use the specific keyword found (e.g., Dividend, Bonus Issue, Stock Split).
    
    Primary Category: Corporate Governance
    
    Keywords: "Change in Director," "KMP," "Auditor," "Compliance Officer," "Share Transfer Agent," "Corporate Governance Report".
    
    Specific Event:
    
    Management Change: For appointments or resignations.
    
    Compliance Report: For governance or shareholding pattern reports.
    
    Primary Category: Investor Relations
    
    Keywords: "Analyst...Meet," "Investor Meet," "Con. Call," "Earnings Call," "Investor Presentation". 
    
    Specific Event:
    
    Analyst/Investor Meet: For intimations of calls/meetings.
    
    Investor Presentation: For submission of presentation materials. 
    
    Call Transcript/Recording: For submission of transcripts or audio links post-event.
    
    Primary Category: Regulatory & Compliance
    
    Keywords: "Credit Rating," "Trading Window," "Shareholding Pattern," "Takeover Regulations," "SAST," "Compliance Certificate," "Statement of deviation," "variation in utilisation of funds," "Regulation 32". 
    
    Specific Event: Use the specific keyword found (e.g., Credit Rating, Trading Window Closure, Statement of Deviation ). 
    
    Primary Category: Business Operations
    
    Keywords: "Awarding/Bagging of orders," "Press Release," "Acquisition," "General Updates," "Allotment of Securities".
    
    Specific Event: Use the specific keyword found.
    
    Step 3: Extract Key Data Points & Apply Formatting Rules
    
    After classification, extract the relevant key data points. Apply the following formatting rules strictly:
    
    Attribute Naming: All JSON object keys (attributes) must be in camelCase.
    
    Number Formatting: Ensure all numerical values are represented as integers or floats without any commas, currency symbols, or other separators (e.g., 45000000, not 4,50,00,000/-).
    
    Link Extraction: Scan the entire document for any URLs or hyperlinks related to the event and capture them.
    
    For Investor Relations (Analyst/Investor Meet): Extract eventType, date, time, purpose, and relevantLinks (e.g., registration link, webcast URL). 
    
    For AGM/EGM (Notice or Voting Results): Extract meetingType, meetingDate, resolutionsPassed (if applicable), and relevantLinks (e.g., e-voting link, meeting access URL). 
    
    For Board Meeting (Outcome): Extract meetingDate, decisionsTaken.
    
    For Financial Results (Newspaper Publication): Extract purpose, regulation, newspapers. 
    
    For Regulatory & Compliance (Statement of Deviation): Extract regulation, reason, deviationDetails. 
    
    For Dividend: Extract dividendAmountPerShare, recordDate, exDate.
    
    For Bonus Issue: Extract bonusRatio and recordDate.
    
    Final Output Structure & Examples:
    
    Provide the final output in a clear, structured JSON format.
    
    Example 1: Board Meeting Outcome (Illustrates Number Formatting)
    Input Text: Based on the Sancode Technologies document. 
    
    JSON
    
    {
      "source": "Corporate Filing",
      "primaryCategory": "Board Meeting",
      "specificEvent": "Outcome",
      "keyDataPoints": {
        "meetingDate": "July 24, 2025",
        "decisionsTaken":
      }
    }
    Example 2: Investor Relations (Illustrates Link Extraction)
    Input Text: Based on the Niva Bupa Health Insurance document.
    
    JSON
    
    {
      "source": "Corporate Filing",
      "primaryCategory": "Investor Relations",
      "specificEvent": "Analyst/Investor Meet",
      "keyDataPoints": {
        "eventType": "Earnings call",
        "date": "July 31, 2025",
        "time": "17:30 hours IST",
        "purpose": "To discuss the Unaudited Financial Results for the quarter ended June 30, 2025",
        "relevantLinks": {
          "registrationUrl": "Copy this URL in your browser: Link",
          "universalAccess": "+91 22 6280 1144 / +91 22 7115 8045",
          "internationalTollFree": {
            "singapore": "8001012045",
            "hongKong": "800964448",
            "uk": "08081011573",
            "usa": "18667462133"
          }
        }
      }
    }
    
    Input Notification Text:
    
    NOTIFICATION_TEXT_HERE
    
    `
const GUIDANCE_TABLE_PROMPT = `
The Markdown Guidance Table Standardizer Prompt (V2.2 - Simplified)

Role and Goal:
You are an expert Markdown formatter. Your sole task is to find a section in a document related to financial guidance and ensure the specific targets are in a clean Markdown table directly under the main guidance heading.

Input:
You will receive the full text of an earnings call summary in Markdown format.

--- START OF DOCUMENT ---
[PASTE FULL MARKDOWN HERE]
--- END OF DOCUMENT ---

Instructions:

1.  **Locate the Target Section:** Scan the document for a heading containing the words "Guidance", "Outlook", or "Targets". For example, "## 4. Guidance, Outlook & Targets:".

2.  **Identify and Extract Targets:** Look for specific, quantifiable targets listed under this heading. They might be in a list format (e.g., "* Metric: Revenue...") or in a pre-existing table.

3.  **Rebuild the Section:**
    * Keep the main heading (e.g., "## 4. Guidance, Outlook & Targets:").
    * Keep any general text or commentary (like a "Management Commentary" paragraph).
    * **Remove** any intermediate sub-headings or bullet points like "* **Key Targets & Commitments:**".
    * Create a single, clean Markdown table directly under the main heading (or after the commentary).
    * The table MUST use these exact headers: \`| Metric | Target Value | Timeframe |\`
    * Populate the table with all the extracted targets.

4.  **Preserve Everything Else (CRITICAL):** Do not alter any other part of the document (e.g., sections about "Financials & Execution" or "Order Book"). Your only changes should be within the identified guidance section.

5.  **Handle Edge Cases:**
    * If the section already exists in the desired format (a clean table directly under the main heading without extra sub-headings), return the original document unchanged.
    * If the section contains only commentary and no quantifiable targets, leave it as is.
    * If there is no guidance section, return the original document unchanged.

Final Output:
Return ONLY the full, raw Markdown text of the entire document. Do not add any conversational text or code block fences.
`;
class ConferenceCallNotes {
    constructor() {
        this.initializeFirebase();
        this.db = admin.firestore();
        this.collectionName = 'documents';
        this.industryPromptsMap = new Map();
        this.initializeGeminiKeys();
        this.successfulResponses = 0; // Add counter for successful responses
    }

    initializeGeminiKeys() {
        // Initialize multiple Gemini API keys
        this.geminiKeys = [];

        // Add all available keys from environment variables
        const keyCount = parseInt(process.env.GEMINI_KEY_COUNT) || 1;

        for (let i = 1; i <= keyCount; i++) {
            const keyName = i === 1 ? 'GEMINI_API_KEY' : `GEMINI_API_KEY_${i}`;
            const key = process.env[keyName];

            if (key) {
                this.geminiKeys.push({
                    key: key,
                    name: keyName,
                    isBlocked: false,
                    lastUsed: null,
                    errorCount: 0
                });
            }
        }

        if (this.geminiKeys.length === 0) {
            console.error('❌ No Gemini API keys found in environment variables');
            process.exit(1);
        }

        console.log(`✅ Initialized ${this.geminiKeys.length} Gemini API keys`);
        this.currentKeyIndex = 0;
    }

    getCurrentKey() {
        // Find next available key
        for (let i = 0; i < this.geminiKeys.length; i++) {
            const keyIndex = (this.currentKeyIndex + i) % this.geminiKeys.length;
            const keyInfo = this.geminiKeys[keyIndex];

            if (!keyInfo.isBlocked) {
                this.currentKeyIndex = keyIndex;
                return keyInfo;
            }
        }

        // If all keys are blocked, reset and use the first one
        console.warn('⚠️  All keys appear to be blocked, resetting...');
        this.resetAllKeys();
        return this.geminiKeys[0];
    }

    markKeyAsBlocked(keyInfo, error) {
        keyInfo.isBlocked = true;
        keyInfo.errorCount++;
        keyInfo.lastError = error;
        keyInfo.blockedAt = new Date().toISOString();

        console.warn(`🚫 Marked key ${keyInfo.name} as blocked due to: ${error}`);

        // Auto-unblock after 1 hour (adjust as needed)
        setTimeout(() => {
            this.unblockKey(keyInfo);
        }, 60 * 60 * 1000); // 1 hour
    }

    unblockKey(keyInfo) {
        keyInfo.isBlocked = false;
        console.log(`✅ Unblocked key ${keyInfo.name}`);
    }

    resetAllKeys() {
        this.geminiKeys.forEach(key => {
            key.isBlocked = false;
            key.errorCount = 0;
        });
        this.currentKeyIndex = 0;
        console.log('🔄 Reset all API keys');
    }

    moveToNextKey() {
        this.currentKeyIndex = (this.currentKeyIndex + 1) % this.geminiKeys.length;
        console.log(`🔄 Switched to next key (index: ${this.currentKeyIndex})`);
    }

    initializeFirebase() {
        try {
            const serviceAccount = {
                type: "service_account",
                project_id: process.env.FIREBASE_PROJECT_ID,
                private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
                private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
                client_email: process.env.FIREBASE_CLIENT_EMAIL,
                client_id: process.env.FIREBASE_CLIENT_ID,
                auth_uri: process.env.FIREBASE_AUTH_URI,
                token_uri: process.env.FIREBASE_TOKEN_URI,
                auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
                client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL
            };

            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });

            console.log('✅ Firebase initialized successfully');
        } catch (error) {
            console.error('❌ Firebase initialization failed:', error.message);
            process.exit(1);
        }
    }

    // Utility method to test Firestore connection
    async testConnection() {
        try {
            const testDoc = await this.db.collection('test').limit(1).get();
            console.log('✅ Firestore connection successful');
            return true;
        } catch (error) {
            console.error('❌ Firestore connection failed:', error.message);
            return false;
        }
    }

    async readIndustryPrompts() {
        const snapshot = await this.db.collection('industryPrompts').get();
        snapshot.forEach(doc => {
            const industryPromptData = doc.data();
            const { link, analystPrompt } = industryPromptData;
            this.industryPromptsMap.set(link, analystPrompt);
        });
    }

    async cleanDuplicateDocuments() {
        try {
            console.log('🚀 Starting to process filing documents...');

            const snapshot = await this.db.collection(this.collectionName).get();

            if (snapshot.empty) {
                console.log('📭 No documents found in collection');
                return;
            }

            // Group documents by company code in a single pass
            const companiesMap = new Map();

            snapshot.docs.forEach(doc => {
                const data = doc.data();
                const companyCode = data.companyCode;

                // Count concalls with markdown output
                const concalls = data.documents?.['Concalls'];
                const concallsWithMarkdown = Array.isArray(concalls)
                    ? concalls.filter(item => !!item.markdownOutput).length
                    : 0;

                if (!companiesMap.has(companyCode)) {
                    companiesMap.set(companyCode, []);
                }

                companiesMap.get(companyCode).push({
                    id: doc.id,
                    data: data,
                    concallsWithMarkdown: concallsWithMarkdown
                });
            });

            console.log(`📋 Found ${companiesMap.size} unique companies`);

            // Process each company's documents and collect deletion promises
            const deletePromises = [];
            let totalDeleted = 0;

            for (const [companyCode, documents] of companiesMap) {
                if (documents.length <= 1) {
                    continue; // Skip companies with only one document
                }

                // Find the document to keep and merge concalls
                const docToKeep = documents.reduce((best, current) => {
                    if (current.concallsWithMarkdown > best.concallsWithMarkdown) {
                        return current;
                    }
                    if (current.concallsWithMarkdown === best.concallsWithMarkdown) {
                        return best; // Keep the first one
                    }
                    return best;
                });

                // Merge all unique concalls and announcements from all documents for this company
                const allConcalls = new Map();
                const allAnnouncements = new Map();

                // Helper function to create a unique key for concall entry
                const createConcallKey = (concall) => {
                    // Use quarter as the primary identifier since it uniquely identifies a conference call period
                    // Fallback to link+pptLink for entries without quarter field
                    if (concall.quarter) {
                        return `quarter:${concall.quarter}`;
                    }
                    return `links:${concall.link || 'no-link'}_${concall.pptLink || 'no-ppt'}`;
                };

                // Helper function to create a unique key for announcement entry
                const createAnnouncementKey = (announcement) => {
                    return `${announcement.link || 'no-link'}_${announcement.title || 'no-title'}_${announcement.date || 'no-date'}`;
                };

                // Collect all concalls and announcements from all documents
                documents.forEach(doc => {
                    const concalls = doc.data.documents?.['Concalls'];
                    const announcements = doc.data.documents?.['Announcements'];

                    // Process concalls
                    if (Array.isArray(concalls)) {
                        concalls.forEach(concall => {
                            const key = createConcallKey(concall);

                            if (!allConcalls.has(key)) {
                                // First time seeing this quarter, just add it
                                allConcalls.set(key, concall);
                            } else {
                                // Merge with existing entry, prioritizing processed content
                                const existing = allConcalls.get(key);
                                const merged = {
                                    // Start with the existing entry
                                    ...existing,
                                    // Merge links - prefer non-empty values
                                    link: concall.link || existing.link,
                                    pptLink: concall.pptLink || existing.pptLink,
                                    recLink: concall.recLink || existing.recLink,
                                    // Prefer processed content (markdownOutput, summary, etc.)
                                    markdownOutput: concall.markdownOutput || existing.markdownOutput,
                                    summary: concall.summary || existing.summary,
                                    isProcessed: concall.isProcessed || existing.isProcessed,
                                    processingDate: concall.processingDate || existing.processingDate,
                                    textLength: concall.textLength || existing.textLength,
                                    isGuidanceTableStandardized: concall.isGuidanceTableStandardized || existing.isGuidanceTableStandardized,
                                    guidanceTableStandardizedDate: concall.guidanceTableStandardizedDate || existing.guidanceTableStandardizedDate,
                                    // Keep processing errors if they exist
                                    processingError: concall.processingError || existing.processingError,
                                    guidanceTableStandardizationError: concall.guidanceTableStandardizationError || existing.guidanceTableStandardizationError
                                };
                                allConcalls.set(key, merged);
                            }
                        });
                    }

                    // Process announcements
                    if (Array.isArray(announcements)) {
                        announcements.forEach(announcement => {
                            const key = createAnnouncementKey(announcement);

                            // If this announcement doesn't exist yet, add it
                            if (!allAnnouncements.has(key)) {
                                allAnnouncements.set(key, announcement);
                            }
                        });
                    }
                });

                // Update the document to keep with merged concalls and announcements
                if (allConcalls.size > 0 || allAnnouncements.size > 0) {
                    const mergedConcalls = Array.from(allConcalls.values());
                    const mergedAnnouncements = Array.from(allAnnouncements.values());
                    const updatedData = {
                        ...docToKeep.data,
                        documents: {
                            ...docToKeep.data.documents,
                            'Concalls': mergedConcalls,
                            'Announcements': mergedAnnouncements
                        }
                    };

                    // Update the document in the database with merged data
                    await this.db.collection(this.collectionName).doc(docToKeep.id).update({
                        documents: updatedData.documents
                    });

                    console.log(`🔄 Updated document ${docToKeep.id} with ${mergedConcalls.length} merged concalls (${mergedConcalls.filter(c => c.markdownOutput).length} with markdown) and ${mergedAnnouncements.length} merged announcements`);
                }

                // Mark other documents for deletion
                const docsToDelete = documents.filter(doc => doc.id !== docToKeep.id);

                for (const doc of docsToDelete) {
                    deletePromises.push(
                        this.db.collection(this.collectionName).doc(doc.id).delete()
                            .then(() => {
                                console.log(`🗑️ Deleted document ${doc.id} for company ${doc.data.name}`);
                            })
                            .catch(error => {
                                console.error(`❌ Failed to delete document ${doc.id} for company ${doc.data.name}:`, error.message);
                                throw error;
                            })
                    );
                    totalDeleted++;
                }

                if (docsToDelete.length > 0) {
                    console.log(`📊 Company ${docToKeep.data.name}: Keeping document with ${docToKeep.concallsWithMarkdown} concalls, deleting ${docsToDelete.length} duplicates`);
                }
            }

            // Execute all deletions concurrently
            if (deletePromises.length > 0) {
                await Promise.all(deletePromises);
                console.log(`🗑️ Successfully deleted ${totalDeleted} duplicate documents`);
            } else {
                console.log('✨ No duplicate documents found');
            }

            console.log('✅ Finished processing all companies');

        } catch (error) {
            console.error('❌ Error in cleanDuplicateDocuments:', error.message);
            throw error;
        }
    }

    async readAllFilingDocuments() {
        try {
            console.log('🚀 Starting to process filing documents...');

            const snapshot = await this.db.collection(this.collectionName).get();

            if (snapshot.empty) {
                console.log('📭 No documents found in collection');
                return;
            }

            console.log(`📋 Found ${snapshot.size} documents to process`);

            for (const doc of snapshot.docs) {
                try {
                    await this.processConcallsDocument(doc);
                    // await this.processAnnouncementDocument(doc);
                } catch (error) {
                    console.error(`❌ Error processing document ${doc.id}:`, error.message);
                    continue;
                }
            }

            console.log('✅ Finished processing all documents');
        } catch (error) {
            console.error('❌ Error in readAllFilingDocuments:', error.message);
            throw error;
        }
    }

    async processAnnouncementDocument(doc) {
        const docData = doc.data();
        const name = docData?.name || '';
        const announcementList = docData?.documents?.['Announcements'] || [];
        const industryLink = docData?.['industryLink'] || '';

        console.log(`📢 Processing announcements for: ${name}`);
        console.log(`🏭 Industry link: ${industryLink}`);
        console.log(`📋 Announcements found: ${announcementList.length}`);

        if (doc?.data().companyCode === "406" || doc?.data().companyCode === "295") {
            return;
        }

        if (announcementList.length === 0) {
            console.log(`⏭️  No announcements found for document ${doc.id}`);
            return;
        }

        const updatedAnnouncements = await this.processAnnouncements(announcementList, ANNOUNCEMENT_CALENDAR_PROMPT);

        if (updatedAnnouncements.some(announcement => announcement.isProcessed && !(announcement.parsedResponse.date === "2024-10-27"))) {
            await this.updateAnnouncementsInFirestore(doc.id, updatedAnnouncements);
            console.log(`💾 Updated announcements for document ${doc.id} in Firestore`);
        }
    }
    async processConcallsDocument(doc) {
        const docData = doc.data();
        const name = docData?.name || '';
        const conCallList = docData?.documents?.['Concalls'] || [];
        const industryLink = docData?.['industryLink'] || '';

        console.log(`📄 Processing documents for : ${name}`);
        console.log(`🏭 Industry link: ${industryLink}`);
        console.log(`📞 Conference calls found: ${conCallList.length}`);

        if (doc?.data().companyCode === "406" || doc?.data().companyCode === "295")
            return;
        if (conCallList.length === 0) {
            console.log(`⏭️  No conference calls found for document ${doc.id}`);
            return;
        }

        const industryPrompt = this.industryPromptsMap.get(industryLink);
        if (!industryPrompt) {
            console.warn(`⚠️  No industry prompt found for link: ${industryLink}`);
            return;
        }

        const updatedConCalls = await this.processConferenceCalls(conCallList, industryPrompt);

        if (updatedConCalls.some(call => call.isProcessed)) {
            await this.updateDocumentInFirestore(doc.id, updatedConCalls);
            console.log(`💾 Updated document ${doc.id} in Firestore`);
        }
    }

    async processAnnouncements(announcementList, prompt) {
        const updatedAnnouncements = [];

        for (const [index, announcement] of announcementList.entries()) {
            if (index < 10) {
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

        for (const [index, conCall] of conCallList.entries()) {
            if (index < 16) {
                try {
                    console.log(`📞 Processing conference call ${index + 1}/${conCallList.length}`);

                    if (conCall.isProcessed) {
                        console.log(`⏭️  Conference call ${index + 1} already processed`);
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
                        continue;
                    }

                    const processedCall = await this.processSingleConferenceCall(conCall, industryPrompt);
                    updatedConCalls.push(processedCall);

                } catch (error) {
                    console.error(`❌ Error processing conference call ${index + 1}:`, error.message);
                    updatedConCalls.push({
                        ...conCall,
                        isProcessed: false,
                        processingError: error.message,
                        processingDate: new Date().toISOString()
                    });
                }
            } else {
                updatedConCalls.push(conCall);
            }
        }

        return updatedConCalls;
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
            const { parsedResponse } = await this.generateEventWithGemini(pdfText, updatedPrompt);

            // Debug: Log the type and content of parsedResponse
            console.log('📊 parsedResponse type:', typeof parsedResponse);
            console.log('📊 parsedResponse content:', parsedResponse);

            // You can now access properties directly like:
            // parsedResponse.type, parsedResponse.date, parsedResponse.time, etc.

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

            const { summary, markdownOutput } = await this.generateSummaryWithGemini(pdfText, industryPrompt);

            return {
                ...conCall,
                summary: summary,
                markdownOutput: markdownOutput,
                isProcessed: true,
                processingDate: new Date().toISOString(),
                textLength: pdfText.length
            };

        } catch (error) {
            console.error(`❌ Error processing single conference call:`, error.message);
            throw error;
        }
    }

    async generateSummaryWithGemini(pdfText, industryPrompt) {
        try {
            console.log('🤖 Generating summary with Gemini API...');
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

            const response = await this.callGeminiAPIWithRetry(prompt);
            const parsedResponse = this.parseStructuredResponse(response);

            return {
                summary: parsedResponse.summary || 'Summary generation failed',
                markdownOutput: parsedResponse.markdownOutput || '# Analysis\n\nMarkdown generation failed'
            };

        } catch (error) {
            console.error('❌ Error generating summary with Gemini:', error.message);
            throw new Error(`Gemini API error: ${error.message}`);
        }
    }

    async generateEventWithGemini(pdfText, prompt) {

        try {
            console.log('🤖 Generating summary with Gemini API...');
            const calendarPrompt = prompt.replace("[Paste Announcement Here]", pdfText);

            const response = await this.callGeminiAPIWithRetry(calendarPrompt);
            // console.log('Raw response:', response);

            // Parse the JSON response from Gemini
            let parsedResponse = removeMarkdownCodeBlock(response);
            parsedResponse = JSON.parse(parsedResponse);

            console.log(parsedResponse);
            return {
                parsedResponse
            };

        } catch (error) {
            console.error('❌ Error generating summary with Gemini:', error.message);
            throw new Error(`Gemini API error: ${error.message}`);
        }
    }

    async callGeminiAPIWithRetry(prompt, maxRetries = null) {
        const totalRetries = maxRetries || this.geminiKeys.length;
        let lastError = null;

        for (let attempt = 0; attempt < totalRetries; attempt++) {
            try {
                const keyInfo = this.getCurrentKey();
                console.log(`🔑 Attempting with key: ${keyInfo.name} (attempt ${attempt + 1}/${totalRetries})`);

                const response = await this.callGeminiAPI(prompt, keyInfo.key);

                // Update key usage info and increment successful responses counter
                keyInfo.lastUsed = new Date().toISOString();
                keyInfo.errorCount = 0;
                this.successfulResponses++; // Increment counter on successful response

                console.log(`✅ Successfully generated response with key: ${keyInfo.name}`);
                return response;

            } catch (error) {
                lastError = error;
                const keyInfo = this.getCurrentKey();

                console.error(`❌ Error with key ${keyInfo.name}:`, error.message);

                // Check if it's a 429 error (rate limit) or quota exceeded
                if (this.isRateLimitError(error)) {
                    console.warn(`🚫 Rate limit hit for key ${keyInfo.name}, switching to next key...`);
                    this.markKeyAsBlocked(keyInfo, error.message);
                    this.moveToNextKey();

                    // Add delay before trying next key
                    await this.delay(1000);
                    continue;
                } else {
                    // For non-rate-limit errors, still try next key but don't block current one
                    console.warn(`⚠️  Non-rate-limit error with key ${keyInfo.name}, trying next key...`);
                    this.moveToNextKey();
                    await this.delay(500);
                    continue;
                }
            }
        }

        // If we've exhausted all retries
        console.error(`❌ All retry attempts failed. Last error: ${lastError?.message}`);
        throw new Error(`All Gemini API keys exhausted. Last error: ${lastError?.message}`);
    }

    isRateLimitError(error) {
        const errorMessage = error.message?.toLowerCase() || '';
        const errorString = error.toString?.()?.toLowerCase() || '';

        return (
            errorMessage.includes('429') ||
            errorMessage.includes('rate limit') ||
            errorMessage.includes('quota') ||
            errorMessage.includes('too many requests') ||
            errorString.includes('429') ||
            errorString.includes('rate limit') ||
            errorString.includes('quota')
        );
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    parseStructuredResponse(response) {
        try {
            console.log('📝 Parsing structured response...');

            const summaryMatch = response.match(/===SUMMARY_START===([\s\S]*?)===SUMMARY_END===/);
            const markdownMatch = response.match(/===MARKDOWN_START===([\s\S]*?)===MARKDOWN_END===/);

            const summary = summaryMatch ? summaryMatch[1].trim() : null;
            const markdownOutput = markdownMatch ? markdownMatch[1].trim() : null;

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
            const paragraphs = response.split('\n\n').filter(p => p.trim().length > 0);
            const summary = paragraphs.slice(0, 2).join(' ').substring(0, 1000);
            const markdownOutput = `# Conference Call Analysis

            ## Executive Summary
            ${paragraphs.slice(0, 2).join('\n\n')}
            
            ## Detailed Analysis
            ${paragraphs.slice(2).join('\n\n')}`;

            return { summary, markdownOutput };

        } catch (error) {
            console.error('Alternative parsing failed:', error.message);
            return {
                summary: response.substring(0, 500) + '...',
                markdownOutput: `# Conference Call Analysis\n\n${response}`
            };
        }
    }

    async callGeminiAPI(prompt, apiKey) {
        try {
            if (!apiKey) {
                throw new Error('No API key provided');
            }

            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({
                model: process.env.GEMINI_PRIMARY_MODEL || 'gemini-2.5-flash'
            });

            const generationConfig = {
                temperature: parseFloat(process.env.GEMINI_TEMPERATURE) || 0.7,
                topK: parseInt(process.env.GEMINI_TOP_K) || 40,
                topP: parseFloat(process.env.GEMINI_TOP_P) || 0.95,
                maxOutputTokens: parseInt(process.env.GEMINI_MAX_OUTPUT_TOKENS) || 100000,
            };

            const result = await model.generateContent({
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig,
            });

            const response = await result.response;
            const text = response.text();

            if (!text) {
                throw new Error('No text returned from Gemini API');
            }

            return text;

        } catch (error) {
            console.error('Gemini API Error:', error.message);
            throw error; // Re-throw to be caught by retry logic
        }
    }

    async updateAnnouncementsInFirestore(docId, updatedAnnouncements) {
        try {
            await this.db.collection(this.collectionName).doc(docId).update({
                'documents.Announcements': updatedAnnouncements,
                lastProcessed: new Date().toISOString()
            });
            console.log(`✅ Successfully updated announcements for document ${docId}`);
        } catch (error) {
            console.error(`❌ Error updating announcements for document ${docId}:`, error.message);
            throw error;
        }
    }

    async updateDocumentInFirestore(docId, updatedConCalls) {
        try {
            await this.db.collection(this.collectionName).doc(docId).update({
                'documents.Concalls': updatedConCalls,
                lastProcessed: new Date().toISOString()
            });
            console.log(`✅ Successfully updated document ${docId}`);
        } catch (error) {
            console.error(`❌ Error updating document ${docId}:`, error.message);
            throw error;
        }
    }

    // Method to get current API key status
    getKeyStatus() {
        return this.geminiKeys.map((key, index) => ({
            index,
            name: key.name,
            isBlocked: key.isBlocked,
            errorCount: key.errorCount,
            lastUsed: key.lastUsed,
            isCurrent: index === this.currentKeyIndex
        }));
    }

    // Method to manually reset a specific key
    resetKey(keyName) {
        const key = this.geminiKeys.find(k => k.name === keyName);
        if (key) {
            this.unblockKey(key);
            console.log(`🔄 Manually reset key: ${keyName}`);
        }
    }
    /*
    **
    * Method to generate guidance tracker for a company using all its markdownOutput
    * @param {string} companyCode - The company code to process
    * @returns {Promise<boolean>} - Success status
    */
    async generateGuidanceTracker(companyCode) {
        try {
            console.log(`🎯 Starting guidance tracker generation for company: ${companyCode}`);

            // Find the document for this company
            const snapshot = await this.db.collection(this.collectionName)
                .where('companyCode', '==', companyCode)
                .get();

            if (snapshot.empty) {
                console.log(`📭 No documents found for company: ${companyCode}`);
                return false;
            }

            // Get the first document (should be unique after cleaning duplicates)
            const doc = snapshot.docs[0];
            const docData = doc.data();
            const conCallList = docData?.documents?.['Concalls'] || [];

            console.log(`📞 Found ${conCallList.length} conference calls for ${docData.name}`);

            // Filter conference calls that have markdownOutput
            const processedCalls = conCallList.filter((call, index) =>
                call.markdownOutput && call.markdownOutput.trim().length > 0 && index < 16
            );

            //reverse processedCalls array
            processedCalls.reverse();

            if (processedCalls.length === 0) {
                console.log(`⚠️  No processed conference calls with markdownOutput found for ${companyCode}`);
                return false;
            }
            // processedCalls.reverse();
            console.log(`📝 Found ${processedCalls.length} processed conference calls with markdownOutput`);

            // Sort by date if available, otherwise by index
            const sortedCalls = this.sortConferenceCallsByDate(processedCalls);

            // Create the formatted input for the Gemini prompt
            const formattedInput = this.formatMarkdownForTracker(sortedCalls);

            console.log(`📋 Formatted input length: ${formattedInput.length} characters`);

            // Generate the guidance tracker using Gemini
            const trackerResult = await this.generateTrackerWithGemini(formattedInput);

            // Save the tracker result to the document
            await this.saveTrackerToFirestore(doc.id, trackerResult);

            console.log(`✅ Successfully generated and saved guidance tracker for ${companyCode}`);
            return true;

        } catch (error) {
            console.error(`❌ Error generating guidance tracker for ${companyCode}:`, error.message);
            throw error;
        }
    }

    /**
     * Sort conference calls by date using quarter field (e.g., "Jun2025")
     * @param {Array} conCalls - Array of conference call objects
     * @returns {Array} - Sorted array of conference calls
     */
    sortConferenceCallsByDate(conCalls) {
        return conCalls.sort((a, b) => {
            // First priority: sort by quarter field if available
            if (a.quarter && b.quarter) {
                const dateA = this.parseQuarterToDate(a.quarter);
                const dateB = this.parseQuarterToDate(b.quarter);

                if (dateA && dateB) {
                    return dateA - dateB;
                }
            }

            // Second priority: sort by date field if available
            if (a.date && b.date) {
                return new Date(a.date) - new Date(b.date);
            }

            // Third priority: sort by processingDate
            if (a.processingDate && b.processingDate) {
                return new Date(a.processingDate) - new Date(b.processingDate);
            }

            // If only one has quarter, prioritize it
            if (a.quarter && !b.quarter) {
                return -1;
            }
            if (!a.quarter && b.quarter) {
                return 1;
            }

            // If no sortable dates, maintain original order
            return 0;
        });
    }

    /**
     * Parse quarter string (e.g., "Jun2025") to Date object
     * @param {string} quarter - Quarter string like "Jun2025", "Dec2024", etc.
     * @returns {Date|null} - Parsed date or null if invalid
     */
    parseQuarterToDate(quarter) {
        try {
            if (!quarter || typeof quarter !== 'string') {
                return null;
            }

            // Extract first 3 characters (month) and remaining characters (year)
            const monthStr = quarter.slice(0, 3).toLowerCase();
            const yearStr = quarter.slice(3);

            // Parse year
            const year = parseInt(yearStr);
            if (isNaN(year)) {
                return null;
            }

            // Map month abbreviations to month numbers (0-based for JavaScript Date)
            const monthMap = {
                'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3,
                'may': 4, 'jun': 5, 'jul': 6, 'aug': 7,
                'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
            };

            const monthIndex = monthMap[monthStr];
            if (monthIndex === undefined) {
                console.warn(`⚠️  Unknown month abbreviation: ${monthStr} in quarter: ${quarter}`);
                return null;
            }

            // Create date object (using 1st day of the month)
            const date = new Date(year, monthIndex, 1);

            // Validate the created date
            if (isNaN(date.getTime())) {
                console.warn(`⚠️  Invalid date created from quarter: ${quarter}`);
                return null;
            }

            return date;

        } catch (error) {
            console.warn(`⚠️  Error parsing quarter "${quarter}":`, error.message);
            return null;
        }
    }

    /**
     * Format markdown outputs for the tracker prompt
     * @param {Array} sortedCalls - Sorted conference call objects
     * @returns {string} - Formatted string for Gemini prompt
     */
    formatMarkdownForTracker(sortedCalls) {
        let formattedInput = '';

        sortedCalls.forEach((call, index) => {
            // Create a period identifier
            const periodId = call.quarter;

            formattedInput += `--- START OF SUMMARY: ${periodId} ---\n`;
            formattedInput += call.markdownOutput;
            formattedInput += `\n--- END OF SUMMARY: ${periodId} ---\n\n`;
        });

        return formattedInput.trim();
    }

    /**
     * Generate a period identifier for each conference call
     * @param {Object} call - Conference call object
     * @param {number} index - Index of the call
     * @returns {string} - Period identifier
     */
    generatePeriodId(call, index) {
        // Try to extract period from the call data
        if (call.period) {
            return call.period;
        }

        // Try to extract from title or other fields
        if (call.title) {
            // Look for patterns like "Q1 FY25", "Q2 2024", etc.
            const quarterMatch = call.title.match(/Q[1-4]\s*(?:FY|CY)?\s*\d{2,4}/i);
            if (quarterMatch) {
                return quarterMatch[0];
            }
        }

        // Try to extract from date
        if (call.date) {
            const date = new Date(call.date);
            const year = date.getFullYear();
            const month = date.getMonth() + 1;
            const quarter = Math.ceil(month / 3);
            return `Q${quarter} ${year}`;
        }

        // Fallback to index-based naming
        return `Period ${index + 1}`;
    }

    /**
     * Generate tracker using Gemini API
     * @param {string} formattedInput - Formatted markdown input
     * @returns {Promise<Object>} - Parsed tracker result
     */
    async generateTrackerWithGemini(formattedInput) {
        try {
            console.log('🤖 Generating guidance tracker with Gemini API...');

            const trackerPrompt = `Role and Goal:
                You are an expert financial accountability analyst and a meticulous JSON generator. Your primary objective is to create a comprehensive, multi-period tracker of a company's guidance and commitments. You will be given a single text input containing a chronological series of historical earnings call summaries, each clearly separated by unique delimiters.
            Your task is to identify ALL distinct, forward-looking targets and commitments made across ALL provided periods, trace each one's history, and present the findings in a structured JSON format with a precise final status.

            Input:
                ${formattedInput}

            Instructions for Analysis and Output Generation:

                1.  **Parse and Identify All Unique Targets:**
        *   Go through each summary block, identified by its --- START OF SUMMARY... and --- END OF 'SUMMARY... delimiters, in chronological order.
            *   In each summary's "Key Targets & Commitments" section, identify every commitment listed.
            *   Create a master list of all unique commitments. A commitment is unique based on its metric. **If a target for the same metric is introduced with a new timeframe (e.g., FY26 guidance after FY25 guidance is complete), treat it as a new, distinct commitment.**

            2.  **Contextualize Each Metric (CRITICAL):**
        *   When defining the metric field, you **MUST** provide sufficient context. Do not use generic names like "Revenue Guidance."
            *   **Bad Example:** "metric": "Revenue Growth"
            *   **Good Example:** "metric": "Consolidated Revenue Growth Guidance" or "metric": "Auto Components Segment - Export Revenue Target".
            *   Look for keywords in the summary that specify the segment, geography, product line, or business unit the target applies to and include them in the metric name for clarity.

                3.  **Trace Each Commitment's History:**
            *   For each unique commitment from your master list, find the period in which it was first introduced. This is its "origin period."
            *   Then, trace its history through all subsequent summary blocks up to the most recent one to find relevant updates.

            4.  **Construct the Structured Historical Narrative:**
        *   For each commitment, populate the historical_tracker_and_evolution field. This field MUST be an **array of objects**.
        *   Each object in the array represents an update from a specific period and MUST have two keys: 'period' (e.g., "Q4 FY25") and 'update' (a concise summary of the update with key data or quotes).
        *   **Crucially, only include objects for periods where a relevant, meaningful update was provided.** Do not include entries for periods with no mention of the target.
            *   **Do NOT include an update from the same period in which the target was introduced.** The introduction details are captured in other fields.

            5.  **Determine and Assign an Intelligent Final Status (CRITICAL):**
        *   To determine the status, you must **compare the target's timeframe with the latest period provided in the input summaries.** For example, if a target was for "FY25" and the latest summary is "Q1 FY26," the deadline has passed.
            *   Based **only** on the information in the **latest available summary block**, assign a final status. You MUST use one, and only one, of the following predefined status tags. Apply the definitions strictly:
                *   **Achieved**: The deadline has passed, and the latest summary explicitly confirms the target was met or exceeded. *Example: FY25 revenue growth target of 15% is confirmed as 16% in the Q4 FY25 summary.*
            *   **On Track**: The deadline is in the future, and management commentary is positive or neutral, indicating progress is as expected. *Example: A project due in FY26 is mentioned as "proceeding smoothly" in the latest FY25 summary.*
            *   **Delayed/Revised**: The timeline, scope, or value of the target has been officially changed or pushed back by management in any of the summaries. *Example: A launch planned for Q1 is now expected in Q2.*
            *   **At Risk**: The deadline is in the future, but management has explicitly expressed concern, uncertainty, or highlighted significant headwinds that could prevent the target from being met. *Example: "Achieving this will be challenging due to market conditions."*
            *   **Missed**: The deadline for the target has passed, and the latest summary either confirms it was not met or provides no confirmation of achievement. **If the deadline is passed and there's no update, assume it is Missed.**
            *   **Abandoned**: Management has explicitly stated they are no longer pursuing this target or have replaced it with a different strategy.
            *   **Ongoing**: Use this **only** for broad, continuous strategic initiatives that do not have a specific, measurable end-date or value. *Example: "Continue to focus on cost optimization" or "Executing on our premiumization strategy."* **Do not use "In Progress".**

            6.  **CRITICAL RULE FOR JSON VALIDITY:**
        *   When generating the JSON, you **MUST** ensure all string values are correctly formatted.
            *   If any string value (like in the 'update' or 'metric' fields) contains a double quote character ("), you **MUST** escape it with a backslash (\\").
            *   **Example of Correct Escaping:** If the summary says 'Management stated, "We are on track."', the JSON should be "update": "Management stated, \\"We are on track.\\"".

            7.  **Final Quality Check - CRITICAL:**
        *   Before generating the final output, review your entire JSON structure.
            *   **PAY SPECIAL ATTENTION TO DOUBLE QUOTES AND TRAILING COMMAS.**
            *   Confirm all keys are quoted.
            *   **Verify your final_status logic.** Has the deadline for the target passed? If so, the status cannot be 'On Track'. Is the goal continuous? If so, 'Ongoing' is appropriate.

            8.  **Structure the Final JSON Output:**
        *   Present your findings as a single, well-formatted JSON object.
            *   The JSON should have a single key, 'guidance_tracker', whose value is an array of objects.
            *   Each object in the array represents a tracked commitment and **must have exactly the following five fields**:
        *   'metric': A concise, **context-rich** name for the target.
            *   'original_target': The specific value, outcome, or milestone being aimed for.
        *   'origin_period': The period in which this specific target was first introduced.
            *   'historical_tracker_and_evolution': An array of objects, as described in instruction #4. If there are no subsequent updates, this should be an empty array [].
            *   'final_status': The final status tag, as described in instruction #5.
            *   Organize the commitment objects in the array chronologically based on their 'origin_period'.
            *   **Return ONLY a valid JSON object.** Do not include any extra conversational text, introductions, or Markdown formatting. Simply provide the raw JSON.`

            const response = await this.callGeminiAPIWithRetry(trackerPrompt);
            console.log(response);
            const parsedTracker = this.parseTrackerResponse(response);

            console.log('✅ Successfully generated guidance tracker');
            return parsedTracker;

        } catch (error) {
            console.error('❌ Error generating tracker with Gemini:', error.message);
            throw new Error(`Gemini tracker generation error: ${error.message}`);
        }
    }

    /**
     * Parse the tracker response from Gemini
     * @param {string} response - Raw response from Gemini
     * @returns {Object} - Parsed tracker object
     */
    parseTrackerResponse(response) {
        try {
            console.log('📝 Starting robust parsing of tracker response...');

            // 1. Initial Cleaning (same as before)
            let cleanResponse = response.trim();
            cleanResponse = cleanResponse.replace(/^```json\n?/i, '').replace(/\n?```$/i, '');
            cleanResponse = cleanResponse.replace(/^```\n?/i, '').replace(/\n?```$/i, '');

            // ---- START OF ROBUST FIXES ----

            // 2. Fix Unescaped Double Quotes within string values (Heuristic approach)
            // This is tricky but we can try a regex. This looks for a quote that is not preceded by a backslash
            // and is followed by non-comma/brace/bracket characters, suggesting it's inside a string.
            // This is a common pattern: "key": "some text "with a quote" inside"
            // We replace " with \"
            cleanResponse = cleanResponse.replace(/:\s*"(.*?[^\\])"(.*?)"/g, (match, p1, p2) => {
                // This is a complex replacement to avoid breaking valid JSON.
                // A simpler, more aggressive approach is often sufficient for LLM output:
                return match; // For now, we will skip complex regex and use a simpler fix later if needed.
            });


            // 3. Fix Trailing Commas (Very Common & Easy to Fix)
            // This regex removes commas that are followed by a closing brace } or bracket ]
            // cleanResponse = cleanResponse.replace(/,\s*([}\]])/g, "$1");
            //
            // // 4. Attempt to complete a truncated JSON object/array
            // const openBraces = (cleanResponse.match(/{/g) || []).length;
            // const closeBraces = (cleanResponse.match(/}/g) || []).length;
            // const openBrackets = (cleanResponse.match(/\[/g) || []).length;
            // const closeBrackets = (cleanResponse.match(/]/g) || []).length;
            //
            // if (openBraces > closeBraces) {
            //     console.warn('⚠️ Detected unclosed curly braces. Attempting to fix.');
            //     cleanResponse += '}'.repeat(openBraces - closeBraces);
            // }
            // if (openBrackets > closeBrackets) {
            //     console.warn('⚠️ Detected unclosed square brackets. Attempting to fix.');
            //     cleanResponse += ']'.repeat(openBrackets - closeBrackets);
            // }

            // ---- END OF ROBUST FIXES ----

            // 5. Final Parse Attempt
            const parsedJson = JSON.parse(cleanResponse);

            // 6. Final Validation
            if (!parsedJson.guidance_tracker || !Array.isArray(parsedJson.guidance_tracker)) {
                throw new Error('Invalid tracker response structure: missing guidance_tracker array');
            }
            parsedJson.guidance_tracker?.reverse();
            console.log(`✅ Successfully parsed tracker with ${parsedJson.guidance_tracker.length} commitments`);
            return parsedJson;

        } catch (error) {
            console.error('❌ Error parsing tracker response:', error.message);
            console.error('Raw response snippet:', response.substring(0, 500) + '...');
            console.error('Cleaned response snippet before final parse:', cleanResponse.substring(0, 500) + '...');

            // Return a detailed fallback structure for debugging
            return {
                guidance_tracker: [],
                parsing_error: `Failed to parse JSON. Error: ${error.message}`,
                raw_response: response.substring(0, 1000),
                cleaned_response: cleanResponse.substring(0, 1000)
            };
        }
    }
    /**
     * Save tracker result to Firestore
     * @param {string} docId - Document ID
     * @param {Object} trackerResult - Parsed tracker result
     */
    async saveTrackerToFirestore(docId, trackerResult) {
        try {
            const updateData = {
                tracker: trackerResult,
                trackerGeneratedAt: new Date().toISOString(),
                lastProcessed: new Date().toISOString()
            };

            await this.db.collection(this.collectionName).doc(docId).update(updateData);
            console.log(`✅ Successfully saved tracker to document ${docId}`);

        } catch (error) {
            console.error(`❌ Error saving tracker to document ${docId}:`, error.message);
            throw error;
        }
    }

    /**
     * Generate guidance tracker for all companies
     * @returns {Promise<void>}
     */
    async generateTrackersForAllCompanies() {
        try {
            console.log('🚀 Starting guidance tracker generation for all companies...');

            const snapshot = await this.db.collection(this.collectionName).get();

            if (snapshot.empty) {
                console.log('📭 No documents found in collection');
                return;
            }

            // Get unique company codes
            const companySet = new Set();
            snapshot.docs.forEach(doc => {
                const companyCode = doc.data().companyCode;
                if (companyCode) {
                    companySet.add(companyCode);
                }
            });

            const companyList = Array.from(companySet);
            console.log(`📋 Found ${companyList.length} unique companies for tracker generation`);

            let successCount = 0;
            let failureCount = 0;

            for (const companyCode of companyList) {
                try {
                    console.log(`\n🏢 Processing company: ${companyCode}`);
                    const success = await this.generateGuidanceTracker(companyCode);

                    if (success) {
                        successCount++;
                        console.log(`✅ Successfully processed ${companyCode}`);
                    } else {
                        failureCount++;
                        console.log(`⚠️  Skipped ${companyCode} - no processed data`);
                    }

                    // Add a small delay between companies to avoid rate limiting
                    await this.delay(1000);

                } catch (error) {
                    failureCount++;
                    console.error(`❌ Failed to process ${companyCode}:`, error.message);
                    continue;
                }
            }

            console.log(`\n📊 Tracker generation completed:`);
            console.log(`   ✅ Successful: ${successCount}`);
            console.log(`   ❌ Failed: ${failureCount}`);
            console.log(`   📈 Total: ${companyList.length}`);

        } catch (error) {
            console.error('❌ Error in generateTrackersForAllCompanies:', error.message);
            throw error;
        }
    }

    async processSingleAnnouncementLocal(filePath, prompt) {
        try {
            console.log(`� Readhing PDF from local file: ${filePath}`);

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

            // Debug: Log the type and content of parsedResponse
            console.log('📊 parsedResponse type:', typeof parsedResponse);
            console.log('📊 parsedResponse content:', parsedResponse);

            // You can now access properties directly like:
            // parsedResponse.type, parsedResponse.date, parsedResponse.time, etc.

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


    /**
     * Reformats the guidance section of a markdown string into a table using Gemini.
     * @param {string} markdownInput - The original markdown string.
     * @returns {Promise<string>} - The updated markdown string.
     */
    async standardizeGuidanceTableWithGemini(markdownInput) {
        try {
            console.log('🤖 Reformatting guidance section into a table with Gemini...');
            const prompt = GUIDANCE_TABLE_PROMPT.replace("[PASTE FULL MARKDOWN HERE]", markdownInput);

            // Use the existing retry logic to call the API
            const updatedMarkdown = await this.callGeminiAPIWithRetry(prompt);

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


    /**
     * Processes a single company's conference calls to standardize the guidance table in markdownOutput.
     * @param {string} companyCode - The company code to process.
     * @returns {Promise<boolean>} - True if an update was made, false otherwise.
     */
    async standardizeGuidanceTableForCompany(companyCode) {
        try {
            console.log(`\n🔍 Standardizing guidance tables for company: ${companyCode}`);
            const snapshot = await this.db.collection(this.collectionName)
                .where('companyCode', '==', companyCode)
                .limit(1)
                .get();

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
                await this.updateDocumentInFirestore(doc.id, updatedConCallList);
                console.log(`✅ Successfully updated document ${doc.id} ${docData.name} ${companyCode}  with standardized guidance tables.`);
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

    /**
     * Iterates through all companies and standardizes their guidance tables.
     */
    async standardizeGuidanceTablesForAllCompanies() {
        try {
            console.log('🚀 Starting guidance table standardization for ALL companies...');
            const snapshot = await this.db.collection(this.collectionName).get();

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

}

async function main() {
    const processor = new ConferenceCallNotes();

    const isConnected = await processor.testConnection();
    if (!isConnected) {
        console.error('❌ Cannot proceed without Firestore connection');
        process.exit(1);
    }

    console.log('🔑 API Key Status:', processor.getKeyStatus());

    // await processor.readIndustryPrompts();
    // await processor.readAllFilingDocuments();
    // await processor.processMultipleLocalAnnouncements();
    // await processor.cleanDuplicateDocuments();
    // await processor.generateGuidanceTracker("1274894");
    //
    // await processor.generateGuidanceTracker("1285187");
    // await processor.generateGuidanceTracker("1284943");
    // await processor.generateGuidanceTracker("1284805");
    // await processor.generateGuidanceTracker("3661");
    // await processor.generateTrackersForAllCompanies();
    // await processor.readAllConcallNotifications();
    // await processor.standardizeGuidanceTableForCompany("53");
    // await processor.standardizeGuidanceTablesForAllCompanies();
}

if (require.main === module) {
    main();
}

module.exports = app;
