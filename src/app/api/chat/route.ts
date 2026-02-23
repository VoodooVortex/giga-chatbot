import { NextRequest } from "next/server";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { toUIMessageStream } from "@ai-sdk/langchain";
import {
  createUIMessageStreamResponse,
  type UIMessage,
} from "ai";

export const runtime = "edge";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const { messages }: { messages: UIMessage[] } = await req.json();

    const formattedMessages: [string, string][] = messages.map(m => {
      let content = "";
      if (typeof (m as any).content === "string") {
        content = (m as any).content;
      } else if (m.parts) {
        m.parts.forEach((p: any) => {
          if (p.type === "text") content += p.text;
        });
      }
      return [m.role === "user" ? "user" : "ai", content];
    });

    const prompt = ChatPromptTemplate.fromMessages([
      ["system", "You are a helpful and friendly AI assistant."],
      ...formattedMessages,
    ]);

    const model = new ChatGoogleGenerativeAI({
      model: process.env.GOOGLE_MODEL_NAME || "gemini-2.5-flash",
      temperature: 0.7,
      maxRetries: 2,
    });

    const chain = prompt.pipe(model);
    const stream = await chain.stream({});

    return createUIMessageStreamResponse({
      stream: toUIMessageStream(stream),
    });
  } catch (error: any) {
    console.error("API Error:", error);
    return new Response(
      JSON.stringify({
        error: "An error occurred while processing your request",
        details: error.message
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
