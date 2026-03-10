// ============================================================================
// Thinking Tag Parser — Proper Chunk Boundary-Aware Parsing
// Fixes the bug from the design doc: tokens containing partial tags are
// properly split so no content is lost.
// ============================================================================

import { Token } from './types';

export class ThinkingTagParser {
  private isThinking = false;
  private partialTag = '';

  /**
   * Process a text chunk and yield proper Token objects.
   * Handles thinking tags that span across chunks and within tokens.
   */
  *process(text: string): Generator<Token> {
    // Prepend any partial tag from previous chunk
    const input = this.partialTag + text;
    this.partialTag = '';

    let cursor = 0;

    while (cursor < input.length) {
      // Look for the start of any tag
      const tagStart = input.indexOf('<', cursor);

      if (tagStart === -1) {
        // No more tags — yield remaining text
        const remaining = input.slice(cursor);
        if (remaining.length > 0) {
          yield this.makeToken(remaining);
        }
        break;
      }

      // Yield text before the tag
      if (tagStart > cursor) {
        yield this.makeToken(input.slice(cursor, tagStart));
      }

      // Check if we have a complete tag
      const tagEnd = input.indexOf('>', tagStart);

      if (tagEnd === -1) {
        // Incomplete tag at end of chunk — buffer it for next chunk
        this.partialTag = input.slice(tagStart);
        break;
      }

      const tag = input.slice(tagStart, tagEnd + 1);

      if (tag === '<thinking>' || tag === '<Thinking>') {
        this.isThinking = true;
        cursor = tagEnd + 1;
      } else if (tag === '</thinking>' || tag === '</Thinking>') {
        this.isThinking = false;
        cursor = tagEnd + 1;
      } else {
        // Not a thinking tag — yield it as content
        yield this.makeToken(tag);
        cursor = tagEnd + 1;
      }
    }
  }

  /**
   * Flush any buffered partial tag (call on stream end).
   */
  *flush(): Generator<Token> {
    if (this.partialTag.length > 0) {
      yield this.makeToken(this.partialTag);
      this.partialTag = '';
    }
  }

  reset(): void {
    this.isThinking = false;
    this.partialTag = '';
  }

  private makeToken(text: string): Token {
    return {
      text,
      type: this.isThinking ? 'reasoning' : 'content',
    };
  }
}
