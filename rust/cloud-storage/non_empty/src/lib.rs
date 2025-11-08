//! Wrapper around types that implement IsEmpty trait to ensure they are non-empty.

use std::fmt;
use std::ops::Deref;

#[cfg(test)]
mod test;

/// Error type for when attempting to create an NonEmpty with an empty collection
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmptyError;

impl fmt::Display for EmptyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Cannot create NonEmpty from an empty collection")
    }
}

impl std::error::Error for EmptyError {}

/// A wrapper type that ensures the wrapped value is not empty.
///
/// This type can wrap any type that implements the `IsEmpty` trait (or has an `is_empty()` method).
/// It validates at construction time that the value is non-empty, returning an error if it is empty.
///
/// # Examples
///
/// ```
/// use non_empty::NonEmpty;
///
/// // Success case with Vec
/// let vec = vec![1, 2, 3];
/// let non_empty = NonEmpty::new(vec).unwrap();
/// assert_eq!(non_empty.len(), 3);
///
/// // Error case with empty Vec
/// let empty_vec: Vec<i32> = vec![];
/// assert!(NonEmpty::new(empty_vec).is_err());
///
/// // Works with HashMap
/// use std::collections::HashMap;
/// let mut map = HashMap::new();
/// map.insert("key", "value");
/// let non_empty_map = NonEmpty::new(map).unwrap();
/// // Can use HashMap methods directly via Deref
/// assert_eq!(non_empty_map["key"], "value");
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NonEmpty<T> {
    inner: T,
}

impl<T> NonEmpty<T>
where
    T: IsEmpty,
{
    /// Creates a new `NonEmpty` wrapper, returning an error if the value is empty.
    ///
    /// # Errors
    ///
    /// Returns `EmptyError` if `value.is_empty()` returns `true`.
    pub fn new(value: T) -> Result<Self, EmptyError> {
        if value.is_empty() {
            Err(EmptyError)
        } else {
            Ok(Self { inner: value })
        }
    }

    /// Consumes the wrapper and returns the inner value.
    pub fn into_inner(self) -> T {
        self.inner
    }

    /// Returns a reference to the inner value.
    pub fn inner(&self) -> &T {
        &self.inner
    }
}

// Implement Deref to allow transparent access to the inner type's methods
impl<T> Deref for NonEmpty<T> {
    type Target = T;

    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

/// Trait for types that can be checked for emptiness.
///
/// This trait is automatically implemented for common standard library types
/// that have an `is_empty()` method.
pub trait IsEmpty {
    fn is_empty(&self) -> bool;
}

// Implement IsEmpty for common standard library types
impl<T> IsEmpty for Vec<T> {
    fn is_empty(&self) -> bool {
        self.is_empty()
    }
}

impl IsEmpty for String {
    fn is_empty(&self) -> bool {
        self.is_empty()
    }
}

impl IsEmpty for &str {
    fn is_empty(&self) -> bool {
        str::is_empty(self)
    }
}

impl<K, V> IsEmpty for std::collections::HashMap<K, V> {
    fn is_empty(&self) -> bool {
        self.is_empty()
    }
}

impl<T> IsEmpty for std::collections::HashSet<T> {
    fn is_empty(&self) -> bool {
        self.is_empty()
    }
}

impl<K, V> IsEmpty for std::collections::BTreeMap<K, V> {
    fn is_empty(&self) -> bool {
        self.is_empty()
    }
}

impl<T> IsEmpty for std::collections::BTreeSet<T> {
    fn is_empty(&self) -> bool {
        self.is_empty()
    }
}

impl<T> IsEmpty for std::collections::VecDeque<T> {
    fn is_empty(&self) -> bool {
        self.is_empty()
    }
}

impl<T> IsEmpty for std::collections::LinkedList<T> {
    fn is_empty(&self) -> bool {
        self.is_empty()
    }
}

impl<T> IsEmpty for std::collections::BinaryHeap<T> {
    fn is_empty(&self) -> bool {
        self.is_empty()
    }
}

impl<T> IsEmpty for &[T] {
    fn is_empty(&self) -> bool {
        <[T]>::is_empty(self)
    }
}
