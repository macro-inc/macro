/** Macro importDOM conversions from packages/lexical-core/nodes, loaded with HTML import. */
import type { DraftConversion } from './registry';
import type { JsonObject, JsonValue } from './types';

type Props = { [key: string]: JsonValue };
interface Conversion {
  readonly tags: readonly string[];
  readonly marker: string;
  readonly fields?: Readonly<Record<string, string>>;
  readonly required?: readonly string[];
  readonly convert?: (
    node: HTMLElement,
    props: Props,
    children: readonly JsonObject[]
  ) => JsonObject | null;
}
function jsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  )
    return value;
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, jsonValue(child)])
    );
  throw new Error('Invalid HTML JSON attribute');
}
function parse(value: string): JsonValue {
  return jsonValue(JSON.parse(value));
}
function draft(type: string, props: JsonObject): JsonObject {
  return {
    type,
    version:
      type === 'agent-session-mention'
        ? 3
        : type === 'document-mention'
          ? 2
          : 1,
    ...props,
  };
}
function optional(
  node: HTMLElement,
  props: Props,
  key: string,
  attribute: string
): void {
  const value = node.getAttribute(attribute);
  if (value) props[key] = value;
}
const definitions: Readonly<Record<string, Conversion>> = {
  'user-mention': {
    tags: ['span'],
    marker: 'data-user-mention',
    fields: {
      userId: 'data-user-id',
      email: 'data-email',
      displayName: 'data-display-name',
    },
    required: ['userId', 'email'],
    convert: (_, props) =>
      draft('user-mention', {
        ...props,
        displayName:
          props.displayName || String(props.email).split('@')[0] || props.email,
      }),
  },
  'contact-mention': {
    tags: ['span'],
    marker: 'data-contact-mention',
    fields: {
      contactId: 'data-contact-id',
      name: 'data-name',
      emailOrDomain: 'data-email-or-domain',
    },
    required: ['contactId', 'name', 'emailOrDomain'],
    convert: (node, props) =>
      draft('contact-mention', {
        ...props,
        isCompany: node.getAttribute('data-is-company') === 'true',
      }),
  },
  'date-mention': {
    tags: ['span'],
    marker: 'data-date-mention',
    fields: { date: 'data-date', displayFormat: 'data-display-format' },
    required: ['date', 'displayFormat'],
  },
  'group-mention': {
    tags: ['span'],
    marker: 'data-group-mention',
    fields: { groupAlias: 'data-group-alias' },
    required: ['groupAlias'],
  },
  watermark: {
    tags: ['span'],
    marker: 'data-watermark',
    fields: { content: 'data-content' },
    required: ['content'],
  },
  'unknown-mention': {
    tags: ['div'],
    marker: 'data-unknown-mention',
    convert: (node) =>
      draft('unknown-mention', {
        name: node.getAttribute('data-name') || 'unknown',
      }),
  },
  'agent-session-mention': {
    tags: ['div', 'span', 'a'],
    marker: 'data-agent-session-mention',
    fields: {
      id: 'data-agent-session-id',
      label: 'data-agent-session-label',
      mentionUuid: 'data-mention-uuid',
    },
    required: ['id'],
    convert: (node, props) =>
      draft('agent-session-mention', {
        ...props,
        ...(node.getAttribute('data-agent-session-expanded') === 'true'
          ? { expanded: true }
          : {}),
      }),
  },
  'booking-link-mention': {
    tags: ['span', 'a'],
    marker: 'data-booking-link-mention',
    fields: {
      profileId: 'data-booking-profile-id',
      slug: 'data-booking-slug',
      label: 'data-booking-label',
      url: 'data-booking-url',
    },
    required: ['profileId', 'url'],
  },
  'tag-mention': {
    tags: ['span'],
    marker: 'data-tag-mention',
    fields: {
      optionId: 'data-tag-option-id',
      propertyDefinitionId: 'data-tag-property-definition-id',
      scope: 'data-tag-scope',
      color: 'data-tag-color',
    },
    required: ['optionId', 'propertyDefinitionId', 'scope'],
    convert: (node, props) =>
      props.scope === 'user' || props.scope === 'team'
        ? draft('tag-mention', {
            ...props,
            name: node.getAttribute('data-tag-name') || '',
          })
        : null,
  },
  'pr-mention': {
    tags: ['span', 'a'],
    marker: 'data-pr-mention',
    fields: {
      id: 'data-pr-id',
      label: 'data-pr-label',
      url: 'data-pr-url',
      mentionUuid: 'data-mention-uuid',
    },
    convert: (_, props) =>
      props.id ||
      (typeof props.url === 'string' &&
        /^https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/pull\/[1-9][0-9]*(?:[/?#]\S*)?$/.test(
          props.url
        ))
        ? draft('pr-mention', { ...props, id: props.id ?? '' })
        : null,
  },
  'document-mention': {
    tags: ['span', 'div', 'a'],
    marker: 'data-document-mention',
    fields: {
      documentId: 'data-document-id',
      blockName: 'data-block-name',
      mentionUuid: 'data-mention-uuid',
      channelType: 'data-channel-type',
    },
    required: ['documentId', 'blockName'],
    convert: (node, props) => {
      const blockParams = node.getAttribute('data-block-params'),
        created = node.getAttribute('data-created-at');
      return draft('document-mention', {
        ...props,
        documentName: node.getAttribute('data-document-name') || '',
        blockParams: blockParams ? parse(blockParams) || {} : {},
        collapsed: node.getAttribute('data-collapsed') === 'true',
        createdAt: created ? Number.parseInt(created, 10) : Date.now(),
      });
    },
  },
  'document-card': {
    tags: ['div'],
    marker: 'data-document-card',
    fields: {
      documentId: 'data-document-id',
      blockName: 'data-block-name',
      mentionUuid: 'data-mention-uuid',
    },
    required: ['documentId', 'blockName'],
    convert: (node, props) => {
      const params = node.getAttribute('data-block-params'),
        box = node.getAttribute('data-preview-box'),
        preview = node.getAttribute('data-preview-data');
      return draft('document-card', {
        ...props,
        documentName: node.getAttribute('data-document-name') || '',
        blockParams: params ? parse(params) || {} : {},
        previewBox: box ? parse(box) || ['100%', '400px'] : ['100%', '400px'],
        ...(preview ? { previewData: parse(preview) } : {}),
      });
    },
  },
  snapshot: {
    tags: ['span'],
    marker: 'data-snapshot-node',
    fields: {
      documentId: 'data-document-id',
      mentionUuid: 'data-mention-uuid',
    },
    required: ['documentId'],
    convert: (node, props) =>
      draft('snapshot', {
        ...props,
        documentName: node.getAttribute('data-document-name') || '',
        blockName: node.getAttribute('data-block-name') || '',
        content: node.getAttribute('data-content') || '',
        snapshotDate:
          node.getAttribute('data-snapshot-date') || new Date().toISOString(),
      }),
  },
  'theme-mention': {
    tags: ['span'],
    marker: 'data-theme-mention',
    convert: (node) => {
      const raw = node.getAttribute('data-theme-json');
      if (!raw) return null;
      try {
        const data = parse(raw);
        if (
          data &&
          typeof data === 'object' &&
          !Array.isArray(data) &&
          'name' in data &&
          typeof data.name === 'string'
        )
          return draft('theme-mention', { name: data.name, data });
      } catch {
        return null;
      }
      return null;
    },
  },
  paste: {
    tags: ['div'],
    marker: 'data-paste-node',
    convert: (node) =>
      draft('paste', {
        content: node.getAttribute('data-content') || '',
        origin:
          node.getAttribute('data-paste-origin') === 'referenced'
            ? 'referenced'
            : 'pasted',
      }),
  },
  'classed-block': {
    tags: ['div', 'p', 'span', 'blockquote'],
    marker: 'data-classed-block',
    convert: (node, _, children) =>
      draft('classed-block', {
        children,
        direction: null,
        format: '',
        indent: 0,
        tag: node.tagName.toLowerCase(),
        classes: [...node.classList],
      }),
  },
  'html-render': {
    tags: ['div'],
    marker: 'data-html-render',
    convert: (node) => {
      const template = node.querySelector('template[shadowrootmode]'),
        attribute = node.getAttribute('data-html');
      const html = template
        ? template.innerHTML
        : attribute
          ? (parse(attribute) ?? node.innerHTML)
          : node.innerHTML;
      return draft('html-render', {
        html,
        ...(node.classList.contains('macro_html_render_adapt')
          ? { adaptColors: true }
          : {}),
      });
    },
  },
  equation: {
    tags: ['span', 'div'],
    marker: 'data-lexical-equation',
    convert: (node) => {
      const equation = atob(node.getAttribute('data-lexical-equation') || '');
      return equation
        ? draft('equation', {
            equation,
            inline: node.getAttribute('data-lexical-inline') === 'true',
          })
        : null;
    },
  },
};
function media(node: HTMLElement, type: 'image' | 'video'): JsonObject | null {
  const src = node.getAttribute('src'),
    id = node.getAttribute(`data-${type}-id`),
    srcType = node.getAttribute('data-src-type');
  if (!src || !id || !srcType) return null;
  const props: Props = {
    srcType,
    id,
    url: src,
    width: Number.parseInt(node.getAttribute('width') || '0', 10),
    height: Number.parseInt(node.getAttribute('height') || '0', 10),
    scale: Number.parseFloat(node.getAttribute('data-scale') || '1') || 1,
  };
  for (const name of ['Width', 'Height']) {
    const value = node.getAttribute(`data-constrained-${name.toLowerCase()}`);
    if (value) props[`constrained${name}`] = Number.parseInt(value, 10);
  }
  if (type === 'image') props.alt = node.getAttribute('alt') || '';
  else props.controls = node.hasAttribute('controls');
  return draft(type, props);
}
/** Preserve registry ordering and upstream's last-claimant tie rule. */
export function macroConversion(
  node: HTMLElement,
  types: readonly string[] | undefined
): DraftConversion | null {
  if (!types) return null;
  const tag = node.tagName.toLowerCase();
  let result: DraftConversion | null = null;
  for (const type of types) {
    if (type === 'horizontalrule' && tag === 'hr') {
      result = { priority: 0, convert: () => [draft(type, {})] };
      continue;
    }
    if (type === 'image' || type === 'video') {
      let target: HTMLElement | null = null;
      let priority: 1 | 2 = 1;
      if (tag === (type === 'image' ? 'img' : 'video')) target = node;
      else if (
        tag === 'div' &&
        node.childElementCount === 1 &&
        node.firstElementChild?.tagName ===
          (type === 'image' ? 'IMG' : 'VIDEO') &&
        node.textContent?.trim() === ''
      ) {
        target =
          type === 'image'
            ? node.querySelector('img')
            : node.querySelector('video');
        priority = 2;
      }
      const value = target ? media(target, type) : null;
      if (value && (!result || result.priority <= priority))
        result = { priority, convert: () => [value] };
      continue;
    }
    const conversion = definitions[type];
    if (
      !conversion ||
      !conversion.tags.includes(tag) ||
      !(
        node.hasAttribute(conversion.marker) ||
        (type === 'html-render' && node.classList.contains('macro_html_render'))
      )
    )
      continue;
    const priority = type === 'equation' && tag === 'div' ? 2 : 1;
    if (result && result.priority > priority) continue;
    result = {
      priority,
      convert: (node, children) => {
        const props: Props = {};
        for (const [field, attribute] of Object.entries(
          conversion.fields ?? {}
        ))
          optional(node, props, field, attribute);
        if (conversion.required?.some((field) => !props[field])) return null;
        const value = conversion.convert
          ? conversion.convert(node, props, children)
          : draft(type, props);
        return value ? [value] : null;
      },
    };
  }
  return result;
}
