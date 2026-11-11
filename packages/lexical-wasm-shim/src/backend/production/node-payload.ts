import {
  ForeignBasePatch,
  ForeignCallbackValue,
  ForeignElementBase,
  ForeignNativeField,
  ForeignNativeProjection,
  ForeignTextBase,
  type IForeignBasePatch,
  type IForeignNativeProjection,
} from '@macro-inc/collaboration/session/compatibility.generated';
import {
  ElementNode,
  type LexicalNode,
  LineBreakNode,
  RootNode,
  TextNode,
} from '../../nodes';

export type NativePayloadDescriptor =
  | { readonly kind: 'root'; readonly nativeType: 'root' }
  | { readonly kind: 'text'; readonly nativeType: 'text' }
  | { readonly kind: 'tab'; readonly nativeType: 'tab' }
  | { readonly kind: 'paragraph'; readonly nativeType: 'paragraph' }
  | { readonly kind: 'linebreak'; readonly nativeType: 'linebreak' }
  | { readonly kind: 'heading'; readonly nativeType: 'heading' }
  | { readonly kind: 'generic-element'; readonly nativeType: '' };

export interface NodePayload {
  readonly base: IForeignBasePatch;
  readonly nativeProjection: IForeignNativeProjection;
}

function utf16(value: string): number[] {
  return Array.from({ length: value.length }, (_, index) =>
    value.charCodeAt(index)
  );
}

function textBase(node: LexicalNode): ForeignBasePatch {
  if (!(node instanceof TextNode))
    throw new TypeError('Text payload requires an actual TextNode');
  const text = node.__text;
  if (typeof text !== 'string')
    throw new TypeError('Text payload requires raw string text');
  const base = new ForeignBasePatch({
    text: new ForeignTextBase({
      text: utf16(text),
      format: node.__format,
      detail: node.__detail,
      mode: node.__mode,
      style: node.__style,
    }),
  });
  if (
    base.text?.format === undefined ||
    base.text.detail === undefined ||
    base.text.mode === undefined ||
    base.text.style === undefined
  )
    throw new TypeError('Text payload requires every raw base field');
  ForeignBasePatch.validateCompatibility(base);
  return base;
}

function direction(value: ElementNode['__dir']): number {
  switch (value) {
    case null:
      return 0;
    case 'ltr':
      return 1;
    case 'rtl':
      return 2;
    default:
      throw new TypeError(
        'Element payload requires null, ltr or rtl direction'
      );
  }
}

function elementBase(node: LexicalNode): ForeignBasePatch {
  if (!(node instanceof ElementNode))
    throw new TypeError('Element payload requires an actual ElementNode');
  const base = new ForeignBasePatch({
    element: new ForeignElementBase({
      format: node.__format,
      indent: node.__indent,
      direction: direction(node.__dir),
      textFormat: node.__textFormat,
      textStyle: node.__textStyle,
      style: node.__style,
    }),
  });
  if (
    base.element?.format === undefined ||
    base.element.indent === undefined ||
    base.element.direction === undefined ||
    base.element.textFormat === undefined ||
    base.element.textStyle === undefined ||
    base.element.style === undefined
  )
    throw new TypeError('Element payload requires every raw base field');
  ForeignBasePatch.validateCompatibility(base);
  return base;
}

/** Pure projection; native class/token/prototype authorization belongs to the runtime. */
export function captureNodePayload(
  node: LexicalNode,
  descriptor: NativePayloadDescriptor
): NodePayload {
  const kind = descriptor.kind;
  const nativeType = descriptor.nativeType;
  let base: IForeignBasePatch;
  const nativeProjection = new ForeignNativeProjection({
    nativeType: nativeType,
    complete: true,
    fields: [],
  });
  switch (kind) {
    case 'root':
      if (nativeType !== 'root' || !(node instanceof RootNode))
        throw new TypeError(
          'Root payload requires root native type and an actual RootNode'
        );
      base = elementBase(node);
      break;
    case 'text':
    case 'tab':
      if (nativeType !== kind)
        throw new TypeError('Text payload native type mismatch');
      base = textBase(node);
      break;
    case 'paragraph':
    case 'heading':
      if (nativeType !== kind)
        throw new TypeError('Element payload native type mismatch');
      base = elementBase(node);
      if (kind === 'heading') {
        const tag: unknown = Reflect.get(node, '__tag');
        if (typeof tag !== 'string' || !/^h[1-6]$/.test(tag))
          throw new TypeError(
            'Heading payload requires a raw h1 through h6 tag'
          );
        nativeProjection.fields.push({
          field: ForeignNativeField.HeadingNodeTag,
          value: ForeignCallbackValue.fromForeignStringArgument({
            value: utf16(tag),
          }),
        });
      }
      break;
    case 'generic-element':
      if (nativeType !== '')
        throw new TypeError('Generic Element native type must be empty');
      base = elementBase(node);
      break;
    case 'linebreak':
      if (nativeType !== 'linebreak' || !(node instanceof LineBreakNode))
        throw new TypeError(
          'LineBreak payload requires linebreak native type and an actual LineBreakNode'
        );
      base = new ForeignBasePatch({});
      break;
    default:
      throw new TypeError('Unsupported native payload descriptor');
  }
  ForeignNativeProjection.validateCompatibility(nativeProjection);
  return { base, nativeProjection };
}
