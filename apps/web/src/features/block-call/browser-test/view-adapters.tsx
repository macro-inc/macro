import type { JSX, ParentProps } from 'solid-js';

export const useCallContextOptional = () => undefined;
export const useCallAgain = () => ({
  canCallAgain: () => false,
  callAgain: () => {},
});
export const AskMacroButton = () => null;
export const InlineFetchedEntityTagsPill = () => null;
export const CallRecordingMobileActions = () => null;
export const CallRecordingMobilePlayback = () => null;
export const CallRecordingChat = () => null;
export const CustomScrollbar = () => null;
export const getDisplayName = () => 'Guest';
export const tryMacroId = () => undefined;
export const CallRecordingSummarySection = () => <p>Stored summary fixture</p>;
export const useSidePanel = () => undefined;
export const SidePanel = {
  Layout: (props: ParentProps) => props.children,
  HeaderActions: () => null,
};
export const CallDiscussionHistory = (props: {
  render: (source: {
    thread: () => undefined;
    loading: () => boolean;
  }) => JSX.Element;
}) => props.render({ thread: () => undefined, loading: () => false });
export const Message = {
  Root: (props: ParentProps<{ class?: string }>) => (
    <div class={props.class}>{props.children}</div>
  ),
  SenderIcon: () => <span>G</span>,
  SenderName: () => <span>Guest</span>,
  Content: () => null,
  Attachments: () => null,
};
export const StaticMarkdownContext = (props: ParentProps) => props.children;
