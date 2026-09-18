import { TabbedControl } from '@ui';
import type { CodeBlockMode } from './CodeContent';

export function CodeModeControl(props: {
  mode: CodeBlockMode;
  onModeChange: (mode: CodeBlockMode) => void;
}) {
  return (
    <TabbedControl
      list={[
        { value: 'render', label: 'Render' },
        { value: 'code', label: 'Code' },
      ]}
      value={props.mode}
      onChange={(value) => props.onModeChange(value as CodeBlockMode)}
    />
  );
}
