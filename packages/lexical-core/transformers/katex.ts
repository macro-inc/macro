import type {
  MultilineElementTransformer,
  TextMatchTransformer,
} from '@lexical/markdown';
import type { ElementNode, LexicalNode, TextNode } from 'lexical';
import {
  $createEquationNode,
  $isEquationNode,
  EquationNode,
} from '../nodes/EquationNode';
import {
  replaceTextWithUnknownMention,
  UnknownMentionNode,
} from './unknownFallback';

// Internal Equation Node

const TAG_KATEX_EQUATION = 'm-katex-equation';
const REG_EXP_KATEX_EQUATION = new RegExp(
  `<${TAG_KATEX_EQUATION}>(.*?)<\/${TAG_KATEX_EQUATION}>`,
  ''
);

export const I_EQUATION_NODE: TextMatchTransformer = {
  dependencies: [EquationNode, UnknownMentionNode],
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
      console.error('Error in I_EQUATION_NODE replace:', e);
      replaceTextWithUnknownMention(node, 'Unknown Equation');
    }
  },
};

function replaceInlineEquation(
  node: TextNode,
  match: RegExpMatchArray,
  strip: RegExp
) {
  try {
    const equation = match[0].replace(strip, '');
    node.replace($createEquationNode(equation, true));
  } catch (e) {
    console.error('Error creating equation node:', e);
  }
}

function replaceBlockEquation(
  node: TextNode,
  match: RegExpMatchArray,
  strip: RegExp
) {
  try {
    const equation = match[0].replace(strip, '');
    node.replace($createEquationNode(equation, false));
  } catch (e) {
    console.error('Error creating equation node:', e);
  }
}

function replaceMultilineEquationBlock(
  rootNode: ElementNode,
  children: Array<LexicalNode> | null,
  startMatch: Array<string>,
  endMatch: Array<string> | null,
  linesInBetween: Array<string> | null,
  forbidden: string
): boolean | void {
  if ((children?.length ?? 0) > 0) {
    return false;
  }

  const latexString =
    linesInBetween?.join('\n')?.trim().replaceAll('{align}', '{align*}') ?? '';
  const hasTextBeforeStart = startMatch?.[1]?.trim() !== '';
  const hasTextAfterEnd = endMatch?.[2]?.trim() !== '';
  if (
    !latexString ||
    latexString.includes(forbidden) ||
    hasTextBeforeStart ||
    hasTextAfterEnd
  ) {
    console.warn('Invalid multiline equation block — skipping node creation.');
    return false;
  }

  try {
    rootNode.append($createEquationNode(latexString, false));
  } catch (e) {
    console.error('Error creating multiline equation node:', e);
    return false;
  }
}

// External Inline Equation Node (`$...$`)

export const E_INLINE_EQUATION_NODE: TextMatchTransformer = {
  dependencies: [EquationNode],
  type: 'text-match',
  regExp:
    /(?<!\$)\$(?!\s)[^\n$]*?(?:[a-zA-Z\\=+\-*/^][^\n$]*?)(?<!\s)\$(?!\$|\d)/,
  importRegExp:
    /(?<!\$)\$(?!\s)[^\n$]*?(?:[a-zA-Z\\=+\-*/^][^\n$]*?)(?<!\s)\$(?!\$|\d)/,
  export: (node) => {
    if (!$isEquationNode(node)) {
      return null;
    }
    if (node.getInline()) {
      return `$${node.getEquation()}$`;
    }
    return null;
  },
  replace: (node, match) => replaceInlineEquation(node, match, /^\$|\$$/g),
};

// TeX-style inline math (`\( ... \)`), common in coding-agent replies.

export const E_LATEX_PAREN_INLINE: TextMatchTransformer = {
  dependencies: [EquationNode],
  type: 'text-match',
  regExp: /\\\((.+?)\\\)/,
  importRegExp: /\\\((.+?)\\\)/,
  export: () => null,
  replace: (node, match) => replaceInlineEquation(node, match, /^\\\(|\\\)$/g),
};

// External Block Equation Node (`$$...$$`)

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
  replace: (node, match) => replaceBlockEquation(node, match, /^\$\$|\$\$$/g),
};

// TeX-style display math (`\[ ... \]`) on one line.

export const E_LATEX_BRACKET_BLOCK: TextMatchTransformer = {
  dependencies: [EquationNode],
  type: 'text-match',
  regExp: /\\\[(.+?)\\\]/,
  importRegExp: /\\\[(.+?)\\\]/,
  export: () => null,
  replace: (node, match) => replaceBlockEquation(node, match, /^\\\[|\\\]$/g),
};

// External Multiline Block Equation Node (`$$\n...\n$$`)

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
  ) =>
    replaceMultilineEquationBlock(
      rootNode,
      children,
      startMatch,
      endMatch,
      linesInBetween,
      '$$'
    ),
};

// TeX-style multiline display math (`\[\n...\n\]`)

export const E_MULTILINE_LATEX_BRACKET_BLOCK: MultilineElementTransformer = {
  dependencies: [EquationNode],
  type: 'multiline-element',
  regExpStart: /^(.*)\\\[[ \t]*$/,
  regExpEnd: /^(.*\\\])(.*)$/,
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
  ) =>
    replaceMultilineEquationBlock(
      rootNode,
      children,
      startMatch,
      endMatch,
      linesInBetween,
      '\\['
    ),
};
