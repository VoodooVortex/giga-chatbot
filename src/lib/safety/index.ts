/**
 * Content Safety Module - Entry Point
 * 
 * Provides guardrails for:
 * - Basic: Profanity filtering (Thai + English)
 * - Standard: Prompt injection detection
 * 
 * @example
 * ```typescript
 * import { runSafetyChecks, getBlockedResponse } from "@/lib/safety";
 * 
 * const result = runSafetyChecks(userInput);
 * if (!result.isSafe) {
 *   return getBlockedResponse(result.violation);
 * }
 * ```
 */

export {
    // Main functions
    runSafetyChecks,
    checkProfanity,
    checkPromptInjection,
    checkCodeRequest,
    getBlockedResponse,
    createSafetyMiddleware,

    // Constants
    BLOCKED_RESPONSES,
} from "./guardrails";

export type {
    SafetyCheckResult,
    GuardrailsOptions,
} from "./guardrails";
