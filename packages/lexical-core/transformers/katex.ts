import type {
  MultilineElementTransformer,
  TextMatchTransformer,
} from '@lexical/markdown';
import {
  $isLineBreakNode,
  $isTextNode,
  type LexicalNode,
  type TextNode,
} from 'lexical';
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

// External Inline Equation Node

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

function isBlankText(node: LexicalNode): boolean {
  return $isTextNode(node) && node.getTextContent().trim() === '';
}

/**
 * Whether other content sits on the same line as `node` inside its parent.
 * The match has already been split into its own text node, so anything
 * between the nearest line breaks other than blank text is neighbouring
 * prose.
 */
function $sharesLineWithContent(node: TextNode): boolean {
  const scan = (
    step: (current: LexicalNode) => LexicalNode | null
  ): boolean => {
    for (
      let sibling = step(node);
      sibling !== null && !$isLineBreakNode(sibling);
      sibling = step(sibling)
    ) {
      if (!isBlankText(sibling)) return true;
    }
    return false;
  };
  return (
    scan((current) => current.getPreviousSibling()) ||
    scan((current) => current.getNextSibling())
  );
}

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
      // `$$…$$` is display math only when it has the line to itself. Models
      // routinely wrap amounts in `$$…$$` mid-sentence, and a centred block
      // with vertical margins inside a line of prose renders far above the
      // text around it.
      const inline = $sharesLineWithContent(node);
      const equationNode = $createEquationNode(equation, inline);
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
      const equationNode = $createEquationNode(latexString, false);
      rootNode.append(equationNode);
    } catch (e) {
      console.error('Error creating multiline equation node:', e);
      return false;
    }
  },
};
