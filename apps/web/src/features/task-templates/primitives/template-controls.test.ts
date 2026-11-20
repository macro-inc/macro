/** @vitest-environment jsdom */
import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import type {
  SelectableTaskTemplate,
  TaskTemplateSelection,
} from '../../task-composer/core/template-selection';
import { createTemplateControls } from './template-controls';

it('confirms replacements, keeps transport metadata out of drafts, and rejects retired picker actions', () => {
  const template: SelectableTaskTemplate = {
    id: 'template',
    name: 'Checklist',
    teamId: null,
    revision: 1,
    contents: {
      propertyIds: [],
      propertyDefaults: {},
      descriptionMarkdown: '',
    },
    canManage: true,
    hasUnavailableProperties: true,
  };
  const select = vi.fn();
  const confirmReplace = vi.fn();
  const notify = vi.fn();
  const session = createRoot((dispose) => {
    const [viewer, setViewer] = createSignal('viewer');
    const [selection, setSelection] = createSignal<TaskTemplateSelection>({
      kind: 'none',
    });
    const controls = createTemplateControls({
      viewerId: viewer,
      templates: () => [template],
      composer: {
        draftOwner: 'viewer',
        templatesEnabled: () => true,
        isCreating: () => false,
        team: () => undefined,
        templateSelection: selection,
        isTemplateDirty: () => true,
        selectTemplate: select,
        editTemplate: vi.fn(),
        selectNoTemplate: vi.fn(),
        startNewTemplate: vi.fn(),
        resetTemplateFields: vi.fn(),
        updateTemplateFields: vi.fn(async () => {}),
        cancelTemplateEdit: vi.fn(),
        detachTemplate: vi.fn(),
      },
      confirmReplace,
      confirmDelete: vi.fn(),
      notifyUnavailable: notify,
    });
    return { controls, setViewer, setSelection, dispose };
  });
  const item = session.controls.items()[0];
  item.select();
  expect(select).not.toHaveBeenCalled();
  confirmReplace.mock.calls[0][1]();
  expect(select).toHaveBeenCalledWith({
    id: template.id,
    name: template.name,
    teamId: null,
    revision: 1,
    contents: template.contents,
  });
  expect(notify).toHaveBeenCalledOnce();
  session.setSelection({ kind: 'saved', template });
  expect(session.controls.selectedCanManage()).toBe(true);
  session.setViewer('different-viewer');
  confirmReplace.mock.calls[0][1]();
  expect(select).toHaveBeenCalledTimes(1);
  expect(session.controls.selectedCanManage()).toBe(false);
  session.dispose();
  item.select();
  expect(confirmReplace).toHaveBeenCalledTimes(1);
});
