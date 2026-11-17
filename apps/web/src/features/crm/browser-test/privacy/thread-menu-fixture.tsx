import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import BellIcon from '@icon/system/regular/bell-simple.svg';
import EyeSlashIcon from '@icon/system/regular/eye-slash.svg';
import { Button, ButtonGroup, Dropdown } from '@ui';
import { createSignal, Show } from 'solid-js';
import { ThreadExclusionButton } from '../../components/thread-exclusion-button';
import { useThreadExclusionAction } from '../../thread-exclusion-adapter';
import { mailboxId } from './preview-adapters';

/** Exercise the real action and shared menu controls with fixture identity/I/O. */
export function ThreadMenuFixture() {
  const [open, setOpen] = createSignal(false);
  const action = useThreadExclusionAction(
    () =>
      new URLSearchParams(location.search).has('excluded')
        ? '00000000-0000-4000-8000-000000000046'
        : '00000000-0000-4000-8000-000000000049',
    () => !new URLSearchParams(location.search).has('teammate'),
    () =>
      new URLSearchParams(location.search).has('other-mailbox')
        ? 'other-mailbox'
        : mailboxId
  );
  const select = () => {
    action.toggle();
    setOpen(false);
  };
  return (
    <>
      <Show when={!isTouchDevice()}>
        <ButtonGroup aria-label="Email actions" size="md" variant="secondary">
          <ThreadExclusionButton
            visible={action.visible()}
            excluded={action.excluded()}
            label={action.label()}
            disabledReason={action.disabledReason()}
            onClick={action.toggle}
          />
          <ButtonGroup.Button size="icon-md" aria-label="Remind me">
            <BellIcon class="size-4" />
          </ButtonGroup.Button>
        </ButtonGroup>
      </Show>
      <Show
        when={isTouchDevice()}
        fallback={
          <Dropdown open={open()} onOpenChange={setOpen}>
            <Dropdown.Trigger variant="secondary">
              Thread actions
            </Dropdown.Trigger>
            <Dropdown.Content>
              <Dropdown.Item onSelect={() => setOpen(false)}>
                Copy link
              </Dropdown.Item>
              <Show when={action.visible()}>
                <Dropdown.Item
                  onSelect={select}
                  disabledReason={action.disabledReason()}
                >
                  <EyeSlashIcon class="size-4" />
                  {action.label()}
                </Dropdown.Item>
              </Show>
            </Dropdown.Content>
          </Dropdown>
        }
      >
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Thread actions
        </Button>
        <MobileDrawer open={open()} onOpenChange={setOpen}>
          <MobileDrawer.Portal>
            <MobileDrawer.Overlay />
            <MobileDrawer.Content aria-label="Thread actions">
              <MobileDrawer.Handle />
              <MobileDrawer.ScrollBody>
                <MobileDrawer.Section>
                  <MobileDrawer.Item onClick={() => setOpen(false)}>
                    Copy link
                  </MobileDrawer.Item>
                  <Show when={action.visible()}>
                    <MobileDrawer.Item
                      onClick={select}
                      disabled={!!action.disabledReason()}
                    >
                      <EyeSlashIcon class="size-4" />
                      <span>
                        {action.label()}
                        <Show when={action.disabledReason()}>
                          <span class="block text-xs text-ink-muted">
                            {action.disabledReason()}
                          </span>
                        </Show>
                      </span>
                    </MobileDrawer.Item>
                  </Show>
                </MobileDrawer.Section>
              </MobileDrawer.ScrollBody>
            </MobileDrawer.Content>
          </MobileDrawer.Portal>
        </MobileDrawer>
      </Show>
    </>
  );
}
