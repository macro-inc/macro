import { modeForKind } from '@app/features/agents-view/core/agent-kind';
import { agentsRouteId } from '@app/features/agents-view/core/route';
import { createAgentRosterSource } from '@app/features/agents-view/queries/agent-roster-source';
import { createComposerModels } from '@app/features/agents-view/queries/composer-models';
import { startPendingSession } from '@app/features/block-agent/context/pending-session';
import { createDocumentWithTags } from '@app/features/block-md/queries/create-document-with-tags';
import {
  createTaskWithProperties,
  defaultTaskPropertyValues,
} from '@app/features/block-md/util/taskComposerProperties';
import { calendarViewContent } from '@app/features/calendar-view/calendar-navigation';
import { createEmailComposeContext } from '@app/features/email-compose/compose-adapter';
import { buildHomeAgentPrompt } from '@app/features/home/queries/home-agent-prompt';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useHasPaidAccess } from '@core/auth';
import {
  DEFAULT_MODEL,
  FREE_DEFAULT_MODEL,
  MODEL_PRETTYNAME,
  Model,
} from '@core/component/AI/constant';
import { useChatInputContext } from '@core/component/AI/context';
import { setPendingSendData } from '@core/component/AI/signal/pendingSend';
import { enableChatV3Agents } from '@core/constant/featureFlags';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { useVisibleCalendarsQuery } from '@queries/calendar/calendars';
import { useCreateCalendarEventMutation } from '@queries/calendar/mutations';
import {
  useGetOrCreateDirectMessageMutation,
  useGetOrCreatePrivateChannelMutation,
} from '@queries/channel/get-or-create-dm';
import { useUpsertToHistoryMutation } from '@queries/history/history';
import { useSendMessageMutation } from '@queries/messages/mutations';
import type { Accessor } from 'solid-js';
import { match } from 'ts-pattern';
import type { InputCapabilities } from './context/capabilities';
import type { InputFields } from './core/input';
import { type Recipient, resolveRecipients } from './core/recipients';
import { createInputChat } from './queries/create-chat';
import { parseTaskProperties } from './queries/task-properties';

/** Production adapters reuse each destination's mutation and permission boundary. */
export function createInputActions(
  fields: Accessor<InputFields>,
  userId: string
) {
  const panel = useSplitPanelOrThrow();
  const chat = useChatInputContext();
  const agents = useFeatureFlag(enableChatV3Agents);
  const paid = useHasPaidAccess();
  const roster = createAgentRosterSource();
  const selectedAgent = () =>
    roster.roster().find((agent) => agent.id === (fields().botId || 'macro'));
  const catalog = createComposerModels(selectedAgent);
  const email = createEmailComposeContext();
  const calendarsQuery = useVisibleCalendarsQuery();
  const createEvent = useCreateCalendarEventMutation();
  const dm = useGetOrCreateDirectMessageMutation();
  const group = useGetOrCreatePrivateChannelMutation();
  const sendMessage = useSendMessageMutation();
  const history = useUpsertToHistoryMutation();
  const combined = useCombinedRecipients();
  const people = (): Recipient[] =>
    combined.users().map((p) => ({
      id: p.id,
      label: p.data.name ?? p.data.email ?? p.id,
      email: p.data.email ?? undefined,
      kind: 'user',
    }));
  const destinations = (): Recipient[] => [
    ...people(),
    ...combined.channels().map(
      (p): Recipient => ({
        id: p.id,
        label: p.data.name ?? 'Channel',
        kind: 'channel',
      })
    ),
  ];
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
  const validate: InputCapabilities['validate'] = (input) => {
    if (attachmentCount() && input.intent !== 'ai')
      return 'Attached context is supported for AI. Remove it or choose AI.';
    if (input.intent === 'calendar') {
      if (!selectedCalendar(input.fields))
        return 'Connect or choose a writable calendar';
      if (
        resolveRecipients(input.fields.guests, people(), true).unresolved.length
      )
        return 'Choose an email address for each guest';
    }
    if (input.intent === 'email' && !selectedInbox(input.fields))
      return 'Connect or choose an email account';
    if (input.intent === 'email' || input.intent === 'message') {
      const resolved = recipients(input.fields, input.intent === 'message');
      if (resolved.unresolved.length)
        return `Choose a specific recipient for ${resolved.unresolved.join(', ')}`;
      if (
        input.intent === 'message' &&
        resolved.recipients.some((p) => p.kind === 'channel') &&
        resolved.recipients.length !== 1
      )
        return 'Choose one channel, or a group of people';
    }
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
  const openDocument = (id: string) => () =>
    panel.handle.replace({ next: { type: 'md', id } });
  const submit: InputCapabilities['submit'] = async (input) => {
    const problem = validate(input);
    if (problem) throw new Error(problem);
    const f = input.fields;
    return await match(input.intent)
      .with('ai', async () => {
        if (agents().enabled) {
          const prompt = await buildHomeAgentPrompt({
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
            submitSurface: 'home',
          });
          chat.attachments.setAttached([]);
          panel.handle.replace({
            next: {
              type: 'component',
              id: agentsRouteId({
                mode: modeForKind(agent?.kind ?? 'agent'),
                conversation: { type: 'agent_session', id },
              }),
            },
          });
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
          panel.handle.replace({
            next: { type: 'chat', id },
          });
        }
        return { message: 'Started conversation' };
      })
      .with('search', async () => {
        panel.handle.replace({
          next: {
            type: 'component',
            id: 'search',
            preserveParams: true,
            params: { initialQuery: f.query.trim() || input.text },
          },
        });
        return { message: 'Search opened' };
      })
      .with('note', async () => {
        const created = await createDocumentWithTags(
          f.title,
          input.text,
          [],
          new Map(),
          (p) => history.mutate(p)
        );
        if (!created) throw new Error('Could not create the note');
        return {
          message: 'Note created',
          open: openDocument(created.documentId),
        };
      })
      .with('task', async () => {
        const properties = {
          ...defaultTaskPropertyValues([userId]),
          ...parseTaskProperties(f.taskProperties),
        };
        if (f.due_date && !properties[SYSTEM_PROPERTY_IDS.DUE_DATE])
          properties[SYSTEM_PROPERTY_IDS.DUE_DATE] = {
            valueType: 'DATE',
            value: new Date(`${f.due_date}T12:00:00`),
          };
        const created = await createTaskWithProperties(
          f.title,
          f.body,
          Object.entries(properties),
          new Map(),
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
        const prior = emailDrafts.get(input.id);
        const message = {
          subject: f.subject,
          to: recipients(f).recipients.map((p) => ({
            email: p.email!,
            name: p.label,
          })),
          body_text: f.body,
          body_macro: f.body,
          db_id: prior?.draftId,
          thread_db_id: prior?.threadId,
        };
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
            ? () =>
                panel.handle.replace({
                  next: { type: 'email', id: sent.threadId! },
                })
            : undefined,
        };
      })
      .with('calendar', async () => {
        const calendar = selectedCalendar(f)!;
        const event = await createEvent.mutateAsync({
          title: f.title,
          calendarId: calendar.id,
          emailLinkId: calendar.emailLinkId,
          idempotencyKey: input.id,
          time: {
            kind: 'timed',
            startsAt: new Date(f.start).toISOString(),
            endsAt: new Date(f.end).toISOString(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
          location: f.location || undefined,
          attendees: resolveRecipients(f.guests, people(), true).recipients.map(
            (p) => ({ email: p.email! })
          ),
        });
        return {
          message: 'Event created',
          open: () =>
            panel.handle.replace({
              next: calendarViewContent({ eventId: event.id }),
            }),
        };
      })
      .with('message', async () => {
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
          message: { content: f.body },
        });
        return {
          message: 'Message sent',
          open: () =>
            panel.handle.replace({ next: { type: 'channel', id: channelId } }),
        };
      })
      .exhaustive();
  };
  return {
    submit,
    validate,
    people,
    destinations,
    recipients,
    calendars,
    selectedCalendar,
    selectedInbox,
    inboxes: email.accounts.inboxes,
    roster: roster.roster,
    agentsEnabled: () => agents().enabled,
    models,
    model,
    attachmentCount,
    clearAttachments: () => chat.attachments.setAttached([]),
  };
}
export type InputActions = ReturnType<typeof createInputActions>;
