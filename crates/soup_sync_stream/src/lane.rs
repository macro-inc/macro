//! A planned lane: the query the stream runs page by page and what it
//! declares to the cache on the lane's `lane` line.

#[cfg(test)]
mod test;

use crate::calendar::CalendarSpan;
use async_graphql::parser::{
    self, parse_query,
    types::{
        DocumentOperations, ExecutableDocument, OperationDefinition, OperationType, Selection,
        SelectionSet,
    },
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{collections::HashSet, sync::Arc};

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

/// Why a lane does not build: a document the client sent does not run it
/// ([`LaneError::QueryParse`], [`LaneError::OperationNotSelected`],
/// [`LaneError::PagedField`]), or the server's catalog is wrong (the rest).
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
    /// The operation does not page through exactly one list, unaliased
    /// `user.<field>(input: $input)`.
    #[error(
        "query must select one unaliased `user {{ {0}(input: $input) }}` and no other Soup or calendar list"
    )]
    PagedField(&'static str),
    /// The variables have no pageable `input` object.
    #[error("variables need an `input` object of the paging's shape")]
    InvalidInput,
}

/// What a lane is planned from.
#[derive(Debug)]
pub(crate) struct LaneDraft {
    pub(crate) id: LaneId,
    /// The client's document for the lane's operation.
    pub(crate) query: Arc<str>,
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
    pub(crate) query: Arc<str>,
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
        let document = parse_query(&*draft.query).map_err(LaneError::QueryParse)?;
        let Some(operation) = selected_operation(&document.operations, draft.operation_name)
            .filter(|operation| operation.ty == OperationType::Query)
        else {
            return Err(LaneError::OperationNotSelected(
                draft.operation_name.to_owned(),
            ));
        };
        check_paged_field(&document, operation, draft.paging)?;
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

/// The named operation, as async-graphql selects it in `Schema::execute`.
fn selected_operation<'a>(
    operations: &'a DocumentOperations,
    name: &str,
) -> Option<&'a OperationDefinition> {
    match operations {
        DocumentOperations::Single(_) => None,
        DocumentOperations::Multiple(operations) => {
            operations.get(name).map(|operation| &operation.node)
        }
    }
}

/// Fields under `user` that list Soup items or calendar occurrences.
const LIST_FIELDS: [&str; 2] = [SOUP_FIELD, CALENDAR_FIELD];
const USER_FIELD: &str = "user";
const SOUP_FIELD: &str = "soup";
const CALENDAR_FIELD: &str = "calendarOccurrences";
/// The `input` variable as an argument value prints (the parser does not
/// export its argument value type).
const INPUT_ARGUMENT: &str = "$input";

/// The client's document may page through its lane's list only. Stream pages
/// run with fetch budgets `/soup/graphql` does not give (`SoupLaneLists`, the
/// sync's email limits), so the operation selects exactly one Soup or calendar
/// list in all, unaliased `user { <field>(input: $input) }`, which the server
/// feeds every page's input.
fn check_paged_field(
    document: &ExecutableDocument,
    operation: &OperationDefinition,
    paging: Paging,
) -> Result<(), LaneError> {
    let field = match paging {
        Paging::Soup => SOUP_FIELD,
        Paging::Calendar => CALENDAR_FIELD,
    };
    let mut lists = 0;
    count_lists(
        document,
        &operation.selection_set.node,
        &mut HashSet::new(),
        &mut lists,
    );
    let paged = operation
        .selection_set
        .node
        .items
        .iter()
        .filter_map(|selection| match &selection.node {
            Selection::Field(user) if user.node.name.node == USER_FIELD => Some(&user.node),
            _ => None,
        })
        .filter(|user| user.alias.is_none())
        .flat_map(|user| user.selection_set.node.items.iter())
        .any(|selection| match &selection.node {
            Selection::Field(list) => {
                let list = &list.node;
                list.name.node == field
                    && list.alias.is_none()
                    && list.directives.is_empty()
                    && matches!(
                        list.arguments.as_slice(),
                        [(name, value)] if name.node == INPUT_VARIABLE
                            && value.node.to_string() == INPUT_ARGUMENT
                    )
            }
            _ => false,
        });
    if lists == 1 && paged {
        Ok(())
    } else {
        Err(LaneError::PagedField(field))
    }
}

/// Counts every Soup and calendar list `selections` reaches, through
/// fragments and aliases.
fn count_lists<'a>(
    document: &'a ExecutableDocument,
    selections: &'a SelectionSet,
    fragments: &mut HashSet<&'a str>,
    lists: &mut usize,
) {
    for selection in &selections.items {
        match &selection.node {
            Selection::Field(field) => {
                if LIST_FIELDS.contains(&field.node.name.node.as_str()) {
                    *lists += 1;
                }
                count_lists(document, &field.node.selection_set.node, fragments, lists);
            }
            Selection::InlineFragment(fragment) => {
                count_lists(
                    document,
                    &fragment.node.selection_set.node,
                    fragments,
                    lists,
                );
            }
            Selection::FragmentSpread(spread) => {
                let name = spread.node.fragment_name.node.as_str();
                if fragments.insert(name)
                    && let Some(fragment) = document.fragments.get(name)
                {
                    count_lists(
                        document,
                        &fragment.node.selection_set.node,
                        fragments,
                        lists,
                    );
                }
            }
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
