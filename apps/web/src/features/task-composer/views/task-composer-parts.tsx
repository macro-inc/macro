import { t } from '@app/lib/i18n';
import { EditorSystemMessage } from '@block-md/component/EditorSystemMessage';
import { InlinePropertyValue } from '@block-md/component/InlinePropertyValue';
import { RecoverTaskDrafts } from '@block-md/component/RecoverTaskDrafts';
import { TaskComposerPropertyEditor } from '@block-md/component/TaskComposerPropertyEditor';
import { SimilarTasksSection } from '@block-md/component/TaskDuplicateList';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowsOutIcon from '@icon/system/regular/arrows-out.svg';
import PaperclipIcon from '@icon/system/regular/paperclip.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Property } from '@property';
import { Modals } from '@property/component/modal';
import { PropertiesProvider } from '@property/context/PropertiesContext';
import { InlineTagsPill } from '@property/tags';
import { Button, EntityComposer, Scroll, ToggleSwitch, Tooltip } from '@ui';
import {
  createContext,
  For,
  type JSX,
  Show,
  Suspense,
  useContext,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { tabbable } from 'tabbable';
import { CustomerContactPill } from '../components/customer-contact-pill';
import {
  ComposeTaskTitleEditor,
  TaskTitleAccessory,
} from '../components/title-editor';
import { TASK_COMPOSER_TITLE_ATTRIBUTE } from '../new-task-title-focus';
import type { TaskComposerController } from '../primitives/task-composer';

const TaskComposerPartsContext = createContext<TaskComposerController>();

function useTaskComposer() {
  const composer = useContext(TaskComposerPartsContext);
  if (!composer) {
    throw new Error('TaskComposer parts must be rendered inside Root');
  }
  return composer;
}

/** The pickers the parts open; a touch sheet's view picks in stacked sheets. */
type TaskComposerPickers = {
  tagsPill: typeof InlineTagsPill;
  propertyEditor: typeof Property.PopoverEditor;
};

const TaskComposerPickersContext = createContext<TaskComposerPickers>({
  tagsPill: InlineTagsPill,
  propertyEditor: Property.PopoverEditor,
});

function Root(props: {
  composer: TaskComposerController;
  /** The tags pill; `InlineTagsSheetPill` inside a touch sheet. */
  tagsPill?: typeof InlineTagsPill;
  /** The editor property pills open; `Property.SheetEditor` inside a touch sheet. */
  propertyEditor?: typeof Property.PopoverEditor;
  children: JSX.Element;
}) {
  const pickers: TaskComposerPickers = {
    get tagsPill() {
      return props.tagsPill ?? InlineTagsPill;
    },
    get propertyEditor() {
      return props.propertyEditor ?? Property.PopoverEditor;
    },
  };
  return (
    <TaskComposerPartsContext.Provider value={props.composer}>
      <TaskComposerPickersContext.Provider value={pickers}>
        <EntityComposer.Root tabIndex={-1} ref={props.composer.setContainerRef}>
          {props.children}
        </EntityComposer.Root>
      </TaskComposerPickersContext.Provider>
    </TaskComposerPartsContext.Provider>
  );
}

function ContinueInSplit() {
  const composer = useTaskComposer();
  return (
    <Show when={composer.isPopover() && !composer.isTemplateMode()}>
      <Button
        onMouseDown={composer.continueInSplit}
        disabled={composer.isCreating()}
        tabIndex={-1}
        tooltip="Continue editing in split"
        variant="ghost"
        size="icon-md"
      >
        <ArrowsOutIcon class="size-4 shrink-0 pointer-events-none" />
      </Button>
    </Show>
  );
}

function ClearDraft() {
  const composer = useTaskComposer();
  return (
    <Show when={!composer.isTemplateMode() && composer.hasDraftChanges()}>
      <Button
        onMouseDown={composer.clearDraft}
        disabled={composer.isCreating()}
        tabIndex={-1}
        tooltip="Clear Draft"
        size="xs"
        variant="secondary"
      >
        Clear Draft
      </Button>
    </Show>
  );
}

/** `ClearDraft` as a text-only action, for the touch sheet's header. */
function Clear() {
  const composer = useTaskComposer();
  return (
    <Show when={!composer.isTemplateMode() && composer.hasDraftChanges()}>
      <Button
        variant="ghost"
        size="sm"
        disabled={composer.isCreating()}
        onClick={composer.clearDraft}
      >
        Clear
      </Button>
    </Show>
  );
}

function Close() {
  const composer = useTaskComposer();
  return (
    <Show when={composer.isPopover()}>
      <Button
        onMouseDown={composer.close}
        disabled={composer.isSavingTemplate()}
        tabIndex={-1}
        tooltip="Close"
        variant="ghost"
        size="icon-md"
      >
        <XIcon class="size-4 shrink-0 pointer-events-none" />
      </Button>
    </Show>
  );
}

/** Other unconfirmed submissions, and a notice when this draft is one. */
function Recovery() {
  const composer = useTaskComposer();
  return (
    <>
      <RecoverTaskDrafts
        userId={composer.draftOwner}
        drafts={composer
          .submissions()
          .filter((draft) => draft.id !== composer.recovered?.id)}
        onOpen={composer.recoverDraft}
      />
      <Show when={composer.recovered}>
        <div class="border-b border-edge-muted p-3 text-sm">
          Recovered on this device. Task creation requires a connection. Check
          Tasks before retrying to avoid creating a duplicate.
        </div>
      </Show>
    </>
  );
}

function Title() {
  const composer = useTaskComposer();
  const pickers = useContext(TaskComposerPickersContext);
  return (
    <EntityComposer.Title {...{ [TASK_COMPOSER_TITLE_ATTRIBUTE]: '' }}>
      <Show
        when={
          !composer.isTemplateMode() && composer.tagLayoutMode() === 'title'
        }
      >
        <TaskTitleAccessory>
          <Dynamic
            component={pickers.tagsPill}
            docTags={composer.composerTags}
            variant="secondary"
            size="xs"
            showPlaceholder
            class="shrink-0"
            onActiveChange={composer.handleTitleTagPickerActive}
          />
        </TaskTitleAccessory>
      </Show>
      <Show when={composer.isTemplateMode() ? 'template' : 'task'} keyed>
        {(mode) => (
          <ComposeTaskTitleEditor
            value={() => {
              const selection = composer.templateSelection();
              return mode === 'template' &&
                (selection.kind === 'new' || selection.kind === 'editing')
                ? selection.name
                : composer.title();
            }}
            onChange={
              mode === 'template' ? composer.setTemplateName : composer.setTitle
            }
            placeholder={
              mode === 'template'
                ? t('create.taskTemplateNamePlaceholder')
                : undefined
            }
            label={
              mode === 'template' ? t('create.taskTemplateName') : undefined
            }
            disabled={composer.isCreating}
            onSubmit={() =>
              fireAndForget(
                mode === 'template'
                  ? composer.saveTemplate()
                  : composer.createTask(),
                'compose-task'
              )
            }
            bodyEditor={composer.bodyEditor}
            containerRef={composer.containerRef}
            onUserInput={() => {
              if (composer.errorMessage()) composer.setErrorMessage('');
            }}
            onTagSelected={
              mode === 'task'
                ? (tag) => {
                    composer.setTagLayoutMode('title');
                    fireAndForget(
                      composer.composerTags.applyTag(tag.scope, tag.optionId),
                      'compose-task'
                    );
                  }
                : undefined
            }
            onDeleteTagsAtStart={
              mode === 'task' ? composer.deleteTitleTagsAtStart : undefined
            }
            portalScope={composer.portalScope()}
            ref={composer.setTitleEditorRoot}
            autofocus={
              mode === 'template' ? !isTouchDevice() : composer.autofocusTitle
            }
          />
        )}
      </Show>
    </EntityComposer.Title>
  );
}

function Body() {
  const composer = useTaskComposer();
  return (
    <EntityComposer.Body class="mb-0">
      <Scroll>
        <MarkdownShell
          config={composer.editorConfig}
          onConnect={composer.onBodyReady}
          initialState={composer.initialState.editorState}
          initialValue={
            composer.initialState.editorState
              ? undefined
              : composer.initialState.content || undefined
          }
          placeholder={composer.props.placeholder ?? 'Add description...'}
          portalScope={composer.portalScope()}
        />
      </Scroll>
    </EntityComposer.Body>
  );
}

function Attach() {
  const composer = useTaskComposer();
  let input: HTMLInputElement | undefined;
  const attachSelectedFiles = async (event: Event) => {
    const target = event.currentTarget as HTMLInputElement;
    const files = Array.from(target.files ?? []);
    target.value = '';
    await composer.attachFiles(files);
  };
  return (
    <>
      <input
        ref={(el) => {
          input = el;
        }}
        type="file"
        class="hidden"
        multiple
        accept="image/*,video/*"
        onChange={attachSelectedFiles}
      />
      <Button
        onMouseDown={() => input?.click()}
        tabIndex={-1}
        tooltip="Attach image or video"
        variant="ghost"
        size="icon-md"
      >
        <PaperclipIcon class="size-4 touch:size-6 shrink-0 pointer-events-none" />
      </Button>
    </>
  );
}

/** The property pills, tags, and Add property; `class` places the row. */
function Properties(props: { class?: string }) {
  const composer = useTaskComposer();
  const pickers = useContext(TaskComposerPickersContext);
  return (
    <Suspense fallback={<div class="h-7" />}>
      <PropertiesProvider
        entityType="TASK"
        canEdit={true}
        properties={composer.properties}
        onRefresh={() => {}}
        onPropertyAdded={() => {}}
        onPropertyDeleted={() => {}}
        saveHandler={composer.saveHandler}
      >
        <EntityComposer.Properties
          class={props.class}
          on:keydown={(e) => {
            // Shift+Tab or ArrowUp on the first property returns to the description.
            if (!(e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey))) {
              return;
            }
            const target = e.target as HTMLElement;
            if (tabbable(e.currentTarget).indexOf(target) !== 0) return;
            const editor = composer.bodyEditor();
            if (!editor) return;
            e.preventDefault();
            e.stopPropagation();
            editor.focus(undefined, { defaultSelection: 'rootEnd' });
          }}
        >
          <For each={composer.properties()}>
            {(property) => (
              <InlinePropertyValue
                property={property}
                emptyLabel={property.displayName}
                editor={pickers.propertyEditor}
              />
            )}
          </For>
          <Show when={composer.showCustomerContact}>
            <CustomerContactPill
              values={composer.propertyValues}
              onChange={composer.setPropertyValues}
              editor={pickers.propertyEditor}
            />
          </Show>
          <Show when={composer.tagLayoutMode() === 'bottom'}>
            <Dynamic
              component={pickers.tagsPill}
              docTags={composer.composerTags}
              variant="secondary"
              size="xs"
              showPlaceholder
            />
          </Show>
          <TaskComposerPropertyEditor
            name={composer.title()}
            definitions={composer.availableProperties()}
            properties={composer.properties()}
            onAdd={composer.addProperty}
            onSave={(id, value) => composer.setPropertyValues(id, value)}
          />
        </EntityComposer.Properties>
        <Modals />
      </PropertiesProvider>
    </Suspense>
  );
}

function ErrorMessage() {
  const composer = useTaskComposer();
  return (
    <Show when={composer.errorMessage()}>
      <div class="w-full border-b border-edge-muted" />
      <div class="p-2">
        <EditorSystemMessage variant="error">
          {composer.errorMessage()}
        </EditorSystemMessage>
      </div>
    </Show>
  );
}

function ShareToggle() {
  const composer = useTaskComposer();
  const ownership = () => {
    const selection = composer.templateSelection();
    if (selection.kind !== 'editing' || !selection.template.teamId)
      return undefined;
    const team = composer.team();
    return t('create.taskTemplateSharedWithTeam', {
      name:
        selection.template.teamId === team?.id
          ? team.name
          : t('create.taskTemplateTeam'),
    });
  };
  const checked = () => {
    const selection = composer.templateSelection();
    return selection.kind === 'new'
      ? Boolean(selection.teamId)
      : composer.shareWithTeam();
  };
  return (
    <Show
      when={composer.templateSelection().kind !== 'editing'}
      fallback={
        <Show when={ownership()}>
          {(label) => (
            <span class="min-w-0 truncate text-xs text-ink-muted">
              {label()}
            </span>
          )}
        </Show>
      }
    >
      <Show when={composer.team()}>
        {(team) => (
          <Tooltip
            label={composer.sharingHint()}
            disabled={composer.isTemplateMode()}
          >
            <ToggleSwitch
              class="shrink-0 ml-0.5"
              checked={checked()}
              onChange={(value) => {
                if (composer.isTemplateMode())
                  composer.setTemplateTeamId(value ? team().id : null);
                else composer.setShareWithTeam(value);
              }}
              disabled={composer.isCreating()}
              label={t('create.taskTemplateShareWithTeam', {
                name: team().name,
              })}
              labelClass="text-xs text-ink-muted font-normal whitespace-nowrap"
            />
          </Tooltip>
        )}
      </Show>
    </Show>
  );
}

function LinkInSourceToggle() {
  const composer = useTaskComposer();
  return (
    <Show when={!composer.isTemplateMode() && composer.props.linkInSource}>
      {(linkInSource) => (
        <ToggleSwitch
          labelClass="text-xs text-ink-muted font-normal whitespace-nowrap"
          onChange={composer.setLinkInSourceEnabled}
          checked={composer.linkInSourceEnabled()}
          label={linkInSource().label}
        />
      )}
    </Show>
  );
}

function CreateMoreToggle() {
  const composer = useTaskComposer();
  return (
    <Show when={!composer.isTemplateMode()}>
      <ToggleSwitch
        labelClass="text-xs text-ink-muted font-normal whitespace-nowrap"
        onChange={composer.setCreateMore}
        disabled={!!composer.recovered || composer.isCreating()}
        checked={composer.createMore()}
        label="Create More"
      />
    </Show>
  );
}

function Submit() {
  const composer = useTaskComposer();
  const label = () => {
    if (composer.isTemplateMode()) return t('create.taskTemplateSave');
    return composer.createMore()
      ? t('create.taskCreateMore')
      : t('create.taskCreate');
  };
  return (
    <EntityComposer.Submit
      variant="primary"
      size="sm"
      onClick={() =>
        fireAndForget(
          composer.isTemplateMode()
            ? composer.saveTemplate()
            : composer.createTask(),
          'compose-task'
        )
      }
      disabled={!composer.canSubmit() || composer.isCreating()}
      hasContent={composer.canSubmit()}
    >
      {label()}
    </EntityComposer.Submit>
  );
}

function CancelTemplate() {
  const composer = useTaskComposer();
  return (
    <Show when={composer.isTemplateMode()}>
      <Button
        variant="ghost"
        size="sm"
        disabled={composer.isSavingTemplate()}
        onClick={composer.cancelTemplateEdit}
      >
        {t('create.taskTemplateCancel')}
      </Button>
    </Show>
  );
}
function SimilarTasks() {
  const composer = useTaskComposer();
  return (
    <SimilarTasksSection
      title={composer.title}
      content={composer.content}
      onOpenTask={composer.openSimilarTask}
    />
  );
}

/**
 * Parts of the task composer. A view creates the controller with
 * `createTaskComposer`, hands it to `Root`, and lays out the parts it shows.
 */
export const TaskComposer = {
  Root,
  ContinueInSplit,
  ClearDraft,
  Clear,
  Close,
  Recovery,
  Title,
  Body,
  Attach,
  Properties,
  ErrorMessage,
  ShareToggle,
  LinkInSourceToggle,
  CreateMoreToggle,
  Submit,
  CancelTemplate,
  SimilarTasks,
};
