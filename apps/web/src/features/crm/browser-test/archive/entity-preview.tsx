import type { CrmContactEntity } from '@entity';
import type { JSX, ParentProps } from 'solid-js';

// Isolate global entity metadata/navigation services; the Team component,
// filtering, queries, visibility action, search, and confirmation are real.
export const ListEntityMetadataQueryProvider = (props: ParentProps) =>
  props.children;
export const ListLayoutProvider = (props: ParentProps) => props.children;
export function ListEntity(props: {
  entity: CrmContactEntity;
  icon: JSX.Element;
  titleTrailing: JSX.Element;
  onClick: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
}) {
  return (
    <button
      type="button"
      class="flex min-h-12 items-center gap-2 px-4 text-left"
      onClick={props.onClick}
    >
      {props.icon}
      <span>{props.entity.name}</span>
      {props.titleTrailing}
    </button>
  );
}

export {
  formatDateAndTime,
  formatRelativeTimestamp,
} from '../../../entity/utils/timestamp';

export const createEmailsInfiniteQuery = () => ({
  data: [],
  isLoading: false,
  isPending: false,
});
export const Entity = {
  Icon: () => <span aria-hidden="true">▣</span>,
  Title: (props: { entity: { name: string } }) => <>{props.entity.name}</>,
};

export const isTaskEntity = (entity: { type: string }) =>
  entity.type === 'task';
