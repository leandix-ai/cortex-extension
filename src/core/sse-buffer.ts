// ============================================================================
// SSE Line Buffer — Handles Chunk Boundary Splitting
// Critical: Without this, thinking tags split across chunks will leak.
// ============================================================================

export class SSELineBuffer {
  private buffer = '';

  /**
   * Push raw chunk data and return complete SSE lines.
   * Handles the case where a line is split across two network chunks.
   */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    let newlineIdx: number;

    while ((newlineIdx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIdx).trim();
      this.buffer = this.buffer.slice(newlineIdx + 1);
      if (line.length > 0) {
        lines.push(line);
      }
    }

    return lines;
  }

  /**
   * Flush any remaining data in the buffer (call on stream end).
   */
  flush(): string | null {
    const remaining = this.buffer.trim();
    this.buffer = '';
    return remaining.length > 0 ? remaining : null;
  }

  reset(): void {
    this.buffer = '';
  }
}

/**
 * Parse an SSE data line into its content.
 * Returns null for non-data lines (comments, events, empty).
 */
export function parseSSELine(line: string): string | null {
  if (line.startsWith('data: ')) {
    const data = line.slice(6);
    if (data === '[DONE]') return null;
    return data;
  }
  return null;
}
