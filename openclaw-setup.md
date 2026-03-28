# OpenClaw WhatsApp Integration for Concall Notes

## Overview

Control your concall-notes-llm project from WhatsApp using OpenClaw as a bridge. Send commands like "search reliance" or "standardize guidance for 353946" from your phone.

---

## Step 1: Install OpenClaw

```bash
# macOS
brew install openclaw/tap/openclaw

# Or via npm
npm install -g @openclaw/cli

# Run setup wizard
openclaw setup
```

## Step 2: Configure WhatsApp

Edit `~/.openclaw/openclaw.json`:

```json5
{
  channels: {
    whatsapp: {
      dmPolicy: "allowlist",
      allowFrom: ["+91XXXXXXXXXX"],  // your phone number
      selfChatMode: true
    }
  },
  skills: {
    entries: {
      "concall-search": { enabled: true },
      "concall-process": { enabled: true },
      "concall-status": { enabled: true }
    }
  }
}
```

Link your WhatsApp:

```bash
openclaw channels login
```

Scan the QR code from WhatsApp > Settings > Linked Devices.

---

## Step 3: Create Skills

### Skill 1: Company Search

```bash
mkdir -p ~/.openclaw/workspace/skills/concall-search
```

Create `~/.openclaw/workspace/skills/concall-search/SKILL.md`:

```markdown
---
name: concall-search
description: "Search for a company in the concall notes database"
user-invocable: true
metadata: {"openclaw":{"requires":{"bins":["curl"]}}}
---

# Concall Search

Search for a company by name, BSE code, NSE code, or company code.

## When to use
When the user says "search company X" or "find company X" or "lookup X".

## How it works
Make a POST request to the local server:

\```bash
curl -s -X POST http://localhost:3001/api/company/search \
  -H "Content-Type: application/json" \
  -d '{"q": "<SEARCH_TERM>"}'
\```

Parse the JSON response and present company results showing name, companyCode, nseCode, and bseCode.
```

### Skill 2: Run Processing Tasks

```bash
mkdir -p ~/.openclaw/workspace/skills/concall-process
```

Create `~/.openclaw/workspace/skills/concall-process/SKILL.md`:

```markdown
---
name: concall-process
description: "Run concall processing tasks like guidance standardization, deduplication, migration"
user-invocable: true
metadata: {"openclaw":{"requires":{"bins":["node"]}}}
---

# Concall Processor

Run processing operations on the concall-notes-llm project.

## When to use
When the user asks to run any of the operations listed below.

## How it works
Run a node command in the project directory:

\```bash
cd /Users/anshu/llm-agents/concall-notes-llm
node -e "
  const app = require('./app');
  // instantiate MainProcessor and call the method
"
\```

## Available Operations

| User says | Method |
|---|---|
| "search COMPANY" | POST to /api/company/search |
| "clean duplicate documents" | `processor.cleanDuplicateDocuments()` |
| "clean duplicate raw documents" | `processor.cleanDuplicateRawDocuments()` |
| "generate tracker for CODE" | `processor.generateGuidanceTracker("CODE")` |
| "generate all trackers" | `processor.generateTrackersForAllCompanies()` |
| "standardize guidance for CODE" | `processor.standardizeGuidanceTableForCompany("CODE")` |
| "standardize all guidance" | `processor.standardizeGuidanceTablesForAllCompanies()` |
| "process announcements" | `processor.processMultipleLocalAnnouncements()` |
| "deduplicate concalls for CODE" | `processor.mergeDuplicateConcallsForCompany("CODE")` |
| "deduplicate all concalls" | `processor.mergeDuplicateConcallsForAllCompanies()` |
| "migrate CODE to mongo" | `processor.migrateSpecificCompany("CODE")` |
| "migrate all to mongo" | `processor.migrateAllCompanies()` |
| "remove duplicate companies" | `processor.removeDuplicateCompanies()` |
| "process annual reports for CODE" | `processor.processAnnualReportsForCompany("CODE")` |
| "process all annual reports" | `processor.processAnnualReportsForAllCompanies()` |

Always confirm before running destructive or long-running operations.
```

### Skill 3: Server Status

```bash
mkdir -p ~/.openclaw/workspace/skills/concall-status
```

Create `~/.openclaw/workspace/skills/concall-status/SKILL.md`:

```markdown
---
name: concall-status
description: "Check if the concall-notes-llm server is running"
user-invocable: true
metadata: {"openclaw":{"requires":{"bins":["curl"]}}}
---

# Concall Server Status

## When to use
When the user asks "is the server running", "server status", or "check server".

## How it works
\```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/company/search \
  -X POST -H "Content-Type: application/json" -d '{"q":"test"}'
\```

If 200 → server is running. Otherwise offer to start it:

\```bash
cd /Users/anshu/llm-agents/concall-notes-llm && npm run server &
\```
```

---

## Step 4: Start Everything

```bash
# Terminal 1: Start your server
cd /Users/anshu/llm-agents/concall-notes-llm
npm run server

# Terminal 2: Start OpenClaw
openclaw start
```

## Example WhatsApp Commands

| Message | What happens |
|---|---|
| "search reliance" | Searches your Firebase DB for matching companies |
| "standardize guidance for 353946" | Runs guidance table standardization for that company |
| "deduplicate all concalls" | Merges duplicate concalls across all companies |
| "is the server running?" | Checks if localhost:3001 is responding |
| "migrate 3810 to mongo" | Migrates company 3810 from Firebase to MongoDB |
| "generate tracker for 353946" | Generates guidance tracker for that company |
| "process announcements" | Processes all PDFs in pdfs/announcements/ |

## References

- [OpenClaw WhatsApp Docs](https://docs.openclaw.ai/channels/whatsapp)
- [OpenClaw Skills Docs](https://docs.openclaw.ai/tools/skills)
- [OpenClaw GitHub](https://github.com/openclaw/openclaw)