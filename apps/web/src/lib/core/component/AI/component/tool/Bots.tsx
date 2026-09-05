import { MintCredential } from '@channel/Bots/MintCredential';
import Key from '@phosphor-icons/core/regular/key.svg';
import Link from '@phosphor-icons/core/regular/link.svg';
import List from '@phosphor-icons/core/regular/list.svg';
import PlugsConnected from '@phosphor-icons/core/regular/plugs-connected.svg';
import Robot from '@phosphor-icons/core/regular/robot.svg';
import SlidersHorizontal from '@phosphor-icons/core/regular/sliders-horizontal.svg';
import Trash from '@phosphor-icons/core/regular/trash.svg';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import type {
  BotOwnerSummary,
  BotSummary,
} from '@service-cognition/generated/tools/types';
import { createSignal, For, Show } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

type Detail = {
  label: string;
  value?: string | null;
  secret?: boolean;
};

function DetailPanel(props: { details: Detail[]; summary?: string }) {
  const details = () => props.details.filter((detail) => detail.value != null);

  return (
    <div class="rounded-lg border border-edge-muted bg-ink/[0.02] p-3">
      <Show when={props.summary}>
        <p class="mb-2 text-xs text-ink-muted">{props.summary}</p>
      </Show>
      <dl class="flex flex-col gap-2">
        <For each={details()}>
          {(detail) => (
            <div class="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 text-xs">
              <dt class="text-ink-extra-muted">{detail.label}</dt>
              <dd
                class="min-w-0 break-all text-ink"
                classList={{ 'select-all font-mono': detail.secret }}
              >
                {detail.value}
              </dd>
            </div>
          )}
        </For>
      </dl>
    </div>
  );
}

function ownerLabel(owner: BotOwnerSummary): string {
  return owner.type === 'team'
    ? `Team · ${owner.team_id}`
    : `User · ${owner.user_id}`;
}

function botDetails(bot: BotSummary): Detail[] {
  return [
    { label: 'Bot ID', value: bot.botId, secret: true },
    { label: 'Handle', value: `@${bot.handle}` },
    { label: 'Owner', value: ownerLabel(bot.owner) },
    { label: 'Description', value: bot.description },
    { label: 'Profile picture', value: bot.avatarUrl },
    { label: 'Coding agent', value: bot.hasAgent ? 'Yes' : 'No' },
  ];
}

type ListedBot = NamedTool<'ListBots', 'response'>['data']['bots'][number];

function BotList(props: { bots: ListedBot[] }) {
  return (
    <Tool.List>
      <div class="max-h-60 overflow-y-auto overscroll-contain">
        <For each={props.bots}>
          {(bot) => (
            <Tool.ListItem icon={<Robot class="size-4" />}>
              <div class="flex min-w-0 items-center justify-between gap-3">
                <div class="min-w-0">
                  <div class="truncate text-ink">{bot.name}</div>
                  <div class="truncate text-xxs text-ink-extra-muted">
                    @{bot.handle}
                  </div>
                </div>
                <span class="max-w-44 shrink-0 truncate text-ink-extra-muted">
                  {bot.owner.type === 'team' ? 'Team bot' : 'User bot'}
                </span>
              </div>
            </Tool.ListItem>
          )}
        </For>
      </div>
    </Tool.List>
  );
}

const listBotsHandler = createToolRenderer({
  name: 'ListBots',
  render: (ctx) => {
    const [expanded, setExpanded] = createSignal(false);
    const bots = () => ctx.response?.data.bots ?? [];
    const status = () => {
      if (!ctx.response) return undefined;
      return `${bots().length} bot${bots().length === 1 ? '' : 's'}`;
    };

    return (
      <BaseTool
        icon={List}
        renderContext={ctx.renderContext}
        type="call"
        response={
          expanded() && bots().length > 0 ? (
            <BotList bots={bots()} />
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span>List manageable bots</span>
          <Tool.ResultToggle
            expanded={expanded()}
            onToggle={() => setExpanded((value) => !value)}
            showToggle={bots().length > 0}
            status={status()}
          />
        </div>
      </BaseTool>
    );
  },
});

const createBotHandler = createToolRenderer({
  name: 'CreateBot',
  render: (ctx) => {
    const [expanded, setExpanded] = createSignal(false);
    const bot = () => ctx.response?.data.bot;
    const setup = () => ctx.response?.data.channelSetup;

    return (
      <BaseTool
        icon={Robot}
        renderContext={ctx.renderContext}
        type="call"
        response={
          expanded() && bot() ? (
            <div class="flex flex-col gap-2">
              <DetailPanel
                details={botDetails(bot()!)}
                summary={ctx.response?.data.summary}
              />
              <Show when={setup()}>
                {(channelSetup) => (
                  <div class="flex flex-col gap-2">
                    <DetailPanel
                      details={[
                        {
                          label: 'Webhook',
                          value: channelSetup().webhook.webhookUrl,
                          secret: true,
                        },
                        {
                          label: 'Channel ID',
                          value: channelSetup().channelId,
                        },
                        {
                          label: 'Token header',
                          value: channelSetup().credentialHeader,
                        },
                      ]}
                    />
                    <MintCredential
                      botId={bot()!.botId}
                      label={channelSetup().credentialLabel}
                      expiresAt={channelSetup().credentialExpiresAt}
                    />
                  </div>
                )}
              </Show>
            </div>
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span class="min-w-0 truncate">
            {ctx.response ? 'Created bot' : 'Create bot'}{' '}
            <span class="text-ink">@{ctx.tool.data.handle}</span>
          </span>
          <Tool.ResultToggle
            expanded={expanded()}
            onToggle={() => setExpanded((value) => !value)}
            showToggle={!!bot()}
            status={
              ctx.response
                ? setup()
                  ? 'Created · mint token'
                  : 'Created'
                : undefined
            }
          />
        </div>
      </BaseTool>
    );
  },
});

const issueBotCredentialHandler = createToolRenderer({
  name: 'IssueBotCredential',
  render: (ctx) => {
    const [expanded, setExpanded] = createSignal(false);
    const credential = () => ctx.response?.data;

    return (
      <BaseTool
        icon={Key}
        renderContext={ctx.renderContext}
        type="call"
        response={
          expanded() && credential() ? (
            <div class="flex flex-col gap-2">
              <DetailPanel
                summary={credential()!.summary}
                details={[
                  { label: 'Bot ID', value: credential()!.botId },
                  { label: 'Label', value: credential()!.label },
                  { label: 'Expires', value: credential()!.expiresAt },
                ]}
              />
              <MintCredential
                botId={credential()!.botId}
                label={credential()!.label}
                expiresAt={credential()!.expiresAt}
              />
            </div>
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span class="min-w-0 truncate">
            {ctx.response ? 'Issued' : 'Issue'} bot credential
            <Show when={ctx.tool.data.label}>
              {(label) => <> · {label()}</>}
            </Show>
          </span>
          <Tool.ResultToggle
            expanded={expanded()}
            onToggle={() => setExpanded((value) => !value)}
            showToggle={!!credential()}
            status={ctx.response ? 'Mint token' : undefined}
          />
        </div>
      </BaseTool>
    );
  },
});

const getBotWebhooksHandler = createToolRenderer({
  name: 'GetBotWebhooks',
  render: (ctx) => {
    const [expanded, setExpanded] = createSignal(false);
    const response = () => ctx.response?.data;
    const webhooks = () => response()?.webhooks ?? [];

    return (
      <BaseTool
        icon={Link}
        renderContext={ctx.renderContext}
        type="call"
        response={
          expanded() && response() ? (
            <div class="flex flex-col gap-2">
              <For each={webhooks()}>
                {(webhook) => (
                  <DetailPanel
                    details={[
                      {
                        label: webhook.channelName || 'Channel',
                        value: webhook.webhookUrl,
                        secret: true,
                      },
                      { label: 'Channel ID', value: webhook.channelId },
                    ]}
                  />
                )}
              </For>
              <Show when={webhooks().length === 0}>
                <DetailPanel details={[]} summary={response()!.summary} />
              </Show>
              <DetailPanel
                details={[
                  {
                    label: 'Token header',
                    value: response()!.credentialHeader,
                    secret: true,
                  },
                  {
                    label: 'Scope header',
                    value: response()!.credentialScopeHeader,
                  },
                  {
                    label: 'Scope value',
                    value: response()!.credentialScope,
                  },
                ]}
              />
            </div>
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span>Get bot webhooks</span>
          <Tool.ResultToggle
            expanded={expanded()}
            onToggle={() => setExpanded((value) => !value)}
            showToggle={!!response()}
            status={
              response()
                ? `${webhooks().length} webhook${webhooks().length === 1 ? '' : 's'}`
                : undefined
            }
          />
        </div>
      </BaseTool>
    );
  },
});

const manageBotChannelAccessHandler = createToolRenderer({
  name: 'ManageBotChannelAccess',
  render: (ctx) => {
    const [expanded, setExpanded] = createSignal(false);
    const response = () => ctx.response?.data;
    const granting = () => ctx.tool.data.action === 'grant';

    return (
      <BaseTool
        icon={PlugsConnected}
        renderContext={ctx.renderContext}
        type="call"
        response={
          expanded() && response() ? (
            <DetailPanel
              summary={response()!.summary}
              details={[
                { label: 'Bot ID', value: response()!.botId },
                { label: 'Channel ID', value: response()!.channelId },
              ]}
            />
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span>
            {granting()
              ? 'Grant bot channel access'
              : 'Revoke bot channel access'}
          </span>
          <Tool.ResultToggle
            expanded={expanded()}
            onToggle={() => setExpanded((value) => !value)}
            showToggle={!!response()}
            status={
              ctx.response ? (granting() ? 'Granted' : 'Revoked') : undefined
            }
          />
        </div>
      </BaseTool>
    );
  },
});

const configureBotHandler = createToolRenderer({
  name: 'ConfigureBot',
  render: (ctx) => {
    const [expanded, setExpanded] = createSignal(false);
    const response = () => ctx.response?.data;

    return (
      <BaseTool
        icon={SlidersHorizontal}
        renderContext={ctx.renderContext}
        type="call"
        response={
          expanded() && response() ? (
            <DetailPanel
              details={botDetails(response()!.bot)}
              summary={response()!.summary}
            />
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span>{ctx.response ? 'Configured bot' : 'Configure bot'}</span>
          <Tool.ResultToggle
            expanded={expanded()}
            onToggle={() => setExpanded((value) => !value)}
            showToggle={!!response()}
            status={
              ctx.response ? `@${ctx.response.data.bot.handle}` : undefined
            }
          />
        </div>
      </BaseTool>
    );
  },
});

const deleteBotHandler = createToolRenderer({
  name: 'DeleteBot',
  render: (ctx) => {
    const [expanded, setExpanded] = createSignal(false);
    const response = () => ctx.response?.data;

    return (
      <BaseTool
        icon={Trash}
        renderContext={ctx.renderContext}
        type="call"
        response={
          expanded() && response() ? (
            <DetailPanel
              details={[{ label: 'Bot ID', value: response()!.botId }]}
              summary={response()!.summary}
            />
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span>{ctx.response ? 'Deleted bot' : 'Delete bot'}</span>
          <Tool.ResultToggle
            expanded={expanded()}
            onToggle={() => setExpanded((value) => !value)}
            showToggle={!!response()}
            status={ctx.response ? 'Deleted' : undefined}
          />
        </div>
      </BaseTool>
    );
  },
});

export {
  configureBotHandler,
  createBotHandler,
  deleteBotHandler,
  getBotWebhooksHandler,
  issueBotCredentialHandler,
  listBotsHandler,
  manageBotChannelAccessHandler,
};
