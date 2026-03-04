export type BeskrivelseRepresentations = {
  beskrivelse: string;
  beskrivelse_plain_text: string;
  beskrivelse_rich_base64: string;
};

export function encodeUtf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export function decodeBase64ToUtf8(value?: string): string {
  if (!value) {
    return "";
  }
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

export function stripRichTextToPlainText(value: string): string {
  const withBreaks = value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n");
  const doc = new DOMParser().parseFromString(withBreaks, "text/html");
  return (doc.body.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function plainTextToRichHtml(value: string): string {
  if (!value) {
    return "";
  }
  return escapeHtml(value).replace(/\r\n/g, "\n").replace(/\n/g, "<br>");
}

export function normalizeBeskrivelseRepresentations(input: {
  beskrivelse?: string;
  beskrivelse_plain_text?: string;
  beskrivelse_rich_base64?: string;
}): BeskrivelseRepresentations {
  const decodedRich = decodeBase64ToUtf8(input.beskrivelse_rich_base64);
  const plainFromRich = decodedRich ? stripRichTextToPlainText(decodedRich) : "";
  const plain = input.beskrivelse_plain_text || input.beskrivelse || plainFromRich || "";
  const richHtml = decodedRich || plainTextToRichHtml(plain);

  return {
    beskrivelse: plain,
    beskrivelse_plain_text: plain,
    beskrivelse_rich_base64: encodeUtf8ToBase64(richHtml),
  };
}

export function resolveRichHtml(input: {
  beskrivelse?: string;
  beskrivelse_plain_text?: string;
  beskrivelse_rich_base64?: string;
}): string {
  const decodedRich = decodeBase64ToUtf8(input.beskrivelse_rich_base64);
  if (decodedRich) {
    return decodedRich;
  }
  return plainTextToRichHtml(input.beskrivelse_plain_text || input.beskrivelse || "");
}

export function normalizeRichTextFromLegacyArray(input: {
  plain_text?: string;
  rich_base64?: string;
  legacy_array?: string[];
}): {
  plain_text: string;
  rich_base64: string;
  legacy_array?: string[];
} {
  const decodedRich = decodeBase64ToUtf8(input.rich_base64);
  const plainFromRich = decodedRich ? stripRichTextToPlainText(decodedRich) : "";
  const legacyText = (input.legacy_array || []).join("\n\n");
  const plain = input.plain_text || legacyText || plainFromRich || "";
  const richHtml = decodedRich || plainTextToRichHtml(plain);

  return {
    plain_text: plain,
    rich_base64: encodeUtf8ToBase64(richHtml),
    legacy_array: plain.trim() ? [plain] : undefined,
  };
}

export function resolveRichHtmlFromLegacyArray(input: {
  plain_text?: string;
  rich_base64?: string;
  legacy_array?: string[];
}): string {
  const decodedRich = decodeBase64ToUtf8(input.rich_base64);
  if (decodedRich) {
    return decodedRich;
  }
  const plain = input.plain_text || (input.legacy_array || []).join("\n\n") || "";
  return plainTextToRichHtml(plain);
}
