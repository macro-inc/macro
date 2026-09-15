import { SidebarCreateHeader } from '@app/components/view-shell/SidebarCreateButton';

export function InboxHeader(props: { onNewChat: () => void }) {
  return <SidebarCreateHeader label="New chat" onCreate={props.onNewChat} />;
}
