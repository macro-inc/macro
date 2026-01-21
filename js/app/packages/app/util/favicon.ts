import FaviconURL from '@macro-icons/macro-macro.svg?url';
import FaviconBadgeURL from '@macro-icons/macro-macro-badge.svg?url';
import { getOklch } from '../../block-theme/utils/colorUtil';

let currentFaviconLink: HTMLLinkElement | null = null;

/** escapes a color value for use in SVG */
function escapeColorForSvg(color: string): string {
  return color.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** generates a favicon data URL for the given theme color */
export function getFaviconUrl(themeColor: string): string {
  const safeColor = escapeColorForSvg(themeColor);
  const svg = `<svg width="24" height="24" fill="${safeColor}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="m6.25 4.038-2.242 0.8792v5.8184l-1.756-1.6582-2.242 0.8792v6.6766c0 0.2568 0.106 0.502 0.292 0.6784l2.794 2.6422 2.244-0.879v-5.8184l7.084 6.6974 2.244-0.879v-5.8184l7.086 6.6976 2.24-0.8792v-6.6766c0-0.2568-0.104-0.5022-0.292-0.6784l-8.124-7.6816-2.244 0.879v5.8184z"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** updates the favicon with the current accent color */
export function updateFavicon(faviconColor: string, badgeColor?: string, hasBadge?: boolean): void {
  if (!faviconColor || typeof faviconColor !== 'string') {
    console.warn('Invalid theme color provided to updateFavicon:', faviconColor);
    return;
  }

  if (currentFaviconLink?.parentNode) {
    currentFaviconLink.parentNode.removeChild(currentFaviconLink);
    currentFaviconLink = null;
  }

  // Draw new favicon
  const faviconSize = 48;

  const canvas = document.createElement('canvas');
  canvas.width = faviconSize;
  canvas.height = faviconSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const img = new Image();

  let svgString = decodeURIComponent(
    (hasBadge ? FaviconBadgeURL : FaviconURL).replace('data:image/svg+xml,', '')
  );
  svgString = svgString.replace(/currentColor/g, escapeColorForSvg(faviconColor));
  const processedUrl = `data:image/svg+xml,${encodeURIComponent(svgString)}`;
  img.src = processedUrl;

  img.onload = () => {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    if (hasBadge) {
      const badgeRadius = 6;
      ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath();
      ctx.arc(
        canvas.width - badgeRadius,
        badgeRadius,
        badgeRadius,
        0,
        2 * Math.PI
      );
      const {l, c, h} = getOklch(badgeColor || faviconColor)
      ctx.fillStyle = `oklch(${l} ${c} ${h})`;
      ctx.fill();
    }

    const faviconUrl = canvas.toDataURL();

    // Remove old favicon if it exists
    if (currentFaviconLink?.parentNode) {
      currentFaviconLink.parentNode.removeChild(currentFaviconLink);
    }

    const existingLinks = document.querySelectorAll('link[rel*="icon"]');
    existingLinks.forEach((link) => {
      link.remove();
    });

    // Create and add new favicon
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/png';
    link.href = faviconUrl;
    document.head.appendChild(link);
    currentFaviconLink = link;

    // Update existing shortcut icon if present
    const existingShortcutIcon = document.querySelector(
      'link[rel="shortcut icon"]'
    ) as HTMLLinkElement;
    if (existingShortcutIcon) {
      existingShortcutIcon.href = faviconUrl;
    }
  };
}
