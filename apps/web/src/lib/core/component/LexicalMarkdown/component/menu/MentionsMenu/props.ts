import type { BlockName } from '@core/block';
import type { PortalScope } from '@core/component/ScopedPortal';
import type { EntityBucket, EntityItem } from '@core/context/quickAccess';
import type { ChannelWithParticipants, IUser } from '@core/user';
import type { EmailEntity } from '@entity';
import type { HistoryItem as Item } from '@queries/history/history';
import type { LexicalEditor } from 'lexical';
import type { Accessor } from 'solid-js';
import type { MenuOperations } from '../../../shared/inlineMenu';
import type {
  MentionItem,
  UserMentionRecord,
} from '../../../utils/mentionsUtils';
import type { MentionBucketId } from './MentionsMenuController';
import type { NativeMentionPresentation } from './native-presentation';

export type MentionsMenuProps = {
  /** Uses these exact providers/controller without mounting the DOM menu. */
  nativePresentation?: NativeMentionPresentation;
  menu: MenuOperations;
  /** Undefined delegates to personal search; an empty list stays scoped empty. */
  users?: Accessor<IUser[] | undefined>;
  transformUsers?: (users: readonly IUser[]) => IUser[];
  /** pass in custom entity items to replace quickAccess data (e.g. sandbox data for onboarding) */
  entities?: Accessor<EntityItem[]>;
  /** whether the menu checks against block boundary in floating middleware. uses floating-ui default if false. */
  useBlockBoundary?: boolean;
  portalScope?: PortalScope;
  /** Mounts the menu here instead of by `portalScope`. */
  portalMount?: HTMLElement;
  block?: BlockName;
  anchor?: HTMLElement | null;
  onUserMention?: (mention: UserMentionRecord) => void;
  onDocumentMention?: (item: Item | ChannelWithParticipants) => void;
  onEmailMention?: (item: EmailEntity) => void;
  disableMentionTracking?: boolean;
  /**
   * The document hosting the editor, which records inserted mentions.
   * Defaults to the enclosing legacy block, which routed documents lack.
   */
  sourceDocumentId?: string;
  /** whether to show open tabs as a bucket in the menu */
  showOpenTabs?: boolean;
  /** restrict which mention source buckets to show (e.g. ['users'] for user-only mentions) */
  sources?: MentionBucketId[];
  /** Restrict the document bucket at the query source (e.g. task-only reference fields). */
  documentBuckets?: EntityBucket[];
  /** Scalar person fields cannot store group mentions. Defaults to true. */
  includeGroups?: boolean;
  /** Disable CRM references for fields that only store Macro user identities. */
  includeContacts?: boolean;
  /** Repeated cell editing opens immediately instead of animating each picker. */
  animate?: boolean;
} & (
  | { editor: LexicalEditor; onPick?: never }
  | { editor?: never; anchor: HTMLElement; onPick: (item: MentionItem) => void }
);
