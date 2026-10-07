import type {
  BookingReceipt,
  BookingRequest,
} from '@app/features/scheduling/core/types';
import { okAsync } from 'neverthrow';
import { createSignal } from 'solid-js';
import type {
  FormBookingEvent,
  FormBookingLink,
  FormColumnWrites,
  FormContext,
  FormDetailSource,
  MyResponse,
  SubmitOutcome,
} from '../context/form-context';
import type { SubmittedAnswer } from '../core/answers';
import type {
  FormBookingTarget,
  FormColumn,
  FormDetail,
  FormLayout,
} from '../core/form-model';
import {
  createFakeCollaboration,
  type FakeCollaboration,
} from './fake-collaboration';

export const MOCK_VIEWER_ID = 'macro|respondent@example.com';

/** What a mocked context was asked to do, in order. */
export type MockFormCalls = {
  submitted: SubmittedAnswer[][];
  edited: SubmittedAnswer[][];
  /** Every shared layout this editor wrote. */
  layouts: FormLayout[];
  notices: string[];
  messagedOwners: string[];
  /** Booking targets whose event was read. */
  bookingEventsRead: FormBookingTarget[];
  slotsRead: { profile: string; event: string; date: string }[];
  booked: { profile: string; event: string; request: BookingRequest }[];
  receiptsOpened: BookingReceipt[];
  settingsOpened: number;
};

/** Native scheduling as a mocked context answers it. */
export type MockBooking = {
  available?: boolean;
  /** The editor's own booking links. */
  links?: FormBookingLink[];
  /** Each event type's event, by event type id; missing reads as deleted. */
  events?: Record<string, FormBookingEvent>;
  slots?: { startsAt: string; endsAt: string }[];
  receipt?: BookingReceipt;
};

/**
 * In-memory capabilities for views. The form detail is a signal the test
 * can replace; submissions answer `submitOutcome`; the shared layout is a
 * fake two-editor document seeded with the detail's layout. Pickers and the
 * grid render labelled placeholders.
 */
export function createMockFormContext(options: {
  detail: FormDetail;
  tableColumns?: FormColumn[];
  viewerId?: string | undefined;
  mine?: MyResponse | null;
  submitOutcome?: SubmitOutcome;
  booking?: MockBooking;
  overrides?: Partial<FormContext>;
}) {
  const [detail, setDetail] = createSignal<FormDetail | undefined>(
    options.detail
  );
  // Only editors open the shared layout; a respondent's detail can't seed it.
  let opened: FakeCollaboration | undefined;
  const shared = () => {
    opened ??= createFakeCollaboration(options.detail.layout);
    return opened;
  };
  const calls: MockFormCalls = {
    submitted: [],
    edited: [],
    get layouts() {
      return shared().written;
    },
    notices: [],
    messagedOwners: [],
    bookingEventsRead: [],
    slotsRead: [],
    booked: [],
    receiptsOpened: [],
    settingsOpened: 0,
  };
  const outcome: SubmitOutcome = options.submitOutcome ?? {
    kind: 'submitted',
    responseId: 'response-1',
    booking: null,
  };
  const booking = options.booking ?? {};
  const source: FormDetailSource = {
    detail,
    failure: () => undefined,
    refetch: async () => true,
  };
  const writes: FormColumnWrites = {
    create: () => okAsync(undefined),
    rename: () => okAsync(undefined),
    changeType: () => okAsync(undefined),
    addOptions: () => okAsync(undefined),
    updateOption: () => okAsync(undefined),
    deleteOption: () => okAsync(undefined),
    remove: () => okAsync(undefined),
    convert: () => okAsync('converted'),
  };
  const context: FormContext = {
    viewer: {
      userId: () => ('viewerId' in options ? options.viewerId : MOCK_VIEWER_ID),
    },
    createFormSource: () => source,
    createTableSource: () => ({
      columns: () => options.tableColumns ?? options.detail.columns,
      databaseName: () => 'Offsite',
      tableName: () => 'Responses',
      tables: () => [{ id: options.detail.form.tableId, name: 'Responses' }],
      refetch: async () => {},
    }),
    followTable: () => {},
    createLayoutCollaboration: () => shared().collaboration,
    updateMetadata: () => okAsync(undefined),
    renameForm: () => okAsync(undefined),
    trashForm: () => okAsync(undefined),
    confirm: async () => true,
    columns: () => writes,
    responses: {
      submit: (_, answers) => {
        calls.submitted.push(answers);
        return okAsync(outcome);
      },
      editMine: (_, answers) => {
        calls.edited.push(answers);
        return okAsync(outcome);
      },
      createMine: () => ({
        response: () => options.mine ?? null,
        failure: () => undefined,
        refetch: async () => {},
      }),
      createSummary: () => ({
        value: () => ({
          submitted: 0,
          stopped: 0,
          stoppedBySection: [],
          rows: 0,
        }),
        failure: () => undefined,
      }),
      createTally: () => ({ value: () => [], failure: () => undefined }),
      createInvited: () => ({ value: () => null, failure: () => undefined }),
      exportCsv: () => okAsync(undefined),
    },
    uploadFile: () => okAsync('https://static.example.com/file/1'),
    booking: {
      available: () => booking.available ?? true,
      createLinks: () => ({
        value: () => booking.links ?? [],
        failure: () => undefined,
      }),
      createEvent: (target) => ({
        value: () => {
          const current = target();
          if (!current) return undefined;
          calls.bookingEventsRead.push(current);
          return booking.events?.[current.eventTypeId] ?? null;
        },
        failure: () => undefined,
      }),
      createSource: () => ({
        slots: async (profile, event, date) => {
          calls.slotsRead.push({ profile, event, date });
          return booking.slots ?? [];
        },
        book: async (profile, event, request) => {
          calls.booked.push({ profile, event, request });
          if (!booking.receipt) throw new Error('No receipt in this test');
          return booking.receipt;
        },
      }),
      openReceipt: (receipt) => calls.receiptsOpened.push(receipt),
      openSettings: () => {
        calls.settingsOpened += 1;
      },
    },
    messageOwner: (ownerId) => {
      calls.messagedOwners.push(ownerId);
      return okAsync(undefined);
    },
    notify: {
      success: (message) => calls.notices.push(`✓ ${message}`),
      failure: (message) => calls.notices.push(`✗ ${message}`),
    },
    ui: {
      renderEntityPicker: () => null,
      renderRelationPicker: () => null,
      renderConditionEditor: () => null,
      renderResponsesGrid: () => null,
      renderEntityLabel: (entity) => entity.entityId,
      renderEditors: (props) =>
        `${props.peers.map((peer) => peer.userId).join(', ')} on ${props.selected}`,
    },
    ...options.overrides,
  };
  return {
    context,
    calls,
    setDetail,
    source,
    get shared() {
      return shared();
    },
  };
}
