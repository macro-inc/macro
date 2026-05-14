import FaviconSvg from '@macro-icons/macro-logo.svg?raw';
import FaviconBadgeSvg from '@macro-icons/macro-logo-badge.svg?raw';

const FAVICON_SIZE = 48;

let currentFaviconLink: HTMLLinkElement | null = null;

/** escapes a color value for use in SVG */
function escapeColorForSvg(color: string): string {
  return color.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** insert color and url encode SVG */
function processSvg(svg: string, color: string) {
  return `data:image/svg+xml,${encodeURIComponent(svg.replace(/currentColor/g, escapeColorForSvg(color)))}`;
}

/**
 * Return a data url for the macro logo svg filled with the given color.
 */
export function getFaviconUrl(color: string) {
  return processSvg(FaviconSvg, color);
}

/**
 * Update the site's live favicon with a new color, and optionally a notification
 * badge with its own color.
 */
export function updateFavicon(
  faviconColor: string,
  badgeColor?: string,
  hasBadge?: boolean
): void {
  if (currentFaviconLink?.parentNode) {
    currentFaviconLink.parentNode.removeChild(currentFaviconLink);
    currentFaviconLink = null;
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  canvas.width = FAVICON_SIZE;
  canvas.height = FAVICON_SIZE;

  const img = new Image();
  img.src = processSvg(hasBadge ? FaviconBadgeSvg : FaviconSvg, faviconColor);

  img.onload = () => {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    if (hasBadge) {
      const badgeRadius = 6;
      ctx.beginPath();
      ctx.arc(
        canvas.width - badgeRadius,
        badgeRadius,
        badgeRadius,
        0,
        2 * Math.PI
      );
      ctx.fillStyle = badgeColor || faviconColor;
      ctx.fill();
    }

    const faviconUrl = canvas.toDataURL();

    if (currentFaviconLink?.parentNode) {
      currentFaviconLink.parentNode.removeChild(currentFaviconLink);
    }

    const existingLinks = document.querySelectorAll('link[rel*="icon"]');
    existingLinks.forEach((link) => {
      link.remove();
    });

    // create and add new favicon
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/png';
    link.href = faviconUrl;
    document.head.appendChild(link);
    currentFaviconLink = link;

    // update existing shortcut icon if present
    const existingShortcutIcon = document.querySelector(
      'link[rel="shortcut icon"]'
    ) as HTMLLinkElement;
    if (existingShortcutIcon) {
      existingShortcutIcon.href = faviconUrl;
    }
  };
}
