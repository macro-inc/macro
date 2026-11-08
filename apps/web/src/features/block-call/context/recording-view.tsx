import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createElementSize } from '@solid-primitives/resize-observer';
import {
  createContext,
  createSignal,
  type ParentProps,
  useContext,
} from 'solid-js';
import { createRecordingView } from '../primitives/recording-view';

const RecordingViewContext = createContext<
  ReturnType<typeof createRecordingView> & {
    callId: string;
    setPane: (element: HTMLDivElement) => void;
  }
>();

export function RecordingViewProvider(props: ParentProps<{ callId: string }>) {
  const [pane, setPane] = createSignal<HTMLDivElement>();
  const size = createElementSize(pane);
  const view = createRecordingView(
    () => !isTouchDevice() && (size.width ?? 0) >= 960
  );
  return (
    <RecordingViewContext.Provider
      value={{
        ...view,
        get callId() {
          return props.callId;
        },
        setPane,
      }}
    >
      {props.children}
    </RecordingViewContext.Provider>
  );
}

export function useRecordingView() {
  const view = useContext(RecordingViewContext);
  if (!view)
    throw new Error('RecordingViewProvider is required for saved call details');
  return view;
}
