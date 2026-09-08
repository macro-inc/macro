import { type Accessor, createMemo, createSignal, mapArray } from 'solid-js';
import type {
  ActivityContext,
  EntityDisplay,
  OpenEntityTarget,
} from '../context/activity-context';
import {
  collectNetworkItems,
  entityKey,
  layoutActivityNetwork,
  mergeActivityEvents,
  type NetworkKind,
  type NetworkSelection,
  networkActionLabel,
} from '../core/activity-network';
import {
  connectEmailParticipants,
  type EmailNetworkPerson,
} from '../core/email-network';
import {
  type ActivityEvent,
  type ActivityTopEntity,
  toPropertyEntityType,
} from '../core/event';
import { createWorkDetailsQuery } from '../queries/work-details-query';
import {
  createRelatedActivityQuery,
  createWorkspaceActivityQuery,
} from '../queries/workspace-activity-query';

export function createActivityNetworkState(
  context: ActivityContext,
  ownEvents: Accessor<ActivityEvent[]>,
  topEntities: Accessor<ActivityTopEntity[]>
) {
  const [scope, setScope] = createSignal<'workspace' | 'mine'>('workspace');
  const [period, setPeriod] = createSignal<'30' | '7' | 'all'>('30');
  const [kind, setKind] = createSignal<NetworkKind | 'all'>('all');
  const [focus, setFocus] = createSignal<'all' | 'unanswered' | 'shared'>(
    'all'
  );
  const [search, setSearch] = createSignal('');
  const [selection, setSelection] = createSignal<NetworkSelection>();
  const roster = context.workspacePeople?.();
  const memberIds = () => roster?.memberIds() ?? [];
  const workspace = createWorkspaceActivityQuery(
    context,
    () => scope() === 'workspace'
  );
  const relatedEntities = createMemo(() => {
    const entities = new Map<
      string,
      Pick<ActivityTopEntity, 'entityId' | 'entityType'>
    >();
    for (const entity of [...topEntities(), ...ownEvents().slice(0, 50)])
      entities.set(entityKey(entity), entity);
    return [...entities.values()]
      .filter(
        (entity) =>
          entity.entityType !== 'user' &&
          entity.entityType !== 'chat' &&
          typeof entity.entityType === 'string'
      )
      .slice(0, 24);
  });
  const related = createRelatedActivityQuery(
    context,
    relatedEntities,
    () => scope() === 'workspace'
  );
  const mountedAt = Date.now();
  const events = createMemo(() =>
    mergeActivityEvents(
      ownEvents(),
      scope() === 'workspace' ? (workspace.data ?? []) : [],
      scope() === 'workspace' ? (related.data ?? []) : []
    ).filter((event) => {
      if (event.entityType === 'chat') return false;
      if (scope() === 'mine' && event.actorId !== context.currentUserId())
        return false;
      return (
        period() === 'all' ||
        Date.parse(event.occurredAt) >=
          mountedAt - Number(period()) * 86_400_000
      );
    })
  );
  const baseItems = createMemo(() =>
    collectNetworkItems(events()).slice(0, 80)
  );
  const emailItems = createMemo(() =>
    baseItems()
      .filter((item) => item.entityType === 'email-thread')
      .slice(0, 16)
      .sort((a, b) => a.id.localeCompare(b.id))
  );
  const details = createWorkDetailsQuery(context, emailItems);
  const knownIds = createMemo(() => [
    ...new Set([
      ...memberIds(),
      context.currentUserId(),
      ...baseItems().flatMap((item) => item.actors),
    ]),
  ]);
  const emailDetails = createMemo(
    () =>
      new Map(
        (details.data ?? []).map((thread) => [
          thread.id,
          connectEmailParticipants(
            thread,
            context.currentUserId(),
            roster?.ownEmails() ?? [],
            knownIds(),
            memberIds()
          ),
        ])
      )
  );
  const contactDetails = createMemo(() => {
    const people = new Map<string, EmailNetworkPerson>();
    for (const email of emailDetails().values())
      for (const person of email.people) people.set(person.id, person);
    return people;
  });
  const items = createMemo(() =>
    baseItems().map((item) => {
      if (item.entityType !== 'email-thread') return item;
      const email = emailDetails().get(item.entityId);
      return {
        ...item,
        actors: email?.people.map((person) => person.id) ?? [],
        replyState: email?.replyState ?? 'unknown',
        relationships:
          email?.people.map((person) => ({
            personId: person.id,
            label: person.role,
            count: 1,
          })) ?? [],
      };
    })
  );
  const itemById = createMemo(
    () => new Map(items().map((item) => [item.id, item]))
  );
  const displayEntries = mapArray(
    () => items().map((item) => item.id),
    (id) => {
      const item = itemById().get(id)!;
      const type = toPropertyEntityType(item.entityType)!;
      return [
        id,
        context.entityDisplay(
          () => item.entityId,
          () => type
        ),
      ] as const;
    }
  );
  const displays = createMemo(
    () => new Map<string, EntityDisplay>(displayEntries())
  );
  const actorIds = createMemo(() => [
    ...new Set([...memberIds(), ...items().flatMap((item) => item.actors)]),
  ]);
  const peopleEntries = mapArray(actorIds, (id) => {
    const external = id.startsWith('contact:');
    const name = external ? undefined : context.displayName(() => id);
    const picture = external ? undefined : context.actorPicture?.(id);
    return [
      id,
      {
        name: () =>
          external
            ? contactDetails().get(id)?.name ||
              contactDetails().get(id)?.email ||
              'Contact'
            : name?.() || contactDetails().get(id)?.name || 'Automation',
        picture: () =>
          picture?.() || contactDetails().get(id)?.picture || undefined,
        email: () =>
          contactDetails().get(id)?.email ||
          (id.startsWith('macro|') ? id.slice(6) : undefined),
        isYou: id === context.currentUserId(),
        isTeam: () => memberIds().includes(id),
      },
    ] as const;
  });
  const people = createMemo(() => new Map(peopleEntries()));
  const isShared = (item: ReturnType<typeof items>[number]) =>
    item.actors.some(
      (id) => id !== context.currentUserId() && memberIds().includes(id)
    );
  const filteredItems = createMemo(() => {
    const query = search().trim().toLocaleLowerCase();
    return items()
      .filter((item) => {
        if (kind() !== 'all' && item.entityType !== kind()) return false;
        if (focus() === 'unanswered' && item.replyState !== 'unanswered')
          return false;
        if (focus() === 'shared' && !isShared(item)) return false;
        if (!query) return true;
        return [
          displays().get(item.id)?.name(),
          ...item.actors.flatMap((id) => [
            people().get(id)?.name(),
            people().get(id)?.email(),
          ]),
          ...item.events.map((event) => networkActionLabel(event.action)),
        ].some((value) => value?.toLocaleLowerCase().includes(query));
      })
      .sort(
        (a, b) =>
          Number(b.replyState === 'unanswered') -
            Number(a.replyState === 'unanswered') ||
          Number(isShared(b)) - Number(isShared(a))
      );
  });
  const rosterIds = createMemo(() => {
    if (scope() === 'mine' || focus() !== 'all' || kind() !== 'all') return [];
    const query = search().trim().toLocaleLowerCase();
    return memberIds().filter(
      (id) =>
        !query ||
        people().get(id)?.name().toLocaleLowerCase().includes(query) ||
        people().get(id)?.email()?.toLocaleLowerCase().includes(query)
    );
  });
  const graph = createMemo(() =>
    layoutActivityNetwork(filteredItems(), {
      personIds: rosterIds(),
      teamIds: memberIds(),
      currentUserId: context.currentUserId(),
    })
  );
  const currentSelection = () => {
    const selected = selection();
    if (!selected) return undefined;
    if (selected.kind === 'person')
      return people().has(selected.id) ? selected : undefined;
    return filteredItems().some((item) => item.id === selected.id)
      ? selected
      : undefined;
  };
  const timeline = createMemo(() => {
    const selected = currentSelection();
    const ids = new Set(
      filteredItems()
        .filter(
          (item) =>
            !selected ||
            (selected.kind === 'entity'
              ? item.id === selected.id
              : item.actors.includes(selected.id))
        )
        .map((item) => item.id)
    );
    return events().filter(
      (event) =>
        (search().trim() || focus() !== 'all' || selected
          ? ids.has(entityKey(event))
          : true) &&
        (kind() === 'all' || event.entityType === kind())
    );
  });
  const selectionName = () => {
    const selected = currentSelection();
    return !selected
      ? ''
      : selected.kind === 'person'
        ? (people().get(selected.id)?.name() ?? 'Person')
        : (displays().get(selected.id)?.name() ?? 'Item');
  };
  const selectedEmail = () => {
    const selected = currentSelection();
    if (selected?.kind !== 'entity') return;
    const item = itemById().get(selected.id);
    return item?.entityType === 'email-thread'
      ? emailDetails().get(item.entityId)
      : undefined;
  };
  function openItem(
    id: string,
    onOpen: (target: OpenEntityTarget) => void,
    newSplit = false
  ) {
    const item = itemById().get(id);
    const display = displays().get(id);
    const block = display?.blockOrFileType();
    if (!item || !display || !block) return;
    onOpen({
      block,
      id: item.entityId,
      params: display.linkParams(),
      newSplit,
    });
  }
  return {
    scope,
    setScope: (value: 'workspace' | 'mine') => {
      setSelection();
      setScope(value);
    },
    period,
    setPeriod: (value: '30' | '7' | 'all') => {
      setSelection();
      setPeriod(value);
    },
    kind,
    setKind: (value: NetworkKind | 'all') => {
      setSelection();
      setKind(value);
    },
    focus,
    setFocus: (value: 'all' | 'unanswered' | 'shared') => {
      setSelection();
      setFocus(value);
    },
    search,
    setSearch: (value: string) => {
      setSelection();
      setSearch(value);
    },
    selection: currentSelection,
    select: (value: NetworkSelection | undefined) => setSelection(value),
    selectionName,
    selectedEmail,
    selectedWork: () => {
      const selected = currentSelection();
      return selected?.kind === 'person'
        ? filteredItems().filter((item) => item.actors.includes(selected.id))
        : [];
    },
    graph,
    timeline,
    displays,
    people,
    openItem,
    unansweredCount: () =>
      items().filter((item) => item.replyState === 'unanswered').length,
    sharedCount: () => items().filter(isShared).length,
    loading: () =>
      scope() === 'workspace' && (workspace.isLoading || related.isLoading),
    detailsLoading: () => details.isLoading,
    error: () =>
      scope() === 'workspace' && (workspace.isError || related.isError),
    detailsError: () => details.isError,
    retry: () => {
      workspace.refetch({ requestPolicy: 'network-only' });
      related.refetch({ requestPolicy: 'network-only' });
      details.refetch({ requestPolicy: 'network-only' });
    },
  };
}
