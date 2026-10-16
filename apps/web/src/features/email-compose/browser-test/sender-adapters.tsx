// Browser-only account/navigation adapters. The From and sidebar controls are
// production components; no real inboxes or messages are modified by this fixture.
import { createSignal, type JSX, splitProps } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { SenderInbox } from '../core/email-sender';

export const [fixtureInboxes, setFixtureInboxes] = createSignal<SenderInbox[]>(
  []
);
export const [fixtureScope, setFixtureScope] = createStore<{
  inboxIds?: string[];
  aliasFilter?: { inboxId: string; emailAddress: string };
}>({});
export const useMailAccountsQuery = () => ({
  isSuccess: true,
  get data() {
    return { links: fixtureInboxes() };
  },
});
export const useFeatureFlag = () => () => ({ enabled: true });
export const useAddInboxFlow = () => async () => {};
export const useEmailView = () => ({
  state: fixtureScope,
  setInboxIds: (inboxIds: string[] | undefined) =>
    setFixtureScope({ inboxIds, aliasFilter: undefined }),
  setAliasFilter: (aliasFilter: { inboxId: string; emailAddress: string }) =>
    setFixtureScope({ inboxIds: [aliasFilter.inboxId], aliasFilter }),
});
export const inboxIconProps = (email: string) => ({ email });
export function UserIcon(props: { email?: string; class?: string }) {
  return (
    <span
      aria-hidden="true"
      class={`inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-active text-xs ${props.class ?? ''}`}
    >
      {props.email?.[0]?.toUpperCase()}
    </span>
  );
}
function Item(
  props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }
) {
  const [local, rest] = splitProps(props, ['active', 'class']);
  return (
    <button
      {...rest}
      class={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left ${local.active ? 'bg-active' : ''} ${local.class ?? ''}`}
    />
  );
}
export const ViewSidebar = {
  Nav: (props: JSX.HTMLAttributes<HTMLElement>) => <nav {...props} />,
  Item,
  Icon: (props: JSX.HTMLAttributes<HTMLSpanElement>) => <span {...props} />,
};
export const MobileFilterDrawer = {};
