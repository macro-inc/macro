import { Tabs } from '@ui/components/Tabs';
import type { CodeBlockMode } from './CodeContent';

export function CodeModeControl(props: {
  mode: CodeBlockMode;
  onModeChange: (mode: CodeBlockMode) => void;
}) {
  return (
    <div class="w-full min-w-0 shrink-0 overflow-x-auto scrollbar-hidden px-4 py-2">
      <Tabs
        aria-label="HTML views"
        class="w-max whitespace-nowrap"
        list={[
          { value: 'render', label: 'Render' },
          { value: 'code', label: 'Code' },
        ]}
        value={props.mode}
        onChange={(value) => props.onModeChange(value as CodeBlockMode)}
      />
    </div>
  );
}
