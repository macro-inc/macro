import { ArtificialNode__DO_NOT_USE } from '../nodes/artificial';
import { LineBreakNode, ParagraphNode, RootNode } from '../nodes/builtins';
import { buildRegisteredNodes } from '../nodes/replacement/builder';
import { normalizeNodeConfig } from '../nodes/replacement/normalize';
import type {
  ClassLike,
  InternalNodeConfig,
  NodeClass,
  NodeConfigInput,
  NodeDOMExport,
  RegisteredNodes,
} from '../nodes/replacement/types';
import { TabNode } from '../nodes/tab';
import { TextNode } from '../nodes/text';

export type RegistryPreparation =
  | {
      readonly configOmitted: true;
      readonly inheritedRegistry: RegisteredNodes | null;
    }
  | {
      readonly configOmitted: false;
      readonly nodes?: readonly NodeConfigInput[];
      readonly exportDOM?: ReadonlyMap<ClassLike, NodeDOMExport>;
    };

export interface PreparedEditorRegisteredNodes {
  readonly nodeConfigs: readonly InternalNodeConfig[];
  readonly nodeClasses: readonly NodeClass[];
  readonly registeredNodes: RegisteredNodes;
}

export function prepareEditorRegisteredNodes(
  input: RegistryPreparation
): PreparedEditorRegisteredNodes {
  const defaults: NodeClass[] = [
    RootNode,
    TextNode,
    LineBreakNode,
    TabNode,
    ParagraphNode,
    ArtificialNode__DO_NOT_USE,
  ];
  if (input.configOmitted) {
    const inherited = input.inheritedRegistry;
    if (inherited !== null) {
      return {
        nodeConfigs: defaults,
        nodeClasses: [...inherited.values()].map((row) => row.klass),
        registeredNodes: inherited,
      };
    }
  }
  const sources = input.configOmitted
    ? defaults
    : [...defaults, ...(input.nodes || [])];
  const exportDOM = input.configOmitted ? undefined : input.exportDOM;
  const nodeConfigs: InternalNodeConfig[] = [];
  function* normalized(): Generator<InternalNodeConfig> {
    for (const source of sources) {
      const config = normalizeNodeConfig(source);
      nodeConfigs.push(config);
      yield config;
    }
  }
  const registeredNodes = buildRegisteredNodes(normalized(), exportDOM);
  return {
    nodeConfigs,
    nodeClasses: [...registeredNodes.values()].map((row) => row.klass),
    registeredNodes,
  };
}
