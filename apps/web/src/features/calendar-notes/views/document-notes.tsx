import { fireAndForget } from '@core/util/fireAndForget';
import { DocumentNotesSection } from '../components/document-notes-section';
import type { DocumentNotesSource } from '../context/notes-source';
import { createDocumentNotesController } from '../primitives/document-notes-controller';

export function DocumentNotesView(props: { source: DocumentNotesSource }) {
  const controller = createDocumentNotesController(props.source);
  return (
    <DocumentNotesSection
      state={props.source.links()}
      team={props.source.team()}
      selected={controller.selected()}
      saving={controller.saving()}
      error={controller.error()}
      onSelect={controller.select}
      onTeam={(link, teamId) =>
        fireAndForget(controller.setTeam(link, teamId), 'calendar.notes.team')
      }
      onRemove={() =>
        fireAndForget(controller.remove(), 'calendar.notes.revoke')
      }
      onRetry={() =>
        fireAndForget(props.source.retry(), 'calendar.notes.retry')
      }
    />
  );
}
