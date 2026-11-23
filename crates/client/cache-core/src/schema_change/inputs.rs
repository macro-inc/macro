//! The stored fields a host's index projections read, so a schema change that
//! removes a field drops only the records whose documents it fed.
//!
//! A document's facts were derived from values written under the stored
//! schema. A field the incoming schema removed is never fetched again, so a
//! fact a projection still derives from it would stay as it was: removing a
//! field a projection reads changes its type ([`super::Tier::Types`]).

use std::collections::{BTreeMap, BTreeSet};

/// The record fields a host's index projections read, by record type.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProjectionInputs {
    /// The host did not say: every projection may read every field.
    every: bool,
    /// Fields a document reads from the record it is keyed by.
    own: BTreeMap<String, BTreeSet<String>>,
    /// Fields documents read from records they are not keyed by.
    nested: BTreeMap<String, BTreeSet<String>>,
}

impl Default for ProjectionInputs {
    fn default() -> Self {
        Self::every()
    }
}

impl ProjectionInputs {
    /// Inputs of a host that does not say what its projections read: every
    /// removed field changes its type, and every changed type makes every
    /// document incomplete.
    #[must_use]
    pub fn every() -> Self {
        Self {
            every: true,
            own: BTreeMap::new(),
            nested: BTreeMap::new(),
        }
    }

    /// Inputs of projections that read nothing; add what they read with
    /// [`Self::own`] and [`Self::nested`].
    #[must_use]
    pub fn none() -> Self {
        Self {
            every: false,
            own: BTreeMap::new(),
            nested: BTreeMap::new(),
        }
    }

    /// Documents keyed by a `typename` record read these of its fields.
    #[must_use]
    pub fn own(mut self, typename: &str, fields: &[&str]) -> Self {
        add(&mut self.own, typename, fields);
        self
    }

    /// Documents keyed by other records read these fields of a `typename`
    /// record (a referenced or looked-up record).
    #[must_use]
    pub fn nested(mut self, typename: &str, fields: &[&str]) -> Self {
        add(&mut self.nested, typename, fields);
        self
    }

    /// Every `(typename, field)` named, own and nested.
    pub fn fields(&self) -> impl Iterator<Item = (&str, &str)> {
        self.own
            .iter()
            .chain(&self.nested)
            .flat_map(|(typename, fields)| {
                fields
                    .iter()
                    .map(move |field| (typename.as_str(), field.as_str()))
            })
    }

    /// [`Self::fields`], then what the rows storage derives from records
    /// read.
    pub fn read_fields(&self) -> impl Iterator<Item = (&str, &str)> {
        self.fields().chain(derived())
    }

    /// Whether a projection, or a row storage derives from records, may read
    /// `field` of a `typename` record.
    #[must_use]
    pub fn reads(&self, typename: &str, field: &str) -> bool {
        let listed = |inputs: &BTreeMap<String, BTreeSet<String>>| {
            inputs
                .get(typename)
                .is_some_and(|fields| fields.contains(field))
        };
        self.every
            || listed(&self.own)
            || listed(&self.nested)
            || derived().any(|input| input == (typename, field))
    }

    /// Whether a projection, or a derived row, reads any field of a
    /// `typename` record.
    #[must_use]
    pub fn names(&self, typename: &str) -> bool {
        self.every
            || self.own.contains_key(typename)
            || self.nested.contains_key(typename)
            || derived().any(|(name, _)| name == typename)
    }

    /// Whether documents keyed by other records read a `typename` record, so
    /// dropping its records makes every document incomplete.
    #[must_use]
    pub fn nests(&self, typename: &str) -> bool {
        self.every || self.nested.contains_key(typename)
    }
}

/// The fields the rows storage derives from records read, by record type:
/// Quick Access search rows, calendar ranges and people rows. Dropping a
/// type's records drops its rows, so they make no document incomplete. A new
/// store of derived rows lists what its rows read here, and itself in
/// cache-turso's `DERIVED_STORES`, which empties it when its types change.
fn derived<'a>() -> impl Iterator<Item = (&'a str, &'a str)> {
    crate::search::QUICK_ACCESS_INPUTS
        .iter()
        .copied()
        .chain([
            (
                crate::calendar::OCCURRENCE_TYPENAME,
                crate::calendar::RANGE_INPUTS,
            ),
            (
                crate::people::sql::projection::TYPENAME,
                crate::people::sql::projection::INPUT_FIELDS,
            ),
        ])
        .flat_map(|(typename, fields)| fields.iter().map(move |field| (typename, *field)))
}

fn add(inputs: &mut BTreeMap<String, BTreeSet<String>>, typename: &str, fields: &[&str]) {
    inputs
        .entry(typename.to_owned())
        .or_default()
        .extend(fields.iter().map(|field| (*field).to_owned()));
}
