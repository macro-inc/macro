//! Lists read from hostile input without letting them grow without bound.
use std::fmt;
use std::marker::PhantomData;

use serde::de::{Deserialize, Deserializer, IgnoredAny, SeqAccess, Visitor};

/// Most entries kept from one per-item list (fields, sections, URLs, tags).
/// The vault keeps at most [`crate::vault::MAX_FIELDS`] fields, so an item
/// with more is skipped as too large anyway.
pub(crate) const MAX_LIST_ENTRIES: usize = 256;

/// A JSON array holding at most `MAX` entries. Entries past `MAX` are read
/// and discarded without allocating, and `overflowed` is set so the item can
/// be skipped rather than imported partially. A `null` list is empty and
/// `null` entries are left out: both exporters' schemas allow them.
pub(crate) struct Bounded<T, const MAX: usize = MAX_LIST_ENTRIES> {
    pub(crate) entries: Vec<T>,
    pub(crate) overflowed: bool,
}

impl<T, const MAX: usize> Default for Bounded<T, MAX> {
    fn default() -> Self {
        Self {
            entries: Vec::new(),
            overflowed: false,
        }
    }
}

impl<'de, T: Deserialize<'de>, const MAX: usize> Deserialize<'de> for Bounded<T, MAX> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_option(NullAsEmpty(BoundedVisitor(PhantomData)))
    }
}

struct BoundedVisitor<T, const MAX: usize>(PhantomData<T>);

impl<'de, T: Deserialize<'de>, const MAX: usize> Visitor<'de> for BoundedVisitor<T, MAX> {
    type Value = Bounded<T, MAX>;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a list")
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
        let mut bounded = Bounded::default();

        while bounded.entries.len() < MAX {
            match seq.next_element::<Option<T>>()? {
                Some(Some(entry)) => bounded.entries.push(entry),
                Some(None) => {}
                None => return Ok(bounded),
            }
        }
        while seq.next_element::<IgnoredAny>()?.is_some() {
            bounded.overflowed = true;
        }

        Ok(bounded)
    }
}

/// The number of entries in a JSON array, counted without keeping any. `T`
/// is the shape counted inside each entry (see [`Counted`]).
pub(crate) struct Count<T> {
    pub(crate) total: usize,
    shape: PhantomData<T>,
}

/// An entry whose nested lists also count toward a [`Count`].
pub(crate) trait Counted {
    /// Entries nested inside this one.
    fn nested(&self) -> usize;
}

impl Counted for IgnoredAny {
    fn nested(&self) -> usize {
        0
    }
}

impl<T> Count<T> {
    pub(crate) fn zero() -> Self {
        Self {
            total: 0,
            shape: PhantomData,
        }
    }
}

impl<T> Default for Count<T> {
    fn default() -> Self {
        Self::zero()
    }
}

impl<'de, T: Deserialize<'de> + Counted> Deserialize<'de> for Count<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_option(NullAsEmpty(CountVisitor(PhantomData)))
    }
}

struct CountVisitor<T>(PhantomData<T>);

impl<'de, T: Deserialize<'de> + Counted> Visitor<'de> for CountVisitor<T> {
    type Value = Count<T>;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a list")
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
        let mut count = Count::zero();
        while let Some(entry) = seq.next_element::<Option<T>>()? {
            let nested = entry.as_ref().map_or(0, Counted::nested);
            count.total = count.total.saturating_add(1).saturating_add(nested);
        }
        Ok(count)
    }
}

/// Reads `null` as the list visitor's empty value, anything else as a list.
struct NullAsEmpty<V>(V);

impl<'de, V: Visitor<'de>> Visitor<'de> for NullAsEmpty<V>
where
    V::Value: Default,
{
    type Value = V::Value;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.expecting(formatter)
    }

    fn visit_none<E: serde::de::Error>(self) -> Result<Self::Value, E> {
        Ok(V::Value::default())
    }

    fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
        Ok(V::Value::default())
    }

    fn visit_some<D: Deserializer<'de>>(self, deserializer: D) -> Result<Self::Value, D::Error> {
        deserializer.deserialize_seq(self.0)
    }
}

/// A plain `Vec` that reads `null` as empty, for lists `Count` already bounded.
pub(crate) fn null_as_empty<'de, D, T>(deserializer: D) -> Result<Vec<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Option::<Vec<T>>::deserialize(deserializer)?.unwrap_or_default())
}
