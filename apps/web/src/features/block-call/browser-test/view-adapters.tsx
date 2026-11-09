import { ButtonGroup } from '@ui';
import {
  createContext,
  createSignal,
  type JSX,
  type ParentProps,
} from 'solid-js';

export const useCallContextOptional = () => undefined;
export const useCallAgain = () => ({
  canCallAgain: () => true,
  callAgain: () => {},
});
export const AskMacroButton = () => (
  <ButtonGroup.Button>Ask Macro</ButtonGroup.Button>
);
export const InlineFetchedEntityTagsPill = () => null;
export const CallRecordingMobileActions = () => null;
export const CallRecordingMobilePlayback = () => null;
export const CallRecordingChat = () => null;
export const CustomScrollbar = () => null;
export const getDisplayName = () => 'Guest';
export const tryMacroId = () => undefined;
export const useMaybeBlockAliasedName = () => undefined;
export const usePreference = (_key: string, options: { default: boolean }) =>
  createSignal(options.default);
export const useSplitPanel = () => undefined;
export const registerHotkey = () => {};
export const SplitHeaderRight = (props: ParentProps) => props.children;
export const HeaderIsland = (props: ParentProps) => props.children;
export const ResizeZoneContext = createContext({
  size: () => window.innerWidth,
});
export const Resize = {
  Zone: (props: ParentProps) => (
    <ResizeZoneContext.Provider value={{ size: () => window.innerWidth }}>
      <div class="size-full">{props.children}</div>
    </ResizeZoneContext.Provider>
  ),
  Panel: (props: ParentProps) => <div class="size-full">{props.children}</div>,
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
export const StaticMarkdown = (props: { markdown: string }) => (
  <div class="whitespace-pre-wrap">{props.markdown}</div>
);
export const StaticMarkdownContext = (props: ParentProps) => props.children;
