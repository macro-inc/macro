import type { JSX } from 'solid-js';

/** App-owned capabilities shared by the explicit desktop and mobile views. */
export type PrPageViewProps = {
  hosted?: boolean;
  fileMenu?: JSX.Element;
  share: () => void;
  shareEnabled?: boolean;
  shareModal?: JSX.Element;
  onTask: (id: string, event: MouseEvent) => void;
};
