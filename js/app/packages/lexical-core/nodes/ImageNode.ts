import {
  $applyNodeReplacement,
  type DOMConversionMap,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import { type DecoratorComponent, getDecorator } from '../decoratorRegistry';
import { $applyIdFromSerialized } from '../plugins/nodeIdPlugin';
import {
  createMediaTypeGuard,
  createSerializedMediaTypeGuard,
  type MediaInfo,
  MediaNode,
} from './MediaNode';

export type SerializedImageNode = Spread<
  MediaInfo & { alt: string },
  SerializedLexicalNode
>;

export type ImageDecoratorProps = MediaInfo & {
  key: NodeKey;
  alt: string;
};

export class ImageNode extends MediaNode<{ alt: string }> {
  __alt: string;

  constructor(
    srcType: string,
    id: string,
    url: string,
    alt: string,
    width: number,
    height: number,
    scale?: number,
    key?: NodeKey
  ) {
    super(srcType, id, url, width, height, scale, key);
    this.__alt = alt;
  }

  static getType(): string {
    return 'image';
  }

  getMediaType() {
    return 'image' as const;
  }

  protected getExtraProps(): { alt: string } {
    return {
      alt: this.__alt,
    };
  }

  protected applyExtraPropsFromJSON(json: Partial<{ alt: string }>): void {
    if (json.alt !== undefined) {
      this.__alt = json.alt;
    }
  }

  getDOMElement(): HTMLElement {
    const element = document.createElement('img');
    return element;
  }

  getAlt() {
    return this.__alt;
  }

  setAlt(alt: string, rerender = true) {
    const writable = this.getWritable();
    writable.__alt = alt;
    if (rerender) writable.__componentDirty = true;
  }

  static clone(node: ImageNode): ImageNode {
    const newNode = new ImageNode(
      node.__srcType,
      node.__id,
      node.__url,
      node.__alt,
      node.__width,
      node.__height,
      node.__scale,
      node.__key
    );
    newNode.__componentDirty = node.__componentDirty;
    newNode.__cachedDecoratorComponent = node.__cachedDecoratorComponent;
    return newNode;
  }

  static importJSON(serializedNode: SerializedImageNode): ImageNode {
    const node =
      $createImageNode(serializedNode).updateFromJSON(serializedNode);
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  updateFromJSON(serializedNode: SerializedImageNode): this {
    const self = super.updateFromJSON(serializedNode);
    self.setAlt(serializedNode.alt ?? '');
    return self;
  }

  exportJSON(): SerializedImageNode {
    return {
      ...super.exportJSON(),
      alt: this.__alt,
      type: 'image',
    };
  }

  exportDOM() {
    const result = super.exportDOM();
    if (result && result.element) {
      (result.element as HTMLImageElement).setAttribute('alt', this.__alt);
    }
    return result;
  }

  static importDOM(): DOMConversionMap<HTMLElement> | null {
    return {
      img: (domNode: HTMLImageElement) => {
        const src = domNode.getAttribute('src');
        const alt = domNode.getAttribute('alt');
        const width = domNode.getAttribute('width');
        const height = domNode.getAttribute('height');
        const scale = domNode.getAttribute('data-scale');
        const srcType = domNode.getAttribute('data-src-type');
        const id = domNode.getAttribute('data-image-id');

        if (src && id && srcType) {
          return {
            conversion: () => {
              const node = $createImageNode({
                srcType: srcType,
                id,
                url: src,
                alt: alt || '',
                width: width ? parseInt(width, 10) : 0,
                height: height ? parseInt(height, 10) : 0,
                scale: scale ? parseFloat(scale) : 1,
              });
              return { node };
            },
            priority: 1,
          };
        }
        return null;
      },
    };
  }

  decorate(): DecoratorComponent<ImageDecoratorProps> | undefined {
    if (!this.__componentDirty && this.__cachedDecoratorComponent) {
      return this.__cachedDecoratorComponent;
    }
    const decorator = getDecorator<ImageNode>(ImageNode);
    if (decorator) {
      const comp = () => decorator(this.exportComponentProps());
      this.__cachedDecoratorComponent = comp;
      this.__componentDirty = false;
      return comp;
    }
  }

  protected createNodeFromParams(params: {
    srcType: string;
    id: string;
    url: string;
    alt: string;
    width: number;
    height: number;
  }): LexicalNode {
    return $createImageNode(params);
  }

  exportComponentProps(): ImageDecoratorProps {
    return {
      srcType: this.__srcType,
      id: this.__id,
      url: this.__url,
      width: this.__width,
      height: this.__height,
      alt: this.__alt,
      key: this.__key,
      scale: this.__scale,
    };
  }
}

export function $createImageNode(params: {
  srcType: string;
  id?: string;
  url?: string;
  alt?: string;
  width?: number;
  height?: number;
  scale?: number;
}) {
  return $applyNodeReplacement(
    new ImageNode(
      params.srcType,
      params.id ?? '',
      params.url ?? '',
      params.alt ?? '',
      params.width ?? 0,
      params.height ?? 0,
      params.scale ?? 1
    )
  );
}

export const $isImageNode = createMediaTypeGuard(ImageNode);
export const isSerializedImageNode = createSerializedMediaTypeGuard('image');
