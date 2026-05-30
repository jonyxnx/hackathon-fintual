import OpenAI from "openai";
import type { LLMChatInput, LLMInput, LLMProvider } from "./index";
import { withRetry } from "./index";

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai" as const;
  readonly model: string;
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.model = process.env.OPENAI_MODEL || "gpt-5";
  }

  async complete(input: LLMInput): Promise<string> {
    const res = await withRetry(
      () =>
        this.client.chat.completions.create({
          model: this.model,
          max_tokens: input.maxTokens ?? 4096,
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.user },
          ],
        }),
      `OpenAI(${this.model})`,
    );
    return (res.choices[0]?.message?.content ?? "").trim();
  }

  async *streamChat(input: LLMChatInput): AsyncIterable<string> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: input.maxTokens ?? 4096,
      stream: true,
      messages: [
        { role: "system", content: input.system },
        ...input.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    });
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}
