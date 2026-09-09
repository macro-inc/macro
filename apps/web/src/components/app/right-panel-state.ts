import { resolveBlockAlias } from '@core/constant/allBlocks';
import { batch, createSignal } from 'solid-js';
import type { RightPanelContent } from './right-panel-context';
export type RightPanelSnapshot = {
  tabs: Array<{ key: string; content: RightPanelContent; title: string }>;
  active?: string;
  expanded: boolean;
};

export function createRightPanelState(
  options: {
    initial?: RightPanelSnapshot;
    onChange?: (snapshot: RightPanelSnapshot) => void;
  } = {}
) {
  const [tabs, setTabs] = createSignal(options.initial?.tabs ?? []);
  const [active, setActive] = createSignal(options.initial?.active);
  const [expanded, setExpanded] = createSignal(
    options.initial?.expanded ?? false
  );
  const save = () =>
    options.onChange?.({
      tabs: tabs(),
      active: active(),
      expanded: expanded(),
    });
  const open = (content: RightPanelContent) =>
    batch(() => {
      const key = `${resolveBlockAlias(content.type)}:${content.id}`;
      setTabs((previous) =>
        previous.some((tab) => tab.key === key)
          ? previous.map((tab) => (tab.key === key ? { ...tab, content } : tab))
          : [...previous, { key, content, title: 'Loading…' }]
      );
      setActive(key);
      setExpanded(true);
      save();
    });
  const close = (key: string) =>
    batch(() => {
      const before = tabs();
      const index = before.findIndex((tab) => tab.key === key);
      const remaining = before.filter((tab) => tab.key !== key);
      setTabs(remaining);
      if (active() === key)
        setActive(remaining[Math.min(index, remaining.length - 1)]?.key);
      if (!remaining.length) setExpanded(false);
      save();
    });
  const rename = (key: string, title: string) => {
    if (!tabs().some((tab) => tab.key === key && tab.title !== title)) return;
    setTabs((previous) =>
      previous.map((tab) =>
        tab.key === key && tab.title !== title ? { ...tab, title } : tab
      )
    );
    save();
  };
  return {
    tabs,
    active,
    expanded,
    open,
    close,
    rename,
    select: (key: string) => {
      if (!tabs().some((tab) => tab.key === key)) return;
      setActive(key);
      save();
    },
    setExpanded: (value: boolean) => {
      setExpanded(value && tabs().length > 0);
      save();
    },
  };
}
