import { useFocusLock } from '@core/util/createControlledOpenSignal';
import {
  type Accessor,
  type Component,
  createRoot,
  createSignal,
  For,
  getOwner,
  type Owner,
  onCleanup,
  runWithOwner,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';

/** Props controlled by the imperative dialog manager. */
export type ManagedDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** A static or reactive source of component props. */
export type PropsSource<P extends object> = P | Accessor<P>;

/** Options controlling an imperative dialog's lifecycle. */
export type OpenDialogOptions = {
  /**
   * The Solid owner whose context and lifetime the dialog should inherit.
   * Capture this owner while the calling component is being created; event
   * handlers generally run without an owner.
   */
  owner?: Owner;
};

/** Why an imperative dialog was closed. */
export type DialogCloseReason =
  | 'dismissed'
  | 'programmatic'
  | 'replaced'
  | 'owner-disposed'
  | 'host-disposed';

/** Information emitted after an imperative dialog has been cleaned up. */
export type DialogClosedEvent = {
  id: string;
  reason: DialogCloseReason;
};

/** A stable handle to one imperative dialog entry. */
export type DialogHandle = {
  readonly id: string;
  readonly isOpen: Accessor<boolean>;
  /** Closes this dialog. Returns false when it was already closed. */
  close: () => boolean;
  /** Resolves once the dialog's reactive root has been disposed. */
  readonly closed: Promise<DialogClosedEvent>;
};

type StoredManagedDialogProps = ManagedDialogProps & Record<string, unknown>;
type ManagedDialogComponent = Component<StoredManagedDialogProps>;
/** Props callers provide when opening a managed dialog. */
export type ManagedDialogInput<P extends ManagedDialogProps> = Omit<
  P,
  keyof ManagedDialogProps
> &
  Partial<Record<keyof ManagedDialogProps, never>>;

/** Controls the single active dialog owned by `useImperativeDialog`. */
export type ImperativeDialogController<P extends ManagedDialogProps> = {
  /** Opens this dialog, replacing the controller's current entry. */
  open: (props: PropsSource<ManagedDialogInput<P>>) => DialogHandle;
  /** Closes the current entry. Returns false when none is open. */
  close: () => boolean;
  /** Whether this controller currently owns an open entry. */
  readonly isOpen: Accessor<boolean>;
  /** The current entry-specific handle. */
  readonly handle: Accessor<DialogHandle | undefined>;
};

type DialogEntry = {
  id: string;
  component: ManagedDialogComponent;
  props: PropsSource<Record<string, unknown>>;
  owner?: Owner;
  isOpen: Accessor<boolean>;
  setOpen: (open: boolean) => void;
  finalized: boolean;
  focusLock: ReturnType<typeof useFocusLock>;
  rootDisposer?: () => void;
  resolveClosed: (event: DialogClosedEvent) => void;
};

const [dialogEntries, setDialogEntries] = createSignal<DialogEntry[]>([]);
let nextDialogId = 0;

function resolveProps<P extends object>(source: PropsSource<P>): P {
  return typeof source === 'function' ? source() : source;
}

function finalizeDialog(id: string, reason: DialogCloseReason): boolean {
  const entry = dialogEntries().find((candidate) => candidate.id === id);
  if (!entry || entry.finalized) return false;

  entry.finalized = true;
  entry.setOpen(false);

  const disposeRoot = entry.rootDisposer;
  entry.rootDisposer = undefined;
  disposeRoot?.();

  setDialogEntries((entries) =>
    entries.filter((candidate) => candidate.id !== id)
  );
  entry.focusLock.release();
  entry.resolveClosed({ id, reason });
  return true;
}

/**
 * Opens a complete, controlled dialog component in the global dialog host.
 * The manager supplies `open` and `onOpenChange`; the component owns its
 * `<Dialog>` and all presentation details.
 */
export function openDialog<P extends ManagedDialogProps>(
  component: Component<P>,
  props: PropsSource<ManagedDialogInput<P>>,
  options: OpenDialogOptions = {}
): DialogHandle {
  const id = `imperative-dialog-${++nextDialogId}`;
  const [isOpen, setOpen] = createSignal(true);
  const focusLock = useFocusLock(id);
  focusLock.acquire();

  let resolveClosed!: (event: DialogClosedEvent) => void;
  const closed = new Promise<DialogClosedEvent>((resolve) => {
    resolveClosed = resolve;
  });

  const entry: DialogEntry = {
    id,
    component: component as ManagedDialogComponent,
    props: props as PropsSource<Record<string, unknown>>,
    owner: options.owner,
    isOpen,
    setOpen,
    finalized: false,
    focusLock,
    resolveClosed,
  };

  setDialogEntries((entries) => [...entries, entry]);

  if (options.owner) {
    runWithOwner(options.owner, () => {
      onCleanup(() => finalizeDialog(id, 'owner-disposed'));
    });
  }

  return {
    id,
    isOpen,
    close: () => finalizeDialog(id, 'programmatic'),
    closed,
  };
}

/**
 * Creates a single-slot dialog controller bound to the current Solid owner.
 * Opening again replaces only the entry created by this controller.
 */
export function useImperativeDialog<P extends ManagedDialogProps>(
  component: Component<P>
): ImperativeDialogController<P> {
  const owner = getOwner();
  if (!owner) {
    throw new Error('useImperativeDialog must be called within a Solid owner');
  }

  const [handle, setHandle] = createSignal<DialogHandle>();

  const open = (props: PropsSource<ManagedDialogInput<P>>) => {
    const previous = handle();
    if (previous?.isOpen()) {
      finalizeDialog(previous.id, 'replaced');
    }

    const next = openDialog(component, props, { owner });
    setHandle(next);
    void next.closed.then(() => {
      if (handle() === next) setHandle(undefined);
    });
    return next;
  };

  const close = () => {
    const current = handle();
    if (!current) return false;

    const didClose = current.close();
    if (didClose) setHandle(undefined);
    return didClose;
  };

  return {
    open,
    close,
    isOpen: () => handle()?.isOpen() ?? false,
    handle,
  };
}

function DialogEntryRenderer(props: { entry: DialogEntry }) {
  const hostOwner = getOwner();
  let disposed = false;
  let disposeRoot!: () => void;

  const content = createRoot((dispose) => {
    disposeRoot = () => {
      if (disposed) return;
      disposed = true;
      dispose();
    };
    props.entry.rootDisposer = disposeRoot;

    return (
      <Dynamic
        component={props.entry.component}
        {...resolveProps(props.entry.props)}
        open={props.entry.isOpen()}
        onOpenChange={(open: boolean) => {
          if (!open) finalizeDialog(props.entry.id, 'dismissed');
        }}
      />
    );
  }, props.entry.owner ?? hostOwner);

  onCleanup(() => {
    if (props.entry.rootDisposer === disposeRoot) {
      props.entry.rootDisposer = undefined;
    }
    disposeRoot();
  });

  return content;
}

/** Mounts and owns all dialogs opened through `openDialog`. Mount once. */
export function ImperativeDialogHost() {
  onCleanup(() => {
    for (const entry of [...dialogEntries()]) {
      finalizeDialog(entry.id, 'host-disposed');
    }
  });

  return (
    <For each={dialogEntries()}>
      {(entry) => <DialogEntryRenderer entry={entry} />}
    </For>
  );
}
