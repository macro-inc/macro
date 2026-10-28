import type { Agent } from '../src/entities/agents/agent';
import type { Message } from '../src/entities/channels/message';
import type { PipelineRow } from '../src/entities/crm/pipeline';
import type { Comment } from '../src/entities/documents/comment';
import type { Document } from '../src/entities/documents/document';
import type {
  EntityReference,
  Macro,
  RoutineEventFilter,
  SharePermissionOptions,
  TimelineOptions,
} from '../src/macro';

type AssertFalse<T extends false> = T;
type AssertTrue<T extends true> = T;
type Accepts<Input, Value> = Value extends Input ? true : false;

/** Compiled with the SDK: changing an entity parameter back into an ID fails here. */
export type EntityInputContracts = [
  AssertFalse<
    Accepts<
      NonNullable<Parameters<Macro['routines']['create']>[0]['agent']>,
      string
    >
  >,
  AssertTrue<
    Accepts<
      NonNullable<Parameters<Macro['routines']['create']>[0]['agent']>,
      Agent
    >
  >,
  AssertFalse<
    Accepts<
      NonNullable<
        Parameters<Macro['initiatives']['create']>[0]['members']
      >[number],
      string
    >
  >,
  AssertFalse<
    Accepts<
      Parameters<Macro['entityMentions']['create']>[0],
      { type: 'document'; entity: string }
    >
  >,
  AssertFalse<
    Accepts<Parameters<Macro['crm']['pipelines']['byId']>[0], number>
  >,
  AssertFalse<
    Accepts<
      NonNullable<
        SharePermissionOptions['channelSharePermissions']
      >[number]['channel'],
      string
    >
  >,
  AssertFalse<
    Accepts<NonNullable<RoutineEventFilter['entities']>[number], string>
  >,
  AssertTrue<Accepts<EntityReference, { type: 'document'; entity: Document }>>,
  AssertFalse<Accepts<EntityReference, { type: 'channel'; entity: Document }>>,
  AssertFalse<
    Accepts<NonNullable<TimelineOptions<Message>['around']>, Comment>
  >,
  AssertFalse<
    Accepts<
      Parameters<
        ReturnType<Macro['email']['draftById']>['removeAttachment']
      >[0],
      string
    >
  >,
  AssertFalse<
    Accepts<
      Parameters<ReturnType<Macro['documents']['byId']>['access']['grant']>[0],
      string
    >
  >,
];

/** Lists and receipts keep resources as handles, including nested subresources. */
export type EntityOutputContracts = [
  AssertTrue<
    Accepts<
      { id: string; delete(): Promise<void> },
      Awaited<ReturnType<Macro['routines']['create']>>
    >
  >,
  AssertFalse<
    Accepts<Awaited<ReturnType<Macro['apiKeys']['create']>>['key'], string>
  >,
  AssertTrue<
    Accepts<
      Awaited<ReturnType<Macro['crm']['pipelines']['create']>>['rows'] extends (
        ...args: never[]
      ) => AsyncGenerator<infer Row>
        ? Row
        : never,
      PipelineRow
    >
  >,
];

/** SQL scopes and write guards accept database/table handles rather than raw IDs. */
export type QueryInputContracts = [
  AssertFalse<
    Accepts<
      NonNullable<Parameters<Macro['databases']['query']>[1]>['database'],
      string
    >
  >,
  AssertFalse<
    Accepts<
      NonNullable<
        NonNullable<Parameters<Macro['databases']['query']>[1]>['baseVersions']
      >[number]['table'],
      string
    >
  >,
  AssertTrue<
    Accepts<
      NonNullable<
        NonNullable<Parameters<Macro['databases']['query']>[1]>['baseVersions']
      >[number],
      Awaited<ReturnType<Macro['databases']['query']>>['readVersions'][number]
    >
  >,
];
