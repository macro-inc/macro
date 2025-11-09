import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import { debounce } from '@solid-primitives/scheduled';
import { createEffect, createSignal, untrack } from 'solid-js';

export const [konsoleOpen, setKonsoleOpen] = createControlledOpenSignal();
export const toggleKonsoleVisibility = () => {
  const isOpen = konsoleOpen();

  setKonsoleOpen(!isOpen);
};

export const [lastCommandTime, setLastCommandTime] = createSignal(Date.now());

export const [rawQuery, immediatelySetRawQuery] = createSignal('');
export const setRawQuery = debounce((term: string) => {
  immediatelySetRawQuery(term);
}, 30);
export const resetQuery = () => setRawQuery('');

// If we aren't in default mode,
// there will be a prefix SIGIL on the string,
// so we remove it.
// THIS IS WHAT YOU SHOULD USE FOR MOST "WHAT DID THE USER TYPE IN?" THINGS,
// the exception being actually checking for sigils.
export function cleanQuery() {
  const query = rawQuery();
  const mode = getModeConfig(currentKonsoleMode());

  if (mode.sigil && query.startsWith(mode.sigil)) {
    return query.slice(mode.sigil.length);
  }

  return query;
}

export const COMMAND_MODES = [
  { id: 'FULL_TEXT_SEARCH', sigil: '%', label: 'Full Text Search' },
  // { id: "REGEX_SEARCH", sigil: "/", label: "Regex Search" },
  // { id: "RUN_COMMAND", sigil: ">", label: "Run" },
  // { id: "TEMP_CHAT", sigil: " ", label: "Temporary Chat" },
];
export const DEFAULT_MODE = {
  id: 'ENTITY_SEARCH',
  sigil: '',
  label: 'Global Search',
};

type CommandMode = (typeof COMMAND_MODES)[number] | typeof DEFAULT_MODE;

export const [currentKonsoleMode, _setKonsoleMode] = createSignal<
  CommandMode['id']
>(DEFAULT_MODE.id);

export const setKonsoleMode = (
  id: CommandMode['id'] | typeof DEFAULT_MODE.id
) => {
  _setKonsoleMode(id);

  // Add sigil when mode is changed programatically
  const query = rawQuery();
  const mode = getModeConfig(id);

  if (mode.id !== DEFAULT_MODE.id && query.startsWith(mode.sigil)) return;
  immediatelySetRawQuery(mode.sigil + cleanQuery());
};

export const resetKonsoleMode = () => setKonsoleMode(DEFAULT_MODE.id);

export function getModeFromQuery(q: string): CommandMode {
  return COMMAND_MODES.find((mode) => q.startsWith(mode.sigil)) ?? DEFAULT_MODE;
}

export function getModeConfig(id: string): CommandMode {
  const mode =
    COMMAND_MODES.find((mode) => mode.id === id) ??
    (id === DEFAULT_MODE.id ? DEFAULT_MODE : undefined);
  if (!mode) console.error(`Command+K mode '${id}' does not exist.`);
  return mode ?? DEFAULT_MODE;
}

export const createModeListenerEffects = () => {
  // Switch modes when sigil is applied by user
  createEffect(() => {
    const query = rawQuery();
    const detectedMode = getModeFromQuery(query).id;

    if (detectedMode !== currentKonsoleMode()) {
      untrack(() => setKonsoleMode(detectedMode));
    }
  });

  // createEffect(() => {
  //   console.log({
  //     mode: currentKonsoleMode(),
  //     query: rawQuery()
  //   })
  // })
};
