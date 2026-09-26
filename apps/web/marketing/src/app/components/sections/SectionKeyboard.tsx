import { Show } from 'solid-js';
import { breakpoint } from '../../utils/utilBreakpoint';
import { SceneKeyboard } from '../scenes/SceneKeyboard';

export function SectionKeyboard() {
  const textBlock = (
    <div
      style={{
        'max-width': '600px',
        display: 'grid',
        width: '100%',
        gap: '20px',
      }}
    ></div>
  );

  const sceneBlock = (
    <div
      style={{
        width: breakpoint() ? '130%' : '100%',
        'margin-left': breakpoint() ? '-14%' : '0',
        'margin-top': breakpoint() ? '-40px' : '-50px',
        'margin-bottom': breakpoint() ? '20px' : '0',
      }}
    >
      <SceneKeyboard />
    </div>
  );

  return (
    <div
      style={{
        display: 'grid',
        gap: '20px',
      }}
    >
      <Show when={!breakpoint()}>
        {textBlock}
        {sceneBlock}
      </Show>
    </div>
  );
}
