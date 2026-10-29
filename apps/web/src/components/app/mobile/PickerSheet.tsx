import { Button } from '@ui';
import { createContext, type JSX, useContext } from 'solid-js';
import { MobileDrawer } from './MobileDrawer';

const PickerSheetContext = createContext<{ onCancel: () => void }>();

function usePickerSheet() {
  const sheet = useContext(PickerSheetContext);
  if (!sheet) throw new Error('PickerSheet parts must be rendered inside Root');
  return sheet;
}

/**
 * The sheet. It opens as tall as the touch composer sheets and does not drag:
 * a drag inside it would also reach a sheet beneath, and Cancel and Done own
 * closing. The backdrop and Escape cancel.
 *
 * Its content mounts with each opening, so a draft or picker session created
 * inside it starts from the saved value every time.
 */
function Root(props: {
  open: boolean;
  /** Close without applying the picks. */
  onCancel: () => void;
  children: JSX.Element;
}) {
  return (
    <PickerSheetContext.Provider value={{ onCancel: () => props.onCancel() }}>
      <MobileDrawer
        side="bottom"
        open={props.open}
        onOpenChange={(open) => {
          if (!open) props.onCancel();
        }}
      >
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay />
          <MobileDrawer.Content targetHeight={92} data-corvu-no-drag>
            {props.children}
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
    </PickerSheetContext.Provider>
  );
}

/** Cancel, the title, and Done across the top of the sheet. */
function Header(props: {
  title: string;
  /** Apply the picks and close. */
  onDone: () => void;
  doneDisabled?: boolean;
}) {
  const sheet = usePickerSheet();
  return (
    <div class="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 pt-4 pb-2">
      <Button
        variant="ghost"
        class="justify-self-start"
        onClick={sheet.onCancel}
      >
        Cancel
      </Button>
      <MobileDrawer.Title class="text-base font-semibold text-ink">
        {props.title}
      </MobileDrawer.Title>
      <Button
        variant="primary"
        class="justify-self-end"
        disabled={props.doneDisabled}
        onClick={props.onDone}
      >
        Done
      </Button>
    </div>
  );
}

/**
 * The rest of the sheet, for the picker to fill: give its list `min-h-0
 * flex-1` and its own scroll rather than a popover's capped height.
 */
function Body(props: { children: JSX.Element }) {
  return (
    <div class="flex min-h-0 flex-auto flex-col text-sm">{props.children}</div>
  );
}

/**
 * A picker in a sheet stacked over the current one (a touch composer, or the
 * page): Cancel, a title, and Done across the top, and a body the picker
 * fills. Picks stay a draft until Done. Keep the picker's search field focused
 * when a row is tapped, by cancelling `pointerdown` and `mousedown` on the
 * rows, so the phone keyboard stays up.
 *
 * ```tsx
 * <PickerSheet.Root open={open()} onCancel={close}>
 *   <PickerSheet.Header title="Guests" onDone={applyAndClose} />
 *   <PickerSheet.Body>
 *     <GuestPicker fillHeight ... />
 *   </PickerSheet.Body>
 * </PickerSheet.Root>
 * ```
 */
export const PickerSheet = { Root, Header, Body };
