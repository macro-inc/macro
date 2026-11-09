import {
  createContext,
  createSignal,
  type ParentProps,
  useContext,
} from 'solid-js';

type RecordingContentTab = 'summary' | 'transcript' | 'chat';

const RecordingViewContext = createContext<{
  contentTab: () => RecordingContentTab;
  setContentTab: (tab: RecordingContentTab) => void;
}>();

export function RecordingViewProvider(props: ParentProps) {
  const [contentTab, setContentTab] =
    createSignal<RecordingContentTab>('summary');
  return (
    <RecordingViewContext.Provider value={{ contentTab, setContentTab }}>
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
