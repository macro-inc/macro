pub trait ExpandNode: Iterator {
    fn expand<U, E>(
        self,
        cb: impl FnMut(<Self as Iterator>::Item) -> Result<U, E>,
        fold: impl Fn(Expr<U>, Expr<U>) -> Expr<U>,
    ) -> Result<Option<Expr<U>>, E>;
}

impl<I> ExpandNode for I
where
    I: Iterator,
{
    fn expand<U, E>(
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

#[derive(Debug)]
pub enum ExprFrame<A, B> {
    And(A, A),
    Or(A, A),
    Not(A),
    Literal(B),
}

#[derive(Debug)]
pub enum Expr<B> {
    And(Box<Expr<B>>, Box<Expr<B>>),
    Or(Box<Expr<B>>, Box<Expr<B>>),
    Not(Box<Expr<B>>),
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
