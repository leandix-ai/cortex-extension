// ============================================================================
// Intelligence Layer — LLM-Based Classifier & Token Counter
// Uses a lightweight LLM API call to classify prompt complexity and tool needs.
// Fallback to complex mode on failure to ensure no request is dropped.
// ============================================================================

import { ClassificationResult } from '../core/types';

import { CortexProvider } from '../core/types';

export class AIClassifier {
  async classify(prompt: string, provider: CortexProvider): Promise<ClassificationResult> {
    let complexity: 'simple' | 'complex' = 'complex';
    let needsTools = true;
    let needsMutatingTools = true;

    try {
      const systemPrompt = `You are a prompt classifier deciding if a user's request requires coding tools to modify/view codebase files, or if it can be answered directly.

Rules:
- If the prompt only asks general coding questions, asks for explanations, or says 'hi':
  Return {"complexity": "simple", "needsTools": false, "needsMutatingTools": false}
- If the prompt asks to READ, VIEW, SEARCH, LIST, or EXPLAIN existing files (readonly operations):
  Return {"complexity": "complex", "needsTools": true, "needsMutatingTools": false}
- If the prompt asks to CREATE, WRITE, MODIFY, EDIT, DELETE, REFACTOR, or RUN COMMANDS on files:
  Return {"complexity": "complex", "needsTools": true, "needsMutatingTools": true}

You MUST return your answer as a raw JSON object string ONLY, without any markdown formatting or backticks.
Example valid response:
{"complexity": "simple", "needsTools": false, "needsMutatingTools": false}
`;

      const stream = provider.stream(
        [{ role: 'user', content: prompt, timestamp: Date.now() }],
        systemPrompt,
        [], // No tools for classification
        new AbortController().signal,
        { maxTokens: 100, jsonMode: true, temperature: 0.1 }
      );

      let resultText = '';
      for await (const chunk of stream) {
        if ('type' in chunk && chunk.type === 'content') {
          resultText += chunk.text;
        }
      }

      // Robust JSON extraction: handles markdown wrappers, extra text around JSON, etc.
      // Layer 1: Direct parse
      let result: any;
      try {
        result = JSON.parse(resultText.trim());
      } catch {
        // Layer 2: Strip markdown code fences
        const stripped = resultText.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim();
        try {
          result = JSON.parse(stripped);
        } catch {
          // Layer 3: Regex extract first JSON object from text
          const jsonMatch = resultText.match(/\{[\s\S]*?"complexity"\s*:\s*"(?:simple|complex)"[\s\S]*?\}/);
          if (jsonMatch) {
            try {
              result = JSON.parse(jsonMatch[0]);
            } catch {
              result = null;
            }
          }
        }
      }

      if (result) {
        if (result.complexity === 'simple' || result.complexity === 'complex') {
          complexity = result.complexity;
        }
        if (typeof result.needsTools === 'boolean') {
          needsTools = result.needsTools;
        }
        if (typeof result.needsMutatingTools === 'boolean') {
          needsMutatingTools = result.needsMutatingTools;
        }
      }
    } catch (e) {
      console.warn('[AIClassifier] Failed to classify using LLM, falling back to complex mode.', e);
      // Fallback
      complexity = 'complex';
      needsTools = true;
      needsMutatingTools = true;
    }

    // If needsTools is false, needsMutatingTools must also be false
    if (!needsTools) {
      needsMutatingTools = false;
    }

    // Estimate tokens for the response using char/3.5 ratio (rough GPT tokenizer heuristic)
    const promptTokens = Math.ceil(prompt.length / 3.5);
    const estimatedTokens = complexity === 'complex'
      ? Math.min(8192, Math.max(2048, promptTokens * 3))
      : Math.min(4096, Math.max(512, promptTokens * 2));

    return {
      complexity,
      needsTools,
      needsMutatingTools,
      estimatedTokens,
    };
  }
}


export class LocalTokenCounter {
  private calibrationFactor = 1.0;
  private samples: number[] = [];

  /**
   * Estimate token count for a string.
   * Uses char/3.2 heuristic with calibration from actual API responses.
   */
  estimate(text: string): number {
    // Base heuristic: ~3.2 chars per token (slightly overcount for safety)
    const raw = Math.ceil(text.length / 3.2);
    return Math.ceil(raw * this.calibrationFactor);
  }

  /**
   * Update calibration based on actual token count from API response.
   * Called after each API call with the reported usage.
   */
  calibrate(text: string, actualTokens: number): void {
    const estimated = Math.ceil(text.length / 3.2);
    if (estimated > 0 && actualTokens > 0) {
      const ratio = actualTokens / estimated;
      this.samples.push(ratio);

      // Keep last 50 samples
      if (this.samples.length > 50) {
        this.samples.shift();
      }

      // Moving average
      this.calibrationFactor =
        this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    }
  }
}
