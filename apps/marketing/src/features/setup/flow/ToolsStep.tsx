import SearchIcon from '@phosphor/magnifying-glass.svg';
import { createSignal, Show } from 'solid-js';
import { IntegrationResults } from '../components/IntegrationResults';
import { FEATURED_MCP_SERVERS } from '../core/featuredIntegrations';
import { onboardingIntegrationEntries } from '../core/onboardingIntegrationCatalog';
import type { OnboardingIntegration } from '../core/onboardingIntegrations';
import {
  ONBOARDING_CONNECTORS,
  type OnboardingConnectorServerName,
} from './onboardingConnectorConfig';
import { ContinueButton } from './shared';

export function ToolsStep(props: {
  preview?: boolean;
  connectorNames: readonly OnboardingConnectorServerName[];
  selected: readonly OnboardingIntegration[];
  onSelectionChange: (items: OnboardingIntegration[]) => void;
  onContinue: () => void;
}) {
  const hiddenSlugs = () =>
    new Set(
      ONBOARDING_CONNECTORS.filter(
        (entry) => !props.connectorNames.includes(entry.serverName)
      ).map((entry) => entry.key)
    );
  const toggle = (integration: OnboardingIntegration) => {
    props.onSelectionChange(
      props.selected.some((item) => item.id === integration.id)
        ? props.selected.filter((item) => item.id !== integration.id)
        : [...props.selected, integration]
    );
  };
  return (
    <div class="flex flex-col gap-7">
      <FeaturedTools
        hiddenSlugs={hiddenSlugs()}
        selected={props.selected}
        onToggle={toggle}
      />
      <ContinueButton
        label={
          props.selected.length
            ? `Continue with ${props.selected.length} integration${props.selected.length === 1 ? '' : 's'}`
            : 'Continue'
        }
        onClick={props.onContinue}
      />
    </div>
  );
}

function ToolSearch(props: {
  value: string;
  onInput: (value: string) => void;
}) {
  return (
    <label class="flex items-center gap-3 rounded-full border border-edge bg-input px-5 py-4 shadow-sm focus-within:ring-1 focus-within:ring-ink/30">
      <SearchIcon aria-hidden="true" class="size-5 shrink-0 text-ink/35" />
      <input
        type="search"
        aria-label="Search integrations and MCPs"
        placeholder="Search integrations and MCPs"
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        class="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-ink-placeholder"
      />
    </label>
  );
}

interface PickerProps {
  hiddenSlugs: ReadonlySet<string>;
  selected: readonly OnboardingIntegration[];
  onToggle: (integration: OnboardingIntegration) => void;
}

const featuredIntegrations: OnboardingIntegration[] = FEATURED_MCP_SERVERS.map(
  (server) => ({ id: server.app_slug, name: server.server_name })
);

function FeaturedTools(props: PickerProps) {
  const [search, setSearch] = createSignal('');
  const entries = () =>
    onboardingIntegrationEntries(
      featuredIntegrations,
      [],
      props.hiddenSlugs,
      search()
    );
  return (
    <div class="flex flex-col gap-6">
      <ToolSearch value={search()} onInput={setSearch} />
      <IntegrationResults
        entries={entries()}
        selected={props.selected}
        onToggle={props.onToggle}
      >
        <Show when={!entries().length}>
          <p class="py-6 text-center text-sm text-ink-muted">
            No integrations match “{search()}”. Try another name.
          </p>
        </Show>
      </IntegrationResults>
    </div>
  );
}
