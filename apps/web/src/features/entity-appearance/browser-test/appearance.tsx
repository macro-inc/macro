import '@fontsource-variable/inter';
import '../../../index.css';
import { EntityIcon } from '@core/component/EntityIcon';
import { Button } from '@ui';
import { err, ok } from 'neverthrow';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { macroDarkTheme } from '../../theme/themes/macro-dark';
import { macroLightTheme } from '../../theme/themes/macro-light';
import { themeCssVars } from '../../theme/utils/themeCssVars';
import { defaultAppearance, type EntityAppearance } from '../core/appearance';
import { AppearanceEditor } from '../views/appearance-editor';

function App() {
  const [saved, setSaved] = createSignal<EntityAppearance>(defaultAppearance());
  const [open, setOpen] = createSignal(false);
  const [fail, setFail] = createSignal(false);
  const [attempts, setAttempts] = createSignal(0);
  let button: HTMLButtonElement | undefined;
  return (
    <main class="min-h-dvh bg-page p-6 text-ink">
      <header class="flex items-center gap-3">
        <Button
          ref={button}
          variant="ghost"
          size="icon-md"
          aria-label="Edit entity icon"
          onClick={() => setOpen(true)}
        >
          <EntityIcon targetType="md" appearance={saved()} size="md" />
        </Button>
        <h1>Example document</h1>
      </header>
      <Button variant="ghost" onClick={() => setFail(true)}>
        Fail next save
      </Button>
      <output data-testid="saved">{JSON.stringify(saved())}</output>
      <output data-testid="attempts">{attempts()}</output>
      <Show when={open()}>
        <AppearanceEditor
          open
          userId="preview-user"
          onOpenChange={setOpen}
          isCurrent={() => true}
          entity={{
            id: 'example',
            type: 'document',
            fileType: 'md',
            name: 'Example document',
            ownerId: '',
            appearance: saved(),
          }}
          anchor={button?.getBoundingClientRect()}
          save={async (appearance) => {
            setAttempts((value) => value + 1);
            if (fail()) {
              setFail(false);
              return err('Save failed');
            }
            setSaved(appearance);
            return ok(undefined);
          }}
        />
      </Show>
    </main>
  );
}
const theme =
  new URLSearchParams(location.search).get('theme') === 'dark'
    ? macroDarkTheme
    : macroLightTheme;
document.documentElement.setAttribute(
  'data-theme-light',
  String(theme.mode === 'light')
);
for (const [name, value] of Object.entries(themeCssVars(theme)))
  document.documentElement.style.setProperty(name, value);
render(() => <App />, document.getElementById('root')!);
