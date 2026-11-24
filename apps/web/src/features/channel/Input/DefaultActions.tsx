import { isPlatform } from '@core/util/platform';
import { type JSX, Show } from 'solid-js';
import type { DictationController } from '../../dictation/core/types';
import type { VoiceMemoController } from '../../dictation/core/voice-memo';
import { Input } from './Input';
import { MicrophoneAction } from './MicrophoneAction';
import { type InputData, isReplyInput } from './types';

/** The composer's own action row, for hosts that bring none of their own. */
export function DefaultActions(props: {
  input: InputData;
  addMenu: JSX.Element;
  dictation: DictationController;
  voiceMemo: VoiceMemoController;
  showDictation: boolean;
  showVoiceMemo: boolean;
}) {
  return (
    <>
      <Input.Layout.ActionsLeft>
        {props.addMenu}
        <Show when={isReplyInput(props.input)}>
          <Input.CloseReplyAction />
        </Show>
      </Input.Layout.ActionsLeft>
      <Input.Layout.ActionsRight>
        <MicrophoneAction
          dictation={props.dictation}
          memo={props.voiceMemo}
          // The iOS keyboard dictates on its own; the microphone records memos.
          showDictation={props.showDictation && !isPlatform('ios')}
          showMemo={props.showVoiceMemo}
        />
        <Input.SendAction />
      </Input.Layout.ActionsRight>
    </>
  );
}
