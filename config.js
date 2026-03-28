const admin = require('firebase-admin');
require('dotenv').config();

class FirebaseConfig {
    constructor() {
        this.db = null;
        this.initializeFirebase();
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
            console.log('✅ Firebase initialized successfully');
        } catch (error) {
            console.error('❌ Firebase initialization failed:', error.message);
            process.exit(1);
        }
    }

    getDatabase() {
        return this.db;
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
}

// Configuration constants
const CONFIG = {
    PORT: process.env.PORT || 3000,
    COLLECTION_NAME: 'documents',
    INDUSTRY_PROMPTS_COLLECTION: 'industryPrompts',
    PDF_TIMEOUT: 30000,
    MAX_CALLS_TO_PROCESS: 10,
    GEMINI_PRIMARY_MODEL: process.env.GEMINI_PRIMARY_MODEL || 'gemini-2.5-flash',
    GEMINI_FALLBACK_MODEL: process.env.GEMINI_FALLBACK_MODEL || 'gemini-1.5-flash'
};

module.exports = {
    FirebaseConfig,
    CONFIG
};