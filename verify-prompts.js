require('dotenv').config();
const FirebaseService = require('./src/services/FirebaseService');
async function check() {
  const fb = new FirebaseService(); fb.initializeFirebase(); await fb.testConnection();
  const c = fb.db.collection('industryPrompts');
  const checks = [
    ['/market/IN02/IN0202/IN020201/IN020201018/', 'Trade channel inventory', 'Consumer Disc - Furniture'],
    ['/market/IN04/IN0401/IN040104/IN040104003/', 'Direct distribution reach', 'FMCG'],
    ['/market/IN01/IN0103/IN010305/IN010305001/', 'Debtor Days', 'Trading/Distribution'],
    ['/market/IN09/IN0901/IN090102/IN090102001/', 'Fuel hedging', 'Transport - Aviation'],
    ['/market/IN11/IN1102/IN110201/IN110201004/', 'PLF', 'Power & Utilities'],
    ['/market/IN10/IN1001/IN100101/IN100101001/', 'Fixed Wireless Access', 'Telecom'],
    ['/market/IN02/IN0205/IN020501/IN020501002/', 'ASP', 'Real Estate'],
    ['/market/IN07/IN0702/IN070201/IN070201001/', 'Indigenization', 'Defense'],
    ['/market/IN05/IN0501/IN050103/IN050103001/', 'B30', 'AMC'],
    ['/market/IN02/IN0206/IN020601/IN020601003/', 'RevPAR', 'Travel & Leisure'],
    ['/market/IN07/IN0702/IN070205/IN070205017/', 'Realization per unit', 'Industrial Products'],
    ['/market/IN01/IN0101/IN010102/IN010102002/', 'Generic vs. proprietary', 'Agrochemicals'],
    ['/market/IN02/IN0206/IN020602/IN020602002/', 'Paid enrollments', 'Ed-Tech'],
    ['/market/IN02/IN0203/IN020301/IN020301002/', 'PLI scheme', 'Textiles'],
    ['/market/IN12/IN1201/IN120101/IN120101001/', 'Capital allocation', 'Conglomerate'],
  ];
  for (const [link, needle, label] of checks) {
    const snap = await c.where('link','==',link).get();
    if (snap.empty) { console.log('NOT FOUND: ' + label); continue; }
    const p = snap.docs[0].data().analystPrompt;
    const ok = p && p.includes(needle);
    console.log((ok ? 'OK' : 'FAIL') + '  ' + label + ' -> "' + needle + '"');
  }
  process.exit(0);
}
check().catch(e => { console.error(e.message); process.exit(1); });
