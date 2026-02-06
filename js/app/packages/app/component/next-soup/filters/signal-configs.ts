import { makePersisted } from '@solid-primitives/storage';
import { createSignal } from 'solid-js';

type SignalConfig<T extends string> = {
  key: T;
  label: string;
  defaultValue: boolean;
};

type SignalToggle<T extends string> = SignalConfig<T> & {
  enabled: () => boolean;
  setEnabled: (value: boolean) => void;
};

const makeToggle = (storageKey: string, defaultValue: boolean) =>
  makePersisted(createSignal(defaultValue), { name: storageKey });

const toStorageKey = (scope: string, key: string) =>
  `signalFilter_${scope}_${key.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;

const createSignalToggles = <T extends string>(
  scope: string,
  configs: SignalConfig<T>[]
): SignalToggle<T>[] =>
  configs.map((config) => {
    const [enabled, setEnabled] = makeToggle(
      toStorageKey(scope, config.key),
      config.defaultValue
    );
    return { ...config, enabled, setEnabled };
  });

const PRIORITY_LABEL_SIGNAL_CONFIGS: SignalConfig<string>[] = [
  {
    key: 'CATEGORY_PERSONAL',
    label: 'Personal',
    defaultValue: true,
  },
  {
    key: 'SENT',
    label: 'Sent',
    defaultValue: true,
  },
  {
    key: 'IMPORTANT',
    label: 'Important',
    defaultValue: false,
  },
];

const DEPRIORITY_LABEL_SIGNAL_CONFIGS: SignalConfig<string>[] = [
  {
    key: 'CATEGORY_UPDATES',
    label: 'Updates',
    defaultValue: true,
  },
  {
    key: 'CATEGORY_PROMOTIONS',
    label: 'Promotions',
    defaultValue: true,
  },
  {
    key: 'CATEGORY_SOCIAL',
    label: 'Social',
    defaultValue: true,
  },
  {
    key: 'CATEGORY_FORUMS',
    label: 'Forums',
    defaultValue: true,
  },
];

export const PRIORITY_LABEL_SIGNAL_TOGGLES = createSignalToggles(
  'priority_label',
  PRIORITY_LABEL_SIGNAL_CONFIGS
);
export const DEPRIORITY_LABEL_SIGNAL_TOGGLES = createSignalToggles(
  'depriority_label',
  DEPRIORITY_LABEL_SIGNAL_CONFIGS
);
