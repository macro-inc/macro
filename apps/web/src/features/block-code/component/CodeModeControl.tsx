import { Tabs } from '@ui';
import type { CodeBlockMode } from './CodeContent';

export function CodeModeControl(props: {
  mode: CodeBlockMode;
  onModeChange: (mode: CodeBlockMode) => void;
}) {
  return (
    <Tabs
      aria-label="HTML views"
      touch="inset"
      class="shrink-0"
      options={[
        { value: 'render', label: 'Render' },
        { value: 'code', label: 'Code' },
      ]}
      value={props.mode}
      onChange={props.onModeChange}
    />
  );
}
