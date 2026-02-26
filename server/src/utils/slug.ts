/**
 * Generate a URL-friendly slug from a string.
 * Used to create IDs from service names.
 */
export function generateSlug(text: string): string {
  const normalizedNorwegian = text
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");

  return normalizedNorwegian
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

