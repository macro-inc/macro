import { modeForKind } from '@app/features/agents-view/core/agent-kind';
import { agentsRouteId } from '@app/features/agents-view/core/route';
import { createAgentRosterSource } from '@app/features/agents-view/queries/agent-roster-source';
import { createComposerModels } from '@app/features/agents-view/queries/composer-models';
import { buildAgentPrompt } from '@app/features/agents-view/queries/composer-prompt';
import { startPendingSession } from '@app/features/block-agent/context/pending-session';
import { createDocumentWithTags } from '@app/features/block-md/queries/create-document-with-tags';
import { createDocumentComposerTags } from '@app/features/block-md/util/documentComposerProperties';
import { createTaskWithProperties } from '@app/features/block-md/util/taskComposerProperties';
import { calendarViewContent } from '@app/features/calendar-view/calendar-navigation';
import { createEmailComposeContext } from '@app/features/email-compose/compose-adapter';
import { plainTextToHtml } from '@app/features/email-compose/core/plain-text-to-html';
import { prepareEmailBody } from '@app/features/email-compose/primitives/prepare-email-body';
import { parsePropertyDraft } from '@app/features/property/utils/parse-property-draft';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import type {
  ReferredFrom,
  SplitContent,
} from '@components/app/split-layout/layoutManager';
import type { PromptSubmitSurface } from '@core/agent-session/prompt-telemetry';
import { useHasPaidAccess } from '@core/auth';
import {
  DEFAULT_MODEL,
  FREE_DEFAULT_MODEL,
  MODEL_PRETTYNAME,
  Model,
} from '@core/component/AI/constant';
import { useChatInputContext } from '@core/component/AI/context';
import { setPendingSendData } from '@core/component/AI/signal/pendingSend';
import type { ItemMention } from '@core/component/LexicalMarkdown/plugins';
import { toast } from '@core/component/Toast/Toast';
import { enableChatV3Agents } from '@core/constant/featureFlags';
import { useSettingsState } from '@core/constant/SettingsState';
import { useQuickAccess } from '@core/context/quickAccess';
import { useAddInboxFlow } from '@core/email-link';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import { encodeBase64UrlUtf8 } from '@core/util/base64';
import { useVisibleCalendarsQuery } from '@queries/calendar/calendars';
import { useCreateCalendarEventMutation } from '@queries/calendar/mutations';
import {
  useGetOrCreateDirectMessageMutation,
  useGetOrCreatePrivateChannelMutation,
} from '@queries/channel/get-or-create-dm';
import { useUpsertToHistoryMutation } from '@queries/history/history';
import { useSendMessageMutation } from '@queries/messages/mutations';
import type { LexicalEditor } from 'lexical';
import { type Accessor, createSignal } from 'solid-js';
import { match } from 'ts-pattern';
import type { RosterAgent } from '../agents-view/core/roster';
import {
  exportCalendarDescription,
  sanitizeCalendarDescription,
} from '../calendar/utils/calendar-description';
import { buildRecurrenceLines } from '../calendar/utils/recurrence';
import { authoredMentions } from '../channel/Input/message-payload';
import { searchNeedsKeywords } from '../next-soup/core/search-filters';
import { compileSearchQuery } from '../next-soup/core/search-query';
import { createGlobalSearchOpener } from '../next-soup/open-search';
import type { InputCapabilities } from './context/capabilities';
import type { InputFields, Submission } from './core/input';
import { type Recipient, resolveRecipients } from './core/recipients';
import { parseRecurrenceDraft } from './core/recurrence';
import { resolveSearchFilters } from './core/search';
import { createInputChat } from './queries/create-chat';
import { createTaskFieldSource } from './queries/task-field-source';

/** Production adapters reuse each destination's mutation and permission boundary. */
export function createInputActions(
  fields: Accessor<InputFields>,
  userId: string,
  host: {
    navigate: (content: SplitContent) => void;
    onNoteTagsChange?: (value: string) => void;
    submitSurface?: PromptSubmitSurface;
    referredFrom?: ReferredFrom;
  }
) {
  const { openSettings } = useSettingsState();
  const openSearch = createGlobalSearchOpener(
    host.referredFrom ?? 'kommand-menu'
  );
  const chat = useChatInputContext();
  const agents = useFeatureFlag(enableChatV3Agents);
  const paid = useHasPaidAccess();
  const roster = createAgentRosterSource();
  const selectedAgent = () =>
    roster.roster().find((agent) => agent.id === (fields().botId || 'macro'));
  const catalog = createComposerModels(selectedAgent);
  const email = createEmailComposeContext();
  const startGoogleConnection = useAddInboxFlow();
  const [connectingGoogle, setConnectingGoogle] = createSignal(false);
  const calendarsQuery = useVisibleCalendarsQuery();
  const createEvent = useCreateCalendarEventMutation();
  const dm = useGetOrCreateDirectMessageMutation();
  const group = useGetOrCreatePrivateChannelMutation();
  const sendMessage = useSendMessageMutation();
  const history = useUpsertToHistoryMutation();
  const combined = useCombinedRecipients();
  const searchableChannels = useQuickAccess().useList('channel', 'dm');
  const searchChannels = (): Recipient[] =>
    searchableChannels.items().map((channel) => ({
      id: channel.id,
      label: channel.data.name,
      kind: 'channel',
    }));
  const taskFields = createTaskFieldSource(userId);
  const noteTags = createDocumentComposerTags(
    {},
    {
      values: () => parsePropertyDraft(fields().noteTags),
      onChange: (values) => host.onNoteTagsChange?.(JSON.stringify(values)),
    }
  );
  const people = (): Recipient[] =>
    combined.users().map((p) => ({
      id: p.id,
      label: p.data.name ?? p.data.email ?? p.id,
      email: p.data.email ?? undefined,
      kind: 'user',
    }));
  const messageRecipients = () => [
    ...combined.users().filter((option) => option.kind === 'user'),
    ...combined.channels(),
  ];
  const destinations = (): Recipient[] =>
    messageRecipients().map((option) => ({
      id: option.id,
      label:
        option.data.name ??
        (option.kind === 'user' ? option.data.email : 'Channel'),
      email: option.kind === 'user' ? option.data.email : undefined,
      kind: option.kind,
    }));
  const calendars = () =>
    calendarsQuery.isSuccess
      ? calendarsQuery.data.filter((c) => c.isWritable)
      : [];
  const selectedCalendar = (f: InputFields) =>
    calendars().find((c) => c.id === f.calendarId) ??
    (!f.calendarId
      ? (calendars().find((c) => c.isPrimary) ?? calendars()[0])
      : undefined);
  const selectedInbox = (f: InputFields) =>
    email.accounts
      .inboxes()
      .find((a) => a.id === (f.inboxId || email.accounts.primaryId())) ??
    (!f.inboxId ? email.accounts.inboxes()[0] : undefined);
  const connectGoogle = async () => {
    if (connectingGoogle()) return;
    setConnectingGoogle(true);
    try {
      await startGoogleConnection({
        scopes: 'gmail_and_calendar',
        emailAddress: selectedInbox(fields())?.email_address,
      });
    } catch {
      toast.failure('Could not connect Google. Please try again.');
    } finally {
      setConnectingGoogle(false);
    }
  };
  const recipients = (f: InputFields, message = false) =>
    resolveRecipients(
      f.recipients,
      message ? destinations() : people(),
      !message
    );
  const models = () =>
    agents().enabled
      ? catalog.models().map((m) => ({ id: m.id, label: m.name }))
      : Object.values(Model)
          .filter((m) => paid() || m === FREE_DEFAULT_MODEL)
          .map((id) => ({ id, label: MODEL_PRETTYNAME[id] }));
  const model = () =>
    fields().model ||
    (agents().enabled
      ? (catalog.currentModel() ?? '')
      : paid()
        ? DEFAULT_MODEL
        : FREE_DEFAULT_MODEL);
  const attachmentCount = () => chat.attachments.attached().length;
  const validateEmailDraft: InputCapabilities['validateEmailDraft'] = (
    input
  ) => {
    if (input.intent !== 'email') return 'Choose Email';
    if (attachmentCount())
      return 'Attached context is supported for AI. Remove it or choose AI.';
    if (!selectedInbox(input.fields))
      return 'Connect or choose an email account';
    const unresolved = [
      ...recipients(input.fields).unresolved,
      ...resolveRecipients(input.fields.cc, people(), true).unresolved,
      ...resolveRecipients(input.fields.bcc, people(), true).unresolved,
    ];
    if (unresolved.length)
      return `Choose a specific recipient for ${unresolved.join(', ')}`;
  };
  const validateCalendar = (fields: InputFields) => {
    if (fields.recurrence && !parseRecurrenceDraft(fields.recurrence))
      return 'Choose valid recurrence settings';
    if (!selectedCalendar(fields))
      return 'Connect or choose a writable calendar';
    if (resolveRecipients(fields.guests, people(), true).unresolved.length)
      return 'Choose an email address for each guest';
  };
  const validateMessage = (fields: InputFields) => {
    const resolved = recipients(fields, true);
    if (resolved.unresolved.length)
      return `Choose a specific recipient for ${resolved.unresolved.join(', ')}`;
    if (!resolved.recipients.length) return 'Choose at least one recipient';
    if (
      resolved.recipients.some((p) => p.kind === 'channel') &&
      resolved.recipients.length !== 1
    )
      return 'Choose one channel, or a group of people';
  };
  const validate: InputCapabilities['validate'] = (input) => {
    if (input.intent === 'search') {
      const filters = resolveSearchFilters(
        input.fields.searchFilters,
        people(),
        searchChannels(),
        email.accounts.inboxes()
      );
      if (filters.unresolved.length)
        return `Choose a specific person or channel for ${filters.unresolved.join(', ')}`;
      if (searchNeedsKeywords(filters.state, input.fields.query))
        return 'Add at least 3 search characters to search by sender or speaker.';
    }
    if (input.intent === 'task') {
      const unresolved = taskFields.values(input.fields).unresolved;
      if (unresolved.length)
        return `Choose a value for ${unresolved.join(', ')}`;
    }
    if (attachmentCount() && input.intent !== 'ai')
      return 'Attached context is supported for AI. Remove it or choose AI.';
    if (input.intent === 'calendar') return validateCalendar(input.fields);
    if (input.intent === 'email') {
      const problem = validateEmailDraft(input);
      if (problem) return problem;
      if (
        ![input.fields.recipients, input.fields.cc, input.fields.bcc].some(
          (value) => resolveRecipients(value, people(), true).recipients.length
        )
      )
        return 'Choose a recipient';
    }
    if (input.intent === 'message') return validateMessage(input.fields);
    if (
      input.intent === 'ai' &&
      agents().enabled &&
      selectedAgent()?.unavailableReason
    )
      return selectedAgent()?.unavailableReason;
  };
  const emailDrafts = new Map<
    string,
    { draftId?: string; threadId?: string }
  >();
  let emailEditor: LexicalEditor | undefined;
  let calendarEditor: LexicalEditor | undefined;
  let messageMentions: (() => ItemMention[]) | undefined;
  const emailMessage = (input: Submission) => {
    const body = prepareEmailBody(emailEditor);
    const prior = emailDrafts.get(input.id);
    return {
      subject: input.fields.subject,
      to: recipients(input.fields).recipients.map((p) => ({
        email: p.email!,
        name: p.label,
      })),
      cc: resolveRecipients(input.fields.cc, people(), true).recipients.map(
        (p) => ({ email: p.email!, name: p.label })
      ),
      bcc: resolveRecipients(input.fields.bcc, people(), true).recipients.map(
        (p) => ({ email: p.email!, name: p.label })
      ),
      body_text: body?.bodyText ?? input.fields.body,
      body_html:
        body?.bodyHtml ??
        encodeBase64UrlUtf8(plainTextToHtml(input.fields.body)),
      body_macro: input.fields.body,
      db_id: prior?.draftId,
      thread_db_id: prior?.threadId,
    };
  };
  const saveEmailDraft: InputCapabilities['saveEmailDraft'] = async (input) => {
    const problem = validateEmailDraft(input);
    if (problem) throw new Error(problem);
    const inboxId = selectedInbox(input.fields)!.id;
    const saved = await email.drafts.saveDraft({
      draft: emailMessage(input),
      inboxId,
    });
    emailDrafts.delete(input.id);
    return {
      message: 'Email draft saved',
      open: saved.threadId
        ? () => host.navigate({ type: 'email', id: saved.threadId! })
        : undefined,
    };
  };
  const openDocument = (id: string) => () => host.navigate({ type: 'md', id });
  const submit: InputCapabilities['submit'] = async (input) => {
    const problem = validate(input);
    if (problem) throw new Error(problem);
    const f = input.fields;
    return await match(input.intent)
      .with('ai', async () => {
        if (agents().enabled) {
          const prompt = await buildAgentPrompt({
            content: input.text,
            attachments: chat.attachments.attached(),
          });
          const agent = selectedAgent();
          const id = startPendingSession({
            prompt,
            botId: agent?.botId,
            modelOverride: model() || undefined,
            modelFallback: catalog.pending(),
            userId: userId,
            submitSurface: host.submitSurface ?? 'other',
          });
          chat.attachments.setAttached([]);
          const content: Parameters<typeof host.navigate>[0] = {
            type: 'component',
            id: agentsRouteId({
              mode: modeForKind(agent?.kind ?? 'agent'),
              conversation: { type: 'agent_session', id },
            }),
          };
          return {
            message: 'Started conversation',
            open: () => host.navigate(content),
          };
        } else {
          const id = await createInputChat();
          const selectedModel =
            Object.values(Model).find((m) => m === model()) ??
            FREE_DEFAULT_MODEL;
          setPendingSendData({
            content: input.text,
            attachments: chat.attachments.attached(),
            model: selectedModel,
          });
          chat.attachments.setAttached([]);
          return {
            message: 'Started conversation',
            open: () => host.navigate({ type: 'chat', id }),
          };
        }
      })
      .with('search', async () => {
        const { state } = resolveSearchFilters(
          f.searchFilters,
          people(),
          searchChannels(),
          email.accounts.inboxes()
        );
        const search = {
          query: f.query.trim(),
          filters: compileSearchQuery(state),
          clientFilters: {
            and: ['search-supported' as const],
            or: state.type === 'all' ? [] : [state.type],
          },
        };
        return { message: 'Search opened', open: () => openSearch(search) };
      })
      .with('note', async () => {
        const created = await createDocumentWithTags(
          f.title,
          f.body,
          Object.entries(parsePropertyDraft(f.noteTags)),
          noteTags.createDefinitions(),
          (p) => history.mutate(p)
        );
        if (!created) throw new Error('Could not create the note');
        return {
          message: 'Note created',
          open: openDocument(created.documentId),
        };
      })
      .with('task', async () => {
        const definitions = await taskFields.createDefinitions();
        const properties = taskFields.values(f).values;
        const created = await createTaskWithProperties(
          f.title,
          f.body,
          Object.entries(properties),
          definitions,
          (p) => history.mutate(p)
        );
        if (!created) throw new Error('Could not create the task');
        return {
          message: 'Task created',
          open: openDocument(created.documentId),
        };
      })
      .with('email', async () => {
        const inboxId = selectedInbox(f)!.id;
        const message = emailMessage(input);
        const saved = await email.drafts.saveDraft({ draft: message, inboxId });
        emailDrafts.set(input.id, saved);
        const sent = await email.delivery.sendMessage({
          inboxId,
          message: {
            ...message,
            db_id: saved.draftId,
            thread_db_id: saved.threadId,
          },
        });
        emailDrafts.delete(input.id);
        return {
          message: 'Email sent',
          open: sent.threadId
            ? () => host.navigate({ type: 'email', id: sent.threadId! })
            : undefined,
        };
      })
      .with('calendar', async () => {
        const recurrence = parseRecurrenceDraft(f.recurrence);
        const calendar = selectedCalendar(f)!;
        const event = await createEvent.mutateAsync({
          title: f.title,
          description: calendarEditor
            ? exportCalendarDescription(calendarEditor)
            : sanitizeCalendarDescription(f.body),
          calendarId: calendar.id,
          emailLinkId: calendar.emailLinkId,
          idempotencyKey: input.id,
          time: {
            kind: 'timed',
            startsAt: new Date(f.start).toISOString(),
            endsAt: new Date(f.end).toISOString(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
          recurrenceLines: recurrence
            ? buildRecurrenceLines(
                recurrence,
                false,
                Intl.DateTimeFormat().resolvedOptions().timeZone
              )
            : undefined,
          location: f.location || undefined,
          attendees: resolveRecipients(f.guests, people(), true).recipients.map(
            (p) => ({ email: p.email! })
          ),
        });
        return {
          message: 'Event created',
          open: () => host.navigate(calendarViewContent({ eventId: event.id })),
        };
      })
      .with('message', async () => {
        const mentions = authoredMentions(messageMentions?.() ?? []);
        const targets = recipients(f, true).recipients;
        const first = targets[0];
        const channelId =
          first.kind === 'channel'
            ? first.id
            : targets.length === 1
              ? (await dm.mutateAsync({ recipient_id: first.id })).channel_id
              : (
                  await group.mutateAsync({
                    recipients: targets.map((p) => p.id),
                  })
                ).channel_id;
        await sendMessage.mutateAsync({
          parent: { type: 'channel', id: channelId },
          senderId: userId,
          optimisticId: input.id,
          message: {
            content: f.body,
            mentions,
          },
        });
        return {
          message: 'Message sent',
          open: () => host.navigate({ type: 'channel', id: channelId }),
        };
      })
      .exhaustive();
  };
  return {
    noteTags,
    searchChannels,
    captureMessageMentions: (read: (() => ItemMention[]) | undefined) => {
      messageMentions = read;
    },
    messageRecipients,
    captureCalendarEditor: (editor: LexicalEditor | undefined) => {
      calendarEditor = editor;
    },
    captureEmailEditor: (editor: LexicalEditor | undefined) => {
      emailEditor = editor;
    },
    taskDefinitions: taskFields.definitions,
    taskValues: taskFields.values,
    submit,
    saveEmailDraft,
    validate,
    validateEmailDraft,
    people,
    destinations,
    recipients,
    calendars,
    selectedCalendar,
    selectedInbox,
    inboxes: email.accounts.inboxes,
    connectGoogle,
    connectingGoogle: () =>
      connectingGoogle() ||
      email.accounts.loading() ||
      calendarsQuery.isPending,
    roster: roster.roster,
    rosterLoading: roster.loading,
    connectAgent: (agent: RosterAgent) => {
      if (agent.harness === 'cursor') openSettings('Agents');
    },
    createAgent: () =>
      host.navigate({
        type: 'component',
        id: 'agents',
        params: {
          agentPage: 'agents',
          agentPageRequest: crypto.randomUUID(),
        },
      }),
    agentsEnabled: () => agents().enabled,
    models,
    model,
    attachmentCount,
    clearAttachments: () => chat.attachments.setAttached([]),
  };
}
export type InputActions = ReturnType<typeof createInputActions>;
