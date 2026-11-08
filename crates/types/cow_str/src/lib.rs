#![deny(missing_docs)]
//! This crate exposes the [CowLike] trait
//! And the ArcCowStr

use std::sync::Arc;

use either::Either;

/// Defines Cow-like behaviour for some type T
/// We often cant use acutal Cows because of the limitations
/// on the lifetimes of the [ToOwned] and [Borrow] traits
pub trait CowLike<'a> {
    /// the owned type
    type Owned<'b>;

    /// convert self into a statically owned type
    /// if this type is already owned this should do nothing
    /// if this type is borrowed then this would allocate
    fn into_owned(self) -> Self::Owned<'static>;

    /// given some reference &'a use the copy properties of the reference to create a borrowed self
    /// This should not allocate
    fn copied(&'a self) -> Self;
}

/// similar to a Cow<'a, str> but with cheap clones in the owned case
#[derive(Debug, Clone)]
pub enum ArcCowStr<'a> {
    /// the internal value is a borrowed string slice
    Borrowed(&'a str),
    /// the internal value is an allocated but cheaply cloneable `Arc<str>`
    Owned(Arc<str>),
}

impl<'a> CowLike<'a> for ArcCowStr<'a> {
    type Owned<'b> = ArcCowStr<'b>;

    fn into_owned(self) -> ArcCowStr<'static> {
        match self {
            ArcCowStr::Borrowed(s) => ArcCowStr::Owned(Arc::from(s)),
            ArcCowStr::Owned(o) => ArcCowStr::Owned(o),
        }
    }

    fn copied(&'a self) -> Self {
        match self {
            ArcCowStr::Borrowed(b) => ArcCowStr::Borrowed(b),
            ArcCowStr::Owned(o) => ArcCowStr::Borrowed(o.as_ref()),
        }
    }
}

impl<'a> AsRef<str> for ArcCowStr<'a> {
    fn as_ref(&self) -> &str {
        match self {
            ArcCowStr::Borrowed(s) => s,
            ArcCowStr::Owned(arc) => arc.as_ref(),
        }
    }
}

impl<'a> PartialEq for ArcCowStr<'a> {
    fn eq(&self, other: &Self) -> bool {
        self.as_ref() == other.as_ref()
    }
}

impl<'a> Eq for ArcCowStr<'a> {}

impl<'a> std::hash::Hash for ArcCowStr<'a> {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.as_ref().hash(state);
    }
}

impl<'a, T, U> CowLike<'a> for Either<T, U>
where
    T: CowLike<'a>,
    U: CowLike<'a>,
{
    type Owned<'b> = Either<T::Owned<'b>, U::Owned<'b>>;

    fn into_owned(self) -> Self::Owned<'static> {
        self.map_left(CowLike::into_owned)
            .map_right(CowLike::into_owned)
    }

    fn copied(&'a self) -> Self {
        match self {
            Either::Left(l) => Either::Left(l.copied()),
            Either::Right(r) => Either::Right(r.copied()),
        }
    }
}
