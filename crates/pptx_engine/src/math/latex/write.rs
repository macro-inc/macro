//! [`List`] → LaTeX-style linear text.

use super::super::symbols::{
    FUNCTIONS, GROUP_CHARS, accent_command, char_command, class_of, default_style, is_integral,
    nary_command,
};
use super::super::tree::{Alphabet, FracKind, LimLoc, List, Node, Run, Style};
use super::parse::accent_commands;

/// Writes items as LaTeX. `align` keeps `&` as an alignment mark (inside
/// equation arrays) instead of escaping it.
pub(super) fn write_list(list: &[Node], out: &mut Out, align: bool) {
    for (i, node) in list.iter().enumerate() {
        write_node(node, &list[i + 1..], out, align);
    }
}

/// Output with command-boundary tracking: a command name followed by a
/// letter needs a space between them.
#[derive(Default)]
pub(super) struct Out {
    pub(super) s: String,
    /// The output ends with a command name (`\alpha`).
    after_command: bool,
}

impl Out {
    fn cmd(&mut self, name: &str) {
        self.raw("\\");
        self.s.push_str(name);
        self.after_command = name.chars().all(|c| c.is_ascii_alphabetic());
    }

    fn raw(&mut self, text: &str) {
        if self.after_command && text.starts_with(|c: char| c.is_ascii_alphabetic()) {
            self.s.push(' ');
        }
        self.s.push_str(text);
        self.after_command = false;
    }

    fn group(&mut self, list: &[Node], align: bool) {
        self.raw("{");
        write_list(list, self, align);
        self.raw("}");
    }
}

/// An argument: braced unless it is a single character.
fn arg(out: &mut Out, list: &[Node]) {
    if let [Node::Run(r)] = list
        && r.style.is_none()
        && r.alphabet.is_none()
        && !r.normal
        && r.text.chars().count() == 1
        && r.text.chars().all(|c| c.is_ascii_alphanumeric())
    {
        out.raw(&r.text);
        // `x^k a`, not `x^ka`.
        out.after_command = true;
        return;
    }
    out.group(list, false);
}

fn write_node(node: &Node, rest: &[Node], out: &mut Out, align: bool) {
    match node {
        Node::Run(r) => write_run(r, out, align),
        Node::Frac { kind, num, den, .. } => {
            match kind {
                FracKind::Bar => out.cmd("frac"),
                FracKind::Skewed => out.cmd("sfrac"),
                FracKind::Linear => out.cmd("lfrac"),
                FracKind::NoBar => {
                    out.cmd("genfrac");
                    out.raw("{}{}{0pt}{}");
                }
            }
            out.group(num, false);
            out.group(den, false);
        }
        Node::Scripts { base, sub, sup } => {
            if base.is_empty() {
                out.raw("{}");
            } else if needs_group(base) {
                out.group(base, false);
            } else {
                write_list(base, out, false);
            }
            write_scripts(out, sub.as_deref(), sup.as_deref());
        }
        Node::PreScripts { base, sub, sup } => {
            out.raw("{}");
            out.raw("_");
            out.group(sub, false);
            out.raw("^");
            out.group(sup, false);
            if needs_group(base) {
                out.group(base, false);
            } else {
                write_list(base, out, false);
            }
        }
        Node::Radical { degree, body, .. } => {
            out.cmd("sqrt");
            if let Some(d) = degree {
                out.raw("[");
                write_list(d, out, false);
                out.raw("]");
            }
            out.group(body, false);
        }
        Node::Nary {
            op,
            limits,
            sub,
            sup,
            body,
            ..
        } => {
            match nary_command(*op) {
                Some(name) => out.cmd(name),
                None => out.raw(&op.to_string()),
            }
            let default_under = !is_integral(*op);
            match limits {
                LimLoc::UnderOver if !default_under => out.cmd("limits"),
                LimLoc::SubSup if default_under => out.cmd("nolimits"),
                _ => {}
            }
            write_scripts(out, sub.as_deref(), sup.as_deref());
            write_operand(out, body, rest, false);
        }
        Node::Delim {
            open,
            close,
            sep,
            items,
            ..
        } => write_delim(out, *open, *close, *sep, items),
        Node::Func { name, body } => {
            write_function_name(out, name);
            write_operand(out, body, rest, true);
        }
        Node::Limit { upper, base, limit } => {
            if let [
                Node::GroupChr {
                    chr, top, base: b, ..
                },
            ] = base.as_slice()
                && top == upper
                && let Some(&(name, _, _)) = GROUP_CHARS.iter().find(|(_, c, _)| c == chr)
            {
                out.cmd(name);
                out.group(b, false);
                out.raw(if *upper { "^" } else { "_" });
                out.group(limit, false);
                return;
            }
            out.cmd(if *upper { "overset" } else { "underset" });
            out.group(limit, false);
            out.group(base, false);
        }
        Node::Accent { chr, base, .. } => {
            match accent_command(*chr) {
                Some(name) => out.cmd(name),
                // An accent without a command: the closest one.
                None => out.cmd(accent_commands()[0].0),
            }
            out.group(base, false);
        }
        Node::Bar { top, base, .. } => {
            out.cmd(if *top { "overline" } else { "underline" });
            out.group(base, false);
        }
        Node::GroupChr { chr, top, base, .. } => {
            let name = GROUP_CHARS
                .iter()
                .find(|(_, c, _)| c == chr)
                .map(|(n, _, _)| *n)
                .unwrap_or(if *top { "overbrace" } else { "underbrace" });
            out.cmd(name);
            out.group(base, false);
        }
        Node::BorderBox { borders, base, .. } => {
            let hidden =
                borders.hide_top && borders.hide_bottom && borders.hide_left && borders.hide_right;
            let name = match (borders.strike_bltr, borders.strike_tlbr) {
                (true, true) if hidden => "xcancel",
                (true, false) if hidden => "cancel",
                (false, true) if hidden => "bcancel",
                _ => "boxed",
            };
            out.cmd(name);
            out.group(base, false);
        }
        Node::Group(base) => out.group(base, false),
        Node::EqArray(rows) => {
            out.cmd("begin");
            out.raw("{aligned}");
            write_rows(out, rows.iter().map(|r| vec![r.clone()]).collect(), true);
            out.cmd("end");
            out.raw("{aligned}");
        }
        Node::Matrix(rows) => write_matrix(out, "matrix", rows),
        Node::Phantom {
            show,
            zero_width,
            zero_ascent,
            zero_descent,
            base,
        } => {
            let name = match (*show, *zero_width, *zero_ascent && *zero_descent) {
                (false, true, _) => "vphantom",
                (false, _, true) => "hphantom",
                _ => "phantom",
            };
            out.cmd(name);
            out.group(base, false);
        }
    }
}

fn write_scripts(out: &mut Out, sub: Option<&[Node]>, sup: Option<&[Node]>) {
    if let Some(s) = sub {
        out.raw("_");
        arg(out, s);
    }
    if let Some(s) = sup {
        // Primes are written as `'`.
        let primes: usize = s
            .iter()
            .map_while(|n| match n {
                Node::Run(r) if r.style.is_none() && !r.normal => {
                    let mut count = 0;
                    for c in r.text.chars() {
                        count += match c {
                            '′' => 1,
                            '″' => 2,
                            '‴' => 3,
                            '⁗' => 4,
                            _ => return None,
                        };
                    }
                    Some(count)
                }
                _ => None,
            })
            .sum();
        let prime_nodes = s
            .iter()
            .take_while(|n| matches!(n, Node::Run(r) if r.text.chars().all(|c| matches!(c, '′' | '″' | '‴' | '⁗'))))
            .count();
        if primes > 0 {
            out.raw(&"'".repeat(primes));
        }
        let rest = &s[prime_nodes..];
        if !rest.is_empty() || primes == 0 {
            out.raw("^");
            arg(out, rest);
        }
    }
}

/// Whether a script base needs braces (more than one item, or an item
/// whose scripts would bind to something else).
fn needs_group(base: &[Node]) -> bool {
    match base {
        [Node::Run(r)] => {
            r.normal
                || r.style.is_some()
                || r.alphabet.is_some()
                || !(r.text.chars().count() == 1
                    || r.text.chars().all(|c| c.is_ascii_digit() || c == '.'))
        }
        [
            Node::Delim { .. }
            | Node::Frac { .. }
            | Node::Radical { .. }
            | Node::Accent { .. }
            | Node::Bar { .. },
        ] => false,
        _ => true,
    }
}

/// The operand of an n-ary operator or function: braced when the parser
/// would otherwise take more or less than it.
fn write_operand(out: &mut Out, body: &[Node], rest: &[Node], function: bool) {
    let stops = |n: &Node| match n {
        Node::Run(r) => r
            .text
            .chars()
            .next()
            .is_some_and(|c| !r.normal && is_stop(c)),
        Node::Func { .. } | Node::Nary { .. } => function,
        _ => false,
    };
    let inner_stop = body.iter().enumerate().any(|(i, n)| {
        i > 0 && stops(n)
            || matches!(n, Node::Run(r) if !r.normal && r.text.chars().skip(usize::from(i == 0)).any(is_stop))
    });
    let follows = rest.first().is_some_and(|n| !stops(n));
    // A braced group with scripts after it is not read as the operand.
    let starts_group = matches!(body.first(), Some(Node::Group(_)));
    if body.is_empty() || inner_stop || follows || starts_group {
        out.group(body, false);
    } else {
        write_list(body, out, false);
    }
}

fn is_stop(c: char) -> bool {
    use super::super::symbols::Class;
    matches!(class_of(c), Class::Bin | Class::Rel | Class::Punct)
}

fn write_function_name(out: &mut Out, name: &[Node]) {
    match name {
        [Node::Run(r)] if FUNCTIONS.contains(&r.text.as_str()) => out.cmd(&r.text),
        [Node::Run(r)] => {
            out.cmd("operatorname");
            out.raw("{");
            out.raw(&escape_text(&r.text));
            out.raw("}");
        }
        [Node::Scripts { base, sub, sup }] if matches!(base.as_slice(), [Node::Run(_)]) => {
            write_function_name(out, base);
            write_scripts(out, sub.as_deref(), sup.as_deref());
        }
        [Node::Limit { upper, base, limit }] => {
            write_function_name(out, base);
            out.raw(if *upper { "^" } else { "_" });
            arg(out, limit);
        }
        other => {
            out.cmd("operatorname");
            out.group(other, false);
        }
    }
}

fn delimiter(c: Option<char>) -> String {
    match c {
        None => ".".to_owned(),
        Some('{') => "\\{".to_owned(),
        Some('}') => "\\}".to_owned(),
        Some('‖') => "\\|".to_owned(),
        Some('⟨') => "\\langle ".to_owned(),
        Some('⟩') => "\\rangle ".to_owned(),
        Some('⌊') => "\\lfloor ".to_owned(),
        Some('⌋') => "\\rfloor ".to_owned(),
        Some('⌈') => "\\lceil ".to_owned(),
        Some('⌉') => "\\rceil ".to_owned(),
        Some('\\') => "\\backslash ".to_owned(),
        Some(c) => c.to_string(),
    }
}

fn write_delim(out: &mut Out, open: Option<char>, close: Option<char>, sep: char, items: &[List]) {
    // Matrices in brackets are the bracketed matrix environments.
    if let [item] = items
        && let [Node::Matrix(rows)] = item.as_slice()
    {
        let env = match (open, close) {
            (Some('('), Some(')')) => Some("pmatrix"),
            (Some('['), Some(']')) => Some("bmatrix"),
            (Some('{'), Some('}')) => Some("Bmatrix"),
            (Some('|'), Some('|')) => Some("vmatrix"),
            (Some('‖'), Some('‖')) => Some("Vmatrix"),
            _ => None,
        };
        if let Some(env) = env {
            write_matrix(out, env, rows);
            return;
        }
    }
    if let [item] = items
        && let [Node::EqArray(rows)] = item.as_slice()
        && open == Some('{')
        && close.is_none()
    {
        out.cmd("begin");
        out.raw("{cases}");
        let rows = rows.iter().map(|r| vec![strip_case_gaps(r)]).collect();
        write_rows(out, rows, true);
        out.cmd("end");
        out.raw("{cases}");
        return;
    }
    if let [item] = items
        && let [
            Node::Frac {
                kind: FracKind::NoBar,
                num,
                den,
                ..
            },
        ] = item.as_slice()
        && open == Some('(')
        && close == Some(')')
    {
        out.cmd("binom");
        out.group(num, false);
        out.group(den, false);
        return;
    }
    // Plain brackets pair up again when read back.
    let plain = |c: Option<char>, opening: bool| match c {
        Some('(' | '[') if opening => Some(c.map(String::from).unwrap_or_default()),
        Some(')' | ']') if !opening => Some(c.map(String::from).unwrap_or_default()),
        Some('{') if opening => Some("\\{".to_owned()),
        Some('}') if !opening => Some("\\}".to_owned()),
        Some('⟨') if opening => Some("\\langle ".to_owned()),
        Some('⟩') if !opening => Some("\\rangle ".to_owned()),
        Some('⌊') if opening => Some("\\lfloor ".to_owned()),
        Some('⌋') if !opening => Some("\\rfloor ".to_owned()),
        Some('⌈') if opening => Some("\\lceil ".to_owned()),
        Some('⌉') if !opening => Some("\\rceil ".to_owned()),
        _ => None,
    };
    if items.len() == 1
        && let (Some(o), Some(c)) = (plain(open, true), plain(close, false))
        && !contains_closer(&items[0])
    {
        out.raw(o.trim_end());
        if o.ends_with(' ') {
            out.after_command = true;
        }
        write_list(&items[0], out, false);
        out.raw(c.trim_end());
        if c.ends_with(' ') {
            out.after_command = true;
        }
        return;
    }
    out.cmd("left");
    out.raw(delimiter(open).trim_end());
    out.after_command = delimiter(open).ends_with(' ');
    for (i, item) in items.iter().enumerate() {
        if i > 0 {
            out.cmd("middle");
            out.raw(delimiter(Some(sep)).trim_end());
            out.after_command = delimiter(Some(sep)).ends_with(' ');
        }
        write_list(item, out, false);
    }
    out.cmd("right");
    out.raw(delimiter(close).trim_end());
    out.after_command = delimiter(close).ends_with(' ');
}

/// A `cases` row without the quad the parser puts after each `&`.
fn strip_case_gaps(row: &List) -> List {
    let mut out = row.clone();
    for node in &mut out {
        if let Node::Run(r) = node
            && !r.normal
        {
            r.text = r.text.replace("&\u{2003}", "&");
        }
    }
    // A gap at the start of the run after a mark.
    let mut prev_mark = false;
    for node in &mut out {
        if let Node::Run(r) = node {
            if prev_mark && r.text.starts_with('\u{2003}') {
                r.text.remove(0);
            }
            prev_mark = r.text.ends_with('&');
        } else {
            prev_mark = false;
        }
    }
    out.retain(|n| !matches!(n, Node::Run(r) if r.text.is_empty()));
    out
}

/// Whether items hold a bare bracket (which would pair up differently when
/// read back inside a plain pair).
fn contains_closer(list: &[Node]) -> bool {
    list.iter().any(|n| {
        matches!(n, Node::Run(r) if !r.normal && r.text.chars().any(|c| matches!(c, '(' | '[' | ')' | ']' | '⟨' | '⟩' | '⌊' | '⌋' | '⌈' | '⌉')))
    })
}

fn write_matrix(out: &mut Out, env: &str, rows: &[Vec<List>]) {
    out.cmd("begin");
    out.raw(&format!("{{{env}}}"));
    write_rows(out, rows.to_vec(), false);
    out.cmd("end");
    out.raw(&format!("{{{env}}}"));
}

fn write_rows(out: &mut Out, rows: Vec<Vec<List>>, align: bool) {
    for (r, row) in rows.iter().enumerate() {
        if r > 0 {
            out.raw(" \\\\ ");
        }
        for (c, cell) in row.iter().enumerate() {
            if c > 0 {
                out.raw(" & ");
            }
            write_list(cell, out, align);
        }
    }
}

fn escape_text(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        match c {
            '{' | '}' | '%' | '#' | '&' | '$' | '_' => {
                out.push('\\');
                out.push(c);
            }
            '\\' => out.push_str("\\backslash "),
            c => out.push(c),
        }
    }
    out
}

fn write_run(r: &Run, out: &mut Out, align: bool) {
    if r.normal {
        let name = match r.style {
            Some(Style::Bold | Style::BoldItalic) => "textbf",
            Some(Style::Italic) => "textit",
            _ => "text",
        };
        out.cmd(name);
        out.raw("{");
        out.raw(&escape_text(&r.text));
        out.raw("}");
        return;
    }
    let wrapper = match (r.alphabet, r.style) {
        (Some(Alphabet::DoubleStruck), _) => Some("mathbb"),
        (Some(Alphabet::Script), _) => Some("mathcal"),
        (Some(Alphabet::Fraktur), _) => Some("mathfrak"),
        (Some(Alphabet::SansSerif), _) => Some("mathsf"),
        (Some(Alphabet::Monospace), _) => Some("mathtt"),
        (_, Some(Style::Bold)) => Some("mathbf"),
        (_, Some(Style::BoldItalic)) => Some("boldsymbol"),
        (_, Some(Style::Plain)) if r.text.chars().any(|c| default_style(c) != Style::Plain) => {
            Some("mathrm")
        }
        (_, Some(Style::Italic)) if r.text.chars().any(|c| default_style(c) != Style::Italic) => {
            Some("mathit")
        }
        _ => None,
    };
    if let Some(w) = wrapper {
        out.cmd(w);
        out.raw("{");
    }
    for c in r.text.chars() {
        write_char(out, c, align);
    }
    if wrapper.is_some() {
        out.raw("}");
    }
}

fn write_char(out: &mut Out, c: char, align: bool) {
    match c {
        '−' => out.raw("-"),
        '∗' => out.raw("*"),
        '&' if align => out.raw(" & "),
        '{' | '}' | '%' | '#' | '&' | '$' | '_' => out.raw(&format!("\\{c}")),
        '\\' => out.cmd("backslash"),
        '^' => out.raw("\\text{^}"),
        '~' => out.cmd("sim"),
        '\'' => out.cmd("prime"),
        '\u{2009}' => out.raw("\\,"),
        '\u{205F}' => out.raw("\\:"),
        '\u{2004}' => out.raw("\\;"),
        '\u{2003}' => out.cmd("quad"),
        ' ' => out.raw("\\ "),
        '\u{a0}' => out.raw("~"),
        '|' => out.raw("|"),
        c if c.is_ascii() => out.raw(&c.to_string()),
        c => match char_command(c) {
            Some(name) => out.cmd(name),
            None => out.raw(&c.to_string()),
        },
    }
}
