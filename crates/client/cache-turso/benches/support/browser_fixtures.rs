//! Export deterministic fixtures without putting fixture synthesis in browser timings.
use super::{corpus, measurement::Options, population};
use cache_core::{document::Document, meta, normalize::normalize};
use serde_json::{Map, Value, json};
use std::{fs::File, io::BufWriter, path::Path};

fn save(directory: &Path, name: &str, value: &Value) {
    serde_json::to_writer(
        BufWriter::new(File::create(directory.join(name)).unwrap()),
        value,
    )
    .unwrap();
}

pub fn export(
    directory: &Path,
    options: &Options,
    queries: &[corpus::Query],
    fragments: &[corpus::Query],
) {
    std::fs::create_dir_all(directory).unwrap();
    let mut inventory = Vec::new();
    for (kind, catalog) in [("query", queries), ("fragment", fragments)] {
        for query in catalog {
            if !query.name.contains(&options.filter) {
                continue;
            }
            let mut sizes = Vec::new();
            for &size in &options.sizes {
                let variant_count = if kind == "query" && corpus::has_argument_variants(query) {
                    options.variants.iter().copied().max().unwrap_or(1)
                } else {
                    1
                };
                let mut files = Vec::new();
                for variant in 0..variant_count {
                    let file = format!("{}-{size}-{variant}.json", query.name);
                    let mut fixture = if kind == "query" {
                        let fixture = corpus::fixture(query, size, variant);
                        json!({"variables": fixture.variables, "data": fixture.data,
                            "normalized_records": fixture.records})
                    } else {
                        fragment_seed(query, size)
                    };
                    prepare_browser_fixture(&mut fixture);
                    let document =
                        Document::parse(fixture["seed_query"].as_str().unwrap_or(&query.document))
                            .unwrap();
                    let name = if kind == "query" {
                        &query.name
                    } else {
                        "BenchmarkSeed"
                    };
                    let records = normalize(
                        document.operation(Some(name)).unwrap(),
                        fixture["variables"].as_object().unwrap(),
                        &fixture["data"],
                    )
                    .unwrap();
                    let mut record_keys =
                        records.keys().map(ToString::to_string).collect::<Vec<_>>();
                    record_keys.sort();
                    fixture["record_keys"] = json!(record_keys);
                    fixture["normalized_records"] = json!(records.len());
                    let mut populations = Vec::new();
                    for &target in &options.cache_records {
                        assert!(
                            target > records.len(),
                            "{} size {size}: {target} cache records cannot hold {} selected records plus background",
                            query.name,
                            records.len()
                        );
                        let count = target - records.len();
                        let background = population::batches(count);
                        let mut union = records
                            .keys()
                            .cloned()
                            .collect::<std::collections::HashSet<_>>();
                        for batch in &background {
                            union.extend(population::records(batch).into_keys());
                        }
                        assert_eq!(
                            union.len(),
                            target,
                            "background identity must be disjoint except the shared root/viewer"
                        );
                        let file = format!("population-{count}.json");
                        save(
                            directory,
                            &file,
                            &json!({"query": population::QUERY, "batches": background, "keys": population::document_keys(count)}),
                        );
                        populations.push(json!({"cache_records": target, "file": file}));
                    }
                    fixture["populations"] = json!(populations);
                    save(directory, &file, &fixture);
                    files.push(file);
                }
                sizes.push(json!({"size": size, "files": files}));
            }
            inventory.push(json!({"name": query.name, "source": query.source,
                "document": query.document, "kind": kind, "sizes": sizes}));
        }
    }
    assert!(!inventory.is_empty(), "filter matched no operations");
    save(
        directory,
        "manifest.json",
        &json!({
            "schema_hash": meta::SCHEMA_HASH,
            "sizes": options.sizes, "variants": options.variants,
            "cache_records": options.cache_records,
            "entity_resolvers": corpus::entity_resolvers(), "inventory": inventory,
        }),
    );
    println!("Exported browser fixtures to {}", directory.display());
}

fn fragment_seed(query: &corpus::Query, size: usize) -> Value {
    let fixture = corpus::record_fixture(query, size);
    let mut expected = fixture.expected;
    let items: Vec<_> = expected
        .iter_mut()
        .enumerate()
        .map(|(index, item)| {
            let mut data = item.record.clone();
            if data.get("id").is_none() {
                let typename = data["__typename"].as_str().unwrap();
                let id = format!("00000000-0000-7000-8000-{:012x}", index + 1);
                item.record_key = cache_core::value::EntityKey(format!("{typename}:{id}").into());
                data["id"] = json!(id);
            }
            data
        })
        .collect();
    // Seed through valid public GraphQL writes, not a storage or WASM test hook.
    let (selection, field, value) = if query.name == "EmailThreadMessageFields" {
        (
            format!(
                "emailThread(input: {{threadId: \"00000000-0000-7000-8000-000000000000\"}}) {{ __typename id messages(offset: 0, limit: {size}) {{ ...{} }} }}",
                query.name
            ),
            "emailThread",
            json!({"__typename": "GraphqlSoupEmailThread", "id": "00000000-0000-7000-8000-000000000000", "messages": items}),
        )
    } else {
        (
            format!(
                "soup(input: {{continuation: {{cursor: \"benchmark-seed\"}}}}) {{ __typename items {{ id ...{} }} }}",
                query.name
            ),
            "soup",
            json!({"__typename": meta::field_meta("GraphqlUser", "soup").unwrap().ty.name, "items": items}),
        )
    };
    let seed_query = format!(
        "query BenchmarkSeed {{ __typename user {{ __typename id {selection} }} }}\n{}",
        query.document
    );
    apollo_compiler::ExecutableDocument::parse_and_validate(
        corpus::schema(),
        &seed_query,
        "seed.graphql",
    )
    .unwrap();
    let data = json!({"__typename": meta::QUERY_ROOT_TYPE, "user": {
        "__typename": "GraphqlUser", "id": "macro|cache-perf@example.com", field: value,
    }});
    let document = Document::parse(&seed_query).unwrap();
    let records = normalize(
        document.operation(Some("BenchmarkSeed")).unwrap(),
        &Map::new(),
        &data,
    )
    .unwrap();
    json!({"seed_query": seed_query, "data": data, "variables": {},
        "normalized_records": records.len(), "expected": expected})
}

// Synthetic hash seeds are u64 on the exporter. Keep their JSON payload indices
// exactly representable in JavaScript so old and new hosts share valid fixtures.
// Large floating-point round trips have their own engine regression test.
fn prepare_browser_fixture(value: &mut Value) {
    match value {
        Value::Number(number) => {
            if let Some(integer) = number.as_u64().filter(|n| *n > (1_u64 << 53) - 1) {
                *value = json!(integer & u64::from(u32::MAX));
            }
        }
        Value::Array(values) => values.iter_mut().for_each(prepare_browser_fixture),
        Value::Object(values) => {
            values.values_mut().for_each(prepare_browser_fixture);
            // Public browser writes also build Soup filter projections. Supply
            // domain-valid direct fields and supplements where selected.
            let typename = values
                .get("__typename")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned();
            if typename == "GraphqlProperty" && values.contains_key("propertyDefinitionId") {
                values.insert("propertyDefinitionId".to_owned(), values["id"].clone());
            }
            if typename == "GraphqlSelectOptionPropertyValue" {
                if let Some(Value::Array(options)) = values.get_mut("optionIds") {
                    for (index, option) in options.iter_mut().enumerate() {
                        *option = json!(format!("00000000-0000-7000-8000-{:012x}", index + 1));
                    }
                }
            }
            if typename == "GraphqlSoupEmailThread" {
                if let Some(value) = values.get_mut("linkId") {
                    *value = json!("00000000-0000-7000-8000-000000000001");
                }
                if values.contains_key("cacheProjection") {
                    let key = predicate_index::RecordKey::new(format!(
                        "{typename}:{}",
                        values["id"].as_str().unwrap()
                    ))
                    .unwrap();
                    values.insert(
                        "cacheProjection".to_owned(),
                        json!(
                            soup_filter_projection::encode_cache_projection_supplement(
                                &soup_filter_projection::SoupCacheProjectionSupplement::mail(
                                    key,
                                    soup_filter_projection::MailCacheProjectionFacts::new(
                                        Some(1_767_225_600_000_000),
                                        Some(1_767_225_600_000_000),
                                        false,
                                        false
                                    )
                                )
                            )
                            .unwrap()
                        ),
                    );
                }
            }
            if matches!(
                typename.as_str(),
                "GraphqlSoupDocument"
                    | "GraphqlSoupProject"
                    | "GraphqlSoupChat"
                    | "GraphqlSoupChannel"
            ) {
                for field in [
                    "projectId",
                    "parentId",
                    "channelTeamId",
                    "teamId",
                    "organizationId",
                ] {
                    if let Some(value) = values.get_mut(field) {
                        *value = Value::Null;
                    }
                }
                if let Some(value) = values.get_mut("channelType") {
                    *value = json!("public");
                }
                if values.contains_key("cacheProjection") {
                    let supplement = if typename == "GraphqlSoupDocument" {
                        let key = predicate_index::RecordKey::new(format!(
                            "{typename}:{}",
                            values["id"].as_str().unwrap()
                        ))
                        .unwrap();
                        json!(
                            soup_filter_projection::encode_cache_projection_supplement(
                                &soup_filter_projection::SoupCacheProjectionSupplement::document(
                                    key,
                                    false,
                                    true,
                                    Vec::new()
                                )
                            )
                            .unwrap()
                        )
                    } else {
                        Value::Null
                    };
                    values.insert("cacheProjection".to_owned(), supplement);
                }
            }
        }
        _ => {}
    }
}
