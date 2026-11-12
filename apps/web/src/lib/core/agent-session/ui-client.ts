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
 * The id to send with a prompt typed in this tab: none while agent navigation
 * is off, so the harness records no tab for the turn.
 */
export function typedInClientId(): string | undefined {
  if (!isFeatureEnabled(enableAgentNavigation)) return undefined;

  return uiClientId();
}
