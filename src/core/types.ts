// ============================================================================
// Cortex Core Types
// All shared interfaces and type definitions
// ============================================================================

// --- Messages ---

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  timestamp: number;
}

// --- Conversations ---

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface Token {
  text: string;
  type: 'content' | 'reasoning';
}

// --- Provider ---

export interface ProviderConfig {
  model: string;
  apiKey?: string;
  baseURL?: string;
}

export interface CortexProvider {
  readonly name: string;
  readonly maxContextWindow: number;
  readonly supportsThinking: boolean;
  stream(
    messages: Message[],
    systemPrompt: string,
    tools: ToolDefinition[],
    signal: AbortSignal,
    options?: StreamOptions
  ): AsyncGenerator<Token | ToolCallDelta>;
  countTokens(text: string): number;
}

export interface StreamOptions {
  temperature?: number;
  maxTokens?: number;
  requestReasoning?: boolean; // For requesting reasoning from smart model
  jsonMode?: boolean; // For requesting JSON output from the model
}

// --- Tool Calling ---

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiresConfirmation?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallDelta {
  type: 'tool_call';
  toolCall: ToolCall;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

// --- Events (Event Bus) ---

export type CortexEventType =
  | 'USER_PROMPT'
  | 'CONTEXT_READY'
  | 'STREAM_CLASSIFICATION'
  | 'STREAM_CONTENT'
  | 'STREAM_THINKING'
  | 'STREAM_START'
  | 'STREAM_END'
  | 'STREAM_ERROR'
  | 'TOOL_REQUEST'
  | 'TOOL_RESULT'
  | 'TOOL_CONFIRM_REQUEST'
  | 'TOOL_CONFIRM_RESPONSE'
  | 'ACTION_COMPLETE'
  | 'PROFILE_CHANGED'
  | 'CANCEL_REQUEST'
  | 'AIDER_DELEGATED';

export interface CortexEvent<T = unknown> {
  type: CortexEventType;
  payload: T;
  timestamp: number;
}

export interface UserPromptPayload {
  prompt: string;
  selection?: string | null;
  filePath?: string | null;
}

export interface ContextReadyPayload {
  contextGraph: ContextFile[];
  tokenCount: number;
}

export interface StreamClassificationPayload {
  messageId: string;
  classification: ClassificationResult;
}

export interface StreamContentPayload {
  token: string;
  type: 'content' | 'reasoning';
  messageId: string;
  source?: 'smart' | 'fast'; // Which model generated this
  agentIteration?: {
    iteration: number;
    maxIterations: number;
    toolName: string;
  };
}

export interface ToolRequestPayload {
  tool: string;
  args: Record<string, unknown>;
  iterationIndex: number;
}

export interface ToolResultPayload {
  result: string;
  toolId: string;
  isError: boolean;
}

export interface ActionCompletePayload {
  actionId: string;
  summary: string;
}

// --- AI Action Stack ---

export type AIActionType = 'insert' | 'delete' | 'replace' | 'file_create';

export interface AIAction {
  id: string;
  timestamp: number;
  type: AIActionType;
  files: string[];
  snapshot: Map<string, string>; // filepath → content before change
  messageId: string;
}

// --- Context ---

export interface ContextFile {
  filePath: string;
  content: string;
  relevanceScore: number;
  symbolName?: string;
  language?: string;
}

// --- Classifier ---

export interface ClassificationResult {
  complexity: 'simple' | 'complex';
  needsTools: boolean;
  needsMutatingTools: boolean;
  estimatedTokens: number;
  suggestedProfile?: string;
}

// --- Failure Budget ---

export interface BudgetEntry {
  component: string;
  budgetMs: number;
  fallback: () => void;
}

// --- Sidebar Messages ---

export type SidebarMessage =
  | { type: 'prompt'; text: string }
  | { type: 'classification'; messageId: string; classification: ClassificationResult }
  | { type: 'content'; token: string; messageId: string }
  | { type: 'thinking'; token: string; messageId: string; source?: 'smart' | 'fast' }
  | { type: 'streamStart'; messageId: string }
  | { type: 'streamEnd'; messageId: string }
  | { type: 'error'; message: string }
  | { type: 'history'; messages: Message[] }
  | { type: 'profileChanged'; profile: string; model: string }
  | { type: 'undoAvailable'; available: boolean }
  | { type: 'agentIteration'; iteration: number; maxIterations: number; toolName: string }
  | { type: 'newConversation' }
  | { type: 'loadConversation'; id: string }
  | { type: 'deleteConversation'; id: string }
  | { type: 'conversationList'; conversations: Array<{ id: string; title: string; createdAt: number; updatedAt: number; messageCount: number }> }
  | { type: 'aiderDelegated'; messageId: string; status: 'started' | 'completed' | 'error' | 'not_installed'; message: string; editedFiles?: string[] };
