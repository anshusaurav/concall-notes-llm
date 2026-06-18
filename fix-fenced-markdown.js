require('dotenv').config();
const FirebaseService = require('./src/services/FirebaseService');

function stripCodeFence(text) {
  if (!text) return text;
  return text.replace(/^```(?:markdown)?\s*\n/, '').replace(/\n```\s*$/, '').trim();
}

async function fix() {
  const fb = new FirebaseService();
  fb.initializeFirebase();
  await fb.testConnection();

  const DRY_RUN = process.argv.includes('--dry-run');
  if (DRY_RUN) console.log('🔍 DRY RUN — no writes\n');

  let scanned = 0, fixed = 0, errors = 0;
  let lastSnapshot = null;

  do {
    let query = fb.db.collection('documents').orderBy('__name__').limit(200);
    if (lastSnapshot) query = query.startAfter(lastSnapshot);

    const snap = await query.get();
    if (snap.empty) break;
    lastSnapshot = snap.docs[snap.docs.length - 1];

    const batch = fb.db.batch();
    let batchHasWrites = false;

    for (const doc of snap.docs) {
      const data = doc.data();
      const concalls = data.documents?.Concalls;
      if (!concalls || !Array.isArray(concalls)) continue;

      let changed = false;
      const updatedConcalls = concalls.map(c => {
        if (c.markdownOutput && c.markdownOutput.trimStart().startsWith('```')) {
          const fixed = stripCodeFence(c.markdownOutput);
          changed = true;
          return { ...c, markdownOutput: fixed };
        }
        return c;
      });

      if (changed) {
        const brokenCount = concalls.filter(c => c.markdownOutput?.trimStart().startsWith('```')).length;
        console.log(`  ${doc.id} (${data.name || '?'}) — fixing ${brokenCount} concall(s)`);
        if (!DRY_RUN) {
          batch.update(doc.ref, { 'documents.Concalls': updatedConcalls });
          batchHasWrites = true;
        }
        fixed += brokenCount;
      }

      scanned += concalls.length;
    }

    if (!DRY_RUN && batchHasWrites) {
      try {
        await batch.commit();
      } catch (e) {
        console.error('Batch commit failed:', e.message);
        errors++;
      }
    }

    if (snap.docs.length < 200) break;
  } while (true);

  console.log(`\nDone. Scanned: ${scanned} concalls | Fixed: ${fixed} | Errors: ${errors}`);
  process.exit(errors > 0 ? 1 : 0);
}

fix().catch(e => { console.error(e.message); process.exit(1); });
