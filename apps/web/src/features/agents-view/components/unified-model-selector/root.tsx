import type { CatalogModelOption } from '@core/component/AI/component/input/modelCatalog';
import type { ModelSpeed } from '@core/component/AI/constant/speed';
import { createContext, type JSX, useContext } from 'solid-js';
import type {
  EffortChoice,
  SelectSessionConfigOption,
} from '../../../block-agent/state/session-config';
import type { RosterAgent } from '../../core/roster';

export type SelectorActionResult = void | boolean | Promise<void | boolean>;
export type UnifiedModelSelectorState = {
  model?: string;
  models: CatalogModelOption[];
  /** Macro's catalog remains available while a custom agent is selected. */
  suggestedModels: CatalogModelOption[];
  suggestedDisabled?: boolean;
  suggestedSelected?: boolean;
  agent?: RosterAgent;
  agents?: RosterAgent[];
  /** Model-only target editors show the override alongside the selected agent. */
  showModelLabel?: boolean;
  recentModelIds?: readonly string[];
  recentAgentIds?: readonly string[];
  loading?: boolean;
  disabled?: boolean;
  effort?: SelectSessionConfigOption;
  effortValue?: string;
  effortDisabled?: boolean;
  speeds?: readonly string[];
  /** Discovered speed tiers for each Suggested model; absent means unknown. */
  suggestedSpeeds?: Readonly<Record<string, readonly string[]>>;
  suggestedHarness?: string;
  speedValue?: string;
  onModel: (model: string) => SelectorActionResult;
  onSuggestedModel?: (model: string) => SelectorActionResult;
  onAgent?: (agent: RosterAgent) => SelectorActionResult;
  onConnect?: (agent: RosterAgent) => void;
  onCreate?: () => void;
  onEffort: (choice: EffortChoice) => void;
  onSpeed: (value: ModelSpeed) => void;
  onCloseAutoFocus?: (event: Event) => void;
  onOpenChange?: (open: boolean) => void;
};

const Context = createContext<UnifiedModelSelectorState>();
export function UnifiedModelSelectorRoot(props: {
  state: UnifiedModelSelectorState;
  children: JSX.Element;
}) {
  return (
    <Context.Provider value={props.state}>{props.children}</Context.Provider>
  );
}
export function useUnifiedModelSelector() {
  const state = useContext(Context);
  if (!state) throw new Error('UnifiedModelSelectorRoot is required');
  return state;
}
