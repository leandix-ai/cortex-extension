// ============================================================================
// Provider Factory — Creates providers from settings.json
// Resolves ${env:VAR} placeholders, validates config.
// Supports two-tier routing: Fast Model → Smart Model
// ============================================================================

import { CortexProvider, ProviderConfig } from '../core/types';
import { OpenAICompatProvider } from './openai-compat';
import { AnthropicProvider } from './anthropic-compat';

/**
 * Resolve ${env:VAR_NAME} placeholders in a string.
 */
function resolveEnvVars(value: string): string {
  return value.replace(/\$\{env:([^}]+)\}/g, (_, varName) => {
    return process.env[varName] || '';
  });
}

/**
 * Auto-detect provider type based on model name.
 * Claude models → Anthropic API
 * All other models → OpenAI-compatible API
 */
function detectProviderType(model: string): 'anthropic' | 'openai-compat' {
  const modelLower = model.toLowerCase();
  if (modelLower.startsWith('claude-') || modelLower.includes('anthropic')) {
    return 'anthropic';
  }
  return 'openai-compat';
}

export function createProvider(config: ProviderConfig): CortexProvider {
  // Validate required fields
  if (!config.model) {
    throw new Error('Provider config must include "model" field.');
  }

  const apiKey = config.apiKey ? resolveEnvVars(config.apiKey) : undefined;

  if (!apiKey) {
    throw new Error(
      `Provider requires an API key. Set the apiKey field in settings.json ` +
      `or use environment variables like \${env:OPENAI_API_KEY}.`
    );
  }

  // Auto-detect provider type from model name
  const providerType = detectProviderType(config.model);

  // Route model based on detected provider type
  if (providerType === 'anthropic') {
    return new AnthropicProvider({
      model: config.model,
      apiKey,
      baseURL: config.baseURL || 'https://api.anthropic.com',
    });
  }

  return new OpenAICompatProvider({
    model: config.model,
    apiKey,
    baseURL: config.baseURL || 'https://api.openai.com',
  });
}
