//! Discover production operations and synthesize deterministic, populated responses.
use apollo_parser::cst::{self, CstNode};
use cache_core::document::{Document, OperationKind, Selection};
use cache_core::meta::{self, FieldKind};
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::OnceLock;

pub struct Query {
    pub name: String,
    pub source: String,
    pub document: String,
    validated: Option<apollo_compiler::validation::Valid<apollo_compiler::ExecutableDocument>>,
}

pub struct Fixture {
    pub variables: Map<String, Value>,
    pub data: Value,
    pub records: usize,
}

pub fn queries(root: &Path) -> Vec<Query> {
    catalog(root, false)
}

pub fn record_queries(root: &Path) -> Vec<Query> {
    catalog(root, true)
}

fn record_fragments(path: &Path, names: &mut BTreeSet<String>) {
    for entry in std::fs::read_dir(path).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            record_fragments(&path, names);
            continue;
        }
        if path.extension().is_none_or(|extension| extension != "ts")
            || path.to_str().unwrap().ends_with(".test.ts")
        {
            continue;
        }
        let text = std::fs::read_to_string(path).unwrap();
        for call in text.split("selectRecords(").skip(1) {
            let identifier = call
                .trim_start()
                .split(|c: char| !c.is_alphanumeric() && c != '_')
                .next()
                .unwrap();
            if let Some(fragment) = identifier.strip_suffix("FragmentDoc") {
                names.insert(fragment.to_string());
            }
        }
    }
}

fn catalog(root: &Path, record_reads: bool) -> Vec<Query> {
    let directory = root.join("apps/web/src/lib/service-clients/service-storage/graphql");
    let mut definitions = BTreeMap::new();
    let mut operations = Vec::new();
    let mut paths: Vec<_> = std::fs::read_dir(directory)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "graphql"))
        .collect();
    paths.sort();
    for path in paths {
        let text = std::fs::read_to_string(&path).unwrap();
        let parsed = apollo_parser::Parser::new(&text).parse();
        assert_eq!(parsed.errors().len(), 0, "{}", path.display());
        for definition in parsed.document().definitions() {
            let node = definition.syntax();
            let spreads: Vec<_> = node
                .descendants()
                .filter_map(cst::FragmentSpread::cast)
                .map(|spread| {
                    spread
                        .fragment_name()
                        .unwrap()
                        .name()
                        .unwrap()
                        .text()
                        .to_string()
                })
                .collect();
            // urql adds typenames before sending operations to the native cache.
            let mut document = node.text().to_string();
            let start: usize = node.text_range().start().into();
            let mut insertions: Vec<usize> = node
                .descendants()
                .filter_map(cst::SelectionSet::cast)
                .map(|set| usize::from(set.syntax().text_range().end()) - start - 1)
                .collect();
            insertions.sort_unstable();
            for offset in insertions.into_iter().rev() {
                document.insert_str(offset, " __typename ");
            }
            match definition {
                cst::Definition::FragmentDefinition(fragment) => {
                    let name = fragment
                        .fragment_name()
                        .unwrap()
                        .name()
                        .unwrap()
                        .text()
                        .to_string();
                    assert!(definitions.insert(name, (document, spreads)).is_none());
                }
                cst::Definition::OperationDefinition(operation)
                    if operation.operation_type().unwrap().query_token().is_some() =>
                {
                    operations.push((
                        operation.name().unwrap().text().to_string(),
                        path.file_name().unwrap().to_str().unwrap().to_owned(),
                        document,
                        spreads,
                    ));
                }
                _ => {}
            }
        }
    }
    if record_reads {
        let mut names = BTreeSet::new();
        record_fragments(&root.join("apps/web/src/lib/queries"), &mut names);
        assert!(!names.is_empty());
        operations = names
            .into_iter()
            .map(|name| {
                let (document, spreads) = definitions
                    .get(&name)
                    .expect("selected production fragment exists");
                (
                    name,
                    "selectRecords call sites".to_owned(),
                    document.clone(),
                    spreads.clone(),
                )
            })
            .collect();
    }
    let mut result = Vec::new();
    for (name, source, mut document, mut pending) in operations {
        let mut included = BTreeSet::new();
        while let Some(fragment) = pending.pop() {
            if !included.insert(fragment.clone()) {
                continue;
            }
            let (text, spreads) = definitions
                .get(&fragment)
                .expect("production fragment exists");
            document.push('\n');
            document.push_str(text);
            pending.extend(spreads.iter().cloned());
        }
        let validated = (!record_reads).then(|| {
            apollo_compiler::ExecutableDocument::parse_and_validate(
                schema(),
                document.clone(),
                &source,
            )
            .unwrap()
        });
        result.push(Query {
            name,
            source,
            document,
            validated,
        });
    }
    result.sort_by(|a, b| a.name.cmp(&b.name));
    assert!(
        !result.is_empty(),
        "production query discovery must not be empty"
    );
    result
}

pub fn fixture(query: &Query, size: usize, variant: usize) -> Fixture {
    let input = match query.name.as_str() {
        "GroupSoup" | "GroupSoupMembership" => {
            json!({"continuation": {"cursor": format!("page-{variant}"), "groupBy": {"field": "ENTITY_TYPE"}, "groupKey": "document"}})
        }
        "MyActivity" => json!({"limit": size, "cursor": format!("page-{variant}")}),
        "MyActivityOverview" => json!({"timeZone": "UTC"}),
        _ => json!({"continuation": {"cursor": format!("page-{variant}")}}),
    };
    let mut variables = json!({"input": input, "limit": size, "offset": variant * size, "threadId": "perf-thread", "filter": {"entityTypes": ["DOCUMENT"], "entityIds": [format!("favorite-{variant}")]}}).as_object().unwrap().clone();
    let document = Document::parse(&query.document).unwrap();
    let operation = document.operation(Some(&query.name)).unwrap();
    assert_eq!(operation.kind, OperationKind::Query);
    let data = object(
        meta::QUERY_ROOT_TYPE,
        &operation.selection_set,
        size,
        if query.name == "EmailThreadPage" {
            1
        } else {
            variant + 1
        },
        0,
    );
    if query.name == "EmailThreadPage" {
        variables.insert("threadId".into(), data["user"]["emailThread"]["id"].clone());
    }
    let validated = query
        .validated
        .as_ref()
        .unwrap()
        .operations
        .get(Some(&query.name))
        .unwrap();
    variables.retain(|name, _| {
        validated
            .variables
            .iter()
            .any(|variable| variable.name.as_str() == name)
    });
    let values = serde_json::from_value(Value::Object(variables.clone())).unwrap();
    apollo_compiler::request::coerce_variable_values(schema(), validated, &values).unwrap();
    let records = cache_core::normalize::normalize(operation, &variables, &data)
        .unwrap()
        .len();
    Fixture {
        variables,
        data,
        records,
    }
}

fn object(
    type_name: &str,
    selections: &[Selection],
    size: usize,
    seed: usize,
    list_depth: usize,
) -> Value {
    let metadata = meta::type_meta(type_name).unwrap();
    let concrete = if metadata.possible_types.is_empty() {
        type_name
    } else {
        metadata.possible_types[seed % metadata.possible_types.len()]
    };
    let mut result = Map::new();
    fields(concrete, selections, size, seed, list_depth, &mut result);
    Value::Object(result)
}

fn fields(
    concrete: &str,
    selections: &[Selection],
    size: usize,
    seed: usize,
    list_depth: usize,
    result: &mut Map<String, Value>,
) {
    for selection in selections {
        let field = match selection {
            Selection::Fragment {
                type_condition,
                selection_set,
            } => {
                if type_condition
                    .as_ref()
                    .is_none_or(|condition| meta::type_matches(concrete, condition))
                {
                    fields(concrete, selection_set, size, seed, list_depth, result);
                }
                continue;
            }
            Selection::Field(field) => field,
        };
        if field.name == "__typename" {
            result.insert(field.response_key.clone(), json!(concrete));
            continue;
        }
        let ty = meta::field_meta(concrete, &field.name).unwrap().ty;
        let value = |index| {
            let child_seed = field
                .name
                .bytes()
                .fold(
                    if concrete == "GraphqlUser" && field.arguments.is_empty() {
                        1
                    } else {
                        seed
                    },
                    |hash, byte| hash.wrapping_mul(31).wrapping_add(usize::from(byte)),
                )
                .wrapping_add(index + 1);
            if ty.kind == FieldKind::Composite {
                object(
                    ty.name,
                    &field.selection_set,
                    size,
                    child_seed,
                    list_depth + usize::from(ty.list),
                )
            } else if field.name == "id" {
                if concrete == "GraphqlUser" {
                    json!("macro|cache-perf@example.com")
                } else {
                    json!(format!(
                        "00000000-0000-7000-8000-{:012x}",
                        seed & 0xffffffffffff
                    ))
                }
            } else if field.name == "nextCursor" {
                Value::Null
            } else if field.name.starts_with("body") {
                json!("benchmark mail body ".repeat(256))
            } else {
                match ty.name {
                    "Boolean" => json!(true),
                    "Int" | "Float" | "BigInt" => json!(42),
                    "JSON" => json!({"text": "benchmark", "index": seed}),
                    _ if enum_values().contains_key(ty.name) => {
                        let values = &enum_values()[ty.name];
                        json!(values[seed % values.len()])
                    }
                    _ if field.name.ends_with("At") || field.name.ends_with("Ts") => {
                        json!("2026-01-01T00:00:00Z")
                    }
                    _ => json!(format!("perf-{}-{seed}", field.name)),
                }
            }
        };
        let generated = if ty.list {
            let count = if list_depth == 0 { size } else { 2 };
            Value::Array((0..count).map(value).collect())
        } else {
            value(0)
        };
        // Overlapping fragment selections must merge, just as a GraphQL executor does.
        merge(
            result
                .entry(field.response_key.clone())
                .or_insert(Value::Null),
            generated,
        );
    }
}

fn merge(target: &mut Value, incoming: Value) {
    match (target, incoming) {
        (Value::Object(target), Value::Object(incoming)) => {
            for (key, value) in incoming {
                merge(target.entry(key).or_insert(Value::Null), value);
            }
        }
        (Value::Array(target), Value::Array(incoming)) if target.len() == incoming.len() => {
            for (target, value) in target.iter_mut().zip(incoming) {
                merge(target, value);
            }
        }
        (target, incoming) => *target = incoming,
    }
}

fn enum_values() -> &'static BTreeMap<String, Vec<String>> {
    static VALUES: OnceLock<BTreeMap<String, Vec<String>>> = OnceLock::new();
    VALUES.get_or_init(|| {
        let schema =
            apollo_parser::Parser::new(include_str!("../../../../../static_assets/schema.graphql"))
                .parse();
        assert_eq!(schema.errors().len(), 0);
        schema
            .document()
            .definitions()
            .filter_map(|definition| {
                let cst::Definition::EnumTypeDefinition(definition) = definition else {
                    return None;
                };
                Some((
                    definition.name().unwrap().text().to_string(),
                    definition
                        .enum_values_definition()
                        .unwrap()
                        .enum_value_definitions()
                        .map(|value| value.enum_value().unwrap().text().to_string())
                        .collect(),
                ))
            })
            .collect()
    })
}

pub struct RecordFixture {
    pub selection: cache_core::record_selection::RecordSelection,
    pub records: cache_core::normalize::RecordUpdates,
    pub expected: Vec<cache_core::record_selection::SelectedRecord>,
}

pub fn record_fixture(query: &Query, size: usize) -> RecordFixture {
    use cache_core::document::Operation;
    use cache_core::value::EntityKey;
    let document = Document::parse(&query.document).unwrap();
    let fragment = document.fragment(&query.name).unwrap();
    let selection =
        cache_core::record_selection::RecordSelection::parse(&query.document, &query.name).unwrap();
    let mut records = cache_core::normalize::RecordUpdates::new();
    let mut expected = Vec::new();
    for seed in 1..=size {
        let data = object(
            &fragment.type_condition,
            &fragment.selection_set,
            2,
            seed,
            1,
        );
        // Normalize a synthetic root with the fragment's concrete __typename,
        // then relocate that root to its explicit entity key. This only seeds
        // storage; measured reads use the unmodified production fragment.
        let operation = Operation {
            name: None,
            kind: OperationKind::Query,
            selection_set: fragment.selection_set.clone(),
        };
        let mut updates = cache_core::normalize::normalize(&operation, &Map::new(), &data).unwrap();
        let key = EntityKey(
            format!(
                "{}:{}",
                data["__typename"].as_str().unwrap(),
                data.get("id")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .unwrap_or_else(|| format!("record-{seed}"))
            )
            .into(),
        );
        let root = updates.remove(&EntityKey::root()).unwrap();
        updates.insert(key.clone(), root);
        for (key, record) in updates {
            records.entry(key).or_default().merge(record);
        }
        expected.push(cache_core::record_selection::SelectedRecord {
            record_key: key,
            record: data,
        });
    }
    RecordFixture {
        selection,
        records,
        expected,
    }
}

pub fn has_argument_variants(query: &Query) -> bool {
    !matches!(query.name.as_str(), "MailAccounts" | "MyActivityOverview")
}

pub fn entity_resolvers() -> Vec<cache_core::entity_resolver::EntityResolver> {
    vec![cache_core::entity_resolver::EntityResolver {
        parent_type: "GraphqlUser".into(),
        field_name: "emailThread".into(),
        target_type: "GraphqlSoupEmailThread".into(),
        argument_path: vec!["input".into(), "threadId".into()],
    }]
}

pub(super) fn schema() -> &'static apollo_compiler::validation::Valid<apollo_compiler::Schema> {
    static SCHEMA: OnceLock<apollo_compiler::validation::Valid<apollo_compiler::Schema>> =
        OnceLock::new();
    SCHEMA.get_or_init(|| {
        apollo_compiler::Schema::parse_and_validate(
            concat!(
                include_str!("../../../../../static_assets/schema.graphql"),
                "\n",
                include_str!("../../../../../apps/web/graphql-client-schema.graphql")
            ),
            "schema.graphql",
        )
        .unwrap()
    })
}
