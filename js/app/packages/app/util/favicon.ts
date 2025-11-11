let currentFaviconLink: HTMLLinkElement | null = null;

/** escapes a color value for use in SVG */
function escapeColorForSvg(color: string): string {
  return color.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** updates the favicon with the current accent color */
export function updateFavicon(themeColor: string): void {
  if (!themeColor || typeof themeColor !== 'string') {
    console.warn('Invalid theme color provided to updateFavicon:', themeColor);
    return;
  }

  if (currentFaviconLink && currentFaviconLink.parentNode) {
    currentFaviconLink.parentNode.removeChild(currentFaviconLink);
    currentFaviconLink = null;
  }

  const safeColor = escapeColorForSvg(themeColor);

  const svg = `<svg width="24" height="24" fill="${safeColor}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="m6.25 4.038-2.242 0.8792v5.8184l-1.756-1.6582-2.242 0.8792v6.6766c0 0.2568 0.106 0.502 0.292 0.6784l2.794 2.6422 2.244-0.879v-5.8184l7.084 6.6974 2.244-0.879v-5.8184l7.086 6.6976 2.24-0.8792v-6.6766c0-0.2568-0.104-0.5022-0.292-0.6784l-8.124-7.6816-2.244 0.879v5.8184z"/></svg>`;
  const faviconUrl = `data:image/svg+xml,${encodeURIComponent(svg)}`;

  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/svg+xml';
  link.href = faviconUrl;

  document.head.appendChild(link);
  currentFaviconLink = link;

  const existingShortcutIcon = document.querySelector(
    'link[rel="shortcut icon"]'
  ) as HTMLLinkElement;
  if (existingShortcutIcon) {
    existingShortcutIcon.href = faviconUrl;
  }
}
