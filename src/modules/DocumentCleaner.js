class DocumentCleaner {
    constructor(firebaseService) {
        this.firebaseService = firebaseService;
    }

    /**
     * Parses a quarter/period string into a comparable { year, month } object.
     * Handles:
     *   "Q4FY26" / "Q4 FY26"  — fiscal-year format (Q4 FY26 = Jan 2026)
     *   "May2026" / "Nov2025"  — MonthYear format
     * Returns { year: 0, month: 0 } for unrecognised formats (sorted to end).
     * @param {string|undefined} quarter
     * @returns {{ year: number, month: number }}
     */
    _parseQuarter(quarter) {
        const MONTH_ABBR = {
            jan:1,feb:2,mar:3,apr:4,may:5,jun:6,
            jul:7,aug:8,sep:9,oct:10,nov:11,dec:12
        };

        if (!quarter) return { year: 0, month: 0 };

        // "Q4FY26" / "Q4 FY26"
        const qMatch = quarter.match(/Q(\d+)\s*FY(\d+)/i);
        if (qMatch) {
            const qNum = parseInt(qMatch[1], 10);
            const fy   = parseInt(qMatch[2], 10);
            // Indian FY: Q1=Apr-Jun, Q2=Jul-Sep, Q3=Oct-Dec, Q4=Jan-Mar
            const base       = 2000 + fy - 1;
            const monthStart = { 1: 4, 2: 7, 3: 10, 4: 1 };
            const yearAdd    = qNum === 4 ? 1 : 0;
            return { year: base + yearAdd, month: monthStart[qNum] ?? 1 };
        }

        // "May2026" / "Nov2025"
        const mMatch = quarter.match(/^([A-Za-z]+)(\d{4})$/);
        if (mMatch) {
            const m = MONTH_ABBR[mMatch[1].toLowerCase().slice(0, 3)];
            if (m) return { year: parseInt(mMatch[2], 10), month: m };
        }

        return { year: 0, month: 0 };
    }

    /**
     * Sorts concalls by quarter descending (newest first).
     * Handles both "Q4FY26" and "May2026" style quarter strings.
     * Entries without a recognised format are placed at the end.
     * @param {Array} concalls
     * @returns {Array} - New sorted array (original array is not mutated)
     */
    _sortConcallsByQuarter(concalls) {
        return [...concalls].sort((a, b) => {
            const pa = this._parseQuarter(a.quarter);
            const pb = this._parseQuarter(b.quarter);
            if (pb.year !== pa.year) return pb.year - pa.year;
            return pb.month - pa.month;
        });
    }

    /**
     * Deduplicates concalls within an array based on quarter
     * @param {Array} concalls - Array of concall objects
     * @returns {Array} - Deduplicated array of concalls, sorted newest-first
     */
    deduplicateConcalls(concalls) {
        if (!Array.isArray(concalls) || concalls.length === 0) {
            return [];
        }

        const concallsMap = new Map();

        // Helper function to create a unique key based on quarter
        const createConcallKey = (concall) => {
            if (concall.quarter) {
                return `quarter:${concall.quarter}`;
            }
            return `links:${concall.link || 'no-link'}_${concall.pptLink || 'no-ppt'}`;
        };

        concalls.forEach(concall => {
            const key = createConcallKey(concall);

            if (!concallsMap.has(key)) {
                concallsMap.set(key, concall);
            } else {
                // Merge with existing entry - prioritize non-empty values and processed content
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
                    guidanceTableStandardizationError: concall.guidanceTableStandardizationError || existing.guidanceTableStandardizationError,
                    guidanceTableStandardizationNote: concall.guidanceTableStandardizationNote || existing.guidanceTableStandardizationNote
                };
                concallsMap.set(key, merged);
            }
        });

        return this._sortConcallsByQuarter(Array.from(concallsMap.values()));
    }

    /**
     * Cleans and merges documents from both 'documents' and 'rawDocuments' collections.
     * - Merges concalls and announcements from rawDocuments into documents
     * - Deduplicates entries by company code
     * - Deletes rawDocuments after successful merge
     */
    async cleanDuplicateUsingRawDocuments() {
        try {
            console.log('🚀 Starting to process documents from both collections...');

            // Fetch documents from both collections in parallel
            const [documentsSnapshot, rawDocumentsSnapshot] = await Promise.all([
                this.firebaseService.getAllDocuments(),
                this.firebaseService.getAllRawDocuments()
            ]);

            console.log(`📋 Found ${documentsSnapshot.size} documents in 'documents' collection`);
            console.log(`📋 Found ${rawDocumentsSnapshot.size} documents in 'rawDocuments' collection`);

            if (documentsSnapshot.empty && rawDocumentsSnapshot.empty) {
                console.log('📭 No documents found in either collection');
                return;
            }

            // Group all documents by company code
            const companiesMap = new Map();

            // Helper function to add document to companiesMap
            const addToCompaniesMap = (doc, collection) => {
                const data = doc.data();
                const companyCode = data.companyCode;

                if (!companyCode) {
                    console.warn(`⚠️ Document ${doc.id} in ${collection} has no companyCode, skipping`);
                    return;
                }

                const concalls = data.documents?.['Concalls'];
                const concallsWithMarkdown = Array.isArray(concalls)
                    ? concalls.filter(item => !!item.markdownOutput).length
                    : 0;

                if (!companiesMap.has(companyCode)) {
                    companiesMap.set(companyCode, {
                        documents: [],
                        rawDocuments: []
                    });
                }

                const entry = {
                    id: doc.id,
                    data: data,
                    concallsWithMarkdown: concallsWithMarkdown,
                    collection: collection
                };

                if (collection === 'documents') {
                    companiesMap.get(companyCode).documents.push(entry);
                } else {
                    companiesMap.get(companyCode).rawDocuments.push(entry);
                }
            };

            // Process documents from both collections
            documentsSnapshot.docs.forEach(doc => addToCompaniesMap(doc, 'documents'));
            rawDocumentsSnapshot.docs.forEach(doc => addToCompaniesMap(doc, 'rawDocuments'));

            console.log(`📊 Found ${companiesMap.size} unique companies across both collections`);

            // Collect all batch operations
            const batchOperations = [];
            let totalUpdated = 0;
            let totalRawDeleted = 0;

            // Helper functions for creating unique keys
            const createConcallKey = (concall) => {
                if (concall.quarter) {
                    return `quarter:${concall.quarter}`;
                }
                return `links:${concall.link || 'no-link'}_${concall.pptLink || 'no-ppt'}`;
            };

            const createAnnouncementKey = (announcement) => {
                return `${announcement.link || 'no-link'}_${announcement.title || 'no-title'}_${announcement.date || 'no-date'}`;
            };

            for (const [companyCode, companyDocs] of companiesMap) {
                const { documents: docsInCollection, rawDocuments: rawDocs } = companyDocs;
                const allDocsForCompany = [...docsInCollection, ...rawDocs];

                // Skip if only rawDocuments exist and no documents collection entry
                // In this case, we still need to process and create an entry in documents
                const hasOnlyRawDocs = docsInCollection.length === 0 && rawDocs.length > 0;

                // Merge all concalls and announcements from all documents
                const allConcalls = new Map();
                const allAnnouncements = new Map();

                allDocsForCompany.forEach(doc => {
                    const concalls = doc.data.documents?.['Concalls'];
                    const announcements = doc.data.documents?.['Announcements'];

                    // Process concalls
                    if (Array.isArray(concalls)) {
                        concalls.forEach(concall => {
                            const key = createConcallKey(concall);

                            if (!allConcalls.has(key)) {
                                allConcalls.set(key, concall);
                            } else {
                                // Merge with existing entry
                                const existing = allConcalls.get(key);
                                const merged = {
                                    ...existing,
                                    link: concall.link || existing.link,
                                    pptLink: concall.pptLink || existing.pptLink,
                                    recLink: concall.recLink || existing.recLink,
                                    markdownOutput: concall.markdownOutput || existing.markdownOutput,
                                    summary: concall.summary || existing.summary,
                                    isProcessed: concall.isProcessed || existing.isProcessed,
                                    processingDate: concall.processingDate || existing.processingDate,
                                    textLength: concall.textLength || existing.textLength,
                                    isGuidanceTableStandardized: concall.isGuidanceTableStandardized || existing.isGuidanceTableStandardized,
                                    guidanceTableStandardizedDate: concall.guidanceTableStandardizedDate || existing.guidanceTableStandardizedDate,
                                    processingError: concall.processingError || existing.processingError,
                                    guidanceTableStandardizationError: concall.guidanceTableStandardizationError || existing.guidanceTableStandardizationError,
                                    guidanceTableStandardizationNote: concall.guidanceTableStandardizationNote || existing.guidanceTableStandardizationNote
                                };
                                allConcalls.set(key, merged);
                            }
                        });
                    }

                    // Process announcements
                    if (Array.isArray(announcements)) {
                        announcements.forEach(announcement => {
                            const key = createAnnouncementKey(announcement);
                            if (!allAnnouncements.has(key)) {
                                allAnnouncements.set(key, announcement);
                            }
                        });
                    }
                });

                const mergedConcalls = this._sortConcallsByQuarter(Array.from(allConcalls.values()));
                const mergedAnnouncements = Array.from(allAnnouncements.values());

                if (hasOnlyRawDocs) {
                    // Create new document in documents collection using the first rawDocument as base
                    const baseDoc = rawDocs[0];
                    const newDocData = {
                        ...baseDoc.data,
                        documents: {
                            ...baseDoc.data.documents,
                            'Concalls': mergedConcalls,
                            'Announcements': mergedAnnouncements
                        },
                        lastProcessed: new Date().toISOString()
                    };

                    batchOperations.push({
                        type: 'set',
                        collection: 'documents',
                        docId: baseDoc.id,
                        data: newDocData,
                        merge: false,
                        logInfo: {
                            docId: baseDoc.id,
                            companyName: baseDoc.data.name,
                            action: 'create',
                            concallsCount: mergedConcalls.length,
                            announcementsCount: mergedAnnouncements.length
                        }
                    });
                    totalUpdated++;

                    console.log(`📝 Company ${baseDoc.data.name}: Creating new document from ${rawDocs.length} rawDocuments`);
                } else {
                    // Find the best document to keep from documents collection
                    const docToKeep = docsInCollection.reduce((best, current) => {
                        if (current.concallsWithMarkdown > best.concallsWithMarkdown) {
                            return current;
                        }
                        return best;
                    });

                    // Update the document to keep with merged data
                    // Using dot notation to only update specific nested fields without removing others
                    batchOperations.push({
                        type: 'update',
                        collection: 'documents',
                        docId: docToKeep.id,
                        data: {
                            'documents.Concalls': mergedConcalls,
                            'documents.Announcements': mergedAnnouncements,
                            lastProcessed: new Date().toISOString()
                        },
                        logInfo: {
                            docId: docToKeep.id,
                            companyName: docToKeep.data.name,
                            action: 'update',
                            concallsCount: mergedConcalls.length,
                            markdownCount: mergedConcalls.filter(c => c.markdownOutput).length,
                            announcementsCount: mergedAnnouncements.length
                        }
                    });
                    totalUpdated++;

                    // Note: We do NOT delete duplicate documents from documents collection
                    // Only rawDocuments are deleted after merge

                    if (rawDocs.length > 0) {
                        console.log(`📊 Company ${docToKeep.data.name}: Merging ${rawDocs.length} rawDocs into existing document`);
                    }
                }

                // Delete all rawDocuments for this company
                for (const rawDoc of rawDocs) {
                    batchOperations.push({
                        type: 'delete',
                        collection: 'rawDocuments',
                        docId: rawDoc.id,
                        logInfo: {
                            docId: rawDoc.id,
                            companyName: rawDoc.data.name,
                            collection: 'rawDocuments'
                        }
                    });
                    totalRawDeleted++;
                }
            }

            // Execute all batch operations
            if (batchOperations.length > 0) {
                const BATCH_SIZE = 50;
                const totalBatches = Math.ceil(batchOperations.length / BATCH_SIZE);

                console.log(`📦 Splitting ${batchOperations.length} operations into ${totalBatches} batch(es)`);

                let processedBatches = 0;
                for (let i = 0; i < batchOperations.length; i += BATCH_SIZE) {
                    const batchSlice = batchOperations.slice(i, i + BATCH_SIZE);
                    processedBatches++;

                    try {
                        console.log(`⏳ Processing batch ${processedBatches}/${totalBatches} (${batchSlice.length} operations)...`);
                        await this.firebaseService.executeBatchOperationsMultiCollection(batchSlice);
                        console.log(`✅ Batch ${processedBatches}/${totalBatches} completed successfully`);

                        if (i + BATCH_SIZE < batchOperations.length) {
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        }
                    } catch (error) {
                        console.error(`❌ Error processing batch ${processedBatches}/${totalBatches}:`, error.message);
                        throw error;
                    }
                }

                console.log(`\n📊 Summary:`);
                console.log(`   ✅ Updated/Created: ${totalUpdated} documents`);
                console.log(`   🗑️  Deleted from rawDocuments: ${totalRawDeleted}`);
            } else {
                console.log('✨ No operations needed - collections are already clean');
            }

            console.log('✅ Finished processing all companies');

        } catch (error) {
            console.error('❌ Error in cleanDuplicateUsingRawDocuments:', error.message);
            throw error;
        }
    }

    async cleanDuplicateDocuments() {
        try {
            console.log('🚀 Starting to process filing documents...');

            const snapshot = await this.firebaseService.getAllDocuments();

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

            // Collect all batch operations (updates and deletes)
            const batchOperations = [];
            let totalDeleted = 0;
            let totalUpdated = 0;

            for (const [companyCode, documents] of companiesMap) {
                // Handle companies with a single document - still need to deduplicate concalls within the document
                if (documents.length === 1) {
                    const doc = documents[0];
                    const concalls = doc.data.documents?.['Concalls'];

                    if (Array.isArray(concalls) && concalls.length > 0) {
                        const originalCount = concalls.length;
                        const dedupedConcalls = this.deduplicateConcalls(concalls);

                        // Update if duplicates removed OR sort order differs from stored order
                        const orderChanged = dedupedConcalls.some((c, i) => c.quarter !== concalls[i]?.quarter);
                        if (dedupedConcalls.length < originalCount || orderChanged) {
                            const action = dedupedConcalls.length < originalCount
                                ? `Deduplicating ${originalCount} → ${dedupedConcalls.length} concalls`
                                : `Sorting concalls for correct order`;
                            console.log(`📊 Company ${doc.data.name}: ${action}`);

                            batchOperations.push({
                                type: 'update',
                                docId: doc.id,
                                data: {
                                    'documents.Concalls': dedupedConcalls,
                                    lastProcessed: new Date().toISOString()
                                },
                                logInfo: {
                                    docId: doc.id,
                                    companyName: doc.data.name,
                                    originalCount,
                                    dedupedCount: dedupedConcalls.length,
                                    removed: originalCount - dedupedConcalls.length
                                }
                            });
                            totalUpdated++;
                        }
                    }
                    continue;
                }

                // Handle companies with multiple documents
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

                // Prepare update operation for the document to keep with merged concalls and announcements
                if (allConcalls.size > 0 || allAnnouncements.size > 0) {
                    const mergedConcalls = this._sortConcallsByQuarter(Array.from(allConcalls.values()));
                    const mergedAnnouncements = Array.from(allAnnouncements.values());

                    batchOperations.push({
                        type: 'update',
                        docId: docToKeep.id,
                        data: {
                            documents: {
                                ...docToKeep.data.documents,
                                'Concalls': mergedConcalls,
                                'Announcements': mergedAnnouncements
                            }
                        },
                        logInfo: {
                            docId: docToKeep.id,
                            concallsCount: mergedConcalls.length,
                            markdownCount: mergedConcalls.filter(c => c.markdownOutput).length,
                            announcementsCount: mergedAnnouncements.length
                        }
                    });
                    totalUpdated++;
                }

                // Prepare delete operations for duplicates
                const docsToDelete = documents.filter(doc => doc.id !== docToKeep.id);

                for (const doc of docsToDelete) {
                    batchOperations.push({
                        type: 'delete',
                        docId: doc.id,
                        logInfo: {
                            docId: doc.id,
                            companyName: doc.data.name
                        }
                    });
                    totalDeleted++;
                }

                if (docsToDelete.length > 0) {
                    console.log(`📊 Company ${docToKeep.data.name}: Keeping document with ${docToKeep.concallsWithMarkdown} concalls, deleting ${docsToDelete.length} duplicates`);
                }
            }

            // Execute all batch operations using Firestore batches
            if (batchOperations.length > 0) {
                const BATCH_SIZE = 50; // Conservative batch size to avoid payload limits
                const totalBatches = Math.ceil(batchOperations.length / BATCH_SIZE);

                console.log(`📦 Splitting ${batchOperations.length} operations into ${totalBatches} batch(es) of ${BATCH_SIZE} operations each`);

                let processedBatches = 0;
                for (let i = 0; i < batchOperations.length; i += BATCH_SIZE) {
                    const batchSlice = batchOperations.slice(i, i + BATCH_SIZE);
                    processedBatches++;

                    try {
                        console.log(`⏳ Processing batch ${processedBatches}/${totalBatches} (${batchSlice.length} operations)...`);
                        await this.firebaseService.executeBatchOperations(batchSlice);
                        console.log(`✅ Batch ${processedBatches}/${totalBatches} completed successfully`);

                        // Add a small delay between batches to avoid overwhelming Firestore
                        if (i + BATCH_SIZE < batchOperations.length) {
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        }
                    } catch (error) {
                        console.error(`❌ Error processing batch ${processedBatches}/${totalBatches}:`, error.message);
                        throw error;
                    }
                }

                // Log results
                batchOperations.forEach(op => {
                    if (op.type === 'update') {
                        if (op.logInfo.removed) {
                            // Single document deduplication
                            console.log(`🧹 Deduplicated concalls for ${op.logInfo.companyName}: ${op.logInfo.originalCount} → ${op.logInfo.dedupedCount} (removed ${op.logInfo.removed} duplicates)`);
                        } else {
                            // Multiple document merge
                            console.log(`🔄 Updated document ${op.logInfo.docId} with ${op.logInfo.concallsCount} merged concalls (${op.logInfo.markdownCount} with markdown) and ${op.logInfo.announcementsCount} merged announcements`);
                        }
                    } else if (op.type === 'delete') {
                        console.log(`🗑️ Deleted document ${op.logInfo.docId} for company ${op.logInfo.companyName}`);
                    }
                });

                console.log(`✅ Successfully updated ${totalUpdated} documents and deleted ${totalDeleted} duplicate documents in ${totalBatches} batch(es)`);
            } else {
                console.log('✨ No duplicate documents found');
            }

            console.log('✅ Finished processing all companies');

        } catch (error) {
            console.error('❌ Error in cleanDuplicateDocuments:', error.message);
            throw error;
        }
    }
}

module.exports = DocumentCleaner;