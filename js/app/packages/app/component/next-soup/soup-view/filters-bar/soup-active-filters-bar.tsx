import XIcon from "@phosphor/x.svg";
import { Button, cn, Dropdown, Layer } from "@ui";
import { createSignal, For, Show } from "solid-js";
import {
	type ConsolidatedFilter,
	ConsolidatedFilterChip,
} from "./consolidated-filter-chip";
import { UnifiedFilterDropdown } from "./unified-filter-dropdown";

interface SoupActiveFiltersBarProps {
	filters: ConsolidatedFilter[];
	onClearAll: () => void;
	class?: string;
}

/**
 * A dedicated filter bar that appears at the top of the soup view when there are active filters.
 * Contains filter chips on the left, and add/clear buttons on the right.
 */
const AddFilterButton = () => (
	<Dropdown.Trigger
		variant="ghost"
		size="icon-sm"
		class="text-ink-muted hover:text-ink"
		title="Add filter"
	>
		<svg
			class="size-4"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			aria-hidden="true"
		>
			<path d="M8 3v10M3 8h10" />
		</svg>
	</Dropdown.Trigger>
);

export function SoupActiveFiltersBar(props: SoupActiveFiltersBarProps) {
	const [addFilterOpen, setAddFilterOpen] = createSignal(false);

	return (
		<Show when={props.filters.length > 0}>
			<Layer depth={0}>
				<div class={cn("w-full p-2", props.class)}>
					<div class="flex items-center p-2 border border-edge-muted bg-surface rounded-lg">
						{/* Filter chips and add button - flex left */}
						<div class="flex items-center gap-2 flex-wrap flex-1 min-w-0">
							<For each={props.filters}>
								{(filter) => <ConsolidatedFilterChip filter={filter} />}
							</For>
							<UnifiedFilterDropdown
								open={() => addFilterOpen()}
								onOpenChange={setAddFilterOpen}
								customTrigger={<AddFilterButton />}
							/>
						</div>

						{/* Clear button - right side */}
						<div class="flex items-center shrink-0">
							<Button
								onClick={() => props.onClearAll()}
								variant="ghost"
								size="sm"
							>
								<XIcon class="size-3!" />
								Clear all
							</Button>
						</div>
					</div>
				</div>
			</Layer>
		</Show>
	);
}
