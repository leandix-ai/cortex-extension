// ============================================================================
// Anthropic-Compatible Provider — Native Anthropic API
// Supports both Fast Model and Smart Model roles in two-tier routing.
// Native Anthropic Messages API with Extended Thinking support.
// JSON guardrails via system prompt (Anthropic has no native jsonMode).
// ============================================================================

import {
  CortexProvider, Message, Token, ToolCallDelta,
  StreamOptions, ToolDefinition, ToolCall,
} from '../core/types';
import { SSELineBuffer, parseSSELine } from '../core/sse-buffer';

export class AnthropicProvider implements CortexProvider {
  readonly name: string;
  readonly maxContextWindow: number;
  readonly supportsThinking: boolean;

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
    this.baseURL = config.baseURL || 'https://api.anthropic.com';

    // Only Sonnet 3.7+ and Opus 4+ support Extended Thinking
    const modelLower = this.model.toLowerCase();
    this.supportsThinking =
      modelLower.includes('sonnet') ||
      modelLower.includes('opus');

    this.name = `anthropic/${this.model}`;

    const contextWindows: Record<string, number> = {
      'claude-sonnet-4-5': 200000,
      'claude-haiku-4-5': 200000,
      'claude-opus-4': 200000,
      'claude-sonnet-4': 200000,
    };
    this.maxContextWindow = contextWindows[this.model] || 200000;
  }

  async *stream(
    messages: Message[],
    systemPrompt: string,
    tools: ToolDefinition[],
    signal: AbortSignal,
    options?: StreamOptions
  ): AsyncGenerator<Token | ToolCallDelta> {
    // --- JSON Guardrails ---
    // Anthropic doesn't support response_format: { type: "json_object" }
    // Enforce JSON output via system prompt instructions
    if (options?.jsonMode) {
      systemPrompt = `${systemPrompt}\n\nCRITICAL OUTPUT FORMAT RULE: You MUST respond with ONLY a valid JSON object. No markdown formatting, no backticks, no explanation text before or after the JSON. Your entire response must be parseable by JSON.parse().`;
    }

    // --- Native Anthropic Stream ---
    const isJsonMode = options?.jsonMode === true;
    const budgetTokens = 8000;
    const requestedMaxTokens = options?.maxTokens || 8192;
    const useThinking = this.supportsThinking && !isJsonMode;

    // Only inflate maxTokens when thinking is actually enabled
    const maxTokens = isJsonMode
      ? Math.max(requestedMaxTokens, 256)
      : useThinking
        ? Math.max(requestedMaxTokens, budgetTokens + 4096)
        : requestedMaxTokens;

    const effectiveSystemPrompt = systemPrompt;

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: maxTokens,
      stream: true,
      system: effectiveSystemPrompt,
      messages: this.formatMessages(messages),
    };

    // Only enable thinking for models that support it, and not in jsonMode
    if (useThinking) {
      body.thinking = {
        type: 'enabled',
        budget_tokens: budgetTokens,
      };
    }

    // Only include tools if provided and NOT in jsonMode
    if (tools.length > 0 && !isJsonMode) {
      body.tools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
    }

    // Low temperature for jsonMode
    if (isJsonMode) {
      body.temperature = options?.temperature ?? 0.1;
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseURL}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err: any) {
      if (err.name === 'AbortError') throw err;
      throw new Error(
        `Cannot connect to Anthropic API (${this.baseURL}). Check network or config.\nDetails: ${err.message}`
      );
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
    }

    if (!response.body) {
      throw new Error('No response body from Anthropic API');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    const lineBuffer = new SSELineBuffer();
    let currentToolCall: Partial<ToolCall> | null = null;
    let toolCallJson = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const lines = lineBuffer.push(decoder.decode(value, { stream: true }));

        for (const line of lines) {
          const data = parseSSELine(line);
          if (!data) continue;

          let event: any;
          try {
            event = JSON.parse(data);
          } catch {
            continue;
          }

          switch (event.type) {
            case 'content_block_start':
              if (event.content_block?.type === 'tool_use') {
                currentToolCall = {
                  id: event.content_block.id,
                  name: event.content_block.name,
                };
                toolCallJson = '';
              }
              break;

            case 'content_block_delta':
              if (event.delta?.type === 'thinking_delta') {
                yield { text: event.delta.thinking, type: 'reasoning' };
              } else if (event.delta?.type === 'text_delta') {
                yield { text: event.delta.text, type: 'content' };
              } else if (event.delta?.type === 'input_json_delta') {
                toolCallJson += event.delta.partial_json || '';
              }
              break;

            case 'content_block_stop':
              if (currentToolCall && currentToolCall.name) {
                let args: Record<string, unknown> = {};
                try {
                  args = JSON.parse(toolCallJson);
                } catch {
                  args = { _raw: toolCallJson };
                }
                yield {
                  type: 'tool_call',
                  toolCall: {
                    id: currentToolCall.id || `tc_${Date.now()}`,
                    name: currentToolCall.name,
                    arguments: args,
                  },
                };
                currentToolCall = null;
                toolCallJson = '';
              }
              break;

            case 'message_stop':
              break;

            case 'error':
              throw new Error(`Anthropic stream error: ${JSON.stringify(event.error)}`);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / 3.2);
  }


  private formatMessages(messages: Message[]): any[] {
    const formatted: any[] = [];

    for (const msg of messages) {
      if (msg.role === 'tool') {
        const toolResultBlock = {
          type: 'tool_result',
          tool_use_id: msg.toolResults?.[0]?.toolCallId || 'unknown',
          content: msg.content,
          is_error: msg.toolResults?.[0]?.isError || false,
        };

        // Anthropic requires all consecutive tool results to be in a single 'user' message
        const lastMsg = formatted[formatted.length - 1];
        if (lastMsg && lastMsg.role === 'user' && Array.isArray(lastMsg.content) && lastMsg.content.some((c: any) => c.type === 'tool_result' || c.type === 'tool_use')) {
          lastMsg.content.push(toolResultBlock);
        } else {
          formatted.push({
            role: 'user',
            content: [toolResultBlock],
          });
        }
        continue;
      }

      if (msg.role === 'assistant' && msg.toolCalls?.length) {
        const content: any[] = [];
        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }
        for (const tc of msg.toolCalls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          });
        }
        formatted.push({ role: 'assistant', content });
        continue;
      }

      // Standard text message
      // Note: Anthropic doesn't support consecutive messages of the same role (except in some specific beta features).
      // We'll trust the caller doesn't send consecutive user/assistant messages without folding them,
      // or we can fold them here if needed. For now, just map it.
      const lastMsg = formatted[formatted.length - 1];
      if (lastMsg && lastMsg.role === msg.role && typeof lastMsg.content === 'string' && typeof msg.content === 'string') {
        // Fold consecutive text messages of the same role
        lastMsg.content += '\n\n' + msg.content;
      } else {
        formatted.push({ role: msg.role, content: msg.content });
      }
    }

    return formatted;
  }
}
