const Anthropic = require('@anthropic-ai/sdk');

/**
 * ClaudeService — drop-in replacement for GeminiService.
 *
 * Exposes the same public interface so ConferenceCallNotes and GuidanceTracker
 * don't need to change:
 *   - callGeminiAPIWithRetry(prompt)   ← used everywhere
 *
 * Set ANTHROPIC_API_KEY in your .env file.
 * Optionally override the model via CLAUDE_MODEL (default: claude-3-5-haiku-20241022).
 */
class ClaudeService {
    constructor() {
        // Support both ANTHROPIC_API_KEY and the legacy CLAUDE_API_KEY name
        const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
        if (!apiKey) {
            console.error('❌ No ANTHROPIC_API_KEY (or CLAUDE_API_KEY) found in environment variables');
            process.exit(1);
        }

        this.client = new Anthropic({ apiKey });

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

                const response = await this.client.messages.create({
                    model: this.model,
                    max_tokens: this.maxTokens,
                    messages: [{ role: 'user', content: prompt }],
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
                    const delay = attempt * 2000; // 2s, 4s, 6s back-off
                    console.warn(`⏳ Retrying in ${delay / 1000}s...`);
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
            msg.includes('529') ||       // overloaded
            msg.includes('529') ||
            msg.includes('rate') ||
            msg.includes('overload') ||
            msg.includes('too many') ||
            msg.includes('timeout') ||
            error.status === 529 ||
            error.status === 429
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
