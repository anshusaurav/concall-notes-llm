/**
 * Updates industry prompts in Firebase for top 3 sectors:
 * - Banking (3 prompts)
 * - IT / Technology (7 prompts, 2 sub-variants)
 * - Metals & Mining (13 prompts, multiple sub-variants)
 *
 * All changes are additive — same structure, role, and delimiters preserved.
 * Run: node update-industry-prompts.js [--dry-run]
 */
require('dotenv').config();
const FirebaseService = require('./src/services/FirebaseService');

// ─────────────────────────────────────────────────────────────────────────────
// IMPROVED PROMPT TEXTS
// ─────────────────────────────────────────────────────────────────────────────

const BANKING_PROMPT = `**Role and Goal:** You are a Banking analyst. Analyze this transcript to assess loan growth, deposit franchise strength, asset quality, and profitability.
**Input:** \`[Paste Transcript Here]\`
**Instructions:** Structure your note with these headings.
1.  **Profitability:** Net Interest Income (NII), **Net Interest Margin (NIM)** (portfolio NIM vs. incremental/fresh NIM), Fee Income breakdown (trade finance, FX, third-party product distribution), PAT, Return on Assets (ROA), Return on Equity (ROE).
2.  **Balance Sheet:** Advances Growth with mix (Retail/Corporate/SME), Deposit Growth, **CASA Ratio**, and **CD Ratio** (Credit-to-Deposit — signals lending aggression vs. liquidity buffer).
3.  **Asset Quality:** **Gross NPA & Net NPA** (ratios and absolute), Slippages, Recoveries & Upgrades, **Restructured Book / ECLGS outstanding** (residual stress), **Provision Coverage Ratio (PCR)**, Credit Cost, and Write-off quantum.
4.  **Operational Efficiency:** Cost-to-Income Ratio, Capital Adequacy Ratio (CAR & CET-1), **SMA-2 pool** (leading indicator of future NPA formation), Digital transaction mix (% of transactions via digital channels — signals cost-to-serve improvement).
5.  **Guidance, Outlook & Targets:**
    *   **Management Commentary:** Summarize the qualitative outlook on credit growth, margins, and the economic environment.
    *   **Key Targets & Commitments:** Identify and list all specific, forward-looking targets from the transcript. For each, clearly state the **Metric**, **Target Value**, and **Timeframe**. Examples:
        *   **Growth:** Loan and Deposit growth guidance.
        *   **NIM:** Expected range for NIM (portfolio and incremental).
        *   **Asset Quality:** Guidance on credit cost and slippage trajectory for the year.
        *   **Returns:** Aspirational ROA/ROE targets.`;

const IT_SERVICES_PROMPT = `**Role and Goal:** You are a senior IT/Technology analyst. Analyze this transcript focusing on revenue growth drivers, deal wins, client metrics, and margin performance.
**Input:** \`[Paste Transcript Here]\`
**Instructions:** Structure your note with these headings.
1.  **Financial Performance:** Revenue (USD & INR), **Constant Currency (CC) Growth**, Operating Margin (EBIT), PAT. Note subcontracting cost as % of revenue (declining trend = positive margin signal).
2.  **Business Momentum:** **Total Contract Value (TCV)** of deal wins — note large deal (>$50M TCV) count separately, deal pipeline, book-to-bill ratio. Include any **Gen-AI / AI-led deal wins, pipeline color, or revenue contribution** (increasingly material KPI from FY25 onwards).
3.  **Segment Performance:** Breakdown by Vertical (BFSI, Retail, Hi-Tech, Manufacturing, Healthcare, etc.) and Geography (NA, Europe, ROW). Flag any **GCC (Global Capability Center) setup revenue** or managed services commentary.
4.  **Client & Employee Metrics:** New client additions, revenue from large client buckets ($1M+, $5M+, $10M+), **Top-5/Top-10 client concentration**, Headcount with **offshore/onshore ratio** (higher offshore = margin tailwind), **Attrition Rate**, and fresher vs. lateral hiring mix.
5.  **Guidance, Outlook & Targets:**
    *   **Management Commentary:** Summarize the qualitative outlook on client spending, discretionary IT budgets, and the macro environment.
    *   **Key Targets & Commitments:** Identify and list all specific, forward-looking targets from the transcript. For each, clearly state the **Metric**, **Target Value**, and **Timeframe**. Examples:
        *   **Financial:** Official revenue growth guidance for the year (e.g., "8-10% in CC").
        *   **Profitability:** Official operating margin guidance band (e.g., "20-22%").
        *   **Hiring:** Net headcount addition target.
        *   **AI/Gen-AI:** Any stated revenue targets or deal win ambitions for AI-led services.`;

// Life Sciences IT has a different Segment section — keep that, update rest
const IT_LIFE_SCIENCES_PROMPT = `**Role and Goal:** You are a senior IT/Technology analyst specializing in Life Sciences. Analyze this transcript focusing on revenue growth drivers, deal wins with pharma clients, and platform performance.
**Input:** \`[Paste Transcript Here]\`
**Instructions:** Structure your note with these headings.
1.  **Financial Performance:** Revenue (USD & INR), **Constant Currency (CC) Growth**, Operating Margin (EBIT), PAT. Note subcontracting cost as % of revenue (declining trend = positive margin signal).
2.  **Business Momentum:** **Total Contract Value (TCV)** of deal wins — note large deal count separately, deal pipeline, book-to-bill ratio. Include any **AI/ML-led deal wins or platform-based revenue color**.
3.  **Segment Performance:** Breakdown by client type (Pharma, Biotech, MedTech) and service line (Clinical Research, Data Analytics, Consulting). Flag any GCC setup or managed services commentary.
4.  **Client & Employee Metrics:** New client additions, revenue from large client buckets, **Top-5/Top-10 client concentration**, Headcount with **offshore/onshore ratio**, **Attrition Rate**, and fresher vs. lateral hiring mix.
5.  **Guidance, Outlook & Targets:**
    *   **Management Commentary:** Summarize the qualitative outlook on R&D spending by global pharma companies.
    *   **Key Targets & Commitments:** Identify and list all specific, forward-looking targets from the transcript. For each, clearly state the **Metric**, **Target Value**, and **Timeframe**. Examples:
        *   **Financial:** Official revenue growth guidance for the year.
        *   **Profitability:** Official operating margin guidance band.
        *   **Strategy:** Targets related to platform-based revenue or AI-led deals.`;

// SaaS/Software Products prompt — already well-differentiated, minor additions only
const IT_SAAS_PROMPT = `**Role and Goal:** You are a senior IT/Technology analyst focused on Software Products/SaaS. Analyze this transcript focusing on revenue growth, key business metrics like ARR, and client retention.
**Input:** \`[Paste Transcript Here]\`
**Instructions:** Structure your note with these headings.
1.  **Key Business Metrics:**
    *   **Annual Recurring Revenue (ARR)** / Monthly Recurring Revenue (MRR) and growth rate.
    *   Revenue breakdown: **Subscription vs. License vs. Professional Services**.
    *   **Net Revenue Retention (NRR)** or Dollar-Based Net Expansion Rate (>110% is a positive signal).
    *   Customer Acquisition Cost (CAC) and LTV/CAC ratio.
2.  **Financial Performance:** Revenue, Gross Margin, Operating Margin (Non-GAAP often used), PAT/Free Cash Flow. Note R&D spend as % of revenue.
3.  **Client & Strategy:**
    *   New logo wins and growth from existing clients (expansion ARR vs. new ARR mix).
    *   Commentary on **Gen-AI / AI features** launched and their contribution to ARPU uplift.
    *   R&D investment and product roadmap updates.
4.  **Guidance, Outlook & Targets:**
    *   **Management Commentary:** Summarize the qualitative outlook on customer demand and competitive landscape.
    *   **Key Targets & Commitments:** Identify and list all specific, forward-looking targets from the transcript. For each, clearly state the **Metric**, **Target Value**, and **Timeframe**. Examples:
        *   **ARR:** ARR growth guidance for the year.
        *   **Profitability:** Target for non-GAAP operating margin or timeline to achieve positive cash flow.
        *   **NRR:** Aspirational target for Net Revenue Retention.
        *   **AI:** Revenue contribution from AI-enabled features.`;

// ── METALS PROMPTS ──────────────────────────────────────────────────────────

// Ferroalloys (manganese ore inputs, power-intensive)
const METALS_FERROALLOYS_PROMPT = `**Role and Goal:** You are a Metals & Mining analyst. Analyze this transcript focusing on volume, realization, cost of production, and global price linkage.
**Input:** \`[Paste Transcript Here]\`
**Instructions:** Structure your note with these headings.
1.  **Operational Performance:** Production & Sales Volumes (in tonnes/kilo tonnes). Note ore grade trends if disclosed (declining grade = rising future unit costs).
2.  **Financials:** Revenue, PAT, **Net Debt and Net Debt/EBITDA ratio**, and **EBITDA/tonne**.
3.  **Pricing & Cost:**
    *   **Average Sales Realization** per tonne.
    *   Commentary on global benchmarks for ferroalloys.
    *   Cost of production and key input trends (manganese ore, power). Note **power cost per unit** and captive power advantage vs. grid.
    *   **Cost curve positioning** (e.g., first/second quartile globally — signals competitive moat and pricing buffer).
    *   **Hedge book status** if applicable (% of production hedged and at what price).
4.  **Guidance, Outlook & Targets:**
    *   **Management Commentary:** Summarize the qualitative outlook on demand from the steel industry and global prices.
    *   **Key Targets & Commitments:** Identify and list all specific, forward-looking targets from the transcript. For each, clearly state the **Metric**, **Target Value**, and **Timeframe**. Examples:
        *   **Volume:** Production/sales volume guidance.
        *   **Cost:** Cost control targets.
        *   **Capex:** Planned investments in furnace upgrades or new capacity.
        *   **Debt:** Net debt reduction target.`;

// Aluminium (LME-linked, alumina as key input)
const METALS_ALUMINIUM_PROMPT = `**Role and Goal:** You are a Metals & Mining analyst. Analyze this transcript focusing on volume, realization, cost of production, and global price linkage (LME).
**Input:** \`[Paste Transcript Here]\`
**Instructions:** Structure your note with these headings.
1.  **Operational Performance:** Production & Sales Volumes (in kilo tonnes). Note ore/alumina availability and captive bauxite mine contribution.
2.  **Financials:** Revenue, PAT, **Net Debt and Net Debt/EBITDA ratio**, and **EBITDA/tonne**.
3.  **Pricing & Cost:**
    *   **Average Sales Realization** per tonne.
    *   Commentary on global benchmarks (**LME Aluminium prices**) and aluminium premium.
    *   Cost of production and key input trends (**alumina cost** — typically >50% of smelting cost, coal/power, carbon anodes).
    *   **Power cost per unit** and captive vs. grid power mix (power is the single largest cost variable).
    *   **Cost curve positioning** (quartile globally) and **hedge book status** (% hedged and at what price).
4.  **Guidance, Outlook & Targets:**
    *   **Management Commentary:** Summarize the qualitative outlook on the global supply-demand balance and LME prices.
    *   **Key Targets & Commitments:** Identify and list all specific, forward-looking targets from the transcript. For each, clearly state the **Metric**, **Target Value**, and **Timeframe**. Examples:
        *   **Volume:** Production/sales volume guidance.
        *   **Cost:** Cost of production target (e.g., "aim to be in first quartile of global cost curve").
        *   **Capex:** Planned investments for smelter/refinery expansion.
        *   **Debt:** Net debt reduction target.`;

// Copper (LME-linked, Tc/Rc important)
const METALS_COPPER_PROMPT = `**Role and Goal:** You are a Metals & Mining analyst. Analyze this transcript focusing on volume, realization, cost of production, and global price linkage (LME).
**Input:** \`[Paste Transcript Here]\`
**Instructions:** Structure your note with these headings.
1.  **Operational Performance:** Production & Sales Volumes (in kilo tonnes). Note ore grade at mines (declining grade = rising C1 costs going forward).
2.  **Financials:** Revenue, PAT, **Net Debt and Net Debt/EBITDA ratio**, and **EBITDA/tonne**.
3.  **Pricing & Cost:**
    *   **Average Sales Realization** per tonne.
    *   Commentary on global benchmarks (**LME Copper prices**) and **Treatment & Refining Charges (Tc/Rc)** trends — declining Tc/Rc squeezes custom smelter margins.
    *   Cost of production (C1 cash cost, C3 fully-allocated cost).
    *   **Cost curve positioning** (quartile globally) and **hedge book status** (% of production hedged and at what price).
4.  **Guidance, Outlook & Targets:**
    *   **Management Commentary:** Summarize the qualitative outlook on the global supply-demand balance and LME prices.
    *   **Key Targets & Commitments:** Identify and list all specific, forward-looking targets from the transcript. For each, clearly state the **Metric**, **Target Value**, and **Timeframe**. Examples:
        *   **Volume:** Production/sales volume guidance.
        *   **Cost:** Cost of production target.
        *   **Capex:** Planned investments for smelter/refinery expansion.
        *   **Debt:** Net debt reduction target.`;

// Zinc/Multi-metal (Zinc, Lead, Silver — often co-produced)
const METALS_ZINC_MULTIMETAL_PROMPT = `**Role and Goal:** You are a Metals & Mining analyst. Analyze this transcript focusing on volume, realization, cost of production, and global price linkage for multiple metals.
**Input:** \`[Paste Transcript Here]\`
**Instructions:** Structure your note with these headings.
1.  **Operational Performance:** Production & Sales Volumes for each key metal (e.g., Zinc, Silver, Lead in kilo tonnes). Note ore grade trend (mined ore grade — declining grade is a future cost headwind).
2.  **Financials:** Revenue, PAT, **Net Debt and Net Debt/EBITDA ratio**, and **EBITDA/tonne** for each major segment.
3.  **Pricing & Cost:**
    *   **Average Sales Realization** per tonne for each metal.
    *   Commentary on global benchmarks (LME Zinc, LME Lead prices) and silver realization per oz.
    *   Cost of production for each metal (**CoP/tonne of Zinc** is the key metric).
    *   **Hedge book status** (% of production hedged and at what price — material for earnings sensitivity).
    *   **Cost curve positioning** (quartile globally for zinc mining — signals competitive advantage).
4.  **Guidance, Outlook & Targets:**
    *   **Management Commentary:** Summarize the qualitative outlook on the global commodity cycle for various metals.
    *   **Key Targets & Commitments:** Identify and list all specific, forward-looking targets from the transcript. For each, clearly state the **Metric**, **Target Value**, and **Timeframe**. Examples:
        *   **Volume:** Production guidance for each metal for the year.
        *   **Cost:** Target for cost of production.
        *   **Capex:** Planned investments in mine development or smelter expansion.
        *   **Mine Life:** Reserve/resource update or commentary on mine depletion rate.`;

// Zinc single-metal (IN010302003 — focuses on Zinc/Silver/Lead)
const METALS_ZINC_SINGLE_PROMPT = `**Role and Goal:** You are a Metals & Mining analyst. Analyze this transcript focusing on volume, realization, cost of production, and global price linkage (LME).
**Input:** \`[Paste Transcript Here]\`
**Instructions:** Structure your note with these headings.
1.  **Operational Performance:** Production & Sales Volumes of refined Zinc and other metals like Silver/Lead (in kilo tonnes). Note ore grade trend (declining grade = rising CoP trajectory).
2.  **Financials:** Revenue, PAT, **Net Debt and Net Debt/EBITDA ratio**, and **Zinc EBITDA/tonne**.
3.  **Pricing & Cost:**
    *   **Average Sales Realization** per tonne for each metal.
    *   Commentary on global benchmarks (**LME Zinc prices**) and silver realization.
    *   **Cost of Production (CoP)** per tonne of Zinc (key profitability lever).
    *   **Hedge book status** (% of production hedged and at what price).
    *   **Cost curve positioning** (quartile globally — signals competitive advantage).
4.  **Guidance, Outlook & Targets:**
    *   **Management Commentary:** Summarize the qualitative outlook on the global supply-demand balance and LME prices.
    *   **Key Targets & Commitments:** Identify and list all specific, forward-looking targets from the transcript. For each, clearly state the **Metric**, **Target Value**, and **Timeframe**. Examples:
        *   **Volume:** Production/sales volume guidance for Zinc and Silver.
        *   **Cost:** Cost of production target.
        *   **Capex:** Planned investments in mine development or smelter expansion.
        *   **Mine Life:** Reserve/resource update or commentary on depletion.`;

// Generic iron/steel inputs (pig iron, DRI, sponge iron — iron ore linked)
const METALS_IRON_STEEL_PROMPT = `**Role and Goal:** You are a Metals & Mining analyst. Analyze this transcript focusing on volume, realization, cost of production, and global price linkage.
**Input:** \`[Paste Transcript Here]\`
**Instructions:** Structure your note with these headings.
1.  **Operational Performance:** Production & Sales Volumes (in tonnes/kilo tonnes). Note ore grade or Fe content trends if disclosed.
2.  **Financials:** Revenue, PAT, **Net Debt and Net Debt/EBITDA ratio**, and **EBITDA/tonne**.
3.  **Pricing & Cost:**
    *   **Average Sales Realization** per tonne.
    *   Commentary on global benchmarks (e.g., LME, HRC prices, iron ore indices).
    *   Cost of production and key input trends (coking coal, iron ore, power). Note **spread over raw material costs** as the key margin driver.
    *   **Cost curve positioning** (quartile globally where applicable).
    *   **Hedge book status** if applicable (% hedged and at what price).
4.  **Guidance, Outlook & Targets:**
    *   **Management Commentary:** Summarize the qualitative outlook on demand from foundries, steel mills, and end-user industries.
    *   **Key Targets & Commitments:** Identify and list all specific, forward-looking targets from the transcript. For each, clearly state the **Metric**, **Target Value**, and **Timeframe**. Examples:
        *   **Volume:** Production/sales volume guidance.
        *   **Margins:** Outlook on spreads over raw material costs.
        *   **Capex:** Planned investments in plant modernization.
        *   **Debt:** Net debt reduction target.`;

// Coal / Iron Ore Mining (IN030104 — volume from mines, e-auction)
const METALS_COAL_MINING_PROMPT = `**Role and Goal:** You are a Metals & Mining analyst. Analyze this transcript focusing on production/sales volume, realization per tonne, and cost of production.
**Input:** \`[Paste Transcript Here]\`
**Instructions:** Structure your note with these headings.
1.  **Operational Performance:** Production & Sales Volumes (in Million Tonnes) from mining and trading. Note **stripping ratio / overburden removal** (higher ratio = rising costs) and mine life / reserve life remaining.
2.  **Financials:** Revenue, PAT, **Net Debt and Net Debt/EBITDA ratio**, and **EBITDA/tonne**.
3.  **Pricing & Cost:**
    *   **Average Sales Realization** per tonne — breakdown between **e-auction premium** vs. linkage/government-notified prices.
    *   Cost of production and trends in overburden removal costs. Note **royalty and statutory levies** as a % of realization.
4.  **Guidance, Outlook & Targets:**
    *   **Management Commentary:** Summarize the qualitative outlook on demand from the power sector, steel mills, and global coal prices.
    *   **Key Targets & Commitments:** Identify and list all specific, forward-looking targets from the transcript. For each, clearly state the **Metric**, **Target Value**, and **Timeframe**. Examples:
        *   **Volume:** Production volume target for the year.
        *   **Capex:** Planned investment in new mines or equipment.
        *   **Dispatch:** Target for offtake/dispatch volumes.
        *   **Reserves:** Commentary on reserve life or new mine allocation status.`;

// Minerals (Titanium, Zircon, rare-earth — end-user: ceramics, paints, aerospace)
const METALS_MINERALS_PROMPT = `**Role and Goal:** You are a Metals & Mining analyst. Analyze this transcript focusing on volume, realization, cost of production, and global price linkage.
**Input:** \`[Paste Transcript Here]\`
**Instructions:** Structure your note with these headings.
1.  **Operational Performance:** Production & Sales Volumes (in tonnes/kilo tonnes). Note ore grade and mine life remaining (depletion rate).
2.  **Financials:** Revenue, PAT, **Net Debt and Net Debt/EBITDA ratio**, and **EBITDA/tonne**.
3.  **Pricing & Cost:**
    *   **Average Sales Realization** per tonne.
    *   Commentary on global benchmarks and demand-supply dynamics for the mineral.
    *   Cost of production and key input trends (power, mining costs).
4.  **Guidance, Outlook & Targets:**
    *   **Management Commentary:** Summarize the qualitative outlook on demand from end-user industries (e.g., ceramics, paints, aerospace) and global prices.
    *   **Key Targets & Commitments:** Identify and list all specific, forward-looking targets from the transcript. For each, clearly state the **Metric**, **Target Value**, and **Timeframe**. Examples:
        *   **Volume:** Production/sales volume guidance.
        *   **Capex:** Planned investments for mine development or processing plant upgrades.
        *   **Reserves:** Reserve/resource update.`;

// Downstream metals products (steel pipes, tubes, extrusions — spread business)
const METALS_DOWNSTREAM_PIPES_PROMPT = `**Role and Goal:** You are a Metals & Mining analyst focusing on downstream products. Analyze this transcript focusing on sales volumes of value-added products, spreads over steel prices, and end-industry demand.
**Input:** \`[Paste Transcript Here]\`
**Instructions:** Structure your note with these headings.
1.  **Financial Performance:** Revenue, EBITDA, PAT, and margin analysis. Note **working capital days** (steel inventory is lumpy and can tie up significant capital).
2.  **Operational Drivers:**
    *   Sales volumes of value-added products (e.g., pipes, tubes, sheets) — note premium product mix as % of total.
    *   Commentary on **spreads** over base HRC/steel prices — the core profitability driver.
3.  **Market Dynamics:**
    *   Demand from key end-user industries (e.g., Auto, Construction, Infra, Oil & Gas). Note any **anti-dumping duty protection** on imported products — regulatory tailwind.
    *   Export vs. Domestic sales mix.
4.  **Guidance, Outlook & Targets:**
    *   **Management Commentary:** Summarize the qualitative outlook on end-user demand and steel price volatility.
    *   **Key Targets & Commitments:** Identify and list all specific, forward-looking targets from the transcript. For each, clearly state the **Metric**, **Target Value**, and **Timeframe**. Examples:
        *   **Volume:** Sales volume growth target.
        *   **Spreads:** Outlook on the stability of spreads.
        *   **Capex:** Investments for new value-added product lines.
        *   **Mix:** Target share of high-margin premium/value-added products.`;

// Downstream aluminium products (extrusions, foils, rods)
const METALS_DOWNSTREAM_ALUMINIUM_PROMPT = `**Role and Goal:** You are a Metals & Mining analyst focusing on downstream products. Analyze this transcript focusing on sales volumes of value-added products, spreads over metal prices, and end-industry demand.
**Input:** \`[Paste Transcript Here]\`
**Instructions:** Structure your note with these headings.
1.  **Financial Performance:** Revenue, EBITDA, PAT, and margin analysis. Note **working capital days** (metal inventory can be significant).
2.  **Operational Drivers:**
    *   Sales volumes of value-added products (e.g., extrusions, foils, rods) — note premium product mix as % of total.
    *   Commentary on **spreads** over base metal prices (LME) — the core profitability driver.
3.  **Market Dynamics:**
    *   Demand from key end-user industries (e.g., Electrical, Auto, Construction, Packaging). Note any **anti-dumping duty protection** on imported products.
    *   Export vs. Domestic sales mix.
4.  **Guidance, Outlook & Targets:**
    *   **Management Commentary:** Summarize the qualitative outlook on end-user demand and metal price volatility.
    *   **Key Targets & Commitments:** Identify and list all specific, forward-looking targets from the transcript. For each, clearly state the **Metric**, **Target Value**, and **Timeframe**. Examples:
        *   **Volume:** Sales volume growth target (e.g., "expect 10% volume growth").
        *   **Product Mix:** Target share of high-margin value-added products.
        *   **Capex:** Investments for new product lines.
        *   **Spreads:** Aspirational spread target over base metal.`;

// ─────────────────────────────────────────────────────────────────────────────
// MAPPING: Firebase link → new prompt text
// ─────────────────────────────────────────────────────────────────────────────

const UPDATES = {
    // ── Banking (3 prompts — all identical, same improvement) ──
    '/market/IN05/IN0501/IN050102/IN050102001/': BANKING_PROMPT,
    '/market/IN05/IN0501/IN050102/IN050102002/': BANKING_PROMPT,
    '/market/IN05/IN0501/IN050102/IN050102003/': BANKING_PROMPT,

    // ── IT / Technology ──
    // Generic IT Services (5 prompts — all identical)
    '/market/IN09/IN0901/IN090104/IN090104002/': IT_SERVICES_PROMPT,
    '/market/IN09/IN0901/IN090104/IN090104003/': IT_SERVICES_PROMPT,
    '/market/IN09/IN0901/IN090104/IN090104005/': IT_SERVICES_PROMPT,
    '/market/IN08/IN0801/IN080101/IN080101001/': IT_SERVICES_PROMPT,
    '/market/IN08/IN0801/IN080102/IN080102001/': IT_SERVICES_PROMPT,
    // Life Sciences IT
    '/market/IN06/IN0601/IN060103/IN060103003/': IT_LIFE_SCIENCES_PROMPT,
    // SaaS / Software Products
    '/market/IN08/IN0801/IN080101/IN080101002/': IT_SAAS_PROMPT,

    // ── Metals & Mining ──
    // Ferroalloys (manganese ore, power-intensive)
    '/market/IN01/IN0103/IN010301/IN010301001/': METALS_FERROALLOYS_PROMPT,
    // Iron/steel inputs (pig iron, DRI, sponge iron, pellets)
    '/market/IN01/IN0103/IN010301/IN010301002/': METALS_IRON_STEEL_PROMPT,
    '/market/IN01/IN0103/IN010301/IN010301003/': METALS_IRON_STEEL_PROMPT,
    '/market/IN01/IN0103/IN010301/IN010301004/': METALS_IRON_STEEL_PROMPT,
    '/market/IN01/IN0103/IN010302/IN010302004/': METALS_IRON_STEEL_PROMPT,
    // Aluminium
    '/market/IN01/IN0103/IN010302/IN010302001/': METALS_ALUMINIUM_PROMPT,
    // Copper
    '/market/IN01/IN0103/IN010302/IN010302002/': METALS_COPPER_PROMPT,
    // Zinc/multi-metal (Zinc + Silver + Lead together)
    '/market/IN01/IN0103/IN010303/IN010303001/': METALS_ZINC_MULTIMETAL_PROMPT,
    // Zinc single-focus
    '/market/IN01/IN0103/IN010302/IN010302003/': METALS_ZINC_SINGLE_PROMPT,
    // Coal / Iron Ore Mining
    '/market/IN03/IN0301/IN030104/IN030104001/': METALS_COAL_MINING_PROMPT,
    // Minerals (Titanium, Zircon, etc.)
    '/market/IN01/IN0103/IN010304/IN010304001/': METALS_MINERALS_PROMPT,
    // Downstream — Steel pipes/tubes/sheets
    '/market/IN07/IN0702/IN070205/IN070205015/': METALS_DOWNSTREAM_PIPES_PROMPT,
    // Downstream — Aluminium extrusions/foils/rods
    '/market/IN07/IN0702/IN070205/IN070205014/': METALS_DOWNSTREAM_ALUMINIUM_PROMPT,
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function run() {
    const dryRun = process.argv.includes('--dry-run');
    if (dryRun) console.log('🔍 DRY RUN MODE — no writes will be made\n');

    const fb = new FirebaseService();
    fb.initializeFirebase();
    const connected = await fb.testConnection();
    if (!connected) { console.error('❌ Firestore connection failed'); process.exit(1); }

    const collection = fb.db.collection('industryPrompts');
    const links = Object.keys(UPDATES);
    let updated = 0, notFound = 0, errors = 0;

    for (const link of links) {
        try {
            const snapshot = await collection.where('link', '==', link).get();
            if (snapshot.empty) {
                console.warn(`⚠️  Not found in Firestore: ${link}`);
                notFound++;
                continue;
            }
            if (!dryRun) {
                for (const doc of snapshot.docs) {
                    await doc.ref.update({ analystPrompt: UPDATES[link] });
                }
            }
            console.log(`✅ ${dryRun ? '[DRY] ' : ''}Updated: ${link}`);
            updated++;
        } catch (err) {
            console.error(`❌ Error on ${link}: ${err.message}`);
            errors++;
        }
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Not found: ${notFound}`);
    console.log(`   Errors: ${errors}`);
    console.log(`   Total: ${links.length}`);
    process.exit(0);
}

run().catch(err => { console.error('❌', err.message); process.exit(1); });
