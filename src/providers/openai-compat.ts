// ============================================================================
// OpenAI-Compatible Provider — Fast Model with Smart Routing
// Supports OpenAI API and all OpenAI-compatible endpoints (LM Studio, etc.)
// Can delegate complex queries to a Smart Model provider
// ============================================================================

import {
  CortexProvider, Message, Token, ToolCallDelta,
  StreamOptions, ToolDefinition, ToolCall,
} from '../core/types';
import { SSELineBuffer, parseSSELine } from '../core/sse-buffer';

export class OpenAICompatProvider implements CortexProvider {
  readonly name: string;
  readonly maxContextWindow: number;
  readonly supportsThinking = false;

  private model: string;
  private apiKey: string;
  private baseURL: string;
  constructor(
    config: {
      model: string;
      apiKey: string;
      baseURL?: string;
    }
  ) {
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL || 'https://api.openai.com';
    this.name = `openai-compat/${this.model}`;

    const contextWindows: Record<string, number> = {
      'gpt-4': 8192,
      'gpt-4-32k': 32768,
      'gpt-4-turbo': 128000,
      'gpt-4o': 128000,
      'gpt-3.5-turbo': 16385,
    };
    this.maxContextWindow = contextWindows[this.model] || 128000;
  }

  async *stream(
    messages: Message[],
    systemPrompt: string,
    tools: ToolDefinition[],
    signal: AbortSignal,
    options?: StreamOptions
  ): AsyncGenerator<Token | ToolCallDelta> {
    // Use fast model for actual response and tool calling
    const maxTokens = options?.maxTokens || 4096;

    const apiMessages: any[] = [];

    if (systemPrompt) {
      apiMessages.push({
        role: 'system',
        content: systemPrompt,
      });
    }

    apiMessages.push(...this.formatMessages(messages));

    const body: Record<string, unknown> = {
      model: this.model,
      messages: apiMessages,
      max_tokens: maxTokens,
      stream: true,
      temperature: options?.temperature ?? 0.7,
    };

    if (options?.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    if (tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));
      body.tool_choice = 'auto';
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseURL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err: any) {
      if (err.name === 'AbortError') throw err;
      throw new Error(
        `Cannot connect to API (${this.baseURL}). Check network or baseURL config.\nDetails: ${err.message}`
      );
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`OpenAI-compatible API error ${response.status}: ${errorText}`);
    }

    if (!response.body) {
      throw new Error('No response body from API');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    const lineBuffer = new SSELineBuffer();

    interface PartialToolCall {
      id?: string;
      name?: string;
      _rawArguments: string;
    }
    const toolCallsMap = new Map<number, PartialToolCall>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const lines = lineBuffer.push(decoder.decode(value, { stream: true }));

        for (const line of lines) {
          const data = parseSSELine(line);
          if (!data || data === '[DONE]') continue;

          let event: any;
          try {
            event = JSON.parse(data);
          } catch {
            continue;
          }

          const choice = event.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta;
          if (!delta) continue;

          if (delta.content) {
            yield { text: delta.content, type: 'content' };
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const index = tc.index;
              if (!toolCallsMap.has(index)) {
                toolCallsMap.set(index, {
                  id: tc.id || `tc_${Date.now()}_${index}`,
                  name: tc.function?.name || '',
                  _rawArguments: '',
                });
              }

              const toolCall = toolCallsMap.get(index)!;

              if (tc.function?.name) {
                toolCall.name = tc.function.name;
              }

              if (tc.function?.arguments) {
                toolCall._rawArguments += tc.function.arguments;
              }
            }
          }

          if (choice.finish_reason) {
            for (const toolCall of toolCallsMap.values()) {
              if (toolCall.name) {
                let args: Record<string, unknown> = {};
                try {
                  args = JSON.parse(toolCall._rawArguments || '{}');
                } catch {
                  args = { _raw: toolCall._rawArguments };
                }
                yield {
                  type: 'tool_call',
                  toolCall: {
                    id: toolCall.id || `tc_${Date.now()}`,
                    name: toolCall.name,
                    arguments: args,
                  },
                };
              }
            }
            toolCallsMap.clear();
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / 3.5);
  }

  private formatMessages(messages: Message[]): any[] {
    return messages.map((msg) => {
      if (msg.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: msg.toolResults?.[0]?.toolCallId || 'unknown',
          content: msg.content,
        };
      }

      if (msg.role === 'assistant' && msg.toolCalls?.length) {
        return {
          role: 'assistant',
          content: msg.content || null,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        };
      }

      return {
        role: msg.role,
        content: msg.content,
      };
    });
  }
}
