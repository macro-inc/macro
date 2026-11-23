import {
  normalizeUserNameQueryId,
  USER_NAME_CACHE_LIMITS,
} from '@queries/auth/user-name-cache';
import { userNameCache } from '@queries/auth/user-name-cache-runtime';
import { getOwner, onCleanup } from 'solid-js';
import { type MacroId, macroIdToEmail } from './macroId';
import type { UserNameItem, UserNamePreviewFetcher } from './types';

/** Initials from structured names, falling back to the email's first letter. */
export function getInitials(
  firstName: string,
  lastName: string,
  email: string
): string {
  const first = firstName.trim();
  const last = lastName.trim();
  if (first && last) return (first[0] + last[0]).toUpperCase();
  if (first) return first[0].toUpperCase();
  return email.substring(0, 1).toUpperCase();
}

/** First/last tokens of a free-form label, preserving the email fallback. */
export function getInitialsFromName(
  name: string | null | undefined,
  email: string
): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return getInitials(
    parts[0] ?? '',
    parts.length > 1 ? (parts.at(-1) ?? '') : '',
    email
  );
}

type DisplayNameOptions = { emailFallback?: 'full' | 'local-part' };
type DisplayNamePartStrings = {
  firstName: string;
  lastName: string;
  fullName: string;
};

function fallbackItem(id: MacroId): UserNameItem {
  return { id, loading: false, _createdAt: new Date(0) };
}
function getUserNameItem(id: MacroId): UserNameItem {
  const value = userNameCache().read(id);
  return {
    id,
    loading: value.loading,
    _createdAt: new Date(value.updatedAt),
    firstName: value.name?.first_name ?? undefined,
    lastName: value.name?.last_name ?? undefined,
    isAgent: value.name?.is_agent,
  };
}
function display(
  item: UserNameItem,
  id: MacroId,
  options?: DisplayNameOptions
): string {
  const email = macroIdToEmail(id);
  const fallback =
    options?.emailFallback === 'local-part'
      ? email.split('@')[0] || email
      : email;
  if (item.loading) return fallback;
  const parts = [item.firstName, item.lastName].filter(
    (value) => value && value !== 'N/A'
  );
  return parts.length ? parts.join(' ') : fallback;
}

/** Reactive, non-suspending reads of the account-scoped bounded query cache. */
export function getDisplayName(
  id: MacroId | undefined | null,
  options?: DisplayNameOptions
): string {
  return id ? display(getUserNameItem(id), id, options) : '';
}
/** Agent metadata shares the same bounded, account-scoped name value owner. */
export function isAgentAccount(id: MacroId | undefined | null): boolean {
  return !!id && getUserNameItem(id).isAgent === true;
}

export function getDisplayNameParts(
  id: MacroId | undefined | null,
  options?: DisplayNameOptions
): DisplayNamePartStrings {
  if (!id) return { firstName: '', lastName: '', fullName: '' };
  const item = getUserNameItem(id);
  return {
    firstName:
      !item.loading && item.firstName && item.firstName !== 'N/A'
        ? item.firstName
        : '',
    lastName:
      !item.loading && item.lastName && item.lastName !== 'N/A'
        ? item.lastName
        : '',
    fullName: display(item, id, options),
  };
}
function useUserNameItem(id: MacroId) {
  getUserNameItem(id);
  const controls = userNameCache().control(id);
  let active = true;
  if (getOwner())
    onCleanup(() => {
      active = false;
    });
  return {
    getItem: () => (active ? getUserNameItem(id) : fallbackItem(id)),
    refetch: controls.refetch,
    mutate: (value: UserNameItem) => {
      if (normalizeUserNameQueryId(value.id) !== normalizeUserNameQueryId(id))
        return;
      if (value.loading) controls.refetch();
      else
        controls.mutate({
          id: value.id,
          first_name: value.firstName,
          last_name: value.lastName,
          is_agent: value.isAgent,
        });
    },
  };
}

type DisplayNameParts = {
  firstName: () => string;
  lastName: () => string;
  fullName: () => string;
  refetch: () => void;
};
/** @deprecated Prefer getDisplayNameParts inside a reactive accessor for changing IDs. */
export function useDisplayNameParts(
  id: MacroId | undefined | null,
  options?: DisplayNameOptions
): DisplayNameParts {
  if (!id)
    return {
      firstName: () => '',
      lastName: () => '',
      fullName: () => '',
      refetch: () => {},
    };
  const { getItem, refetch } = useUserNameItem(id);
  return {
    firstName: () => {
      const item = getItem();
      return !item.loading && item.firstName && item.firstName !== 'N/A'
        ? item.firstName
        : '';
    },
    lastName: () => {
      const item = getItem();
      return !item.loading && item.lastName && item.lastName !== 'N/A'
        ? item.lastName
        : '';
    },
    fullName: () => display(getItem(), id, options),
    refetch,
  };
}
/** @deprecated Prefer getDisplayName inside a reactive accessor for changing IDs. */
export function useDisplayName(
  id: MacroId | undefined | null,
  options?: DisplayNameOptions
): UserNamePreviewFetcher {
  if (!id) return [() => '', { refetch: () => {}, mutate: () => {} }];
  const { getItem, refetch, mutate } = useUserNameItem(id);
  return [() => display(getItem(), id, options), { refetch, mutate }];
}

/** Seed only the current authenticated session; call from a mounted debug view,
 * never module initialization. Seeds cannot create membership or name evidence. */
export function seedMockDisplayNames(
  users: Array<{ id: string; firstName?: string; lastName?: string }>
) {
  if (users.length > USER_NAME_CACHE_LIMITS.batch)
    throw new Error('Too many mock names');
  const cache = userNameCache();
  for (const user of users)
    cache.control(user.id).mutate({
      id: user.id,
      first_name: user.firstName,
      last_name: user.lastName,
    });
}
