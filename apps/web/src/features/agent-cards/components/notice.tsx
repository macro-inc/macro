import Info from '@phosphor/info.svg';
import WarningCircle from '@phosphor/warning-circle.svg';
import XCircle from '@phosphor/x-circle.svg';
import type { JSX } from 'solid-js';
import { Card, CardSingle } from './kit/card';
import { type CardTone, Tile } from './kit/parts';

/** How serious a notice is: something to know, something partial, a failure. */
export type NoticeTone = 'info' | 'warning' | 'error';

const TONES: Record<NoticeTone, { tile: CardTone; icon: () => JSX.Element }> = {
  info: { tile: 'neutral', icon: () => <Info /> },
  warning: { tile: 'warn', icon: () => <WarningCircle /> },
  error: { tile: 'bad', icon: () => <XCircle /> },
};

/**
 * Something about the run itself, as one row: what happened, what it means
 * for what you asked, and the one thing to do about it. Never good news -
 * success is a receipt.
 */
export function NoticeCard(props: {
  tone: NoticeTone;
  /** What happened, in plain words: `Couldn't finish this`. */
  title: string;
  /** What it means: `Retry runs your message again`. */
  detail?: string;
  /** The one action that fixes it. */
  action?: JSX.Element;
}) {
  const tone = () => TONES[props.tone];
  return (
    <Card width="compact" data-agent-card="notice">
      <div role={props.tone === 'error' ? 'alert' : 'status'} class="flex">
        <CardSingle
          tile={<Tile tone={tone().tile}>{tone().icon()}</Tile>}
          title={props.title}
          meta={props.detail}
          trailing={props.action}
        />
      </div>
    </Card>
  );
}
