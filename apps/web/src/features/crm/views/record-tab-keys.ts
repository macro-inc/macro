import { useViewTabHotkeys } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { createSignal } from 'solid-js';
import type { CrmRecordSection } from '../core/record';

/**
 * Tab, Shift+Tab and 1–9 for a record's section tabs in its host's top bar.
 * Returns the ref the tabs take.
 */
export function useRecordTabKeys<S extends CrmRecordSection>(props: {
  sections: () => readonly S[];
  value: () => S;
  onChange: (section: S) => void;
}) {
  const [tabs, setTabs] = createSignal<HTMLElement>();
  const panel = useSplitPanel();
  if (panel) {
    useViewTabHotkeys<S>({
      scopeId: panel.splitHotkeyScope,
      enabled: panel.isPanelActive,
      tabs,
      ids: props.sections,
      activeId: props.value,
      setActiveId: props.onChange,
      label: (section) => t(`tabs.record-${section}`),
    });
  }
  return setTabs;
}
