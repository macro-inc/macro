//! Executable-document IR.
//!
//! apollo-parser's CST is lossless but awkward to walk repeatedly; we convert
//! each document once into a compact IR (and memoize by document hash at the
//! engine level). The IR is also where parse-time invariants are enforced so
//! the normalize/denormalize walks can be infallible about shape.

use crate::value::canonical_json;
use apollo_parser::cst;
use apollo_parser::cst::CstNode;
use serde_json::Value as Json;
use std::collections::HashMap;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum DocumentError {
    #[error("GraphQL parse error: {0}")]
    Parse(String),
    #[error("document has no operations")]
    NoOperation,
    #[error("operation `{0}` not found")]
    UnknownOperation(String),
    #[error("only queries are supported (got {0})")]
    UnsupportedOperationType(String),
    #[error("fragment `{0}` is not defined")]
    UnknownFragment(String),
    #[error("malformed document: {0}")]
    Malformed(&'static str),
}

/// Argument value: constant JSON or a variable reference resolved at
/// read/write time.
#[derive(Debug, Clone)]
pub enum ArgValue {
    Const(Json),
    Variable(String),
    List(Vec<ArgValue>),
    Object(Vec<(String, ArgValue)>),
}

#[derive(Debug, Clone)]
pub struct FieldNode {
    /// Response key (alias if present, else name).
    pub response_key: String,
    /// Schema field name.
    pub name: String,
    pub arguments: Vec<(String, ArgValue)>,
    pub selection_set: Vec<Selection>,
}

#[derive(Debug, Clone)]
pub enum Selection {
    Field(FieldNode),
    /// Inline fragment or named-fragment spread, already flattened to a type
    /// condition (None = no condition) plus selections.
    Fragment {
        type_condition: Option<String>,
        selection_set: Vec<Selection>,
    },
}

#[derive(Debug)]
pub struct Operation {
    pub name: Option<String>,
    pub selection_set: Vec<Selection>,
}

#[derive(Debug)]
pub struct Document {
    pub operations: Vec<Operation>,
}

impl Document {
    /// Parses executable document text into the IR. Fragment spreads are
    /// inlined (cycles rejected by the parser's recursion limit; fragments
    /// must be defined in the same document, which urql guarantees).
    pub fn parse(text: &str) -> Result<Document, DocumentError> {
        let tree = apollo_parser::Parser::new(text).parse();
        if tree.errors().len() > 0 {
            let msg = tree
                .errors()
                .map(|e| e.message().to_string())
                .collect::<Vec<_>>()
                .join("; ");
            return Err(DocumentError::Parse(msg));
        }
        let doc = tree.document();

        let mut fragments: HashMap<String, cst::FragmentDefinition> = HashMap::new();
        let mut operations_cst = Vec::new();
        for def in doc.definitions() {
            match def {
                cst::Definition::OperationDefinition(op) => operations_cst.push(op),
                cst::Definition::FragmentDefinition(frag) => {
                    let name = frag
                        .fragment_name()
                        .and_then(|n| n.name())
                        .ok_or(DocumentError::Malformed("fragment without name"))?
                        .text()
                        .to_string();
                    fragments.insert(name, frag);
                }
                _ => return Err(DocumentError::Malformed("type-system definition in executable document")),
            }
        }
        if operations_cst.is_empty() {
            return Err(DocumentError::NoOperation);
        }

        let mut operations = Vec::new();
        for op in operations_cst {
            if let Some(ty) = op.operation_type() {
                // Queries only for now; mutations/subscriptions are Phase 5+.
                if ty.query_token().is_none() {
                    let label = ty.syntax().text().to_string();
                    return Err(DocumentError::UnsupportedOperationType(label));
                }
            }
            let selection_set = convert_selection_set(
                op.selection_set()
                    .ok_or(DocumentError::Malformed("operation without selection set"))?,
                &fragments,
                0,
            )?;
            operations.push(Operation {
                name: op.name().map(|n| n.text().to_string()),
                selection_set,
            });
        }
        Ok(Document { operations })
    }

    /// Selects an operation by name (or the only one when unnamed).
    pub fn operation(&self, name: Option<&str>) -> Result<&Operation, DocumentError> {
        match name {
            None => {
                if self.operations.len() == 1 {
                    Ok(&self.operations[0])
                } else {
                    Err(DocumentError::Malformed(
                        "operation name required for multi-operation documents",
                    ))
                }
            }
            Some(n) => self
                .operations
                .iter()
                .find(|o| o.name.as_deref() == Some(n))
                .ok_or_else(|| DocumentError::UnknownOperation(n.to_string())),
        }
    }
}

const MAX_FRAGMENT_DEPTH: usize = 32;

fn convert_selection_set(
    set: cst::SelectionSet,
    fragments: &HashMap<String, cst::FragmentDefinition>,
    depth: usize,
) -> Result<Vec<Selection>, DocumentError> {
    if depth > MAX_FRAGMENT_DEPTH {
        return Err(DocumentError::Malformed("fragment nesting too deep (cycle?)"));
    }
    let mut out = Vec::new();
    for sel in set.selections() {
        match sel {
            cst::Selection::Field(f) => {
                let name = f
                    .name()
                    .ok_or(DocumentError::Malformed("field without name"))?
                    .text()
                    .to_string();
                let response_key = f
                    .alias()
                    .and_then(|a| a.name())
                    .map(|n| n.text().to_string())
                    .unwrap_or_else(|| name.clone());
                let mut arguments = Vec::new();
                if let Some(args) = f.arguments() {
                    for arg in args.arguments() {
                        let arg_name = arg
                            .name()
                            .ok_or(DocumentError::Malformed("argument without name"))?
                            .text()
                            .to_string();
                        let value = arg
                            .value()
                            .ok_or(DocumentError::Malformed("argument without value"))?;
                        arguments.push((arg_name, convert_value(value)?));
                    }
                }
                let selection_set = match f.selection_set() {
                    Some(s) => convert_selection_set(s, fragments, depth + 1)?,
                    None => Vec::new(),
                };
                out.push(Selection::Field(FieldNode {
                    response_key,
                    name,
                    arguments,
                    selection_set,
                }));
            }
            cst::Selection::InlineFragment(frag) => {
                let type_condition = frag
                    .type_condition()
                    .and_then(|tc| tc.named_type())
                    .and_then(|nt| nt.name())
                    .map(|n| n.text().to_string());
                let selection_set = convert_selection_set(
                    frag.selection_set()
                        .ok_or(DocumentError::Malformed("inline fragment without selections"))?,
                    fragments,
                    depth + 1,
                )?;
                out.push(Selection::Fragment {
                    type_condition,
                    selection_set,
                });
            }
            cst::Selection::FragmentSpread(spread) => {
                let name = spread
                    .fragment_name()
                    .and_then(|n| n.name())
                    .ok_or(DocumentError::Malformed("fragment spread without name"))?
                    .text()
                    .to_string();
                let def = fragments
                    .get(&name)
                    .ok_or_else(|| DocumentError::UnknownFragment(name.clone()))?;
                let type_condition = def
                    .type_condition()
                    .and_then(|tc| tc.named_type())
                    .and_then(|nt| nt.name())
                    .map(|n| n.text().to_string());
                let selection_set = convert_selection_set(
                    def.selection_set()
                        .ok_or(DocumentError::Malformed("fragment without selections"))?,
                    fragments,
                    depth + 1,
                )?;
                out.push(Selection::Fragment {
                    type_condition,
                    selection_set,
                });
            }
        }
    }
    Ok(out)
}

fn convert_value(value: cst::Value) -> Result<ArgValue, DocumentError> {
    Ok(match value {
        cst::Value::Variable(v) => ArgValue::Variable(v.text().to_string()),
        cst::Value::StringValue(s) => ArgValue::Const(Json::String(String::from(s))),
        cst::Value::IntValue(i) => {
            let text = i.syntax().text().to_string();
            let n: serde_json::Number = text
                .parse::<i64>()
                .map(Into::into)
                .map_err(|_| DocumentError::Malformed("invalid int literal"))?;
            ArgValue::Const(Json::Number(n))
        }
        cst::Value::FloatValue(f) => {
            let text = f.syntax().text().to_string();
            let parsed: f64 = text
                .parse()
                .map_err(|_| DocumentError::Malformed("invalid float literal"))?;
            let n = serde_json::Number::from_f64(parsed)
                .ok_or(DocumentError::Malformed("non-finite float literal"))?;
            ArgValue::Const(Json::Number(n))
        }
        cst::Value::BooleanValue(b) => {
            ArgValue::Const(Json::Bool(b.syntax().text().to_string().trim() == "true"))
        }
        cst::Value::NullValue(_) => ArgValue::Const(Json::Null),
        cst::Value::EnumValue(e) => ArgValue::Const(Json::String(e.text().to_string())),
        cst::Value::ListValue(l) => {
            let mut items = Vec::new();
            for item in l.values() {
                items.push(convert_value(item)?);
            }
            ArgValue::List(items)
        }
        cst::Value::ObjectValue(o) => {
            let mut fields = Vec::new();
            for f in o.object_fields() {
                let name = f
                    .name()
                    .ok_or(DocumentError::Malformed("object field without name"))?
                    .text()
                    .to_string();
                let value = f
                    .value()
                    .ok_or(DocumentError::Malformed("object field without value"))?;
                fields.push((name, convert_value(value)?));
            }
            ArgValue::Object(fields)
        }
    })
}

#[derive(Debug, Error)]
#[error("missing variable `{0}`")]
pub struct MissingVariable(pub String);

/// Resolves an argument value against operation variables into plain JSON.
pub fn resolve_arg(
    value: &ArgValue,
    variables: &serde_json::Map<String, Json>,
) -> Result<Json, MissingVariable> {
    Ok(match value {
        ArgValue::Const(v) => v.clone(),
        ArgValue::Variable(name) => variables
            .get(name)
            .cloned()
            .ok_or_else(|| MissingVariable(name.clone()))?,
        ArgValue::List(items) => Json::Array(
            items
                .iter()
                .map(|i| resolve_arg(i, variables))
                .collect::<Result<_, _>>()?,
        ),
        ArgValue::Object(fields) => {
            let mut map = serde_json::Map::new();
            for (k, v) in fields {
                map.insert(k.clone(), resolve_arg(v, variables)?);
            }
            Json::Object(map)
        }
    })
}

/// Resolves a field's arguments to a canonical string (`None` when the field
/// has no arguments), for use in field storage keys.
pub fn resolve_args_key(
    field: &FieldNode,
    variables: &serde_json::Map<String, Json>,
) -> Result<Option<String>, MissingVariable> {
    if field.arguments.is_empty() {
        return Ok(None);
    }
    let mut map = serde_json::Map::new();
    for (name, value) in &field.arguments {
        map.insert(name.clone(), resolve_arg(value, variables)?);
    }
    Ok(Some(canonical_json(&Json::Object(map))))
}

#[cfg(test)]
mod tests {
    use super::*;

    const DOC: &str = r#"
        query Soup($input: SoupInput!) {
          soup(input: $input) {
            items {
              id
              entity {
                __typename
                ... on GraphqlSoupDocument { id docName: name }
                ...ChatFields
              }
            }
            nextCursor
          }
        }
        fragment ChatFields on GraphqlSoupChat { id chatName: name }
    "#;

    #[test]
    fn parses_real_shape() {
        let doc = Document::parse(DOC).unwrap();
        let op = doc.operation(Some("Soup")).unwrap();
        assert_eq!(op.name.as_deref(), Some("Soup"));
        let Selection::Field(soup) = &op.selection_set[0] else {
            panic!("expected field");
        };
        assert_eq!(soup.name, "soup");
        assert!(matches!(&soup.arguments[0].1, ArgValue::Variable(v) if v == "input"));

        // fragment spread flattened with type condition
        let Selection::Field(items) = &soup.selection_set[0] else {
            panic!()
        };
        let Selection::Field(entity) = &items.selection_set[1] else {
            panic!()
        };
        let conditions: Vec<_> = entity
            .selection_set
            .iter()
            .filter_map(|s| match s {
                Selection::Fragment { type_condition, .. } => type_condition.clone(),
                _ => None,
            })
            .collect();
        assert_eq!(conditions, vec!["GraphqlSoupDocument", "GraphqlSoupChat"]);
    }

    #[test]
    fn alias_and_args_key() {
        let doc = Document::parse(DOC).unwrap();
        let op = doc.operation(Some("Soup")).unwrap();
        let Selection::Field(soup) = &op.selection_set[0] else {
            panic!()
        };
        let mut vars = serde_json::Map::new();
        vars.insert(
            "input".into(),
            serde_json::json!({"limit": 20, "cursor": null}),
        );
        assert_eq!(
            resolve_args_key(soup, &vars).unwrap().unwrap(),
            r#"{"input":{"cursor":null,"limit":20}}"#
        );
        assert!(matches!(
            resolve_args_key(soup, &serde_json::Map::new()),
            Err(MissingVariable(v)) if v == "input"
        ));
    }

    #[test]
    fn rejects_mutations() {
        let err = Document::parse("mutation M { doThing }").unwrap_err();
        assert!(matches!(err, DocumentError::UnsupportedOperationType(_)));
    }

    #[test]
    fn rejects_unknown_fragment() {
        let err = Document::parse("query Q { a { ...Nope } }").unwrap_err();
        assert!(matches!(err, DocumentError::UnknownFragment(_)));
    }
}
