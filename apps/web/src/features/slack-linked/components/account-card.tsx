import SignInIcon from '@phosphor/arrow-clockwise.svg';
import DesktopIcon from '@phosphor/desktop.svg';
import DotsThreeIcon from '@phosphor/dots-three.svg';
import LinkBreakIcon from '@phosphor/link-break.svg';
import WarningIcon from '@phosphor/warning-circle.svg';
import { Button, Dropdown, Item } from '@ui';
import { Show } from 'solid-js';
import {
  accountStateLabel,
  endedReasonMessage,
  type SlackAccount,
} from '../core/account';
import { SlackMark, SlackTile } from './slack-tile';

/**
 * Nothing connected: what connecting means, and Sign in. Email sign-in works
 * everywhere; SSO workspaces need Slack's own page, which only Macro desktop
 * can show.
 */
export function ConnectCard(props: {
  /** This is Macro desktop, which can show Slack's own sign-in. */
  desktop: boolean;
  pending: boolean;
  onSignIn: () => void;
}) {
  return (
    <Item variant="outlined" class="touch:flex-wrap">
      <SlackTile />
      <Item.Content>
        <Item.Title>Slack</Item.Title>
        <Item.Description>
          Bring Slack Connect channels and DMs, shared with people at other
          companies, into Macro. Only conversations you add come into Macro.
        </Item.Description>
        <Show when={!props.desktop}>
          <Item.Description class="flex items-center gap-1.5">
            <DesktopIcon class="size-3.5 shrink-0" aria-hidden="true" />
            Workspaces that sign in with SSO connect from Macro desktop.
          </Item.Description>
        </Show>
      </Item.Content>
      <Item.Actions class="self-center touch:w-full touch:justify-stretch touch:*:flex-1">
        <Button
          type="button"
          variant="primary"
          disabled={props.pending}
          onClick={props.onSignIn}
        >
          Sign in to Slack
        </Button>
      </Item.Actions>
    </Item>
  );
}

/** A workspace whose session Slack ended: its chats stay, sign in again. */
export function SessionEndedCard(props: {
  account: SlackAccount;
  onSignIn: () => void;
}) {
  return (
    <Item variant="outlined" data-slack-session-ended={props.account.id}>
      <Item.Media class="bg-failure-bg text-failure-ink">
        <WarningIcon />
      </Item.Media>
      <Item.Content>
        <Item.Title>Slack · {props.account.teamName}</Item.Title>
        <Item.Description>
          {endedReasonMessage(
            props.account.teamName,
            props.account.endedReason
          )}
        </Item.Description>
        <Item.Description>
          Its chats stay in Macro with their history. New messages wait until
          you sign in.
        </Item.Description>
      </Item.Content>
      <Show when={props.account.endedReason !== 'team_disabled'}>
        <Item.Actions class="self-center">
          <Button type="button" variant="primary" onClick={props.onSignIn}>
            Sign in again
          </Button>
        </Item.Actions>
      </Show>
    </Item>
  );
}

/** One signed-in workspace as a slim strip above its conversations. */
export function WorkspaceStrip(props: {
  account: SlackAccount;
  pending: boolean;
  onDisconnect: () => void;
  onSignInAgain: () => void;
}) {
  return (
    <div
      class="flex min-w-0 shrink-0 items-center gap-2 text-sm"
      data-slack-account={props.account.id}
    >
      <SlackMark />
      <span class="ph-no-capture truncate font-medium text-ink">
        {props.account.teamName}
      </span>
      <span class="shrink-0 truncate text-ink-extra-muted touch:hidden">
        {props.account.teamDomain}
      </span>
      <span
        class="shrink-0"
        classList={{
          'text-ink-extra-muted': props.account.state !== 'logged_out',
          'text-failure-ink': props.account.state === 'logged_out',
        }}
      >
        {accountStateLabel(props.account.state)}
      </span>
      <Dropdown placement="bottom-end">
        <Dropdown.Trigger
          variant="ghost"
          size="icon-sm"
          class="text-ink-muted hover:text-ink"
          aria-label={`${props.account.teamName} options`}
          disabled={props.pending}
        >
          <DotsThreeIcon class="size-4" />
        </Dropdown.Trigger>
        <Dropdown.Content class="min-w-52">
          <Dropdown.Group>
            <Dropdown.Item onSelect={props.onSignInAgain}>
              <SignInIcon class="size-4" />
              Sign in again
            </Dropdown.Item>
            <Dropdown.Item
              class="text-failure data-highlighted:bg-failure-bg"
              onSelect={props.onDisconnect}
            >
              <LinkBreakIcon class="size-4" />
              Disconnect
            </Dropdown.Item>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
    </div>
  );
}
