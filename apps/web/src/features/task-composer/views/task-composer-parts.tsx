import { EditorSystemMessage } from '@block-md/component/EditorSystemMessage';
import { InlinePropertyValue } from '@block-md/component/InlinePropertyValue';
import { RecoverTaskDrafts } from '@block-md/component/RecoverTaskDrafts';
import { TaskComposerPropertyEditor } from '@block-md/component/TaskComposerPropertyEditor';
import { SimilarTasksSection } from '@block-md/component/TaskDuplicateList';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowsOutIcon from '@icon/system/regular/arrows-out.svg';
import PaperclipIcon from '@icon/system/regular/paperclip.svg';
import XIcon from '@icon/system/regular/x.svg';
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
import { tabbable } from 'tabbable';
import {
  ComposeTaskTitleEditor,
  TaskTitleAccessory,
} from '../components/title-editor';
import type { TaskComposerController } from '../primitives/task-composer';

const TaskComposerPartsContext = createContext<TaskComposerController>();

function useTaskComposer() {
  const composer = useContext(TaskComposerPartsContext);
  if (!composer) {
    throw new Error('TaskComposer parts must be rendered inside Root');
  }
  return composer;
}

function Root(props: {
  composer: TaskComposerController;
  children: JSX.Element;
}) {
  return (
    <TaskComposerPartsContext.Provider value={props.composer}>
      <EntityComposer.Root tabIndex={-1} ref={props.composer.setContainerRef}>
        {props.children}
      </EntityComposer.Root>
    </TaskComposerPartsContext.Provider>
  );
}

function ContinueInSplit() {
  const composer = useTaskComposer();
  return (
    <Show when={composer.isPopover()}>
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
    <Show when={composer.hasDraftChanges()}>
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
    <Show when={composer.hasDraftChanges()}>
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
  return (
    <EntityComposer.Title>
      <Show when={composer.tagLayoutMode() === 'title'}>
        <TaskTitleAccessory>
          <InlineTagsPill
            docTags={composer.composerTags}
            variant="secondary"
            size="xs"
            showPlaceholder
            class="shrink-0"
            onActiveChange={composer.handleTitleTagPickerActive}
          />
        </TaskTitleAccessory>
      </Show>
      <ComposeTaskTitleEditor
        value={composer.title}
        onChange={composer.setTitle}
        disabled={composer.isCreating}
        bodyEditor={composer.bodyEditor}
        containerRef={composer.containerRef}
        onUserInput={() => {
          if (composer.errorMessage()) {
            composer.setErrorMessage('');
          }
        }}
        onTagSelected={(tag) => {
          composer.setTagLayoutMode('title');
          fireAndForget(
            composer.composerTags.applyTag(tag.scope, tag.optionId),
            'compose-task'
          );
        }}
        onDeleteTagsAtStart={composer.deleteTitleTagsAtStart}
        portalScope={composer.portalScope()}
        ref={composer.setTitleEditorRoot}
      />
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
              />
            )}
          </For>
          <Show when={composer.tagLayoutMode() === 'bottom'}>
            <InlineTagsPill
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
  return (
    <Show when={composer.team()}>
      {(team) => (
        <Tooltip label={composer.sharingHint()} tabIndex={0}>
          <ToggleSwitch
            class="shrink-0 ml-0.5"
            checked={composer.shareWithTeam()}
            onChange={composer.setShareWithTeam}
            disabled={composer.isCreating()}
            label={`Share with ${team().name}`}
            labelClass="text-xs text-ink-muted font-normal whitespace-nowrap"
          />
        </Tooltip>
      )}
    </Show>
  );
}

function LinkInSourceToggle() {
  const composer = useTaskComposer();
  return (
    <Show when={composer.props.linkInSource}>
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
    <ToggleSwitch
      labelClass="text-xs text-ink-muted font-normal whitespace-nowrap"
      onChange={composer.setCreateMore}
      disabled={!!composer.recovered || composer.isCreating()}
      checked={composer.createMore()}
      label="Create More"
    />
  );
}

function Submit() {
  const composer = useTaskComposer();
  return (
    <EntityComposer.Submit
      variant="primary"
      size="sm"
      onClick={composer.createTask}
      disabled={composer.title().trim().length === 0 || composer.isCreating()}
      hasContent={composer.title().trim().length > 0}
    >
      Create Task
    </EntityComposer.Submit>
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
  SimilarTasks,
};
