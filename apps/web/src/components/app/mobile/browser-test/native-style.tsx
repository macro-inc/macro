import '@fontsource-variable/inter';
import '../../../../index.css';
import { macroDarkTheme } from '@app/features/theme/themes/macro-dark';
import { macroLightTheme } from '@app/features/theme/themes/macro-light';
import { Button } from '@ui/components/Button';
import { ButtonGroup } from '@ui/components/ButtonGroup';
import { Input } from '@ui/components/Input';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { loadPlatformStyles } from '../../../../platform-styles';

const params = new URLSearchParams(location.search);
const platform = params.get('platform') ?? 'ios';
const theme =
  params.get('theme') === 'light' ? macroLightTheme : macroDarkTheme;
for (const [token, value] of Object.entries(theme.colorTokens)) {
  document.documentElement.style.setProperty(`--color-${token}`, value);
}
document.documentElement.dataset.platform = platform;
document.documentElement.dataset.touchDevice = String(platform !== 'web');
document.documentElement.dataset.themeLight = String(theme.mode === 'light');
await loadPlatformStyles(platform === 'ios' ? 'ios' : 'web');

function Fixture() {
  const [pressed, setPressed] = createSignal(false);
  return (
    <main class="flex min-h-screen flex-col gap-8 bg-page p-8 text-ink">
      <h1 class="text-lg">Platform materials</h1>
      <div class="flex gap-6">
        <Button
          variant="secondary"
          size="icon-lg"
          aria-label="Round action"
          data-test="round"
          data-glass-press={pressed() ? 'round' : undefined}
          style={{
            '--press-scale': '1.28',
            '--press-x': '20px',
            '--press-y': '20px',
          }}
        >
          +
        </Button>
        <Button
          variant="secondary"
          data-test="wide"
          data-glass-press={pressed() ? 'wide' : undefined}
          style={{
            '--press-outset': '6px',
            '--press-x': '40px',
            '--press-y': '16px',
          }}
          onPointerDown={() => setPressed(true)}
          onPointerUp={() => setPressed(false)}
        >
          Press surfaces
        </Button>
        <Button variant="secondary" disabled>
          Unavailable
        </Button>
      </div>
      <ButtonGroup
        variant="secondary"
        data-test="group"
        data-glass-press={pressed() ? 'wide' : undefined}
        style={{
          '--press-outset': '6px',
          '--press-x': '40px',
          '--press-y': '16px',
        }}
      >
        <ButtonGroup.Button>First</ButtonGroup.Button>
        <ButtonGroup.Button>Second</ButtonGroup.Button>
      </ButtonGroup>
      <div
        data-glass-input
        data-test="input"
        class="glass-input p-3"
        data-glass-press={pressed() ? 'wide' : undefined}
        style={{
          '--press-outset': '6px',
          '--press-x': '40px',
          '--press-y': '16px',
        }}
      >
        <Input aria-label="Message" placeholder="Write a message" />
      </div>
    </main>
  );
}
render(() => <Fixture />, document.getElementById('root')!);
document.body.dataset.ready = 'true';
