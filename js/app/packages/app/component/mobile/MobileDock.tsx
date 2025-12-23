import WideChannel from '@macro-icons/wide/channel.svg';
import WideEmail from '@macro-icons/wide/email.svg';
import WideCode from '@macro-icons/wide/file-code.svg';
import WideFolder from '@macro-icons/wide/folder.svg';
import WidePlus from '@macro-icons/wide/plus.svg';
import type { Component, JSX } from 'solid-js';

type MobileDockButtonProps = {
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  label: string;
  onClick: () => void;
};

function MobileDockButton(props: MobileDockButtonProps) {
  return (
    <button onClick={props.onClick} class="flex flex-col items-center justify-center w-[20%] py-4">
      <props.icon class="w-6 h-6" />
      <span class="text-xs">{props.label}</span>
    </button>
  );
}

export function MobileDock() {
  return (
    <div class="flex flex-row justify-between bg-linear-to-t from-page to-panel border-t border-edge-muted">
      <MobileDockButton icon={WideCode} label="Search" onClick={() => {}} />
      <MobileDockButton icon={WideEmail} label="Inbox" onClick={() => {}} />
      <MobileDockButton icon={WideChannel} label="Home" onClick={() => {}} />
      <MobileDockButton icon={WideFolder} label="Home" onClick={() => {}} />
      <MobileDockButton icon={WidePlus} label="Create" onClick={() => {}} />
    </div>
  );
}
