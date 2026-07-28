const admin = require('firebase-admin');

class FirebaseService {
    constructor() {
        this.db = null;
        this.collectionName = 'documents';
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

            this.db = admin.firestore();

            // Configure Firestore settings with better connection handling
            this.db.settings({
                ignoreUndefinedProperties: true,
                // Increase timeouts to handle network issues
                keepAlive: true,
                preferRest: false // Use gRPC for better performance
            });

            console.log('✅ Firebase initialized successfully');
        } catch (error) {
            console.error('❌ Firebase initialization failed:', error.message);
            process.exit(1);
        }
    }

    async testConnection(retries = 3) {
        for (let i = 0; i < retries; i++) {
            try {
                console.log(`🔄 Testing Firestore connection (attempt ${i + 1}/${retries})...`);
                const testDoc = await this.db.collection('test').limit(1).get();
                console.log('✅ Firestore connection successful');
                return true;
            } catch (error) {
                console.error(`❌ Firestore connection failed (attempt ${i + 1}/${retries}):`, error.message);

                if (i < retries - 1) {
                    const delay = (i + 1) * 2000; // Exponential backoff: 2s, 4s, 6s
                    console.log(`⏳ Retrying in ${delay/1000} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    console.error('❌ All connection attempts failed');
                    return false;
                }
            }
        }
        return false;
    }

    async readIndustryPrompts() {
        const industryPromptsMap = new Map();
        const snapshot = await this.db.collection('industryPrompts').get();
        snapshot.forEach(doc => {
            const industryPromptData = doc.data();
            const { link, analystPrompt } = industryPromptData;
            industryPromptsMap.set(link, analystPrompt);
        });
        return industryPromptsMap;
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

    async getCompaniesByIndustryPath(industryPath) {
        try {
            console.log(`🔍 Fetching companies with industryLink: ${industryPath}`);

            // Exact match first
            let snapshot = await this.db.collection(this.collectionName)
                .where('industryLink', '==', industryPath)
                .get();

            // Prefix match fallback
            if (snapshot.empty) {
                console.log(`No exact match, trying prefix match...`);
                const prefixEnd = industryPath.slice(0, -1) +
                    String.fromCharCode(industryPath.charCodeAt(industryPath.length - 1) + 1);

                snapshot = await this.db.collection(this.collectionName)
                    .where('industryLink', '>=', industryPath)
                    .where('industryLink', '<', prefixEnd)
                    .get();
            }

            if (snapshot.empty) {
                console.log(`📭 No companies found for industryPath: ${industryPath}`);
                return [];
            }

            console.log(`📋 Found ${snapshot.size} companies for industryPath: ${industryPath}`);
            return snapshot.docs;
        } catch (error) {
            console.error(`❌ Error fetching companies by industryPath:`, error.message);
            throw error;
        }
    }

    async getAllDocuments() {
        return this._getAllDocumentsPaginated(this.collectionName);
    }

    async getAllRawDocuments() {
        return this._getAllDocumentsPaginated('rawDocuments');
    }

    async _getAllDocumentsPaginated(collectionName, pageSize = 500) {
        const allDocs = [];
        let lastDoc = null;
        let page = 0;

        while (true) {
            let query = this.db.collection(collectionName).orderBy('__name__').limit(pageSize);
            if (lastDoc) query = query.startAfter(lastDoc);

            let snap;
            for (let attempt = 1; attempt <= 4; attempt++) {
                try {
                    snap = await query.get();
                    break;
                } catch (err) {
                    if (attempt === 4) throw err;
                    const wait = attempt * 2000;
                    console.log(`  ⚠️  [${collectionName}] page ${page + 1} attempt ${attempt} failed (${err.message}) — retrying in ${wait / 1000}s`);
                    await new Promise(r => setTimeout(r, wait));
                }
            }

            if (snap.empty) break;

            snap.docs.forEach(d => allDocs.push(d));
            lastDoc = snap.docs[snap.docs.length - 1];
            page++;
            console.log(`  📄 [${collectionName}] Fetched page ${page} (${allDocs.length} docs so far)`);

            if (snap.docs.length < pageSize) break;
        }

        // Return a snapshot-like object compatible with existing code
        return {
            size: allDocs.length,
            empty: allDocs.length === 0,
            docs: allDocs,
            forEach: (fn) => allDocs.forEach(fn)
        };
    }

    async deleteRawDocument(docId) {
        return this.db.collection('rawDocuments').doc(docId).delete();
    }

    async getDocumentsByCompanyCode(companyCode) {
        const snapshot = await this.db.collection(this.collectionName)
            .where('companyCode', '==', companyCode)
            .get();
        return snapshot;
    }

    async deleteDocument(docId) {
        return this.db.collection(this.collectionName).doc(docId).delete();
    }

    async deleteDocumentsByCompanyCode(companyCode) {
        try {
            console.log(`🗑️  Fetching documents for company code: ${companyCode}`);
            const snapshot = await this.getDocumentsByCompanyCode(companyCode);

            if (snapshot.empty) {
                console.log(`📭 No documents found for company code: ${companyCode}`);
                return { success: true, deletedCount: 0 };
            }

            console.log(`📋 Found ${snapshot.size} document(s) to delete`);

            // Delete all documents
            const deletePromises = snapshot.docs.map(doc => {
                console.log(`🗑️  Deleting document ID: ${doc.id} (${doc.data().name || 'Unknown'})`);
                return this.deleteDocument(doc.id);
            });

            await Promise.all(deletePromises);

            console.log(`✅ Successfully deleted ${snapshot.size} document(s) for company code: ${companyCode}`);
            return { success: true, deletedCount: snapshot.size };
        } catch (error) {
            console.error(`❌ Error deleting documents for company code ${companyCode}:`, error.message);
            throw error;
        }
    }

    async updateDocument(docId, updateData) {
        return this.db.collection(this.collectionName).doc(docId).update(updateData);
    }

    async executeBatchOperations(operations) {
        try {
            const batch = this.db.batch();

            operations.forEach(operation => {
                const docRef = this.db.collection(this.collectionName).doc(operation.docId);

                if (operation.type === 'update') {
                    batch.update(docRef, operation.data);
                } else if (operation.type === 'delete') {
                    batch.delete(docRef);
                }
            });

            await batch.commit();
            return { success: true, operationsCount: operations.length };
        } catch (error) {
            console.error('❌ Error executing batch operations:', error.message);
            throw error;
        }
    }

    /**
     * Execute batch operations across multiple collections
     * Each operation must include a 'collection' field specifying the target collection
     * @param {Array} operations - Array of {type, docId, collection, data?, logInfo?}
     */
    async executeBatchOperationsMultiCollection(operations) {
        try {
            const batch = this.db.batch();

            operations.forEach(operation => {
                const collectionName = operation.collection || this.collectionName;
                const docRef = this.db.collection(collectionName).doc(operation.docId);

                if (operation.type === 'update') {
                    batch.update(docRef, operation.data);
                } else if (operation.type === 'delete') {
                    batch.delete(docRef);
                } else if (operation.type === 'set') {
                    batch.set(docRef, operation.data, { merge: operation.merge !== false });
                }
            });

            await batch.commit();
            return { success: true, operationsCount: operations.length };
        } catch (error) {
            console.error('❌ Error executing multi-collection batch operations:', error.message);
            throw error;
        }
    }
}

module.exports = FirebaseService;