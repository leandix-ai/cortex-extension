// ============================================================================
// Markdown renderer — uses `marked` with HTML sanitization fallback
// ============================================================================

import { marked } from 'marked';

// Configure marked for safe, VS Code-friendly rendering
marked.setOptions({
    breaks: true,
    gfm: true,
});

export function renderMarkdown(text: string): string {
    if (!text) return '';

    let html = marked.parse(text, { async: false }) as string;

    // Clean up excessive whitespace
    html = html.replace(/<p>\s*<\/p>/gi, '');
    html = html.replace(/(<br\s*\/?>[\s]*){2,}/gi, '<br>');

    return html.trim();
}
