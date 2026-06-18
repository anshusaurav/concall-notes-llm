/**
 * Fetch companies whose LATEST concall quarter is recent (Apr/May/Jun 2026).
 * We want fresh Q4FY26 results, not old concalls that were just processed.
 */
require('dotenv').config();
const FirebaseService = require('./src/services/FirebaseService');

const RECENT_QUARTERS = new Set(['Apr2026', 'May2026', 'Jun2026']);

function parseQuarterDate(label) {
    if (!label) return null;
    const months = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
    const m = label.match(/^([A-Za-z]+)(\d{4})$/);
    if (!m) return null;
    const mo = months[m[1]];
    if (mo === undefined) return null;
    return new Date(parseInt(m[2]), mo, 1);
}

async function main() {
    const firebase = new FirebaseService();
    firebase.initializeFirebase();

    const ok = await firebase.testConnection();
    if (!ok) { console.error('Cannot connect'); process.exit(1); }

    console.log('Fetching all documents...');
    const snapshot = await firebase.getAllDocuments();
    console.log(`Total docs: ${snapshot.docs.length}`);

    const results = [];

    for (const doc of snapshot.docs) {
        const data = doc.data();
        const concalls = data?.documents?.['Concalls'] || [];

        // Find all processed concalls with a quarter label
        const processed = concalls
            .filter(c => c.markdownOutput && c.markdownOutput.trim().length > 100 && c.quarter)
            .sort((a, b) => {
                const da = parseQuarterDate(a.quarter);
                const db = parseQuarterDate(b.quarter);
                return (db || 0) - (da || 0);
            });

        if (!processed.length) continue;

        const latest = processed[0];
        if (!RECENT_QUARTERS.has(latest.quarter)) continue;

        results.push({
            companyCode: data.companyCode,
            companyName: data.companyName || data.name || doc.id,
            industry: data.industry || '',
            quarter: latest.quarter,
            summary: latest.markdownOutput?.slice(0, 1200) || '',
        });
    }

    results.sort((a, b) => {
        const order = { Jun2026: 0, May2026: 1, Apr2026: 2 };
        return (order[a.quarter] ?? 9) - (order[b.quarter] ?? 9);
    });

    console.log(`\nFound ${results.length} companies with Apr-Jun 2026 concalls:\n`);
    results.forEach(r => {
        console.log(`---`);
        console.log(`Company: ${r.companyName} | Quarter: ${r.quarter} | Code: ${r.companyCode}`);
        console.log(r.summary.slice(0, 600));
    });
}

main().catch(console.error);
