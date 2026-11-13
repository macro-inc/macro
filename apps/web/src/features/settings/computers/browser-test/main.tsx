import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { queryClient } from '@queries/client';
import { QueryClientProvider } from '@tanstack/solid-query';
import { render } from 'solid-js/web';
import '../../../../index.css';
import { Layer } from '@ui/components/Layer';
import { SettingsPage } from '../../primitives';
import { MacroComputers } from '../views/MacroComputers';
import { harnesses } from './stubs/fixture-state';

// The fixture uses the same touch variant switch as the app entry point.
document.documentElement.dataset.touchDevice = String(isTouchDevice());

function Fixture() {
  return (
    <QueryClientProvider client={queryClient}>
      <Layer>
        <SettingsPage
          title="Machines"
          description="Providers and machines your agents can run on."
        >
          <MacroComputers harnesses={harnesses()} />
        </SettingsPage>
      </Layer>
    </QueryClientProvider>
  );
}

const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
