/**
 * Updates ALL remaining 167 industry prompts in Firebase.
 * Uses text-injection — adds improvements to existing sections, preserving sub-sector specifics.
 * Run: node update-all-prompts.js [--dry-run]
 */
require('dotenv').config();
const FirebaseService = require('./src/services/FirebaseService');
const data = require('./industry-prompts-dump.json');

// ─── Already updated in previous run ────────────────────────────────────────
const ALREADY_DONE = new Set([
  '/market/IN05/IN0501/IN050102/IN050102001/','/market/IN05/IN0501/IN050102/IN050102002/','/market/IN05/IN0501/IN050102/IN050102003/',
  '/market/IN09/IN0901/IN090104/IN090104002/','/market/IN09/IN0901/IN090104/IN090104003/','/market/IN09/IN0901/IN090104/IN090104005/',
  '/market/IN08/IN0801/IN080101/IN080101001/','/market/IN08/IN0801/IN080102/IN080102001/','/market/IN06/IN0601/IN060103/IN060103003/','/market/IN08/IN0801/IN080101/IN080101002/',
  '/market/IN01/IN0103/IN010301/IN010301001/','/market/IN01/IN0103/IN010301/IN010301002/','/market/IN01/IN0103/IN010301/IN010301003/','/market/IN01/IN0103/IN010301/IN010301004/','/market/IN01/IN0103/IN010302/IN010302004/',
  '/market/IN01/IN0103/IN010302/IN010302001/','/market/IN01/IN0103/IN010302/IN010302002/','/market/IN01/IN0103/IN010303/IN010303001/','/market/IN01/IN0103/IN010302/IN010302003/',
  '/market/IN03/IN0301/IN030104/IN030104001/','/market/IN01/IN0103/IN010304/IN010304001/','/market/IN07/IN0702/IN070205/IN070205015/','/market/IN07/IN0702/IN070205/IN070205014/',
]);

// ─── Injection helpers ────────────────────────────────────────────────────────
// Injects `addition` after the last bullet in `sectionLabel` section.
function injectAfterSection(text, sectionLabel, addition) {
  const idx = text.indexOf(sectionLabel);
  if (idx === -1) return text;
  // find the end of this section = next numbered heading or end of string
  const afterSection = text.indexOf('\n4.', idx);
  const insertAt = afterSection === -1 ? text.length : afterSection;
  return text.slice(0, insertAt) + addition + '\n' + text.slice(insertAt);
}

// Injects `addition` right before "**Key Targets & Commitments:**" line
function injectBeforeTargets(text, addition) {
  const marker = '    *   **Key Targets & Commitments:**';
  const idx = text.indexOf(marker);
  if (idx === -1) return text + '\n' + addition;
  return text.slice(0, idx) + addition + '\n' + text.slice(idx);
}

// Appends an example bullet inside the guidance examples block
function appendGuidanceExample(text, bullet) {
  // Find the last "        *   **" bullet and append after it
  const lastBulletIdx = text.lastIndexOf('        *   **');
  if (lastBulletIdx === -1) return text;
  const endOfLine = text.indexOf('\n', lastBulletIdx);
  const insertAt = endOfLine === -1 ? text.length : endOfLine + 1;
  return text.slice(0, insertAt) + bullet + '\n' + text.slice(insertAt);
}

// ─── Role-based transformations ──────────────────────────────────────────────

function transform(key, text) {
  if (!text || typeof text !== 'string') return text;

  // ── CONSUMER DISCRETIONARY (all variants) ──────────────────────────────
  if (text.includes('Consumer Discretionary analyst') || text.includes('Consumer Staples/Discretionary analyst')) {
    text = injectAfterSection(text, '3.  **Operational Analysis:**',
      '    *   **Trade channel inventory** and destocking/restocking commentary (buildup ahead of season = demand pull-forward risk).\n' +
      '    *   **Distribution reach:** Number of active dealer/retail outlets and any expansion plans.\n' +
      '    *   **ASP (Average Selling Price)** trend — premiumization signal.'
    );
    text = appendGuidanceExample(text, '        *   **Price/Volume:** Split of revenue growth between price action and volume gains.');
    return text;
  }

  // ── INDUSTRIAL PRODUCTS (all variants) ────────────────────────────────
  if (text.includes('Industrial Products analyst') || text.includes('Industrial/Capital Goods analyst')) {
    text = injectAfterSection(text, '2.  **Operational Health:**',
      '    *   **Realization per unit / tonne** trend — pricing power and product mix signal.\n' +
      '    *   **Debtor days** and working capital cycle (capital goods companies often run 90-150 day debtors).'
    );
    if (text.includes('**Market & Strategy:**')) {
      text = injectAfterSection(text, '3.  **Market & Strategy:**',
        '    *   **Import competition** status and any anti-dumping duty protection on key products.'
      );
    }
    text = appendGuidanceExample(text, '        *   **Working Capital:** Target for debtor day or cash conversion cycle improvement.');
    return text;
  }

  // ── FMCG / STAPLES (all variants, except ITC diversified) ─────────────
  if (text.includes('FMCG/Staples analyst') || text.includes('Consumer Staples (Alco-Bev) analyst')) {
    // ITC has a very different structure — handle separately
    if (text.includes('Cigarette')) {
      text = injectAfterSection(text, '2.  **Diversified Business Performance:**',
        '    *   For FMCG-Others: note **household penetration** commentary and distribution reach gains.'
      );
      text = appendGuidanceExample(text, '        *   **Margins:** Aspirational EBITDA margin target for FMCG-Others segment.');
      return text;
    }
    // Dairy variant
    if (text.includes('milk')) {
      text = injectAfterSection(text, '3.  **Segment Performance:**',
        '    *   **Throughput per liter** of milk procured — operational efficiency signal.\n' +
        '    *   Distribution reach in new geographies (Tier 2/3 cities).'
      );
      text = appendGuidanceExample(text, '        *   **Distribution:** Goal for geographic expansion of refrigerated chain.');
      return text;
    }
    // Standard FMCG
    if (text.includes('3.  **Channel Performance:**') || text.includes('3.  **Channel & Segment Performance:**')) {
      const sec = text.includes('3.  **Channel & Segment Performance:**') ? '3.  **Channel & Segment Performance:**' : '3.  **Channel Performance:**';
      text = injectAfterSection(text, sec,
        '    *   **Direct distribution reach** (number of outlets directly serviced — key competitive moat indicator).\n' +
        '    *   **A&P spend as % of revenue** — ad spend trend (rising = investment mode; falling = margin expansion).\n' +
        '    *   **Media mix:** Shift to digital advertising from TV (if disclosed).'
      );
    }
    text = appendGuidanceExample(text, '        *   **Distribution:** Direct reach expansion target (e.g., "reach 1.5M outlets by FY27").');
    text = appendGuidanceExample(text, '        *   **A&P:** Expected ad spend trajectory as % of revenue.');
    return text;
  }

  // ── TRADING / DISTRIBUTION (all 8 identical prompts) ──────────────────
  if (text.includes('Trading/Distribution analyst')) {
    text = injectAfterSection(text, '2.  **Operational Efficiency:**',
      '    *   **Debtor Days** and credit terms offered to customers (long debtor days = working capital risk).\n' +
      '    *   **Supplier concentration** (revenue from top 3-5 suppliers as % — single-supplier dependency is a risk).'
    );
    text = injectAfterSection(text, '3.  **Business Strategy:**',
      '    *   **Value-added services** beyond pure trading (testing, logistics, financing, technical support) that justify premium margins.'
    );
    text = appendGuidanceExample(text, '        *   **Working Capital:** Target improvement in cash conversion cycle or debtor days.');
    text = appendGuidanceExample(text, '        *   **Value-add:** Plans to grow higher-margin services revenue share.');
    return text;
  }

  // ── CHEMICALS (all variants) ───────────────────────────────────────────
  if (text.includes('Chemicals sector analyst') || text.includes('Chemicals/Oil & Gas analyst')) {
    // Fertilizers variant
    if (text.includes('Urea') || text.includes('NBS') || text.includes('subsidy')) {
      text = injectAfterSection(text, '2.  **Operational Drivers:**',
        '    *   **Subsidy receivables** from government and collection timeline (a major working capital drag for fertilizer companies).'
      );
      text = appendGuidanceExample(text, '        *   **Subsidy:** Commentary on subsidy receivable reduction or government payment timeline.');
      return text;
    }
    // Agrochemicals variant
    if (text.includes('Herbicides') || text.includes('Insecticides') || text.includes('agrochemical') || text.includes('monsoon')) {
      text = injectAfterSection(text, '3.  **Market Dynamics:**',
        '    *   **Generic vs. proprietary product mix** (proprietary = higher margin and pricing power).\n' +
        '    *   **China import competition** — any anti-dumping investigations or price undercutting.'
      );
      text = appendGuidanceExample(text, '        *   **Registrations:** New product registration pipeline and target launches.');
      return text;
    }
    // Standard Chemicals
    text = injectAfterSection(text, '2.  **Operational Drivers:**',
      '    *   **Specialty vs. commodity product mix** and its trajectory (higher specialty % → better margins and defensibility).\n' +
      '    *   **Import competition:** Anti-dumping duty status and Chinese supply pressure on key products.'
    );
    text = injectAfterSection(text, '3.  **Cost Structure:**',
      '    *   **Power & fuel cost as % of total cost** (energy-intensive chemicals — captive power advantage if any).'
    );
    text = appendGuidanceExample(text, '        *   **Specialty Mix:** Target share of specialty/high-margin products in revenue.');
    return text;
  }

  // ── TRANSPORT & LOGISTICS ──────────────────────────────────────────────
  if (text.includes('Transport & Logistics analyst') || text.includes('Infrastructure analyst focused on Airports')) {
    // Aviation
    if (text.includes('ASKM') || text.includes('CASK') || text.includes('ATF') || text.includes('passenger traffic')) {
      text = injectAfterSection(text, '3.  **Cost Structure & Fleet:**',
        '    *   **Fuel hedging status** (% of ATF consumption hedged and at what price — material for earnings sensitivity).\n' +
        '    *   **On-time performance** % — operational quality and slot utilization.'
      );
      text = appendGuidanceExample(text, '        *   **Yield/RASK:** Guidance on yield trajectory and fare environment.');
      text = appendGuidanceExample(text, '        *   **Fleet:** Aircraft induction/retirement plan for the year.');
      return text;
    }
    // Shipping / Bulk carriers
    if (text.includes('charter') || text.includes('TCE') || text.includes('bunker') || text.includes('Fleet Size')) {
      text = injectAfterSection(text, '3.  **Cost Structure:**',
        '    *   **New vessel order book** (delivery pipeline) and industry scrapping rate (supply side dynamics).\n' +
        '    *   **Dry-docking schedule** and off-hire days impact.'
      );
      text = appendGuidanceExample(text, '        *   **Fleet:** Vessel delivery or acquisition plan for the year.');
      text = appendGuidanceExample(text, '        *   **TCE:** Outlook on freight rate / charter rate trajectory.');
      return text;
    }
    // Ports
    if (text.includes('TEU') || text.includes('berth') || text.includes('cargo') || text.includes('port')) {
      text = injectAfterSection(text, '3.  **Strategy & Expansion:**',
        '    *   **Vessel turnaround time (VTT)** — operational efficiency at port.\n' +
        '    *   **Market share** of EXIM trade at the port and competitive positioning vs. nearby ports.'
      );
      text = appendGuidanceExample(text, '        *   **Tariff:** Tariff revision timeline and rate hike quantum.');
      return text;
    }
    // Road freight / Express logistics
    if (text.includes('tonne') || text.includes('Express') || text.includes('warehouse') || text.includes('Volumes Handled')) {
      text = injectAfterSection(text, '3.  **Cost Structure & Network:**',
        '    *   **Empty km ratio** (trucks — lower is better, signals network fill efficiency).\n' +
        '    *   **B2B vs. B2C mix** (B2C typically higher yielding per kg, more complex to handle).\n' +
        '    *   **First-attempt delivery success rate** (for express/last-mile).'
      );
      text = appendGuidanceExample(text, '        *   **Network:** Target for new hub or service center additions.');
      text = appendGuidanceExample(text, '        *   **Yield:** Realization per tonne-km improvement target.');
      return text;
    }
    // Cold storage / specialized
    if (text.includes('cold') || text.includes('Cold')) {
      text = injectAfterSection(text, '2.  **Financial Performance:**',
        '    *   **Warehouse occupancy rate** and throughput per sqft.\n' +
        '    *   **Energy cost per unit stored** (refrigeration is power-intensive).'
      );
      return text;
    }
    // Generic T&L
    text = appendGuidanceExample(text, '        *   **Yield:** Revenue per unit (tonne, TEU, shipment) trajectory.');
    return text;
  }

  // ── MEDIA & ENTERTAINMENT ──────────────────────────────────────────────
  if (text.includes('Media & Entertainment analyst') && !text.includes('Internet')) {
    // Print media
    if (text.includes('newsprint') || text.includes('Circulation')) {
      text = injectAfterSection(text, '3.  **Strategy:**',
        '    *   **Digital revenue share** of total (rising digital reduces newsprint dependency).\n' +
        '    *   **Content licensing** income from digital platforms.'
      );
      text = appendGuidanceExample(text, '        *   **Digital:** Target for digital revenue as % of total.');
      return text;
    }
    // TV / Broadcasting
    text = injectAfterSection(text, '2.  **Financial Performance:**',
      '    *   **ARPU per subscriber** (cable/DTH) and subscription revenue stickiness.'
    );
    text = appendGuidanceExample(text, '        *   **Subscription:** Target for subscriber additions or ARPU improvement.');
    return text;
  }

  // ── MEDIA & ENTERTAINMENT / INTERNET (OTT) ────────────────────────────
  if (text.includes('Media & Entertainment/Internet analyst') || (text.includes('MAU') && text.includes('subscription'))) {
    text = injectAfterSection(text, '3.  **Content & Strategy:**',
      '    *   **Content amortization** schedule and remaining library value.\n' +
      '    *   **Original vs. licensed content** cost split (originals are typically 3-5x the cost but drive differentiation).\n' +
      '    *   **Cost per subscriber** (content + platform cost to acquire and retain 1 paying user).'
    );
    text = appendGuidanceExample(text, '        *   **Content:** Planned original content slate and budget for the year.');
    return text;
  }

  // ── RETAIL / INTERNET (E-commerce) ────────────────────────────────────
  if (text.includes('Retail/Internet analyst') || (text.includes('GMV') && text.includes('Take Rate'))) {
    text = injectAfterSection(text, '2.  **Operational Performance:**',
      '    *   **Contribution margin per order** — unit economics signal.\n' +
      '    *   **Return rate** % (high returns compress realized revenue and inflate fulfillment costs).\n' +
      '    *   **Customer Acquisition Cost (CAC)** vs. repeat purchase rate.'
    );
    text = appendGuidanceExample(text, '        *   **Unit Economics:** Path to positive contribution margin per order.');
    return text;
  }

  // ── RETAIL (QSR/Restaurants) ──────────────────────────────────────────
  if (text.includes('QSR') || text.includes('same-store s') && text.includes('restaurant')) {
    text = injectAfterSection(text, '2.  **Operational Performance:**',
      '    *   **Delivery vs. dine-in mix** — platform (Zomato/Swiggy) delivery fees compress margins vs. dine-in.\n' +
      '    *   **Digital ordering share** (own app vs. aggregator — own platform avoids ~20% platform commission).\n' +
      '    *   **Royalty** payable to master franchisee as % of revenue (typically 3-6%, fixed drag).'
    );
    text = appendGuidanceExample(text, '        *   **Digital:** Own-app ordering share target to reduce platform commission drag.');
    return text;
  }

  // ── RETAIL (Fashion / Pharma / General) ────────────────────────────────
  if (text.includes('Retail analyst') && !text.includes('QSR') && !text.includes('Internet')) {
    text = injectAfterSection(text, '2.  **Operational Performance:**',
      '    *   **Return rate** % for fashion (high returns = inflated GMV).\n' +
      '    *   **Online channel contribution** to revenue and margin differential vs. stores.'
    );
    text = injectAfterSection(text, '3.  **Customer Metrics:**',
      '    *   **Loyalty program metrics:** Repeat customer %, members as % of total revenue.'
    );
    text = appendGuidanceExample(text, '        *   **Online:** Target for e-commerce share of total revenue.');
    return text;
  }

  // ── AUTO OEM ───────────────────────────────────────────────────────────
  if (text.includes('Automotive OEM analyst')) {
    text = injectAfterSection(text, '1.  **Operational Highlights:**',
      '    *   **Dealer inventory days** (channel inventory buildup = demand signal is cautious).\n' +
      '    *   **Waiting period** for top models (long wait = supply constrained, strong demand).'
    );
    text = injectAfterSection(text, '3.  **Strategic & Segment Analysis:**',
      '    *   **Hybrid (mild/strong HEV) vs. pure EV** mix — regulatory tailwind differentiation.\n' +
      '    *   **PLI scheme benefits** received or accrued (EV/advanced auto components incentive).'
    );
    text = appendGuidanceExample(text, '        *   **PLI:** Expected PLI benefit accrual for the year.');
    return text;
  }

  // ── AUTO ANCILLARY ─────────────────────────────────────────────────────
  if (text.includes('Auto Ancillary analyst')) {
    text = injectAfterSection(text, '2.  **Business Drivers & Segment Mix:**',
      '    *   **EV content per vehicle** estimate vs. ICE content — key for investor narrative.\n' +
      '    *   **Tier-1 vs. Tier-2** customer mix (Tier-1 is OEM direct; Tier-2 is to Tier-1 supplier — different margin profiles).'
    );
    text = appendGuidanceExample(text, '        *   **EV Content:** Target content per EV vehicle in next-gen models.');
    return text;
  }

  // ── AUTO RETAIL ────────────────────────────────────────────────────────
  if (text.includes('Auto Retail analyst')) {
    text = injectAfterSection(text, '2.  **Financial Performance:**',
      '    *   **Per vehicle realization** and gross margin per vehicle (new vs. used).\n' +
      '    *   **Ancillary revenue** share (insurance, accessories, service — higher margin than vehicle sales).\n' +
      '    *   **Used car** volume and margins (growing high-margin segment).'
    );
    text = appendGuidanceExample(text, '        *   **Ancillary Revenue:** Target for non-vehicle revenue share.');
    return text;
  }

  // ── TYRES & RUBBER ────────────────────────────────────────────────────
  if (text.includes('Tyres & Rubber analyst')) {
    text = injectAfterSection(text, '2.  **Segment & Product Performance:**',
      '    *   **OEM vs. Replacement market mix** — replacement is higher-margin and more stable.\n' +
      '    *   **Natural rubber vs. synthetic rubber** procurement cost and the RM basket composition.\n' +
      '    *   **Export realization** and market share in key overseas markets.'
    );
    text = appendGuidanceExample(text, '        *   **Replacement Share:** Target for replacement market revenue share.');
    return text;
  }

  // ── BUILDING MATERIALS (tiles, ceramics, sanitaryware) ─────────────────
  if (text.includes('Building Materials analyst')) {
    text = injectAfterSection(text, '2.  **Operational Performance:**',
      '    *   **Gas cost per unit** (primary fuel for kiln firing — typically 25-35% of production cost).\n' +
      '    *   **Import competition** from China/Vietnam — price undercutting on commodity grades.\n' +
      '    *   **Premium/GVT (Glazed Vitrified Tiles) mix** as % of volume — premium mix = better margins.'
    );
    text = appendGuidanceExample(text, '        *   **Premium Mix:** Target for GVT/premium product share of revenue.');
    return text;
  }

  // ── CEMENT / BUILDING MATERIALS ────────────────────────────────────────
  if (text.includes('Cement/Building Materials analyst') || text.includes('Cement analyst')) {
    text = injectAfterSection(text, '2.  **Financial Performance:**',
      '    *   **Realization per bag / per tonne** — pricing power signal by region.\n' +
      '    *   **Fuel mix:** Coal vs. petcoke vs. AFR (Alternative Fuels & Raw Materials) — AFR is cheapest and growing.\n' +
      '    *   **Capacity utilization %** — below 80% is structural demand weakness signal.'
    );
    text = appendGuidanceExample(text, '        *   **Realization:** Guidance on pricing per bag / tonne direction.');
    text = appendGuidanceExample(text, '        *   **Cost:** Fuel mix optimization and target EBITDA/tonne improvement.');
    return text;
  }

  // ── CAPITAL MARKETS (Wealth Management) ────────────────────────────────
  if (text.includes('Capital Markets analyst') && !text.includes('Credit Rating') && !text.includes('Brokerage')) {
    text = injectAfterSection(text, '2.  **Financial Performance:**',
      '    *   **Trailing fee vs. upfront commission** mix (trailing fees = annuity nature, recurring and defensible).\n' +
      '    *   **Revenue yield on AUM** trend (compression due to competitive pricing or product mix shift).'
    );
    text = appendGuidanceExample(text, '        *   **Product Mix:** Target share of wealth products with trailing fee structure.');
    return text;
  }

  // ── CAPITAL MARKETS (Brokerage) ────────────────────────────────────────
  if (text.includes('Capital Markets analyst focused on Brokerage')) {
    text = injectAfterSection(text, '1.  **Operational Metrics:**',
      '    *   **Active client base** (traded at least once in the month/quarter) — not just total registered.\n' +
      '    *   **ADTO (Average Daily Turnover)** in F&O vs. Cash segment split.\n' +
      '    *   **Revenue per active client** (yield) — key efficiency metric.\n' +
      '    *   **MTF (Margin Trade Funding)** book size and interest income contribution.'
    );
    text = appendGuidanceExample(text, '        *   **Active Clients:** Target for active client base growth.');
    text = appendGuidanceExample(text, '        *   **ADTO:** Market share in F&O and Cash segments.');
    return text;
  }

  // ── POWER & UTILITIES (all variants) ──────────────────────────────────
  if (text.includes('Power & Utilities analyst')) {
    // Generation
    if (text.includes('Generation') || text.includes('PLF') || text.includes('thermal') || text.includes('renewable') || text.includes('Solar') || text.includes('Wind')) {
      text = injectAfterSection(text, '1.  **Operational Performance:**',
        '    *   **PLF (Plant Load Factor)** % for thermal plants (below 65% signals low dispatch).\n' +
        '    *   **CUF (Capacity Utilization Factor)** for renewable (solar/wind) by plant.\n' +
        '    *   **Merchant power** volume and spot market realization (upside over PPA tariffs).'
      );
      text = injectAfterSection(text, '2.  **Financial Performance:**',
        '    *   **DISCOM receivable ageing** — state utility payment delays are a chronic risk.'
      );
      text = appendGuidanceExample(text, '        *   **PPA:** New PPA signed or pipeline for renewable capacity.');
      return text;
    }
    // Distribution
    if (text.includes('Distribution') || text.includes('AT&C') || text.includes('DISCOM')) {
      text = injectAfterSection(text, '1.  **Operational Performance:**',
        '    *   **AT&C losses** (Aggregate Technical & Commercial) % — target under 12-15% is considered good.\n' +
        '    *   **Billing efficiency** and collection efficiency % (chronic low collection = revenue leakage).'
      );
      text = appendGuidanceExample(text, '        *   **AT&C Losses:** Target reduction in AT&C losses (bps improvement per year).');
      return text;
    }
    // Transmission
    if (text.includes('Transmission') || text.includes('transmission')) {
      text = injectAfterSection(text, '1.  **Operational Performance:**',
        '    *   **System availability** % (near 100% is expected — below 99% triggers penalty).\n' +
        '    *   **Capitalization rate** of assets commissioned during the quarter.'
      );
      text = appendGuidanceExample(text, '        *   **Capitalization:** Assets targeted for commissioning and tariff addition in the year.');
      return text;
    }
    // Trading
    if (text.includes('Trading') || text.includes('exchange')) {
      text = injectAfterSection(text, '1.  **Operational Performance:**',
        '    *   **Volume traded** on exchanges (IEX, PXIL) vs. bilateral contracts.\n' +
        '    *   **Average market clearing price (MCP)** trend on the exchange.'
      );
      return text;
    }
    // Generic / Integrated
    text = injectAfterSection(text, '1.  **Operational Performance:**',
      '    *   **PLF (Plant Load Factor)** % for thermal assets.\n' +
      '    *   **DISCOM receivable ageing** — state utility payment delays are a key credit risk.'
    );
    text = appendGuidanceExample(text, '        *   **Receivables:** Target for DISCOM receivable collection improvement.');
    return text;
  }

  // ── PACKAGING / PAPER ──────────────────────────────────────────────────
  if (text.includes('Packaging/Paper analyst') || text.includes('Packaging analyst')) {
    text = injectAfterSection(text, '3.  **Cost & Pricing:**',
      '    *   **Recovered/wastepaper cost** (for recycled-fiber-based mills — ~60% of RM cost).\n' +
      '    *   **Demand from e-commerce** for corrugated packaging (structural growth driver).\n' +
      '    *   **Capacity utilization** vs. industry — below 80% signals oversupply risk.'
    );
    text = appendGuidanceExample(text, '        *   **E-commerce Demand:** Share of revenue from packaging for e-commerce clients.');
    return text;
  }

  // ── TELECOM ────────────────────────────────────────────────────────────
  if (text.includes('Telecom analyst') && !text.includes('Infrastructure')) {
    text = injectAfterSection(text, '1.  **Key Performance Indicators (KPIs):**',
      '    *   **Postpaid subscriber mix %** and postpaid ARPU (postpaid = higher-value, lower churn).\n' +
      '    *   **Fixed Wireless Access (FWA) / Home Broadband** subscriber additions — primary 5G monetization path.\n' +
      '    *   Data usage per subscriber (GB/month) — network investment justification.'
    );
    text = injectAfterSection(text, '3.  **Network & Strategy:**',
      '    *   **EBITDA – Capex** (FCF proxy) — critical for heavily indebted telcos.\n' +
      '    *   **Spectrum debt** repayment schedule and its impact on free cash flow.'
    );
    text = appendGuidanceExample(text, '        *   **FWA:** Target for Fixed Wireless Access subscriber additions.');
    text = appendGuidanceExample(text, '        *   **FCF:** EBITDA-Capex trajectory and deleveraging timeline.');
    return text;
  }

  // ── TELECOM INFRASTRUCTURE (Towers) ───────────────────────────────────
  if (text.includes('Telecom Infrastructure analyst')) {
    text = injectAfterSection(text, '1.  **Key Performance Indicators (KPIs):**',
      '    *   **Tenancy ratio** (co-locations per tower — target > 2.0 for operating leverage).\n' +
      '    *   **Amendment revenue** per tower (5G antenna addition upgrades — growing revenue stream).\n' +
      '    *   **Churn** of anchor tenants (risk if a telco exits or consolidates).'
    );
    text = appendGuidanceExample(text, '        *   **Tenancy:** Target tenancy ratio for the year.');
    text = appendGuidanceExample(text, '        *   **Amendments:** Revenue from 5G densification amendments.');
    return text;
  }

  // ── TRAVEL & LEISURE / HOSPITALITY / HOTELS ───────────────────────────
  if (text.includes('Travel & Leisure analyst') || text.includes('Hospitality sector analyst')) {
    // Hotels
    if (text.includes('Hotel') || text.includes('hotel') || text.includes('RevPAR') || text.includes('occupancy') || text.includes('ARR')) {
      text = injectAfterSection(text, '1.  **Key Operational Metrics:**',
        '    *   **ADR (Average Daily Rate)**, **Occupancy %**, and **RevPAR** (Revenue per Available Room).\n' +
        '    *   **Owned vs. managed vs. leased** property mix (managed = asset-light, no capex, ~5-8% fee income).\n' +
        '    *   **MICE (Meetings, Incentives, Conferences, Exhibitions)** segment recovery — high-margin.\n' +
        '    *   **F&B revenue** as % of total and EBITDA contribution.'
      );
      text = appendGuidanceExample(text, '        *   **Room Additions:** Managed property signing pipeline for the year.');
      text = appendGuidanceExample(text, '        *   **RevPAR:** Guidance on RevPAR growth trajectory.');
      return text;
    }
    // Generic
    text = appendGuidanceExample(text, '        *   **RevPAR / Yield:** Key rate metric guidance for the season.');
    return text;
  }

  // ── HEALTHCARE SERVICES ────────────────────────────────────────────────
  if (text.includes('Healthcare Services analyst')) {
    text = injectAfterSection(text, '2.  **Operational Metrics:**',
      '    *   **Payer mix:** Insurance/TPA % vs. Government (Ayushman Bharat/State schemes) vs. Cash pay (margins vary dramatically: cash > insurance > government).\n' +
      '    *   **ICU bed occupancy** separately (ICU ARPOB is typically 3-4x general ward).\n' +
      '    *   **ALOS (Average Length of Stay)** trend — declining ALOS with same revenue = improving throughput efficiency.\n' +
      '    *   **Specialty mix:** Oncology, Cardiac, Ortho share — these are high-margin specialties.'
    );
    text = injectAfterSection(text, '3.  **Financial & Growth:**',
      '    *   **Staff cost as % of revenue** — nursing/specialist shortage is driving cost inflation.\n' +
      '    *   **Mature bed EBITDA** vs. **ramp-up bed EBITDA** (new hospitals dilute margins in early years).'
    );
    text = appendGuidanceExample(text, '        *   **Payer Mix:** Target insurance/TPA mix and Ayushman Bharat acceptance commentary.');
    text = appendGuidanceExample(text, '        *   **Mature vs. Ramp-up:** Expected timeline for new hospitals to reach mature ARPOB.');
    return text;
  }

  // ── AGRI-BUSINESS ─────────────────────────────────────────────────────
  if (text.includes('Agri-business analyst') || text.includes('Agri-business/FMCG analyst')) {
    text = injectAfterSection(text, '2.  **Financial Performance:**',
      '    *   **Crop season commentary** (kharif/rabi sowing area and outlook — direct demand driver).\n' +
      '    *   **Procurement cost** per tonne and dependence on specific geographies for sourcing.'
    );
    // Seafood variant
    if (text.includes('seafood') || text.includes('Seafood') || text.includes('shrimp') || text.includes('aquaculture')) {
      text = injectAfterSection(text, '2.  **Financial Performance:**',
        '    *   **Export market mix** — US/EU/Japan duty structure and anti-dumping duty risk.\n' +
        '    *   **Disease risk** (white spot / EMS in shrimp — can wipe out a harvest season).'
      );
    }
    text = appendGuidanceExample(text, '        *   **Season:** Commentary on upcoming crop season expectations and sowing progress.');
    return text;
  }

  // ── REAL ESTATE ────────────────────────────────────────────────────────
  if (text.includes('Real Estate analyst')) {
    text = injectAfterSection(text, '1.  **Operational Performance:**',
      '    *   **Average Selling Price (ASP)** per sq ft and YoY change — pricing power signal.\n' +
      '    *   **Channel partner vs. direct sales** mix (high channel dependency = 5-7% brokerage drag on margins).\n' +
      '    *   **Collection efficiency %** (collections / billing — should be > 85% for cash conversion health).'
    );
    text = injectAfterSection(text, '3.  **Project Pipeline:**',
      '    *   **GDV (Gross Development Value)** of new launch pipeline.\n' +
      '    *   **JDA (Joint Development Agreement) vs. outright purchase** mix (JDA = capital-light expansion).\n' +
      '    *   **Unsold inventory ageing** by category — ready-to-move unsold is a discount risk.'
    );
    text = appendGuidanceExample(text, '        *   **ASP:** Guidance on pricing direction in key micro-markets.');
    text = appendGuidanceExample(text, '        *   **JDA Pipeline:** Land sourcing through JDA to fund asset-light growth.');
    return text;
  }

  // ── REIT ───────────────────────────────────────────────────────────────
  if (text.includes('REIT analyst')) {
    text = injectAfterSection(text, '1.  **Portfolio Performance:**',
      '    *   **Mark-to-Market (MTM) opportunity** on in-place rents vs. market rents (embedded reversion upside).\n' +
      '    *   **GCC (Global Capability Center) tenant share** — GCCs are expanding aggressively in India office.'
    );
    text = injectAfterSection(text, '3.  **Balance Sheet:**',
      '    *   **Interest rate sensitivity** — floating rate debt exposure as rising rates compress AFFO.\n' +
      '    *   **Development pipeline** (under-construction area and capex committed).'
    );
    text = appendGuidanceExample(text, '        *   **DPU Growth:** Distribution per unit growth guidance for the year.');
    return text;
  }

  // ── OIL & GAS (E&P) ───────────────────────────────────────────────────
  if (text.includes('Oil & Gas E&P analyst')) {
    text = injectAfterSection(text, '2.  **Financials:**',
      '    *   **Windfall Tax / Additional levy** impact on realizations (India-specific).\n' +
      '    *   **Hedging:** % of production hedged and at what crude price.'
    );
    text = injectAfterSection(text, '3.  **Exploration & Capex:**',
      '    *   **Reserve Replacement Ratio (RRR)** — needs to be > 1x for sustainable production growth.\n' +
      '    *   **Finding & Development (F&D) cost** per barrel.'
    );
    text = appendGuidanceExample(text, '        *   **Hedge:** % of production hedged and target realization for the year.');
    return text;
  }

  // ── OIL & GAS (Midstream / Pipelines) ────────────────────────────────
  if (text.includes('midstream') || text.includes('pipeline') && text.includes('Oil & Gas')) {
    text = injectAfterSection(text, '2.  **Financial Performance:**',
      '    *   **Take-or-pay contract coverage** % (locked-in revenue providing visibility).\n' +
      '    *   **Throughput shortfall charges** if any (customer pays minimum guaranteed volumes).'
    );
    text = appendGuidanceExample(text, '        *   **Contracts:** New long-term take-or-pay contracts signed or in negotiation.');
    return text;
  }

  // ── OIL & GAS (Services / Oilfield) ──────────────────────────────────
  if (text.includes('Oil & Gas Services analyst')) {
    text = injectAfterSection(text, '2.  **Financials & Order Book:**',
      '    *   **Contract re-pricing:** Day rate resets on contract renewals (key earnings driver in upcycle).\n' +
      '    *   **Revenue visibility** from order book — months/years of revenue covered.'
    );
    text = appendGuidanceExample(text, '        *   **Day Rates:** Day rate trajectory on new vs. renewed contracts.');
    return text;
  }

  // ── OIL & GAS (Lubricants) ────────────────────────────────────────────
  if (text.includes('Oil & Gas analyst') && (text.includes('base oil') || text.includes('Lubricants') || text.includes('lubes'))) {
    text = injectAfterSection(text, '3.  **Cost & Pricing:**',
      '    *   **Base oil inventory holding gain/loss** (price lag between procurement and price hikes to customers).\n' +
      '    *   **Premium product mix** (synthetic vs. mineral oils — synthetic is 3-5x the margin).'
    );
    text = appendGuidanceExample(text, '        *   **Premium Mix:** Target for synthetic/premium product share of volume.');
    return text;
  }

  // ── GAS UTILITY (City Gas Distribution / Transmission) ────────────────
  if (text.includes('Gas Utility analyst')) {
    text = injectAfterSection(text, '1.  **Operational Performance:**',
      '    *   **CNG stations** count and **PNG connections** (domestic + commercial + industrial) — network density.\n' +
      '    *   **Volume growth by segment** — CNG (transport) vs. PNG (domestic) vs. Industrial (highest margin).'
    );
    text = injectAfterSection(text, '3.  **Strategy & Capex:**',
      '    *   **PNGRB authorization** status for new GAs (Geographical Areas) — regulatory pipeline.\n' +
      '    *   **Compressed margins commentary:** APM gas allocation vs. spot LNG usage mix (APM = cheaper).'
    );
    text = appendGuidanceExample(text, '        *   **Connections:** Target for new PNG connections for the year.');
    text = appendGuidanceExample(text, '        *   **GA Expansion:** New PNGRB license bids or wins expected.');
    return text;
  }

  // ── CONSTRUCTION / INFRA ──────────────────────────────────────────────
  if (text.includes('Construction/Infra analyst') || text.includes('Infrastructure analyst')) {
    // Marine infra
    if (text.includes('marine') || text.includes('Marine') || text.includes('dredging') || text.includes('Dredging')) {
      text = injectAfterSection(text, '2.  **Financials & Execution:**',
        '    *   **Fleet utilization** for dredging equipment.\n' +
        '    *   **International order book %** (geographic diversification reduces India-cycle dependency).'
      );
      return text;
    }
    // Standard EPC/Infra
    text = injectAfterSection(text, '1.  **Order Book & Inflows:**',
      '    *   **HAM (Hybrid Annuity Model) vs. EPC** mix in order book (HAM brings annuity income post-construction).\n' +
      '    *   **L1 positions** (lowest bidder, not yet converted to orders — future order book pipeline).'
    );
    text = injectAfterSection(text, '3.  **Balance Sheet:**',
      '    *   **Arbitration receivables** and their ageing (common in infra — can be 5-10% of revenue).\n' +
      '    *   **Government receivable days** (state vs. central — state payments are often significantly delayed).'
    );
    text = appendGuidanceExample(text, '        *   **Arbitration:** Major arbitration award expected and quantum.');
    return text;
  }

  // ── DEFENSE & AEROSPACE ───────────────────────────────────────────────
  if (text.includes('Defense & Aerospace analyst') || text.includes('Industrial/Defense analyst')) {
    text = injectAfterSection(text, '3.  **Strategic Developments:**',
      '    *   **Indigenization ratio** — % of components sourced locally (DPP mandate pushing this up).\n' +
      '    *   **Offset obligations** received from foreign OEMs (can be converted to orders).\n' +
      '    *   **R&D as % of revenue** — sustained investment for future product pipeline.'
    );
    text = appendGuidanceExample(text, '        *   **Indigenization:** Target local content ratio for key programs.');
    text = appendGuidanceExample(text, '        *   **R&D:** R&D spend guidance and key technology programs underway.');
    return text;
  }

  // ── PHARMA (Formulations — India branded) ─────────────────────────────
  if (text.includes('specialist pharma analyst') || text.includes('Pharma analyst')) {
    text = injectAfterSection(text, '2.  **India Business:**',
      '    *   **Primary vs. secondary sales** gap (if > 10% mismatch, signals channel stuffing).\n' +
      '    *   **Market share** in key therapy areas vs. IQVIA/IMS.\n' +
      '    *   **MR (Medical Representative) count** and productivity (revenue/MR).'
    );
    text = appendGuidanceExample(text, '        *   **Market Share:** Commentary on rank/market share gains in key therapies.');
    return text;
  }

  // ── PHARMA (Biotech / NCE) ────────────────────────────────────────────
  if (text.includes('Pharma/Biotech analyst')) {
    text = injectAfterSection(text, '2.  **R&D Pipeline & Clinical Updates:**',
      '    *   **USFDA 483 observations or Warning Letter** status (if applicable) — regulatory overhang.\n' +
      '    *   **Biosimilar** regulatory pathway and reference product exclusivity timeline (for biotech).'
    );
    text = appendGuidanceExample(text, '        *   **Regulatory:** Expected USFDA inspection or approval timeline for key facility/product.');
    return text;
  }

  // ── PHARMA RETAIL ─────────────────────────────────────────────────────
  if (text.includes('Retail analyst specializing in Pharma')) {
    text = injectAfterSection(text, '2.  **Operational Performance:**',
      '    *   **Generic vs. branded medicine** mix — generic has higher margins but lower ARPU.\n' +
      '    *   **Private label** (house brand) penetration — highest margin category.\n' +
      '    *   **Diagnostics / wellness services** contribution to revenue.'
    );
    text = appendGuidanceExample(text, '        *   **Private Label:** Target for house-brand revenue share.');
    return text;
  }

  // ── MEDICAL DEVICES ───────────────────────────────────────────────────
  if (text.includes('Medical Devices analyst')) {
    text = injectAfterSection(text, '3.  **Market Dynamics:**',
      '    *   **Procedure volume growth** in hospitals (structural driver — rising healthcare awareness).\n' +
      '    *   **Price erosion** risk in commoditized device categories (e.g., stents, catheters post-NPC regulation).\n' +
      '    *   **Import substitution** opportunity — government push for domestic medical devices.'
    );
    text = appendGuidanceExample(text, '        *   **Price Regulation:** Commentary on NPC (National Pricing Control) impact on key SKUs.');
    return text;
  }

  // ── NBFC (standard) ───────────────────────────────────────────────────
  if (text.includes('NBFC analyst') && !text.includes('MFI') && !text.includes('HFC')) {
    text = injectAfterSection(text, '1.  **Business Growth:**',
      '    *   **On-book vs. off-book AUM** (co-lending, securitization, BC model) — critical for true risk exposure.\n' +
      '    *   **Disbursement yield** on new loans vs. portfolio yield (margin direction signal).'
    );
    text = injectAfterSection(text, '4.  **Liability & Capital:**',
      '    *   **ALM mismatch commentary** (short-term borrowings funding long-term assets — key risk in rate-up cycle).\n' +
      '    *   **Proportion of market borrowings vs. bank lines** (diversification = lower rate sensitivity).'
    );
    text = appendGuidanceExample(text, '        *   **Off-book:** Target for co-lending or securitization as % of disbursements.');
    return text;
  }

  // ── NBFC/HFC ──────────────────────────────────────────────────────────
  if (text.includes('NBFC/HFC analyst')) {
    text = injectAfterSection(text, '1.  **Business Growth:**',
      '    *   **Home loan vs. LAP (Loan Against Property)** mix — LAP has 3-5x higher NPAs, different yields.\n' +
      '    *   **Developer exposure** % (high developer loans = concentration risk).'
    );
    text = appendGuidanceExample(text, '        *   **LAP Mix:** Target LAP share of disbursements and associated NIM impact.');
    return text;
  }

  // ── NBFC/MFI ──────────────────────────────────────────────────────────
  if (text.includes('NBFC/MFI analyst')) {
    text = injectAfterSection(text, '1.  **Business Growth:**',
      '    *   **Group loan vs. individual loan mix** — individual loans are higher ticket, lower yield, better quality.\n' +
      '    *   **Borrower overlap** % with industry peers (high overlap = over-leveraged borrower risk).'
    );
    text = appendGuidanceExample(text, '        *   **Individual Loans:** Target for individual loan share of AUM.');
    return text;
  }

  // ── BFSI (generic) ────────────────────────────────────────────────────
  if (text.includes('BFSI analyst') && text.includes('lending')) {
    text = injectAfterSection(text, '1.  **Financial Performance:**',
      '    *   **NIM / Spread** commentary and trajectory.\n' +
      '    *   **Gross Stage 3** assets (NBFC) or **Gross NPA** (bank) as the primary asset quality KPI.'
    );
    text = appendGuidanceExample(text, '        *   **AUM/Loan Growth:** Core loan book or AUM growth guidance.');
    return text;
  }

  // ── INSURANCE (Life) ──────────────────────────────────────────────────
  if (text.includes('Insurance sector analyst') && text.includes('VNB')) {
    text = injectAfterSection(text, '3.  **Operational Health:**',
      '    *   **Lapse rate** by product (high lapse in ULIPs reduces trail commission income).\n' +
      '    *   **Commission expense ratio** trend (rising bancassurance = higher commission cost).'
    );
    text = appendGuidanceExample(text, '        *   **ROEV:** Return on Embedded Value target and trajectory.');
    return text;
  }

  // ── INSURANCE (General/Health) ────────────────────────────────────────
  if (text.includes('Insurance sector analyst') && text.includes('Combined Ratio')) {
    text = injectAfterSection(text, '3.  **Operational Health:**',
      '    *   **Investment portfolio yield** — insurers invest float, yield impacts profits.\n' +
      '    *   **Loss ratio by segment** — Motor Third Party is IRDAI-regulated, health/fire are market-linked.'
    );
    text = appendGuidanceExample(text, '        *   **Investment Yield:** Target portfolio yield trajectory.');
    return text;
  }

  // ── INSURANCE (Distribution / Aggregator) ─────────────────────────────
  if (text.includes('Insurance sector analyst focused on distribution')) {
    text = injectAfterSection(text, '3.  **Operational Health:**',
      '    *   **Renewal premium** as % of total — high renewal = sticky, lower CAC.\n' +
      '    *   **Digital vs. physical channel** mix and cost per policy by channel.'
    );
    text = appendGuidanceExample(text, '        *   **Renewals:** Renewal retention rate and renewal premium growth.');
    return text;
  }

  // ── AMC ───────────────────────────────────────────────────────────────
  if (text.includes('AMC analyst')) {
    text = injectAfterSection(text, '1.  **Assets Under Management (AUM) Dynamics:**',
      '    *   **B30 (Beyond Top 30 cities) AUM share** — SEBI incentive structure drives expansion to smaller cities.\n' +
      '    *   **Performance:** % of equity AUM outperforming benchmark on 1yr/3yr basis (impacts investor retention).'
    );
    text = injectAfterSection(text, '2.  **Financial Performance:**',
      '    *   **Revenue yield on AUM (bps)** — declining trend due to SEBI TER rationalization.\n' +
      '    *   **Operating leverage:** Fixed vs. variable cost structure.'
    );
    text = appendGuidanceExample(text, '        *   **B30:** Target for B30 city AUM share.');
    text = appendGuidanceExample(text, '        *   **SIP Book:** Monthly SIP inflow run-rate and target.');
    return text;
  }

  // ── FINTECH ───────────────────────────────────────────────────────────
  if (text.includes('Fintech analyst')) {
    text = injectAfterSection(text, '1.  **User & Transaction Metrics:**',
      '    *   **UPI market share** % (if applicable — Paytm/PhonePe/GooglePay dynamics).\n' +
      '    *   **Loan disbursals via platform** and delinquency rate on embedded lending products.'
    );
    text = appendGuidanceExample(text, '        *   **Embedded Lending:** Disbursement growth and credit quality guidance.');
    return text;
  }

  // ── INVESTMENT CO. / HOLDING CO. ──────────────────────────────────────
  if (text.includes('Investment Co') || text.includes('Holding Co')) {
    text = injectAfterSection(text, '2.  **Performance of Key Subsidiaries/Investments:**',
      '    *   **NAV per share** (estimated based on market values of listed + fair value of unlisted).\n' +
      '    *   **Dividend income** from subsidiaries and its coverage of holdco overheads.'
    );
    text = appendGuidanceExample(text, '        *   **NAV Discount:** Commentary on steps being taken to reduce holding company discount.');
    text = appendGuidanceExample(text, '        *   **Dividend:** Dividend income growth from subsidiaries.');
    return text;
  }

  // ── COMMODITIES (Sugar/Distillery) ─────────────────────────────────────
  if (text.includes('Commodities analyst') && text.includes('Sugar')) {
    text = injectAfterSection(text, '2.  **Segment Performance:**',
      '    *   **Ethanol blending program (EBP)** status — government mandate drives pricing stability.\n' +
      '    *   **Inventory carry:** Season-end sugar inventory and impact on next year prices.'
    );
    text = appendGuidanceExample(text, '        *   **Ethanol Capacity:** Target utilization and pricing for next supply year.');
    return text;
  }

  // ── DIVERSIFIED CONGLOMERATE ───────────────────────────────────────────
  if (text.includes('Diversified Conglomerate analyst')) {
    text = injectAfterSection(text, '2.  **Segment Performance:**',
      '    *   **Capital allocation priorities** — which segments get incremental investment.\n' +
      '    *   **Cross-selling synergies** across business verticals (if any).'
    );
    text = appendGuidanceExample(text, '        *   **Capital Allocation:** Capex split across segments for the next 2-3 years.');
    return text;
  }

  // ── ED-TECH / EDUCATION ───────────────────────────────────────────────
  if (text.includes('Ed-Tech') || text.includes('Education analyst')) {
    text = injectAfterSection(text, '2.  **Financial Performance:**',
      '    *   **Paid enrollments** vs. free or trial users (conversion rate from free to paid).\n' +
      '    *   **Revenue per paid student** — ARPU trend.\n' +
      '    *   **Course completion rate** — proxy for student satisfaction and retention.'
    );
    text = appendGuidanceExample(text, '        *   **Paid Enrollments:** Target for paid enrollment growth.');
    text = appendGuidanceExample(text, '        *   **Profitability:** Timeline to EBITDA breakeven on a per-student basis.');
    return text;
  }

  // ── TEXTILES ──────────────────────────────────────────────────────────
  if (text.includes('Textiles analyst')) {
    text = injectAfterSection(text, '2.  **Financial Performance:**',
      '    *   **Yarn/fabric realization per kg** vs. cotton or polyester input cost — spread analysis.\n' +
      '    *   **Export vs. domestic mix** — exports benefit from India + 1 sourcing shift from China.\n' +
      '    *   **PLI scheme** for man-made fibre / technical textiles — benefit accrual.'
    );
    text = injectAfterSection(text, '3.  **Operational Metrics:**',
      '    *   **Spindle/loom utilization** % — below 80% signals demand weakness.\n' +
      '    *   **Inventory days** of cotton/fibre (volatility in cotton prices creates mark-to-market risk).'
    );
    text = appendGuidanceExample(text, '        *   **Exports:** Target for export revenue growth and new customer additions.');
    return text;
  }

  // ── TECHNOLOGY HARDWARE ────────────────────────────────────────────────
  if (text.includes('Technology Hardware analyst')) {
    text = injectAfterSection(text, '2.  **Financial Performance:**',
      '    *   **Gross margin by product category** (hardware margins are thin — 5-15% vs. software 60%+).\n' +
      '    *   **Services & AMC (Annual Maintenance Contract)** revenue share — recurring and high-margin.\n' +
      '    *   **Component sourcing:** Exposure to semiconductor supply chain disruptions.'
    );
    text = appendGuidanceExample(text, '        *   **Services Revenue:** Target for services/AMC as % of total revenue.');
    return text;
  }

  // ── SERVICES (general / env / publishing) ─────────────────────────────
  if (text.includes('Services sector analyst')) {
    text = injectAfterSection(text, '2.  **Business Drivers:**',
      '    *   **Revenue per employee** and **utilization rate** — key efficiency metrics for services.\n' +
      '    *   **Retainer vs. project-based** revenue mix (retainer = predictable, project = lumpy).'
    );
    // Environmental services
    if (text.includes('environmental') || text.includes('waste') || text.includes('Environmental')) {
      text = injectAfterSection(text, '2.  **Business Drivers:**',
        '    *   **Regulatory tailwind:** New pollution control norms expanding addressable market.\n' +
        '    *   **Tipping fees** per tonne (municipal solid waste contracts).'
      );
    }
    text = appendGuidanceExample(text, '        *   **Utilization:** Target for billable hours utilization rate.');
    return text;
  }

  // ── CONSUMER DISCRETIONARY / RETAIL (Jewellery) ────────────────────────
  if (text.includes('Consumer Discretionary/Retail analyst') || (text.includes('Jewellery') || text.includes('jewellery'))) {
    text = injectAfterSection(text, '3.  **Market Dynamics:**',
      '    *   **Gold price hedging:** Policy on inventory hedging (unhedged inventory = P&L volatility).\n' +
      '    *   **Studded vs. plain gold** revenue mix — studded has 25-30% higher EBITDA margin.\n' +
      '    *   **Making charges** realization trend — shift to price-based vs. weight-based is margin-accretive.'
    );
    text = appendGuidanceExample(text, '        *   **Studded Mix:** Target for studded jewellery as % of total revenue.');
    return text;
  }

  // ── CONSUMER STAPLES / ALCO-BEV ────────────────────────────────────────
  if (text.includes('Alco-Bev') || text.includes('alcohol') || text.includes('Alcohol')) {
    text = injectAfterSection(text, '2.  **Financial Performance:**',
      '    *   **Prestige & above (P&A) volume** vs. regular segment — P&A grows faster and has better margins.\n' +
      '    *   **State-wise price hike** data — state excise pricing is the key margin driver.\n' +
      '    *   **Shortfall from quota** in any state (licensed supply limits can cap growth).'
    );
    text = appendGuidanceExample(text, '        *   **P&A Share:** Target for Prestige & Above segment revenue share.');
    return text;
  }

  // ── PAINTS ─────────────────────────────────────────────────────────────
  if (text.includes('Paints sector analyst')) {
    text = injectAfterSection(text, '3.  **Cost & Margin Analysis:**',
      '    *   **TiO2 price trajectory** — key pigment; often 20%+ of RM cost (imported, USD-denominated).\n' +
      '    *   **Waterborne vs. solvent-borne** mix (waterborne is growing as environmental regulations tighten).\n' +
      '    *   **Tinting machine** installations (dealers with tinting machines order more frequently = loyalty signal).'
    );
    text = appendGuidanceExample(text, '        *   **New Entrants:** Competitive response strategy to Birla Opus / JSW Paints capacity ramp-up.');
    return text;
  }

  // If no specific rule matched, return unchanged
  return text;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function run() {
  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) console.log('🔍 DRY RUN — no writes will be made\n');

  const fb = new FirebaseService();
  fb.initializeFirebase();
  const connected = await fb.testConnection();
  if (!connected) { console.error('❌ Firestore connection failed'); process.exit(1); }

  const collection = fb.db.collection('industryPrompts');

  const keys = Object.keys(data).filter(k => k.startsWith('/market/') && !ALREADY_DONE.has(k));
  console.log(`📋 Processing ${keys.length} remaining prompts...\n`);

  let updated = 0, skipped = 0, errors = 0, unchanged = 0;

  for (const key of keys) {
    const original = data[key];
    if (!original || typeof original !== 'string') { skipped++; continue; }

    const improved = transform(key, original);

    if (improved === original) {
      console.log(`⏭️  No change: ${key}`);
      unchanged++;
      continue;
    }

    try {
      const snap = await collection.where('link', '==', key).get();
      if (snap.empty) {
        console.warn(`⚠️  Not in Firestore: ${key}`);
        skipped++;
        continue;
      }
      if (!dryRun) {
        for (const doc of snap.docs) {
          await doc.ref.update({ analystPrompt: improved });
        }
      }
      console.log(`✅ ${dryRun ? '[DRY] ' : ''}Updated: ${key}`);
      updated++;
    } catch (err) {
      console.error(`❌ Error on ${key}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Updated:   ${updated}`);
  console.log(`   Unchanged: ${unchanged}`);
  console.log(`   Skipped:   ${skipped}`);
  console.log(`   Errors:    ${errors}`);
  process.exit(0);
}

run().catch(err => { console.error('❌', err.message); process.exit(1); });
