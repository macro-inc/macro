//! Commands with arguments: fractions, radicals, large operators,
//! `\left`/`\right`, styles, accents, and environments.

use super::super::super::symbols::{
    self, ESCAPES, FUNCTIONS, GROUP_CHARS, accent_char, command_char, nary_char, takes_limits,
};
use super::super::super::tree::{Alphabet, Borders, FracKind, LimLoc, List, Node, Run, Style};
use super::super::LatexError;
use super::{Atom, End, OPENERS, Parser, Stop, Tok, delim, delimiter_command, merge, push_char};

/// The sizing commands `\big(` and friends: the delimiter is kept as is.
const SIZES: &[&str] = &[
    "big", "Big", "bigg", "Bigg", "bigl", "Bigl", "biggl", "Biggl", "bigr", "Bigr", "biggr",
    "Biggr", "bigm", "Bigm", "biggm", "Biggm",
];

/// Commands that only change sizes or spacing, which are dropped.
const IGNORED: &[&str] = &[
    "displaystyle",
    "textstyle",
    "scriptstyle",
    "scriptscriptstyle",
    "limits",
    "nolimits",
    "nonumber",
    "notag",
    "!",
    "allowbreak",
];

impl Parser {
    pub(super) fn command(
        &mut self,
        name: &str,
        out: &mut List,
        end: End,
    ) -> Result<Atom, LatexError> {
        if let Some(c) = nary_char(name) {
            // An explicit placement that is the operator's default is `Auto`.
            let integral = symbols::is_integral(c);
            let limits = match self.peek() {
                Some(Tok::Cmd(m)) if m == "limits" => {
                    self.pos += 1;
                    if integral {
                        LimLoc::UnderOver
                    } else {
                        LimLoc::Auto
                    }
                }
                Some(Tok::Cmd(m)) if m == "nolimits" => {
                    self.pos += 1;
                    if integral {
                        LimLoc::Auto
                    } else {
                        LimLoc::SubSup
                    }
                }
                _ => LimLoc::Auto,
            };
            return Ok(Atom::Nary(c, limits));
        }
        if FUNCTIONS.contains(&name) {
            return Ok(Atom::Func(name.to_owned(), takes_limits(name)));
        }
        if let Some(&(_, c)) = OPENERS.iter().find(|(n, _)| *n == name) {
            return self.delimited(c, out, end);
        }
        if let Some(c) = command_char(name) {
            return Ok(Atom::char(c));
        }
        if let Some(&(_, c)) = ESCAPES
            .iter()
            .find(|(e, _)| name.chars().eq(std::iter::once(*e)))
        {
            return Ok(Atom::char(c));
        }
        if let Some(c) = accent_char(name) {
            let base = self.arg()?;
            return Ok(Atom::Node(Node::Accent {
                chr: c,
                base,
                props: None,
            }));
        }
        if let Some(&(_, c, top)) = GROUP_CHARS.iter().find(|(n, _, _)| *n == name) {
            let base = self.arg()?;
            return Ok(Atom::Node(Node::GroupChr {
                chr: c,
                top,
                base,
                props: None,
            }));
        }
        if SIZES.contains(&name) {
            return match self.next() {
                Some(Tok::Char(c)) => Ok(Atom::char(c)),
                Some(Tok::Cmd(d)) => {
                    let c = delimiter_command(&d)
                        .ok_or_else(|| LatexError::new(format!("`\\{name}` needs a delimiter")))?;
                    Ok(Atom::char(c))
                }
                _ => Err(LatexError::new(format!("`\\{name}` needs a delimiter"))),
            };
        }
        if IGNORED.contains(&name) {
            return Ok(Atom::Group(Vec::new()));
        }
        let node = match name {
            "frac" | "dfrac" | "tfrac" | "cfrac" | "sfrac" | "lfrac" => {
                let num = self.arg()?;
                let den = self.arg()?;
                Node::Frac {
                    kind: match name {
                        "sfrac" => FracKind::Skewed,
                        "lfrac" => FracKind::Linear,
                        _ => FracKind::Bar,
                    },
                    num,
                    den,
                    props: None,
                }
            }
            "binom" | "dbinom" | "tbinom" => {
                let num = self.arg()?;
                let den = self.arg()?;
                delim(
                    Some('('),
                    Some(')'),
                    vec![vec![Node::Frac {
                        kind: FracKind::NoBar,
                        num,
                        den,
                        props: None,
                    }]],
                )
            }
            "genfrac" => {
                let open = self.raw()?;
                let close = self.raw()?;
                let thickness = self.raw()?;
                let _style = self.raw()?;
                let num = self.arg()?;
                let den = self.arg()?;
                let no_bar = thickness
                    .trim()
                    .trim_end_matches(|c: char| c.is_ascii_alphabetic())
                    .parse::<f32>()
                    .is_ok_and(|t| t == 0.0);
                let frac = Node::Frac {
                    kind: if no_bar {
                        FracKind::NoBar
                    } else {
                        FracKind::Bar
                    },
                    num,
                    den,
                    props: None,
                };
                let (o, c) = (raw_delimiter(&open), raw_delimiter(&close));
                if o.is_none() && c.is_none() {
                    frac
                } else {
                    delim(o, c, vec![vec![frac]])
                }
            }
            "sqrt" => {
                let degree = self.optional()?;
                let body = self.arg()?;
                Node::Radical {
                    degree,
                    body,
                    props: None,
                }
            }
            "left" => return self.left_right().map(Atom::Node),
            "operatorname" | "operatorname*" => {
                let text = self.raw()?;
                return Ok(Atom::Func(text, name.ends_with('*')));
            }
            "mathrm" | "mathbf" | "mathit" | "boldsymbol" | "bm" | "mathbb" | "mathcal"
            | "mathscr" | "mathfrak" | "mathsf" | "mathtt" | "mathnormal" => {
                let mut list = self.arg()?;
                let (style, alphabet) = match name {
                    "mathrm" => (Some(Style::Plain), None),
                    "mathbf" => (Some(Style::Bold), None),
                    "mathit" => (Some(Style::Italic), None),
                    "boldsymbol" | "bm" => (Some(Style::BoldItalic), None),
                    "mathbb" => (None, Some(Alphabet::DoubleStruck)),
                    "mathcal" | "mathscr" => (None, Some(Alphabet::Script)),
                    "mathfrak" => (None, Some(Alphabet::Fraktur)),
                    "mathsf" => (None, Some(Alphabet::SansSerif)),
                    "mathtt" => (None, Some(Alphabet::Monospace)),
                    _ => (None, None),
                };
                restyle(&mut list, style, alphabet);
                return Ok(Atom::Group(list));
            }
            "text" | "textrm" | "mbox" | "textnormal" | "mathord" => {
                let text = self.raw()?;
                Node::Run(Run {
                    normal: true,
                    ..Run::new(text)
                })
            }
            "textbf" | "textit" => {
                let text = self.raw()?;
                Node::Run(Run {
                    normal: true,
                    style: Some(if name == "textbf" {
                        Style::Bold
                    } else {
                        Style::Italic
                    }),
                    ..Run::new(text)
                })
            }
            "overline" | "underline" => {
                let base = self.arg()?;
                Node::Bar {
                    top: name == "overline",
                    base,
                    props: None,
                }
            }
            "overset" | "underset" | "stackrel" => {
                let limit = self.arg()?;
                let base = self.arg()?;
                Node::Limit {
                    upper: name != "underset",
                    base,
                    limit,
                }
            }
            "boxed" | "cancel" | "bcancel" | "xcancel" => {
                let base = self.arg()?;
                let hide = name != "boxed";
                Node::BorderBox {
                    borders: Borders {
                        hide_top: hide,
                        hide_bottom: hide,
                        hide_left: hide,
                        hide_right: hide,
                        strike_bltr: matches!(name, "cancel" | "xcancel"),
                        strike_tlbr: matches!(name, "bcancel" | "xcancel"),
                        ..Borders::default()
                    },
                    base,
                    props: None,
                }
            }
            "phantom" | "hphantom" | "vphantom" => {
                let base = self.arg()?;
                Node::Phantom {
                    show: false,
                    zero_width: name == "vphantom",
                    zero_ascent: name == "hphantom",
                    zero_descent: name == "hphantom",
                    base,
                }
            }
            "prescript" => {
                let sup = self.arg()?;
                let sub = self.arg()?;
                let base = self.arg()?;
                Node::PreScripts { base, sub, sup }
            }
            "qquad" => Node::Run(Run::new("\u{2003}\u{2003}")),
            "begin" => return self.environment().map(Atom::Node),
            "color" | "textcolor" => {
                // Colors are not kept: drop the color, keep the content.
                let _ = self.raw()?;
                return Ok(Atom::Group(Vec::new()));
            }
            _ => {
                return Err(LatexError::new(format!("unknown command `\\{name}`")));
            }
        };
        Ok(Atom::Node(node))
    }

    /// `\left( ... \middle| ... \right)`.
    fn left_right(&mut self) -> Result<Node, LatexError> {
        let open = self.delimiter_token()?;
        let mut items = Vec::new();
        let mut sep = '|';
        loop {
            let (list, stop) = self.list(End::Right)?;
            items.push(merge(list));
            match stop {
                Stop::Right => {
                    let close = self.delimiter_token()?;
                    return Ok(Node::Delim {
                        open,
                        close,
                        sep,
                        grow: true,
                        items,
                        props: None,
                    });
                }
                Stop::Middle => {
                    sep = self.delimiter_token()?.unwrap_or('|');
                }
                _ => return Err(LatexError::new("`\\left` without `\\right`")),
            }
        }
    }

    /// The delimiter after `\left`, `\right`, or `\middle` (`.` is none).
    fn delimiter_token(&mut self) -> Result<Option<char>, LatexError> {
        match self.next() {
            Some(Tok::Char('.')) => Ok(None),
            Some(Tok::Char(c)) => Ok(Some(c)),
            Some(Tok::Cmd(name)) => delimiter_command(&name)
                .map(Some)
                .ok_or_else(|| LatexError::new(format!("`\\{name}` is not a delimiter"))),
            _ => Err(LatexError::new("missing delimiter")),
        }
    }

    /// `\begin{name} ... \end{name}`.
    fn environment(&mut self) -> Result<Node, LatexError> {
        let name = self.env_name()?;
        if name == "array" {
            // Column specification: not kept.
            let _ = self.raw()?;
        }
        let mut rows: Vec<Vec<List>> = Vec::new();
        let mut row: Vec<List> = Vec::new();
        loop {
            let (cell, stop) = self.list(End::Env)?;
            row.push(merge(cell));
            match stop {
                Stop::Cell => {}
                Stop::Row => rows.push(std::mem::take(&mut row)),
                Stop::EndEnv(e) if e == name => {
                    if !(row.len() == 1 && row[0].is_empty()) || rows.is_empty() {
                        rows.push(row);
                    }
                    break;
                }
                Stop::EndEnv(e) => {
                    return Err(LatexError::new(format!(
                        "`\\begin{{{name}}}` ended by `\\end{{{e}}}`"
                    )));
                }
                _ => return Err(LatexError::new(format!("missing `\\end{{{name}}}`"))),
            }
        }
        // Equation arrays keep `&` as alignment marks inside each row.
        // Cases separate the value from its condition by a quad.
        let gap = name == "cases";
        let eq_rows = |rows: Vec<Vec<List>>| -> Vec<List> {
            rows.into_iter()
                .map(|cells| {
                    let mut out = Vec::new();
                    for (i, cell) in cells.into_iter().enumerate() {
                        if i > 0 {
                            push_char(&mut out, '&');
                            if gap {
                                push_char(&mut out, '\u{2003}');
                            }
                        }
                        out.extend(cell);
                    }
                    merge(out)
                })
                .collect()
        };
        let node = match name.as_str() {
            "matrix" | "smallmatrix" | "array" => Node::Matrix(rows),
            "pmatrix" => delim(Some('('), Some(')'), vec![vec![Node::Matrix(rows)]]),
            "bmatrix" => delim(Some('['), Some(']'), vec![vec![Node::Matrix(rows)]]),
            "Bmatrix" => delim(Some('{'), Some('}'), vec![vec![Node::Matrix(rows)]]),
            "vmatrix" => delim(Some('|'), Some('|'), vec![vec![Node::Matrix(rows)]]),
            "Vmatrix" => delim(Some('‖'), Some('‖'), vec![vec![Node::Matrix(rows)]]),
            "cases" => delim(Some('{'), None, vec![vec![Node::EqArray(eq_rows(rows))]]),
            "aligned" | "align" | "align*" | "eqnarray" | "eqnarray*" | "gathered" | "gather"
            | "gather*" | "split" | "alignedat" => Node::EqArray(eq_rows(rows)),
            other => {
                return Err(LatexError::new(format!("unknown environment `{other}`")));
            }
        };
        Ok(node)
    }
}

/// A `\genfrac` delimiter argument (`(`, `\{`, or empty).
fn raw_delimiter(s: &str) -> Option<char> {
    let s = s.trim();
    match s.strip_prefix('\\') {
        Some(cmd) => delimiter_command(cmd),
        None => s.chars().next(),
    }
}

/// Gives the runs of a list (and of the structures in it) a style.
fn restyle(list: &mut List, style: Option<Style>, alphabet: Option<Alphabet>) {
    for node in list {
        match node {
            Node::Run(r) if !r.normal => {
                if style.is_some() {
                    r.style = style;
                }
                if alphabet.is_some() {
                    r.alphabet = alphabet;
                }
            }
            Node::Scripts { base, .. }
            | Node::Accent { base, .. }
            | Node::Bar { base, .. }
            | Node::Group(base) => restyle(base, style, alphabet),
            _ => {}
        }
    }
}
