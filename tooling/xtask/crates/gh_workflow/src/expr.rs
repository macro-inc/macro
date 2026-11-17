//! GitHub Actions expressions (`${{ ... }}`): an AST, a parser, one canonical
//! spelling, and the checks every rendered workflow passes.
//!
//! Workflows build expressions with the typed API in [`typed`]. Strings that
//! still carry raw `${{ ... }}` text are parsed when the workflow is rendered
//! and re-spelled canonically, so a typed expression and the raw text it
//! replaces render the same bytes. Rendering fails on text that does not
//! parse, on an unknown context or function, and on a context GitHub does not
//! offer at that key ([`scope`]).

use std::fmt;

mod parse;
pub mod scope;
pub mod typed;

pub use parse::{parse, parse_template, TemplatePart};

/// A parsed expression.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Ast {
    Null,
    Bool(bool),
    /// The number as written (`1`, `0.5`, `0xff`, `1e3`).
    Number(String),
    Str(String),
    /// The root of a context access: `github`, `needs`, `steps`, ...
    Context(String),
    /// `object.name`
    Property(Box<Ast>, String),
    /// `object[index]`
    Index(Box<Ast>, Box<Ast>),
    /// `object.*`
    Star(Box<Ast>),
    /// `name(args...)`
    Call(String, Vec<Ast>),
    Not(Box<Ast>),
    Binary(Op, Box<Ast>, Box<Ast>),
    /// Parentheses the author wrote. They never change the meaning (the
    /// tree already encodes it); they are kept so re-spelling an
    /// expression changes only its spacing.
    Group(Box<Ast>),
}

impl Ast {
    /// The same expression with every [`Ast::Group`] removed and function
    /// names in GitHub's spelling (they are case-insensitive), for comparing
    /// meaning rather than spelling.
    pub fn meaning(&self) -> Ast {
        let strip = |ast: &Ast| Box::new(ast.meaning());
        match self {
            Self::Group(inner) => inner.meaning(),
            Self::Property(object, name) => Self::Property(strip(object), name.clone()),
            Self::Index(object, index) => Self::Index(strip(object), strip(index)),
            Self::Star(object) => Self::Star(strip(object)),
            Self::Call(name, args) => {
                let name = FUNCTIONS
                    .iter()
                    .find(|(known, _, _)| known.eq_ignore_ascii_case(name))
                    .map_or(name.as_str(), |(known, _, _)| known);
                Self::Call(name.to_string(), args.iter().map(Ast::meaning).collect())
            }
            Self::Not(operand) => Self::Not(strip(operand)),
            Self::Binary(op, left, right) => Self::Binary(*op, strip(left), strip(right)),
            leaf => leaf.clone(),
        }
    }
}

/// Binary operators, from loosest to tightest binding.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Op {
    Or,
    And,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}

impl Op {
    fn symbol(self) -> &'static str {
        match self {
            Self::Or => "||",
            Self::And => "&&",
            Self::Eq => "==",
            Self::Ne => "!=",
            Self::Lt => "<",
            Self::Le => "<=",
            Self::Gt => ">",
            Self::Ge => ">=",
        }
    }

    fn precedence(self) -> u8 {
        match self {
            Self::Or => 1,
            Self::And => 2,
            Self::Eq | Self::Ne => 3,
            Self::Lt | Self::Le | Self::Gt | Self::Ge => 4,
        }
    }
}

/// Binding strength of a node when it is an operand.
fn precedence(ast: &Ast) -> u8 {
    match ast {
        Ast::Binary(op, _, _) => op.precedence(),
        Ast::Not(_) => 5,
        _ => 6,
    }
}

/// The canonical spelling: single spaces around binary operators, `, `
/// between arguments, strings in single quotes, the author's parentheses,
/// and parentheses wherever precedence needs them.
impl fmt::Display for Ast {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Null => f.write_str("null"),
            Self::Bool(value) => write!(f, "{value}"),
            Self::Number(text) => f.write_str(text),
            Self::Str(text) => write!(f, "'{}'", text.replace('\'', "''")),
            Self::Context(name) => f.write_str(name),
            Self::Property(object, name) => {
                write_operand(f, object, 6)?;
                write!(f, ".{name}")
            }
            Self::Index(object, index) => {
                write_operand(f, object, 6)?;
                write!(f, "[{index}]")
            }
            Self::Star(object) => {
                write_operand(f, object, 6)?;
                f.write_str(".*")
            }
            Self::Call(name, args) => {
                write!(f, "{name}(")?;
                for (position, arg) in args.iter().enumerate() {
                    if position > 0 {
                        f.write_str(", ")?;
                    }
                    write!(f, "{arg}")?;
                }
                f.write_str(")")
            }
            Self::Not(operand) => {
                f.write_str("!")?;
                write_operand(f, operand, 5)
            }
            Self::Binary(op, left, right) => {
                // Left-associative: an equal-precedence left operand needs no
                // parentheses, an equal-precedence right one does.
                write_operand(f, left, op.precedence())?;
                write!(f, " {} ", op.symbol())?;
                write_operand(f, right, op.precedence() + 1)
            }
            Self::Group(inner) => write!(f, "({inner})"),
        }
    }
}

fn write_operand(f: &mut fmt::Formatter<'_>, operand: &Ast, at_least: u8) -> fmt::Result {
    if precedence(operand) < at_least {
        write!(f, "({operand})")
    } else {
        write!(f, "{operand}")
    }
}

/// Every context root GitHub defines.
pub const CONTEXTS: &[&str] = &[
    "github", "env", "vars", "job", "jobs", "steps", "runner", "secrets", "strategy", "matrix",
    "needs", "inputs",
];

/// Every function GitHub defines, with how many arguments it takes. Names
/// are case-insensitive, as in GitHub.
const FUNCTIONS: &[(&str, usize, usize)] = &[
    ("contains", 2, 2),
    ("startsWith", 2, 2),
    ("endsWith", 2, 2),
    ("format", 1, usize::MAX),
    ("join", 1, 2),
    ("toJSON", 1, 1),
    ("fromJSON", 1, 1),
    ("hashFiles", 1, usize::MAX),
    ("success", 0, 0),
    ("always", 0, 0),
    ("cancelled", 0, 0),
    ("failure", 0, 0),
];

/// Why an expression can't go in a workflow: an unknown context or
/// function, a wrong argument count, or a context `allowed` does not list.
pub fn check(ast: &Ast, allowed: &[&str]) -> Result<(), String> {
    match ast {
        Ast::Null | Ast::Bool(_) | Ast::Number(_) | Ast::Str(_) => Ok(()),
        Ast::Context(name) => {
            if !CONTEXTS.contains(&name.as_str()) {
                return Err(format!("unknown context `{name}`"));
            }
            if !allowed.contains(&name.as_str()) {
                return Err(format!(
                    "context `{name}` is not available here (only {})",
                    allowed.join(", ")
                ));
            }
            Ok(())
        }
        Ast::Property(object, _) | Ast::Star(object) | Ast::Not(object) | Ast::Group(object) => {
            check(object, allowed)
        }
        Ast::Index(object, index) => {
            check(object, allowed)?;
            check(index, allowed)
        }
        Ast::Binary(_, left, right) => {
            check(left, allowed)?;
            check(right, allowed)
        }
        Ast::Call(name, args) => {
            let Some((_, min, max)) = FUNCTIONS
                .iter()
                .find(|(known, _, _)| known.eq_ignore_ascii_case(name))
            else {
                return Err(format!("unknown function `{name}`"));
            };
            if args.len() < *min || args.len() > *max {
                return Err(format!(
                    "`{name}` takes {min}..{} arguments, got {}",
                    if *max == usize::MAX {
                        "".to_string()
                    } else {
                        max.to_string()
                    },
                    args.len()
                ));
            }
            args.iter().try_for_each(|arg| check(arg, allowed))
        }
    }
}

/// Re-spell every `${{ ... }}` in `text` canonically, checking each against
/// `allowed`. With `whole_expression` (an `if:` value), text without `${{` is
/// itself one expression.
pub fn canonicalize(
    text: &str,
    allowed: &[&str],
    whole_expression: bool,
) -> Result<String, String> {
    if whole_expression && !text.contains("${{") {
        let ast = parse(text)?;
        check(&ast, allowed)?;
        return Ok(ast.to_string());
    }

    let mut out = String::with_capacity(text.len());
    for part in parse_template(text)? {
        match part {
            TemplatePart::Text(text) => out.push_str(text),
            TemplatePart::Expression(ast) => {
                check(&ast, allowed)?;
                out.push_str("${{ ");
                out.push_str(&ast.to_string());
                out.push_str(" }}");
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod test;
