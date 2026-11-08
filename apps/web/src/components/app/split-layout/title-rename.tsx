import { t } from '@app/lib/i18n';
import {
  createInlineRename,
  type InlineRename,
  RenameInput,
  RenameTitle,
} from '@ui';
import type { ResultAsync } from 'neverthrow';
import {
  type Accessor,
  createEffect,
  createSignal,
  type JSX,
  onCleanup,
  Show,
  useContext,
} from 'solid-js';
import { SplitPanelContext, type SplitPanelContextType } from './context';

/** An entity a split's header can rename in place, by its id. */
export type SplitTitleRename = {
  id: string;
  rename: InlineRename<string>;
};

/** The registry behind a split panel's `titleRenames`. */
export function createSplitTitleRenames(): Pick<
  SplitPanelContextType,
  'titleRenames' | 'registerTitleRename'
> {
  const [titleRenames, setTitleRenames] = createSignal<
    readonly SplitTitleRename[]
  >([]);
  return {
    titleRenames,
    registerTitleRename: (registration) => {
      setTitleRenames((current) => [...current, registration]);
      return () =>
        setTitleRenames((current) =>
          current.filter((entry) => entry !== registration)
        );
    },
  };
}

/**
 * Lets the split's header rename an entity in place while `enabled`, and
 * returns the rename for the menu item and hotkey that start it. The header
 * title showing `id` renders it; see {@link SplitTitleName}.
 */
export function createSplitTitleRename<Failure>(
  panel: Pick<SplitPanelContextType, 'registerTitleRename'>,
  options: {
    id: Accessor<string>;
    name: Accessor<string>;
    enabled: Accessor<boolean>;
    rename: (name: string) => ResultAsync<unknown, Failure>;
    failureMessage: (failure: Failure) => string;
  }
): InlineRename<string> {
  const rename = createInlineRename({
    key: (id: string) => id,
    name: () => options.name(),
    rename: (_id, name) => options.rename(name),
    failureMessage: options.failureMessage,
  });
  createEffect(() => {
    if (!options.enabled()) return;
    onCleanup(panel.registerTitleRename({ id: options.id(), rename }));
  });
  return rename;
}

/** The rename the split header has for `id`, if the viewer may rename it. */
export function splitTitleRename(
  panel: Pick<SplitPanelContextType, 'titleRenames'> | undefined,
  id: string | undefined
): InlineRename<string> | undefined {
  if (!panel || id === undefined) return undefined;
  return panel.titleRenames().find((entry) => entry.id === id)?.rename;
}

/**
 * A split header's entity name. Double-click or F2 renames it in place when
 * the header registered a rename for `id`; otherwise it is plain text.
 */
export function SplitTitleName(props: {
  panel: Pick<SplitPanelContextType, 'titleRenames'>;
  id: string | undefined;
  label: string;
  /** Shown instead of `label`, e.g. a shortened one. */
  children?: JSX.Element;
}) {
  const rename = () => splitTitleRename(props.panel, props.id);
  return (
    <Show
      when={props.id !== undefined && rename()}
      fallback={
        <span class="inline-block truncate text-sm font-semibold">
          {props.children ?? props.label}
        </span>
      }
    >
      {(registered) => (
        <RenameTitle
          rename={registered()}
          target={props.id ?? ''}
          startOn="double-click"
          aria-label={t('splitMenu.titleName')}
          placeholder={t('splitMenu.untitled')}
          class="inline-block text-sm font-semibold"
        />
      )}
    </Show>
  );
}

/**
 * A breadcrumb naming an entity the split header can rename. Double-clicking
 * the current crumb renames it in place, as the file menu's Rename does; the
 * field replaces the crumb while it is open.
 */
export function SplitTitleCrumb(props: {
  id: string | undefined;
  isActive: boolean;
  children: JSX.Element;
}) {
  const panel = useContext(SplitPanelContext);
  const rename = () => splitTitleRename(panel, props.id);
  const renaming = () => {
    const current = rename();
    if (props.id === undefined) return undefined;
    return current?.isRenaming(props.id) ? current : undefined;
  };
  return (
    <Show
      when={renaming()}
      fallback={
        <span
          class="contents"
          onDblClick={(event) => {
            const current = rename();
            if (!props.isActive || !current || props.id === undefined) return;
            event.preventDefault();
            event.stopPropagation();
            current.begin(props.id);
          }}
        >
          {props.children}
        </span>
      }
    >
      {(current) => (
        <RenameInput
          rename={current()}
          aria-label={t('splitMenu.titleName')}
          class="mx-2 text-sm font-medium"
        />
      )}
    </Show>
  );
}
