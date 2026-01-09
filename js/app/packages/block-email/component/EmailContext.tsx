import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { URL_PARAMS } from '@block-email/constants';
import {
  getPermissions,
  hasPermissions,
  Permissions,
} from '@core/component/SharePermissions';
import { toast } from '@core/component/Toast/Toast';
import { createMethodRegistration } from '@core/orchestrator';
import { blockHandleSignal } from '@core/signal/load';
import {
  recipientEntityMapper,
  useContacts,
  type WithCustomUserInput,
} from '@core/user';
import { whenSettled } from '@core/util/whenSettled';
import {
  createEffectOnEntityTypeNotification,
  isNewEmail,
} from '@notifications';
import {
  useArchiveThreadMutation,
  useThreadQuery,
} from '@queries/email/thread';
import type {
  APIThread,
  ContactInfo,
  MessageWithBodyReplyless,
} from '@service-email/generated/schemas';
import { useSearchParams } from '@solidjs/router';
import {
  type Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  type FlowProps,
  Suspense,
  untrack,
  useContext,
} from 'solid-js';
import { createStore } from 'solid-js/store';

export type EmailRecipient = WithCustomUserInput<'user' | 'contact'>;

export type EmailContextValues = {
  registerMessagesList: (list: HTMLElement) => void;
  messagesListRef: Accessor<HTMLElement | undefined>;
  registerMessagesContainer: (container: HTMLElement) => void;
  messagesContainerRef: Accessor<HTMLElement | undefined>;

  recipientOptions: Accessor<EmailRecipient[]>;
  onRecipientsChange: (items: EmailRecipient[]) => void;

  drafts: {
    getDraftForMessage: (
      messageDbID: string
    ) => MessageWithBodyReplyless | undefined;
    deleteDraftForMessage: (messageDbID: string) => void;
    initialDraftsSettled: Accessor<boolean>;
  };

  messages: {
    unfiltered: Accessor<MessageWithBodyReplyless[]>;
    list: Accessor<MessageWithBodyReplyless[]>;
    targetMessageID: Accessor<string | undefined>;
    setTargetMessageID: (id: string | undefined) => void;
    focusedID: Accessor<string | undefined>;
    setFocused: (messageID: string | undefined) => void;
    expandedBodyIds: Record<string, boolean>;
    setExpandedBodyId: (id: string, expanded: boolean) => void;
    isBodyExpanded: (id: string) => boolean;
    replyingToMessageId: Accessor<string | undefined>;
    setReplyingToMessageId: (id: string | undefined) => void;
  };
  thread: Accessor<APIThread | undefined>;
  permissions: Accessor<{
    type: Permissions;
    isOwner: boolean;
  }>;

  query: {
    hasMore: Accessor<boolean>;
    isFetching: Accessor<boolean>;
    fetchNextPage: () => void;
    refetch: () => void;
  };

  archiveThread: () => boolean;
  initialLoadComplete: Accessor<boolean>;
  onInitialDataLoad: (callback: () => boolean) => void;
};

const EmailContext = createContext<EmailContextValues>();

export function EmailProvider(props: FlowProps<{ threadID: string }>) {
  const threadQuery = useThreadQuery(
    () => props.threadID,
    () => ({
      select(data) {
        const messages = data.pages.flatMap((t) => t.messages);

        const filtered = [];
        const messageDraftMap: Record<string, MessageWithBodyReplyless> = {};

        for (const message of messages) {
          if (!message.is_draft) {
            filtered.push(message);
            continue;
          }

          if (message.body_html_sanitized?.trim().length === 0) {
            continue;
          }

          const replyingToId = message.replying_to_id;

          if (!replyingToId) continue;

          messageDraftMap[replyingToId] = message;
        }

        filtered.sort((a, b) => {
          if (a.internal_date_ts && b.internal_date_ts) {
            return (
              new Date(a.internal_date_ts).getTime() -
              new Date(b.internal_date_ts).getTime()
            );
          }
          // Below is fallback for when internal_date_ts is not set
          else if (a.sent_at && b.sent_at) {
            return (
              new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
            );
          }
          return 0;
        });

        return {
          ...data.pages[0],
          messages: messages,
          filtered: filtered,
          draftMap: messageDraftMap,
        };
      },
    })
  );

  const notificationSource = useGlobalNotificationSource();

  createEffectOnEntityTypeNotification(
    notificationSource,
    'email',
    (notification) => {
      if (!isNewEmail(notification)) return;
      const notificationThreadId = notification.notificationMetadata.threadId;
      if (notificationThreadId === threadQuery.data?.db_id) {
        threadQuery.refetch();
      }
    }
  );

  const [focusedMessageId, setFocusedMessageId] = createSignal<string>();
  const [replyingToMessageId, setReplyingToMessageId] = createSignal<string>();
  const [expandedMessageBodyIds, setExpandedMessageBodyIds] = createStore<
    Record<string, boolean>
  >({});
  const [searchParams] = useSearchParams();
  const searchParamsMessageId = () => {
    const messageID = searchParams[URL_PARAMS.messageId];
    if (typeof messageID === 'string') {
      return messageID;
    } else if (Array.isArray(messageID)) {
      return messageID[0];
    }
    return undefined;
  };
  const [targetMessageId, setTargetMessageId] = createSignal<
    string | undefined
  >(searchParamsMessageId());

  const [hasHandledTarget, setHasHandledTarget] = createSignal(false);

  const blockHandle = blockHandleSignal.get;
  createMethodRegistration(blockHandle, {
    goToLocationFromParams: (params: Record<string, any>) => {
      if (params[URL_PARAMS.messageId]) {
        setTargetMessageId(undefined);
        setTimeout(() => {
          setTargetMessageId(params[URL_PARAMS.messageId]);
          setHasHandledTarget(false);
        }, 0);
      }
    },
  });

  const [messageDraftMap, setMessageDraftMap] = createStore<
    Record<string, MessageWithBodyReplyless | undefined>
  >({});

  const deleteDraftForMessage = (messageID: string) => {
    setMessageDraftMap(messageID, undefined!);
  };

  const getDraftForMessage = (messageID: string) => {
    return messageDraftMap[messageID];
  };

  const [draftsSettled, setDraftsSettled] = createSignal(false);

  whenSettled(
    threadQuery,
    (data) => {
      setMessageDraftMap(data.draftMap);
      setDraftsSettled(true);
    },
    (error) => {
      console.error('Failed to load thread data:', error);
      toast.failure('Failed to load email thread. Please try again.');
    }
  );

  const contacts = useContacts();

  const [augmentedRecipients, setAugmentedRecipients] = createSignal<
    EmailRecipient[]
  >([]);

  function onRecipientsChange(items: EmailRecipient[]) {
    const existing = augmentedRecipients();
    const existingEmails = new Set(
      existing.map((r) => r.data.email).filter((e) => e.length > 0)
    );

    const uniques: EmailRecipient[] = [];
    for (const r of items) {
      const email = r.data.email;
      if (email && !existingEmails.has(email)) {
        existingEmails.add(email);
        uniques.push(r);
      }
    }

    if (uniques.length === 0) return;
    setAugmentedRecipients([...existing, ...uniques]);
  }

  const getRecipientOptions = () => {
    const optionsMap = new Map<string, EmailRecipient>();

    for (const contact of contacts()) {
      const mapped = recipientEntityMapper('user')(contact);
      optionsMap.set(mapped.data.email, mapped);
    }

    const thread = threadQuery.data;
    if (thread) {
      const seen = new Map<string, ContactInfo>();

      const add = (c: ContactInfo) => {
        const existing = seen.get(c.email);
        if (!existing || (!existing.name && c.name)) seen.set(c.email, c);
      };

      thread.messages.forEach((m) => {
        m.to.forEach(add);
        m.cc.forEach(add);
        m.bcc.forEach(add);
        if (m.from?.email)
          add({
            email: m.from.email,
            name: m.from.name ?? undefined,
          });
      });

      for (const value of seen.values()) {
        const mapped = recipientEntityMapper('contact')({
          ...value,
          type: 'extracted',
          id: value.email,
        });
        optionsMap.set(mapped.data.email, mapped);
      }
    }

    augmentedRecipients().forEach((r) => {
      const email = r.data.email;
      if (email && !optionsMap.has(email)) optionsMap.set(email, r);
    });

    return Array.from(optionsMap.values());
  };

  const {
    soupContext: {
      entitiesSignal: [entities],
      actionRegistry,
    },
  } = useSplitPanelOrThrow();

  const archiveMutation = useArchiveThreadMutation({
    onError: () => {
      toast.failure('Failed to archive thread');
    },
  });

  const archiveThread = () => {
    const thread = threadQuery.data;

    if (!thread?.db_id) return false;

    archiveMutation.mutate({
      threadId: thread.db_id,
      archive: thread.inbox_visible,
    });

    if (!props) return false;

    const selectedEntity = entities()?.find(
      (entity) => entity.id === thread.db_id
    );

    if (selectedEntity) {
      actionRegistry.execute('mark_as_done', selectedEntity);
    } else {
      archiveMutation.mutate({
        threadId: thread.db_id,
        archive: thread.inbox_visible,
      });
    }

    return true;
  };

  const [messagesListRef, setMessagesListRef] = createSignal<
    HTMLDivElement | undefined
  >(undefined);
  const [messagesContainerRef, setMessagesContainerRef] = createSignal<
    HTMLDivElement | undefined
  >(undefined);

  let containerFilled = false;
  const isContainerFilled = () => {
    const messageList = messagesListRef();
    const containerRef = messagesContainerRef();

    // Skip if dependencies not ready
    if (
      !messageList ||
      !containerRef ||
      !untrack(() => threadQuery.data)?.db_id
    ) {
      containerFilled = false;
      return false;
    }

    // Skip if still loading or already filled
    if (threadQuery.isFetching || containerFilled) {
      return containerFilled;
    }

    const messageListHeight = messageList.getBoundingClientRect().height;
    const containerHeight = containerRef.getBoundingClientRect().height;

    // Load more if container isn't filled
    if (
      messageListHeight < containerHeight &&
      threadQuery.hasNextPage &&
      !threadQuery.isFetching
    ) {
      threadQuery.fetchNextPage();
      containerFilled = false;
      return false;
    }
    containerFilled = true;
    return true;
  };

  const onInitialDataLoad = (callback: () => boolean) => {
    createEffect(() => {
      if (hasHandledTarget()) return;
      const fetching = threadQuery.isFetching;
      if (fetching) return;
      // Check if initial loading is complete
      const isInitialLoadComplete =
        (isContainerFilled() || threadQuery.hasNextPage === false) &&
        !threadQuery.isFetching;

      if (!isInitialLoadComplete) return;

      // Skip if basic requirements not met
      if (!untrack(messagesListRef)) {
        return;
      }

      setHasHandledTarget(callback());
    });
  };

  return (
    <Suspense>
      <EmailContext.Provider
        value={{
          registerMessagesList: setMessagesListRef,
          registerMessagesContainer: setMessagesContainerRef,
          thread: createMemo(() => threadQuery.data),
          recipientOptions: createMemo(getRecipientOptions),
          onRecipientsChange,
          archiveThread,
          messagesContainerRef,
          messagesListRef,
          query: {
            hasMore: () => threadQuery.hasNextPage ?? false,
            fetchNextPage: threadQuery.fetchNextPage,
            isFetching: () => threadQuery.isFetching,
            refetch: threadQuery.refetch,
          },
          drafts: {
            deleteDraftForMessage,
            getDraftForMessage,
            initialDraftsSettled: draftsSettled,
          },
          messages: {
            focusedID: focusedMessageId,
            setFocused: setFocusedMessageId,
            targetMessageID: targetMessageId,
            setTargetMessageID: setTargetMessageId,
            list: createMemo(() => threadQuery.data?.filtered ?? []),
            unfiltered: createMemo(() => threadQuery.data?.messages ?? []),
            expandedBodyIds: expandedMessageBodyIds,
            setExpandedBodyId: (id: string, expanded: boolean) =>
              setExpandedMessageBodyIds(id, expanded),
            isBodyExpanded: (id: string) => expandedMessageBodyIds[id] ?? false,
            replyingToMessageId,
            setReplyingToMessageId,
          },
          permissions: createMemo(() => {
            const perms = getPermissions(threadQuery.data?.access_level);
            return {
              type: perms,
              isOwner: hasPermissions(perms, Permissions.OWNER),
            };
          }),
          initialLoadComplete: hasHandledTarget,
          onInitialDataLoad,
        }}
      >
        {props.children}
      </EmailContext.Provider>
    </Suspense>
  );
}

export function useEmailContext() {
  const ctx = useContext(EmailContext);
  if (!ctx) {
    throw new Error('useEmailContext must be used within an EmailProvider');
  }
  return ctx;
}
