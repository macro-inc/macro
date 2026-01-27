import FaviconSvg from '@macro-icons/macro-macro.svg?raw';
import FaviconBadgeSvg from '@macro-icons/macro-macro-badge.svg?raw';

const FAVICON_SIZE = 48;
const FAVICON_CHANNEL_NAME = 'macro-favicon-sync';

let currentFaviconLink: HTMLLinkElement | null = null;
let faviconBroadcastChannel: BroadcastChannel | null = null;

type FaviconMessage = {
  faviconColor: string;
  badgeColor?: string;
  hasBadge?: boolean;
};

function getBroadcastChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!faviconBroadcastChannel) {
    faviconBroadcastChannel = new BroadcastChannel(FAVICON_CHANNEL_NAME);
  }
  return faviconBroadcastChannel;
}

/**
 * Subscribe to favicon updates from other tabs.
 * Returns an unsubscribe function.
 */
export function subscribeFaviconUpdates(
  callback: (message: FaviconMessage) => void
): () => void {
  const channel = getBroadcastChannel();
  if (!channel) return () => {};

  const handler = (event: MessageEvent<FaviconMessage>) => {
    callback(event.data);
  };

  channel.addEventListener('message', handler);
  return () => channel.removeEventListener('message', handler);
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
 * @param color
 * @returns
 */
export function getFaviconUrl(color: string) {
  return processSvg(FaviconSvg, color);
}

/**
 * Update the site's live favicon with a new color, and optionally a notification
 * badge with its own color. Broadcasts the change to other tabs.
 */
export function updateFavicon(
  faviconColor: string,
  badgeColor?: string,
  hasBadge?: boolean
): void {
  updateFaviconInternal(faviconColor, badgeColor, hasBadge);

  // Broadcast to other tabs
  const channel = getBroadcastChannel();
  if (channel) {
    channel.postMessage({
      faviconColor,
      badgeColor,
      hasBadge,
    } as FaviconMessage);
  }
}

/**
 * Internal function to update favicon without broadcasting.
 * Used when receiving updates from other tabs.
 */
export function updateFaviconFromBroadcast(
  faviconColor: string,
  badgeColor?: string,
  hasBadge?: boolean
): void {
  updateFaviconInternal(faviconColor, badgeColor, hasBadge);
}

function updateFaviconInternal(
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
