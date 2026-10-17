import { type Span, Telemetry } from '@macro-inc/observability';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import { match } from 'ts-pattern';
import type {
  OutgoingMessage,
  ShareDeliveryContext,
} from '../context/share-delivery-context';
import {
  canSendAsGroup,
  type DeliveryLedger,
  emptyLedger,
  emptyRecord,
  type GrantStep,
  type PickedRecipient,
  planShare,
  prefillChannel,
  remainingWork,
  type ShareNotice,
  type ShareOutcome,
  type SharePlan,
  shareEvents,
  shareNotices,
  summarizeShare,
  type TargetKey,
  type TargetRecord,
  type TargetWork,
  targetsFor,
  withDelivery,
  withGrant,
} from '../core/delivery-plan';
import {
  type ChannelAccessLevel,
  levelChoice,
  type ShareItem,
  shareAccess,
} from '../core/share-item';

export type ShareLocation = 'forward_to_channel' | 'bulk_share';

export type ShareFormOptions = {
  readonly items: Accessor<readonly ShareItem[]>;
  readonly location: ShareLocation;
  readonly markdownComments: boolean;
  readonly mintMessageId: () => string;
};

export type ShareFormStatus =
  | { readonly t: 'editing' }
  | {
      readonly t: 'sending';
      readonly plan: SharePlan;
      readonly previousOutcome: ShareOutcome | undefined;
    }
  | {
      readonly t: 'incomplete';
      readonly plan: SharePlan;
      readonly outcome: ShareOutcome;
    }
  | {
      readonly t: 'complete';
      readonly plan: SharePlan;
      readonly outcome: ShareOutcome;
    };

export type ShareSubmitResult = {
  readonly outcome: ShareOutcome;
  readonly open?: () => void;
};

type TargetRun = {
  readonly key: TargetKey;
  readonly record: TargetRecord;
  readonly open: (() => void) | undefined;
};

export type LevelField = {
  readonly options: readonly ChannelAccessLevel[];
  readonly value: ChannelAccessLevel;
};

export type ShareForm<Recipient extends PickedRecipient> = {
  readonly recipients: Accessor<Recipient[]>;
  readonly setRecipients: (recipients: readonly Recipient[]) => void;
  readonly group: Accessor<{ readonly on: boolean } | undefined>;
  readonly setGroup: (on: boolean) => void;
  readonly locked: Accessor<boolean>;
  readonly level: Accessor<LevelField | undefined>;
  readonly setLevel: (level: ChannelAccessLevel) => void;
  readonly setText: (text: string) => void;
  readonly sendable: Accessor<boolean>;
  readonly notices: Accessor<readonly ShareNotice[]>;
  readonly triedToSubmit: Accessor<boolean>;
  readonly status: Accessor<ShareFormStatus>;
  readonly submit: () => Promise<ShareSubmitResult | undefined>;
};

export function createShareForm<Recipient extends PickedRecipient>(
  options: ShareFormOptions,
  context: ShareDeliveryContext
): ShareForm<Recipient> {
  const [recipients, setRecipientList] = createSignal<Recipient[]>([]);
  const [groupOn, setGroupOn] = createSignal(true);
  const [pickedLevel, setPickedLevel] = createSignal<ChannelAccessLevel>();
  const [text, setTextValue] = createSignal('');
  const [triedToSubmit, setTriedToSubmit] = createSignal(false);
  const [status, setStatus] = createSignal<ShareFormStatus>({ t: 'editing' });
  const locked = () => status().t !== 'editing';

  let ledger: DeliveryLedger = emptyLedger;
  const opens = new Map<TargetKey, () => void>();

  const choice = createMemo(() =>
    levelChoice(options.items(), {
      prefillChannelId: prefillChannel(recipients()),
      markdownComments: options.markdownComments,
    })
  );

  const level = createMemo((): LevelField | undefined => {
    const current = choice();
    if (!current) return undefined;
    const now = status();
    if (now.t !== 'editing') {
      return { options: current.options, value: now.plan.request.level };
    }
    const picked = pickedLevel();
    const value =
      picked !== undefined && current.options.includes(picked)
        ? picked
        : current.initial;
    return { options: current.options, value };
  });

  const group = createMemo(() =>
    canSendAsGroup(recipients()) ? { on: groupOn() } : undefined
  );

  const sendable = createMemo(() =>
    options.items().some((item) => shareAccess(item).t !== 'cannot-send')
  );

  const notices = createMemo(() =>
    shareNotices(options.items(), level()?.value ?? 'view')
  );

  async function grantAll(
    record: TargetRecord,
    steps: readonly GrantStep[],
    span: Span
  ) {
    const results = await Promise.all(
      steps.map(async (step) => ({
        ...step,
        result: await context.changeChannelAccess(
          step.item,
          { t: 'set', channelId: record.channelId, level: step.level },
          span
        ),
      }))
    );
    return {
      record: results.reduce(withGrant, record),
      allGranted: results.every(({ result }) => result.isOk()),
    };
  }

  function findChannel(userIds: readonly string[], target: Span) {
    return target.span('share.find_channel', async (span) => {
      const channel = await context.resolvePeopleChannel(userIds, span);
      if (channel.isErr()) span.error('No channel for the recipients');
      return channel;
    });
  }

  function post(message: OutgoingMessage, target: Span) {
    return target.span('share.send_message', async (span) => {
      span.setAttr('message.id', message.messageId);
      span.setAttr('share.items', message.items.length);
      const sent = await context.send(message, span);
      if (sent.isErr()) span.error('Message was not sent');
      return sent;
    });
  }

  async function runTarget(
    work: TargetWork,
    span: Span
  ): Promise<TargetRun | undefined> {
    span.setAttr('share.messages', work.unsentMessages.length);
    span.setAttr('share.pending_grants', work.pendingGrants.length);
    let record: TargetRecord;
    if (work.channel.t === 'known') {
      record = work.channel.record;
    } else {
      span.setAttr('share.recipients', work.channel.userIds.length);
      const channel = await findChannel(work.channel.userIds, span);
      if (channel.isErr()) {
        span.error('No channel for the recipients');
        return undefined;
      }
      record = emptyRecord(channel.value);
    }
    span.setAttr('channel.id', record.channelId);
    let open: (() => void) | undefined;
    if (work.pendingGrants.length > 0) {
      record = (await grantAll(record, work.pendingGrants, span)).record;
    }
    let sentCount = 0;
    for (const message of work.unsentMessages) {
      if (message.grantFirst.length > 0) {
        const first = await grantAll(record, message.grantFirst, span);
        record = first.record;
        if (!first.allGranted) break;
      }
      const sent = await post(
        {
          channelId: record.channelId,
          messageId: message.id,
          items: message.items,
          text: message.text,
        },
        span
      );
      if (sent.isErr()) {
        span.error('Message was not sent');
        break;
      }
      sentCount++;
      record = withDelivery(record, message.id);
      open ??= sent.value.open;
      record = (await grantAll(record, message.grantAfter, span)).record;
    }
    span.setAttr('share.sent', sentCount);
    span.setAttr('share.grant_errors', record.grantErrors.size);
    return { key: work.key, record, open };
  }

  function freeze(): SharePlan | undefined {
    const targets = targetsFor(recipients(), groupOn());
    if (targets.length === 0 || !sendable()) {
      setTriedToSubmit(true);
      return undefined;
    }
    return planShare(
      {
        items: options.items(),
        targets,
        text: text(),
        level: level()?.value ?? 'view',
      },
      options.mintMessageId
    );
  }

  async function submit(): Promise<ShareSubmitResult | undefined> {
    const attempt = match(status())
      .with({ t: 'editing' }, () => {
        const plan = freeze();
        return plan && { plan, previousOutcome: undefined };
      })
      .with({ t: 'incomplete' }, ({ plan, outcome }) => ({
        plan,
        previousOutcome: outcome,
      }))
      .with({ t: 'sending' }, { t: 'complete' }, () => undefined)
      .exhaustive();
    if (!attempt) return undefined;

    const { plan } = attempt;
    return Telemetry.span('share.submit', async (span) => {
      span.setAttr('share.location', options.location);
      span.setAttr(
        'entity.ids',
        plan.request.items.map(({ id }) => id)
      );
      span.setAttr('share.items', plan.request.items.length);
      span.setAttr('share.targets', plan.targets.length);
      span.setAttr('share.retry', attempt.previousOutcome !== undefined);
      setStatus({ t: 'sending', ...attempt });
      const before = ledger;
      const runs = await Promise.allSettled(
        remainingWork(plan, before).map((work) =>
          span.span('share.target', (target) => runTarget(work, target))
        )
      );
      const finished = runs.flatMap((run) =>
        run.status === 'fulfilled' && run.value ? [run.value] : []
      );
      ledger = new Map([
        ...before,
        ...finished.map(({ key, record }) => [key, record] as const),
      ]);
      for (const { key, open } of finished) {
        if (open && !opens.has(key)) opens.set(key, open);
      }
      const outcome = summarizeShare(plan, ledger);
      span.setAttr('share.complete', outcome.complete);
      span.setAttr('share.retryable', outcome.retryable);
      setStatus(
        outcome.complete
          ? { t: 'complete', plan, outcome }
          : { t: 'incomplete', plan, outcome }
      );
      for (const event of shareEvents(plan, before, ledger))
        context.track(event);
      const rejected = runs.find((run) => run.status === 'rejected');
      if (rejected) {
        span.error(rejected.reason);
        throw rejected.reason;
      }
      return {
        outcome,
        open:
          plan.targets.length === 1
            ? opens.get(plan.targets[0].key)
            : undefined,
      };
    });
  }

  return {
    recipients,
    setRecipients: (next) => {
      if (!locked()) setRecipientList([...next]);
    },
    group,
    setGroup: (on) => {
      if (!locked()) setGroupOn(on);
    },
    locked,
    level,
    setLevel: (next) => {
      if (!locked()) setPickedLevel(next);
    },
    setText: (next) => {
      if (!locked()) setTextValue(next);
    },
    sendable,
    notices,
    triedToSubmit,
    status,
    submit,
  };
}
