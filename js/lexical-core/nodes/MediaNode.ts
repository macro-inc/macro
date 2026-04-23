import type {
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
} from 'lexical';
import type { DecoratorComponent } from '../decoratorRegistry';
import { $applyIdFromSerialized } from '../plugins/nodeIdPlugin';
import { calculateEffectiveDimensions } from '../utils/media';
import { DecoratorBlockNode } from './DecoratorBlockNode';

export type MediaType = 'image' | 'video';

export type MediaInfo = {
  srcType: string;
  id: string;
  url: string;
  width: number;
  height: number;
  scale: number;
  constrainedWidth?: number;
  constrainedHeight?: number;
};

export type SerializedMediaNode<T = {}> = Spread<
  MediaInfo & T,
  SerializedLexicalNode
>;

export abstract class MediaNode<
  T extends object = {},
> extends DecoratorBlockNode<DecoratorComponent<MediaInfo & T> | undefined> {
  __srcType: string;
  __id: string;
  __url: string;
  __width: number;
  __height: number;
  __constrainedWidth?: number;
  __constrainedHeight?: number;
  __componentDirty: boolean;
  __scale: number;
  __cachedDecoratorComponent: DecoratorComponent<MediaInfo & T> | null;

  constructor(
    srcType: string,
    id: string,
    url: string,
    width: number,
    height: number,
    constrainedWidth?: number,
    constrainedHeight?: number,
    scale?: number,
    key?: NodeKey
  ) {
    super('center', key);
    this.__srcType = srcType;
    this.__id = id;
    this.__url = url;
    this.__width = width;
    this.__height = height;
    this.__constrainedWidth = constrainedWidth;
    this.__constrainedHeight = constrainedHeight;
    this.__scale = scale || 1;
    this.__componentDirty = true;
    this.__cachedDecoratorComponent = null;
  }

  abstract getMediaType(): MediaType;
  abstract getDOMElement(): HTMLElement;
  protected abstract getExtraProps(): T;
  protected abstract applyExtraPropsFromJSON(json: Partial<T>): void;

  isKeyboardSelectable(): true {
    return true;
  }

  getSrcType() {
    return this.__srcType;
  }
  setSrcType(srcType: string, rerender = true): this {
    const writable = this.getWritable();
    writable.__srcType = srcType;
    if (rerender) writable.__componentDirty = true;
    return writable;
  }

  getId() {
    return this.__id;
  }
  setId(id: string, rerender = true): this {
    const writable = this.getWritable();
    writable.__id = id;
    if (rerender) writable.__componentDirty = true;
    return writable;
  }

  getUrl() {
    return this.__url;
  }
  setUrl(url: string, rerender = true): this {
    const writable = this.getWritable();
    writable.__url = url;
    if (rerender) writable.__componentDirty = true;
    return writable;
  }

  getWidth() {
    return this.__width;
  }
  setWidth(width: number, rerender = true): this {
    const writable = this.getWritable();
    writable.__width = width;
    if (rerender) writable.__componentDirty = true;
    return writable;
  }

  getHeight() {
    return this.__height;
  }
  setHeight(height: number, rerender = true): this {
    const writable = this.getWritable();
    writable.__height = height;
    if (rerender) writable.__componentDirty = true;
    return writable;
  }

  getScale() {
    return this.__scale;
  }
  setScale(scale: number, rerender = true): this {
    const writable = this.getWritable();
    writable.__scale = scale;
    if (rerender) writable.__componentDirty = true;
    return writable;
  }

  getConstrainedWidth() {
    return this.__constrainedWidth;
  }
  setConstrainedWidth(width: number | undefined, rerender = true): this {
    const writable = this.getWritable();
    writable.__constrainedWidth = width;
    if (rerender) writable.__componentDirty = true;
    return writable;
  }

  getConstrainedHeight() {
    return this.__constrainedHeight;
  }
  setConstrainedHeight(height: number | undefined, rerender = true): this {
    const writable = this.getWritable();
    writable.__constrainedHeight = height;
    if (rerender) writable.__componentDirty = true;
    return writable;
  }

  /**
   * Calculates the effective width and height based on the more constrained dimension.
   * Returns the width/height that should be used, respecting aspect ratio.
   */
  getEffectiveDimensions(): { width: number; height: number } {
    return calculateEffectiveDimensions(
      this.__width,
      this.__height,
      this.__constrainedWidth,
      this.__constrainedHeight
    );
  }

  createDOM(): HTMLElement {
    return document.createElement('div');
  }

  updateDOM(): false {
    return false;
  }

  exportDOM() {
    const wrapper = document.createElement('div');
    const element = this.getDOMElement();
    const { width, height } = this.getEffectiveDimensions();
    element.setAttribute('src', this.__url);
    element.setAttribute('width', width.toString());
    element.setAttribute('height', height.toString());
    element.setAttribute('data-src-type', this.__srcType);
    element.setAttribute(`data-${this.getMediaType()}-id`, this.__id);
    element.setAttribute('data-scale', this.__scale.toString());
    if (this.__constrainedWidth != null) {
      element.setAttribute(
        'data-constrained-width',
        this.__constrainedWidth.toString()
      );
    }
    if (this.__constrainedHeight != null) {
      element.setAttribute(
        'data-constrained-height',
        this.__constrainedHeight.toString()
      );
    }
    wrapper.appendChild(element);
    return { element: wrapper };
  }

  decorate(): DecoratorComponent<MediaInfo & T> | undefined {
    return undefined;
  }

  updateFromJSON(serializedNode: SerializedMediaNode<{}>): this {
    const self = super
      .updateFromJSON(serializedNode)
      .setSrcType(serializedNode.srcType)
      .setId(serializedNode.id)
      .setUrl(serializedNode.url)
      .setWidth(serializedNode.width)
      .setHeight(serializedNode.height)
      .setScale(serializedNode.scale || 1)
      .setConstrainedWidth(serializedNode.constrainedWidth, false)
      .setConstrainedHeight(serializedNode.constrainedHeight, false);

    $applyIdFromSerialized(self, serializedNode);
    return self;
  }

  exportJSON(): SerializedMediaNode<{}> {
    return {
      ...super.exportJSON(),
      srcType: this.__srcType,
      id: this.__id,
      url: this.__url,
      width: this.__width,
      height: this.__height,
      scale: this.__scale,
      constrainedWidth: this.__constrainedWidth,
      constrainedHeight: this.__constrainedHeight,
    } as SerializedMediaNode<{}>;
  }
}

export function createMediaTypeGuard<T extends MediaNode>(
  nodeClass: new (...args: any[]) => T
) {
  return (node: LexicalNode): node is T => node instanceof nodeClass;
}

export function createSerializedMediaTypeGuard(mediaType: MediaType) {
  return (node: SerializedLexicalNode): node is SerializedMediaNode => {
    return node.type === mediaType;
  };
}
