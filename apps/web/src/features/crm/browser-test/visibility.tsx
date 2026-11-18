import '@app/index.css';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { RecordOverview } from '../components/record-overview';
import { RecordVisibilityAction } from '../components/record-visibility-action';

// Local mutation completion controls exercise pending and failed saves without
// changing hosted CRM data. The action and responsive confirmation are production UI.
document.documentElement.dataset.touchDevice = String(isTouchDevice());
const params = new URLSearchParams(location.search);
const grouped = params.get('grouped') === 'true';
const kind = params.get('kind') === 'contact' ? 'contact' : 'company';

function Fixture() {
  const [recordId, setRecordId] = createSignal('first');
  const [hidden, setHidden] = createSignal(false);
  const [pending, setPending] = createSignal(false);
  const [canManage, setCanManage] = createSignal(true);
  const [writes, setWrites] = createSignal(0);
  let finish: ((success: boolean) => void) | undefined;
  Object.assign(window, {
    finishVisibilitySave(success: boolean) {
      finish?.(success);
    },
    switchVisibilityRecord() {
      setRecordId((id) => (id === 'first' ? 'second' : 'first'));
    },
  });

  const VisibilityAction = () => (
    <RecordVisibilityAction
      iconOnly={kind === 'contact'}
      grouped={grouped}
      recordId={recordId()}
      kind={kind}
      name={kind === 'company' ? 'Acme' : 'Maya Chen'}
      hidden={hidden()}
      pending={pending()}
      canManage={canManage()}
      onChange={(value, onSuccess, onError) => {
        setPending(true);
        setWrites((count) => count + 1);
        finish = (success) => {
          finish = undefined;
          setPending(false);
          if (!success) {
            onError();
            return;
          }
          setHidden(value);
          onSuccess();
        };
      }}
    />
  );

  return (
    <main class="flex h-dvh flex-col bg-panel text-ink">
      <RecordOverview>
        <h1 class="text-2xl font-semibold">
          {kind === 'company' ? 'Acme' : 'Maya Chen'}
        </h1>
        <Show when={grouped} fallback={<VisibilityAction />}>
          <HeaderActionGroup label="Contact actions">
            <VisibilityAction />
          </HeaderActionGroup>
        </Show>
        <output aria-label="Visibility writes">{writes()}</output>
        <Button onClick={() => setCanManage((value) => !value)}>
          Toggle admin role
        </Button>
      </RecordOverview>
    </main>
  );
}
render(Fixture, document.getElementById('root')!);
