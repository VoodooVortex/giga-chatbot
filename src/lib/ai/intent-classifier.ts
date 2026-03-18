/**
 * Intent Classification using Gemini
 * Classifies user queries into: device_lookup, ticket_lookup, notification_check, general_question
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "@/lib/config";
import type { ClassifiedIntent, IntentType } from "./types";

const genAI = new GoogleGenerativeAI(env.GOOGLE_API_KEY_CHAT);

const INTENT_PROMPT = `You are an intent classifier for an IT asset management chatbot.
Analyze the user query and classify it into one of these intents:

1. "device_lookup" - User wants to find/search devices, assets, or inventory (including questions about "รหัส" or asset tags in general if not specified as password)
   Examples: "หาเครื่องคอมที่ห้อง 101", "Device ที่ assign ให้ใคร", "ค้นหา Asset TAG123", "มีรหัสอะไรบ้าง"

2. "ticket_lookup" - User wants to find/search tickets, issues, or problems
   Examples: "ticket ล่าสุด", "ปัญหาที่ยังไม่เสร็จ", "ดู issue ของ device นี้"

3. "notification_check" - User wants to check notifications or alerts
   Examples: "มีแจ้งเตือนไหม", "notification ล่าสุด", "อ่านการแจ้งเตือนทั้งหมด"

4. "general_question" - General IT questions that need RAG knowledge base (like passwords, policies)
   Examples: "วิธี reset password", "ลืมรหัสผ่านทำไง", "policy การใช้งาน", "ขั้นตอนการเบิกอุปกรณ์"

Respond ONLY in JSON format:
{
  "intent": "one_of_the_four_intents",
  "confidence": 0.95,
  "entities": {
    "deviceId": "optional_device_id_or_tag",
    "deviceName": "optional_device_name",
    "ticketId": "optional_ticket_id",
    "keywords": ["extracted", "keywords"]
  }
}`;

export async function classifyIntent(query: string): Promise<ClassifiedIntent> {
    const heuristic = classifyIntentHeuristic(query);

    // In low-quota mode or when classifier is disabled, avoid LLM calls whenever possible.
    if (env.LOW_QUOTA_MODE || !env.ENABLE_LLM_INTENT_CLASSIFIER) {
        return heuristic;
    }

    // For very obvious intents, skip classifier model call to save quota.
    if (heuristic.confidence >= 0.9) {
        return heuristic;
    }

    const response = env.LLM_PROVIDER === "openrouter"
        ? await classifyIntentWithOpenRouter(query)
        : await classifyIntentWithGoogle(query);

    try {
        const parsed = JSON.parse(response) as ClassifiedIntent;

        // Validate intent type
        const validIntents: IntentType[] = [
            "device_lookup",
            "ticket_lookup",
            "notification_check",
            "general_question"
        ];

        if (!validIntents.includes(parsed.intent)) {
            parsed.intent = "general_question";
            parsed.confidence = 0.5;
        }

        return parsed;
    } catch (error) {
        console.error("Failed to parse intent classification:", error);
        // Default to general question if parsing fails
        return {
            intent: "general_question",
            confidence: 0.5,
            entities: { keywords: extractKeywords(query) }
        };
    }
}

async function classifyIntentWithGoogle(query: string): Promise<string> {
    const model = genAI.getGenerativeModel({
        model: env.GOOGLE_MODEL_NAME,
        generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json",
        }
    });

    const result = await model.generateContent([
        { text: INTENT_PROMPT },
        { text: `User query: "${query}"` }
    ]);

    return result.response.text();
}

async function classifyIntentWithOpenRouter(query: string): Promise<string> {
    const response = await fetch(`${env.OPENROUTER_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.OPENROUTER_API_KEY_CHAT}`,
        },
        body: JSON.stringify({
            model: env.OPENROUTER_MODEL_NAME,
            temperature: 0.1,
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: INTENT_PROMPT },
                { role: "user", content: `User query: "${query}"` },
            ],
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter intent classification failed: ${response.status} ${errorText}`);
    }

    const payload = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
    };

    return payload.choices?.[0]?.message?.content ?? "";
}

function classifyIntentHeuristic(query: string): ClassifiedIntent {
    const normalized = query.toLowerCase();

    const hasNotification = /แจ้งเตือน|notification|alert/i.test(normalized);
    const hasTicket = /ticket|issue|ปัญหา|งานซ่อม|incident|request/i.test(normalized);
    const hasDevice = /device|asset|อุปกรณ์|คอม|โน้ตบุ๊ก|โน้ตบุค|laptop|pc|tag|serial|(?<!ลืม)(รหัส)(?!ผ่าน)/i.test(normalized);
    const hasAvailability = /ว่าง|พร้อมใช้|พร้อมยืม|ยืมได้|available|ready|คงเหลือ|เหลือ/i.test(normalized);

    if (hasNotification) {
        return {
            intent: "notification_check",
            confidence: 0.95,
            entities: { keywords: extractKeywords(query) }
        };
    }

    if (hasTicket) {
        return {
            intent: "ticket_lookup",
            confidence: 0.9,
            entities: { keywords: extractKeywords(query) }
        };
    }

    if (hasDevice || hasAvailability) {
        return {
            intent: "device_lookup",
            confidence: 0.9,
            entities: { keywords: extractKeywords(query) }
        };
    }

    return {
        intent: "general_question",
        confidence: 0.65,
        entities: { keywords: extractKeywords(query) }
    };
}

function extractKeywords(query: string): string[] {
    // Simple keyword extraction - remove common words and keep important terms
    const commonWords = new Set([
        "the", "a", "an", "is", "are", "was", "were", "be", "been",
        "being", "have", "has", "had", "do", "does", "did", "will",
        "would", "could", "should", "may", "might", "must", "shall",
        "can", "need", "dare", "ought", "used", "to", "of", "in",
        "for", "on", "with", "at", "by", "from", "as", "into",
        "through", "during", "before", "after", "above", "below",
        "between", "under", "again", "further", "then", "once",
        "here", "there", "when", "where", "why", "how", "all",
        "each", "few", "more", "most", "other", "some", "such",
        "no", "nor", "not", "only", "own", "same", "so", "than",
        "too", "very", "just", "and", "but", "if", "or", "because",
        "until", "while", "ที่", "ใน", "ของ", "กับ", "และ", "หรือ",
        "แต่", "ถ้า", "เมื่อ", "นี้", "นั้น", "มี", "เป็น", "ได้",
        "จะ", "ให้", "ว่า", "โดย", "จาก", "ไป", "มา",
        "ไหม", "มั้ย", "หรือเปล่า", "เปล่า", "นะ", "นะครับ", "นะคะ",
        "หน่อย", "หน่อยครับ", "หน่อยค่ะ", "ช่วย", "ขอ", "อยาก", "ที",
        "หน่อยนะ", "ด้วย", "ด้วยครับ", "ด้วยค่ะ"
    ]);

    return query
        .toLowerCase()
        .replace(/[^\u0E00-\u0E7Fa-zA-Z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(word => word.length > 1 && !commonWords.has(word));
}
