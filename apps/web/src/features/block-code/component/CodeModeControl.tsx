import { TabsInset } from '@core/component/TabsInset';
import type { CodeBlockMode } from './CodeContent';

export function CodeModeControl(props: {
  mode: CodeBlockMode;
  onModeChange: (mode: CodeBlockMode) => void;
}) {
  return (
    <TabsInset
      aria-label="HTML views"
      class="shrink-0 whitespace-nowrap"
      list={[
        { value: 'render', label: 'Render' },
        { value: 'code', label: 'Code' },
      ]}
      value={props.mode}
      onChange={(value) => props.onModeChange(value as CodeBlockMode)}
    />
  );
}
