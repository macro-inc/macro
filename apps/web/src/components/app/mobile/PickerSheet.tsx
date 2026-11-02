import { t } from '@app/lib/i18n';
import { triggerFocusInput } from '@core/directive/focusInput';
import { isEditableInput } from '@core/util/isEditableInput';
import { Button } from '@ui';
import {
  type Accessor,
  createComputed,
  createContext,
  createSignal,
  type JSX,
  on,
  onCleanup,
  Show,
  useContext,
} from 'solid-js';
import { MobileDrawer } from './MobileDrawer';

const PICKER_SEARCH = 'input[type="text"]:not(:disabled)';

/** A text field with its caret, to hand focus back to. */
type TypingFocus = { field: HTMLElement; caret?: Range };

function captureTypingFocus(): TypingFocus | undefined {
  const field = document.activeElement;
  if (!(field instanceof HTMLElement) || !isEditableInput(field)) return;
  // A text input keeps its own caret; an editor's lives in the document.
  const selection = getSelection();
  const caret =
    field.isContentEditable && selection?.rangeCount
      ? selection.getRangeAt(0).cloneRange()
      : undefined;
  return { field, caret };
}

function restoreTypingFocus(focus: TypingFocus) {
  if (!focus.field.isConnected) return;
  focus.field.focus({ preventScroll: true });
  if (!focus.caret?.startContainer.isConnected) return;
  const selection = getSelection();
  selection?.removeAllRanges();
  selection?.addRange(focus.caret);
}

const PickerSheetContext = createContext<{
  onCancel: () => void;
  /** Whether the sheet has finished sliding in. */
  settled: Accessor<boolean>;
}>();

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
  let content: HTMLElement | undefined;
  const search = () => content?.querySelector<HTMLInputElement>(PICKER_SEARCH);
  // Building a long picker list while the sheet slides in held iOS's main
  // thread for over a second, so the slide stalled and the sheet appeared late
  // and at the wrong size. The body mounts once the slide has ended instead.
  const [settled, setSettled] = createSignal(false);
  const settle = () => setSettled(true);
  // Opening runs inside the opener's tap, so the keyboard can move straight
  // to a stand-in input and on to the picker's search once it mounts. Without
  // it the keyboard drops as the composer's field blurs and rises again,
  // resizing both sheets twice. Closing hands it back to the field the opener
  // left focused, with its caret, in the closing tap for the same reason.
  let returnFocus: TypingFocus | undefined;
  const handBackFocus = () => {
    const focus = returnFocus;
    returnFocus = undefined;
    if (focus) restoreTypingFocus(focus);
  };
  createComputed(
    on(
      () => props.open,
      (open) => {
        if (!open) {
          handBackFocus();
          return;
        }
        returnFocus = captureTypingFocus();
        setSettled(false);
        triggerFocusInput(search);
      },
      { defer: true }
    )
  );
  onCleanup(handBackFocus);
  return (
    <PickerSheetContext.Provider
      value={{ onCancel: () => props.onCancel(), settled }}
    >
      <MobileDrawer
        side="bottom"
        open={props.open}
        onOpenChange={(open) => {
          if (!open) props.onCancel();
        }}
        // Focus waits for the picker's search to mount, rather than going to
        // the drawer's first control (Cancel) and dropping the keyboard.
        onInitialFocus={(event) => {
          event.preventDefault();
          // Without a slide (reduced motion) there is no transition to end.
          if (
            content &&
            parseFloat(getComputedStyle(content).transitionDuration) === 0
          )
            settle();
        }}
      >
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay />
          <MobileDrawer.Content
            ref={(element: HTMLElement) => {
              content = element;
              // A listener beside the drawer's own: an onTransitionEnd prop
              // would replace the handler that finishes its slides.
              element.addEventListener('transitionend', (event) => {
                if (event.target === element && props.open) settle();
              });
            }}
            targetHeight={92}
            data-corvu-no-drag
          >
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
        {t('mobile.cancel')}
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
        {t('mobile.done')}
      </Button>
    </div>
  );
}

/**
 * The rest of the sheet, for the picker to fill: give its list `min-h-0
 * flex-1` and its own scroll rather than a popover's capped height. It mounts
 * once the sheet has slid in, so a long list never stalls the slide; keep
 * state that must exist at once (a draft) outside it.
 */
function Body(props: { children: JSX.Element }) {
  const sheet = usePickerSheet();
  return (
    <div class="flex min-h-0 flex-auto flex-col text-sm">
      <Show when={sheet.settled()}>{props.children}</Show>
    </div>
  );
}

/**
 * A picker in a sheet stacked over the current one (a touch composer, or the
 * page): Cancel, a title, and Done across the top, and a body the picker
 * fills. Picks stay a draft until Done. Keep the picker's search field focused
 * when a row is tapped, by cancelling `pointerdown` and `mousedown` on the
 * rows, so the phone keyboard stays up. Closing returns focus to the field
 * that had it when the sheet opened, so the opener must not take focus on
 * tap either.
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
