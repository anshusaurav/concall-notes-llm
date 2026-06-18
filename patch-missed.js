require('dotenv').config();
const FirebaseService = require('./src/services/FirebaseService');

const PATCHES = {
  '/market/IN02/IN0203/IN020301/IN020301002/': `**Role and Goal:** You are a Textiles analyst. Analyze this transcript focusing on sales volumes, raw material costs (cotton/yarn), and the performance of export markets.
**Input:** \`[Paste Transcript Here]\`
**Instructions:** Structure your note with these headings.
1.  **Financial Performance:** Revenue, EBITDA, PAT, and margin analysis.
2.  **Operational Drivers:**
    *   Sales volumes by segment (e.g., Yarn, Fabric, Garments).
    *   **Yarn/fabric realization per kg** vs. cotton or polyester input cost — spread analysis.
    *   Export vs. Domestic sales mix and commentary on demand from key export markets (US, Europe). Note India + 1 sourcing shift from China as a structural tailwind.
    *   **PLI scheme** benefit for man-made fibre / technical textiles — accrual and timeline.
3.  **Cost Structure:**
    *   Impact of key raw material prices (cotton, yarn, crude-linked synthetics) on gross margins.
    *   **Spindle/loom utilization** % — below 80% signals demand weakness.
    *   **Inventory days** of cotton/fibre (cotton price volatility creates mark-to-market risk on raw material holdings).
4.  **Guidance, Outlook & Targets:**
    *   **Management Commentary:** Summarize the qualitative outlook on global textile demand and raw material prices.
    *   **Key Targets & Commitments:** Identify and list all specific, forward-looking targets from the transcript. For each, clearly state the **Metric**, **Target Value**, and **Timeframe**. Examples:
        *   **Revenue:** Revenue growth guidance.
        *   **Order Book:** Status of the export order book.
        *   **Capex:** Planned investment in modernization or capacity expansion.
        *   **Exports:** Target for export revenue growth and new customer additions.`,

  '/market/IN12/IN1201/IN120101/IN120101001/': `**Role and Goal:** You are a Diversified Conglomerate analyst. Analyze this transcript by breaking down the performance of each major business segment and assessing capital allocation strategy.
**Input:** \`[Paste Transcript Here]\`
**Instructions:** Structure your note with these headings.
1.  **Consolidated Financials:** Revenue, EBITDA, PAT, and Net Debt.
2.  **Segment-wise Performance:**
    *   For each major business segment (e.g., Metals, Retail, Telecom), provide a mini-summary including:
        *   Segment Revenue and EBIT.
        *   Key operational drivers and challenges.
    *   **Capital allocation priorities** — which segments receive incremental investment and why.
    *   **Cross-selling synergies** across business verticals (if any disclosed).
3.  **Capital Allocation & Strategy:**
    *   Management commentary on capex allocation between businesses.
    *   Updates on any M&A, divestments, or restructuring.
    *   Commentary on holding company structure and value unlocking.
4.  **Guidance, Outlook & Targets:**
    *   **Management Commentary:** Summarize the qualitative outlook for the group and key segments.
    *   **Key Targets & Commitments:** Identify and list all specific, forward-looking targets from the transcript. For each, clearly state the **Metric**, **Target Value**, and **Timeframe**. Examples:
        *   **Group:** Consolidated revenue or profit growth target.
        *   **Segment:** Specific targets for individual businesses (e.g., "Hotel business to add 500 rooms").
        *   **Debt:** Group-level debt reduction target.
        *   **Capital Allocation:** Capex split across segments for the next 2-3 years.`,
};

async function run() {
  const fb = new FirebaseService(); fb.initializeFirebase();
  await fb.testConnection();
  const col = fb.db.collection('industryPrompts');
  for (const [link, prompt] of Object.entries(PATCHES)) {
    const snap = await col.where('link','==',link).get();
    if (snap.empty) { console.log('Not found: ' + link); continue; }
    for (const doc of snap.docs) await doc.ref.update({ analystPrompt: prompt });
    console.log('Updated: ' + link);
  }
  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
