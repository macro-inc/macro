import {
  CompatHostAccess,
  type ICompatHostRequest,
  type ICompatReconcileStage,
} from '@macro-inc/collaboration/session/compatibility.generated';
import type {
  CompatCommit,
  CompatView,
} from '@macro-inc/lexical-wasm-view/compat';
import type { ElementNode, RootNode } from '../../nodes';

export interface ElementDerivedProjection {
  readonly textFormat: number;
  readonly textStyle: string;
}
interface RootValue {
  text: string | null;
}
interface ElementValue {
  textFormat: number;
  textStyle: string;
}
// Raw fields belong to the captured object, including when that exact object
// is rebound. These weak cells never key by editor, node key, or latest state.
const roots = new WeakMap<RootNode, RootValue>();
const elements = new WeakMap<ElementNode, ElementValue>();

function validateProjection(value: ElementDerivedProjection): ElementValue {
  const { textFormat, textStyle } = value;
  if (
    !Number.isInteger(textFormat) ||
    textFormat < 0 ||
    textFormat > 0xffffffff ||
    typeof textStyle !== 'string'
  )
    throw new Error(
      'Derived element projection requires complete raw format and style'
    );
  return { textFormat, textStyle };
}

/** Exact-instance values shared by construction and the authorized producer. */
export class DerivedCacheValues {
  protected readonly roots = roots;
  protected readonly elements = elements;

  initRoot(node: RootNode): void {
    // Rebinding an already constructed/captured instance must never reset it.
    if (!this.roots.has(node)) this.roots.set(node, { text: null });
  }
  initElement(node: ElementNode, value: ElementDerivedProjection): void {
    const projection = validateProjection(value);
    const existing = this.elements.get(node);
    if (existing) {
      if (
        existing.textFormat !== projection.textFormat ||
        existing.textStyle !== projection.textStyle
      )
        throw new Error(
          'Changed derived element initialization requires projection authority'
        );
      return;
    }
    this.elements.set(node, {
      textFormat: projection.textFormat,
      textStyle: projection.textStyle,
    });
  }
  readRoot(node: RootNode): string | null {
    return this.rootValue(node).text;
  }
  readTextFormat(node: ElementNode): number {
    return this.elementValue(node).textFormat;
  }
  readTextStyle(node: ElementNode): string {
    return this.elementValue(node).textStyle;
  }
  protected rootValue(node: RootNode): RootValue {
    const value = this.roots.get(node);
    if (!value)
      throw new Error(
        'Root derived cache was not initialized for this instance'
      );
    return value;
  }
  protected elementValue(node: ElementNode): ElementValue {
    const value = this.elements.get(node);
    if (!value)
      throw new Error(
        'Element derived cache was not initialized for this instance'
      );
    return value;
  }
}

export interface DerivedCacheRuntime {
  readonly assertWritable: (
    node: ElementNode,
    version: bigint,
    updateId: number
  ) => void;
  readonly assertProjection: (
    node: ElementNode,
    version: bigint,
    updateId: number
  ) => void;
  readonly withStage: <T>(
    request: ICompatHostRequest,
    commit: CompatCommit,
    body: () => T
  ) => T;
  readonly reconcile: CompatView['reconcile'];
}
interface ActiveStage {
  readonly stage: ICompatReconcileStage;
  readonly updateId: number;
}

/** No graph lookup, native query, or root-string serialization occurs here. */
export class DerivedCache extends DerivedCacheValues {
  private active: ActiveStage | undefined;
  constructor(private readonly runtime: DerivedCacheRuntime) {
    super();
  }

  applyElementProjection(
    node: ElementNode,
    value: ElementDerivedProjection,
    version: bigint,
    updateId: number
  ): void {
    const projection = validateProjection(value);
    const current = this.elementValue(node);
    this.runtime.assertProjection(node, version, updateId);
    current.textFormat = projection.textFormat;
    current.textStyle = projection.textStyle;
  }
  private assertWritable(node: ElementNode): void {
    const active = this.active;
    if (!active)
      throw new Error(
        'Derived writes require an active prefreeze reconciliation stage'
      );
    this.runtime.assertWritable(
      node,
      active.stage.nextVersion,
      active.updateId
    );
  }
  writeRoot(node: RootNode, value: string): void {
    if (typeof value !== 'string')
      throw new Error('Reconciled root text must be an exact string');
    const current = this.rootValue(node);
    this.assertWritable(node);
    current.text = value;
  }
  writeTextFormat(node: ElementNode, value: number): void {
    const current = this.elementValue(node);
    validateProjection({ textFormat: value, textStyle: current.textStyle });
    this.assertWritable(node);
    current.textFormat = value;
  }
  writeTextStyle(node: ElementNode, value: string): void {
    const current = this.elementValue(node);
    validateProjection({ textFormat: current.textFormat, textStyle: value });
    this.assertWritable(node);
    current.textStyle = value;
  }
  reconcile(
    request: ICompatHostRequest,
    commit: CompatCommit
  ): ReturnType<CompatView['reconcile']> {
    if (commit.removedNodes === undefined)
      throw new Error(
        'Reconciliation requires the authoritative removed-node delta'
      );
    const call = request.call.data;
    if (call.discriminator !== 7)
      throw new Error('Expected the generated Reconcile host call');
    const stage = call.value.stage;
    if (
      request.context.access !== CompatHostAccess.Mutable ||
      request.context.version !== stage.nextVersion ||
      commit.editorState._readOnly
    )
      throw new Error(
        'Reconciliation requires its actual writable pending state'
      );
    return this.runtime.withStage(request, commit, () => {
      const previous = this.active;
      this.active = { stage, updateId: request.context.updateId };
      try {
        return this.runtime.reconcile(
          commit,
          undefined,
          (_editor, _state, body) => body()
        );
      } finally {
        this.active = previous;
      }
    });
  }
}
export function createDerivedCache(runtime: DerivedCacheRuntime): DerivedCache {
  return new DerivedCache(runtime);
}
