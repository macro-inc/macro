import FaviconSvg from '@icon/macro-logo.svg?raw';
import FaviconBadgeSvg from '@icon/macro-logo-badge.svg?raw';

const FAVICON_SIZE = 48;

let currentFaviconLink: HTMLLinkElement | null = null;
let requestedIcon = '';
const renderedIcons = new Map<string, string>();

function setFavicon(url: string): void {
  if (!currentFaviconLink?.isConnected) {
    document
      .querySelectorAll('link[rel*="icon"]')
      .forEach((link) => link.remove());
    currentFaviconLink = document.createElement('link');
    currentFaviconLink.rel = 'icon';
    currentFaviconLink.type = 'image/png';
    document.head.appendChild(currentFaviconLink);
  }
  currentFaviconLink.href = url;
}

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
  const key = JSON.stringify([faviconColor, badgeColor, !!hasBadge]);
  if (key === requestedIcon && currentFaviconLink?.isConnected) return;
  requestedIcon = key;
  const cached = renderedIcons.get(key);
  if (cached) {
    setFavicon(cached);
    return;
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  canvas.width = FAVICON_SIZE;
  canvas.height = FAVICON_SIZE;

  const img = new Image();
  img.src = processSvg(hasBadge ? FaviconBadgeSvg : FaviconSvg, faviconColor);

  img.onload = () => {
    if (requestedIcon !== key) return;
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

    if (renderedIcons.size >= 32)
      renderedIcons.delete(renderedIcons.keys().next().value!);
    renderedIcons.set(key, faviconUrl);
    setFavicon(faviconUrl);
  };
}
