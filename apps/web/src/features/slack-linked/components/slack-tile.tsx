import SlackIcon from '@phosphor/slack-logo.svg';
import { Item } from '@ui';

/** Slack's aubergine tile beside its cards. */
export function SlackTile() {
  return (
    <Item.Media class="bg-[#4A154B] text-[#fff]">
      <SlackIcon />
    </Item.Media>
  );
}

/** The small Slack mark beside a workspace's name. */
export function SlackMark() {
  return (
    <span
      aria-hidden="true"
      class="flex size-5 shrink-0 items-center justify-center rounded-md bg-[#4A154B] text-[#fff]"
    >
      <SlackIcon class="size-3.5" />
    </span>
  );
}
