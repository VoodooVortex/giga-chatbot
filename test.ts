import { ChatPromptTemplate } from "@langchain/core/prompts";

try {
  const prompt = ChatPromptTemplate.fromMessages([
    ["system", "You are a helpful and friendly AI assistant."],
    { role: "user", content: "hello" } as any,
  ]);
  console.log("Success!");
} catch (e: any) {
  console.error("Failed:", e.message);
}
