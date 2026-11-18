import type { CrmContactEntity } from '@entity';
import { createSignal, type JSX, type ParentProps } from 'solid-js';

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

const browsedEmails = Array.from({ length: 55 }, (_, index) => ({
  type: 'email',
  id: `email-${index + 1}`,
  name: `Email ${String(index).padStart(2, '0')}`,
  updatedAt: new Date('2026-10-15'),
}));
const [emailPages, setEmailPages] = createSignal(50);
const [loadingEmails, setLoadingEmails] = createSignal(false);
const [emailError, setEmailError] = createSignal<unknown>();
let holdEmails = false;
let failEmails = false;
let releaseEmails: (() => void) | undefined;
export const createEmailsInfiniteQuery = (
  _args?: unknown,
  options?: { disabled?: () => boolean }
) => {
  const enabled = () => !options?.disabled?.();
  const items = () => (enabled() ? browsedEmails.slice(0, emailPages()) : []);
  return {
    get data() {
      return items();
    },
    isLoading: false,
    isPending: false,
    get hasNextPage() {
      return enabled() && items().length < browsedEmails.length;
    },
    get isFetchingNextPage() {
      return loadingEmails();
    },
    get error() {
      return emailError();
    },
    fetchNextPage: async () => {
      if (!enabled()) return;
      setLoadingEmails(true);
      setEmailError(undefined);
      try {
        if (holdEmails) {
          await new Promise<void>((resolve) => {
            releaseEmails = resolve;
          });
        }
        holdEmails = false;
        if (failEmails) {
          failEmails = false;
          setEmailError(new Error('Synthetic email page failure'));
          return;
        }
        setEmailPages((loaded) => loaded + 50);
      } finally {
        setLoadingEmails(false);
      }
    },
  };
};
export const Entity = {
  Icon: () => <span aria-hidden="true">▣</span>,
  Title: (props: { entity: { name: string } }) => <>{props.entity.name}</>,
};

export const isTaskEntity = (entity: { type: string }) =>
  entity.type === 'task';

Object.assign(window, {
  emailPickerFixture: {
    holdNext() {
      holdEmails = true;
    },
    failNext() {
      failEmails = true;
    },
    release() {
      releaseEmails?.();
      releaseEmails = undefined;
    },
  },
});

declare global {
  interface Window {
    emailPickerFixture: {
      holdNext(): void;
      failNext(): void;
      release(): void;
    };
  }
}
