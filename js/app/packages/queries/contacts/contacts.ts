import { throwOnErr } from "@core/util/maybeResult";
import { contactsKeys } from "./keys";
import { contactsClient } from "@service-contacts/client";
import { useQuery } from "@tanstack/solid-query";
import { queryClient } from "@queries/client";

function contactsQueryOptions() {
  return {
    queryKey: contactsKeys.all.queryKey,
    queryFn: () => throwOnErr(() => contactsClient.getContacts()),
  }
}

export function useContactsQuery() {
  return useQuery(() => contactsQueryOptions());
}

export function invalidateContacts() {
  return queryClient.invalidateQueries(contactsQueryOptions());
}
