import { createSignal, Show } from 'solid-js';
import { format } from 'date-fns';
import { PropertyDateSelector } from './PropertyDateSelector';
import type { DateProperty } from '@core/component/Properties/types';

/**
 * Demo component to test PropertyDateSelector integration
 */
export function PropertyDateSelectorDemo() {
  const [selectedDate, setSelectedDate] = createSignal<Date | null>(
    new Date('2024-06-15T10:00:00')
  );
  const [isOpen, setIsOpen] = createSignal(false);
  let buttonRef: HTMLButtonElement | undefined;

  // Mock DateProperty
  const mockProperty: DateProperty = {
    propertyId: 'demo-date-prop-1',
    propertyDefinitionId: 'def-date-1',
    displayName: 'Due Date',
    isMultiSelect: false,
    isMetadata: false,
    isSystemProperty: false,
    owner: {
      type: 'USER',
      id: 'user-123',
    },
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    valueType: 'DATE',
    value: selectedDate(),
  };

  const handleDateSelect = (date: Date | null) => {
    setSelectedDate(date);
    console.log(
      'Date selected:',
      date ? format(date, 'yyyy-MM-dd HH:mm:ss') : 'null'
    );
  };

  const handleClose = () => {
    setIsOpen(false);
    console.log('Selector closed');
  };

  return (
    <div class="p-8 max-w-4xl mx-auto space-y-6">
      <h1 class="text-2xl font-bold">PropertyDateSelector Demo</h1>

      {/* Demo Section 1: Basic Usage */}
      <section class="border border-edge-muted rounded-lg p-6 space-y-4">
        <h2 class="text-lg font-semibold">Basic Date Property Selector</h2>

        <div class="space-y-3">
          <div class="flex items-center gap-4">
            <button
              ref={buttonRef}
              onClick={() => setIsOpen(!isOpen())}
              class="px-4 py-2 bg-dialog border border-edge-muted rounded hover:bg-active transition-colors"
            >
              Select Date for "{mockProperty.displayName}"
            </button>

            <div class="text-sm">
              <span class="text-ink-muted">Current value: </span>
              <span class="font-mono font-medium">
                {selectedDate()
                  ? format(selectedDate()!, 'MMM d, yyyy h:mm a')
                  : 'No date set'}
              </span>
            </div>
          </div>

          {/* Show the selector when open */}
          <Show when={isOpen()}>
            <div class="relative">
              <div class="absolute z-50 w-96 bg-menu border border-edge-muted shadow-lg rounded-lg overflow-hidden">
                <PropertyDateSelector
                  property={mockProperty}
                  selectedDate={selectedDate()}
                  onSelectDate={handleDateSelect}
                  onClose={handleClose}
                />
              </div>
            </div>
          </Show>
        </div>
      </section>

      {/* Demo Section 2: Multiple Properties */}
      <section class="border border-edge-muted rounded-lg p-6 space-y-4">
        <h2 class="text-lg font-semibold">Multiple Date Properties</h2>

        <DatePropertyRow
          label="Start Date"
          propertyId="start-date"
          initialDate={new Date()}
        />

        <DatePropertyRow
          label="End Date"
          propertyId="end-date"
          initialDate={null}
        />

        <DatePropertyRow
          label="Review Date"
          propertyId="review-date"
          initialDate={new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)}
        />
      </section>

      {/* Instructions */}
      <section class="bg-active rounded-lg p-6 space-y-4">
        <h3 class="text-md font-semibold">How to Test:</h3>
        <ul class="space-y-2 text-sm text-ink-muted">
          <li class="flex items-start gap-2">
            <span class="text-accent">•</span>
            <div>
              <strong>Duration DSL:</strong> Type{' '}
              <code class="font-mono bg-dialog px-1 py-0.5 rounded">3d</code>{' '}
              for 3 days,{' '}
              <code class="font-mono bg-dialog px-1 py-0.5 rounded">1w</code>{' '}
              for 1 week,{' '}
              <code class="font-mono bg-dialog px-1 py-0.5 rounded">36h</code>{' '}
              for 36 hours
            </div>
          </li>
          <li class="flex items-start gap-2">
            <span class="text-accent">•</span>
            <div>
              <strong>Natural dates:</strong> Type{' '}
              <code class="font-mono bg-dialog px-1 py-0.5 rounded">
                feb 17
              </code>
              ,{' '}
              <code class="font-mono bg-dialog px-1 py-0.5 rounded">
                march 3 2025
              </code>
              ,{' '}
              <code class="font-mono bg-dialog px-1 py-0.5 rounded">
                tomorrow
              </code>
            </div>
          </li>
          <li class="flex items-start gap-2">
            <span class="text-accent">•</span>
            <div>
              <strong>Keyboard nav:</strong> Use arrow keys to navigate, Enter
              to select, Escape to close
            </div>
          </li>
          <li class="flex items-start gap-2">
            <span class="text-accent">•</span>
            <div>
              <strong>Quick select:</strong> Press 1-9 to quickly select from
              the first 9 options
            </div>
          </li>
          <li class="flex items-start gap-2">
            <span class="text-accent">•</span>
            <div>
              <strong>Clear date:</strong> Click "Clear" or press
              Delete/Backspace with empty search
            </div>
          </li>
        </ul>
      </section>

      {/* Test Results */}
      <section class="bg-dialog rounded-lg p-6">
        <h3 class="text-md font-semibold mb-3">Expected Behaviors:</h3>
        <div class="space-y-2 text-sm">
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-0.5" />
            <span>Date selector opens when button is clicked</span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-0.5" />
            <span>Search input is auto-focused when opened</span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-0.5" />
            <span>DSL parsing works (3d, 1w, etc.)</span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-0.5" />
            <span>Natural date parsing works (feb 17, tomorrow)</span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-0.5" />
            <span>Preset search shows relevant options</span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-0.5" />
            <span>Arrow key navigation highlights options</span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-0.5" />
            <span>Number hotkeys (1-9) work when visible</span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-0.5" />
            <span>Current date is displayed correctly</span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-0.5" />
            <span>Clear button removes the date</span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-0.5" />
            <span>Escape key closes the selector</span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-0.5" />
            <span>Selector closes after date selection</span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-0.5" />
            <span>Type badges (DSL, natural, preset) show correctly</span>
          </label>
        </div>
      </section>
    </div>
  );
}

// Helper component for testing multiple date properties
function DatePropertyRow(props: {
  label: string;
  propertyId: string;
  initialDate: Date | null;
}) {
  const [date, setDate] = createSignal<Date | null>(props.initialDate);
  const [isOpen, setIsOpen] = createSignal(false);

  const mockProperty: DateProperty = {
    propertyId: props.propertyId,
    propertyDefinitionId: `def-${props.propertyId}`,
    displayName: props.label,
    isMultiSelect: false,
    isMetadata: false,
    isSystemProperty: false,
    owner: {
      type: 'ORGANIZATION',
      id: 'org-123',
    },
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    valueType: 'DATE',
    value: date(),
  };

  return (
    <div class="flex items-center justify-between p-3 bg-active/50 rounded">
      <span class="text-sm font-medium">{props.label}:</span>

      <div class="flex items-center gap-3">
        <span class="text-sm text-ink-muted">
          {date() ? format(date()!, 'MMM d, yyyy h:mm a') : 'Not set'}
        </span>

        <button
          onClick={() => setIsOpen(!isOpen())}
          class="px-3 py-1 text-xs bg-dialog border border-edge-muted rounded hover:bg-active"
        >
          {date() ? 'Change' : 'Set'} Date
        </button>
      </div>

      <Show when={isOpen()}>
        <div
          class="fixed inset-0 z-40 bg-black/20"
          onClick={() => setIsOpen(false)}
        >
          <div
            class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-96 bg-menu border border-edge-muted shadow-lg rounded-lg overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <PropertyDateSelector
              property={mockProperty}
              selectedDate={date()}
              onSelectDate={(newDate) => {
                setDate(newDate);
                setIsOpen(false);
              }}
              onClose={() => setIsOpen(false)}
            />
          </div>
        </div>
      </Show>
    </div>
  );
}
