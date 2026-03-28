const { GoogleGenerativeAI } = require('@google/generative-ai');

class GeminiService {
    constructor() {
        this.geminiKeys = [];
        this.currentKeyIndex = 0;
        this.successfulResponses = 0;

        // Load model configuration from environment
        this.primaryModel = process.env.GEMINI_PRIMARY_MODEL || 'gemini-2.5-flash';
        this.fallbackModel = process.env.GEMINI_FALLBACK_MODEL || 'gemini-1.5-flash';
        this.temperature = parseFloat(process.env.GEMINI_TEMPERATURE) || 0.7;
        this.topK = parseInt(process.env.GEMINI_TOP_K) || 40;
        this.topP = parseFloat(process.env.GEMINI_TOP_P) || 0.95;
        this.maxOutputTokens = parseInt(process.env.GEMINI_MAX_OUTPUT_TOKENS) || 100000;

        console.log(`🤖 Gemini Configuration:`);
        console.log(`   Primary Model: ${this.primaryModel}`);
        console.log(`   Fallback Model: ${this.fallbackModel}`);
        console.log(`   Temperature: ${this.temperature}`);
        console.log(`   Top K: ${this.topK}`);
        console.log(`   Top P: ${this.topP}`);
        console.log(`   Max Output Tokens: ${this.maxOutputTokens}`);

        this.initializeGeminiKeys();
    }

    initializeGeminiKeys() {
        // Initialize multiple Gemini API keys
        this.geminiKeys = [];

        // Add all available keys from environment variables
        const keyCount = parseInt(process.env.GEMINI_KEY_COUNT) || 1;

        for (let i = 1; i <= keyCount; i++) {
            const keyName = i === 1 ? 'GEMINI_API_KEY' : `GEMINI_API_KEY_${i}`;
            const key = process.env[keyName];

            if (key) {
                this.geminiKeys.push({
                    key: key,
                    name: keyName,
                    isBlocked: false,
                    lastUsed: null,
                    errorCount: 0
                });
            }
        }

        if (this.geminiKeys.length === 0) {
            console.error('❌ No Gemini API keys found in environment variables');
            process.exit(1);
        }

        console.log(`✅ Initialized ${this.geminiKeys.length} Gemini API keys`);
        this.currentKeyIndex = 0;
    }

    getCurrentKey() {
        // Find next available key
        for (let i = 0; i < this.geminiKeys.length; i++) {
            const keyIndex = (this.currentKeyIndex + i) % this.geminiKeys.length;
            const keyInfo = this.geminiKeys[keyIndex];

            if (!keyInfo.isBlocked) {
                this.currentKeyIndex = keyIndex;
                return keyInfo;
            }
        }

        // If all keys are blocked, reset and use the first one
        console.warn('⚠️  All keys appear to be blocked, resetting...');
        this.resetAllKeys();
        return this.geminiKeys[0];
    }

    markKeyAsBlocked(keyInfo, error) {
        keyInfo.isBlocked = true;
        keyInfo.errorCount++;
        keyInfo.lastError = error;
        keyInfo.blockedAt = new Date().toISOString();

        console.warn(`🚫 Marked key ${keyInfo.name} as blocked due to: ${error}`);

        // Auto-unblock after 1 hour (adjust as needed)
        setTimeout(() => {
            this.unblockKey(keyInfo);
        }, 60 * 60 * 1000); // 1 hour
    }

    unblockKey(keyInfo) {
        keyInfo.isBlocked = false;
        console.log(`✅ Unblocked key ${keyInfo.name}`);
    }

    resetAllKeys() {
        this.geminiKeys.forEach(key => {
            key.isBlocked = false;
            key.errorCount = 0;
        });
        this.currentKeyIndex = 0;
        console.log('🔄 Reset all API keys');
    }

    moveToNextKey() {
        this.currentKeyIndex = (this.currentKeyIndex + 1) % this.geminiKeys.length;
        console.log(`🔄 Switched to next key (index: ${this.currentKeyIndex})`);
    }

    async callGeminiAPIWithRetry(prompt, maxRetries = null) {
        const totalRetries = maxRetries || this.geminiKeys.length * 2; // Double retries to account for fallback model
        let lastError = null;

        for (let attempt = 0; attempt < totalRetries; attempt++) {
            try {
                const keyInfo = this.getCurrentKey();
                console.log(`🔑 Attempting with key: ${keyInfo.name} (attempt ${attempt + 1}/${totalRetries})`);

                const response = await this.callGeminiAPI(prompt, keyInfo.key);

                // Update key usage info and increment successful responses counter
                keyInfo.lastUsed = new Date().toISOString();
                keyInfo.errorCount = 0;
                this.successfulResponses++; // Increment counter on successful response

                console.log(`✅ Successfully generated response with key: ${keyInfo.name}`);
                return response;

            } catch (error) {
                lastError = error;
                const keyInfo = this.getCurrentKey();

                console.error(`❌ Error with key ${keyInfo.name}:`, error.message);

                // Check if it's a 429 error (rate limit) or quota exceeded
                if (this.isRateLimitError(error)) {
                    console.warn(`🚫 Rate limit hit for key ${keyInfo.name}, switching to next key...`);
                    this.markKeyAsBlocked(keyInfo, error.message);
                    this.moveToNextKey();

                    // Add delay before trying next key
                    await this.delay(1000);
                    continue;
                } else {
                    // For non-rate-limit errors, still try next key but don't block current one
                    console.warn(`⚠️  Non-rate-limit error with key ${keyInfo.name}, trying next key...`);
                    this.moveToNextKey();
                    await this.delay(500);
                    continue;
                }
            }
        }

        // If we've exhausted all retries
        console.error(`❌ All retry attempts failed. Last error: ${lastError?.message}`);
        throw new Error(`All Gemini API keys exhausted. Last error: ${lastError?.message}`);
    }

    isRateLimitError(error) {
        const errorMessage = error.message?.toLowerCase() || '';
        const errorString = error.toString?.()?.toLowerCase() || '';

        return (
            errorMessage.includes('429') ||
            errorMessage.includes('rate limit') ||
            errorMessage.includes('quota') ||
            errorMessage.includes('too many requests') ||
            errorString.includes('429') ||
            errorString.includes('rate limit') ||
            errorString.includes('quota')
        );
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async callGeminiAPI(prompt, apiKey, useFailback = false) {
        try {
            if (!apiKey) {
                throw new Error('No API key provided');
            }

            const genAI = new GoogleGenerativeAI(apiKey);
            const modelName = useFailback ? this.fallbackModel : this.primaryModel;
            const model = genAI.getGenerativeModel({ model: modelName });

            const generationConfig = {
                temperature: this.temperature,
                topK: this.topK,
                topP: this.topP,
                maxOutputTokens: this.maxOutputTokens,
            };

            console.log(`🤖 Using model: ${modelName}`);

            const result = await model.generateContent({
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig,
            });

            const response = await result.response;
            const text = response.text();

            if (!text) {
                throw new Error('No text returned from Gemini API');
            }

            return text;

        } catch (error) {
            console.error(`Gemini API Error (${useFailback ? this.fallbackModel : this.primaryModel}):`, error.message);

            // If primary model fails and we haven't tried fallback yet, try fallback
            if (!useFailback && this.fallbackModel !== this.primaryModel) {
                console.log(`🔄 Trying fallback model: ${this.fallbackModel}`);
                return await this.callGeminiAPI(prompt, apiKey, true);
            }

            throw error; // Re-throw to be caught by retry logic
        }
    }

    // Method to get current API key status
    getKeyStatus() {
        return this.geminiKeys.map((key, index) => ({
            index,
            name: key.name,
            isBlocked: key.isBlocked,
            errorCount: key.errorCount,
            lastUsed: key.lastUsed,
            isCurrent: index === this.currentKeyIndex
        }));
    }

    // Method to manually reset a specific key
    resetKey(keyName) {
        const key = this.geminiKeys.find(k => k.name === keyName);
        if (key) {
            this.unblockKey(key);
            console.log(`🔄 Manually reset key: ${keyName}`);
        }
    }

    // Method to get current model configuration
    getModelConfig() {
        return {
            primaryModel: this.primaryModel,
            fallbackModel: this.fallbackModel,
            temperature: this.temperature,
            topK: this.topK,
            topP: this.topP,
            maxOutputTokens: this.maxOutputTokens
        };
    }

    // Method to update model configuration at runtime (optional)
    updateModelConfig(config) {
        if (config.primaryModel) this.primaryModel = config.primaryModel;
        if (config.fallbackModel) this.fallbackModel = config.fallbackModel;
        if (config.temperature !== undefined) this.temperature = config.temperature;
        if (config.topK !== undefined) this.topK = config.topK;
        if (config.topP !== undefined) this.topP = config.topP;
        if (config.maxOutputTokens !== undefined) this.maxOutputTokens = config.maxOutputTokens;

        console.log('🔄 Updated Gemini model configuration:', this.getModelConfig());
    }
}

module.exports = GeminiService;