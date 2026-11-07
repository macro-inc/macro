//! Character tables: LaTeX command names, Unicode math alphanumerics, and
//! the spacing class of each character.

use super::tree::{Alphabet, Style};

/// LaTeX commands that stand for one character. The first command listed
/// for a character is the one the LaTeX writer uses.
pub const COMMANDS: &[(&str, char)] = &[
    // Greek, lower case.
    ("alpha", 'α'),
    ("beta", 'β'),
    ("gamma", 'γ'),
    ("delta", 'δ'),
    ("epsilon", 'ϵ'),
    ("varepsilon", 'ε'),
    ("zeta", 'ζ'),
    ("eta", 'η'),
    ("theta", 'θ'),
    ("vartheta", 'ϑ'),
    ("iota", 'ι'),
    ("kappa", 'κ'),
    ("varkappa", 'ϰ'),
    ("lambda", 'λ'),
    ("mu", 'μ'),
    ("nu", 'ν'),
    ("xi", 'ξ'),
    ("omicron", 'ο'),
    ("pi", 'π'),
    ("varpi", 'ϖ'),
    ("rho", 'ρ'),
    ("varrho", 'ϱ'),
    ("sigma", 'σ'),
    ("varsigma", 'ς'),
    ("tau", 'τ'),
    ("upsilon", 'υ'),
    ("phi", 'ϕ'),
    ("varphi", 'φ'),
    ("chi", 'χ'),
    ("psi", 'ψ'),
    ("omega", 'ω'),
    // Greek, upper case.
    ("Alpha", 'Α'),
    ("Beta", 'Β'),
    ("Gamma", 'Γ'),
    ("Delta", 'Δ'),
    ("Epsilon", 'Ε'),
    ("Zeta", 'Ζ'),
    ("Eta", 'Η'),
    ("Theta", 'Θ'),
    ("Iota", 'Ι'),
    ("Kappa", 'Κ'),
    ("Lambda", 'Λ'),
    ("Mu", 'Μ'),
    ("Nu", 'Ν'),
    ("Xi", 'Ξ'),
    ("Omicron", 'Ο'),
    ("Pi", 'Π'),
    ("Rho", 'Ρ'),
    ("Sigma", 'Σ'),
    ("Tau", 'Τ'),
    ("Upsilon", 'Υ'),
    ("Phi", 'Φ'),
    ("Chi", 'Χ'),
    ("Psi", 'Ψ'),
    ("Omega", 'Ω'),
    // Binary operators.
    ("pm", '±'),
    ("mp", '∓'),
    ("times", '×'),
    ("div", '÷'),
    ("cdot", '⋅'),
    ("ast", '∗'),
    ("star", '⋆'),
    ("circ", '∘'),
    ("bullet", '∙'),
    ("oplus", '⊕'),
    ("ominus", '⊖'),
    ("otimes", '⊗'),
    ("oslash", '⊘'),
    ("odot", '⊙'),
    ("cap", '∩'),
    ("cup", '∪'),
    ("wedge", '∧'),
    ("land", '∧'),
    ("vee", '∨'),
    ("lor", '∨'),
    ("setminus", '∖'),
    ("uplus", '⊎'),
    ("sqcap", '⊓'),
    ("sqcup", '⊔'),
    ("dagger", '†'),
    ("dag", '†'),
    ("ddagger", '‡'),
    ("ddag", '‡'),
    ("amalg", '⨿'),
    ("diamond", '⋄'),
    ("bigtriangleup", '△'),
    ("bigtriangledown", '▽'),
    ("triangleleft", '◃'),
    ("triangleright", '▹'),
    ("wr", '≀'),
    // Relations.
    ("le", '≤'),
    ("leq", '≤'),
    ("ge", '≥'),
    ("geq", '≥'),
    ("ne", '≠'),
    ("neq", '≠'),
    ("equiv", '≡'),
    ("approx", '≈'),
    ("cong", '≅'),
    ("simeq", '≃'),
    ("sim", '∼'),
    ("propto", '∝'),
    ("ll", '≪'),
    ("gg", '≫'),
    ("subset", '⊂'),
    ("supset", '⊃'),
    ("subseteq", '⊆'),
    ("supseteq", '⊇'),
    ("subsetneq", '⊊'),
    ("supsetneq", '⊋'),
    ("nsubseteq", '⊈'),
    ("nsupseteq", '⊉'),
    ("in", '∈'),
    ("notin", '∉'),
    ("ni", '∋'),
    ("perp", '⊥'),
    ("parallel", '∥'),
    ("mid", '∣'),
    ("nmid", '∤'),
    ("prec", '≺'),
    ("succ", '≻'),
    ("preceq", '⪯'),
    ("succeq", '⪰'),
    ("doteq", '≐'),
    ("vdash", '⊢'),
    ("dashv", '⊣'),
    ("models", '⊨'),
    ("asymp", '≍'),
    ("bowtie", '⋈'),
    ("sqsubset", '⊏'),
    ("sqsupset", '⊐'),
    ("sqsubseteq", '⊑'),
    ("sqsupseteq", '⊒'),
    ("leqslant", '⩽'),
    ("geqslant", '⩾'),
    ("nless", '≮'),
    ("ngtr", '≯'),
    ("nleq", '≰'),
    ("ngeq", '≱'),
    ("lessgtr", '≶'),
    ("coloneqq", '≔'),
    ("triangleq", '≜'),
    ("nsim", '≁'),
    ("ncong", '≇'),
    ("nequiv", '≢'),
    ("because", '∵'),
    ("therefore", '∴'),
    // Arrows.
    ("to", '→'),
    ("rightarrow", '→'),
    ("leftarrow", '←'),
    ("gets", '←'),
    ("leftrightarrow", '↔'),
    ("Rightarrow", '⇒'),
    ("Leftarrow", '⇐'),
    ("Leftrightarrow", '⇔'),
    ("implies", '⟹'),
    ("Longrightarrow", '⟹'),
    ("impliedby", '⟸'),
    ("Longleftarrow", '⟸'),
    ("iff", '⟺'),
    ("Longleftrightarrow", '⟺'),
    ("mapsto", '↦'),
    ("longmapsto", '⟼'),
    ("longrightarrow", '⟶'),
    ("longleftarrow", '⟵'),
    ("longleftrightarrow", '⟷'),
    ("uparrow", '↑'),
    ("downarrow", '↓'),
    ("updownarrow", '↕'),
    ("Uparrow", '⇑'),
    ("Downarrow", '⇓'),
    ("Updownarrow", '⇕'),
    ("nearrow", '↗'),
    ("searrow", '↘'),
    ("swarrow", '↙'),
    ("nwarrow", '↖'),
    ("hookrightarrow", '↪'),
    ("hookleftarrow", '↩'),
    ("rightleftharpoons", '⇌'),
    ("leftrightharpoons", '⇋'),
    ("rightharpoonup", '⇀'),
    ("rightharpoondown", '⇁'),
    ("leftharpoonup", '↼'),
    ("leftharpoondown", '↽'),
    ("leadsto", '⇝'),
    // Other symbols.
    ("infty", '∞'),
    ("partial", '∂'),
    ("nabla", '∇'),
    ("forall", '∀'),
    ("exists", '∃'),
    ("nexists", '∄'),
    ("emptyset", '∅'),
    ("varnothing", '∅'),
    ("aleph", 'ℵ'),
    ("beth", 'ℶ'),
    ("hbar", 'ℏ'),
    ("ell", 'ℓ'),
    ("wp", '℘'),
    ("Re", 'ℜ'),
    ("Im", 'ℑ'),
    ("angle", '∠'),
    ("measuredangle", '∡'),
    ("degree", '°'),
    ("circledast", '⊛'),
    ("prime", '′'),
    ("surd", '√'),
    ("top", '⊤'),
    ("bot", '⊥'),
    ("neg", '¬'),
    ("lnot", '¬'),
    ("flat", '♭'),
    ("natural", '♮'),
    ("sharp", '♯'),
    ("clubsuit", '♣'),
    ("diamondsuit", '♢'),
    ("heartsuit", '♡'),
    ("spadesuit", '♠'),
    ("ldots", '…'),
    ("dots", '…'),
    ("cdots", '⋯'),
    ("vdots", '⋮'),
    ("ddots", '⋱'),
    ("square", '□'),
    ("Box", '□'),
    ("blacksquare", '■'),
    ("triangle", '△'),
    ("checkmark", '✓'),
    ("S", '§'),
    ("P", '¶'),
    ("copyright", '©'),
    ("pounds", '£'),
    ("imath", 'ı'),
    ("jmath", 'ȷ'),
    ("mho", '℧'),
    ("complement", '∁'),
    ("backslash", '\\'),
    ("lceil", '⌈'),
    ("rceil", '⌉'),
    ("lfloor", '⌊'),
    ("rfloor", '⌋'),
    ("langle", '⟨'),
    ("rangle", '⟩'),
    ("lbrace", '{'),
    ("rbrace", '}'),
    ("vert", '|'),
    ("lvert", '|'),
    ("rvert", '|'),
    ("Vert", '‖'),
    ("lVert", '‖'),
    ("rVert", '‖'),
    ("colon", ':'),
    // Spaces.
    ("quad", '\u{2003}'),
    ("enspace", '\u{2002}'),
    ("thinspace", '\u{2009}'),
];

/// One-character escapes: `\{`, `\,` and the like.
pub const ESCAPES: &[(char, char)] = &[
    ('{', '{'),
    ('}', '}'),
    ('|', '‖'),
    ('%', '%'),
    ('#', '#'),
    ('&', '&'),
    ('$', '$'),
    ('_', '_'),
    (',', '\u{2009}'),
    (':', '\u{205F}'),
    ('>', '\u{205F}'),
    (';', '\u{2004}'),
    (' ', ' '),
];

/// The character a symbol command stands for.
pub fn command_char(name: &str) -> Option<char> {
    COMMANDS.iter().find(|(n, _)| *n == name).map(|&(_, c)| c)
}

/// The command the LaTeX writer uses for a character.
pub fn char_command(c: char) -> Option<&'static str> {
    COMMANDS.iter().find(|(_, x)| *x == c).map(|&(n, _)| n)
}

/// N-ary operators: the command, its character, and whether it is an
/// integral (whose limits default to the side).
pub const NARY: &[(&str, char)] = &[
    ("sum", '∑'),
    ("prod", '∏'),
    ("coprod", '∐'),
    ("int", '∫'),
    ("iint", '∬'),
    ("iiint", '∭'),
    ("oint", '∮'),
    ("oiint", '∯'),
    ("oiiint", '∰'),
    ("bigcup", '⋃'),
    ("bigcap", '⋂'),
    ("bigvee", '⋁'),
    ("bigwedge", '⋀'),
    ("bigodot", '⨀'),
    ("bigoplus", '⨁'),
    ("bigotimes", '⨂'),
    ("biguplus", '⨄'),
    ("bigsqcup", '⨆'),
    ("iiiint", '⨌'),
];

/// Whether an n-ary operator is an integral.
pub fn is_integral(c: char) -> bool {
    matches!(
        c,
        '∫' | '∬' | '∭' | '∮' | '∯' | '∰' | '∱' | '∲' | '∳' | '⨌' | '⨍' | '⨎' | '⨏'
    )
}

/// The n-ary operator a command names.
pub fn nary_char(name: &str) -> Option<char> {
    NARY.iter().find(|(n, _)| *n == name).map(|&(_, c)| c)
}

/// The command of an n-ary operator character.
pub fn nary_command(c: char) -> Option<&'static str> {
    NARY.iter().find(|(_, x)| *x == c).map(|&(n, _)| n)
}

/// Accent commands and their (combining) characters.
pub const ACCENTS: &[(&str, char)] = &[
    ("hat", '\u{302}'),
    ("widehat", '\u{302}'),
    ("check", '\u{30C}'),
    ("tilde", '\u{303}'),
    ("widetilde", '\u{303}'),
    ("acute", '\u{301}'),
    ("grave", '\u{300}'),
    ("dot", '\u{307}'),
    ("ddot", '\u{308}'),
    ("dddot", '\u{20DB}'),
    ("breve", '\u{306}'),
    ("bar", '\u{305}'),
    ("vec", '\u{20D7}'),
    ("overrightarrow", '\u{20D7}'),
    ("overleftarrow", '\u{20D6}'),
    ("overleftrightarrow", '\u{20E1}'),
    ("mathring", '\u{30A}'),
];

/// The accent character a command names.
pub fn accent_char(name: &str) -> Option<char> {
    ACCENTS.iter().find(|(n, _)| *n == name).map(|&(_, c)| c)
}

/// The command of an accent character (spacing forms map to their
/// combining counterparts).
pub fn accent_command(c: char) -> Option<&'static str> {
    let c = match c {
        '\u{304}' | '\u{AF}' | '\u{203E}' => '\u{305}',
        '^' | '\u{2C6}' => '\u{302}',
        '~' | '\u{2DC}' => '\u{303}',
        '\u{2D9}' => '\u{307}',
        '\u{A8}' => '\u{308}',
        '\u{2192}' => '\u{20D7}',
        '\u{2190}' => '\u{20D6}',
        other => other,
    };
    ACCENTS.iter().find(|(_, x)| *x == c).map(|&(n, _)| n)
}

/// Group characters (`m:groupChr`): command, character, and whether it
/// goes over the base.
pub const GROUP_CHARS: &[(&str, char, bool)] = &[
    ("overbrace", '⏞', true),
    ("underbrace", '⏟', false),
    ("overparen", '⏜', true),
    ("underparen", '⏝', false),
    ("overbracket", '⎴', true),
    ("underbracket", '⎵', false),
];

/// Function names written upright (`\sin`...).
pub const FUNCTIONS: &[&str] = &[
    "sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh",
    "coth", "sech", "csch", "log", "ln", "lg", "exp", "det", "dim", "gcd", "hom", "ker", "arg",
    "deg", "Pr", "lim", "liminf", "limsup", "max", "min", "sup", "inf",
];

/// Functions whose subscript goes under the name in display equations.
pub fn takes_limits(name: &str) -> bool {
    matches!(
        name,
        "lim" | "liminf" | "limsup" | "max" | "min" | "sup" | "inf" | "det" | "gcd" | "Pr"
    )
}

/// How a character takes part in math spacing (TeX's atom classes).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Class {
    /// Ordinary: letters, digits, most symbols.
    Ord,
    /// A large operator.
    Op,
    /// A binary operator (`+`, `×`).
    Bin,
    /// A relation (`=`, `≤`, arrows).
    Rel,
    /// An opening delimiter.
    Open,
    /// A closing delimiter.
    Close,
    /// Punctuation (`,`, `;`).
    Punct,
    /// A fraction or delimited group.
    Inner,
}

/// The spacing class of a character.
pub fn class_of(c: char) -> Class {
    match c {
        '+' | '−' | '-' | '±' | '∓' | '×' | '÷' | '⋅' | '·' | '∗' | '*' | '⋆' | '∘' | '∙' | '⊕'
        | '⊖' | '⊗' | '⊘' | '⊙' | '∩' | '∪' | '∧' | '∨' | '∖' | '⊎' | '⊓' | '⊔' | '†' | '‡'
        | '⨿' | '⋄' | '△' | '▽' | '◃' | '▹' | '≀' | '⊛' => Class::Bin,
        '=' | '<' | '>' | '≠' | '≤' | '≥' | '≡' | '≈' | '≅' | '≃' | '∼' | '∝' | '≪' | '≫' | '⊂'
        | '⊃' | '⊆' | '⊇' | '⊊' | '⊋' | '⊈' | '⊉' | '∈' | '∉' | '∋' | '⊥' | '∥' | '∣' | '∤'
        | '≺' | '≻' | '⪯' | '⪰' | '≐' | '⊢' | '⊣' | '⊨' | '≍' | '⋈' | '⊏' | '⊐' | '⊑' | '⊒'
        | '⩽' | '⩾' | '≮' | '≯' | '≰' | '≱' | '≶' | '≔' | '≜' | '≝' | '≁' | '≇' | '≢' | '∵'
        | '∴' | ':' | '→' | '←' | '↔' | '⇒' | '⇐' | '⇔' | '⟹' | '⟸' | '⟺' | '↦' | '⟼' | '⟶'
        | '⟵' | '⟷' | '↑' | '↓' | '↕' | '⇑' | '⇓' | '⇕' | '↗' | '↘' | '↙' | '↖' | '↪' | '↩'
        | '⇌' | '⇋' | '⇀' | '⇁' | '↼' | '↽' | '⇝' => Class::Rel,
        '(' | '[' | '{' | '⟨' | '⌈' | '⌊' => Class::Open,
        ')' | ']' | '}' | '⟩' | '⌉' | '⌋' => Class::Close,
        ',' | ';' => Class::Punct,
        '∑' | '∏' | '∐' | '∫' | '∬' | '∭' | '∮' | '∯' | '∰' | '⋃' | '⋂' | '⋁' | '⋀' | '⨀' | '⨁'
        | '⨂' | '⨄' | '⨆' | '⨌' => Class::Op,
        _ => Class::Ord,
    }
}

/// Space between two atoms in eighteenths of an em (TeX's table); `tight`
/// (script styles) drops the spaces TeX only puts in display and text style.
pub fn spacing(left: Class, right: Class, tight: bool) -> u8 {
    use Class::*;
    // (amount, only in display/text style)
    let (mu, loose_only) = match (left, right) {
        (Ord, Op) | (Op, Ord) | (Op, Op) | (Close, Op) | (Inner, Op) => (3, false),
        (Ord, Bin) | (Bin, Ord) | (Bin, Op) | (Bin, Open) | (Bin, Inner) => (4, true),
        (Close, Bin) | (Inner, Bin) => (4, true),
        (Ord, Rel) | (Op, Rel) | (Close, Rel) | (Inner, Rel) => (5, true),
        (Rel, Ord) | (Rel, Op) | (Rel, Open) | (Rel, Inner) => (5, true),
        (Ord, Inner) | (Op, Inner) | (Close, Inner) | (Inner, Ord) | (Inner, Open) => (3, true),
        (Inner, Punct) | (Inner, Inner) => (3, true),
        (Punct, _) => (3, true),
        _ => (0, false),
    };
    if loose_only && tight { 0 } else { mu }
}

/// The math alphanumeric for a letter or digit in a style and alphabet,
/// when Unicode has one (`None` for roman upright, which is the letter).
pub fn math_char(base: char, style: Style, alphabet: Alphabet) -> Option<char> {
    let bold = matches!(style, Style::Bold | Style::BoldItalic);
    let italic = matches!(style, Style::Italic | Style::BoldItalic);
    if base.is_ascii_digit() {
        let start = match alphabet {
            Alphabet::DoubleStruck => 0x1D7D8,
            Alphabet::SansSerif if bold => 0x1D7EC,
            Alphabet::SansSerif => 0x1D7E2,
            Alphabet::Monospace => 0x1D7F6,
            _ if bold => 0x1D7CE,
            _ => return None,
        };
        return char::from_u32(start + (base as u32 - '0' as u32));
    }
    if let Some(i) = greek_index(base) {
        let start = match (bold, italic) {
            (true, false) => 0x1D6A8,
            (false, true) => 0x1D6E2,
            (true, true) => 0x1D71C,
            (false, false) => return None,
        };
        if !matches!(alphabet, Alphabet::Roman) {
            return None;
        }
        return char::from_u32(start + i);
    }
    let offset = match base {
        'A'..='Z' => base as u32 - 'A' as u32,
        'a'..='z' => base as u32 - 'a' as u32 + 26,
        _ => return None,
    };
    let start = match (alphabet, bold, italic) {
        (Alphabet::Roman, false, false) => return None,
        (Alphabet::Roman, true, false) => 0x1D400,
        (Alphabet::Roman, false, true) => 0x1D434,
        (Alphabet::Roman, true, true) => 0x1D468,
        (Alphabet::Script, false, _) => 0x1D49C,
        (Alphabet::Script, true, _) => 0x1D4D0,
        (Alphabet::Fraktur, false, _) => 0x1D504,
        (Alphabet::Fraktur, true, _) => 0x1D56C,
        (Alphabet::DoubleStruck, _, _) => 0x1D538,
        (Alphabet::SansSerif, false, false) => 0x1D5A0,
        (Alphabet::SansSerif, true, false) => 0x1D5D4,
        (Alphabet::SansSerif, false, true) => 0x1D608,
        (Alphabet::SansSerif, true, true) => 0x1D63C,
        (Alphabet::Monospace, _, _) => 0x1D670,
    };
    // Letters Unicode encoded earlier, in Letterlike Symbols.
    let hole = match (start, base) {
        (0x1D434, 'h') => Some('ℎ'),
        (0x1D49C, 'B') => Some('ℬ'),
        (0x1D49C, 'E') => Some('ℰ'),
        (0x1D49C, 'F') => Some('ℱ'),
        (0x1D49C, 'H') => Some('ℋ'),
        (0x1D49C, 'I') => Some('ℐ'),
        (0x1D49C, 'L') => Some('ℒ'),
        (0x1D49C, 'M') => Some('ℳ'),
        (0x1D49C, 'R') => Some('ℛ'),
        (0x1D49C, 'e') => Some('ℯ'),
        (0x1D49C, 'g') => Some('ℊ'),
        (0x1D49C, 'o') => Some('ℴ'),
        (0x1D504, 'C') => Some('ℭ'),
        (0x1D504, 'H') => Some('ℌ'),
        (0x1D504, 'I') => Some('ℑ'),
        (0x1D504, 'R') => Some('ℜ'),
        (0x1D504, 'Z') => Some('ℨ'),
        (0x1D538, 'C') => Some('ℂ'),
        (0x1D538, 'H') => Some('ℍ'),
        (0x1D538, 'N') => Some('ℕ'),
        (0x1D538, 'P') => Some('ℙ'),
        (0x1D538, 'Q') => Some('ℚ'),
        (0x1D538, 'R') => Some('ℝ'),
        (0x1D538, 'Z') => Some('ℤ'),
        _ => None,
    };
    hole.or_else(|| char::from_u32(start + offset))
}

/// The Greek letters in the order of the math alphanumeric Greek blocks.
const GREEK: &[char] = &[
    'Α', 'Β', 'Γ', 'Δ', 'Ε', 'Ζ', 'Η', 'Θ', 'Ι', 'Κ', 'Λ', 'Μ', 'Ν', 'Ξ', 'Ο', 'Π', 'Ρ', 'ϴ', 'Σ',
    'Τ', 'Υ', 'Φ', 'Χ', 'Ψ', 'Ω', '∇', 'α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'ι', 'κ', 'λ', 'μ',
    'ν', 'ξ', 'ο', 'π', 'ρ', 'ς', 'σ', 'τ', 'υ', 'φ', 'χ', 'ψ', 'ω', '∂', 'ϵ', 'ϑ', 'ϰ', 'ϕ', 'ϱ',
    'ϖ',
];

fn greek_index(c: char) -> Option<u32> {
    GREEK.iter().position(|&g| g == c).map(|i| i as u32)
}

/// Whether a character is a Greek letter.
pub fn is_greek(c: char) -> bool {
    matches!(c, 'Α'..='Ω' | 'α'..='ω' | 'ϑ' | 'ϕ' | 'ϖ' | 'ϰ' | 'ϱ' | 'ϵ' | 'ϴ' | 'ϝ')
}

/// A math alphanumeric mapped back to its plain character, style, and
/// alphabet; other characters come back unchanged with no style.
pub fn plain_char(c: char) -> (char, Option<Style>, Option<Alphabet>) {
    let letterlike = match c {
        'ℎ' => Some(('h', Style::Italic, Alphabet::Roman)),
        'ℬ' => Some(('B', Style::Italic, Alphabet::Script)),
        'ℰ' => Some(('E', Style::Italic, Alphabet::Script)),
        'ℱ' => Some(('F', Style::Italic, Alphabet::Script)),
        'ℋ' => Some(('H', Style::Italic, Alphabet::Script)),
        'ℐ' => Some(('I', Style::Italic, Alphabet::Script)),
        'ℒ' => Some(('L', Style::Italic, Alphabet::Script)),
        'ℳ' => Some(('M', Style::Italic, Alphabet::Script)),
        'ℛ' => Some(('R', Style::Italic, Alphabet::Script)),
        'ℯ' => Some(('e', Style::Italic, Alphabet::Script)),
        'ℊ' => Some(('g', Style::Italic, Alphabet::Script)),
        'ℴ' => Some(('o', Style::Italic, Alphabet::Script)),
        'ℭ' => Some(('C', Style::Plain, Alphabet::Fraktur)),
        'ℌ' => Some(('H', Style::Plain, Alphabet::Fraktur)),
        'ℨ' => Some(('Z', Style::Plain, Alphabet::Fraktur)),
        'ℂ' => Some(('C', Style::Plain, Alphabet::DoubleStruck)),
        'ℍ' => Some(('H', Style::Plain, Alphabet::DoubleStruck)),
        'ℕ' => Some(('N', Style::Plain, Alphabet::DoubleStruck)),
        'ℙ' => Some(('P', Style::Plain, Alphabet::DoubleStruck)),
        'ℚ' => Some(('Q', Style::Plain, Alphabet::DoubleStruck)),
        'ℝ' => Some(('R', Style::Plain, Alphabet::DoubleStruck)),
        'ℤ' => Some(('Z', Style::Plain, Alphabet::DoubleStruck)),
        _ => None,
    };
    if let Some((base, style, alphabet)) = letterlike {
        return (base, Some(style), Some(alphabet));
    }
    let u = c as u32;
    if !(0x1D400..=0x1D7FF).contains(&u) {
        return (c, None, None);
    }
    let letter = |start: u32| {
        let i = u - start;
        if i < 26 {
            char::from_u32('A' as u32 + i)
        } else {
            char::from_u32('a' as u32 + i - 26)
        }
    };
    let blocks: &[(u32, Style, Alphabet)] = &[
        (0x1D400, Style::Bold, Alphabet::Roman),
        (0x1D434, Style::Italic, Alphabet::Roman),
        (0x1D468, Style::BoldItalic, Alphabet::Roman),
        (0x1D49C, Style::Italic, Alphabet::Script),
        (0x1D4D0, Style::BoldItalic, Alphabet::Script),
        (0x1D504, Style::Plain, Alphabet::Fraktur),
        (0x1D538, Style::Plain, Alphabet::DoubleStruck),
        (0x1D56C, Style::Bold, Alphabet::Fraktur),
        (0x1D5A0, Style::Plain, Alphabet::SansSerif),
        (0x1D5D4, Style::Bold, Alphabet::SansSerif),
        (0x1D608, Style::Italic, Alphabet::SansSerif),
        (0x1D63C, Style::BoldItalic, Alphabet::SansSerif),
        (0x1D670, Style::Plain, Alphabet::Monospace),
    ];
    for &(start, style, alphabet) in blocks {
        if (start..start + 52).contains(&u)
            && let Some(base) = letter(start)
        {
            return (base, Some(style), Some(alphabet));
        }
    }
    match u {
        0x1D6A4 => return ('ı', Some(Style::Italic), Some(Alphabet::Roman)),
        0x1D6A5 => return ('ȷ', Some(Style::Italic), Some(Alphabet::Roman)),
        _ => {}
    }
    let greek: &[(u32, Style)] = &[
        (0x1D6A8, Style::Bold),
        (0x1D6E2, Style::Italic),
        (0x1D71C, Style::BoldItalic),
    ];
    for &(start, style) in greek {
        if (start..start + 58).contains(&u) {
            return (
                GREEK[(u - start) as usize],
                Some(style),
                Some(Alphabet::Roman),
            );
        }
    }
    let digits: &[(u32, Style, Alphabet)] = &[
        (0x1D7CE, Style::Bold, Alphabet::Roman),
        (0x1D7D8, Style::Plain, Alphabet::DoubleStruck),
        (0x1D7E2, Style::Plain, Alphabet::SansSerif),
        (0x1D7EC, Style::Bold, Alphabet::SansSerif),
        (0x1D7F6, Style::Plain, Alphabet::Monospace),
    ];
    for &(start, style, alphabet) in digits {
        if (start..start + 10).contains(&u) {
            let base = char::from_u32('0' as u32 + u - start).unwrap_or(c);
            return (base, Some(style), Some(alphabet));
        }
    }
    (c, None, None)
}

/// The style a character gets when its run sets none: italic Latin letters
/// and lower-case Greek, upright everything else.
pub fn default_style(c: char) -> Style {
    let italic = c.is_ascii_alphabetic()
        || ('α'..='ω').contains(&c)
        || matches!(c, 'ı' | 'ȷ' | 'ϑ' | 'ϕ' | 'ϖ' | 'ϰ' | 'ϱ' | 'ϵ' | '∂');
    if italic { Style::Italic } else { Style::Plain }
}
