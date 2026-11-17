import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import ProhibitIcon from '@icon/system/regular/prohibit.svg';
import { Button, Dropdown } from '@ui';
import { createSignal, Show } from 'solid-js';
import { useThreadExclusionAction } from '../../thread-exclusion-adapter';

/** Exercise the real action and shared menu controls with fixture identity/I/O. */
export function ThreadMenuFixture() {
  const [open, setOpen] = createSignal(false);
  const action = useThreadExclusionAction(
    () => '00000000-0000-4000-8000-000000000049',
    () => !new URLSearchParams(location.search).has('teammate')
  );
  const select = () => {
    action.exclude();
    setOpen(false);
  };
  return (
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
            <Show when={action.available()}>
              <Dropdown.Item onSelect={select}>
                <ProhibitIcon class="size-4" />
                {t('crm.privacyExcludeThread')}
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
                <Show when={action.available()}>
                  <MobileDrawer.Item onClick={select}>
                    <ProhibitIcon class="size-4" />
                    {t('crm.privacyExcludeThread')}
                  </MobileDrawer.Item>
                </Show>
              </MobileDrawer.Section>
            </MobileDrawer.ScrollBody>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
    </Show>
  );
}
