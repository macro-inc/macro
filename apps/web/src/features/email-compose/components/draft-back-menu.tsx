import { MobileDrawer } from '@components/app/mobile/MobileDrawer';

/** Shared leave-composer choices; callers keep the editor open if saving fails. */
export function DraftBackMenu(props: {
  open: boolean;
  /** Nested full-screen composers keep this sheet within their modal layer. */
  mount?: HTMLElement;
  onOpenChange: (open: boolean) => void;
  onDelete: () => Promise<void>;
  onSave: () => Promise<void>;
}) {
  return (
    <MobileDrawer
      side="bottom"
      open={props.open}
      onOpenChange={props.onOpenChange}
      onEscapeKeyDown={(event) => {
        event.preventDefault();
        props.onOpenChange(false);
      }}
      preventScroll={false}
      preventScrollbarShift={false}
    >
      <MobileDrawer.Portal mount={props.mount}>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content aria-label="Draft options">
          <MobileDrawer.Handle />
          <MobileDrawer.Section class="mb-3">
            <MobileDrawer.Item
              class="justify-center font-medium text-failure"
              onClick={props.onDelete}
            >
              Delete Draft
            </MobileDrawer.Item>
            <MobileDrawer.Item
              class="justify-center font-medium"
              onClick={props.onSave}
            >
              Save Draft
            </MobileDrawer.Item>
          </MobileDrawer.Section>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}
