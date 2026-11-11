import { t } from '@app/lib/i18n';
import XIcon from '@icon/system/regular/x.svg';
import { Button, Dialog, Input, Panel } from '@ui';
import { createSignal, Index, Show } from 'solid-js';

/**
 * Edits a contact's phone numbers. Mounted for one editing session, so
 * cancel never changes what is stored. The server normalizes each number
 * and refuses one without its country code.
 */
export function ContactPhonesDialog(props: {
  initial: string[];
  onSave: (phones: string[]) => Promise<void>;
  errorMessage: (error: unknown) => string;
  onClose: () => void;
}) {
  const [phones, setPhones] = createSignal(
    props.initial.length ? props.initial : ['']
  );
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal('');

  const update = (index: number, value: string) =>
    setPhones((current) =>
      current.map((phone, i) => (i === index ? value : phone))
    );
  const remove = (index: number) =>
    setPhones((current) => current.filter((_, i) => i !== index));

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (pending()) return;
    setPending(true);
    setError('');
    try {
      await props.onSave(phones().filter((phone) => phone.trim()));
      props.onClose();
    } catch (error) {
      setError(props.errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !pending() && props.onClose()}
      class="w-96 max-w-[calc(100vw-2rem)]"
    >
      <Panel>
        <Panel.Body>
          <form class="flex flex-col gap-4 p-5" onSubmit={save}>
            <Dialog.Title class="text-base font-semibold">
              {t('crm.phoneNumbers')}
            </Dialog.Title>
            <Dialog.Description class="text-sm text-ink-muted">
              {t('crm.phoneNumbersDescription')}
            </Dialog.Description>
            <div class="flex flex-col gap-2">
              <Index each={phones()}>
                {(phone, index) => (
                  <div class="flex items-center gap-2">
                    <Input
                      type="tel"
                      inputmode="tel"
                      autocomplete="tel"
                      aria-label={t('crm.phoneNumber', {
                        number: index + 1,
                      })}
                      placeholder={t('crm.phonePlaceholder')}
                      value={phone()}
                      disabled={pending()}
                      onInput={(e) => update(index, e.currentTarget.value)}
                      class="min-w-0 flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('crm.removePhoneNumber', {
                        number: index + 1,
                      })}
                      disabled={pending()}
                      onClick={() => remove(index)}
                    >
                      <XIcon class="size-4" />
                    </Button>
                  </div>
                )}
              </Index>
            </div>
            <div>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending()}
                onClick={() => setPhones((current) => [...current, ''])}
              >
                {t('crm.addPhoneNumber')}
              </Button>
            </div>
            <Show when={error()}>
              <p role="alert" class="text-sm text-failure">
                {error()}
              </p>
            </Show>
            <div class="flex items-center gap-2">
              <Button
                variant="ghost"
                class="ml-auto"
                disabled={pending()}
                onClick={props.onClose}
              >
                {t('crm.cancel')}
              </Button>
              <Button type="submit" variant="primary" disabled={pending()}>
                {t('crm.saveContact')}
              </Button>
            </div>
          </form>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
