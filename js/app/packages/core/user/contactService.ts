import { ENABLE_CONTACTS } from '@core/constant/featureFlags';
import type { IUser } from '@core/user';
import { idToDisplayName, idToEmail } from '@core/user';
import { isErr } from '@core/util/maybeResult';
import { contactsClient } from '@service-contacts/client';
import { createSingletonRoot } from '@solid-primitives/rootless';
import { createMemo, createResource } from 'solid-js';

async function getContacts() {
  if (!ENABLE_CONTACTS) {
    console.error('Contacts disabled, returning empty list');
    return [];
  }

  const result = await contactsClient.getContacts();
  if (isErr(result)) {
    console.error('Failed to get users', result);
    return [];
  }
  const [, data] = result;
  const { contacts } = data;

  return contacts;
}

const contactsResource = createSingletonRoot(() =>
  createResource(getContacts, {
    initialValue: [],
  })
);

export function useContacts() {
  const [resource] = contactsResource();
  return createMemo<IUser[]>(() => {
    const result = resource.latest;
    return result.map((c) => ({
      id: c,
      email: idToEmail(c),
      name: idToDisplayName(c),
    }));
  });
}

export async function refetchContacts(force = false) {
  const [resource, { refetch }] = contactsResource();
  if (force) return refetch();
  if (resource.loading) return resource.latest;
  return refetch();
}
