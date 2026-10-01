import { DeleteDialog } from '@ui';
import { Show } from 'solid-js';

/** Confirms deleting projects; their tasks stay in the workspace. */
export function DeleteProjectsDialog(props: {
  count: number;
  pending: boolean;
  error?: string;
  onOpenChange(open: boolean): void;
  onDelete(): void;
  onCloseAutoFocus?(event: Event): void;
}) {
  const many = () => props.count > 1;
  return (
    <DeleteDialog
      open
      onOpenChange={props.onOpenChange}
      title={many() ? `Delete ${props.count} projects?` : 'Delete project?'}
      body={
        <>
          <p>
            {many()
              ? 'These projects and their activity will be deleted. Their tasks will remain in your workspace.'
              : 'The project and its activity will be deleted. Its tasks will remain in your workspace.'}
          </p>
          <Show when={props.error}>
            {(message) => (
              <p role="alert" class="mt-2 text-failure">
                {message()}
              </p>
            )}
          </Show>
        </>
      }
      deleteLabel={many() ? `Delete ${props.count} projects` : 'Delete project'}
      pending={props.pending}
      onDelete={props.onDelete}
      onCloseAutoFocus={props.onCloseAutoFocus}
    />
  );
}
