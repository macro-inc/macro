//! Expression AST.

/// A parsed math expression.
#[derive(Debug, Clone, PartialEq)]
pub enum Expr {
    /// A numeric literal.
    Number(f64),
    /// A variable or constant name (`x`, `pi`, `a`).
    Name(String),
    /// `left + right`
    Add(Box<Expr>, Box<Expr>),
    /// `left - right`
    Sub(Box<Expr>, Box<Expr>),
    /// `left * right`
    Mul(Box<Expr>, Box<Expr>),
    /// `left / right`
    Div(Box<Expr>, Box<Expr>),
    /// `left ^ right`
    Pow(Box<Expr>, Box<Expr>),
    /// Unary minus.
    Neg(Box<Expr>),
    /// `name(args…)`
    Call(String, Vec<Expr>),
    /// A point `(x, y)`.
    Point(Box<Expr>, Box<Expr>),
    /// Absolute value `|x|`.
    Abs(Box<Expr>),
    /// Postfix factorial `n!`.
    Fact(Box<Expr>),
    /// Comparison used in piecewise conditions (`x<0`).
    Cmp(Box<Expr>, RelationKind, Box<Expr>),
    /// `{cond: value, …, else}` — first matching arm wins.
    Piecewise(Vec<(Option<Expr>, Expr)>),
}

/// A domain restriction such as `{x>0}` or `{0<x<5}`.
#[derive(Debug, Clone, PartialEq)]
pub struct Restriction {
    /// Left side of the comparison.
    pub left: Expr,
    /// Comparison.
    pub kind: RelationKind,
    /// Right side of the comparison.
    pub right: Expr,
}

/// How an expression is drawn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelationKind {
    /// `left = right`
    Equal,
    /// `left < right`
    Lt,
    /// `left > right`
    Gt,
    /// `left <= right`
    Le,
    /// `left >= right`
    Ge,
}

/// A top-level line in the expression list.
#[derive(Debug, Clone, PartialEq)]
pub enum Statement {
    /// A plottable relation, point, or bare expression (`x^2` means `y = x^2`).
    Relation {
        /// Left-hand side. Absent for a bare expression.
        left: Option<Expr>,
        /// Comparison, or `Equal` for a bare expression.
        kind: RelationKind,
        /// Right-hand side, or the bare expression.
        right: Expr,
        /// Optional domain, Desmos `{x>0}` style.
        restrict: Vec<Restriction>,
    },
    /// `name = value` with no `x`/`y` — a slider or constant.
    Assignment {
        /// Parameter name.
        name: String,
        /// Value expression.
        value: Expr,
    },
    /// `f(x) = …` or `f(x, y) = …`.
    Function {
        /// Function name.
        name: String,
        /// Parameter names.
        params: Vec<String>,
        /// Body.
        body: Expr,
    },
}

impl Expr {
    /// Names referenced by this expression.
    pub fn names(&self) -> Vec<String> {
        let mut out = Vec::new();
        self.collect_names(&mut out);
        out.sort();
        out.dedup();
        out
    }

    fn collect_names(&self, out: &mut Vec<String>) {
        match self {
            Expr::Number(_) => {}
            Expr::Name(name) => out.push(name.clone()),
            Expr::Add(a, b)
            | Expr::Sub(a, b)
            | Expr::Mul(a, b)
            | Expr::Div(a, b)
            | Expr::Pow(a, b)
            | Expr::Point(a, b) => {
                a.collect_names(out);
                b.collect_names(out);
            }
            Expr::Neg(inner) | Expr::Abs(inner) | Expr::Fact(inner) => {
                inner.collect_names(out);
            }
            Expr::Cmp(a, _, b) => {
                a.collect_names(out);
                b.collect_names(out);
            }
            Expr::Piecewise(arms) => {
                for (cond, value) in arms {
                    if let Some(cond) = cond {
                        cond.collect_names(out);
                    }
                    value.collect_names(out);
                }
            }
            Expr::Call(name, args) => {
                if !is_builtin(name) {
                    out.push(name.clone());
                }
                for arg in args {
                    arg.collect_names(out);
                }
            }
        }
    }

    /// Whether `name` appears free.
    pub fn uses(&self, name: &str) -> bool {
        self.names().iter().any(|n| n == name)
    }
}

/// Built-in functions that are not user identifiers.
pub fn is_builtin(name: &str) -> bool {
    matches!(
        name,
        "sin"
            | "cos"
            | "tan"
            | "asin"
            | "acos"
            | "atan"
            | "sinh"
            | "cosh"
            | "tanh"
            | "log"
            | "ln"
            | "log10"
            | "sqrt"
            | "abs"
            | "exp"
            | "floor"
            | "ceil"
            | "round"
            | "sign"
            | "min"
            | "max"
            | "csc"
            | "sec"
            | "cot"
            | "atan2"
            | "log2"
            | "cbrt"
            | "mod"
            | "hypot"
            | "nCr"
            | "nPr"
            | "gcd"
            | "lcm"
            | "fact"
    )
}

/// Reserved graph variables and constants that never become sliders.
pub fn is_reserved(name: &str) -> bool {
    matches!(name, "x" | "y" | "e" | "pi" | "tau" | "theta" | "r") || is_builtin(name)
}
