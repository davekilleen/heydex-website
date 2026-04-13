/**
 * Content sanitization to prevent XSS attacks
 * Removes dangerous HTML/JS patterns from user input
 */

export function sanitizeContent(content: string): string {
  if (!content) return "";

  let sanitized = content;

  // Remove script tags and content
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");

  // Remove iframe tags
  sanitized = sanitized.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "");

  // Remove javascript: protocols
  sanitized = sanitized.replace(/javascript:/gi, "");

  // Remove data: URIs (can contain encoded JS)
  sanitized = sanitized.replace(/data:text\/html/gi, "");

  // Remove on* event handlers (onclick, onerror, etc.)
  sanitized = sanitized.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, "");

  return sanitized;
}
