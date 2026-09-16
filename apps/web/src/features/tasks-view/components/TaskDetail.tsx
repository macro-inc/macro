import {
  MarkdownDetail,
  MarkdownDetailBodyState,
  type MarkdownDetailContext,
} from '@app/features/drive-view/views/MarkdownDetail';
import type { JSX } from 'solid-js';
import type { TaskDetailTarget } from '../types';

export type TaskDetailContext = MarkdownDetailContext;

export type TaskDetailProps = {
  task: TaskDetailTarget;
  shareOpen: boolean;
  onShareOpenChange: (open: boolean) => void;
  children?: (context: TaskDetailContext) => JSX.Element;
};

export function TaskDetailBodyState(props: {
  error?: unknown;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return <MarkdownDetailBodyState entityLabel="task" {...props} />;
}

/** Renders one task document without owning view navigation or breadcrumbs. */
export function TaskDetail(props: TaskDetailProps) {
  return (
    <MarkdownDetail
      documentId={props.task.id}
      kind="task"
      fallbackName={props.task.fallbackName ?? 'New Task'}
      shareOpen={props.shareOpen}
      onShareOpenChange={props.onShareOpenChange}
      children={props.children}
    />
  );
}
