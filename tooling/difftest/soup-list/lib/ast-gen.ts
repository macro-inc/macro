/**
 * Random Soup AST requests across the whole grammar the REST endpoint accepts
 * (crates/item_filters/src/ast), including the parts the GraphQL translator
 * does not (apps/web/src/lib/queries/soup/graphql/ast.ts), so every case lands
 * on one of the two outcomes the PR promises: GraphQL with REST's results, or
 * a traced REST fallback.
 *
 * Values come from the seeded world (real ids, owners, names), so filters
 * match rows instead of returning empty pages.
 */
import type { Coverage, Rng } from './rng';
import type { World } from './world';

type Node = Record<string, unknown>;
type Lit = string | Record<string, unknown>;

export type AstCase = {
  args: {
    params: Record<string, unknown>;
    body: Record<string, unknown>;
    groupBy?: Record<string, unknown>;
  };
  options: Record<string, unknown>;
  pages: number;
  /** Where the case came from: a caller's real args, mutated, or generated. */
  origin: string;
};

const SYSTEM_PROPERTY = {
  assignees: '00000001-0000-0000-0000-000000000001',
  status: '00000001-0000-0000-0000-000000000007',
};

const NS = ['unseen', 'seen', 'done'];
const ENTITY_TYPES = [
  'CALENDAR_EVENT',
  'CHANNEL',
  'CHAT',
  'COMPANY',
  'DATABASE_ROW',
  'DOCUMENT',
  'INITIATIVE',
  'PROJECT',
  'TASK',
  'THREAD',
  'USER',
];

export class AstGen {
  private ids: Record<string, string[]>;
  private owners: string[];
  private names: string[];
  constructor(
    private rng: Rng,
    private world: World,
    private coverage: Coverage
  ) {
    const by = (kind: string) => world.entities.filter((e) => e.kind === kind).map((e) => e.id);
    this.ids = {
      doc: [...by('md'), ...by('task'), ...by('snippet'), ...by('skill')],
      project: by('project'),
      chat: by('chat'),
      session: by('session'),
      initiative: by('initiative'),
      crm: by('crm'),
      pr: by('pr'),
      channel: [world.channelId],
    };
    this.owners = Object.values(world.users).map((u) => u.id);
    this.names = world.entities.map((e) => e.name).filter((n) => n.length < 60);
  }

  private uuid(kind: string): string {
    const list = this.ids[kind] ?? [];
    if (!list.length || this.rng.bool(0.1)) return crypto.randomUUID();
    return this.rng.pick(list);
  }

  private date(): Record<string, string> {
    const op = this.rng.pick(['gt', 'gte', 'lt', 'lte']);
    const at = new Date(Date.UTC(2026, 9, 1) + this.rng.int(0, 60) * 86400_000).toISOString();
    return { [op]: at };
  }

  private email(): unknown {
    const domain = this.world.domain;
    return this.rng.pick<() => unknown>([
      () => ({ Partial: this.rng.pick(['owner', 'mem', 'x']) }),
      () => ({ Complete: `member@${domain}` }),
      () => ({ Complete: `outsider@${domain}` }),
      () => ({ Domain: domain }),
      () => ({ Domain: 'example.io' }),
    ])();
  }

  private propLiteral(): Record<string, unknown> {
    const v = this.rng.pick<() => unknown>([
      () => ({ so: crypto.randomUUID() }),
      () => ({ er: this.rng.pick(this.owners) }),
      () => ({ dr: { start: '2026-10-01T00:00:00Z', end: '2026-12-01T00:00:00Z' } }),
    ])();
    return {
      pd: this.rng.pick(Object.values(SYSTEM_PROPERTY)),
      ...(this.rng.bool(0.6) && { et: this.rng.pick(ENTITY_TYPES) }),
      v,
    };
  }

  /** A literal for `target`; `odd` picks shapes the translator rejects. */
  private literal(target: string): Lit {
    const r = this.rng;
    const one = (field: string, value: unknown): Lit => {
      this.coverage.hit('literal', `${target}.${field}`);
      return { [field]: value };
    };
    // Unit variants (inc, me, include) are bare strings on the wire; the
    // object form is invalid REST input, kept rare to show both outcomes.
    const unit = (field: string): Lit => {
      if (r.bool(0.03)) {
        this.coverage.hit('invalid-rest-input', `${target}.${field}:true`);
        return { [field]: true };
      }
      this.coverage.hit('literal', `${target}.${field}`);
      return field;
    };
    switch (target) {
      case 'df':
        return r.pick<() => Lit>([
          () => one('ft', r.pick(['md', 'pdf', 'fig', 'docx', 'canvas', 'png'])),
          () => one('fa', r.pick(['assoc:write', 'assoc:pdf', 'assoc:code', 'assoc:other', 'assoc:image', 'assoc:nope'])),
          () => one('id', this.uuid('doc')),
          () => one('pid', this.uuid('project')),
          () => one('o', r.pick(this.owners)),
          () => one('imp', r.bool()),
          () => one('ns', r.pick(NS)),
          () => one('cbm', r.bool()),
          () => one('dst', r.pick(['task', 'snippet', 'skill'])),
          () => one('iea', r.bool()),
          () => one('ca', this.date()),
          () => one('ua', this.date()),
          () => one('prop', this.propLiteral()),
          () => one('eap', this.email()),
          () => one('crm', r.pick<unknown>(['activity', { company: this.uuid('crm') }, { contact: crypto.randomUUID() }])),
          () => one('nc', [...new Intl.Segmenter().segment(r.pick(this.names.length ? this.names : ['a']))].map((g) => g.segment).slice(0, r.int(1, 8)).join('')),
        ])();
      case 'pf':
        return r.pick<() => Lit>([
          () => one('pid', this.uuid('project')),
          () => one('pids', this.uuid('project')),
          () => one('o', r.pick(this.owners)),
          () => one('imp', r.bool()),
          () => one('ns', r.pick(NS)),
          () => one('ca', this.date()),
          () => one('ua', this.date()),
        ])();
      case 'if':
        return r.pick<() => Lit>([
          () => unit('inc'),
          () => one('id', this.uuid('initiative')),
          () => one('o', r.pick(this.owners)),
          () => one('ns', r.pick(NS)),
        ])();
      case 'cf':
        return r.pick<() => Lit>([
          () => one('cid', this.uuid('chat')),
          () => one('pid', this.uuid('project')),
          () => one('o', r.pick(this.owners)),
          () => one('imp', r.bool()),
          () => one('ns', r.pick(NS)),
          () => one('ca', this.date()),
          () => one('ua', this.date()),
          // REST only: chat role.
          () => one('r', r.pick(['User', 'Assistant', 'System'])),
        ])();
      case 'ef':
        return r.pick<() => Lit>([
          () => one('Sender', this.email()),
          () => one('Recipient', this.email()),
          () => one('Cc', this.email()),
          () => one('Bcc', this.email()),
          () => one('Subject', r.pick(['plan', 'Q3', 'hello'])),
          () => one('ThreadId', crypto.randomUUID()),
          () => one('Owner', crypto.randomUUID()),
          () => one('ProjectId', this.uuid('project')),
          () => one('Importance', r.bool()),
          () => one('NotificationState', r.pick(NS)),
          () => one('Read', r.bool()),
          () => one('InboxVisible', r.bool()),
          () => one('Shared', r.pick(['exclude', 'include', 'only'])),
          () => one('CalendarOnly', r.bool()),
          () => one('Attachment', r.pick(['pdf', 'image', 'document'])),
          () => one('ca', this.date()),
          () => one('ua', this.date()),
          // REST only: viewed-at and properties on email.
          () => one('va', this.date()),
          () => one('prop', this.propLiteral()),
        ])();
      case 'chanf':
        return r.pick<() => Lit>([
          () => one('ThreadId', crypto.randomUUID()),
          () => one('ChannelId', this.uuid('channel')),
          () => one('Sender', r.pick(this.owners)),
          () => one('ChannelType', r.pick(['public', 'private', 'direct_message', 'team'])),
          () => one('Importance', r.bool()),
          () => one('IsParticipant', r.bool()),
          () => one('NotificationState', r.pick(NS)),
        ])();
      case 'cthf':
        return r.pick<() => Lit>([
          () => one('ThreadId', crypto.randomUUID()),
          () => one('ChannelId', this.uuid('channel')),
          () => one('RootSender', r.pick(this.owners)),
          () => one('Participant', r.pick(this.owners)),
          () => one('NotificationState', r.pick(NS)),
          () => one('HasReplies', r.bool()),
        ])();
      case 'callf':
        return r.pick<() => Lit>([
          () => one('CallId', crypto.randomUUID()),
          () => one('ChannelId', this.uuid('channel')),
          () => one('Speaker', r.pick(this.owners)),
          () => one('Status', r.pick(['ATTENDED', 'MISSED', 'UNATTENDED'])),
          () => one('Attended', r.bool()),
        ])();
      case 'ccf':
        return r.pick<() => Lit>([
          () => one('id', this.uuid('crm')),
          () => one('hidden', r.bool()),
        ])();
      case 'crmf':
        return r.pick<() => Lit>([
          () => unit('include'),
          () => one('id', crypto.randomUUID()),
          () => one('team_id', this.world.teamId),
          () => one('company_id', this.uuid('crm')),
          () => one('email', `contact@${this.world.domain}`),
          () => one('search', r.pick(['a', 'co', 'Ελ'])),
          () => one('hidden', r.bool()),
        ])();
      case 'fef':
        return r.pick<() => Lit>([
          () => one('id', crypto.randomUUID()),
          () => one('feid', this.ids.pr.length ? r.pick(this.ids.pr) : 'x/y/pull/1'),
          () => one('fes', 'github_pull_request'),
          () => unit('me'),
          () => one('ns', r.pick(NS)),
        ])();
      case 'ghprf':
        return r.pick<() => Lit>([
          () => one('repo', 1000 + r.int(0, 3)),
          () => one('au', 'synthetic-bot'),
          () => one('st', r.pick(['open', 'closed', 'merged'])),
          () => one('inv', r.pick(['synthetic-bot', 'someone'])),
          () => one('rr', 'synthetic-bot'),
          () => one('draft', r.bool()),
          () => one('as', 'synthetic-bot'),
          () => one('lbl', 'bug'),
          () => one('rs', r.pick(['none', 'required', 'approved', 'changes_requested'])),
          () => one('rb', 'synthetic-bot'),
        ])();
      case 'asf':
        return r.pick<() => Lit>([
          () => unit('inc'),
          () => one('id', this.uuid('session')),
          () => one('o', r.pick(this.owners)),
          () => one('src', r.pick(['user', 'agent', 'routine'])),
          () => one('vis', r.pick(['listed', 'unlisted', 'hidden'])),
        ])();
      case 'propf':
        this.coverage.hit('literal', 'propf');
        return this.propLiteral();
      case 'calf':
        return r.pick<() => Lit>([
          () => one('id', crypto.randomUUID()),
          () => one('ns', r.pick(NS)),
          // REST only: status, time range, attendee, organizer.
          () => one('s', 'confirmed'),
          () => one('sb', '2026-12-01T00:00:00Z'),
          () => one('ea', '2026-10-01T00:00:00Z'),
          () => one('a', `owner@${this.world.domain}`),
          () => one('o', `owner@${this.world.domain}`),
        ])();
      default:
        throw new Error(`no literals for ${target}`);
    }
  }

  /** An expression over `target`, up to `depth` levels of & | !. */
  expr(target: string, depth: number): Node {
    const r = this.rng;
    if (depth <= 0 || r.bool(0.45)) {
      // Malformed literals: more than one field, or a non-object.
      if (r.bool(0.02)) {
        this.coverage.hit('malformed', 'two-fields');
        return { l: { ...((this.literal(target) as object) ?? {}), zz: 1 } };
      }
      if (r.bool(0.01)) {
        this.coverage.hit('malformed', 'number-literal');
        return { l: 7 };
      }
      return { l: this.literal(target) };
    }
    const op = r.weighted<'&' | '|' | '!'>([
      [45, '&'],
      [40, '|'],
      [15, '!'],
    ]);
    this.coverage.hit('operator', op);
    if (op === '!') return { '!': this.expr(target, depth - 1) };
    return { [op]: [this.expr(target, depth - 1), this.expr(target, depth - 1)] };
  }

  /** A long one-sided chain, past the GraphQL depth budget (balancing). */
  chain(target: string, length: number): Node {
    let node: Node = { l: this.literal(target) };
    const op = this.rng.pick(['&', '|']);
    for (let i = 1; i < length; i++) node = { [op]: [node, { l: this.literal(target) }] };
    this.coverage.hit('shape', `chain-${length > 31 ? 'over-depth' : 'under-depth'}`);
    return node;
  }

  generate(): AstCase {
    const r = this.rng;
    const targets = [
      'df', 'pf', 'if', 'cf', 'ef', 'chanf', 'cthf', 'callf', 'ccf', 'crmf', 'fef', 'ghprf', 'asf', 'propf', 'calf',
    ];
    const body: Record<string, unknown> = {};
    for (const target of r.sample(targets, r.weighted([[30, 1], [35, 2], [20, 3], [15, 5]]))) {
      this.coverage.hit('target', target);
      body[target] = r.bool(0.06) ? this.chain(target, r.int(20, 45)) : this.expr(target, r.int(0, 4));
    }
    if (r.bool(0.08)) body.favorites_only = r.bool();
    if (r.bool(0.05)) body.crma = r.pick<unknown>(['activity', { company: this.uuid('crm') }]);
    if (r.bool(0.08)) body.emailView = r.pick(['inbox', 'drafts', 'sent', 'all', 'important', 'other']);
    if (r.bool(0.03)) body.eca = [`owner@${this.world.domain}`];
    if (r.bool(0.03)) body.ecd = [this.world.domain];
    for (const k of ['favorites_only', 'crma', 'emailView', 'eca', 'ecd'])
      if (body[k] !== undefined) this.coverage.hit('body', k === 'emailView' ? `emailView.${body[k]}` : k);

    const sort = r.weighted<string | undefined>([
      [10, undefined],
      [12, 'viewed_at'],
      [12, 'created_at'],
      [14, 'updated_at'],
      [14, 'viewed_updated'],
      [6, 'property'],
      [8, 'name'],
      [5, 'frecency'],
      [5, 'touched_by_me'],
      [5, 'notified_at'],
    ]);
    this.coverage.hit('sort', sort ?? 'default');
    const limit = r.weighted<number>([
      [10, 1],
      [20, 5],
      [25, 20],
      [20, 50],
      [10, 100],
      [5, 500],
    ]);
    this.coverage.hit('limit', String(limit));
    const params: Record<string, unknown> = { limit };
    if (sort) params.sort_method = sort;
    if (sort === 'property') params.sort_property_definition_id = SYSTEM_PROPERTY.status;
    if (r.bool(0.3)) params.sort_direction = r.pick(['asc', 'desc']);
    if (params.sort_direction) this.coverage.hit('direction', String(params.sort_direction));

    let groupBy: Record<string, unknown> | undefined;
    if (r.bool(0.15)) {
      groupBy = r.pick<Record<string, unknown>>([
        { type: 'entity_type' },
        { type: 'date' },
        { type: 'project' },
        { type: 'property', propertyDefinitionId: SYSTEM_PROPERTY.status, entityType: 'TASK' },
      ]);
      this.coverage.hit('groupBy', String(groupBy.type));
    }
    const options: Record<string, unknown> = {};
    if (r.bool(0.25)) options.ignoresNotifications = true;
    if (r.bool(0.25)) options.showSupportedForeignEntities = true;
    for (const k of Object.keys(options)) this.coverage.hit('option', k);
    const pages = groupBy ? 1 : r.weighted([[70, 1], [20, 2], [10, 3]]);
    this.coverage.hit('pages', String(pages));
    return { args: { params, body, ...(groupBy && { groupBy }) }, options, pages, origin: 'generated' };
  }

  /** A real caller's args with one part changed. */
  mutate(base: AstCase['args'], label: string): AstCase {
    const r = this.rng;
    const args = structuredClone(base);
    const what = r.pick(['sort', 'limit', 'add-target', 'wrap-not', 'and-literal', 'none']);
    this.coverage.hit('mutation', what);
    const targets = Object.keys(args.body).filter((k) => /^[a-z]+f$|^if$|^asf$/.test(k));
    switch (what) {
      case 'sort':
        args.params.sort_method = r.pick(['viewed_at', 'updated_at', 'name', 'frecency', 'notified_at', 'created_at']);
        break;
      case 'limit':
        args.params.limit = r.pick([1, 2, 10, 499, 500, 501]);
        break;
      case 'add-target': {
        const t = r.pick(['df', 'pf', 'cf', 'asf', 'if', 'ccf', 'fef']);
        args.body[t] = this.expr(t, 1);
        break;
      }
      case 'wrap-not':
        if (targets.length) {
          const t = r.pick(targets);
          args.body[t] = { '!': args.body[t] };
        }
        break;
      case 'and-literal':
        if (targets.length) {
          const t = r.pick(targets);
          try {
            args.body[t] = { '&': [args.body[t], { l: this.literal(t) }] };
          } catch {
            /* a target with no literal table */
          }
        }
        break;
    }
    return { args, options: {}, pages: 1, origin: `mutated:${label}:${what}` };
  }
}

/** The fallback shape, reimplemented from the PR's description, not its code. */
const SHAPE_ORDER = [
  'asf', 'calf', 'callf', 'ccf', 'cf', 'chanf', 'crma', 'crmf', 'cthf', 'df', 'eca', 'ecd', 'ef',
  'favorites_only', 'fef', 'ghprf', 'if', 'pf', 'propf',
];
export function expectedShape(args: AstCase['args']): string {
  const body = args.body;
  const targets = SHAPE_ORDER.filter((k) => body[k] !== undefined);
  return [
    `sort=${(args.params.sort_method as string | undefined) ?? 'default'}`,
    `group=${(args.groupBy?.type as string | undefined) ?? 'none'}`,
    `view=${typeof body.emailView === 'string' ? body.emailView : 'none'}`,
    `targets=${targets.join(',') || 'none'}`,
  ].join(' ');
}

const PREFIX = 'Error: Unsupported GraphQL Soup AST: ';
/** main's translator error text → the reason the branch must report. */
export function expectedReason(oldError: string | null): string | null {
  if (oldError === null) return null;
  const reason = oldError.startsWith(PREFIX) ? oldError.slice(PREFIX.length) : 'translator error';
  return reason.slice(0, 120);
}
