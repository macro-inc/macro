import { throwOnErr } from '@core/util/result';
import { emailClient } from '@service-email/client';
import type { ListLabelsResponse } from '@service-email/generated/schemas';
import { useQuery } from '@tanstack/solid-query';
import { emailKeys } from './keys';

/**
 * A provider label: a Gmail label or an Outlook category. REST spells its
 * enums `User`/`LabelHide`/`Hide`, GraphQL `user`/`label_hide`/`hide`.
 */
type ProviderLabel = {
  name: string;
  type: string;
  labelListVisibility: string;
  messageListVisibility: string;
};

const isUserLabel = (label: ProviderLabel) =>
  label.type === 'User' || label.type === 'user';

const sortedNames = (labels: readonly ProviderLabel[]) =>
  [...new Set(labels.map((label) => label.name))].sort((a, b) =>
    a.localeCompare(b)
  );

/** Labels the viewer made, by name, as the provider lists them in its sidebar. */
export function listedLabelNames(labels: readonly ProviderLabel[]): string[] {
  return sortedNames(
    labels.filter(
      (label) =>
        isUserLabel(label) &&
        label.labelListVisibility !== 'LabelHide' &&
        label.labelListVisibility !== 'label_hide'
    )
  );
}

/** Labels the viewer made, by name, as the provider shows them on messages. */
export function shownLabelNames(labels: readonly ProviderLabel[]): string[] {
  return sortedNames(
    labels.filter(
      (label) =>
        isUserLabel(label) &&
        label.messageListVisibility !== 'Hide' &&
        label.messageListVisibility !== 'hide'
    )
  );
}

const LABELS_STALE_TIME = 5 * 60_000;

const fetchLabels = () => throwOnErr(() => emailClient.getUserLabels());

const selectListedNames = (response: ListLabelsResponse) =>
  listedLabelNames(response.labels);

const selectShownNames = (response: ListLabelsResponse) =>
  new Set(shownLabelNames(response.labels));

function emailLabelNamesQueryOptions() {
  return {
    queryKey: emailKeys.labels.queryKey,
    queryFn: fetchLabels,
    select: selectListedNames,
    staleTime: LABELS_STALE_TIME,
  };
}

function shownEmailLabelNamesQueryOptions() {
  return {
    queryKey: emailKeys.labels.queryKey,
    queryFn: fetchLabels,
    select: selectShownNames,
    staleTime: LABELS_STALE_TIME,
  };
}

/**
 * Label names across every connected inbox, for filtering and the sidebar.
 * Inboxes can share a name; a filter by name matches each inbox's label.
 */
export function useEmailLabelNamesQuery() {
  return useQuery(emailLabelNamesQueryOptions);
}

/**
 * Names of the labels that show on messages. Message labels carry only a name,
 * so this tells user labels apart from system ones such as INBOX.
 */
export function useShownEmailLabelNamesQuery() {
  return useQuery(shownEmailLabelNamesQueryOptions);
}
