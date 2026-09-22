import { For, Show } from 'solid-js';
import './site-navigation.css';

export function FeatureDock(props: {
  features: readonly { label: string; href?: string }[];
  active: number;
  onSelect?: (index: number) => void;
  onContinue?: () => void;
  continueHref?: string;
  continueLabel?: string;
}) {
  const label = () => props.continueLabel ?? 'What’s next?';
  return (
    <div class="feature-dock-anchor">
      <nav class="feature-dock" aria-label="Explore features and continue">
        <div class="feature-dock-links">
          <For each={props.features}>
            {(feature, index) => (
              <Show
                when={feature.href}
                fallback={
                  <button
                    type="button"
                    aria-label={`Show ${feature.label}`}
                    aria-pressed={props.active === index()}
                    onClick={() => props.onSelect?.(index())}
                  >
                    {feature.label}
                  </button>
                }
              >
                <a
                  href={feature.href}
                  aria-current={props.active === index() ? 'page' : undefined}
                >
                  {feature.label}
                </a>
              </Show>
            )}
          </For>
        </div>
        <Show
          when={props.continueHref}
          fallback={
            <button
              class="feature-dock-next"
              type="button"
              onClick={props.onContinue}
            >
              {label()}
              <span aria-hidden="true">→</span>
            </button>
          }
        >
          <a class="feature-dock-next" target="_self" href={props.continueHref}>
            {label()}
            <span aria-hidden="true">→</span>
          </a>
        </Show>
      </nav>
    </div>
  );
}
