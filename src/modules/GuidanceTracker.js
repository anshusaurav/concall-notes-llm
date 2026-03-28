const { TRACKER_PROMPT } = require('../config/prompts');

class GuidanceTracker {
    constructor(firebaseService, geminiService) {
        this.firebaseService = firebaseService;
        this.geminiService = geminiService;
    }

    async generateGuidanceTracker(companyCode, forceRegenerate = false) {
        try {
            console.log(`🎯 Starting guidance tracker generation for company: ${companyCode}`);

            // Find the document for this company
            const snapshot = await this.firebaseService.getDocumentsByCompanyCode(companyCode);

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

            console.log(`📝 Found ${processedCalls.length} processed conference calls with markdownOutput`);

            // Check if document already has a guidance tracker with data
            const hasExistingTracker = docData.tracker &&
                                       docData.tracker.guidanceTracker &&
                                       Array.isArray(docData.tracker.guidanceTracker) &&
                                       docData.tracker.guidanceTracker.length > 0;

            if (hasExistingTracker && !forceRegenerate) {
                console.log(`📊 Existing tracker found with ${docData.tracker.guidanceTracker.length} items`);
                console.log(`📅 Tracker was last generated on: ${docData.tracker.trackerGeneratedAt || docData.tracker.createdAt || docData.tracker.updatedAt || 'Unknown date'}`);

                // Get the tracker generation date
                const trackerDate = docData.tracker.trackerGeneratedAt
                    ? new Date(docData.tracker.trackerGeneratedAt)
                    : new Date(0); // If no date, assume very old

                // Check if there are new concalls processed after the tracker was generated
                const newConcalls = processedCalls.filter(call => {
                    if (!call.processingDate) return false;
                    return new Date(call.processingDate) > trackerDate;
                });

                if (newConcalls.length === 0) {
                    console.log(`✅ No new concalls found since last tracker generation. Skipping regeneration.`);
                    console.log(`💡 Tip: Use forceRegenerate=true to regenerate tracker anyway.`);
                    return false;
                } else {
                    console.log(`🔄 Found ${newConcalls.length} new concalls since last tracker generation!`);
                    console.log(`📋 New concalls quarters: [${newConcalls.map(c => c.quarter || 'N/A').join(', ')}]`);
                    console.log(`🚀 Regenerating tracker with ALL concalls (${processedCalls.length} total)...`);
                }
            } else if (forceRegenerate) {
                console.log(`🔄 Force regenerate flag is set. Regenerating tracker...`);
            }

            console.log(`🚀 Proceeding with guidance tracker generation for ${companyCode} (${docData.name})`);

            // Sort by date if available, otherwise by index
            const sortedCalls = this.sortConferenceCallsByDate(processedCalls);

            // Create the formatted input for the Gemini prompt
            const formattedInput = this.formatMarkdownForTracker(sortedCalls);

            console.log(`📋 Formatted input length: ${formattedInput.length} characters`);

            // Generate the guidance tracker using Gemini
            const trackerResult = await this.generateTrackerWithGemini(formattedInput);

            // Save the tracker result to the document
            await this.firebaseService.saveTrackerToFirestore(doc.id, trackerResult);

            console.log(`✅ Successfully generated and saved guidance tracker for ${companyCode}`);
            return true;

        } catch (error) {
            console.error(`❌ Error generating guidance tracker for ${companyCode}:`, error.message);
            throw error;
        }
    }
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

            const response = await this.geminiService.callGeminiAPIWithRetry(trackerPrompt);
            console.log(response);
            const parsedTracker = this.parseTrackerResponse(response);

            console.log('✅ Successfully generated guidance tracker');
            return parsedTracker;

        } catch (error) {
            console.error('❌ Error generating tracker with Gemini:', error.message);
            throw new Error(`Gemini tracker generation error: ${error.message}`);
        }
    }

    parseTrackerResponse(response) {
        try {
            console.log('📝 Starting robust parsing of tracker response...');

            // 1. Initial Cleaning (same as before)
            let cleanResponse = response.trim();
            cleanResponse = cleanResponse.replace(/^```json\n?/i, '').replace(/\n?```$/i, '');
            cleanResponse = cleanResponse.replace(/^```\n?/i, '').replace(/\n?```$/i, '');

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

            // Return a detailed fallback structure for debugging
            return {
                guidance_tracker: [],
                parsing_error: `Failed to parse JSON. Error: ${error.message}`,
                raw_response: response.substring(0, 1000)
            };
        }
    }

    async generateTrackersForAllCompanies() {
        try {
            console.log('🚀 Starting guidance tracker generation for all companies in batches...');

            const snapshot = await this.firebaseService.getAllDocuments();

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
            const totalCompanies = companyList.length;
            const batchSize = Math.ceil(totalCompanies / 10); // Divide into 10 batches

            console.log(`📋 Found ${totalCompanies} unique companies to process in 10 batches of ~${batchSize} companies each`);

            let totalSuccessCount = 0;
            let totalFailureCount = 0;

            for (let batchIndex = 0; batchIndex < 10; batchIndex++) {
                const startIndex = batchIndex * batchSize;
                const endIndex = Math.min(startIndex + batchSize, totalCompanies);
                const batchCompanies = companyList.slice(startIndex, endIndex);

                if (batchCompanies.length === 0) break; // No more companies to process

                console.log(`\n📦 Processing Batch ${batchIndex + 1}/10 (Companies ${startIndex + 1}-${endIndex})`);
                console.log(`🏢 Batch contains ${batchCompanies.length} companies: [${batchCompanies.join(', ')}]`);

                let batchSuccessCount = 0;
                let batchFailureCount = 0;

                for (const companyCode of batchCompanies) {
                    try {
                        console.log(`\n🏢 Processing company: ${companyCode}`);
                        const success = await this.generateGuidanceTracker(companyCode);

                        if (success) {
                            batchSuccessCount++;
                            totalSuccessCount++;
                            console.log(`✅ Successfully processed ${companyCode}`);
                        } else {
                            batchFailureCount++;
                            totalFailureCount++;
                            console.log(`⚠️  Skipped ${companyCode} - no processed data`);
                        }

                        // Add a small delay between companies to avoid rate limiting
                        await this.delay(1000);

                    } catch (error) {
                        batchFailureCount++;
                        totalFailureCount++;
                        console.error(`❌ Failed to process ${companyCode}:`, error.message);
                        continue;
                    }
                }

                console.log(`✅ Batch ${batchIndex + 1} completed: ${batchSuccessCount} successful, ${batchFailureCount} failed`);

                // Add delay between batches to prevent timeout
                if (batchIndex < 9) { // Don't delay after the last batch
                    console.log('⏳ Waiting 60 seconds before next batch...');
                    await this.delay(60000); // 60 second delay between batches (longer for tracker generation)
                }
            }

            console.log(`\n📊 Final Tracker Generation Summary:`);
            console.log(`   📈 Total Companies: ${totalCompanies}`);
            console.log(`   ✅ Successful: ${totalSuccessCount}`);
            console.log(`   ❌ Failed: ${totalFailureCount}`);
            console.log('✅ Finished generating trackers for all companies in batches');

        } catch (error) {
            console.error('❌ Error in generateTrackersForAllCompanies:', error.message);
            throw error;
        }
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = GuidanceTracker;