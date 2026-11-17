//! Typed expression builders. An [`Expr<T>`] is an expression whose value
//! has the runtime type `T` ([`Str`], [`Bool`], [`Num`] or [`Json`]);
//! operators only combine expressions of the same type, so `'1' == 1`-style
//! comparisons that GitHub silently coerces don't compile.
//!
//! `Display` renders `${{ ... }}` for interpolation into any string;
//! [`Expr::condition`] renders the bare form an `if:` takes.

use std::fmt;
use std::marker::PhantomData;

use super::{Ast, Op};
use crate::Expression;

/// A string value.
pub enum Str {}
/// A boolean value.
pub enum Bool {}
/// A number value.
pub enum Num {}
/// A value of any shape, such as `fromJSON` output or an event payload
/// field, typed by the caller where it is used.
pub enum Json {}

/// An expression of runtime type `T`.
pub struct Expr<T> {
    ast: Ast,
    value_type: PhantomData<fn() -> T>,
}

impl<T> Clone for Expr<T> {
    fn clone(&self) -> Self {
        Self::from_ast(self.ast.clone())
    }
}

impl<T> fmt::Debug for Expr<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Expr({})", self.ast)
    }
}

impl<T> Expr<T> {
    fn from_ast(ast: Ast) -> Self {
        Self {
            ast,
            value_type: PhantomData,
        }
    }

    pub fn ast(&self) -> &Ast {
        &self.ast
    }

    pub fn into_ast(self) -> Ast {
        self.ast
    }

    fn binary<Result>(self, op: Op, other: Expr<T>) -> Expr<Result> {
        Expr::from_ast(Ast::Binary(op, Box::new(self.ast), Box::new(other.ast)))
    }

    pub fn eq(self, other: impl Into<Expr<T>>) -> Expr<Bool> {
        self.binary(Op::Eq, other.into())
    }

    pub fn ne(self, other: impl Into<Expr<T>>) -> Expr<Bool> {
        self.binary(Op::Ne, other.into())
    }

    /// `self || fallback`: `self` unless it is empty, false, 0 or null.
    pub fn or_else(self, fallback: impl Into<Expr<T>>) -> Expr<T> {
        self.binary(Op::Or, fallback.into())
    }
}

impl<T> fmt::Display for Expr<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "${{{{ {} }}}}", self.ast)
    }
}

impl Expr<Bool> {
    pub fn and(self, other: impl Into<Expr<Bool>>) -> Expr<Bool> {
        self.binary(Op::And, other.into())
    }

    /// `self || other`, with any `&&` operand parenthesized so a reader
    /// never has to know which binds tighter.
    pub fn or(self, other: impl Into<Expr<Bool>>) -> Expr<Bool> {
        let group_and = |ast: Ast| match ast {
            Ast::Binary(Op::And, _, _) => Ast::Group(Box::new(ast)),
            other => other,
        };
        let other = other.into();
        Expr::from_ast(Ast::Binary(
            Op::Or,
            Box::new(group_and(self.ast)),
            Box::new(group_and(other.ast)),
        ))
    }

    /// GitHub's `condition && a || b`. It yields `b` whenever `a` is falsy,
    /// so `a` must never be empty, false, 0 or null.
    pub fn then_else<T>(self, a: impl Into<Expr<T>>, b: impl Into<Expr<T>>) -> Expr<T> {
        let a = a.into();
        let then = Expr::<T>::from_ast(Ast::Binary(Op::And, Box::new(self.ast), Box::new(a.ast)));
        then.binary(Op::Or, b.into())
    }

    /// The bare form an `if:` takes.
    pub fn condition(&self) -> Expression {
        Expression::new(self.ast.to_string())
    }
}

impl std::ops::Not for Expr<Bool> {
    type Output = Expr<Bool>;

    fn not(self) -> Expr<Bool> {
        Expr::from_ast(Ast::Not(Box::new(self.ast)))
    }
}

impl From<Expr<Bool>> for Expression {
    fn from(expr: Expr<Bool>) -> Self {
        expr.condition()
    }
}

impl Expr<Str> {
    pub fn contains(self, needle: impl Into<Expr<Str>>) -> Expr<Bool> {
        call("contains", [self.ast, needle.into().ast])
    }

    pub fn starts_with(self, prefix: impl Into<Expr<Str>>) -> Expr<Bool> {
        call("startsWith", [self.ast, prefix.into().ast])
    }

    pub fn ends_with(self, suffix: impl Into<Expr<Str>>) -> Expr<Bool> {
        call("endsWith", [self.ast, suffix.into().ast])
    }

    /// The `'true'`/`'false'` string a step output carries, as a boolean.
    pub fn is_true(self) -> Expr<Bool> {
        self.binary(Op::Eq, Expr::from("true"))
    }
}

impl Expr<Json> {
    /// The property `name`, read as type `T`.
    pub fn field<T>(self, name: &str) -> Expr<T> {
        Expr::from_ast(Ast::Property(Box::new(self.ast), name.to_string()))
    }
}

impl From<&str> for Expr<Str> {
    fn from(text: &str) -> Self {
        Self::from_ast(Ast::Str(text.to_string()))
    }
}

impl From<String> for Expr<Str> {
    fn from(text: String) -> Self {
        Self::from_ast(Ast::Str(text))
    }
}

impl From<bool> for Expr<Bool> {
    fn from(value: bool) -> Self {
        Self::from_ast(Ast::Bool(value))
    }
}

impl From<i64> for Expr<Num> {
    fn from(value: i64) -> Self {
        Self::from_ast(Ast::Number(value.to_string()))
    }
}

fn call<T, const N: usize>(name: &str, args: [Ast; N]) -> Expr<T> {
    Expr::from_ast(Ast::Call(name.to_string(), args.into()))
}

/// `root.a.b...`
fn path<T>(root: &str, properties: &[&str]) -> Expr<T> {
    let ast = properties
        .iter()
        .fold(Ast::Context(root.to_string()), |object, name| {
            Ast::Property(Box::new(object), name.to_string())
        });
    Expr::from_ast(ast)
}

pub fn always() -> Expr<Bool> {
    call("always", [])
}

pub fn success() -> Expr<Bool> {
    call("success", [])
}

pub fn failure() -> Expr<Bool> {
    call("failure", [])
}

pub fn cancelled() -> Expr<Bool> {
    call("cancelled", [])
}

/// `hashFiles(globs...)`.
pub fn hash_files<'a>(globs: impl IntoIterator<Item = &'a str>) -> Expr<Str> {
    Expr::from_ast(Ast::Call(
        "hashFiles".to_string(),
        globs
            .into_iter()
            .map(|glob| Ast::Str(glob.to_string()))
            .collect(),
    ))
}

/// `fromJSON(text)`, read as type `T`.
pub fn from_json<T>(text: Expr<Str>) -> Expr<T> {
    call("fromJSON", [text.ast])
}

/// `toJSON(value)`.
pub fn to_json<T>(value: Expr<T>) -> Expr<Str> {
    call("toJSON", [value.ast])
}

/// `format(template, args...)`; `{0}`, `{1}`, ... in `template` take the
/// arguments in order.
pub fn format(template: &str, args: impl IntoIterator<Item = Ast>) -> Expr<Str> {
    let mut all = vec![Ast::Str(template.to_string())];
    all.extend(args);
    Expr::from_ast(Ast::Call("format".to_string(), all))
}

/// `join(array, separator)`.
pub fn join(array: Expr<Json>, separator: &str) -> Expr<Str> {
    call("join", [array.ast, Ast::Str(separator.to_string())])
}

/// `github.*`
pub struct Github;

pub fn github() -> Github {
    Github
}

impl Github {
    fn field(&self, name: &str) -> Expr<Str> {
        path("github", &[name])
    }

    pub fn actor(&self) -> Expr<Str> {
        self.field("actor")
    }

    pub fn base_ref(&self) -> Expr<Str> {
        self.field("base_ref")
    }

    pub fn event_name(&self) -> Expr<Str> {
        self.field("event_name")
    }

    pub fn head_ref(&self) -> Expr<Str> {
        self.field("head_ref")
    }

    pub fn git_ref(&self) -> Expr<Str> {
        self.field("ref")
    }

    pub fn ref_name(&self) -> Expr<Str> {
        self.field("ref_name")
    }

    pub fn repository(&self) -> Expr<Str> {
        self.field("repository")
    }

    pub fn repository_owner(&self) -> Expr<Str> {
        self.field("repository_owner")
    }

    pub fn run_attempt(&self) -> Expr<Str> {
        self.field("run_attempt")
    }

    pub fn run_id(&self) -> Expr<Str> {
        self.field("run_id")
    }

    pub fn run_number(&self) -> Expr<Str> {
        self.field("run_number")
    }

    pub fn server_url(&self) -> Expr<Str> {
        self.field("server_url")
    }

    pub fn sha(&self) -> Expr<Str> {
        self.field("sha")
    }

    pub fn token(&self) -> Expr<Str> {
        self.field("token")
    }

    pub fn workflow(&self) -> Expr<Str> {
        self.field("workflow")
    }

    pub fn workspace(&self) -> Expr<Str> {
        self.field("workspace")
    }

    /// A field of the triggering event's payload. Payload shapes differ per
    /// event, so the path and type are the caller's claim.
    pub fn event<T>(&self, dotted_path: &str) -> Expr<T> {
        let mut properties = vec!["event"];
        properties.extend(dotted_path.split('.'));
        path("github", &properties)
    }
}

/// `inputs.<name>` of a `workflow_call` or `workflow_dispatch` trigger.
pub fn input<T>(name: &str) -> Expr<T> {
    path("inputs", &[name])
}

/// `secrets.<name>`
pub fn secret(name: &str) -> Expr<Str> {
    path("secrets", &[name])
}

/// `vars.<name>`
pub fn var(name: &str) -> Expr<Str> {
    path("vars", &[name])
}

/// `env.<name>`
pub fn env(name: &str) -> Expr<Str> {
    path("env", &[name])
}

/// `matrix.<name>`
pub fn matrix<T>(name: &str) -> Expr<T> {
    path("matrix", &[name])
}

/// `runner.*`
pub struct Runner;

pub fn runner() -> Runner {
    Runner
}

impl Runner {
    pub fn arch(&self) -> Expr<Str> {
        path("runner", &["arch"])
    }

    pub fn os(&self) -> Expr<Str> {
        path("runner", &["os"])
    }

    pub fn temp(&self) -> Expr<Str> {
        path("runner", &["temp"])
    }

    pub fn tool_cache(&self) -> Expr<Str> {
        path("runner", &["tool_cache"])
    }
}

/// `job.status`
pub fn job_status() -> Expr<Str> {
    path("job", &["status"])
}

/// `needs.<job>.*`, for a job this one lists in `needs`.
pub struct Needs(String);

pub fn needs(job_id: &str) -> Needs {
    Needs(job_id.to_string())
}

impl Needs {
    pub fn output(&self, name: &str) -> Expr<Str> {
        path("needs", &[&self.0, "outputs", name])
    }

    /// `success`, `failure`, `cancelled` or `skipped`.
    pub fn result(&self) -> Expr<Str> {
        path("needs", &[&self.0, "result"])
    }
}

/// `steps.<id>.*`, for an earlier step of the same job.
pub struct Steps(String);

pub fn steps(step_id: &str) -> Steps {
    Steps(step_id.to_string())
}

impl Steps {
    pub fn output(&self, name: &str) -> Expr<Str> {
        path("steps", &[&self.0, "outputs", name])
    }

    pub fn outcome(&self) -> Expr<Str> {
        path("steps", &[&self.0, "outcome"])
    }

    pub fn conclusion(&self) -> Expr<Str> {
        path("steps", &[&self.0, "conclusion"])
    }
}
