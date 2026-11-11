import { LexicalNode } from '../index';
import { actualNodeClass, bindReplacement } from './bind';
import type { InternalNodeConfig, NodeConfigInput } from './types';

export function normalizeNodeConfig(
  config: NodeConfigInput
): InternalNodeConfig {
  if (typeof config === 'function') return actualNodeClass(config);
  const replace = config.replace;
  const callback = config.with;
  const withKlass = config.withKlass;
  return bindReplacement({
    replace,
    withKlass,
    with: (node) => {
      if (!(node instanceof LexicalNode))
        throw new Error('Replacement input must belong to this core');
      return callback(node);
    },
  });
}

export function normalizeNodeConfigs(
  configs: readonly NodeConfigInput[]
): InternalNodeConfig[] {
  return configs.map(normalizeNodeConfig);
}
