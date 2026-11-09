/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the upstream Lexical source tree.
 */
import { LexicalNode } from '../base';
import { DecoratorNode } from '../builtins';
import type { StaticNodeConfigValue } from '../config';
import { ElementNode } from '../element';
import { TextNode } from '../text';
import { setPendingNodeToClone } from './pending';

type NodeClass = LexicalNode['constructor'];

function hasOwnStaticMethod<K extends keyof NodeClass>(
  klass: NodeClass,
  key: K
): boolean {
  return (
    Object.prototype.hasOwnProperty.call(klass, key) &&
    klass[key] !== LexicalNode[key]
  );
}

function isAbstractNodeClass(klass: NodeClass): boolean {
  if (!(klass === LexicalNode || klass.prototype instanceof LexicalNode)) {
    let type = '<unknown>';
    try {
      type = klass.getType();
    } catch {
      /* Preserve the validation error. */
    }
    throw new Error(
      `${klass.name} (type ${type}) does not subclass LexicalNode from this core. All lexical packages used by an editor must use the same core.`
    );
  }
  return (
    klass === LexicalNode || klass === ElementNode || klass === DecoratorNode
  );
}

function checkDefaultConstructor(
  klass: NodeClass,
  type: string,
  method: string
): void {
  if (
    process.env.NODE_ENV !== 'production' &&
    TextNode.length === 0 &&
    klass.length !== 0
  ) {
    throw new Error(
      `${klass.name} (type ${type}) must implement a static ${method} method since its constructor has ${klass.length} required arguments (expecting 0). Use an explicit default in the first argument of your constructor.`
    );
  }
}

/** Prepare the real static factories, including inherited class configuration. */
export function getStaticNodeConfig(klass: NodeClass): {
  ownNodeType: string | undefined;
  ownNodeConfig: StaticNodeConfigValue<LexicalNode, string> | undefined;
} {
  const record =
    '$config' in klass.prototype ? klass.prototype.$config() : undefined;
  const isAbstract = isAbstractNodeClass(klass);
  const nodeType =
    !isAbstract && hasOwnStaticMethod(klass, 'getType')
      ? klass.getType()
      : undefined;
  let ownNodeType = nodeType;
  let ownNodeConfig: StaticNodeConfigValue<LexicalNode, string> | undefined;
  if (record) {
    if (nodeType) ownNodeConfig = record[nodeType];
    else {
      for (const [type, config] of Object.entries(record)) {
        ownNodeType = type;
        ownNodeConfig = config;
      }
    }
  }
  if (!isAbstract && ownNodeType) {
    const type = ownNodeType;
    if (!hasOwnStaticMethod(klass, 'getType')) klass.getType = () => type;
    if (!hasOwnStaticMethod(klass, 'clone')) {
      checkDefaultConstructor(klass, type, 'clone');
      klass.clone = (previous: LexicalNode) => {
        setPendingNodeToClone(previous);
        return new klass();
      };
    }
    if (!hasOwnStaticMethod(klass, 'importJSON')) {
      checkDefaultConstructor(klass, type, 'importJSON');
      klass.importJSON =
        ownNodeConfig?.$importJSON ||
        ((serialized) => new klass().updateFromJSON(serialized));
    }
    if (!hasOwnStaticMethod(klass, 'importDOM') && ownNodeConfig) {
      const { importDOM } = ownNodeConfig;
      if (importDOM) klass.importDOM = () => importDOM;
    }
  }
  return { ownNodeConfig, ownNodeType };
}
