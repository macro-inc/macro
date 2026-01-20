import { useIsOrganizationMember } from '@core/auth';
import {
  type IOrganizationUser,
  type IUser,
  idToDisplayName,
} from '@core/user';
import { isErr } from '@core/util/maybeResult';
import { useOrganizationQuery } from '@queries/auth';
import { organizationServiceClient } from '@service-organization/client';
import { createSingletonRoot } from '@solid-primitives/rootless';
import { createMemo, createResource } from 'solid-js';

const USERS_PER_PAGE = 50;

async function getPaginatedUsers() {
  let allUsers: IOrganizationUser[] = [];
  const result = await organizationServiceClient.getUsers({
    limit: USERS_PER_PAGE,
    offset: 0,
  });
  if (isErr(result)) {
    console.error('Failed to get users', result);
    return [];
  }
  const [, data] = result;
  let { next_offset: nextOffset, users } = data;

  allUsers = [...allUsers, ...users];

  if (nextOffset === 0) return allUsers;

  while (nextOffset > 0) {
    const result = await organizationServiceClient.getUsers({
      limit: USERS_PER_PAGE,
      offset: nextOffset,
    });
    if (isErr(result)) {
      console.error('Failed to get users', result);
      return [];
    }
    const [, data] = result;
    const { next_offset, users } = data;
    nextOffset = next_offset;
    allUsers = [...allUsers, ...users];
  }

  return allUsers;
}

const organizationResource = createSingletonRoot(() =>
  createResource(
    () => {
      const isOrganizationMember = useIsOrganizationMember();
      if (!isOrganizationMember()) return [];
      return getPaginatedUsers();
    },
    {
      initialValue: [],
    }
  )
);

export function useOrganizationUsers() {
  const [resource] = organizationResource();
  return createMemo<IUser[]>(() => {
    const result = resource.latest;
    const users = result.map((user) => ({
      id: user.id,
      email: user.email,
      name: idToDisplayName(user.id),
    }));

    return users;
  });
}

export function useOrganizationName() {
  const organizationQuery = useOrganizationQuery();
  return createMemo((): string | undefined => {
    if (organizationQuery.isLoading) return undefined;
    if (!organizationQuery.data) return undefined;

    return organizationQuery.data.organizationName;
  });
}

export function useOrganizationId() {
  const organizationQuery = useOrganizationQuery();
  return createMemo((): string | undefined => {
    if (organizationQuery.isLoading) return undefined;
    if (!organizationQuery.data) return undefined;

    return organizationQuery.data.organizationId;
  });
}
