import type {
  MultilineElementTransformer,
  TextMatchTransformer,
} from '@lexical/markdown';
import type { TextNode } from 'lexical';
import {
  $createEquationNode,
  $isEquationNode,
  EquationNode,
} from '../nodes/EquationNode';

// Internal Equation Node

const TAG_KATEX_EQUATION = 'm-katex-equation';
const REG_EXP_KATEX_EQUATION = new RegExp(
  `<${TAG_KATEX_EQUATION}>(.*?)<\/${TAG_KATEX_EQUATION}>`,
  ''
);

export const I_EQUATION_NODE: TextMatchTransformer = {
  dependencies: [EquationNode],
  type: 'text-match',
  regExp: REG_EXP_KATEX_EQUATION,
  importRegExp: REG_EXP_KATEX_EQUATION,
  export: (node) => {
    if (!(node instanceof EquationNode)) return null;
    const data = JSON.stringify({
      equation: node.getEquation(),
      inline: node.getInline(),
    });
    return `<${TAG_KATEX_EQUATION}>${data}</${TAG_KATEX_EQUATION}>`;
  },
  replace: (node: TextNode, match: RegExpMatchArray) => {
    try {
      const data = JSON.parse(match[1]);
      for (const field of ['equation', 'inline']) {
        if (!(field in data)) throw new Error(`Missing field ${field}`);
      }

      const equationNode = $createEquationNode(data.equation, data.inline);
      node.replace(equationNode);
    } catch (e) {
      console.error(e);
    }
  },
};

// External Inline Equation Node

export const E_INLINE_EQUATION_NODE: TextMatchTransformer = {
  dependencies: [EquationNode],
  type: 'text-match',
  regExp: /(?<!\$)\$[^\n$]*?(?:[a-zA-Z\\=+\-*/^][^\n$]*?)\$(?!\$|\d)/,
  importRegExp: /(?<!\$)\$[^\n$]*?(?:[a-zA-Z\\=+\-*/^][^\n$]*?)\$(?!\$|\d)/,
  export: (node) => {
    if (!$isEquationNode(node)) {
      return null;
    }
    if (node.getInline()) {
      return `$${node.getEquation()}$`;
    }
    return null;
  },
  replace: (node, match) => {
    try {
      const [equationMatch] = match;
      const equation = equationMatch.replace(/^\$|\$$/g, '');
      const equationNode = $createEquationNode(equation, true);
      node.replace(equationNode);
    } catch (e) {
      console.error('Error creating equation node:', e);
    }
  },
};

// External Block Equation Node

export const E_BLOCK_EQUATION_NODE: TextMatchTransformer = {
  dependencies: [EquationNode],
  type: 'text-match',
  regExp: /\$\$(.*?)\$\$/,
  importRegExp: /\$\$(.*?)\$\$/,
  export: (node) => {
    if (!$isEquationNode(node)) {
      return null;
    }
    if (!node.getInline()) {
      return `$$${node.getEquation()}$$`;
    }
    return null;
  },
  replace: (node, match) => {
    try {
      const [equationMatch] = match;
      const equation = equationMatch.replace(/^\$\$|\$\$$/g, '');

      // when AI Chat prompt gets updated to support inline vs block, update inline to false
      const isInline = true; // false
      const equationNode = $createEquationNode(equation, isInline);
      node.replace(equationNode);
    } catch (e) {
      console.error('Error creating equation node:', e);
    }
  },
};

// External Multiline Block Equation Node

export const E_MULTILINE_BLOCK_EQUATION_NODE: MultilineElementTransformer = {
  dependencies: [EquationNode],
  type: 'multiline-element',
  regExpStart: /^(.*)\$\$\s*$/,
  regExpEnd: /^(.*\$\$)(.*)$/,
  export: (_node) => {
    return null;
  },
  replace: (
    rootNode,
    children,
    startMatch,
    endMatch,
    linesInBetween,
    _isImport
  ) => {
    if ((children?.length ?? 0) > 0) {
      return false;
    }

    const latexString =
      linesInBetween?.join('\n')?.trim().replaceAll('{align}', '{align*}') ??
      '';
    const hasTextBeforeStart = startMatch?.[1]?.trim() !== '';
    const hasTextAfterEnd = endMatch?.[2]?.trim() !== '';
    if (
      !latexString ||
      latexString.includes('$$') ||
      hasTextBeforeStart ||
      hasTextAfterEnd
    ) {
      console.warn(
        'Invalid multiline equation block — skipping node creation.'
      );
      return false;
    }

    try {
      // when AI Chat prompt gets updated to support inline vs block, update inline to false
      const isInline = true; // false
      const equationNode = $createEquationNode(latexString, isInline);
      rootNode.append(equationNode);
    } catch (e) {
      console.error('Error creating multiline equation node:', e);
      return false;
    }
  },
};
