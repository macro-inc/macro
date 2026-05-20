import type { SplitManager } from '@app/component/split-layout/layoutManager';
import type { ListView } from '@app/constants/list-views';
import { globalSplitManager } from '@app/signal/splitLayout';
import { notificationToSidebarId } from '@app/util/notification-sidebar-id';
import { toast } from '@core/component/Toast/Toast';
import { isElementVisibleInViewport } from '@core/util/isElementVisibleInViewport';
import {
  getChannelNotificationParams,
  openNotification,
  type UnifiedNotification,
} from '@notifications';

const MAX_PULSES = 5;
const TOAST_DURATION = 6000;

// For new_email, the split is opened with threadId from metadata, not entity_id.
function getSplitEntityId(n: UnifiedNotification): string {
  const meta = n.notification_metadata;
  if (meta.tag === 'new_email') return meta.content.threadId;
  return n.entity_id;
}

function pulseElement(el: Element): void {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  const isSlimSidebar = !!el.closest('[data-slim="true"]');
  const glowExtension = isSlimSidebar ? 60 : 0;

  const accentBg = 'oklch(var(--a0l) var(--a0c) var(--a0h) / 0.25)';
  const background = isSlimSidebar
    ? `linear-gradient(to right, ${accentBg} ${rect.width}px, transparent ${rect.width + glowExtension}px)`
    : accentBg;

  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed',
    top: `${rect.top}px`,
    left: `${rect.left}px`,
    width: `${rect.width + glowExtension}px`,
    height: `${rect.height}px`,
    background,
    borderRadius: isSlimSidebar ? '4px 0 0 4px' : '4px',
    pointerEvents: 'none',
    zIndex: '2147483647',
  });
  document.body.appendChild(overlay);

  const reducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)'
  ).matches;

  const keyframes: Keyframe[] = reducedMotion
    ? [{ opacity: '0.6' }, { opacity: '0' }]
    : [
        { opacity: '0.4', transform: 'scale(1.04)', offset: 0 },
        { opacity: '0.8', transform: 'scale(1)', offset: 0.07 },
        { opacity: '0', transform: 'scale(1)', offset: 1 },
      ];

  overlay
    .animate(keyframes, {
      duration: reducedMotion ? 400 : 3000,
      easing: 'ease-out',
      fill: 'forwards',
    })
    .addEventListener('finish', () => overlay.remove());
}

type ToastSection = ListView | 'unknown';

const TOAST_LABEL: Partial<Record<ToastSection, string>> = {
  channels: 'message',
  mail: 'email',
  tasks: 'task',
  documents: 'document update',
  agents: 'agent response',
  unknown: 'notification',
};

function buildToastMessage(countsBySection: Map<ToastSection, number>): string {
  const parts: string[] = [];
  for (const [type, count] of countsBySection.entries()) {
    const label = TOAST_LABEL[type] ?? 'notification';
    parts.push(`${count} new ${label}${count > 1 ? 's' : ''}`);
  }
  return parts.join(', ');
}

// Returns true if the notification was handled (element pulsed, or already pulsed
// by an earlier notification in this batch). Returns false only when the global
// pulse cap was hit — in that case the caller should fall through to the toast bucket.
function tryPulse(
  el: Element,
  pulsed: Set<Element>,
  pulseCount: { value: number }
): boolean {
  if (pulsed.has(el)) return true;
  if (pulseCount.value >= MAX_PULSES) return false;
  pulsed.add(el);
  pulseCount.value++;
  pulseElement(el);
  return true;
}

export function runRefocusPulses(
  notifications: UnifiedNotification[],
  splitManager: SplitManager | undefined
): void {
  if (notifications.length === 0) return;

  const pulsed = new Set<Element>();
  const pulseCount = { value: 0 };
  const toastBucket: UnifiedNotification[] = [];

  for (const notification of notifications) {
    // Rule 1: channel message bubble
    const { messageId } = getChannelNotificationParams(notification);
    if (messageId) {
      const msgEl = document.querySelector(
        `[data-message-id="${CSS.escape(messageId)}"]`
      );
      if (msgEl instanceof HTMLElement && isElementVisibleInViewport(msgEl)) {
        if (!tryPulse(msgEl, pulsed, pulseCount))
          toastBucket.push(notification);
        continue;
      }
    }

    // Rule 2: a split is open for this entity → pulse the header
    if (splitManager) {
      const entityIdForSplit = getSplitEntityId(notification);
      const matchingSplit = splitManager
        .splits()
        .find(
          (s) =>
            s.content.id === entityIdForSplit && s.content.type !== 'component'
        );
      if (matchingSplit) {
        const containerEl = document.querySelector(
          `[data-split-id="${CSS.escape(matchingSplit.id)}"] [data-split-header]`
        );
        if (containerEl) {
          if (!tryPulse(containerEl, pulsed, pulseCount))
            toastBucket.push(notification);
          continue;
        }
      }
    }

    // Rule 3: generic entity row visible in the soup/list view
    const entityEl = document.querySelector(
      `[data-entity-id="${CSS.escape(notification.entity_id)}"]`
    );
    if (
      entityEl instanceof HTMLElement &&
      isElementVisibleInViewport(entityEl)
    ) {
      if (!tryPulse(entityEl, pulsed, pulseCount))
        toastBucket.push(notification);
      continue;
    }

    // Rule 4: unread sidebar item (e.g. channel/DM entry in the Unread widget)
    const unreadEl = document.querySelector(
      `[data-unread-entity-id="${CSS.escape(notification.entity_id)}"]`
    );
    if (unreadEl) {
      if (!tryPulse(unreadEl, pulsed, pulseCount))
        toastBucket.push(notification);
      continue;
    }

    // Rule 5: type-specific sidebar nav entry (never inbox)
    const sidebarId = notificationToSidebarId(notification);
    if (sidebarId) {
      const sidebarEl = document.querySelector(
        `[data-sidebar-link="${sidebarId}"]`
      );
      if (sidebarEl) {
        if (!tryPulse(sidebarEl, pulsed, pulseCount))
          toastBucket.push(notification);
        continue;
      }
    }

    // Rule 6: no visible affordance — falls through to grouped toast
    toastBucket.push(notification);
  }

  if (toastBucket.length === 0) return;

  const countsBySection = new Map<ToastSection, number>();
  let mostRecent = toastBucket[0]!;
  for (const n of toastBucket) {
    const key: ToastSection = notificationToSidebarId(n) ?? 'unknown';
    countsBySection.set(key, (countsBySection.get(key) ?? 0) + 1);
    if (n.created_at > mostRecent.created_at) mostRecent = n;
  }

  toast.custom(
    {
      title: buildToastMessage(countsBySection),
      actions: [
        {
          label: 'View',
          onClick: () => {
            // Re-read the split manager at click time — the layout may have
            // changed between toast creation and the user clicking "View".
            const manager = globalSplitManager();
            if (manager) openNotification(mostRecent, manager);
          },
        },
      ],
    },
    { duration: TOAST_DURATION }
  );
}
