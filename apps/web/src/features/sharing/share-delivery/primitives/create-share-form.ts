import { type Accessor, createMemo, createSignal } from 'solid-js';
import { match } from 'ts-pattern';
import type { ShareDeliveryContext } from '../context/share-delivery-context';
import {
  canSendAsGroup,
  type DeliveryLedger,
  emptyLedger,
  type GrantStep,
  type PickedRecipient,
  type PlannedMessage,
  planShare,
  prefillChannel,
  recordDelivery,
  recordGrant,
  remainingWork,
  type ShareNotice,
  type ShareOutcome,
  type SharePlan,
  shareEvents,
  shareNotices,
  summarizeShare,
  type TargetKey,
  type TargetWork,
  targetsFor,
} from '../core/delivery-plan';
import {
  type ChannelAccessLevel,
  levelChoice,
  type ShareItem,
  shareAccess,
} from '../core/share-item';

export type ShareFormOptions = {
  readonly items: Accessor<readonly ShareItem[]>;
  readonly markdownComments: boolean;
  readonly mintMessageId: () => string;
};

export type ShareFormStatus =
  | { readonly t: 'editing' }
  | { readonly t: 'sending'; readonly plan: SharePlan }
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
    key: TargetKey,
    channelId: string,
    steps: readonly GrantStep[]
  ): Promise<boolean> {
    const granted = await Promise.all(
      steps.map(async (step) => {
        const result = await context.changeChannelAccess(step.item, {
          t: 'set',
          channelId,
          level: step.level,
        });
        ledger = recordGrant(ledger, key, {
          channelId,
          item: step.item,
          level: step.level,
          result,
        });
        return result.isOk();
      })
    );
    return granted.every(Boolean);
  }

  async function post(work: TargetWork, message: PlannedMessage) {
    const channelId = ledger.get(work.key)?.channelId;
    const beforeSend =
      message.grantFirst.length === 0
        ? undefined
        : async (resolved: string) => {
            if (!(await grantAll(work.key, resolved, message.grantFirst))) {
              throw new Error('A grant this message needs failed');
            }
          };
    try {
      return await context.send({
        to: channelId === undefined ? work.target : { t: 'channel', channelId },
        messageId: message.id,
        items: message.items,
        text: message.text,
        beforeSend,
      });
    } catch {
      return undefined;
    }
  }

  async function runTarget(work: TargetWork): Promise<void> {
    const known = ledger.get(work.key)?.channelId;
    if (known !== undefined) await grantAll(work.key, known, work.grants);
    for (const message of work.messages) {
      const sent = await post(work, message);
      if (!sent) return;
      ledger = recordDelivery(ledger, work.key, {
        channelId: sent.channelId,
        messageId: message.id,
      });
      if (!opens.has(work.key)) opens.set(work.key, sent.open);
      await grantAll(work.key, sent.channelId, message.grantAfter);
    }
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
    const plan = match(status())
      .with({ t: 'editing' }, () => freeze())
      .with({ t: 'incomplete' }, (incomplete) => incomplete.plan)
      .with({ t: 'sending' }, { t: 'complete' }, () => undefined)
      .exhaustive();
    if (!plan) return undefined;

    setStatus({ t: 'sending', plan });
    const before = ledger;
    await Promise.all(remainingWork(plan, before).map(runTarget));
    for (const event of shareEvents(plan, before, ledger)) context.track(event);
    const outcome = summarizeShare(plan, ledger);
    setStatus(
      outcome.complete
        ? { t: 'complete', plan, outcome }
        : { t: 'incomplete', plan, outcome }
    );
    return {
      outcome,
      open:
        plan.targets.length === 1 ? opens.get(plan.targets[0].key) : undefined,
    };
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
