//! The request body of the sync stream and its validation.

#[cfg(test)]
mod test;

use async_graphql::parser::{
    self, parse_query,
    types::{DocumentOperations, ExecutableDocument, OperationType},
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashSet;

/// Most lanes one stream may carry.
pub const MAX_LANES: usize = 32;
const MAX_LANE_ID_LEN: usize = 64;
/// The variable every lane pages through.
pub(crate) const INPUT_VARIABLE: &str = "input";
const SOUP_INITIAL: &str = "initial";
const SOUP_CONTINUATION: &str = "continuation";
/// Fields a Soup continuation copies from the lane's first input.
const SOUP_CARRIED_FIELDS: [&str; 3] = ["expand", "emailView", "sortDirection"];

/// A lane's identifier: `[a-z0-9-]{1,64}`, unique within a request.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct LaneId(String);

/// A lane id outside `[a-z0-9-]{1,64}`.
#[derive(Debug, thiserror::Error)]
#[error("lane id must match [a-z0-9-]{{1,64}}")]
pub struct InvalidLaneId;

impl LaneId {
    /// The id as sent by the client.
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

/// How a lane finds its items and next page.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
enum Paging {
    /// `data.user.soup`: `items` and `nextCursor`.
    Soup,
    /// `data.user.calendarOccurrences`: `nodes`, `hasNextPage` and `endCursor`.
    Calendar,
}

/// The JSON request body.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncStreamRequest {
    lanes: Vec<LaneRequest>,
    max_pages: Option<u32>,
}

/// One lane of the JSON request body.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaneRequest {
    id: LaneId,
    query: String,
    operation_name: Option<String>,
    variables: Map<String, Value>,
    paging: Paging,
    max_items: Option<u32>,
}

/// Why a request body was rejected (HTTP 400).
#[derive(Debug, thiserror::Error)]
pub enum RequestError {
    /// The body is not JSON of the request shape.
    #[error("invalid request body: {0}")]
    Body(#[from] serde_json::Error),
    /// More than [`MAX_LANES`] lanes.
    #[error("a stream carries at most {MAX_LANES} lanes, got {0}")]
    TooManyLanes(usize),
    /// Two lanes share an id.
    #[error("lane id `{0}` appears more than once")]
    DuplicateLane(LaneId),
    /// A lane's query is not valid GraphQL.
    #[error("lane `{lane}` query does not parse: {source}")]
    QueryParse {
        /// The lane.
        lane: LaneId,
        /// The parser's error.
        #[source]
        source: parser::Error,
    },
    /// A lane's `operationName` selects no operation, or the document has
    /// several operations and no name.
    #[error("lane `{0}` does not select exactly one operation")]
    OperationNotSelected(LaneId),
    /// A lane selects a mutation or subscription.
    #[error("lane `{lane}` selects a {kind} operation; only queries are allowed")]
    NotQuery {
        /// The lane.
        lane: LaneId,
        /// The selected operation's type.
        kind: OperationType,
    },
    /// A lane's variables have no `input` object to page through.
    #[error("lane `{0}` variables need an `input` object")]
    MissingInput(LaneId),
    /// A Soup lane's input is not `{initial: {...}}` or `{continuation: {...}}`.
    #[error("lane `{0}` soup input must be {{initial: {{...}}}} or {{continuation: {{...}}}}")]
    InvalidSoupInput(LaneId),
}

/// A validated stream request: the lanes to run, in order, and the page budget.
#[derive(Debug)]
pub struct SyncPlan {
    pub(crate) lanes: Vec<LanePlan>,
    pub(crate) max_pages: Option<u32>,
}

/// One validated lane.
#[derive(Debug)]
pub(crate) struct LanePlan {
    pub(crate) id: LaneId,
    pub(crate) query: String,
    pub(crate) operation_name: Option<String>,
    /// Parsed once and reused for every page.
    pub(crate) document: ExecutableDocument,
    /// What the lane's first page runs.
    pub(crate) variables: Map<String, Value>,
    pub(crate) paging: LanePaging,
    pub(crate) max_items: Option<u32>,
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

impl SyncPlan {
    /// Parses and validates a request body.
    pub fn from_json(body: &[u8]) -> Result<Self, RequestError> {
        let request: SyncStreamRequest = serde_json::from_slice(body)?;
        if request.lanes.len() > MAX_LANES {
            return Err(RequestError::TooManyLanes(request.lanes.len()));
        }
        let mut seen = HashSet::new();
        let lanes = request
            .lanes
            .into_iter()
            .map(|lane| {
                if !seen.insert(lane.id.clone()) {
                    return Err(RequestError::DuplicateLane(lane.id));
                }
                lane.into_plan()
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self {
            lanes,
            max_pages: request.max_pages,
        })
    }

    /// How many lanes the stream runs.
    pub fn lane_count(&self) -> usize {
        self.lanes.len()
    }
}

impl LaneRequest {
    fn into_plan(self) -> Result<LanePlan, RequestError> {
        let document = parse_query(&self.query).map_err(|source| RequestError::QueryParse {
            lane: self.id.clone(),
            source,
        })?;
        match selected_operation(&document.operations, self.operation_name.as_deref()) {
            None => return Err(RequestError::OperationNotSelected(self.id)),
            Some(OperationType::Query) => {}
            Some(kind) => {
                return Err(RequestError::NotQuery {
                    lane: self.id,
                    kind,
                });
            }
        }
        let Some(input) = self
            .variables
            .get(INPUT_VARIABLE)
            .and_then(Value::as_object)
        else {
            return Err(RequestError::MissingInput(self.id));
        };
        let paging = match self.paging {
            Paging::Soup => match soup_carried_fields(input) {
                Some(carried) => LanePaging::Soup { carried },
                None => return Err(RequestError::InvalidSoupInput(self.id)),
            },
            Paging::Calendar => LanePaging::Calendar {
                input: input.clone(),
            },
        };
        Ok(LanePlan {
            id: self.id,
            query: self.query,
            operation_name: self.operation_name,
            document,
            variables: self.variables,
            paging,
            max_items: self.max_items,
        })
    }
}

/// Mirrors async-graphql's operation selection in `Schema::execute`.
fn selected_operation(
    operations: &DocumentOperations,
    requested_name: Option<&str>,
) -> Option<OperationType> {
    match (operations, requested_name) {
        (DocumentOperations::Single(operation), None) => Some(operation.node.ty),
        (DocumentOperations::Single(_), Some(_)) => None,
        (DocumentOperations::Multiple(operations), Some(name)) => {
            operations.get(name).map(|operation| operation.node.ty)
        }
        (DocumentOperations::Multiple(operations), None) if operations.len() == 1 => operations
            .values()
            .next()
            .map(|operation| operation.node.ty),
        (DocumentOperations::Multiple(_), None) => None,
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
