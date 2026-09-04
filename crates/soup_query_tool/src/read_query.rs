//! Boundary 1: GraphQL text becomes a proven read-only document.

use async_graphql::parser::types::{
    DocumentOperations, ExecutableDocument, OperationType, Selection,
};
use async_graphql::parser::{Positioned, parse_query};
use async_graphql::{Request, Variables};

/// How many aliased `soup` fields one document may start.
pub(crate) const MAX_SOUP_SELECTIONS: usize = 5;

/// A GraphQL document that parsed and contains exactly one `query` operation.
///
/// The only constructor is [`ReadQuery::parse`].
#[derive(Debug, Clone)]
pub struct ReadQuery {
    query: String,
    variables: Variables,
}

/// Why a document did not become a [`ReadQuery`].
#[derive(Debug, thiserror::Error)]
pub enum QueryRejected {
    /// Not GraphQL.
    #[error(
        "Could not parse the query as GraphQL: {0}. The tool description has working examples."
    )]
    Syntax(String),
    /// The operation is a mutation or subscription.
    #[error(
        "QuerySoup is read-only: this document's operation is a {0}. \
         The schema has no mutation root. To change things use the dedicated tools \
         (UpdateThreadLabels, SetEntityProperty, MoveToProject, …)."
    )]
    WriteOperation(&'static str),
    /// More than one operation; there is no `operationName` parameter.
    #[error("document contains {count} operations; send one")]
    MultipleOperations {
        /// How many operations were found.
        count: usize,
    },
    /// `variables` was given but is not a JSON object.
    #[error("variables must be a JSON object")]
    VariablesNotObject,
    /// Too many root `soup` fields.
    #[error(
        "At most {MAX_SOUP_SELECTIONS} `soup` selections per call; this query has {count}. \
         Split the request across calls or widen the filters."
    )]
    TooManySelections {
        /// How many `soup` selections were found.
        count: usize,
    },
    /// An `items` selection with no `id`.
    #[error(
        "Select `id` on every `items` selection so results can be linked, e.g. `items {{ id displayName }}`."
    )]
    ItemsWithoutId,
}

impl ReadQuery {
    /// Parse `query`, attach `variables`, and prove the document is a single query.
    pub fn parse(query: &str, variables: Option<serde_json::Value>) -> Result<Self, QueryRejected> {
        let variables = match variables {
            None | Some(serde_json::Value::Null) => Variables::default(),
            Some(serde_json::Value::Object(map)) => {
                Variables::from_json(serde_json::Value::Object(map))
            }
            Some(_) => return Err(QueryRejected::VariablesNotObject),
        };
        let document =
            parse_query(query).map_err(|error| QueryRejected::Syntax(error.to_string()))?;
        let operation = single_operation(&document)?;
        if operation.node.ty != OperationType::Query {
            return Err(QueryRejected::WriteOperation(match operation.node.ty {
                OperationType::Mutation => "mutation",
                OperationType::Subscription => "subscription",
                OperationType::Query => unreachable!("query already handled"),
            }));
        }
        let soup_count = count_named_fields(&operation.node.selection_set.node.items, "soup");
        let introspection_only = soup_count == 0
            && operation
                .node
                .selection_set
                .node
                .items
                .iter()
                .any(|selection| {
                    matches!(
                        &selection.node,
                        Selection::Field(field)
                            if field.node.name.node.starts_with("__")
                    )
                });
        if soup_count > MAX_SOUP_SELECTIONS {
            return Err(QueryRejected::TooManySelections { count: soup_count });
        }
        if !introspection_only && items_missing_id(&operation.node.selection_set.node.items) {
            return Err(QueryRejected::ItemsWithoutId);
        }
        Ok(Self {
            query: query.to_owned(),
            variables,
        })
    }

    /// Build the execute request. The operation kind has already been proven.
    pub(crate) fn into_request(self) -> Request {
        Request::new(self.query).variables(self.variables)
    }
}

fn single_operation(
    document: &ExecutableDocument,
) -> Result<&Positioned<async_graphql::parser::types::OperationDefinition>, QueryRejected> {
    match &document.operations {
        DocumentOperations::Single(operation) => Ok(operation),
        DocumentOperations::Multiple(operations) if operations.len() == 1 => operations
            .values()
            .next()
            .ok_or(QueryRejected::MultipleOperations { count: 0 }),
        DocumentOperations::Multiple(operations) => Err(QueryRejected::MultipleOperations {
            count: operations.len(),
        }),
    }
}

fn count_named_fields(selections: &[Positioned<Selection>], name: &str) -> usize {
    selections
        .iter()
        .filter(|selection| {
            matches!(
                &selection.node,
                Selection::Field(field) if field.node.name.node == name
            )
        })
        .count()
}

fn items_missing_id(selections: &[Positioned<Selection>]) -> bool {
    selections.iter().any(|selection| match &selection.node {
        Selection::Field(field) if field.node.name.node.starts_with("__") => false,
        Selection::Field(field) if field.node.name.node == "items" => {
            !field_selected(&field.node.selection_set.node.items, "id")
        }
        Selection::Field(field) => items_missing_id(&field.node.selection_set.node.items),
        Selection::InlineFragment(fragment) => {
            items_missing_id(&fragment.node.selection_set.node.items)
        }
        Selection::FragmentSpread(_) => false,
    })
}

fn field_selected(selections: &[Positioned<Selection>], name: &str) -> bool {
    selections.iter().any(|selection| match &selection.node {
        Selection::Field(field) => field.node.name.node == name,
        Selection::InlineFragment(fragment) => {
            field_selected(&fragment.node.selection_set.node.items, name)
        }
        Selection::FragmentSpread(_) => false,
    })
}

impl QueryRejected {
    /// The model-facing tool error.
    pub fn into_tool_error(self) -> ai_toolset::ToolCallError {
        ai_toolset::ToolCallError {
            description: self.to_string(),
            internal_error: anyhow::anyhow!("{self}"),
        }
    }
}
