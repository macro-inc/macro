import { useEmailLinksContext } from '@core/context/emailLinks';
import { ApiLabelType } from '@service-email/generated/schemas';
import type { GraphqlEmailProvider } from '@service-storage/graphql/generated/graphql';
import { type Accessor, createMemo } from 'solid-js';
import { queryReadyGate } from '../gate';
import { useEmailUserLabelsQuery } from './labels';
import { formatLabelPath, nestLabels } from './nested-labels';

/** What a label is called where it shows. */
export type LabelNames = {
  /** A nested label's own name ("Larkspur"), for rows and pills. */
  name: string;
  /** Its whole name ("Customers / Larkspur"), for hover cards and menus. */
  fullName: string;
};

/** A label of one of the viewer's inboxes, as their label list holds it. */
type InboxLabel = { id: string; linkId: string; name: string };

/** A label as a thread or a row carries it. */
type CarriedLabel = {
  id: string;
  linkId: string;
  name: string;
  type: string;
  messageListVisibility: string;
};

/** A label someone made, named as it shows, in the inbox that holds it. */
export type ShownLabel = LabelNames & { id: string; linkId: string };

/** Each label's names, nested within its own inbox. */
export function labelNamesOf(
  labels: readonly InboxLabel[],
  providerOf: (linkId: string) => GraphqlEmailProvider | undefined
): Map<string, LabelNames> {
  const byInbox = new Map<string, InboxLabel[]>();
  for (const label of labels) {
    const inbox = byInbox.get(label.linkId);
    if (inbox) inbox.push(label);
    else byInbox.set(label.linkId, [label]);
  }
  const names = new Map<string, LabelNames>();
  for (const [linkId, inboxLabels] of byInbox) {
    const provider = providerOf(linkId) ?? 'GMAIL';
    for (const nested of nestLabels(inboxLabels, provider)) {
      names.set(nested.label.id, {
        name: nested.leaf,
        fullName: formatLabelPath(nested.path),
      });
    }
  }
  return names;
}

/** Whether a thread shows this label: one people made, not hidden by Gmail. */
export function isShownLabel(label: CarriedLabel): boolean {
  return (
    label.type.toLowerCase() === 'user' &&
    label.messageListVisibility.toLowerCase() !== 'hide'
  );
}

/**
 * The labels a thread shows: the ones people made, and not the ones Gmail
 * hides from the message list. Until the inbox's labels have loaded, both
 * names are the stored name.
 */
export function shownLabelsOf(
  labels: readonly CarriedLabel[],
  names: ReadonlyMap<string, LabelNames>
): ShownLabel[] {
  return labels.filter(isShownLabel).map((label) => {
    const known = names.get(label.id);
    return {
      id: label.id,
      linkId: label.linkId,
      name: known?.name ?? label.name,
      fullName: known?.fullName ?? label.name,
    };
  });
}

/**
 * The names of every label in the viewer's inboxes, from one read of their
 * labels while `enabled`. Never suspends.
 */
export function useEmailLabelNames(enabled: Accessor<boolean> = () => true) {
  const catalog = useEmailUserLabelsQuery(enabled);
  const { links } = useEmailLinksContext();
  const made = () =>
    queryReadyGate(catalog)
      ? catalog.data.labels.filter((label) => label.type === ApiLabelType.User)
      : [];
  return createMemo(() =>
    labelNamesOf(
      made(),
      (linkId) => links().find((link) => link.id === linkId)?.provider
    )
  );
}
