/**
 * Content Safety Guardrails
 * Provides input validation and content filtering for AI interactions
 * 
 * Levels:
 * - Basic: Profanity filtering (Thai + English)
 * - Standard: + Prompt injection detection
 */

import { logger } from "@/lib/observability/logger";

export interface SafetyCheckResult {
    isSafe: boolean;
    violation?: string;
    level: "basic" | "standard";
    details?: string;
}

// ============================================================================
// Basic Guardrails - Profanity Filtering
// ============================================================================

// Thai profanity list (common bad words)
const THAI_PROFANITY = [
    "สัด", "เหี้ย", "ควย", "หี", "แตด", "เย็ด", "เย็ดแม่", "เยด", "สัส",
    "fuck", "shit", "bitch", "asshole", "damn", "crap", "dick", "pussy",
    "cock", "bastard", "motherfucker", "cunt", "slut", "whore", "retard",
    "nigger", "fag", "chink", "gook", "kike", "wetback", "spic",
];

// Pattern variations (leet speak, spacing)
const PROFANITY_PATTERNS = [
    /f+u+c+k+/i,
    /s+h+i+t+/i,
    /b+i+t+c+h+/i,
    /a+s+s+h+o+l+e+/i,
    /d+a+m+n+/i,
    /d+i+c+k+/i,
    /p+u+s+s+y+/i,
    /c+o+c+k+/i,
    /b+a+s+t+a+r+d+/i,
    /m+o+t+h+e+r+f+u+c+k+e+r+/i,
    /c+u+n+t+/i,
    /s+l+u+t+/i,
    /w+h+o+r+e+/i,
];

/**
 * Check for profanity in text (Thai + English)
 */
export function checkProfanity(text: string): SafetyCheckResult {
    const normalizedText = text.toLowerCase().trim();

    // Check exact matches
    for (const word of THAI_PROFANITY) {
        if (normalizedText.includes(word.toLowerCase())) {
            return {
                isSafe: false,
                violation: "profanity",
                level: "basic",
                details: `Detected prohibited word: ${word}`,
            };
        }
    }

    // Check pattern matches
    for (const pattern of PROFANITY_PATTERNS) {
        if (pattern.test(normalizedText)) {
            return {
                isSafe: false,
                violation: "profanity",
                level: "basic",
                details: `Detected profanity pattern`,
            };
        }
    }

    return { isSafe: true, level: "basic" };
}

// ============================================================================
// Standard Guardrails - Prompt Injection Detection
// ============================================================================

// Common prompt injection patterns
const PROMPT_INJECTION_PATTERNS = [
    // Ignore previous instructions
    /ignore\s+(all\s+)?(previous|prior|earlier)\s+(instructions?|commands?|prompts?)/i,
    /disregard\s+(all\s+)?(previous|prior|earlier)/i,
    /forget\s+(all\s+)?(previous|prior|earlier)/i,

    // System prompt manipulation
    /system\s*:\s*/i,
    /system\s+prompt\s*:/i,
    /you\s+are\s+now\s+/i,
    /from\s+now\s+on\s*,?\s*you\s+are/i,

    // Role switching
    /act\s+as\s+/i,
    /pretend\s+(to\s+be\s+|you\s+are\s+)/i,
    /roleplay\s+as\s+/i,
    /you\s+are\s+(an?\s+)?(expert|developer|hacker|admin)/i,

    // Jailbreak attempts
    /jailbreak/i,
    /DAN\s*\(/i,
    /do\s+anything\s+now/i,
    /developer\s+mode/i,
    /sudo\s+/i,
    /root\s+access/i,

    // Delimiter manipulation
    /```\s*system/i,
    /<\|system\|>/i,
    /\[system\]/i,
    /\{\{system\}\}/i,

    // Instruction override
    /new\s+instructions?\s*:/i,
    /updated\s+instructions?\s*:/i,
    /override\s+/i,
    /bypass\s+/i,
    /hack\s+/i,
    /exploit\s+/i,

    // Code injection attempts
    /console\.log/i,
    /eval\s*\(/i,
    /exec\s*\(/i,
    /system\s*\(/i,
    /subprocess/i,
    /os\.system/i,
    /child_process/i,

    // Data extraction attempts
    /show\s+me\s+your\s+(prompt|instructions)/i,
    /what\s+are\s+your\s+(instructions|rules)/i,
    /repeat\s+after\s+me/i,
    /repeat\s+the\s+above/i,
    /repeat\s+your\s+instructions/i,
    /output\s+the\s+previous/i,

    // Unicode tricks
    /[\u0000-\u001F]/, // Control characters
];

// Suspicious keyword combinations
const SUSPICIOUS_COMBINATIONS = [
    ["ignore", "instruction"],
    ["forget", "prompt"],
    ["system", "override"],
    ["admin", "access"],
    ["password", "show"],
    ["secret", "reveal"],
    ["bypass", "security"],
    ["hack", "database"],
    ["drop", "table"],
    ["delete", "all"],
];

/**
 * Check for prompt injection attempts
 */
export function checkPromptInjection(text: string): SafetyCheckResult {
    const normalizedText = text.toLowerCase().trim();

    // Check pattern matches
    for (const pattern of PROMPT_INJECTION_PATTERNS) {
        if (pattern.test(normalizedText)) {
            return {
                isSafe: false,
                violation: "prompt_injection",
                level: "standard",
                details: `Detected potential prompt injection pattern`,
            };
        }
    }

    // Check suspicious keyword combinations
    const words = normalizedText.split(/\s+/);
    for (const [word1, word2] of SUSPICIOUS_COMBINATIONS) {
        if (words.includes(word1) && words.includes(word2)) {
            return {
                isSafe: false,
                violation: "suspicious_combination",
                level: "standard",
                details: `Detected suspicious keyword combination: ${word1} + ${word2}`,
            };
        }
    }

    return { isSafe: true, level: "standard" };
}

// ============================================================================
// Code Request Detection
// ============================================================================

// Patterns for code generation requests
const CODE_REQUEST_PATTERNS = [
    /write\s+(me\s+)?(a\s+)?(code|script|program)/i,
    /create\s+(me\s+)?(a\s+)?(code|script|program)/i,
    /generate\s+(me\s+)?(a\s+)?(code|script|program)/i,
    /make\s+(me\s+)?(a\s+)?(code|script|program)/i,
    /เขียนโค้ด/i,
    /เขียนโปรแกรม/i,
    /สร้างโค้ด/i,
    /สร้างสคริปต์/i,
    /ช่วยเขียน/i,
    /ช่วยทำโค้ด/i,
    /code\s+for\s+/i,
    /function\s+to\s+/i,
    /script\s+to\s+/i,
    /program\s+that\s+/i,
    /how\s+to\s+(code|program|script)/i,
];

/**
 * Check if user is requesting code generation
 * Returns safe=false if code generation is not allowed
 */
export function checkCodeRequest(text: string, allowCode: boolean = false): SafetyCheckResult {
    if (allowCode) {
        return { isSafe: true, level: "basic" };
    }

    const normalizedText = text.toLowerCase().trim();

    for (const pattern of CODE_REQUEST_PATTERNS) {
        if (pattern.test(normalizedText)) {
            return {
                isSafe: false,
                violation: "code_request",
                level: "basic",
                details: `Code generation is not allowed. Please ask IT-related questions only.`,
            };
        }
    }

    return { isSafe: true, level: "basic" };
}

// ============================================================================
// Main Safety Check Function
// ============================================================================

export interface GuardrailsOptions {
    enableProfanityCheck?: boolean;
    enablePromptInjectionCheck?: boolean;
    enableCodeCheck?: boolean;
    allowCode?: boolean;
}

const DEFAULT_OPTIONS: GuardrailsOptions = {
    enableProfanityCheck: true,
    enablePromptInjectionCheck: true,
    enableCodeCheck: true,
    allowCode: false,
};

/**
 * Run all enabled safety checks on input text
 */
export function runSafetyChecks(
    text: string,
    options: GuardrailsOptions = {}
): SafetyCheckResult {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // Check profanity (Basic)
    if (opts.enableProfanityCheck) {
        const profanityResult = checkProfanity(text);
        if (!profanityResult.isSafe) {
            logViolation(text, profanityResult);
            return profanityResult;
        }
    }

    // Check code requests (Basic)
    if (opts.enableCodeCheck) {
        const codeResult = checkCodeRequest(text, opts.allowCode);
        if (!codeResult.isSafe) {
            logViolation(text, codeResult);
            return codeResult;
        }
    }

    // Check prompt injection (Standard)
    if (opts.enablePromptInjectionCheck) {
        const injectionResult = checkPromptInjection(text);
        if (!injectionResult.isSafe) {
            logViolation(text, injectionResult);
            return injectionResult;
        }
    }

    return { isSafe: true, level: "standard" };
}

/**
 * Log safety violations for monitoring
 */
function logViolation(text: string, result: SafetyCheckResult): void {
    logger.warn("Safety violation detected", {
        violation: result.violation,
        level: result.level,
        details: result.details,
        textPreview: text.slice(0, 100), // Log only first 100 chars
    });
}

// ============================================================================
// Predefined Responses
// ============================================================================

export const BLOCKED_RESPONSES: Record<string, string> = {
    profanity: "ขออภัย กรุณาใช้ภาษาที่สุภาพในการสนทนา / Please use polite language.",
    prompt_injection: "ขออภัย คำขอนี้ไม่สามารถดำเนินการได้ / This request cannot be processed.",
    suspicious_combination: "ขออภัย คำขอนี้ไม่สามารถดำเนินการได้ / This request cannot be processed.",
    code_request: "ขออภัย ฉันไม่สามารถเขียนโค้ดหรือโปรแกรมให้ได้ กรุณาถามคำถามเกี่ยวกับ IT Asset Management แทน / Sorry, I cannot write code or programs. Please ask IT Asset Management questions instead.",
};

/**
 * Get appropriate response for blocked content
 */
export function getBlockedResponse(violation: string): string {
    return BLOCKED_RESPONSES[violation] || "ขออภัย คำขอนี้ไม่สามารถดำเนินการได้ / Sorry, this request cannot be processed.";
}

// ============================================================================
// Middleware Helper
// ============================================================================

/**
 * Express/Next.js middleware helper for content safety
 */
export function createSafetyMiddleware(options?: GuardrailsOptions) {
    return function safetyMiddleware(text: string): { allowed: boolean; response?: string } {
        const result = runSafetyChecks(text, options);

        if (!result.isSafe) {
            return {
                allowed: false,
                response: getBlockedResponse(result.violation || "unknown"),
            };
        }

        return { allowed: true };
    };
}
