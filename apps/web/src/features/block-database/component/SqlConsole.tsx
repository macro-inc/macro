import { DatabaseQuestionPanel } from '@app/features/database-query/database-query';
import { toast } from '@core/component/Toast/Toast';
import { databaseQueryMarkdown } from '@macro-inc/lexical-core/nodes/DatabaseQueryNode';
import SparkleIcon from '@phosphor/sparkle.svg';
import XIcon from '@phosphor/x.svg';
import type { DatabaseDetail } from '@service-storage/databases';
import { databaseAssistantCapabilities } from '../queries/database-assistant';

export function SqlConsole(props: {
  detail: DatabaseDetail;
  activeTableId?: string;
  onClose: () => void;
}) {
  return (
    <div class="flex h-full min-h-0 flex-col bg-panel" data-database-questions>
      <div class="flex shrink-0 items-center justify-between gap-2 border-b border-edge-muted px-4 py-3.5">
        <div>
          <h2 class="flex items-center gap-2 text-sm font-medium text-ink">
            <SparkleIcon class="size-4 text-accent" />
            Database AI
          </h2>
        </div>
        <button
          class="rounded-md p-1.5 text-ink-muted hover:bg-hover hover:text-ink"
          aria-label="Close database questions"
          onClick={props.onClose}
        >
          <XIcon class="size-4" />
        </button>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <DatabaseQuestionPanel
          autoFocus
          capabilities={databaseAssistantCapabilities}
          promptPlaceholder="Ask a question or describe what to build…"
          detail={props.detail}
          activeTableId={props.activeTableId}
          saveLabel="Copy for a doc"
          saveHint="Paste into a doc to keep the answer live."
          onSave={async (definition) => {
            try {
              await navigator.clipboard.writeText(
                databaseQueryMarkdown(definition)
              );
              toast.success('Copied. Paste into a doc to add a live answer.');
            } catch {
              toast.failure('Could not copy. Please try again.');
            }
          }}
        />
      </div>
    </div>
  );
}
