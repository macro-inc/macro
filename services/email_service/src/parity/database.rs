//! Catalog-driven snapshots ensure unexpected writes cannot escape the transcript.

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use std::collections::{BTreeMap, BTreeSet};

mod test;

pub(super) struct Snapshot {
    tables: BTreeMap<String, (Vec<String>, Vec<Value>)>,
}

fn quote(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

impl Snapshot {
    #[expect(
        clippy::disallowed_methods,
        reason = "Parity discovers table names at runtime and must not add test SQLx cache entries"
    )]
    pub async fn take(db: &PgPool) -> Self {
        let tables: Vec<(String, Vec<String>)> = sqlx::query_as(
            "SELECT c.relname, COALESCE((SELECT array_agg(a.attname::text ORDER BY k.ordinality) FROM pg_index i CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum WHERE i.indrelid=c.oid AND i.indisprimary), '{}'::text[]) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname")
            .fetch_all(db).await.expect("public table catalog");
        let mut result = BTreeMap::new();
        for (table, keys) in tables {
            let mut rows: Vec<Value> = sqlx::query_scalar(&format!(
                "SELECT to_jsonb(t) FROM public.{} t",
                quote(&table)
            ))
            .fetch_all(db)
            .await
            .expect("public table contents");
            rows.sort_by_key(Value::to_string);
            result.insert(table, (keys, rows));
        }
        Self { tables: result }
    }

    pub fn changes(self, after: Self) -> Value {
        let mut changes = BTreeMap::new();
        let names: BTreeSet<_> = self
            .tables
            .keys()
            .chain(after.tables.keys())
            .cloned()
            .collect();
        for table in names {
            let empty = (Vec::new(), Vec::new());
            let (keys, before) = self.tables.get(&table).unwrap_or(&empty);
            let (_, after) = after.tables.get(&table).unwrap_or(&empty);
            let fingerprint = |rows: &[Value]| {
                Sha256::digest(serde_json::to_vec(rows).expect("table fingerprint"))
            };
            if fingerprint(before) == fingerprint(after) {
                continue;
            }
            let mut removed = Vec::new();
            let mut added = Vec::new();
            let mut changed = Vec::new();
            let key = |row: &Value| {
                keys.iter()
                    .map(|field| row[field].to_string())
                    .collect::<Vec<_>>()
            };
            if keys.is_empty() {
                let mut unmatched = after.clone();
                for old in before {
                    if let Some(index) = unmatched.iter().position(|new| new == old) {
                        unmatched.remove(index);
                    } else {
                        removed.push(old.clone());
                    }
                }
                changes.insert(
                    table,
                    json!({"removed": removed, "added": unmatched, "changed": []}),
                );
                continue;
            }
            for old in before {
                if after.contains(old) {
                    continue;
                }
                if !keys.is_empty()
                    && let Some(new) = after.iter().find(|new| key(new) == key(old))
                {
                    changed.push(changed_row(keys, old, new));
                } else {
                    removed.push(old.clone());
                }
            }
            for new in after {
                if !before.contains(new)
                    && (keys.is_empty() || !before.iter().any(|old| key(old) == key(new)))
                {
                    added.push(new.clone());
                }
            }
            changes.insert(
                table,
                json!({"removed": removed, "added": added, "changed": changed}),
            );
        }
        json!(changes)
    }
}

fn changed_row(keys: &[String], before: &Value, after: &Value) -> Value {
    let mut fields: BTreeMap<String, Value> = keys
        .iter()
        .map(|key| (key.clone(), before[key].clone()))
        .collect();
    let columns: BTreeSet<_> = before
        .as_object()
        .expect("row object")
        .keys()
        .chain(after.as_object().expect("row object").keys())
        .collect();
    for column in columns {
        if before[column] != after[column] {
            fields.insert(
                column.clone(),
                json!({"before": before[column], "after": after[column]}),
            );
        }
    }
    json!(fields)
}
