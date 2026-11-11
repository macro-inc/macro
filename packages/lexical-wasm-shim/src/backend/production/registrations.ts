import {
  CompatNativePrototype,
  ForeignNodeKind,
  type ICompatHostedClass,
  type IForeignClassRegistration,
} from '@macro-inc/collaboration/session/compatibility.generated';
import type { PreparedEditorRegisteredNodes } from '../../configuration/registered-nodes';
import {
  ForeignClassRegistry,
  NativeNodeCatalog,
  type NodeClass,
  type NodeKind,
} from '../../foreign/registry';
import {
  DecoratorNode,
  ElementNode,
  LineBreakNode,
  ParagraphNode,
  RootNode,
  TabNode,
  TextNode,
} from '../../nodes';
import type { NodeClass as ActualNodeClass } from '../../nodes/replacement/types';
import { constructorToken } from './constructor-identity';
import type { NativePayloadDescriptor } from './node-payload';

interface Storage {
  readonly prototype: CompatNativePrototype;
  readonly payload: NativePayloadDescriptor;
}

export interface RegistrationMetadata {
  readonly registry: ForeignClassRegistry;
  readonly classes: readonly IForeignClassRegistration[];
  readonly hostedClasses: readonly ICompatHostedClass[];
  readonly constructors: ReadonlyMap<number, ActualNodeClass>;
  readonly payloads: ReadonlyMap<number, NativePayloadDescriptor>;
}

const storage = new Map<NodeClass, Storage>([
  [
    RootNode,
    {
      prototype: CompatNativePrototype.RootNode,
      payload: { kind: 'root', nativeType: 'root' },
    },
  ],
  [
    TextNode,
    {
      prototype: CompatNativePrototype.TextNode,
      payload: { kind: 'text', nativeType: 'text' },
    },
  ],
  [
    TabNode,
    {
      prototype: CompatNativePrototype.TabNode,
      payload: { kind: 'tab', nativeType: 'tab' },
    },
  ],
  [
    ParagraphNode,
    {
      prototype: CompatNativePrototype.ParagraphNode,
      payload: { kind: 'paragraph', nativeType: 'paragraph' },
    },
  ],
  [
    LineBreakNode,
    {
      prototype: CompatNativePrototype.LineBreakNode,
      payload: { kind: 'linebreak', nativeType: 'linebreak' },
    },
  ],
  [
    ElementNode,
    {
      prototype: CompatNativePrototype.ElementNode,
      payload: { kind: 'generic-element', nativeType: '' },
    },
  ],
]);

const nodeKinds: Record<NodeKind, ForeignNodeKind> = {
  Element: ForeignNodeKind.Element,
  Root: ForeignNodeKind.Element,
  Text: ForeignNodeKind.Text,
  LineBreak: ForeignNodeKind.LineBreak,
  Decorator: ForeignNodeKind.Decorator,
};

const catalog = new NativeNodeCatalog([
  { klass: ElementNode, kind: 'Element', type: null },
  { klass: DecoratorNode, kind: 'Decorator', type: null },
  { klass: RootNode, kind: 'Root', type: 'root' },
  { klass: TextNode, kind: 'Text', type: 'text' },
  { klass: ParagraphNode, kind: 'Element', type: 'paragraph' },
  { klass: LineBreakNode, kind: 'LineBreak', type: 'linebreak' },
  { klass: TabNode, kind: 'Text', type: 'tab' },
]);

export function registrations(
  editorId: number,
  prepared: PreparedEditorRegisteredNodes
): RegistrationMetadata {
  if (!Number.isInteger(editorId) || editorId <= 0 || editorId > 0xffff_ffff)
    throw new Error('Invalid compatibility editor identity');
  const configured = [...prepared.registeredNodes].map(([type, row]) => ({
    klass: row.klass,
    type,
  }));
  const actual = new Map<NodeClass, ActualNodeClass>(
    configured.map(({ klass }) => [klass, klass])
  );
  const registry = ForeignClassRegistry.fromConfigured(catalog, configured);
  try {
    const rows = registry.rows();
    const ids = new Map(rows.map((row, index) => [row.type, index + 1]));
    const constructors = new Map<number, ActualNodeClass>();
    const payloads = new Map<number, NativePayloadDescriptor>();
    const hostedClasses: ICompatHostedClass[] = [];
    const classes: IForeignClassRegistration[] = rows.map((row, index) => {
      const classId = index + 1;
      const descriptor = storage.get(row.native);
      const klass = actual.get(row.klass);
      if (descriptor === undefined || klass === undefined)
        throw new Error(
          'Hosted storage codec is not installed for the configured class'
        );
      if (
        descriptor.payload.nativeType !== '' &&
        descriptor.payload.nativeType !== row.type
      )
        throw new Error(
          'Hosted storage codec does not support this configured type name'
        );
      constructors.set(classId, klass);
      payloads.set(classId, descriptor.payload);
      hostedClasses.push({
        classId,
        constructorToken: constructorToken(klass),
        nativePrototype: descriptor.prototype,
      });
      return {
        ownerId: editorId,
        classId,
        typeName: row.type,
        // Only a diagnostic label: do not add an observable Function.name getter.
        className: '',
        kind: nodeKinds[row.kind],
        ancestry: row.ancestry.map((name) => {
          const id = ids.get(name);
          if (id === undefined)
            throw new Error(`Unregistered class ancestor ${name}`);
          return id;
        }),
        nativeType: descriptor.payload.nativeType,
        hooks: row.overrides,
      };
    });
    return { registry, classes, hostedClasses, constructors, payloads };
  } catch (error) {
    registry.dispose();
    throw error;
  }
}
