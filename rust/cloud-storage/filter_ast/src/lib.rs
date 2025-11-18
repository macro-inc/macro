use recursion::{Collapsible, Expandable, MappableFrame, PartiallyApplied};
use serde::{Deserialize, Serialize};

pub trait TryExpandNode: Iterator {
    fn try_expand<U, E>(
        self,
        cb: impl FnMut(<Self as Iterator>::Item) -> Result<U, E>,
        fold: impl Fn(Expr<U>, Expr<U>) -> Expr<U>,
    ) -> Result<Option<Expr<U>>, E>;
}

impl<I> TryExpandNode for I
where
    I: Iterator,
{
    fn try_expand<U, E>(
        mut self,
        mut cb: impl FnMut(<Self as Iterator>::Item) -> Result<U, E>,
        fold: impl Fn(Expr<U>, Expr<U>) -> Expr<U>,
    ) -> Result<Option<Expr<U>>, E> {
        self.try_fold(None, |acc, cur| {
            let node = Expr::val(cb(cur)?);
            Ok(Some(match acc {
                Some(acc) => fold(acc, node),
                None => node,
            }))
        })
    }
}

pub trait FoldTree<T>: Iterator {
    fn fold_with(self, fold: impl Fn(Expr<T>, Expr<T>) -> Expr<T>) -> Option<Expr<T>>;
}

impl<I, T> FoldTree<T> for I
where
    I: Iterator<Item = Option<Expr<T>>>,
{
    fn fold_with(self, fold: impl Fn(Expr<T>, Expr<T>) -> Expr<T>) -> Option<Expr<T>> {
        self.fold(None, |acc, cur| match (acc, cur) {
            (None, None) => None,
            (Some(next), None) | (None, Some(next)) => Some(next),
            (Some(a), Some(b)) => Some(fold(a, b)),
        })
    }
}

#[derive(Debug)]
pub enum ExprFrame<A, B> {
    And(A, A),
    Or(A, A),
    Not(A),
    Literal(B),
}

#[derive(Debug, Serialize, Deserialize)]
pub enum Expr<B> {
    And(Box<Self>, Box<Self>),
    Or(Box<Self>, Box<Self>),
    Not(Box<Self>),
    Literal(B),
}

impl<B> Expr<B> {
    pub fn and(a: Self, b: Self) -> Self {
        Expr::And(Box::new(a), Box::new(b))
    }

    pub fn or(a: Self, b: Self) -> Self {
        Expr::Or(Box::new(a), Box::new(b))
    }

    pub fn is_not(a: Self) -> Self {
        Expr::Not(Box::new(a))
    }

    pub fn val(v: B) -> Self {
        Expr::Literal(v)
    }
}

pub trait ExpandFrame<T> {
    type Err;
    fn expand_ast(input: Self) -> Result<Option<Expr<T>>, Self::Err>;
}

impl<T, U> MappableFrame for ExprFrame<T, U> {
    type Frame<X> = ExprFrame<X, U>;

    fn map_frame<A, B>(input: Self::Frame<A>, mut f: impl FnMut(A) -> B) -> Self::Frame<B> {
        match input {
            ExprFrame::And(a, b) => ExprFrame::And(f(a), f(b)),
            ExprFrame::Or(a, b) => ExprFrame::Or(f(a), f(b)),
            ExprFrame::Not(a) => ExprFrame::Not(f(a)),
            ExprFrame::Literal(a) => ExprFrame::Literal(a),
        }
    }
}

impl<T> Collapsible for &Expr<T>
where
    T: Clone,
{
    type FrameToken = ExprFrame<PartiallyApplied, T>;

    fn into_frame(self) -> <Self::FrameToken as MappableFrame>::Frame<Self> {
        match self {
            Expr::And(a, b) => ExprFrame::And(a.as_ref(), b.as_ref()),
            Expr::Or(a, b) => ExprFrame::Or(a.as_ref(), b.as_ref()),
            Expr::Not(a) => ExprFrame::Not(a.as_ref()),
            Expr::Literal(a) => ExprFrame::Literal(a.clone()),
        }
    }
}

impl<T> Expandable for Expr<T> {
    type FrameToken = ExprFrame<PartiallyApplied, T>;

    fn from_frame(val: <Self::FrameToken as MappableFrame>::Frame<Self>) -> Self {
        match val {
            ExprFrame::And(a, b) => Expr::And(Box::new(a), Box::new(b)),
            ExprFrame::Or(a, b) => Expr::Or(Box::new(a), Box::new(b)),
            ExprFrame::Not(a) => Expr::Not(Box::new(a)),
            ExprFrame::Literal(a) => Expr::Literal(a),
        }
    }
}
