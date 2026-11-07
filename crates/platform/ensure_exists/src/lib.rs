use std::ops::Deref;

#[cfg(feature = "dynamodb")]
pub mod dynamodb;

/// Sentinel struct which guarantees that some value T was created via [EnsureExists] trait impl
#[derive(Debug, Clone)]
pub struct DoesExist<T>(T);

impl<T> Deref for DoesExist<T> {
    type Target = T;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl<T> DoesExist<T> {
    /// create an instance of [Self] from T.
    /// This allows the caller to break invariant of only constructng [Self] via [EnsureExists]
    pub fn assert_exists(val: T) -> Self {
        Self(val)
    }
}

/// trait to abstract away idempotent behvaiour of ensuring some resource exists and creating it if not.
pub trait EnsureExists<T> {
    type Err;

    fn check_exists(&self) -> impl Future<Output = Result<Option<T>, Self::Err>>;
    fn create_if_not_exists(&self) -> impl Future<Output = Result<T, Self::Err>>;
    fn ensure_exists(&self) -> impl Future<Output = Result<DoesExist<T>, Self::Err>> {
        async move {
            match self.check_exists().await? {
                None => self.create_if_not_exists().await.map(DoesExist),
                Some(t) => Ok(DoesExist(t)),
            }
        }
    }
}
