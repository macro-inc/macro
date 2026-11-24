//! A planned lane: the query the stream runs page by page and what it
//! declares to the cache on the lane's `lane` line.

#[cfg(test)]
mod test;

use crate::calendar::CalendarSpan;
use async_graphql::parser::{
    self, parse_query,
    types::{DocumentOperations, ExecutableDocument, OperationType},
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

const MAX_LANE_ID_LEN: usize = 64;
/// The variable every lane pages through.
pub(crate) const INPUT_VARIABLE: &str = "input";
const SOUP_INITIAL: &str = "initial";
const SOUP_CONTINUATION: &str = "continuation";
/// Fields a Soup continuation copies from the lane's first input.
pub(crate) const SOUP_CARRIED_FIELDS: [&str; 3] = ["expand", "emailView", "sortDirection"];

/// A lane's identifier: `[a-z0-9-]{1,64}`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct LaneId(String);

/// A lane id outside `[a-z0-9-]{1,64}`.
#[derive(Debug, thiserror::Error)]
#[error("lane id must match [a-z0-9-]{{1,64}}")]
pub struct InvalidLaneId;

impl LaneId {
    /// The id as sent on the wire.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for LaneId {
    type Error = InvalidLaneId;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        let valid = !value.is_empty()
            && value.len() <= MAX_LANE_ID_LEN
            && value
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-');
        if valid {
            Ok(Self(value))
        } else {
            Err(InvalidLaneId)
        }
    }
}

impl From<LaneId> for String {
    fn from(value: LaneId) -> Self {
        value.0
    }
}

impl std::fmt::Display for LaneId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// Where a lane's pages keep their items and next cursor, as declared.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Paging {
    /// `data.user.soup`: `items` and `nextCursor`.
    Soup,
    /// `data.user.calendarOccurrences`: `nodes`, `hasNextPage` and `endCursor`.
    Calendar,
}

/// What the cache does with a lane's pages, as declared.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LaneKind {
    /// Write every page and record its items as members of the lane.
    Hydrate,
    /// Write nothing; once the lane completes, delete the members of `scopes`
    /// it did not list.
    Membership {
        /// Lanes whose members this listing is authoritative for.
        scopes: Vec<LaneId>,
    },
    /// Write every page; once the lane completes, record `coverage` as
    /// fetched.
    Calendar {
        /// The spans the lane's pages cover.
        coverage: Vec<CalendarSpan>,
    },
}

/// A lane's paging mode with what its next-page variables are built from.
#[derive(Debug)]
pub(crate) enum LanePaging {
    /// Next input is `{continuation: {cursor, ...carried}}`.
    Soup {
        /// `expand`, `emailView` and `sortDirection` from the first input, when present.
        carried: Map<String, Value>,
    },
    /// Next input is the first input with `after` set.
    Calendar {
        /// The lane's first input.
        input: Map<String, Value>,
    },
}

impl LanePaging {
    pub(crate) fn wire(&self) -> Paging {
        match self {
            Self::Soup { .. } => Paging::Soup,
            Self::Calendar { .. } => Paging::Calendar,
        }
    }
}

/// A lane the catalog cannot build: a server bug, never the client's.
#[derive(Debug, thiserror::Error)]
pub enum LaneError {
    /// The id is not `[a-z0-9-]{1,64}`.
    #[error("lane id must match [a-z0-9-]{{1,64}}")]
    InvalidId,
    /// The query is not valid GraphQL.
    #[error("query does not parse: {0}")]
    QueryParse(#[source] parser::Error),
    /// The operation name selects no query operation.
    #[error("query has no query operation `{0}`")]
    OperationNotSelected(String),
    /// The variables have no pageable `input` object.
    #[error("variables need an `input` object of the paging's shape")]
    InvalidInput,
}

/// What a lane is planned from.
#[derive(Debug)]
pub(crate) struct LaneDraft {
    pub(crate) id: LaneId,
    pub(crate) query: &'static str,
    pub(crate) operation_name: &'static str,
    /// What the lane's first page runs.
    pub(crate) variables: Map<String, Value>,
    pub(crate) paging: Paging,
    pub(crate) kind: LaneKind,
    /// Stop once the pass has sent at least this many items.
    pub(crate) max_items: Option<u32>,
    /// Items the pass sent in earlier streams.
    pub(crate) items_before: u32,
    /// Its pages carry a `resume` checkpoint.
    pub(crate) resumable: bool,
    /// When the lane's pass started (ISO 8601).
    pub(crate) pass_started_at: String,
}

/// One planned lane.
#[derive(Debug)]
pub(crate) struct LanePlan {
    pub(crate) id: LaneId,
    pub(crate) query: &'static str,
    pub(crate) operation_name: &'static str,
    /// Parsed once and reused for every page.
    pub(crate) document: ExecutableDocument,
    /// What the lane's first page runs.
    pub(crate) variables: Map<String, Value>,
    pub(crate) paging: LanePaging,
    pub(crate) kind: LaneKind,
    pub(crate) max_items: Option<u32>,
    pub(crate) items_before: u32,
    pub(crate) resumable: bool,
    pub(crate) pass_started_at: String,
}

impl LanePlan {
    /// Parses the draft's query and derives how its pages continue.
    pub(crate) fn new(draft: LaneDraft) -> Result<Self, LaneError> {
        let document = parse_query(draft.query).map_err(LaneError::QueryParse)?;
        if selected_operation(&document.operations, draft.operation_name)
            != Some(OperationType::Query)
        {
            return Err(LaneError::OperationNotSelected(
                draft.operation_name.to_owned(),
            ));
        }
        let input = draft
            .variables
            .get(INPUT_VARIABLE)
            .and_then(Value::as_object)
            .ok_or(LaneError::InvalidInput)?;
        let paging = match draft.paging {
            Paging::Soup => LanePaging::Soup {
                carried: soup_carried_fields(input).ok_or(LaneError::InvalidInput)?,
            },
            Paging::Calendar => LanePaging::Calendar {
                input: input.clone(),
            },
        };
        Ok(Self {
            id: draft.id,
            query: draft.query,
            operation_name: draft.operation_name,
            document,
            variables: draft.variables,
            paging,
            kind: draft.kind,
            max_items: draft.max_items,
            items_before: draft.items_before,
            resumable: draft.resumable,
            pass_started_at: draft.pass_started_at,
        })
    }
}

/// The named operation's type, as async-graphql selects it in `Schema::execute`.
fn selected_operation(operations: &DocumentOperations, name: &str) -> Option<OperationType> {
    match operations {
        DocumentOperations::Single(_) => None,
        DocumentOperations::Multiple(operations) => {
            operations.get(name).map(|operation| operation.node.ty)
        }
    }
}

/// `expand`, `emailView` and `sortDirection` from a Soup input's single `initial` or
/// `continuation` object; `None` when the input has another shape.
fn soup_carried_fields(input: &Map<String, Value>) -> Option<Map<String, Value>> {
    if input.len() != 1 {
        return None;
    }
    let (key, first) = input.iter().next()?;
    if key != SOUP_INITIAL && key != SOUP_CONTINUATION {
        return None;
    }
    let first = first.as_object()?;
    Some(
        SOUP_CARRIED_FIELDS
            .iter()
            .filter_map(|field| {
                first
                    .get(*field)
                    .map(|value| ((*field).to_owned(), value.clone()))
            })
            .collect(),
    )
}
