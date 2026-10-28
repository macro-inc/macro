/**
 * Equations (Insert ▸ Equation and the Equation tab): PowerPoint's built-in
 * equations, the Structures and Symbols galleries as linear-format (LaTeX)
 * snippets, template insertion into the linear text, and finding the
 * equation under a point or selection of laid-out text.
 */

import type {
  CellRef,
  EquationLayout,
  TextLayoutInfo,
  TextPos,
} from '@core/pptx-engine/types';
import { comparePos } from './caret';
import { applyAffine, invertAffine, type Point } from './geometry';

/** The character an equation stands as in paragraph text. */
export const OBJECT_CHAR = '￼';

/** An equation on a slide. */
export interface EquationRef {
  slide: number;
  shape: number;
  cell?: CellRef;
  paragraph: number;
  /** Character index in the paragraph. */
  index: number;
}

/** The equation selected on the slide, as laid out. */
export interface SelectedEquation extends EquationRef {
  latex: string;
  display: boolean;
}

/**
 * Where a new equation goes: into text at a position (replacing the text up
 * to `end`, when some was selected), or into a new text box.
 */
export type InsertionPoint =
  | {
      kind: 'text';
      slide: number;
      shape: number;
      cell?: CellRef;
      at: TextPos;
      end?: TextPos;
    }
  | { kind: 'box'; slide: number };

/** A new equation about to be written: where, its first text, and its kind. */
export interface NewEquation {
  where: InsertionPoint;
  text: string;
  display: boolean;
}

/** What equations need of the text being edited. */
export interface TextEditing {
  shape: number;
  cell?: CellRef;
  layout: TextLayoutInfo | null;
  selection: { anchor: TextPos; focus: TextPos };
}

/** An equation from the Equation button's list. */
export interface BuiltInEquation {
  id: string;
  name: string;
  latex: string;
}

/** PowerPoint's built-in equations (Insert ▸ Equation ▾). */
export const BUILT_IN_EQUATIONS: BuiltInEquation[] = [
  { id: 'area-of-circle', name: 'Area of Circle', latex: 'A=\\pi r^2' },
  {
    id: 'binomial-theorem',
    name: 'Binomial Theorem',
    latex: '(x+a)^n=\\sum_{k=0}^n\\binom{n}{k}x^k a^{n-k}',
  },
  {
    id: 'expansion-of-a-sum',
    name: 'Expansion of a Sum',
    latex: '(1+x)^n=1+\\frac{nx}{1!}+\\frac{n(n-1)x^2}{2!}+\\cdots',
  },
  {
    id: 'fourier-series',
    name: 'Fourier Series',
    latex:
      'f(x)=a_0+\\sum_{n=1}^\\infty\\left(a_n\\cos\\frac{n\\pi x}{L}+b_n\\sin\\frac{n\\pi x}{L}\\right)',
  },
  {
    id: 'pythagorean-theorem',
    name: 'Pythagorean Theorem',
    latex: 'a^2+b^2=c^2',
  },
  {
    id: 'quadratic-formula',
    name: 'Quadratic Formula',
    latex: 'x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}',
  },
  {
    id: 'taylor-expansion',
    name: 'Taylor Expansion',
    latex:
      'e^x=1+\\frac{x}{1!}+\\frac{x^2}{2!}+\\frac{x^3}{3!}+\\cdots,\\quad -\\infty<x<\\infty',
  },
  {
    id: 'trig-identity-1',
    name: 'Trig Identity 1',
    latex:
      '\\sin\\alpha\\pm\\sin\\beta=2\\sin\\frac{1}{2}(\\alpha\\pm\\beta)\\cos\\frac{1}{2}(\\alpha\\mp\\beta)',
  },
  {
    id: 'trig-identity-2',
    name: 'Trig Identity 2',
    latex:
      '\\cos\\alpha+\\cos\\beta=2\\cos\\frac{1}{2}(\\alpha+\\beta)\\cos\\frac{1}{2}(\\alpha-\\beta)',
  },
];

/** A structure template: `{}` marks the empty slots. */
export interface StructureItem {
  label: string;
  latex: string;
}

export interface StructureGallery {
  id: string;
  label: string;
  items: StructureItem[];
}

const item = (label: string, latex: string): StructureItem => ({
  label,
  latex,
});

/** The Equation tab's Structures galleries, in PowerPoint's order. */
export const STRUCTURES: StructureGallery[] = [
  {
    id: 'fraction',
    label: 'Fraction',
    items: [
      item('Stacked Fraction', '\\frac{}{}'),
      item('Skewed Fraction', '\\sfrac{}{}'),
      item('Linear Fraction', '\\lfrac{}{}'),
      item('Fraction with no bar', '\\genfrac{}{}{0pt}{}{}{}'),
      item('Differential', '\\frac{dy}{dx}'),
      item('Delta y over delta x', '\\frac{\\Delta y}{\\Delta x}'),
      item('Partial differential', '\\frac{\\partial y}{\\partial x}'),
      item('Pi over 2', '\\frac{\\pi}{2}'),
    ],
  },
  {
    id: 'script',
    label: 'Script',
    items: [
      item('Superscript', '{}^{}'),
      item('Subscript', '{}_{}'),
      item('Subscript-Superscript', '{}_{}^{}'),
      item('Left Subscript-Superscript', '{}_{}^{}{}'),
      item('x subscript y squared', 'x_{y^2}'),
      item('e to the minus i omega t', 'e^{-i\\omega t}'),
      item('x squared', 'x^2'),
      item('Y left sub-superscript', '{}_{1}^{n}Y'),
    ],
  },
  {
    id: 'radical',
    label: 'Radical',
    items: [
      item('Square Root', '\\sqrt{}'),
      item('Radical with Degree', '\\sqrt[]{}'),
      item('Square Root with Degree', '\\sqrt[2]{}'),
      item('Cube Root', '\\sqrt[3]{}'),
      item('Quadratic root', '\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}'),
      item('Hypotenuse', '\\sqrt{a^2+b^2}'),
    ],
  },
  {
    id: 'integral',
    label: 'Integral',
    items: [
      item('Integral', '\\int{}'),
      item('Integral with Limits', '\\int_{}^{}{}'),
      item('Integral with Stacked Limits', '\\int\\limits_{}^{}{}'),
      item('Double Integral', '\\iint{}'),
      item('Double Integral with Limits', '\\iint_{}^{}{}'),
      item('Triple Integral', '\\iiint{}'),
      item('Contour Integral', '\\oint{}'),
      item('Contour Integral with Limits', '\\oint_{}^{}{}'),
      item('Surface Integral', '\\oiint{}'),
      item('Volume Integral', '\\oiiint{}'),
      item('Differential x', 'dx'),
      item('Differential theta', 'd\\theta'),
    ],
  },
  {
    id: 'large-operator',
    label: 'Large Operator',
    items: [
      item('Summation', '\\sum{}'),
      item('Summation with Limits', '\\sum_{}^{}{}'),
      item('Summation with Lower Limit', '\\sum_{}{}'),
      item('Summation with Side Limits', '\\sum\\nolimits_{}^{}{}'),
      item('Product', '\\prod{}'),
      item('Product with Limits', '\\prod_{}^{}{}'),
      item('Co-Product with Limits', '\\coprod_{}^{}{}'),
      item('Union with Limits', '\\bigcup_{}^{}{}'),
      item('Intersection with Limits', '\\bigcap_{}^{}{}'),
      item('Logical OR', '\\bigvee_{}^{}{}'),
      item('Logical AND', '\\bigwedge_{}^{}{}'),
      item('Summation over k of n choose k', '\\sum_{k}\\binom{n}{k}'),
      item('Summation from i equal 0 to n', '\\sum_{i=0}^{n}{}'),
      item('Product example', '\\prod_{k=1}^{n}A_k'),
    ],
  },
  {
    id: 'bracket',
    label: 'Bracket',
    items: [
      item('Parentheses', '\\left({}\\right)'),
      item('Brackets', '\\left[{}\\right]'),
      item('Braces', '\\left\\{{}\\right\\}'),
      item('Angle Brackets', '\\left\\langle{}\\right\\rangle'),
      item('Floor', '\\left\\lfloor{}\\right\\rfloor'),
      item('Ceiling', '\\left\\lceil{}\\right\\rceil'),
      item('Single Bars', '\\left|{}\\right|'),
      item('Double Bars', '\\left\\|{}\\right\\|'),
      item('Parentheses with Separator', '\\left({}\\middle|{}\\right)'),
      item('Single Brace', '\\left\\{{}\\right.'),
      item('Cases', '\\begin{cases}{}\\\\{}\\end{cases}'),
      item(
        'Cases example',
        'f(x)=\\begin{cases}-x, & x<0 \\\\ x, & x\\ge0\\end{cases}'
      ),
      item('Binomial Coefficient', '\\binom{n}{k}'),
    ],
  },
  {
    id: 'function',
    label: 'Function',
    items: [
      item('Sine Function', '\\sin{}'),
      item('Cosine Function', '\\cos{}'),
      item('Tangent Function', '\\tan{}'),
      item('Cosecant Function', '\\csc{}'),
      item('Secant Function', '\\sec{}'),
      item('Cotangent Function', '\\cot{}'),
      item('Inverse Sine Function', '\\sin^{-1}{}'),
      item('Hyperbolic Sine Function', '\\sinh{}'),
      item('Hyperbolic Cosine Function', '\\cosh{}'),
      item('Hyperbolic Tangent Function', '\\tanh{}'),
      item('Sine theta', '\\sin\\theta'),
      item('Sine 2x', '\\sin 2x'),
      item(
        'Tangent formula',
        '\\tan\\theta=\\frac{\\sin\\theta}{\\cos\\theta}'
      ),
    ],
  },
  {
    id: 'accent',
    label: 'Accent',
    items: [
      item('Dot', '\\dot{}'),
      item('Double Dot', '\\ddot{}'),
      item('Triple Dot', '\\dddot{}'),
      item('Hat', '\\hat{}'),
      item('Check', '\\check{}'),
      item('Acute', '\\acute{}'),
      item('Grave', '\\grave{}'),
      item('Breve', '\\breve{}'),
      item('Tilde', '\\tilde{}'),
      item('Bar', '\\bar{}'),
      item('Rightwards Arrow Above', '\\vec{}'),
      item('Leftwards Arrow Above', '\\overleftarrow{}'),
      item('Left Right Arrow Above', '\\overleftrightarrow{}'),
      item('Overbar', '\\overline{}'),
      item('Underbar', '\\underline{}'),
      item('Overbrace', '\\overbrace{}'),
      item('Underbrace', '\\underbrace{}'),
      item('Boxed Formula', '\\boxed{}'),
      item('Overbar AB', '\\overline{AB}'),
    ],
  },
  {
    id: 'limit-and-log',
    label: 'Limit and Log',
    items: [
      item('Logarithm with Base', '\\log_{}{}'),
      item('Logarithm', '\\log{}'),
      item('Limit', '\\lim_{}{}'),
      item('Minimum', '\\min_{}{}'),
      item('Maximum', '\\max_{}{}'),
      item('Natural Logarithm', '\\ln{}'),
      item(
        'Limit example',
        '\\lim_{n\\to\\infty}\\left(1+\\frac{1}{n}\\right)^n'
      ),
      item('Maximum example', '\\max_{0\\le x\\le1}xe^{-x^2}'),
    ],
  },
  {
    id: 'operator',
    label: 'Operator',
    items: [
      item('Colon Equal', ':='),
      item('Equal Equal', '=='),
      item('Plus Equal', '+='),
      item('Minus Equal', '-='),
      item('Equal by Definition', '\\overset{def}{=}'),
      item('Delta Equal To', '\\overset{\\Delta}{=}'),
      item('Measured By', '\\overset{m}{=}'),
      item('Right Arrow Below', '\\underset{}{\\longrightarrow}'),
      item('Right Arrow Above', '\\overset{}{\\longrightarrow}'),
      item('Left Arrow Below', '\\underset{}{\\longleftarrow}'),
      item('Double Right Arrow Above', '\\overset{}{\\Longrightarrow}'),
      item('Underbrace with Limit', '\\underbrace{}_{}'),
      item('Overbrace with Limit', '\\overbrace{}^{}'),
    ],
  },
  {
    id: 'matrix',
    label: 'Matrix',
    items: [
      item('1×2 Empty Matrix', '\\begin{matrix}{} & {}\\end{matrix}'),
      item('2×1 Empty Matrix', '\\begin{matrix}{} \\\\ {}\\end{matrix}'),
      item('1×3 Empty Matrix', '\\begin{matrix}{} & {} & {}\\end{matrix}'),
      item(
        '3×1 Empty Matrix',
        '\\begin{matrix}{} \\\\ {} \\\\ {}\\end{matrix}'
      ),
      item(
        '2×2 Empty Matrix',
        '\\begin{matrix}{} & {} \\\\ {} & {}\\end{matrix}'
      ),
      item(
        '2×3 Empty Matrix',
        '\\begin{matrix}{} & {} & {} \\\\ {} & {} & {}\\end{matrix}'
      ),
      item(
        '3×3 Empty Matrix',
        '\\begin{matrix}{} & {} & {} \\\\ {} & {} & {} \\\\ {} & {} & {}\\end{matrix}'
      ),
      item('Midline Dots', '\\cdots'),
      item('Baseline Dots', '\\ldots'),
      item('Vertical Dots', '\\vdots'),
      item('Diagonal Dots', '\\ddots'),
      item(
        '2×2 Identity Matrix',
        '\\begin{pmatrix}1 & 0 \\\\ 0 & 1\\end{pmatrix}'
      ),
      item(
        '2×2 Matrix with Brackets',
        '\\begin{bmatrix}{} & {} \\\\ {} & {}\\end{bmatrix}'
      ),
      item(
        '2×2 Determinant',
        '\\begin{vmatrix}{} & {} \\\\ {} & {}\\end{vmatrix}'
      ),
    ],
  },
];

/** A symbol of the Symbols gallery and what it inserts. */
export interface EquationSymbol {
  char: string;
  /** The LaTeX command, when the symbol has one. */
  command?: string;
}

export interface SymbolGroup {
  id: string;
  label: string;
  symbols: EquationSymbol[];
}

const sym = (char: string, command?: string): EquationSymbol =>
  command ? { char, command } : { char };

/** The Symbols gallery's groups, as in PowerPoint's Equation tab. */
const GROUPS: SymbolGroup[] = [
  {
    id: 'basic-math',
    label: 'Basic Math',
    symbols: [
      sym('±', 'pm'),
      sym('∞', 'infty'),
      sym('='),
      sym('≠', 'ne'),
      sym('~', 'sim'),
      sym('×', 'times'),
      sym('÷', 'div'),
      sym('!'),
      sym('∝', 'propto'),
      sym('<'),
      sym('≪', 'll'),
      sym('>'),
      sym('≫', 'gg'),
      sym('≤', 'le'),
      sym('≥', 'ge'),
      sym('∓', 'mp'),
      sym('≅', 'cong'),
      sym('≈', 'approx'),
      sym('≡', 'equiv'),
      sym('∀', 'forall'),
      sym('∁', 'complement'),
      sym('∂', 'partial'),
      sym('√', 'surd'),
      sym('∪', 'cup'),
      sym('∩', 'cap'),
      sym('∅', 'emptyset'),
      sym('%', '%'),
      sym('°', 'degree'),
      sym('∆', 'Delta'),
      sym('∇', 'nabla'),
      sym('∃', 'exists'),
      sym('∄', 'nexists'),
      sym('∈', 'in'),
      sym('∋', 'ni'),
      sym('←', 'leftarrow'),
      sym('↑', 'uparrow'),
      sym('→', 'rightarrow'),
      sym('↓', 'downarrow'),
      sym('↔', 'leftrightarrow'),
      sym('∴', 'therefore'),
      sym('+'),
      sym('−', '-'),
      sym('¬', 'neg'),
      sym('∗', 'ast'),
      sym('∙', 'bullet'),
      sym('⋮', 'vdots'),
      sym('⋯', 'cdots'),
      sym('⋱', 'ddots'),
      sym('ℵ', 'aleph'),
      sym('ℶ', 'beth'),
    ],
  },
  {
    id: 'greek',
    label: 'Greek Letters',
    symbols: [
      sym('α', 'alpha'),
      sym('β', 'beta'),
      sym('γ', 'gamma'),
      sym('δ', 'delta'),
      sym('ϵ', 'epsilon'),
      sym('ε', 'varepsilon'),
      sym('ζ', 'zeta'),
      sym('η', 'eta'),
      sym('θ', 'theta'),
      sym('ϑ', 'vartheta'),
      sym('ι', 'iota'),
      sym('κ', 'kappa'),
      sym('λ', 'lambda'),
      sym('μ', 'mu'),
      sym('ν', 'nu'),
      sym('ξ', 'xi'),
      sym('π', 'pi'),
      sym('ϖ', 'varpi'),
      sym('ρ', 'rho'),
      sym('ϱ', 'varrho'),
      sym('σ', 'sigma'),
      sym('ς', 'varsigma'),
      sym('τ', 'tau'),
      sym('υ', 'upsilon'),
      sym('ϕ', 'phi'),
      sym('φ', 'varphi'),
      sym('χ', 'chi'),
      sym('ψ', 'psi'),
      sym('ω', 'omega'),
      sym('Γ', 'Gamma'),
      sym('Δ', 'Delta'),
      sym('Θ', 'Theta'),
      sym('Λ', 'Lambda'),
      sym('Ξ', 'Xi'),
      sym('Π', 'Pi'),
      sym('Σ', 'Sigma'),
      sym('Υ', 'Upsilon'),
      sym('Φ', 'Phi'),
      sym('Ψ', 'Psi'),
      sym('Ω', 'Omega'),
    ],
  },
  {
    id: 'letter-like',
    label: 'Letter-Like Symbols',
    symbols: [
      sym('ℂ', 'mathbb{C}'),
      sym('ℍ', 'mathbb{H}'),
      sym('ℕ', 'mathbb{N}'),
      sym('ℙ', 'mathbb{P}'),
      sym('ℚ', 'mathbb{Q}'),
      sym('ℝ', 'mathbb{R}'),
      sym('ℤ', 'mathbb{Z}'),
      sym('ℏ', 'hbar'),
      sym('ℓ', 'ell'),
      sym('℘', 'wp'),
      sym('ℜ', 'Re'),
      sym('ℑ', 'Im'),
      sym('ℒ', 'mathcal{L}'),
      sym('ℱ', 'mathcal{F}'),
      sym('ℋ', 'mathcal{H}'),
      sym('ℰ', 'mathcal{E}'),
      sym('℧', 'mho'),
      sym('ı', 'imath'),
      sym('ȷ', 'jmath'),
    ],
  },
  {
    id: 'operators',
    label: 'Operators',
    symbols: [
      sym('∘', 'circ'),
      sym('⋅', 'cdot'),
      sym('⊕', 'oplus'),
      sym('⊖', 'ominus'),
      sym('⊗', 'otimes'),
      sym('⊘', 'oslash'),
      sym('⊙', 'odot'),
      sym('∧', 'wedge'),
      sym('∨', 'vee'),
      sym('⊎', 'uplus'),
      sym('⊓', 'sqcap'),
      sym('⊔', 'sqcup'),
      sym('∖', 'setminus'),
      sym('⋆', 'star'),
      sym('†', 'dagger'),
      sym('‡', 'ddagger'),
      sym('≺', 'prec'),
      sym('≻', 'succ'),
      sym('⪯', 'preceq'),
      sym('⪰', 'succeq'),
      sym('⊂', 'subset'),
      sym('⊃', 'supset'),
      sym('⊆', 'subseteq'),
      sym('⊇', 'supseteq'),
      sym('⊥', 'perp'),
      sym('∥', 'parallel'),
      sym('∣', 'mid'),
      sym('≃', 'simeq'),
      sym('≐', 'doteq'),
      sym('≜', 'triangleq'),
      sym('≔', 'coloneqq'),
      sym('⊢', 'vdash'),
      sym('⊣', 'dashv'),
      sym('⊨', 'models'),
    ],
  },
  {
    id: 'arrows',
    label: 'Arrows',
    symbols: [
      sym('←', 'leftarrow'),
      sym('→', 'rightarrow'),
      sym('↑', 'uparrow'),
      sym('↓', 'downarrow'),
      sym('↔', 'leftrightarrow'),
      sym('↕', 'updownarrow'),
      sym('⇐', 'Leftarrow'),
      sym('⇒', 'Rightarrow'),
      sym('⇑', 'Uparrow'),
      sym('⇓', 'Downarrow'),
      sym('⇔', 'Leftrightarrow'),
      sym('⇕', 'Updownarrow'),
      sym('⟵', 'longleftarrow'),
      sym('⟶', 'longrightarrow'),
      sym('⟷', 'longleftrightarrow'),
      sym('⟸', 'Longleftarrow'),
      sym('⟹', 'Longrightarrow'),
      sym('⟺', 'Longleftrightarrow'),
      sym('↦', 'mapsto'),
      sym('↪', 'hookrightarrow'),
      sym('↩', 'hookleftarrow'),
      sym('⇀', 'rightharpoonup'),
      sym('⇁', 'rightharpoondown'),
      sym('↼', 'leftharpoonup'),
      sym('↽', 'leftharpoondown'),
      sym('⇌', 'rightleftharpoons'),
      sym('↗', 'nearrow'),
      sym('↘', 'searrow'),
      sym('↙', 'swarrow'),
      sym('↖', 'nwarrow'),
    ],
  },
  {
    id: 'negated',
    label: 'Negated Relations',
    symbols: [
      sym('≠', 'ne'),
      sym('≮', 'nless'),
      sym('≯', 'ngtr'),
      sym('≰', 'nleq'),
      sym('≱', 'ngeq'),
      sym('∉', 'notin'),
      sym('⊈', 'nsubseteq'),
      sym('⊉', 'nsupseteq'),
      sym('≁', 'nsim'),
      sym('≇', 'ncong'),
      sym('≢', 'nequiv'),
      sym('∤', 'nmid'),
    ],
  },
  {
    id: 'geometry',
    label: 'Geometry',
    symbols: [
      sym('∠', 'angle'),
      sym('∡', 'measuredangle'),
      sym('⊥', 'perp'),
      sym('∥', 'parallel'),
      sym('△', 'triangle'),
      sym('□', 'square'),
      sym('°', 'degree'),
      sym('∼', 'sim'),
      sym('≅', 'cong'),
      sym('∴', 'therefore'),
      sym('∵', 'because'),
    ],
  },
];

/**
 * The Symbols gallery's groups, as in PowerPoint's Equation tab; a symbol
 * shows in the first group that has it.
 */
export const SYMBOL_GROUPS: SymbolGroup[] = (() => {
  const seen = new Set<string>();
  return GROUPS.map((group) => ({
    ...group,
    symbols: group.symbols.filter((s) => {
      const id = symbolId(s);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    }),
  }));
})();

/** What a symbol inserts into linear text. */
export function symbolText(s: EquationSymbol): string {
  if (!s.command) return s.char;
  if (/^[A-Za-z]/.test(s.command)) return `\\${s.command} `;
  return s.command;
}

/** A test-id-friendly name for a symbol: its command, or its code point. */
export function symbolId(s: EquationSymbol): string {
  if (s.command && /^[A-Za-z]+$/.test(s.command)) return s.command;
  return `u${(s.char.codePointAt(0) ?? 0).toString(16).padStart(4, '0')}`;
}

/** Linear text after inserting something at a selection, and the caret. */
export interface TemplateResult {
  text: string;
  /** Where the caret goes (a code unit offset into `text`). */
  caret: number;
}

const SLOT = '{}';

/**
 * Inserts `template` at `start..end` of `text`. A selection fills the
 * template's first empty slot (`{}`) and the caret goes to the next one;
 * otherwise the caret goes into the first slot, or after the template.
 */
export function insertTemplate(
  text: string,
  start: number,
  end: number,
  template: string
): TemplateResult {
  const [from, to] = start <= end ? [start, end] : [end, start];
  const selected = text.slice(from, to);
  let body = template;
  let caretIn = -1;
  const first = body.indexOf(SLOT);
  if (selected && first >= 0) {
    body = `${body.slice(0, first)}{${selected}}${body.slice(first + SLOT.length)}`;
    const next = body.indexOf(SLOT, first + selected.length + 2);
    caretIn = next >= 0 ? next + 1 : body.length;
  } else if (first >= 0) {
    caretIn = first + 1;
  } else {
    caretIn = body.length;
  }
  return {
    text: text.slice(0, from) + body + text.slice(to),
    caret: from + caretIn,
  };
}

/** A point of the slide in a text layout's space. */
function toLayout(layout: TextLayoutInfo, at: Point): Point | null {
  const inverse = invertAffine(layout.transform);
  return inverse ? applyAffine(inverse, at) : null;
}

/** The equation under a slide point, if any. */
export function equationAt(
  layout: TextLayoutInfo,
  at: Point
): EquationLayout | undefined {
  const p = toLayout(layout, at);
  if (!p) return undefined;
  return (layout.equations ?? []).find(
    (e) => p.x >= e.x && p.x <= e.x + e.w && p.y >= e.y && p.y <= e.y + e.h
  );
}

/** The equation a text selection covers exactly (selected as a whole). */
export function selectedEquation(
  layout: TextLayoutInfo | null | undefined,
  anchor: TextPos,
  focus: TextPos
): EquationLayout | undefined {
  if (!layout) return undefined;
  const [a, b] =
    comparePos(anchor, focus) <= 0 ? [anchor, focus] : [focus, anchor];
  if (a.paragraph !== b.paragraph || b.offset - a.offset !== 1)
    return undefined;
  return (layout.equations ?? []).find(
    (e) => e.paragraph === a.paragraph && e.index === a.offset
  );
}

/** The selection that covers an equation. */
export function equationSelection(e: { paragraph: number; index: number }): {
  anchor: TextPos;
  focus: TextPos;
} {
  return {
    anchor: { paragraph: e.paragraph, offset: e.index },
    focus: { paragraph: e.paragraph, offset: e.index + 1 },
  };
}

/** The equation the selection of edited text covers, on slide `slide`. */
export function equationOfSelection(
  slide: number,
  edit: TextEditing | null | undefined
): SelectedEquation | undefined {
  if (!edit) return undefined;
  const e = selectedEquation(
    edit.layout,
    edit.selection.anchor,
    edit.selection.focus
  );
  return e
    ? {
        slide,
        shape: edit.shape,
        ...(edit.cell ? { cell: edit.cell } : {}),
        paragraph: e.paragraph,
        index: e.index,
        latex: e.latex,
        display: e.display,
      }
    : undefined;
}

export const sameEquation = (
  a: SelectedEquation | undefined,
  b: SelectedEquation | undefined
) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Where Insert ▸ Equation puts a new equation: at the caret of the text
 * being edited (selected text on one line becomes its linear text), or in a
 * new text box when no text is being edited. An equation in an empty
 * paragraph or a new box is a display equation, as in PowerPoint.
 */
export function newEquation(
  slide: number,
  edit: TextEditing | null | undefined,
  selectedText: string
): NewEquation {
  if (!edit) return { where: { kind: 'box', slide }, text: '', display: true };
  const { anchor, focus } = edit.selection;
  const [start, end] =
    comparePos(anchor, focus) <= 0 ? [anchor, focus] : [focus, anchor];
  const convert =
    comparePos(start, end) !== 0 &&
    selectedText.trim() !== '' &&
    !selectedText.includes(OBJECT_CHAR) &&
    !selectedText.includes('\n') &&
    !selectedText.includes('\u000b');
  const empty = (edit.layout?.lines ?? [])
    .filter((l) => l.paragraph === start.paragraph)
    .every((l) => l.stops.every((s) => s.index === 0));
  return {
    where: {
      kind: 'text',
      slide,
      shape: edit.shape,
      ...(edit.cell ? { cell: edit.cell } : {}),
      at: start,
      ...(convert ? { end } : {}),
    },
    text: convert ? selectedText : '',
    display: empty && !convert,
  };
}

/** The equation inserted at `at`: the first one at or after it. */
export function insertedEquation(
  layout: TextLayoutInfo | null | undefined,
  at: TextPos
): EquationLayout | undefined {
  return (layout?.equations ?? []).find(
    (e) => comparePos({ paragraph: e.paragraph, offset: e.index }, at) >= 0
  );
}
