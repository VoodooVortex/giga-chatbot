/**
 * Intent Classification using Gemini
 * Classifies user queries into: device_lookup, ticket_lookup, notification_check, general_question
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "@/lib/config";
import type { ClassifiedIntent, IntentType } from "./types";

const genAI = new GoogleGenerativeAI(env.GOOGLE_API_KEY);

const INTENT_PROMPT = `You are an intent classifier for an IT asset management chatbot.
Analyze the user query and classify it into one of these intents:

1. "device_lookup" - User wants to find/search devices, assets, or inventory
   Examples: "หาเครื่องคอมที่ห้อง 101", "Device ที่ assign ให้ใคร", "ค้นหา Asset TAG123"

2. "ticket_lookup" - User wants to find/search tickets, issues, or problems
   Examples: "ticket ล่าสุด", "ปัญหาที่ยังไม่เสร็จ", "ดู issue ของ device นี้"

3. "notification_check" - User wants to check notifications or alerts
   Examples: "มีแจ้งเตือนไหม", "notification ล่าสุด", "อ่านการแจ้งเตือนทั้งหมด"

4. "general_question" - General IT questions that need RAG knowledge base
   Examples: "วิธี reset password", "policy การใช้งาน", "ขั้นตอนการเบิกอุปกรณ์"

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

    const response = result.response.text();

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
        "จะ", "ให้", "ว่า", "โดย", "จาก", "ไป", "มา"
    ]);

    return query
        .toLowerCase()
        .replace(/[^\u0E00-\u0E7Fa-zA-Z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(word => word.length > 1 && !commonWords.has(word));
}
