//! This module provides strongly typed guaranteed that its inner contents are lowercased unicode characters

use crate::cowlike::{ArcCowStr, CowLike};
use std::sync::Arc;

/// The lowercase struct upholds the invariant that its contents are guaranteed to be
/// lowercased unicode characters
#[derive(Debug, Clone)]
pub struct Lowercase<'a>(ArcCowStr<'a>);

impl<'a> Lowercase<'a> {
    /// construct a new instance from the input T
    pub fn new(inner: ArcCowStr<'a>) -> Self {
        match inner.as_ref().chars().all(|c| c.is_lowercase()) {
            true => Self(inner),
            false => Self(ArcCowStr::Owned(Arc::from(inner.as_ref().to_lowercase()))),
        }
    }
}

impl<'a> AsRef<str> for Lowercase<'a> {
    fn as_ref(&self) -> &str {
        self.0.as_ref()
    }
}

impl<'a> CowLike<'a> for Lowercase<'a> {
    type Owned<'b> = Lowercase<'b>;

    fn into_owned(self) -> Lowercase<'static> {
        Lowercase(self.0.into_owned())
    }

    fn copied(&'a self) -> Self {
        Lowercase(self.0.copied())
    }
}
