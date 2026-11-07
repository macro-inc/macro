//! This module contains utility functions that are used within this crate.

/// Serialization skip condition for empty slices.
pub fn is_empty_slice<T: Clone>(slice: &[T]) -> bool {
    slice.is_empty()
}
