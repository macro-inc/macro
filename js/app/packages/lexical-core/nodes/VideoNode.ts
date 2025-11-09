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

export type SerializedVideoNode = Spread<
  MediaInfo & { controls: boolean },
  SerializedLexicalNode
>;

export type VideoDecoratorProps = MediaInfo & {
  key: NodeKey;
  controls: boolean;
};

export class VideoNode extends MediaNode<{ controls: boolean }> {
  __controls: boolean;

  constructor(
    srcType: string,
    id: string,
    url: string,
    controls: boolean,
    width: number,
    height: number,
    scale?: number,
    key?: NodeKey
  ) {
    super(srcType, id, url, width, height, scale, key);
    this.__controls = controls;
  }

  static getType(): string {
    return 'video';
  }

  getMediaType() {
    return 'video' as const;
  }

  protected getExtraProps(): { controls: boolean } {
    return {
      controls: this.__controls,
    };
  }

  protected applyExtraPropsFromJSON(
    json: Partial<{ controls: boolean }>
  ): void {
    if (json.controls !== undefined) {
      this.__controls = json.controls;
    }
  }

  getDOMElement(): HTMLElement {
    const element = document.createElement('video');
    return element;
  }

  getControls() {
    return this.__controls;
  }

  setControls(controls: boolean, rerender = true) {
    const writable = this.getWritable();
    writable.__controls = controls;
    if (rerender) writable.__componentDirty = true;
  }

  static clone(node: VideoNode): VideoNode {
    const newNode = new VideoNode(
      node.__srcType,
      node.__id,
      node.__url,
      node.__controls,
      node.__width,
      node.__height,
      node.__scale,
      node.__key
    );
    newNode.__componentDirty = node.__componentDirty;
    newNode.__cachedDecoratorComponent = node.__cachedDecoratorComponent;
    return newNode;
  }

  static importJSON(serializedNode: SerializedVideoNode): VideoNode {
    const node =
      $createVideoNode(serializedNode).updateFromJSON(serializedNode);
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  updateFromJSON(serializedNode: SerializedVideoNode): this {
    const self = super.updateFromJSON(serializedNode);
    self.setControls(serializedNode.controls ?? true);
    return self;
  }

  exportJSON(): SerializedVideoNode {
    return {
      ...super.exportJSON(),
      controls: this.__controls,
      type: 'video',
    };
  }

  exportDOM() {
    const result = super.exportDOM();
    if (result && result.element) {
      (result.element as HTMLVideoElement).setAttribute(
        'controls',
        this.__controls.toString()
      );
    }
    return result;
  }

  static importDOM(): DOMConversionMap<HTMLElement> | null {
    return {
      video: (domNode: HTMLVideoElement) => {
        const src = domNode.getAttribute('src');
        const controls = domNode.hasAttribute('controls');
        const width = domNode.getAttribute('width');
        const height = domNode.getAttribute('height');
        const scale = domNode.getAttribute('data-scale');
        const srcType = domNode.getAttribute('data-src-type');
        const id = domNode.getAttribute('data-video-id');

        if (src && id && srcType) {
          return {
            conversion: () => {
              const node = $createVideoNode({
                srcType: srcType,
                id,
                url: src,
                controls: controls,
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

  decorate(): DecoratorComponent<VideoDecoratorProps> | undefined {
    // Return cached component if it exists and isn't dirty
    if (!this.__componentDirty && this.__cachedDecoratorComponent) {
      return this.__cachedDecoratorComponent;
    }

    const decorator = getDecorator<VideoNode>(VideoNode);
    if (decorator) {
      const comp = () => decorator(this.exportComponentProps());
      this.__cachedDecoratorComponent = comp;
      this.__componentDirty = false;
      return comp;
    }

    return undefined;
  }

  protected createNodeFromParams(params: {
    srcType: string;
    id: string;
    url: string;
    controls: boolean;
    width: number;
    height: number;
  }): LexicalNode {
    return $createVideoNode(params);
  }

  exportComponentProps(): VideoDecoratorProps {
    return {
      srcType: this.__srcType,
      id: this.__id,
      url: this.__url,
      width: this.__width,
      height: this.__height,
      controls: this.__controls,
      scale: this.__scale || 1,
      key: this.__key,
    };
  }
}

export function $createVideoNode(params: {
  srcType: string;
  id?: string;
  url?: string;
  controls?: boolean;
  width?: number;
  height?: number;
  scale?: number;
}) {
  return $applyNodeReplacement(
    new VideoNode(
      params.srcType,
      params.id ?? '',
      params.url ?? '',
      params.controls ?? true,
      params.width ?? 0,
      params.height ?? 0,
      params.scale ?? 1
    )
  );
}

export const $isVideoNode = createMediaTypeGuard(VideoNode);
export const isSerializedVideoNode = createSerializedMediaTypeGuard('video');
