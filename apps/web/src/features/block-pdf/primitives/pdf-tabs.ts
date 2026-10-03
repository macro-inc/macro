import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';

export type TabInfo = {
  label: string;
  locationHash?: string;
  id: number;
};

const initialTab = (): TabInfo => ({
  id: 0,
  label: 'Page 1',
  locationHash: '#page=1',
});

export function createPdfTabs() {
  const [items, setItems] = createStore<TabInfo[]>([initialTab()]);
  const [activeId, setActiveId] = createSignal(0);
  const [isVisible, setIsVisible] = createSignal(false);
  let nextId = 0;
  let history = [0];

  const commands = {
    create(info: Omit<TabInfo, 'id'>) {
      nextId += 1;
      const id = nextId;
      setItems([...items, { ...info, id }]);
      setIsVisible(true);
      return id;
    },
    activate(id: number) {
      if (!items.some((tab) => tab.id === id)) return false;
      setActiveId(id);
      history = [...history, id];
      return true;
    },
    updateCurrent(info: Omit<TabInfo, 'id'>) {
      const index = items.findIndex((tab) => tab.id === activeId());
      if (index === -1) return false;

      setItems(index, 'label', info.label);
      if (info.locationHash) {
        setItems(index, 'locationHash', info.locationHash);
      }
      return true;
    },
    remove(id: number) {
      const remaining = items.filter((tab) => tab.id !== id);
      setItems(remaining);
      history = history.filter((tabId) => tabId !== id);

      if (history.length === 0 && remaining.length > 0) {
        history = [remaining[0].id];
      }

      return history.at(-1) ?? remaining[0]?.id ?? 0;
    },
    toggleVisibility() {
      setIsVisible((visible) => !visible);
    },
  };

  return {
    items,
    activeId,
    isVisible,
    count: () => items.length,
    commands,
  };
}

export type PdfTabs = ReturnType<typeof createPdfTabs>;
