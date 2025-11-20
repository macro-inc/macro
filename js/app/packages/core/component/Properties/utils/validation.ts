/**
 * Normalize a URL by adding https:// if no protocol is present
 */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';

  // Check if URL has a protocol
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  return trimmed;
}

/**
 * Validate if a string is a valid URL
 * Requires a proper domain with TLD (e.g., example.com)
 */
export function isValidUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);

    // Check if hostname has at least one dot (for TLD) or is localhost
    const hostname = urlObj.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return true;
    }

    // Must have at least one dot for TLD
    if (!hostname.includes('.')) {
      return false;
    }

    // Must have something before and after the dot
    const parts = hostname.split('.');
    if (parts.some((part) => part.length === 0)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}
