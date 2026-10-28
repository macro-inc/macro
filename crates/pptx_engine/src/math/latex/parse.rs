//! LaTeX-style linear text → [`List`].

use super::super::symbols::{self, ACCENTS, ESCAPES, FUNCTIONS, class_of, command_char, nary_char};
use super::super::tree::{FracKind, LimLoc, List, Node, Run, Style};
use super::LatexError;

mod commands;

#[derive(Clone, Debug, PartialEq)]
enum Tok {
    /// `\name` (letters) or `\x` (one other character).
    Cmd(String),
    Open,
    Close,
    Sup,
    Sub,
    Amp,
    Prime,
    /// Whitespace: ignored in math, kept in `\text{}`.
    Space,
    Char(char),
}

fn tokenize(src: &str) -> Vec<Tok> {
    let chars: Vec<char> = src.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        i += 1;
        match c {
            '\\' => {
                let start = i;
                while i < chars.len() && chars[i].is_ascii_alphabetic() {
                    i += 1;
                }
                if i > start {
                    let mut name: String = chars[start..i].iter().collect();
                    // `\operatorname*` and friends.
                    if i < chars.len() && chars[i] == '*' {
                        name.push('*');
                        i += 1;
                    }
                    out.push(Tok::Cmd(name));
                } else if i < chars.len() {
                    out.push(Tok::Cmd(chars[i].to_string()));
                    i += 1;
                } else {
                    out.push(Tok::Char('\\'));
                }
            }
            '{' => out.push(Tok::Open),
            '}' => out.push(Tok::Close),
            '^' => out.push(Tok::Sup),
            '_' => out.push(Tok::Sub),
            '&' => out.push(Tok::Amp),
            '\'' => out.push(Tok::Prime),
            c if c.is_whitespace() => {
                if out.last() != Some(&Tok::Space) {
                    out.push(Tok::Space);
                }
            }
            '~' => out.push(Tok::Char('\u{a0}')),
            '-' => out.push(Tok::Char('−')),
            '*' => out.push(Tok::Char('∗')),
            c => out.push(Tok::Char(c)),
        }
    }
    out
}

/// What ends a list being parsed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum End {
    /// The end of the input.
    Input,
    /// A closing brace.
    Brace,
    /// `\right`.
    Right,
    /// The end of an environment, a cell (`&`), or a row (`\\`).
    Env,
    /// A closing delimiter character.
    Closer,
}

/// Why a list ended.
#[derive(Clone, Debug, PartialEq)]
enum Stop {
    Input,
    Brace,
    /// `\right` (the delimiter follows).
    Right,
    /// `\middle` (the separator follows).
    Middle,
    Cell,
    Row,
    /// `\end{name}`.
    EndEnv(String),
    /// A closing delimiter.
    Closer(char),
}

const OPENERS: &[(&str, char)] = &[
    ("{", '{'),
    ("lbrace", '{'),
    ("langle", '⟨'),
    ("lfloor", '⌊'),
    ("lceil", '⌈'),
    ("lvert", '|'),
    ("lVert", '‖'),
];
const CLOSERS: &[(&str, char)] = &[
    ("}", '}'),
    ("rbrace", '}'),
    ("rangle", '⟩'),
    ("rfloor", '⌋'),
    ("rceil", '⌉'),
    ("rvert", '|'),
    ("rVert", '‖'),
];

pub(super) struct Parser {
    toks: Vec<Tok>,
    pos: usize,
}

impl Parser {
    pub(super) fn new(src: &str) -> Self {
        Self {
            toks: tokenize(src),
            pos: 0,
        }
    }

    fn skip_spaces(&mut self) {
        while self.toks.get(self.pos) == Some(&Tok::Space) {
            self.pos += 1;
        }
    }

    fn peek(&mut self) -> Option<&Tok> {
        self.skip_spaces();
        self.toks.get(self.pos)
    }

    fn next(&mut self) -> Option<Tok> {
        self.skip_spaces();
        let t = self.toks.get(self.pos).cloned();
        self.pos += 1;
        t
    }

    /// The next token, whitespace included.
    fn next_raw(&mut self) -> Option<Tok> {
        let t = self.toks.get(self.pos).cloned();
        self.pos += 1;
        t
    }

    /// The whole input: lines separated by top-level `\\`.
    pub(super) fn lines(&mut self) -> Result<Vec<List>, LatexError> {
        let mut lines = Vec::new();
        loop {
            let (list, stop) = self.list(End::Input)?;
            lines.push(list);
            match stop {
                Stop::Input => return Ok(lines),
                Stop::Row => {}
                Stop::Cell => {
                    return Err(LatexError::new("`&` is only allowed inside an environment"));
                }
                other => return Err(unexpected(&other)),
            }
        }
    }

    /// Parses items until something ends the list.
    fn list(&mut self, end: End) -> Result<(List, Stop), LatexError> {
        let mut out: List = Vec::new();
        loop {
            let Some(tok) = self.peek().cloned() else {
                return Ok((out, Stop::Input));
            };
            match &tok {
                Tok::Close => {
                    self.pos += 1;
                    return Ok((out, Stop::Brace));
                }
                Tok::Amp => {
                    self.pos += 1;
                    if end == End::Env {
                        return Ok((out, Stop::Cell));
                    }
                    push_char(&mut out, '&');
                    continue;
                }
                Tok::Cmd(name) => match name.as_str() {
                    "\\" | "cr" | "newline" => {
                        self.pos += 1;
                        return Ok((out, Stop::Row));
                    }
                    "right" => {
                        self.pos += 1;
                        return Ok((out, Stop::Right));
                    }
                    "middle" => {
                        self.pos += 1;
                        return Ok((out, Stop::Middle));
                    }
                    "end" => {
                        self.pos += 1;
                        let env = self.env_name()?;
                        return Ok((out, Stop::EndEnv(env)));
                    }
                    "over" | "atop" | "choose" => {
                        self.pos += 1;
                        let (den, stop) = self.list(end)?;
                        let num = std::mem::take(&mut out);
                        let frac = |kind| Node::Frac {
                            kind,
                            num: merge(num),
                            den: merge(den),
                            props: None,
                        };
                        out.push(match name.as_str() {
                            "over" => frac(FracKind::Bar),
                            "atop" => frac(FracKind::NoBar),
                            _ => delim(Some('('), Some(')'), vec![vec![frac(FracKind::NoBar)]]),
                        });
                        return Ok((merge(out), stop));
                    }
                    _ => {}
                },
                Tok::Char(c) if end == End::Closer && is_closer_char(*c) => {
                    self.pos += 1;
                    return Ok((out, Stop::Closer(*c)));
                }
                _ => {}
            }
            if end == End::Closer
                && let Tok::Cmd(name) = &tok
                && let Some(&(_, c)) = CLOSERS.iter().find(|(n, _)| n == name)
            {
                self.pos += 1;
                return Ok((out, Stop::Closer(c)));
            }
            self.item(&mut out, end)?;
        }
    }

    /// Parses one item (with its scripts) onto `out`.
    fn item(&mut self, out: &mut List, end: End) -> Result<(), LatexError> {
        let mut atom = self.atom(out, end)?;
        // An empty group with scripts before an atom: pre-scripts.
        if matches!(&atom, Atom::Group(g) if g.is_empty())
            && matches!(self.peek(), Some(Tok::Sub | Tok::Sup))
        {
            let (sub, sup) = self.scripts()?;
            if self.peek().is_some_and(starts_item) {
                let mut base = Vec::new();
                self.item(&mut base, end)?;
                out.push(Node::PreScripts {
                    base,
                    sub: sub.unwrap_or_default(),
                    sup: sup.unwrap_or_default(),
                });
                return Ok(());
            }
            out.push(Node::Scripts {
                base: Vec::new(),
                sub,
                sup,
            });
            return Ok(());
        }
        if let Atom::Nary(op, limits) = atom {
            let (sub, sup) = self.scripts()?;
            let body = self.operand(false, end)?;
            out.push(Node::Nary {
                op,
                limits,
                grow: false,
                sub,
                sup,
                body,
                props: None,
            });
            return Ok(());
        }
        if let Atom::Func(name, limits) = atom {
            let (sub, sup) = self.scripts()?;
            let mut name = vec![Node::Run(Run {
                style: Some(Style::Plain),
                ..Run::new(name)
            })];
            if limits {
                if let Some(limit) = sub {
                    name = vec![Node::Limit {
                        upper: false,
                        base: name,
                        limit,
                    }];
                }
                if let Some(limit) = sup {
                    name = vec![Node::Limit {
                        upper: true,
                        base: name,
                        limit,
                    }];
                }
            } else if sub.is_some() || sup.is_some() {
                name = vec![Node::Scripts {
                    base: name,
                    sub,
                    sup,
                }];
            }
            let body = self.operand(true, end)?;
            out.push(Node::Func { name, body });
            return Ok(());
        }
        // Over- and underbraces take their label as a limit.
        if let Atom::Node(Node::GroupChr { top, .. }) = &atom {
            let label = match (top, self.peek()) {
                (true, Some(Tok::Sup)) | (false, Some(Tok::Sub)) => {
                    self.pos += 1;
                    Some(self.arg()?)
                }
                _ => None,
            };
            if let Some(limit) = label {
                let top = *top;
                let Atom::Node(base) = atom else {
                    unreachable!("matched above")
                };
                atom = Atom::Node(Node::Limit {
                    upper: top,
                    base: vec![base],
                    limit,
                });
            }
        }
        let (sub, sup) = self.scripts()?;
        let base = atom.into_list();
        if sub.is_none() && sup.is_none() {
            out.extend(base);
        } else {
            out.push(Node::Scripts { base, sub, sup });
        }
        Ok(())
    }

    /// The operand of an n-ary operator or a function: a braced group, or
    /// the items up to the next binary operator, relation, or punctuation
    /// (and, for a function, the next function or large operator).
    fn operand(&mut self, function: bool, end: End) -> Result<List, LatexError> {
        if matches!(self.peek(), Some(Tok::Open)) {
            let save = self.pos;
            self.pos += 1;
            let (group, stop) = self.list(End::Brace)?;
            if stop != Stop::Brace {
                return Err(LatexError::new("missing `}`"));
            }
            // `{...}` followed by scripts is an ordinary item, not the operand.
            if !matches!(self.peek(), Some(Tok::Sub | Tok::Sup | Tok::Prime)) {
                return Ok(merge(group));
            }
            self.pos = save;
        }
        let mut body = Vec::new();
        loop {
            match self.peek() {
                None | Some(Tok::Close | Tok::Amp) => break,
                Some(Tok::Cmd(c))
                    if matches!(
                        c.as_str(),
                        "\\" | "right" | "middle" | "end" | "over" | "atop" | "choose"
                    ) =>
                {
                    break;
                }
                Some(Tok::Cmd(c)) if function && is_operator_command(c) => break,
                Some(Tok::Char(c)) if end == End::Closer && is_closer_char(*c) => break,
                Some(Tok::Cmd(c)) if end == End::Closer && CLOSERS.iter().any(|(n, _)| n == c) => {
                    break;
                }
                _ => {}
            }
            let class = self.peek_class();
            if !body.is_empty()
                && matches!(
                    class,
                    Some(symbols::Class::Bin | symbols::Class::Rel | symbols::Class::Punct)
                )
            {
                break;
            }
            self.item(&mut body, end)?;
        }
        Ok(merge(body))
    }

    /// The spacing class of the next token, if it is a symbol.
    fn peek_class(&mut self) -> Option<symbols::Class> {
        match self.peek()? {
            Tok::Char(c) => Some(class_of(*c)),
            Tok::Cmd(name) => command_char(name).map(class_of),
            _ => None,
        }
    }

    /// Subscript and superscript after an item, in either order, plus primes.
    fn scripts(&mut self) -> Result<(Option<List>, Option<List>), LatexError> {
        let mut sub: Option<List> = None;
        let mut sup: Option<List> = None;
        loop {
            match self.peek() {
                Some(Tok::Sub) if sub.is_none() => {
                    self.pos += 1;
                    sub = Some(self.arg()?);
                }
                Some(Tok::Sup) if sup.is_none() || primes_only(sup.as_ref()) => {
                    self.pos += 1;
                    let arg = self.arg()?;
                    sup.get_or_insert_with(Vec::new).extend(arg);
                }
                Some(Tok::Prime) => {
                    let mut n = 0;
                    while matches!(self.peek(), Some(Tok::Prime)) {
                        self.pos += 1;
                        n += 1;
                    }
                    let prime = match n {
                        1 => "′",
                        2 => "″",
                        3 => "‴",
                        _ => "⁗",
                    };
                    sup.get_or_insert_with(Vec::new)
                        .insert(0, Node::Run(Run::new(prime)));
                }
                Some(Tok::Sub | Tok::Sup) => {
                    return Err(LatexError::new("double subscript or superscript"));
                }
                _ => break,
            }
        }
        Ok((sub.map(merge), sup.map(merge)))
    }

    /// A required argument: a braced group or a single item.
    fn arg(&mut self) -> Result<List, LatexError> {
        match self.peek() {
            Some(Tok::Open) => {
                self.pos += 1;
                let (list, stop) = self.list(End::Brace)?;
                if stop != Stop::Brace {
                    return Err(LatexError::new("missing `}`"));
                }
                Ok(merge(list))
            }
            None | Some(Tok::Close) => Err(LatexError::new("missing argument")),
            Some(Tok::Sub | Tok::Sup) => Err(LatexError::new("missing argument")),
            // `\frac12`: one digit per argument, as in TeX.
            Some(Tok::Char(d)) if d.is_ascii_digit() => {
                let d = *d;
                self.pos += 1;
                Ok(vec![Node::Run(Run::new(d.to_string()))])
            }
            _ => {
                let mut out = Vec::new();
                let atom = self.atom(&mut out, End::Brace)?;
                out.extend(atom.into_list());
                Ok(merge(out))
            }
        }
    }

    /// An optional `[...]` argument.
    fn optional(&mut self) -> Result<Option<List>, LatexError> {
        if self.peek() != Some(&Tok::Char('[')) {
            return Ok(None);
        }
        self.pos += 1;
        let mut out = Vec::new();
        loop {
            match self.peek() {
                None => return Err(LatexError::new("missing `]`")),
                Some(Tok::Char(']')) => {
                    self.pos += 1;
                    return Ok(Some(merge(out)));
                }
                _ => self.item(&mut out, End::Brace)?,
            }
        }
    }

    /// The raw text of a braced argument (for `\text`, environment names).
    fn raw(&mut self) -> Result<String, LatexError> {
        if self.next() != Some(Tok::Open) {
            return Err(LatexError::new("expected `{`"));
        }
        let mut depth = 1;
        let mut s = String::new();
        loop {
            match self.next_raw() {
                None => return Err(LatexError::new("missing `}`")),
                Some(Tok::Open) => {
                    depth += 1;
                    s.push('{');
                }
                Some(Tok::Close) => {
                    depth -= 1;
                    if depth == 0 {
                        return Ok(s);
                    }
                    s.push('}');
                }
                Some(Tok::Cmd(c)) => match ESCAPES.iter().find(|(e, _)| c.starts_with(*e)) {
                    Some(&(_, v)) if c.chars().count() == 1 => s.push(v),
                    _ => {
                        s.push('\\');
                        s.push_str(&c);
                    }
                },
                Some(Tok::Char(c)) => s.push(match c {
                    '−' => '-',
                    '∗' => '*',
                    '\u{a0}' => ' ',
                    c => c,
                }),
                Some(Tok::Sup) => s.push('^'),
                Some(Tok::Sub) => s.push('_'),
                Some(Tok::Amp) => s.push('&'),
                Some(Tok::Prime) => s.push('\''),
                Some(Tok::Space) => s.push(' '),
            }
        }
    }

    fn env_name(&mut self) -> Result<String, LatexError> {
        Ok(self.raw()?.trim().to_owned())
    }

    /// One item before its scripts.
    fn atom(&mut self, out: &mut List, end: End) -> Result<Atom, LatexError> {
        let Some(tok) = self.next() else {
            return Err(LatexError::new("missing argument"));
        };
        match tok {
            Tok::Open => {
                let (list, stop) = self.list(End::Brace)?;
                if stop != Stop::Brace {
                    return Err(LatexError::new("missing `}`"));
                }
                Ok(Atom::Group(merge(list)))
            }
            Tok::Close => Err(LatexError::new("unexpected `}`")),
            Tok::Sup | Tok::Sub => {
                // A script with no base: attach to nothing.
                self.pos -= 1;
                Ok(Atom::Group(Vec::new()))
            }
            Tok::Amp => Ok(Atom::char('&')),
            Tok::Prime => Ok(Atom::char('′')),
            Tok::Space => Ok(Atom::Group(Vec::new())),
            Tok::Char(c) if c.is_ascii_digit() => {
                let mut s = c.to_string();
                loop {
                    let here = self.toks.get(self.pos).cloned();
                    let after = self.toks.get(self.pos + 1).cloned();
                    match (here, after) {
                        (Some(Tok::Char(d)), _) if d.is_ascii_digit() => {
                            s.push(d);
                            self.pos += 1;
                        }
                        (Some(Tok::Char('.')), Some(Tok::Char(d))) if d.is_ascii_digit() => {
                            s.push('.');
                            self.pos += 1;
                        }
                        _ => break,
                    }
                }
                Ok(Atom::Node(Node::Run(Run::new(s))))
            }
            Tok::Char(c) if is_opener_char(c) => self.delimited(c, out, end),
            Tok::Char(c) => Ok(Atom::char(c)),
            Tok::Cmd(name) => self.command(&name, out, end),
        }
    }

    /// An opening delimiter: the items up to a closing one become a growing
    /// delimiter pair; without one, the opener is an ordinary character.
    fn delimited(&mut self, open: char, out: &mut List, end: End) -> Result<Atom, LatexError> {
        let save = self.pos;
        let (inner, stop) = self.list(End::Closer)?;
        if let Stop::Closer(close) = stop {
            return Ok(Atom::Node(delim(
                Some(open),
                Some(close),
                vec![merge(inner)],
            )));
        }
        // No closer: reparse the rest as ordinary items.
        self.pos = save;
        let _ = (out, end);
        Ok(Atom::char(open))
    }
}

/// An item before scripts are attached.
enum Atom {
    Node(Node),
    /// A braced group (its items, spliced in when it has no scripts).
    Group(List),
    /// An n-ary operator waiting for its limits and operand.
    Nary(char, LimLoc),
    /// A function name waiting for its scripts and argument; `true` when
    /// its subscript goes under it.
    Func(String, bool),
}

impl Atom {
    fn char(c: char) -> Self {
        Atom::Node(Node::Run(Run::new(c.to_string())))
    }

    fn into_list(self) -> List {
        match self {
            Atom::Node(n) => vec![n],
            Atom::Group(list) => list,
            Atom::Nary(c, _) => vec![Node::Run(Run::new(c.to_string()))],
            Atom::Func(name, _) => vec![Node::Run(Run {
                style: Some(Style::Plain),
                ..Run::new(name)
            })],
        }
    }
}

/// Whether a token can start an item (rather than end a list).
fn starts_item(tok: &Tok) -> bool {
    match tok {
        Tok::Close | Tok::Amp | Tok::Space => false,
        Tok::Cmd(c) => !matches!(
            c.as_str(),
            "\\" | "right" | "middle" | "end" | "over" | "atop" | "choose"
        ),
        _ => true,
    }
}

fn unexpected(stop: &Stop) -> LatexError {
    LatexError::new(match stop {
        Stop::Brace => "unexpected `}`".to_owned(),
        Stop::Right => "`\\right` without `\\left`".to_owned(),
        Stop::Middle => "`\\middle` outside `\\left`…`\\right`".to_owned(),
        Stop::EndEnv(e) => format!("`\\end{{{e}}}` without `\\begin{{{e}}}`"),
        Stop::Closer(c) => format!("unexpected `{c}`"),
        Stop::Input | Stop::Cell | Stop::Row => "unexpected end".to_owned(),
    })
}

fn is_opener_char(c: char) -> bool {
    matches!(c, '(' | '[' | '⟨' | '⌊' | '⌈')
}

fn is_closer_char(c: char) -> bool {
    matches!(c, ')' | ']' | '⟩' | '⌋' | '⌉')
}

/// A function or large operator command (ends a function's argument).
fn is_operator_command(name: &str) -> bool {
    FUNCTIONS.contains(&name) || nary_char(name).is_some() || name.starts_with("operatorname")
}

/// The delimiter a command names (`\{`, `\langle`, `\vert`...).
fn delimiter_command(name: &str) -> Option<char> {
    match name {
        "{" | "lbrace" => Some('{'),
        "}" | "rbrace" => Some('}'),
        "|" | "Vert" | "lVert" | "rVert" => Some('‖'),
        "vert" | "lvert" | "rvert" | "mid" => Some('|'),
        "langle" => Some('⟨'),
        "rangle" => Some('⟩'),
        "lfloor" => Some('⌊'),
        "rfloor" => Some('⌋'),
        "lceil" => Some('⌈'),
        "rceil" => Some('⌉'),
        "backslash" => Some('\\'),
        "uparrow" => Some('↑'),
        "downarrow" => Some('↓'),
        "updownarrow" => Some('↕'),
        "Uparrow" => Some('⇑'),
        "Downarrow" => Some('⇓'),
        "lbrack" => Some('['),
        "rbrack" => Some(']'),
        _ => None,
    }
}

fn delim(open: Option<char>, close: Option<char>, items: Vec<List>) -> Node {
    Node::Delim {
        open,
        close,
        sep: '|',
        grow: true,
        items,
        props: None,
    }
}

fn push_char(out: &mut List, c: char) {
    out.push(Node::Run(Run::new(c.to_string())));
}

/// Whether a superscript so far is only primes (`f'^2` adds to it).
fn primes_only(sup: Option<&List>) -> bool {
    sup.is_some_and(|s| {
        s.iter()
            .all(|n| matches!(n, Node::Run(r) if r.text.chars().all(|c| matches!(c, '′' | '″' | '‴' | '⁗'))))
    })
}

/// Merges adjacent runs of the same style.
pub(super) fn merge(list: List) -> List {
    let mut out: List = Vec::with_capacity(list.len());
    for node in list {
        if let Node::Run(r) = &node
            && let Some(Node::Run(last)) = out.last_mut()
            && last.same_style(r)
            && !r.normal
        {
            last.text.push_str(&r.text);
            continue;
        }
        out.push(node);
    }
    out
}

/// Accent commands, for the writer.
pub(super) fn accent_commands() -> &'static [(&'static str, char)] {
    ACCENTS
}
