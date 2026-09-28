import {
  type BackendAstMap,
  type BackendAstNode,
  combine,
  compileFacets,
  literal,
  mergeAst,
  NIL_UUID,
  type TagFacetContext,
} from '@app/features/soup/filters';
import type { SoupAstBody, SoupAstItemsQueryArgs } from '@queries/soup/items';
import type { DriveSelection } from '../context/drive-source';
import { DRIVE_FACETS } from '../filters/drive-facets';

export type BuildDriveQueryOptions = {
  selection: DriveSelection;
  userId: string | undefined;
  facetContext: TagFacetContext;
  snippetsEnabled?: boolean;
};

type DriveAstBody = BackendAstMap & Pick<SoupAstBody, 'emailView'>;

function excludedEntityTargets(): BackendAstMap {
  return {
    asf: literal('id', NIL_UUID),
    calf: literal('id', NIL_UUID),
    callf: literal('CallId', NIL_UUID),
    ccf: literal('id', NIL_UUID),
    cf: literal('cid', NIL_UUID),
    chanf: literal('ChannelId', NIL_UUID),
    cthf: literal('ChannelId', NIL_UUID),
    df: literal('id', NIL_UUID),
    ef: literal('ThreadId', NIL_UUID),
    fef: literal('id', NIL_UUID),
    pf: literal('pid', NIL_UUID),
    remf: literal('id', NIL_UUID),
  };
}

function attachmentScope(
  selection: DriveSelection
): BackendAstNode | undefined {
  if (selection.scope === 'default') return literal('iea', false);
  if (selection.scope === 'attachments') return literal('iea', true);

  return undefined;
}

function tabDocumentScope(
  selection: DriveSelection,
  userId: string | undefined,
  snippetsEnabled: boolean
): BackendAstNode {
  const nodes: BackendAstNode[] = [{ '!': literal('dst', 'task') }];

  if (!snippetsEnabled) nodes.push({ '!': literal('dst', 'snippet') });

  const attachment = attachmentScope(selection);

  if (attachment) nodes.push(attachment);

  const location = selection.location;

  if (location.kind !== 'tab') {
    return combine('&', nodes) ?? literal('id', NIL_UUID);
  }

  if (location.tab === 'owned' && selection.scope === 'default') {
    if (!userId) return literal('id', NIL_UUID);

    nodes.push(literal('o', userId));
  }

  if (location.tab === 'shared') {
    if (!userId) return literal('id', NIL_UUID);

    nodes.push({ '!': literal('o', userId) });
  }

  return combine('&', nodes) ?? literal('id', NIL_UUID);
}

function selectedFolderDocumentScope(
  selection: DriveSelection,
  folderId: string
): BackendAstNode {
  const nodes = [literal('pid', folderId)];

  const attachment = attachmentScope(selection);

  if (attachment) nodes.push(attachment);

  return combine('&', nodes) ?? literal('id', NIL_UUID);
}

function baseBody(
  selection: DriveSelection,
  userId: string | undefined,
  snippetsEnabled: boolean
): DriveAstBody {
  const body: DriveAstBody = excludedEntityTargets();

  const location = selection.location;

  if (location.kind === 'tab') {
    body.df = tabDocumentScope(selection, userId, snippetsEnabled);

    return body;
  }

  if (location.id === null) {
    delete body.pf;

    return body;
  }

  body.df = selectedFolderDocumentScope(selection, location.id);
  body.cf = literal('pid', location.id);
  body.ef = literal('ProjectId', location.id);
  body.pf = literal('pid', location.id);
  body.emailView = 'all';

  return body;
}

function omitUnsupportedRecentTargets(body: DriveAstBody): DriveAstBody {
  const supported = { ...body };

  delete supported.ef;
  delete supported.chanf;

  return supported;
}

/** Builds the Soup AST for Drive without relying on legacy query state. */
export function buildDriveQuery(
  options: BuildDriveQueryOptions
): SoupAstItemsQueryArgs {
  const { selection } = options;

  const facets = compileFacets(
    selection.facets,
    DRIVE_FACETS,
    options.facetContext
  );

  let body: DriveAstBody = mergeAst(
    baseBody(selection, options.userId, options.snippetsEnabled ?? false),
    facets
  );

  let sortMethod: DriveSelection['sort'] | 'touched_by_me' = selection.sort;

  const location = selection.location;

  if (location.kind === 'tab' && location.tab === 'recent') {
    sortMethod = 'touched_by_me';
    body = omitUnsupportedRecentTargets(body);
  }

  return {
    params: {
      expand: true,
      limit: 100,
      sort_method: sortMethod,
      sort_direction: 'desc',
    },
    body,
  };
}
