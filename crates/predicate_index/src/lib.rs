//! Minimal storage-neutral predicate-index intermediate representation.
#![deny(missing_docs)]

use std::{
    cmp::Ordering,
    collections::{BTreeSet, HashSet},
};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Deserializer, Serialize};
use thiserror::Error;

#[cfg(test)]
mod test;

/// Maximum expression depth accepted by the generic index.
pub const MAX_EXPRESSION_DEPTH: usize = 64;
/// Maximum expression nodes accepted by one query.
pub const MAX_EXPRESSION_NODES: usize = 2_048;
/// Maximum query page size.
pub const MAX_QUERY_LIMIT: u16 = 500;
/// Maximum bytes in a token.
pub const MAX_TOKEN_BYTES: usize = 128;
/// Maximum bytes in an exact value.
pub const MAX_EXACT_VALUE_BYTES: usize = 16 * 1_024;
/// Maximum facts in one index document.
pub const MAX_FACTS_PER_DOCUMENT: usize = 256;
/// Maximum distinct records whose optimistic projections may be merged into one query.
pub const MAX_OPTIMISTIC_RECORDS_PER_QUERY: usize = 128;

/// A stable, opaque vocabulary token owned by a profile compiler.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
#[serde(transparent)]
pub struct Token(String);

impl<'de> Deserialize<'de> for Token {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::new(String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

impl Token {
    /// Construct a validated token.
    pub fn new(value: impl Into<String>) -> Result<Self, ValidationError> {
        let value = value.into();
        let valid_bytes = !value.is_empty()
            && value.len() <= MAX_TOKEN_BYTES
            && value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte));
        if !valid_bytes {
            return Err(ValidationError::InvalidToken(value));
        }
        Ok(Self(value))
    }

    /// Read the token text.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A versioned projection and compiler profile.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Profile(Token);

impl Profile {
    /// Construct a profile from a validated token.
    pub fn new(token: Token) -> Self {
        Self(token)
    }

    /// Read the profile token.
    pub fn token(&self) -> &Token {
        &self.0
    }
}

/// A normalized GraphQL cache record key.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
#[serde(transparent)]
pub struct RecordKey(String);

impl<'de> Deserialize<'de> for RecordKey {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::new(String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

impl RecordKey {
    /// Construct a non-empty bounded normalized record key.
    pub fn new(value: impl Into<String>) -> Result<Self, ValidationError> {
        let value = value.into();
        if value.is_empty() || value.len() > MAX_EXACT_VALUE_BYTES {
            return Err(ValidationError::InvalidRecordKey);
        }
        Ok(Self(value))
    }

    /// Read the normalized key.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Canonical bytes for an exact-match posting value.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
#[serde(transparent)]
pub struct ExactValue(Vec<u8>);

impl<'de> Deserialize<'de> for ExactValue {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::new(Vec::<u8>::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

impl ExactValue {
    /// Construct a bounded exact value.
    pub fn new(bytes: impl Into<Vec<u8>>) -> Result<Self, ValidationError> {
        let bytes = bytes.into();
        if bytes.len() > MAX_EXACT_VALUE_BYTES {
            return Err(ValidationError::ExactValueTooLarge(bytes.len()));
        }
        Ok(Self(bytes))
    }

    /// Construct a canonical UTF-8 value.
    pub fn utf8(value: impl AsRef<str>) -> Result<Self, ValidationError> {
        Self::new(value.as_ref().as_bytes())
    }

    /// Read the canonical bytes.
    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }
}

/// One side of an integer range.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RangeBound {
    /// Include the bound value.
    Inclusive(i64),
    /// Exclude the bound value.
    Exclusive(i64),
}

/// A bounded Boolean predicate over generic facts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PredicateExpr {
    /// Match every document in the selected profile/partition universe.
    All,
    /// Match no documents.
    None,
    /// Match an exact posting.
    Exact {
        /// Fact vocabulary token.
        attribute: Token,
        /// Canonical exact value.
        value: ExactValue,
    },
    /// Match an ordered integer range.
    I64Range {
        /// Fact vocabulary token.
        attribute: Token,
        /// Optional lower bound.
        lower: Option<RangeBound>,
        /// Optional upper bound.
        upper: Option<RangeBound>,
    },
    /// Intersect two result sets.
    And(Box<Self>, Box<Self>),
    /// Union two result sets.
    Or(Box<Self>, Box<Self>),
    /// Subtract a result set from the profile/partition universe.
    Not(Box<Self>),
}

impl PredicateExpr {
    /// Validate bounds and apply non-expanding Boolean identities.
    pub fn validate_and_simplify(self) -> Result<Self, ValidationError> {
        let mut stack = vec![(&self, 1usize)];
        let mut nodes = 0usize;
        while let Some((expr, depth)) = stack.pop() {
            if depth > MAX_EXPRESSION_DEPTH {
                return Err(ValidationError::ExpressionDepth);
            }
            nodes += 1;
            if nodes > MAX_EXPRESSION_NODES {
                return Err(ValidationError::ExpressionNodes);
            }
            match expr {
                Self::And(left, right) | Self::Or(left, right) => {
                    stack.push((left, depth + 1));
                    stack.push((right, depth + 1));
                }
                Self::Not(expr) => stack.push((expr, depth + 1)),
                Self::All | Self::None | Self::Exact { .. } | Self::I64Range { .. } => {}
            }
        }

        simplify(self)
    }
}

/// One exact fact in an index document.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ExactFact {
    /// Fact vocabulary token.
    pub attribute: Token,
    /// Canonical exact value.
    pub value: ExactValue,
}

/// One ordered integer fact in an index document.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct IntegerFact {
    /// Fact vocabulary token.
    pub attribute: Token,
    /// Integer value.
    pub value: i64,
}

/// Generic projection of one normalized cache record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IndexDocument {
    /// Normalized cache record key.
    pub record_key: RecordKey,
    /// Projection profile.
    pub profile: Profile,
    /// Entity partition token.
    pub partition: Token,
    /// Exact-match facts.
    pub exact_facts: Vec<ExactFact>,
    /// Ordered integer facts.
    pub integer_facts: Vec<IntegerFact>,
    /// Ordered sort facts.
    pub sort_facts: Vec<IntegerFact>,
}

impl IndexDocument {
    /// Put facts in deterministic order and remove duplicate membership facts.
    pub fn canonicalize(&mut self) {
        self.exact_facts.sort();
        self.exact_facts.dedup();
        self.integer_facts.sort();
        self.integer_facts.dedup();
        self.sort_facts.sort();
    }

    /// Validate bounded fact counts and unique sort attributes.
    pub fn validate(&self) -> Result<(), ValidationError> {
        let facts = self.exact_facts.len() + self.integer_facts.len() + self.sort_facts.len();
        if facts > MAX_FACTS_PER_DOCUMENT {
            return Err(ValidationError::DocumentFacts);
        }
        let mut sort_attributes = HashSet::new();
        if self
            .sort_facts
            .iter()
            .any(|fact| !sort_attributes.insert(&fact.attribute))
        {
            return Err(ValidationError::DuplicateSortFact);
        }
        Ok(())
    }

    /// Evaluate an expression against this document's facts.
    pub fn matches(&self, expr: &PredicateExpr) -> bool {
        match expr {
            PredicateExpr::All => true,
            PredicateExpr::None => false,
            PredicateExpr::Exact { attribute, value } => self
                .exact_facts
                .iter()
                .any(|fact| &fact.attribute == attribute && &fact.value == value),
            PredicateExpr::I64Range {
                attribute,
                lower,
                upper,
            } => self.integer_facts.iter().any(|fact| {
                &fact.attribute == attribute
                    && lower.is_none_or(|bound| lower_matches(fact.value, bound))
                    && upper.is_none_or(|bound| upper_matches(fact.value, bound))
            }),
            PredicateExpr::And(left, right) => self.matches(left) && self.matches(right),
            PredicateExpr::Or(left, right) => self.matches(left) || self.matches(right),
            PredicateExpr::Not(expr) => !self.matches(expr),
        }
    }
}

/// Predicate for one entity partition.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PartitionPredicate {
    /// Partition vocabulary token.
    pub partition: Token,
    /// Predicate evaluated only inside that partition's universe.
    pub predicate: PredicateExpr,
}

/// Ordering direction for a local initial page.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SortDirection {
    /// Lowest values first.
    Asc,
    /// Highest values first.
    Desc,
}

/// Unvalidated generic exact-index query descriptor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IndexQuery {
    /// Required profile.
    pub profile: Profile,
    /// Complete partition predicates.
    pub partitions: Vec<PartitionPredicate>,
    /// Sort-fact attribute.
    pub sort_attribute: Token,
    /// Sort direction.
    pub sort_direction: SortDirection,
    /// Stable record-key tie-break direction.
    pub tie_break_direction: SortDirection,
    /// Bounded initial-page size.
    pub limit: u16,
}

/// Validated generic exact-index query.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct ValidatedIndexQuery(IndexQuery);

impl<'de> Deserialize<'de> for ValidatedIndexQuery {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::new(IndexQuery::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

impl ValidatedIndexQuery {
    /// Validate and simplify a query descriptor.
    pub fn new(mut query: IndexQuery) -> Result<Self, ValidationError> {
        if query.limit == 0 || query.limit > MAX_QUERY_LIMIT {
            return Err(ValidationError::Limit(query.limit));
        }
        if query.partitions.is_empty() {
            return Err(ValidationError::NoPartitions);
        }
        let mut partitions = HashSet::new();
        for partition in &mut query.partitions {
            if !partitions.insert(&partition.partition) {
                return Err(ValidationError::DuplicatePartition);
            }
            partition.predicate = std::mem::replace(&mut partition.predicate, PredicateExpr::None)
                .validate_and_simplify()?;
        }
        Ok(Self(query))
    }

    /// Access the validated descriptor.
    pub fn as_query(&self) -> &IndexQuery {
        &self.0
    }

    /// Clone this query with a different validated initial-page limit.
    pub fn with_limit(&self, limit: u16) -> Result<Self, ValidationError> {
        let mut query = self.0.clone();
        query.limit = limit;
        Self::new(query)
    }

    /// Whether this query can inspect documents in `profile` and `partition`.
    pub fn includes_scope(&self, profile: &Profile, partition: &Token) -> bool {
        self.0.profile == *profile
            && self
                .0
                .partitions
                .iter()
                .any(|candidate| candidate.partition == *partition)
    }

    /// Whether this query depends on an attribute in one selected partition.
    ///
    /// The sort attribute is always a dependency. Predicate attributes are
    /// collected without expanding the Boolean expression.
    pub fn depends_on_attribute(&self, partition: &Token, attribute: &Token) -> bool {
        let Some(candidate) = self
            .0
            .partitions
            .iter()
            .find(|candidate| candidate.partition == *partition)
        else {
            return false;
        };
        self.0.sort_attribute == *attribute
            || expression_depends_on(&candidate.predicate, attribute)
    }

    /// Collect predicate and sort attributes inspected in one selected partition.
    pub fn dependent_attributes(&self, partition: &Token) -> BTreeSet<Token> {
        let mut attributes = BTreeSet::from([self.0.sort_attribute.clone()]);
        if let Some(candidate) = self
            .0
            .partitions
            .iter()
            .find(|candidate| candidate.partition == *partition)
        {
            collect_expression_attributes(&candidate.predicate, &mut attributes);
        }
        attributes
    }
}

/// Why a known projection is not currently safe to query.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProjectionIncompleteKind {
    /// An update may have changed indexed facts.
    Dirty,
    /// A supported normalized record arrived without its required projection.
    Missing,
    /// The record carries a projection version this client cannot interpret.
    IncompatibleVersion,
}

/// Current effective uncertainty after composing optimistic projection changes.
///
/// `AllExcept` is needed so an exact later patch can make one attribute known
/// after a wildcard unknown mutation without incorrectly clearing uncertainty
/// for every other possible profile attribute.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum OptimisticUncertainty {
    /// Only the listed attributes are uncertain.
    Attributes(BTreeSet<Token>),
    /// Every attribute except the listed attributes is uncertain.
    AllExcept(BTreeSet<Token>),
}

impl Default for OptimisticUncertainty {
    fn default() -> Self {
        Self::Attributes(BTreeSet::new())
    }
}

impl OptimisticUncertainty {
    /// Whether no attribute is uncertain.
    pub fn is_empty(&self) -> bool {
        matches!(self, Self::Attributes(attributes) if attributes.is_empty())
    }

    /// Whether one attribute remains uncertain.
    pub fn affects(&self, attribute: &Token) -> bool {
        match self {
            Self::Attributes(attributes) => attributes.contains(attribute),
            Self::AllExcept(certain) => !certain.contains(attribute),
        }
    }

    /// Mark listed attributes uncertain, or every attribute when the slice is empty.
    pub fn mark(&mut self, attributes: &[Token]) {
        if attributes.is_empty() {
            *self = Self::AllExcept(BTreeSet::new());
            return;
        }
        match self {
            Self::Attributes(uncertain) => uncertain.extend(attributes.iter().cloned()),
            Self::AllExcept(certain) => {
                for attribute in attributes {
                    certain.remove(attribute);
                }
            }
        }
    }

    /// Mark attributes exact after a deterministic replacement patch.
    pub fn clear(&mut self, attributes: impl IntoIterator<Item = Token>) {
        match self {
            Self::Attributes(uncertain) => {
                for attribute in attributes {
                    uncertain.remove(&attribute);
                }
            }
            Self::AllExcept(certain) => certain.extend(attributes),
        }
    }
}

/// Current fully composed optimistic projection for one record key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum OptimisticProjectionState {
    /// Complete effective facts.
    Complete(IndexDocument),
    /// Effective tombstone. Authoritative facts remain suppressed.
    Deleted {
        /// Normalized record key.
        record_key: RecordKey,
        /// Projection profile.
        profile: Profile,
        /// Entity partition.
        partition: Token,
    },
    /// Authority is suppressed, but exact effective facts cannot be proven.
    Incomplete {
        /// Normalized record key.
        record_key: RecordKey,
        /// Projection profile.
        profile: Profile,
        /// Entity partition.
        partition: Token,
        /// Why exact composition failed.
        kind: ProjectionIncompleteKind,
    },
}

impl OptimisticProjectionState {
    /// Read the affected normalized record key.
    pub fn record_key(&self) -> &RecordKey {
        match self {
            Self::Complete(document) => &document.record_key,
            Self::Deleted { record_key, .. } | Self::Incomplete { record_key, .. } => record_key,
        }
    }

    /// Read the effective profile.
    pub fn profile(&self) -> &Profile {
        match self {
            Self::Complete(document) => &document.profile,
            Self::Deleted { profile, .. } | Self::Incomplete { profile, .. } => profile,
        }
    }

    /// Read the effective partition.
    pub fn partition(&self) -> &Token {
        match self {
            Self::Complete(document) => &document.partition,
            Self::Deleted { partition, .. } | Self::Incomplete { partition, .. } => partition,
        }
    }

    /// Validate complete facts when this state contains a document.
    pub fn validate(&self) -> Result<(), ValidationError> {
        match self {
            Self::Complete(document) => document.validate(),
            Self::Deleted { .. } | Self::Incomplete { .. } => Ok(()),
        }
    }
}

/// Effective shadow value whose owner already has a durable mutation ID.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EffectiveOptimisticProjection {
    /// Greatest active mutation ID affecting this record.
    pub owner: u64,
    /// Fully composed projection, tombstone, or incomplete marker.
    pub state: OptimisticProjectionState,
    /// Uncertainty still effective after all active mutations.
    pub uncertainty: OptimisticUncertainty,
}

impl EffectiveOptimisticProjection {
    /// Validate owner and effective projection bounds.
    pub fn validate(&self) -> Result<(), ValidationError> {
        if self.owner == 0 {
            return Err(ValidationError::InvalidOptimisticOwner);
        }
        self.state.validate()
    }
}

/// Effective shadow value awaiting the mutation ID assigned during enqueue.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PendingOptimisticProjection {
    /// Fully composed projection, tombstone, or incomplete marker.
    pub state: OptimisticProjectionState,
    /// Uncertainty still effective after applying the new mutation.
    pub uncertainty: OptimisticUncertainty,
}

impl PendingOptimisticProjection {
    /// Validate effective projection bounds.
    pub fn validate(&self) -> Result<(), ValidationError> {
        self.state.validate()
    }
}

/// One ordered optimistic change to a generic projection.
///
/// Optimistic changes are layered over authoritative [`IndexDocument`] values;
/// they never overwrite the authoritative projection needed for rollback.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum OptimisticProjectionMutation {
    /// Replace the effective projection with a complete optimistic document.
    Replace(IndexDocument),
    /// Replace selected attributes on the preceding effective projection.
    Patch {
        /// Normalized record key.
        record_key: RecordKey,
        /// Projection profile.
        profile: Profile,
        /// Entity partition.
        partition: Token,
        /// Complete replacement values for each exact attribute.
        exact: Vec<ExactAttributePatch>,
        /// Complete replacement values for each integer attribute.
        integers: Vec<IntegerAttributePatch>,
        /// Replacement values for sort attributes.
        sorts: Vec<IntegerFact>,
    },
    /// Hide the record from the effective local view while retaining its base projection.
    Delete {
        /// Normalized record key.
        record_key: RecordKey,
        /// Projection profile.
        profile: Profile,
        /// Entity partition.
        partition: Token,
    },
    /// The optimistic mutation may change facts that were not deterministically projected.
    Unknown {
        /// Normalized record key.
        record_key: RecordKey,
        /// Projection profile.
        profile: Profile,
        /// Entity partition.
        partition: Token,
        /// Potentially changed attributes. Empty means every attribute.
        affected_attributes: Vec<Token>,
    },
}

/// Complete replacement of one exact attribute's values.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExactAttributePatch {
    /// Attribute to replace.
    pub attribute: Token,
    /// New values. Empty removes the attribute from the effective projection.
    pub values: Vec<ExactValue>,
}

/// Complete replacement of one integer attribute's values.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IntegerAttributePatch {
    /// Attribute to replace.
    pub attribute: Token,
    /// New values. Empty removes the attribute from the effective projection.
    pub values: Vec<i64>,
}

impl OptimisticProjectionMutation {
    /// Validate the optimistic projection payload.
    pub fn validate(&self) -> Result<(), ValidationError> {
        let Self::Patch {
            exact,
            integers,
            sorts,
            ..
        } = self
        else {
            return match self {
                Self::Replace(document) => document.validate(),
                Self::Delete { .. } | Self::Unknown { .. } => Ok(()),
                Self::Patch { .. } => unreachable!(),
            };
        };

        let mut attributes = HashSet::new();
        if exact
            .iter()
            .any(|patch| !attributes.insert(&patch.attribute))
        {
            return Err(ValidationError::DuplicateExactPatchAttribute);
        }
        attributes.clear();
        if integers
            .iter()
            .any(|patch| !attributes.insert(&patch.attribute))
        {
            return Err(ValidationError::DuplicateIntegerPatchAttribute);
        }
        attributes.clear();
        if sorts.iter().any(|fact| !attributes.insert(&fact.attribute)) {
            return Err(ValidationError::DuplicateSortPatchAttribute);
        }
        Ok(())
    }

    /// Read the affected normalized record key.
    pub fn record_key(&self) -> &RecordKey {
        match self {
            Self::Replace(document) => &document.record_key,
            Self::Patch { record_key, .. }
            | Self::Delete { record_key, .. }
            | Self::Unknown { record_key, .. } => record_key,
        }
    }

    /// Read the affected profile.
    pub fn profile(&self) -> &Profile {
        match self {
            Self::Replace(document) => &document.profile,
            Self::Patch { profile, .. }
            | Self::Delete { profile, .. }
            | Self::Unknown { profile, .. } => profile,
        }
    }

    /// Read the affected partition.
    pub fn partition(&self) -> &Token {
        match self {
            Self::Replace(document) => &document.partition,
            Self::Patch { partition, .. }
            | Self::Delete { partition, .. }
            | Self::Unknown { partition, .. } => partition,
        }
    }

    /// Whether uncertainty in this mutation intersects a validated query.
    pub fn makes_query_uncertain(&self, query: &ValidatedIndexQuery) -> bool {
        let Self::Unknown {
            profile,
            partition,
            affected_attributes,
            ..
        } = self
        else {
            return false;
        };
        query.includes_scope(profile, partition)
            && (affected_attributes.is_empty()
                || affected_attributes
                    .iter()
                    .any(|attribute| query.depends_on_attribute(partition, attribute)))
    }
}

/// Validation failure for generic index input.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum ValidationError {
    /// A token is empty, too long, or contains non-portable bytes.
    #[error("invalid predicate-index token `{0}`")]
    InvalidToken(String),
    /// A normalized record key is empty or too large.
    #[error("invalid normalized record key")]
    InvalidRecordKey,
    /// An exact value is too large.
    #[error("exact value has {0} bytes")]
    ExactValueTooLarge(usize),
    /// The expression is too deep.
    #[error("predicate expression exceeds maximum depth")]
    ExpressionDepth,
    /// The expression contains too many nodes.
    #[error("predicate expression exceeds maximum node count")]
    ExpressionNodes,
    /// An integer range is inverted or empty.
    #[error("invalid integer range")]
    InvalidRange,
    /// A document contains too many facts.
    #[error("index document contains too many facts")]
    DocumentFacts,
    /// A document has more than one sort value for an attribute.
    #[error("duplicate sort fact attribute")]
    DuplicateSortFact,
    /// An optimistic patch repeats an exact attribute.
    #[error("duplicate exact patch attribute")]
    DuplicateExactPatchAttribute,
    /// An optimistic patch repeats an integer attribute.
    #[error("duplicate integer patch attribute")]
    DuplicateIntegerPatchAttribute,
    /// An optimistic patch repeats a sort attribute.
    #[error("duplicate sort patch attribute")]
    DuplicateSortPatchAttribute,
    /// A query has no partition universes.
    #[error("index query has no partitions")]
    NoPartitions,
    /// A query repeats a partition.
    #[error("index query repeats a partition")]
    DuplicatePartition,
    /// A query limit is zero or too large.
    #[error("invalid index query limit {0}")]
    Limit(u16),
    /// A durable effective optimistic projection has no active owner.
    #[error("effective optimistic projection owner must be non-zero")]
    InvalidOptimisticOwner,
}

/// Pure reference result used for adapter conformance tests.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReferenceHit {
    /// Normalized cache record key.
    pub record_key: RecordKey,
    /// Sort value selected by the query.
    pub sort_value: i64,
}

/// Evaluate a validated query over generic documents without storage.
pub fn evaluate_reference(
    query: &ValidatedIndexQuery,
    documents: &[IndexDocument],
) -> Vec<ReferenceHit> {
    let query = query.as_query();
    let mut hits = documents
        .iter()
        .filter(|document| document.profile == query.profile)
        .filter_map(|document| {
            let partition = query
                .partitions
                .iter()
                .find(|partition| partition.partition == document.partition)?;
            if !document.matches(&partition.predicate) {
                return None;
            }
            let sort_value = document
                .sort_facts
                .iter()
                .find(|fact| fact.attribute == query.sort_attribute)?
                .value;
            Some(ReferenceHit {
                record_key: document.record_key.clone(),
                sort_value,
            })
        })
        .collect::<Vec<_>>();

    hits.sort_by(|left, right| {
        directional_cmp(left.sort_value.cmp(&right.sort_value), query.sort_direction).then_with(
            || {
                directional_cmp(
                    left.record_key.cmp(&right.record_key),
                    query.tie_break_direction,
                )
            },
        )
    });
    hits.truncate(usize::from(query.limit));
    hits
}

/// Encode a UTC timestamp as signed Unix microseconds without millisecond loss.
pub fn utc_timestamp_micros(value: DateTime<Utc>) -> i64 {
    value.timestamp_micros()
}

fn expression_depends_on(expr: &PredicateExpr, attribute: &Token) -> bool {
    match expr {
        PredicateExpr::Exact {
            attribute: candidate,
            ..
        }
        | PredicateExpr::I64Range {
            attribute: candidate,
            ..
        } => candidate == attribute,
        PredicateExpr::And(left, right) | PredicateExpr::Or(left, right) => {
            expression_depends_on(left, attribute) || expression_depends_on(right, attribute)
        }
        PredicateExpr::Not(expr) => expression_depends_on(expr, attribute),
        PredicateExpr::All | PredicateExpr::None => false,
    }
}

fn collect_expression_attributes(expr: &PredicateExpr, attributes: &mut BTreeSet<Token>) {
    match expr {
        PredicateExpr::Exact { attribute, .. } | PredicateExpr::I64Range { attribute, .. } => {
            attributes.insert(attribute.clone());
        }
        PredicateExpr::And(left, right) | PredicateExpr::Or(left, right) => {
            collect_expression_attributes(left, attributes);
            collect_expression_attributes(right, attributes);
        }
        PredicateExpr::Not(expr) => collect_expression_attributes(expr, attributes),
        PredicateExpr::All | PredicateExpr::None => {}
    }
}

fn simplify(expr: PredicateExpr) -> Result<PredicateExpr, ValidationError> {
    Ok(match expr {
        PredicateExpr::And(left, right) => match (simplify(*left)?, simplify(*right)?) {
            (PredicateExpr::None, _) | (_, PredicateExpr::None) => PredicateExpr::None,
            (PredicateExpr::All, right) => right,
            (left, PredicateExpr::All) => left,
            (left, right) => PredicateExpr::And(Box::new(left), Box::new(right)),
        },
        PredicateExpr::Or(left, right) => match (simplify(*left)?, simplify(*right)?) {
            (PredicateExpr::All, _) | (_, PredicateExpr::All) => PredicateExpr::All,
            (PredicateExpr::None, right) => right,
            (left, PredicateExpr::None) => left,
            (left, right) => PredicateExpr::Or(Box::new(left), Box::new(right)),
        },
        PredicateExpr::Not(expr) => match simplify(*expr)? {
            PredicateExpr::All => PredicateExpr::None,
            PredicateExpr::None => PredicateExpr::All,
            PredicateExpr::Not(expr) => *expr,
            expr => PredicateExpr::Not(Box::new(expr)),
        },
        PredicateExpr::I64Range {
            attribute,
            lower,
            upper,
        } => {
            validate_range(lower, upper)?;
            PredicateExpr::I64Range {
                attribute,
                lower,
                upper,
            }
        }
        expr @ (PredicateExpr::All | PredicateExpr::None | PredicateExpr::Exact { .. }) => expr,
    })
}

fn validate_range(
    lower: Option<RangeBound>,
    upper: Option<RangeBound>,
) -> Result<(), ValidationError> {
    let Some(lower) = lower else { return Ok(()) };
    let Some(upper) = upper else { return Ok(()) };
    let lower_value = match lower {
        RangeBound::Inclusive(value) | RangeBound::Exclusive(value) => value,
    };
    let upper_value = match upper {
        RangeBound::Inclusive(value) | RangeBound::Exclusive(value) => value,
    };
    let non_empty_at_equality =
        matches!(lower, RangeBound::Inclusive(_)) && matches!(upper, RangeBound::Inclusive(_));
    if lower_value > upper_value || (lower_value == upper_value && !non_empty_at_equality) {
        return Err(ValidationError::InvalidRange);
    }
    Ok(())
}

fn lower_matches(value: i64, bound: RangeBound) -> bool {
    match bound {
        RangeBound::Inclusive(lower) => value >= lower,
        RangeBound::Exclusive(lower) => value > lower,
    }
}

fn upper_matches(value: i64, bound: RangeBound) -> bool {
    match bound {
        RangeBound::Inclusive(upper) => value <= upper,
        RangeBound::Exclusive(upper) => value < upper,
    }
}

fn directional_cmp(ordering: Ordering, direction: SortDirection) -> Ordering {
    match direction {
        SortDirection::Asc => ordering,
        SortDirection::Desc => ordering.reverse(),
    }
}
