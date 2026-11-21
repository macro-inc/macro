import {
  Features,
  type Selector,
  type SelectorComponent,
  type StyleRule,
  transform,
} from 'lightningcss';

/**
 * Selectors that make every whole-page restyle expensive.
 *
 * Writing an inherited custom property on `<html>` (or switching the theme)
 * restyles every element, so its cost is what each element pays times the
 * element count. Chrome tests each element only against the rules filed under
 * its id, classes, attributes and tag, plus the "universal" rules, whose
 * subject (rightmost compound) names none of those. Two kinds of universal
 * rule cost every element real work:
 *
 * - A highlight pseudo-element (`::selection`, `::target-text`, …) every
 *   element matches. Chrome computes a highlight style for each of them, again
 *   on every custom-property write if the rule reads a `var()`. Set it on the
 *   subtree's root instead (`:root::selection`); Chrome's highlight
 *   inheritance gives it to the descendants.
 * - A walk up (descendant combinator) or back (`~`) the tree that Chrome's
 *   ancestor filter can't skip. The filter holds the ids, classes, attributes
 *   and tags of the element's ancestors, but only for compounds outside
 *   `:is()`/`:where()` lists, and `html`/`body`/`:root` are everyone's
 *   ancestors. `.md *` and `:where(.md) *` are skipped outside `.md`;
 *   `:where(.md *)`, `:is(.a, .b) *` and `html[data-x] *` walk to the root from
 *   every element.
 *
 * It can't know which classes only ever sit on `<html>` or `<body>`, so
 * `.tauri-ios *` passes although it filters nothing; name `html` instead.
 *
 * Measured on a 1,800-element channel (Chrome 157), these were 15 of the 27 ms
 * a whole-page restyle took. `costlySelectors` lists them in a stylesheet; the
 * build fails on any not in `ALLOWED_COSTLY_SELECTORS` (`vite.base.ts`).
 */

/** Pseudo-elements whose style Chrome computes per element. */
const HIGHLIGHT_PSEUDO_ELEMENTS = new Set([
  'selection',
  'target-text',
  'spelling-error',
  'grammar-error',
  'highlight-function',
]);

/** Pseudo-classes Chrome files in a bucket of their own, as it does a class. */
const NARROW_PSEUDO_CLASSES = new Set([
  'focus',
  'focus-visible',
  'link',
  'any-link',
  'visited',
  'root',
  'host',
  'host-context',
  'slotted',
  // Vendor-prefixed pseudo-classes Chrome doesn't know; it drops the rule.
  'custom',
  'custom-function',
]);

/** Pseudo-elements of UA shadow parts, which Chrome files by name. */
const NARROW_PSEUDO_ELEMENTS = new Set([
  'placeholder',
  'part',
  'slotted',
  'cue',
  'file-selector-button',
  'custom',
  'custom-function',
]);

/** Every element descends from these, so they filter nothing. */
const ROOT_TAGS = new Set(['html', 'body']);

/**
 * Attributes the ancestor filter leaves out (Blink's selector_filter.cc): ids
 * and classes go in by value, and `style` is too common to help.
 */
const UNFILTERED_ATTRIBUTES = new Set(['id', 'class', 'style']);

/** Combinators that can visit any number of elements. */
const WALKING_COMBINATORS = new Set(['descendant', 'later-sibling']);

/** Combinators whose left side is an ancestor, which the filter can check. */
const ANCESTOR_COMBINATORS = new Set(['descendant', 'child']);

type Compound = { components: SelectorComponent[]; next?: string };

/** Compounds left to right, each with the combinator that follows it. */
function compounds(selector: Selector): Compound[] {
  const result: Compound[] = [{ components: [] }];
  for (const component of selector) {
    if (component.type === 'combinator') {
      result[result.length - 1].next = component.value;
      result.push({ components: [] });
    } else result[result.length - 1].components.push(component);
  }
  return result;
}

function subject(selector: Selector) {
  const all = compounds(selector);
  return all[all.length - 1].components;
}

/** The arguments of `:is()`, `:where()` or `:not()`, if any. */
function selectorList(component: SelectorComponent): Selector[] | undefined {
  if (component.type !== 'pseudo-class') return undefined;
  if (
    component.kind === 'is' ||
    component.kind === 'where' ||
    component.kind === 'not'
  ) {
    return component.selectors;
  }
  return undefined;
}

/** A `:is()`/`:where()` with one argument, which Chrome files like that argument. */
function singleArgument(component: SelectorComponent): Selector | undefined {
  if (component.type !== 'pseudo-class') return undefined;
  if (component.kind !== 'is' && component.kind !== 'where') return undefined;
  return component.selectors.length === 1 ? component.selectors[0] : undefined;
}

/** Whether Chrome files the compound under something narrower than "every element". */
function narrow(components: SelectorComponent[]): boolean {
  return components.some((component) => {
    switch (component.type) {
      case 'id':
      case 'class':
      case 'attribute':
      case 'type':
        return true;
      case 'pseudo-element':
        return NARROW_PSEUDO_ELEMENTS.has(component.kind);
      case 'pseudo-class': {
        if (NARROW_PSEUDO_CLASSES.has(component.kind)) return true;
        // Chrome files a list under every element but rejects quickly when
        // each argument names something.
        if (component.kind !== 'is' && component.kind !== 'where') return false;
        return component.selectors.every((inner) => narrow(subject(inner)));
      }
      default:
        return false;
    }
  });
}

/** Whether the compound, as an ancestor, lets the filter skip elements. */
function filters(components: SelectorComponent[]): boolean {
  const isRoot = components.some(
    (component) =>
      (component.type === 'type' && ROOT_TAGS.has(component.name)) ||
      (component.type === 'pseudo-class' && component.kind === 'root')
  );
  if (isRoot) return false;
  return components.some((component) => {
    switch (component.type) {
      case 'id':
      case 'class':
      case 'type':
        return true;
      case 'attribute':
        return !UNFILTERED_ATTRIBUTES.has(component.name.toLowerCase());
      case 'pseudo-class': {
        const inner = singleArgument(component);
        return (
          inner !== undefined && (filtered(inner) || filters(subject(inner)))
        );
      }
      default:
        return false;
    }
  });
}

/** Whether an ancestor compound outside any selector list lets the filter skip elements. */
function filtered(selector: Selector): boolean {
  return compounds(selector).some(
    ({ components, next }) =>
      next !== undefined &&
      ANCESTOR_COMBINATORS.has(next) &&
      filters(components)
  );
}

/** Whether a top-level combinator can visit any number of other elements. */
function walks(selector: Selector): boolean {
  return selector.some(
    (component) =>
      component.type === 'combinator' &&
      WALKING_COMBINATORS.has(component.value)
  );
}

function highlights(components: SelectorComponent[]): boolean {
  return components.some(
    (component) =>
      component.type === 'pseudo-element' &&
      HIGHLIGHT_PSEUDO_ELEMENTS.has(component.kind)
  );
}

/**
 * Whether a selector Chrome tests against every element does real work for
 * each: a highlight style, or a walk. Inside a selector list the ancestor
 * filter doesn't apply, so arguments are judged without it.
 */
function expensive(selector: Selector): boolean {
  const last = subject(selector);
  if (narrow(last)) return false;
  return (
    highlights(last) ||
    walks(selector) ||
    last.some((component) => selectorList(component)?.some(expensive) ?? false)
  );
}

/** Whether every element pays for this selector on every restyle. */
export function isCostly(selector: Selector): boolean {
  return !filtered(selector) && expensive(selector);
}

const COMBINATORS: Record<string, string> = {
  descendant: ' ',
  child: ' > ',
  'next-sibling': ' + ',
  'later-sibling': ' ~ ',
};

const ATTRIBUTE_OPERATORS: Record<string, string> = {
  equal: '=',
  includes: '~=',
  'dash-match': '|=',
  prefix: '^=',
  substring: '*=',
  suffix: '$=',
};

function formatComponent(component: SelectorComponent): string {
  switch (component.type) {
    case 'combinator':
      return COMBINATORS[component.value] ?? ` ${component.value} `;
    case 'universal':
      return '*';
    case 'type':
      return component.name;
    case 'id':
      return `#${component.name}`;
    case 'class':
      return `.${component.name}`;
    case 'attribute': {
      const operation = component.operation;
      if (!operation) return `[${component.name}]`;
      const operator = ATTRIBUTE_OPERATORS[operation.operator] ?? '=';
      return `[${component.name}${operator}${JSON.stringify(operation.value)}]`;
    }
    case 'nesting':
      return '&';
    case 'namespace':
      return '';
    case 'pseudo-element':
      if (component.kind === 'highlight-function') {
        return `::highlight(${component.name})`;
      }
      return `::${'name' in component ? component.name : component.kind}`;
    case 'pseudo-class': {
      const name = 'name' in component ? component.name : component.kind;
      const list = selectorList(component);
      if (list) return `:${name}(${list.map(formatSelector).join(', ')})`;
      // Keep arguments (`:nth-child(2)`, `:lang(en)`) so keys stay distinct.
      const {
        type: _type,
        kind: _kind,
        ...args
      } = component as Record<string, unknown>;
      return Object.keys(args).length > 0
        ? `:${name}(${JSON.stringify(args)})`
        : `:${name}`;
    }
    default:
      return '';
  }
}

/** A stable, readable spelling of a selector, used as the allow-list key. */
export function formatSelector(selector: Selector): string {
  return selector.map(formatComponent).join('');
}

/** Every costly selector in a stylesheet, deduplicated, in source order. */
export function costlySelectors(css: string, filename = 'input.css') {
  const found = new Set<string>();
  // Judge nested rules by the selectors they end up as.
  const flat = transform({
    filename,
    code: Buffer.from(css),
    errorRecovery: true,
    include: Features.Nesting,
  }).code;
  transform({
    filename,
    code: flat,
    errorRecovery: true,
    visitor: {
      Rule: {
        style(rule: { value: StyleRule }) {
          for (const selector of rule.value.selectors) {
            if (isCostly(selector)) found.add(formatSelector(selector));
          }
          return undefined;
        },
      },
    },
  });
  return [...found];
}

/**
 * Costly selectors the app keeps on purpose, with why. Add one only when the
 * rule has to reach every element.
 */
export const ALLOWED_COSTLY_SELECTORS: ReadonlyMap<string, string> = new Map([
  [
    'html[data-touch-device="true"] .[html[data-touch-device=true]_&~*]:[--mobile-content-inset-top:0px] ~ *',
    'The queued email sends panel hands the top inset to what follows it. A sibling rule is the only way to reach those elements; it costs about 0.5 ms of a whole-page restyle.',
  ],
]);

/** Costly selectors in a stylesheet that the allow-list doesn't cover. */
export function unexpectedCostlySelectors(css: string, filename?: string) {
  return costlySelectors(css, filename).filter(
    (selector) => !ALLOWED_COSTLY_SELECTORS.has(selector)
  );
}
