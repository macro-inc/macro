/**
 * This tab's id, sent with the prompts typed in it so what an agent opens for
 * the person (`macro.ui.open`) reaches this tab and no other. Kept in
 * sessionStorage, so a reload or a reconnect keeps it; another tab mints its
 * own. It names a tab, not a person, and grants nothing.
 */

import {
  enableAgentNavigation,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { isMobile } from '@core/mobile/isMobile';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { z } from 'zod';

const STORAGE_KEY = 'macro.ui-client-id';

const storedId = z.uuid();

let current: string | undefined;

function readStored(): string | undefined {
  try {
    const parsed = storedId.safeParse(sessionStorage.getItem(STORAGE_KEY));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function store(id: string) {
  try {
    sessionStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Storage blocked: the id lasts as long as this page.
  }
}

/** This tab's id, minted on first use. */
export function uiClientId(): string {
  if (current) return current;

  current = readStored() ?? crypto.randomUUID();
  store(current);
  return current;
}

/**
 * Whether agent navigation runs in this tab. It never runs on mobile: the
 * native iOS and Android apps (iPad included, where panes stack) and
 * phone-size touch browsers. There the tab names itself to no one and applies
 * no `ui_command`, so an agent's open answers `no_client` and the agent links
 * the item in its reply instead.
 */
export function agentNavigationRunsHere(): boolean {
  return !isNativeMobilePlatform() && !isMobile();
}

/**
 * The id to send with a prompt typed in this tab: none while agent navigation
 * is off or on mobile, so the harness records no tab for the turn.
 */
export function typedInClientId(): string | undefined {
  if (!isFeatureEnabled(enableAgentNavigation)) return undefined;
  if (!agentNavigationRunsHere()) return undefined;

  return uiClientId();
}
