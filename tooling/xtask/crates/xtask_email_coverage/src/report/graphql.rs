//! Which GraphQL fields a query asks for, as `Type.field` coordinates.
//!
//! The harness records the queries scenarios sent. A field's resolver ran
//! when a query that was answered selected it, so each query is walked
//! against the schema the service publishes.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use async_graphql_parser::types::{
    BaseType, DocumentOperations, ExecutableDocument, OperationType, Selection, SelectionSet,
    ServiceDocument, Type, TypeKind, TypeSystemDefinition,
};
use async_graphql_parser::{parse_query, parse_schema};
use rootcause::prelude::*;

/// The schema the GraphQL API publishes.
pub(crate) const SCHEMA_PATH: &str = "static_assets/schema.graphql";

/// The fields of every object and interface type, with the type each
/// returns.
pub(crate) struct Schema {
    /// Type to field to the name of the type the field returns.
    fields: BTreeMap<String, BTreeMap<String, String>>,
    query: String,
    mutation: String,
    subscription: String,
}

impl Schema {
    /// Reads the schema of the repository at `root`.
    pub(crate) fn load(root: &Path) -> Result<Self, Report> {
        let text = std::fs::read_to_string(root.join(SCHEMA_PATH))
            .context(format!("could not read {SCHEMA_PATH}"))?;
        Self::parse(&text)
    }

    pub(crate) fn parse(text: &str) -> Result<Self, Report> {
        let document: ServiceDocument =
            parse_schema(text).map_err(|error| report!("{SCHEMA_PATH} does not parse: {error}"))?;
        let mut schema = Self {
            fields: BTreeMap::new(),
            query: "Query".to_owned(),
            mutation: "Mutation".to_owned(),
            subscription: "Subscription".to_owned(),
        };
        for definition in &document.definitions {
            match definition {
                TypeSystemDefinition::Schema(roots) => {
                    if let Some(name) = &roots.node.query {
                        schema.query = name.node.to_string();
                    }
                    if let Some(name) = &roots.node.mutation {
                        schema.mutation = name.node.to_string();
                    }
                    if let Some(name) = &roots.node.subscription {
                        schema.subscription = name.node.to_string();
                    }
                }
                TypeSystemDefinition::Type(definition) => {
                    let fields = match &definition.node.kind {
                        TypeKind::Object(object) => &object.fields,
                        TypeKind::Interface(interface) => &interface.fields,
                        _ => continue,
                    };
                    let of_type = schema
                        .fields
                        .entry(definition.node.name.node.to_string())
                        .or_default();
                    for field in fields {
                        of_type.insert(
                            field.node.name.node.to_string(),
                            named(&field.node.ty.node).to_owned(),
                        );
                    }
                }
                TypeSystemDefinition::Directive(_) => {}
            }
        }
        Ok(schema)
    }

    /// The `Type.field` coordinates `query` selects, or why it cannot be
    /// read.
    pub(crate) fn coordinates(&self, query: &str) -> Result<BTreeSet<String>, String> {
        let document: ExecutableDocument = parse_query(query).map_err(|error| error.to_string())?;
        let mut found = BTreeSet::new();
        let operations: Vec<_> = match &document.operations {
            DocumentOperations::Single(operation) => vec![operation],
            DocumentOperations::Multiple(operations) => operations.values().collect(),
        };
        for operation in operations {
            let root = match operation.node.ty {
                OperationType::Query => &self.query,
                OperationType::Mutation => &self.mutation,
                OperationType::Subscription => &self.subscription,
            };
            self.walk(
                &document,
                root,
                &operation.node.selection_set.node,
                &mut found,
                0,
            );
        }
        Ok(found)
    }

    fn walk(
        &self,
        document: &ExecutableDocument,
        on: &str,
        selections: &SelectionSet,
        found: &mut BTreeSet<String>,
        depth: u8,
    ) {
        // Fragments cannot refer to themselves in a valid query; an invalid
        // one must not loop.
        if depth > 64 {
            return;
        }
        for selection in &selections.items {
            match &selection.node {
                Selection::Field(field) => {
                    let name = field.node.name.node.as_str();
                    let Some(returns) = self.fields.get(on).and_then(|fields| fields.get(name))
                    else {
                        continue;
                    };
                    found.insert(format!("{on}.{name}"));
                    self.walk(
                        document,
                        returns,
                        &field.node.selection_set.node,
                        found,
                        depth + 1,
                    );
                }
                Selection::FragmentSpread(spread) => {
                    if let Some(fragment) = document.fragments.get(&spread.node.fragment_name.node)
                    {
                        let on = fragment.node.type_condition.node.on.node.as_str();
                        self.walk(
                            document,
                            on,
                            &fragment.node.selection_set.node,
                            found,
                            depth + 1,
                        );
                    }
                }
                Selection::InlineFragment(fragment) => {
                    let on = fragment
                        .node
                        .type_condition
                        .as_ref()
                        .map_or(on, |condition| condition.node.on.node.as_str());
                    self.walk(
                        document,
                        on,
                        &fragment.node.selection_set.node,
                        found,
                        depth + 1,
                    );
                }
            }
        }
    }
}

/// The named type inside any lists.
fn named(ty: &Type) -> &str {
    match &ty.base {
        BaseType::Named(name) => name.as_str(),
        BaseType::List(inner) => named(inner),
    }
}
