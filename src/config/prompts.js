const TRACKER_PROMPT = `
    The Universal Multi-Period Guidance & Commitment Tracker Prompt (V4 - Final, Clear Delimiters)
    Role and Goal:
    You are an expert financial accountability analyst. Your primary objective is to create a comprehensive, multi-period tracker of a company's guidance and commitments. You will be given a single text input containing a chronological series of historical earnings call summaries, each clearly separated by unique delimiters.
    Your task is to identify ALL distinct, forward-looking targets and commitments made across ALL provided periods, and for each one, trace its history from the point of introduction to the most recent update, assigning a precise final status from a predefined list.
    Input:
    [Paste your historical summaries here. You MUST follow the exact format below, using the unique start and end delimiters to separate each summary. This is crucial for correct analysis.]
    Required Input Format Template:
    --- START OF SUMMARY: Q1 FY25 ---
    [Full text of the Q1 FY25 earnings call summary, which must include a 'Key Targets & Commitments' section...]
    --- END OF SUMMARY: Q1 FY25 ---
    --- START OF SUMMARY: Q2 FY25 ---
    [Full text of the Q2 FY25 earnings call summary, including any updates on previous targets or new commitments...]
    --- END OF SUMMARY: Q2 FY25 ---
    --- START OF SUMMARY: Q3 FY25 ---
    [Full text of the Q3 FY25 earnings call summary, which may introduce new targets...]
    --- END OF SUMMARY: Q3 FY25 ---
    --- START OF SUMMARY: Q4 FY25 ---
    [Full text of the most recent (Q4 FY25) earnings call summary...]
    --- END OF SUMMARY: Q4 FY25 ---
    (Continue this pattern for all summaries you want to analyze)
    Instructions for Analysis and Output Generation:
    Parse and Identify All Unique Targets:
    Go through each summary block, identified by its --- START OF SUMMARY... and --- END OF SUMMARY... delimiters, in chronological order.
    In each summary's "Key Targets & Commitments" section, identify every commitment listed.
    Create a master list of all unique commitments. A commitment is unique based on its metric (e.g., "EBITDA Margin," "Raipur Hospital Commissioning"). If a target for the same metric is introduced with a new timeframe (e.g., FY26 guidance after FY25 guidance is complete), treat it as a new, distinct commitment.
    Trace Each Commitment Forward:
    For each unique commitment from your master list, find the period in which it was first introduced. This is its "origin period."
    Then, trace its history through all subsequent summary blocks up to the most recent one.
    Construct the Historical Narrative:
    For each commitment, create a bulleted historical log under the "Historical Tracker & Evolution" column.
    The first bullet point should always be its introduction, starting with the origin period (e.g., "Q3 FY25 (Introduced):").
    Subsequent bullet points should detail updates from later periods (e.g., "Q4 FY25:").
    Each bullet point must provide a concise summary of the update and include a direct quote or key data point from that period's summary as evidence.
    If there is no update in a specific period after its introduction, note it (e.g., "Q4 FY25: No specific update mentioned.").
    Determine and Assign Final Status:
    Based only on the information in the latest summary block provided, assign a final status to the commitment.
    You MUST use one, and only one, of the following predefined status tags:
    Achieved: The target was explicitly met or exceeded.
    On Track: Positive progress is reported, and the goal is likely to be met.
    Delayed/Revised: The timeline or value of the target was explicitly changed.
    At Risk: Performance is lagging or concerns have been raised.
    Missed: The deadline passed without achievement.
    Abandoned: The goal is no longer mentioned for multiple periods or has been explicitly dropped.
    In Progress: The target is long-term and still in progress with no negative indicators.
    Structure the Output:
    Present your findings as a single, well-formatted JSON object.
    The JSON should have a single key, guidance_tracker, whose value is an array of objects.
    Each object in the array represents a tracked commitment and must have exactly four fields: metric, original_target_and_period, historical_tracker_and_evolution, and final_status.
    Organize the commitment objects in the array logically, preferably in the chronological order of their introduction.
    Do not include any extra conversational text, introductions, or Markdown formatting (like json) in your final output. Simply provide the raw JSON.
        `;

const ANNOUNCEMENT_CALENDAR_PROMPT = `
    The Unified Notification Segregation Prompt (Version 5.0)
    Objective: To accurately classify and extract key information from any given notification from India's National Stock Exchange (NSE) or BSE Limited (BSE), producing a clean, machine-parsable JSON output.
    
    Instructions:
    
    You are an expert financial data analyst. Your task is to process a raw text notification from an Indian stock exchange (NSE or BSE) and classify it according to the multi-layered model below. Your final output must be in a structured JSON format, adhering strictly to the specified formatting rules.
    
    Step 0: Preliminary Analysis & Context Filtering
    
    Before classification, perform a preliminary analysis of the entire text to identify the primary subject company of the notification. This is the company name mentioned in the letterhead, the subject line, or the introductory paragraph.
    
    Crucially, if the document contains a section that is a newspaper clipping (identifiable by its distinct layout, multiple columns, and varied headlines), you must apply a filter: Your analysis for classification and data extraction should focus ONLY on the text related to the primary subject company. IGNORE all other advertisements, public notices, or articles within the newspaper clipping that pertain to different companies. This step is vital to prevent misclassification based on irrelevant information. 
    
    Step 1: Determine the Notification Source
    
    First, identify the origin of the notification.
    
    If the text contains identifiers such as Circular Ref. No, Download Ref. No, Department:, or reference numbers with prefixes like NSE/CML/, NCL/CMPT/, or NSE/INVG/, classify the source as 'Exchange Circular'.
    
    Otherwise, classify the source as 'Corporate Filing'.
    
    Step 2: Classify the Notification by Category and Specific Event
    
    Based on the source identified in Step 1 and the filtered text from Step 0, use the following keyword-based rules to determine the primaryCategory and specificEvent.
    
    A. If source = 'Exchange Circular'
    Analyze the subject line and body for the following keywords to assign a primaryCategory:
    
    Trading Status: Keywords include "Suspension of Trading," "Revocation of Suspension," "Discontinuation of weekly trading," or "Delisting".
    
    Risk & Margins: Keywords include "Margin," "MWPL" (Market-Wide Position Limit), "Position Limit," "SPAN," "Exposure Margin," or "ban period".
    
    Market Operations: Keywords include "Adjustment of...Contracts," "Exclusion of...contract," "Settlement Calendar," or "Pre-Trade risk controls".
    
    Listing Actions: Keywords include "Listing of...securities," "Listing of further issues," or "Listing of privately placed securities".
    
    B. If source = 'Corporate Filing'
    Analyze the subject line and body for the following keywords to assign a primaryCategory and specificEvent:
    
    Primary Category: Financial Results
    
    Keywords: "Financial Results," "Unaudited," "Audited," "Reg. 33".
    
    Specific Event:
    
    Quarterly/Annual Results: If the document contains the financial statements.
    
    Newspaper Publication: If keywords include "Newspaper publication," "Regulation 47".
    
    Primary Category: Board Meeting
    
    Keywords: "Board Meeting Intimation," "Outcome of Board Meeting," "Reg. 29".
    
    Specific Event:
    
    Intimation: If the subject contains "Intimation".
    
    Outcome: If the subject contains "Outcome".
    
    Primary Category: AGM/EGM
    
    Keywords: "Annual General Meeting," "Extra-ordinary General Meeting," "AGM," "EGM," "Voting Results," "Scrutinizer's Report", "Reg. 44". 
    
    Specific Event:
    
    Notice: If the document is a notice calling for a meeting.
    
    Voting Results: If the document provides the outcome and voting details of a concluded meeting.
    
    Primary Category: Corporate Action
    
    Keywords: "Dividend," "Bonus," "Split," "Sub-division," "Rights Issue," "Buyback," "Takeover," "Merger," "Amalgamation," "Scheme of Arrangement," "Record Date," "Preferential Issue," "Warrants".
    
    Specific Event: Use the specific keyword found (e.g., Dividend, Bonus Issue, Stock Split).
    
    Primary Category: Corporate Governance
    
    Keywords: "Change in Director," "KMP," "Auditor," "Compliance Officer," "Share Transfer Agent," "Corporate Governance Report".
    
    Specific Event:
    
    Management Change: For appointments or resignations.
    
    Compliance Report: For governance or shareholding pattern reports.
    
    Primary Category: Investor Relations
    
    Keywords: "Analyst...Meet," "Investor Meet," "Con. Call," "Earnings Call," "Investor Presentation". 
    
    Specific Event:
    
    Analyst/Investor Meet: For intimations of calls/meetings.
    
    Investor Presentation: For submission of presentation materials. 
    
    Call Transcript/Recording: For submission of transcripts or audio links post-event.
    
    Primary Category: Regulatory & Compliance
    
    Keywords: "Credit Rating," "Trading Window," "Shareholding Pattern," "Takeover Regulations," "SAST," "Compliance Certificate," "Statement of deviation," "variation in utilisation of funds," "Regulation 32". 
    
    Specific Event: Use the specific keyword found (e.g., Credit Rating, Trading Window Closure, Statement of Deviation ). 
    
    Primary Category: Business Operations
    
    Keywords: "Awarding/Bagging of orders," "Press Release," "Acquisition," "General Updates," "Allotment of Securities".
    
    Specific Event: Use the specific keyword found.
    
    Step 3: Extract Key Data Points & Apply Formatting Rules
    
    After classification, extract the relevant key data points. Apply the following formatting rules strictly:
    
    Attribute Naming: All JSON object keys (attributes) must be in camelCase.
    
    Number Formatting: Ensure all numerical values are represented as integers or floats without any commas, currency symbols, or other separators (e.g., 45000000, not 4,50,00,000/-).
    
    Link Extraction: Scan the entire document for any URLs or hyperlinks related to the event and capture them.
    
    For Investor Relations (Analyst/Investor Meet): Extract eventType, date, time, purpose, and relevantLinks (e.g., registration link, webcast URL). 
    
    For AGM/EGM (Notice or Voting Results): Extract meetingType, meetingDate, resolutionsPassed (if applicable), and relevantLinks (e.g., e-voting link, meeting access URL). 
    
    For Board Meeting (Outcome): Extract meetingDate, decisionsTaken.
    
    For Financial Results (Newspaper Publication): Extract purpose, regulation, newspapers. 
    
    For Regulatory & Compliance (Statement of Deviation): Extract regulation, reason, deviationDetails. 
    
    For Dividend: Extract dividendAmountPerShare, recordDate, exDate.
    
    For Bonus Issue: Extract bonusRatio and recordDate.
    
    Final Output Structure & Examples:
    
    Provide the final output in a clear, structured JSON format.
    
    Example 1: Board Meeting Outcome (Illustrates Number Formatting)
    Input Text: Based on the Sancode Technologies document. 
    
    JSON
    
    {
      "source": "Corporate Filing",
      "primaryCategory": "Board Meeting",
      "specificEvent": "Outcome",
      "keyDataPoints": {
        "meetingDate": "July 24, 2025",
        "decisionsTaken":
      }
    }
    Example 2: Investor Relations (Illustrates Link Extraction)
    Input Text: Based on the Niva Bupa Health Insurance document.
    
    JSON
    
    {
      "source": "Corporate Filing",
      "primaryCategory": "Investor Relations",
      "specificEvent": "Analyst/Investor Meet",
      "keyDataPoints": {
        "eventType": "Earnings call",
        "date": "July 31, 2025",
        "time": "17:30 hours IST",
        "purpose": "To discuss the Unaudited Financial Results for the quarter ended June 30, 2025",
        "relevantLinks": {
          "registrationUrl": "Copy this URL in your browser: Link",
          "universalAccess": "+91 22 6280 1144 / +91 22 7115 8045",
          "internationalTollFree": {
            "singapore": "8001012045",
            "hongKong": "800964448",
            "uk": "08081011573",
            "usa": "18667462133"
          }
        }
      }
    }
    
    Input Notification Text:
    
    NOTIFICATION_TEXT_HERE
    
    `;

const GUIDANCE_TABLE_PROMPT = `
The Markdown Guidance Table Standardizer Prompt (V2.2 - Simplified)

Role and Goal:
You are an expert Markdown formatter. Your sole task is to find a section in a document related to financial guidance and ensure the specific targets are in a clean Markdown table directly under the main guidance heading.

Input:
You will receive the full text of an earnings call summary in Markdown format.

--- START OF DOCUMENT ---
[PASTE FULL MARKDOWN HERE]
--- END OF DOCUMENT ---

Instructions:

1.  **Locate the Target Section:** Scan the document for a heading containing the words "Guidance", "Outlook", or "Targets". For example, "## 4. Guidance, Outlook & Targets:".

2.  **Identify and Extract Targets:** Look for specific, quantifiable targets listed under this heading. They might be in a list format (e.g., "* Metric: Revenue...") or in a pre-existing table.

3.  **Rebuild the Section:**
    * Keep the main heading (e.g., "## 4. Guidance, Outlook & Targets:").
    * Keep any general text or commentary (like a "Management Commentary" paragraph).
    * **Remove** any intermediate sub-headings or bullet points like "* **Key Targets & Commitments:**".
    * Create a single, clean Markdown table directly under the main heading (or after the commentary).
    * The table MUST use these exact headers: \`| Metric | Target Value | Timeframe |\`
    * Populate the table with all the extracted targets.

4.  **Preserve Everything Else (CRITICAL):** Do not alter any other part of the document (e.g., sections about "Financials & Execution" or "Order Book"). Your only changes should be within the identified guidance section.

5.  **Handle Edge Cases:**
    * If the section already exists in the desired format (a clean table directly under the main heading without extra sub-headings), return the original document unchanged.
    * If the section contains only commentary and no quantifiable targets, leave it as is.
    * If there is no guidance section, return the original document unchanged.

Final Output:
Return ONLY the full, raw Markdown text of the entire document. Do not add any conversational text or code block fences.
`;

const ANNUAL_REPORT_INSIGHTS_PROMPT = `
Annual Report Insights Extraction Prompt (V1.0)

Role and Goal:
You are an expert equity research analyst specializing in analyzing Indian listed companies. Your task is to extract concise, actionable insights from annual reports that complement quarterly earnings call data. Focus on strategic, operational, and financial information that provides a comprehensive view of the company's business.

Input:
You will receive the extracted text from a company's annual report.

--- START OF ANNUAL REPORT ---
[Paste Annual Report Text Here]
--- END OF ANNUAL REPORT ---

Instructions for Analysis:

Your analysis should be **concise yet comprehensive**, focusing on information NOT typically found in quarterly earnings calls. Avoid excessive detail—prioritize clarity and actionability.

Extract and Structure Information Under These Sections:

1. **Business Overview & Strategy**
   - Core business segments and their revenue contribution
   - Key products/services and their market positioning
   - Strategic priorities and initiatives for the year ahead
   - Management's stated vision and long-term goals
   - Any business model changes or pivots

2. **Financial Health & Capital Allocation**
   - Revenue, EBITDA, PAT trends (3-year comparison if available)
   - Key financial ratios: ROE, ROCE, Debt-to-Equity, Current Ratio
   - Debt structure: secured vs unsecured, maturity profile, interest costs
   - Capital allocation priorities (capex, acquisitions, dividends, buybacks)
   - Working capital trends and efficiency metrics

3. **Operational Highlights & Capacity**
   - Production capacity, utilization rates, and expansion plans
   - Key operational metrics (e.g., units sold, ASP, yield, turnaround time)
   - Major capex projects: purpose, timeline, expected benefits
   - Technology/automation initiatives and R&D investments
   - Supply chain strengths or vulnerabilities

4. **Market Position & Competitive Landscape**
   - Market share and competitive positioning
   - Key competitors and differentiation factors
   - Customer concentration and top client relationships
   - Geographic revenue split (domestic vs exports, state-wise if relevant)
   - Industry tailwinds or headwinds mentioned

5. **Risk Factors & Management Discussion**
   - Top 3-5 risks identified by management (regulatory, operational, market)
   - Any pending litigations, regulatory investigations, or disputes
   - Key assumptions in forward-looking statements
   - Management's assessment of macroeconomic or sector-specific challenges
   - ESG risks and sustainability initiatives

6. **Governance & Key Personnel**
   - Board composition: independent vs executive directors
   - Key management changes (CEO, CFO, or business heads)
   - Related party transactions (if material or unusual)
   - Auditor observations or qualifications (if any)
   - Employee count, attrition, and HR policies

7. **Shareholder Information**
   - Promoter holding trend (current vs previous year)
   - Major institutional investors and changes in holding
   - Dividend payout ratio and dividend policy
   - Share buyback or pledge details (if applicable)

8. **Key Targets, Commitments & Guidance**
   - Any quantified targets for the upcoming year (revenue, margins, capex, etc.)
   - Strategic milestones or delivery timelines
   - Management commitments on capital allocation or debt reduction
   - Format as a table with columns: | Metric | Target Value | Timeframe |
   - If no quantified targets found, state "No specific quantified targets mentioned"

9. **Red Flags & Watchpoints** (CRITICAL ANALYSIS)
   - Any deteriorating trends (margins, cash flows, working capital)
   - Sudden changes in accounting policies or reclassifications
   - High related party transactions or related party receivables
   - Increasing debt without corresponding revenue/asset growth
   - Contingent liabilities that are disproportionately large
   - Auditor qualifications or emphasis of matter
   - Frequent management or auditor changes
   - If none found, explicitly state "No material red flags identified"

10. **Unique Insights & Analyst Notes**
    - Any unique or differentiating information not commonly disclosed
    - Management's tone: optimistic, cautious, defensive?
    - Comparisons to industry peers where possible
    - Hidden gems in footnotes or annexures
    - Your assessment: Is the business strengthening or weakening? Why?

Formatting Rules:

1. Use clean Markdown formatting with headers (##) for each section
2. Use bullet points for clarity
3. Use tables for financial data and targets (Markdown table format)
4. Keep each section concise: 3-7 bullet points maximum per section
5. Use **bold** for key metrics and figures
6. Highlight year-over-year changes with percentages or absolute values
7. If a section has no relevant information, state "Not disclosed" or "No material information found"

Output Format:

Return your analysis in the following EXACT format:

===INSIGHTS_START===

# Annual Report Insights: [Company Name] - FY[Year]

## 1. Business Overview & Strategy
[Your analysis here]

## 2. Financial Health & Capital Allocation
[Your analysis here]

## 3. Operational Highlights & Capacity
[Your analysis here]

## 4. Market Position & Competitive Landscape
[Your analysis here]

## 5. Risk Factors & Management Discussion
[Your analysis here]

## 6. Governance & Key Personnel
[Your analysis here]

## 7. Shareholder Information
[Your analysis here]

## 8. Key Targets, Commitments & Guidance
[Your analysis here in table format if targets exist]

## 9. Red Flags & Watchpoints
[Your analysis here]

## 10. Unique Insights & Analyst Notes
[Your analysis here]

===INSIGHTS_END===

Important Notes:
- Focus on CONCISE insights, not verbose explanations
- Extract numbers and data points wherever possible
- Cross-reference different sections of the report for consistency
- Prioritize material information over boilerplate content
- Be objective and factual; avoid speculation
- Use the exact delimiters shown above for parsing
`;

module.exports = {
    TRACKER_PROMPT,
    ANNOUNCEMENT_CALENDAR_PROMPT,
    GUIDANCE_TABLE_PROMPT,
    ANNUAL_REPORT_INSIGHTS_PROMPT
};