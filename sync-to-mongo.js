/**
 * sync-to-mongo.js
 *
 * Upserts a minified company record (name, companyCode, nseCode, bseCode)
 * to MongoDB specter-db.companies for every company in Firestore.
 *
 * Unlike the old migrateAllCompanies() which only inserts new companies,
 * this script uses upsert so it also refreshes stale data.
 *
 * Usage:
 *   node sync-to-mongo.js
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');
const FirebaseService = require('./src/services/FirebaseService');

const MONGODB_URI      = process.env.MONGODB_URI;
const MONGODB_DATABASE = process.env.MONGODB_DATABASE || 'specter-db';
const MONGODB_COLLECTION = process.env.MONGODB_COLLECTION || 'companies';

async function run() {
    if (!MONGODB_URI) {
        console.error('❌ MONGODB_URI is not set in .env');
        process.exit(1);
    }

    // ── Firebase ──────────────────────────────────────────────────────────────
    const fb = new FirebaseService();
    fb.initializeFirebase();
    const connected = await fb.testConnection();
    if (!connected) {
        console.error('❌ Cannot connect to Firestore');
        process.exit(1);
    }

    console.log('📡 Fetching all companies from Firestore...');
    const snapshot = await fb.getAllDocuments();

    if (snapshot.empty) {
        console.log('📭 No documents found in Firestore.');
        process.exit(0);
    }

    const docs = snapshot.docs;
    console.log(`📋 Found ${docs.length} Firestore documents.`);

    // ── MongoDB ───────────────────────────────────────────────────────────────
    console.log('🔌 Connecting to MongoDB...');
    const client = new MongoClient(MONGODB_URI, {
        tls: true,
        retryWrites: true,
        w: 'majority',
        serverSelectionTimeoutMS: 30000,
    });

    await client.connect();
    const db = client.db(MONGODB_DATABASE);
    const collection = db.collection(MONGODB_COLLECTION);
    console.log(`✅ Connected to ${MONGODB_DATABASE}.${MONGODB_COLLECTION}`);

    // ── Upsert loop ───────────────────────────────────────────────────────────
    let inserted = 0;
    let updated  = 0;
    let skipped  = 0;
    let failed   = 0;

    for (const doc of docs) {
        const data = doc.data();
        if (!data.companyCode) { skipped++; continue; }

        try {
            const result = await collection.updateOne(
                { companyCode: String(data.companyCode) },
                {
                    $set: {
                        name:        data.name        || null,
                        companyCode: String(data.companyCode),
                        nseCode:     data.nseCode     || null,
                        bseCode:     data.bseCode     || null,
                        syncedAt:    new Date(),
                    },
                    $setOnInsert: {
                        firebaseId: doc.id,
                        createdAt:  new Date(),
                    },
                },
                { upsert: true }
            );

            if (result.upsertedCount > 0)      inserted++;
            else if (result.modifiedCount > 0) updated++;
            // else: matched but no field changed → silently skip

        } catch (err) {
            console.error(`❌ Failed for companyCode ${data.companyCode}:`, err.message);
            failed++;
        }
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log('\n📊 Sync complete:');
    console.log(`   ➕ Inserted (new): ${inserted}`);
    console.log(`   🔄 Updated       : ${updated}`);
    console.log(`   ⚠️  Skipped (no companyCode): ${skipped}`);
    console.log(`   ❌ Failed        : ${failed}`);
    console.log(`   📈 Total docs    : ${docs.length}`);

    await client.close();
    console.log('\n🔌 MongoDB connection closed.');
    process.exit(0);
}

run().catch(err => {
    console.error('❌ Fatal error:', err.message);
    process.exit(1);
});
