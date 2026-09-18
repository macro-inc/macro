/**
 * Queries and mutations for GTM invite links: the staff dashboard (create,
 * list, revoke), the public welcome page (resolve), and the signup handoff
 * (redeem, then the offer the plan step shows).
 */
import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/result';
import { authServiceClient } from '@service-auth/client';
import type { CreateGtmInviteLinkRequest } from '@service-auth/generated/schemas/createGtmInviteLinkRequest';
import type { GtmInviteLink } from '@service-auth/generated/schemas/gtmInviteLink';
import type { GtmInviteOffer } from '@service-auth/generated/schemas/gtmInviteOffer';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';

import { queryClient } from '../client';
import { type MutationCallbacks, withCallbacks } from '../utils';

import { gtmInviteKeys } from './keys';

export type { GtmInviteLink, GtmInviteOffer };

const LINKS_REFETCH_INTERVAL_MS = 30_000;
const OFFER_STALE_TIME_MS = 60_000;

/** Staff dashboard: every staff member's links, or just the caller's. */
export function useGtmInviteLinksQuery(mine: Accessor<boolean>) {
  return useQuery(() => ({
    queryKey: gtmInviteKeys.links(mine()).queryKey,
    queryFn: async () =>
      await throwOnErr(() =>
        authServiceClient.listGtmInviteLinks({ mine: mine() })
      ),
    // Opens and signups land server-side; keep the dashboard live.
    refetchInterval: LINKS_REFETCH_INTERVAL_MS,
  }));
}

export function invalidateGtmInviteLinks() {
  return queryClient.invalidateQueries({ queryKey: gtmInviteKeys.links._def });
}

type CreateLinkCallbacks = MutationCallbacks<
  GtmInviteLink,
  Error,
  CreateGtmInviteLinkRequest
>;

export function useCreateGtmInviteLinkMutation(
  callbacks?: CreateLinkCallbacks
) {
  return useMutation(() => ({
    mutationFn: async (args: CreateGtmInviteLinkRequest) =>
      await throwOnErr(() => authServiceClient.createGtmInviteLink(args)),
    ...withCallbacks<GtmInviteLink, Error, CreateGtmInviteLinkRequest>(
      {
        onSuccess: () => {
          invalidateGtmInviteLinks();
        },
        onError: (error) => {
          toast.failure(error.message || "Couldn't create the invite link");
        },
      },
      callbacks
    ),
  }));
}

type RevokeLinkArgs = { id: string };
type RevokeLinkCallbacks = MutationCallbacks<
  GtmInviteLink,
  Error,
  RevokeLinkArgs
>;

export function useRevokeGtmInviteLinkMutation(
  callbacks?: RevokeLinkCallbacks
) {
  return useMutation(() => ({
    mutationFn: async ({ id }: RevokeLinkArgs) =>
      await throwOnErr(() => authServiceClient.revokeGtmInviteLink(id)),
    ...withCallbacks<GtmInviteLink, Error, RevokeLinkArgs>(
      {
        onSuccess: () => {
          invalidateGtmInviteLinks();
          toast.success('Invite link revoked');
        },
        onError: (error) => {
          toast.failure(error.message || "Couldn't revoke the invite link");
        },
      },
      callbacks
    ),
  }));
}

/**
 * The public welcome page's view of a link. Every fetch counts as an "open"
 * on the dashboard, so the result is pinned for the page's lifetime.
 */
export function usePublicGtmInviteLinkQuery(
  token: Accessor<string | undefined>
) {
  return useQuery(() => ({
    queryKey: gtmInviteKeys.publicLink(token() ?? '').queryKey,
    queryFn: async () =>
      await throwOnErr(() =>
        authServiceClient.resolveGtmInviteLink(token() ?? '')
      ),
    enabled: !!token(),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  }));
}

/** The promotion the signed-in account holds from an invite link, or null. */
export function useGtmInviteOfferQuery(options?: { enabled?: () => boolean }) {
  return useQuery(() => ({
    queryKey: gtmInviteKeys.offer.queryKey,
    queryFn: async () =>
      await throwOnErr(() => authServiceClient.getGtmInviteOffer()),
    enabled: options?.enabled ? options.enabled() : true,
    staleTime: OFFER_STALE_TIME_MS,
  }));
}

export function invalidateGtmInviteOffer() {
  return queryClient.invalidateQueries({
    queryKey: gtmInviteKeys.offer.queryKey,
  });
}

type RedeemArgs = { token: string };
type RedeemCallbacks = MutationCallbacks<GtmInviteOffer, Error, RedeemArgs>;

export function useRedeemGtmInviteLinkMutation(callbacks?: RedeemCallbacks) {
  return useMutation(() => ({
    mutationFn: async ({ token }: RedeemArgs) =>
      await throwOnErr(() => authServiceClient.redeemGtmInviteLink(token)),
    ...withCallbacks<GtmInviteOffer, Error, RedeemArgs>(
      {
        onSuccess: () => {
          invalidateGtmInviteOffer();
        },
      },
      callbacks
    ),
  }));
}
