//! An equation as plain Unicode text in a linear form (`x=(−b±√(b^2−4ac))/(2a)`),
//! for the text fallback other readers show.

use super::symbols::{default_style, math_char};
use super::tree::{Alphabet, Equation, FracKind, Node, Style};

/// The equation as linear text.
pub fn plain_text(eq: &Equation) -> String {
    eq.lines
        .iter()
        .map(|l| list_text(l))
        .collect::<Vec<_>>()
        .join("  ")
}

fn list_text(list: &[Node]) -> String {
    let mut out = String::new();
    for node in list {
        node_text(node, &mut out);
    }
    out
}

/// A part in parentheses unless it is a single symbol.
fn operand(list: &[Node]) -> String {
    let s = list_text(list);
    let simple = s.chars().count() <= 1
        || s.chars().all(|c| c.is_alphanumeric())
        || matches!(list, [Node::Delim { .. }]);
    if simple { s } else { format!("({s})") }
}

fn node_text(node: &Node, out: &mut String) {
    match node {
        Node::Run(r) => {
            let alphabet = r.alphabet.unwrap_or(Alphabet::Roman);
            for c in r.text.chars() {
                let style = r.style.unwrap_or_else(|| default_style(c));
                let mapped = if r.normal || (style == Style::Italic && alphabet == Alphabet::Roman)
                {
                    None
                } else {
                    math_char(c, style, alphabet)
                };
                out.push(mapped.unwrap_or(c));
            }
        }
        Node::Frac { kind, num, den, .. } => match kind {
            FracKind::NoBar => {
                out.push_str(&format!("({} ¦ {})", list_text(num), list_text(den)));
            }
            _ => out.push_str(&format!("{}/{}", operand(num), operand(den))),
        },
        Node::Scripts { base, sub, sup } => {
            out.push_str(&operand(base));
            if let Some(s) = sub {
                out.push('_');
                out.push_str(&operand(s));
            }
            if let Some(s) = sup {
                let t = list_text(s);
                if t.chars().all(|c| matches!(c, '′' | '″' | '‴')) {
                    out.push_str(&t);
                } else {
                    out.push('^');
                    out.push_str(&operand(s));
                }
            }
        }
        Node::PreScripts { base, sub, sup } => {
            out.push_str(&format!("_{}^{}", operand(sub), operand(sup)));
            out.push_str(&operand(base));
        }
        Node::Radical { degree, body, .. } => {
            let d = degree.as_ref().map(|d| list_text(d)).unwrap_or_default();
            match d.as_str() {
                "" => {
                    out.push('√');
                    out.push_str(&operand(body));
                }
                "3" => {
                    out.push('∛');
                    out.push_str(&operand(body));
                }
                "4" => {
                    out.push('∜');
                    out.push_str(&operand(body));
                }
                d => out.push_str(&format!("√({d}&{})", list_text(body))),
            }
        }
        Node::Nary {
            op, sub, sup, body, ..
        } => {
            out.push(*op);
            if let Some(s) = sub {
                out.push('_');
                out.push_str(&operand(s));
            }
            if let Some(s) = sup {
                out.push('^');
                out.push_str(&operand(s));
            }
            out.push(' ');
            out.push_str(&list_text(body));
        }
        Node::Delim {
            open,
            close,
            sep,
            items,
            ..
        } => {
            if let Some(o) = open {
                out.push(*o);
            }
            let parts: Vec<String> = items.iter().map(|i| list_text(i)).collect();
            out.push_str(&parts.join(&sep.to_string()));
            if let Some(c) = close {
                out.push(*c);
            }
        }
        Node::Func { name, body } => {
            out.push_str(&list_text(name));
            let b = list_text(body);
            if !b.starts_with('(') {
                out.push(' ');
            }
            out.push_str(&b);
        }
        Node::Limit { upper, base, limit } => {
            out.push_str(&list_text(base));
            out.push(if *upper { '^' } else { '_' });
            out.push_str(&operand(limit));
        }
        Node::Accent { chr, base, .. } => {
            let b = list_text(base);
            out.push_str(&b);
            if b.chars().count() == 1 {
                out.push(*chr);
            }
        }
        Node::Bar { top, base, .. } => {
            for c in list_text(base).chars() {
                out.push(c);
                out.push(if *top { '\u{305}' } else { '\u{332}' });
            }
        }
        Node::GroupChr { base, .. } | Node::BorderBox { base, .. } | Node::Group(base) => {
            out.push_str(&list_text(base))
        }
        Node::Phantom { show, base, .. } => {
            if *show {
                out.push_str(&list_text(base));
            }
        }
        Node::EqArray(rows) => {
            let rows: Vec<String> = rows.iter().map(|r| list_text(r).replace('&', "")).collect();
            out.push_str(&rows.join("; "));
        }
        Node::Matrix(rows) => {
            let rows: Vec<String> = rows
                .iter()
                .map(|r| r.iter().map(|c| list_text(c)).collect::<Vec<_>>().join(" "))
                .collect();
            out.push('[');
            out.push_str(&rows.join("; "));
            out.push(']');
        }
    }
}
