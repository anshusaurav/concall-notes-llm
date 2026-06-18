const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * ClaudeService — drop-in replacement for GeminiService.
 *
 * Auth resolution order (first match wins):
 *   1. ANTHROPIC_API_KEY env var
 *   2. CLAUDE_API_KEY env var
 *   3. Claude Code OAuth token from ~/.claude/.credentials.json
 *
 * Optionally override the model via CLAUDE_MODEL env var.
 */
class ClaudeService {
    constructor() {
        this.apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || null;
        this.credsPath = path.join(os.homedir(), '.claude', '.credentials.json');
        this.useOAuth = !this.apiKey;

        if (this.apiKey) {
            this.client = new Anthropic({ apiKey: this.apiKey });
            console.log('🔑 Using explicit API key');
        } else {
            // Fall back to Claude Code's own OAuth credentials.
            // We build the client now for the startup check, but will rebuild it
            // before each API call so we always use a fresh (possibly refreshed) token.
            const authToken = this._readOAuthToken();
            if (!authToken) {
                console.error('❌ No API key found. Set ANTHROPIC_API_KEY, CLAUDE_API_KEY, or sign in to Claude Code.');
                process.exit(1);
            }
            this.client = new Anthropic({ authToken });
            console.log('🔑 Using Claude Code OAuth credentials (refreshed before each call)');
        }

        // Use Haiku by default — fast and cheap. Override with CLAUDE_MODEL env var.
        // Options: claude-3-5-haiku-20241022 | claude-3-5-sonnet-20241022 | claude-opus-4-5
        this.model = process.env.CLAUDE_MODEL || 'claude-3-5-haiku-20241022';
        this.maxTokens = parseInt(process.env.CLAUDE_MAX_TOKENS) || 8192;
        this.successfulResponses = 0;

        console.log(`🤖 Claude Configuration:`);
        console.log(`   Model: ${this.model}`);
        console.log(`   Max Output Tokens: ${this.maxTokens}`);
        console.log(`✅ Anthropic API key loaded`);
    }

    /** Reads the current OAuth access token from disk (may have been refreshed by Claude Code). */
    _readOAuthToken() {
        try {
            const creds = JSON.parse(fs.readFileSync(this.credsPath, 'utf8'));
            return creds.claudeAiOauth?.accessToken || null;
        } catch {
            return null;
        }
    }

    /** Returns an Anthropic client with a fresh token if using OAuth, otherwise the static key client. */
    _getClient() {
        if (!this.useOAuth) return this.client;
        const authToken = this._readOAuthToken();
        if (!authToken) throw new Error('OAuth token missing — sign in to Claude Code');
        // Rebuild client with the latest token each time
        return new Anthropic({ authToken });
    }

    /**
     * Calls the Claude API with retry logic.
     * Also aliased as callGeminiAPIWithRetry for backwards compatibility.
     * Retries up to maxRetries times on rate-limit / overload errors.
     */
    async callClaudeAPIWithRetry(prompt, maxRetries = 3) {
        let lastError = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`🔑 Claude attempt ${attempt}/${maxRetries} (model: ${this.model})`);

                const response = await this._getClient().messages.create({
                    model: this.model,
                    max_tokens: this.maxTokens,
                    messages: [{ role: 'user', content: prompt }],
                }, {
                    timeout: 120000, // 2 minute timeout — never hang indefinitely
                });

                const text = response.content?.[0]?.text;

                if (!text) {
                    throw new Error('No text returned from Claude API');
                }

                this.successfulResponses++;
                console.log(`✅ Claude responded successfully (stop_reason: ${response.stop_reason})`);
                return text;

            } catch (error) {
                lastError = error;
                console.error(`❌ Claude error (attempt ${attempt}/${maxRetries}):`, error.message);

                if (this.isRetryableError(error) && attempt < maxRetries) {
                    const isRateLimit = error.status === 429 || (error.message || '').includes('429') || (error.message || '').includes('rate');
                    const isAuthError = error.status === 401 || (error.message || '').includes('401') || (error.message || '').includes('authentication');
                    let delay;
                    if (isAuthError) {
                        delay = 300000; // 5 min — wait for user to re-auth via `claude auth login`
                        console.warn(`🔐 Auth error (401) — token may be expired. Re-run: claude auth logout && claude auth login`);
                        console.warn(`⏳ Waiting ${delay / 60000} min before retry (attempt ${attempt}/${maxRetries})...`);
                    } else if (isRateLimit) {
                        delay = attempt * 30000; // 30s/60s
                        console.warn(`⏳ Rate limited — retrying in ${delay / 1000}s...`);
                    } else {
                        delay = attempt * 2000; // 2s/4s
                        console.warn(`⏳ Retrying in ${delay / 1000}s...`);
                    }
                    await this.delay(delay);
                } else {
                    break;
                }
            }
        }

        throw new Error(`Claude API failed after ${maxRetries} attempts. Last error: ${lastError?.message}`);
    }

    isRetryableError(error) {
        const msg = (error.message || '').toLowerCase();
        return (
            msg.includes('529') ||
            msg.includes('rate') ||
            msg.includes('overload') ||
            msg.includes('too many') ||
            msg.includes('timeout') ||
            msg.includes('401') ||
            msg.includes('authentication') ||
            error.status === 529 ||
            error.status === 429 ||
            error.status === 401
        );
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Backwards-compatibility alias so any code still calling the old Gemini name keeps working
    async callGeminiAPIWithRetry(prompt, maxRetries = 3) {
        return this.callClaudeAPIWithRetry(prompt, maxRetries);
    }

    // Compatibility stubs (called in some places but not critical)
    getKeyStatus() {
        return [{ name: 'ANTHROPIC_API_KEY', isBlocked: false, isCurrent: true, errorCount: 0 }];
    }

    getModelConfig() {
        return { model: this.model, maxTokens: this.maxTokens };
    }
}

module.exports = ClaudeService;
