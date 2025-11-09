import { ENABLE_CONTACTS } from '@core/constant/featureFlags';
import type { IUser } from '@core/user';
import { idToDisplayName, idToEmail } from '@core/user';
import { isErr } from '@core/util/maybeResult';
import { createSingletonRoot } from '@solid-primitives/rootless';
import { createMemo, createResource } from 'solid-js';
import { contactsClient } from '../../service-contacts/client';

async function getContacts() {
  let allContacts: IUser[] = [];

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

  allContacts = contacts.map((id) => {
    return {
      id: id,
      email: idToEmail(id),
      name: idToDisplayName(id),
    };
  });

  return allContacts;
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
    return result ?? [];
  });
}

export async function refetchContacts(force = false) {
  const [resource, { refetch }] = contactsResource();
  if (force) return refetch();
  if (resource.loading) return resource.latest;
  return refetch();
}
