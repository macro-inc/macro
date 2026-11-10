use super::normalize::Normalizer;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write;
use std::path::{Path, PathBuf};

mod test;

pub(super) struct Transcript {
    pub suite: String,
    pub name: String,
    pub normalizer: Normalizer,
    text: String,
    callsites: String,
    debug_spans: String,
    statements: BTreeMap<String, String>,
}

impl Transcript {
    pub fn new(suite: &str, name: &str, normalizer: Normalizer) -> Self {
        Self {
            suite: suite.into(),
            name: name.into(),
            normalizer,
            text: String::new(),
            callsites: String::new(),
            debug_spans: String::new(),
            statements: BTreeMap::new(),
        }
    }

    pub fn step(&mut self, name: &str, sections: Vec<(&str, Value)>) {
        writeln!(self.text, "step: {name}").expect("write transcript");
        for (section, mut value) in sections {
            if section == "callsites" || section == "debug_spans" {
                // Diagnostic-only values must not consume UUID numbers used by goldens.
                let mut normalizer = self.normalizer.clone();
                let normalized_section = if section == "debug_spans" {
                    "spans"
                } else {
                    section
                };
                let value = normalizer.value(normalized_section, value);
                if section == "debug_spans" {
                    writeln!(self.debug_spans, "step: {name}\nspans:").expect("debug step");
                    render_spans(&mut self.debug_spans, &value, None, 1);
                    self.debug_spans.push('\n');
                } else {
                    writeln!(
                        self.callsites,
                        "step: {name}\n{}\n",
                        serde_json::to_string_pretty(&value).expect("callsites JSON")
                    )
                    .expect("callsites section");
                }
                continue;
            }
            if section == "db"
                && let Some(tables) = value.as_object_mut()
            {
                for table in tables.values_mut() {
                    for kind in ["added", "removed", "changed"] {
                        if let Some(rows) = table[kind].as_array_mut() {
                            rows.sort_by_key(|row| self.normalizer.order_key(row));
                        }
                    }
                }
            }
            if section == "kafka"
                && let Some(events) = value.as_array_mut()
            {
                // Concurrent sends in one handler have no defined completion
                // order; order by semantic content before assigning UUID names.
                events.sort_by_key(|event| self.normalizer.order_key(event));
            }
            let value = self.normalizer.value(section, value);
            writeln!(self.text, "{section}:").expect("write section");
            if section == "spans" {
                render_spans(&mut self.text, &value, None, 1);
            } else if section == "sql" {
                self.render_sql(&value);
            } else {
                let pretty = serde_json::to_string_pretty(&value).expect("section JSON");
                for line in pretty.lines() {
                    writeln!(self.text, "  {line}").expect("section line");
                }
            }
        }
        self.text.push('\n');
    }

    fn render_sql(&mut self, value: &Value) {
        let mut references = BTreeMap::new();
        for statement in value["statements"].as_array().expect("SQL statements") {
            let sql = statement["sql"].as_str().expect("SQL text");
            let sql = format!("{}\n", sql.split_whitespace().collect::<Vec<_>>().join(" "));
            let id = statement_id(&sql);
            if let Some(previous) = self.statements.insert(id.clone(), sql.clone()) {
                assert_eq!(previous, sql, "SQL content-address collision: {id}");
            }
            references.insert(statement["id"].as_u64().expect("statement number"), id);
        }
        let sequence = value["sequence"].as_array().expect("SQL sequence");
        if sequence.is_empty() {
            self.text.push_str("  []\n");
        }
        for execution in sequence {
            let index = execution["statement"]
                .as_u64()
                .expect("statement reference");
            writeln!(
                self.text,
                "  {} rows_affected={} rows_returned={}",
                references[&index], execution["rows_affected"], execution["rows_returned"]
            )
            .expect("SQL execution");
        }
    }

    pub fn take(&mut self) -> String {
        std::mem::take(&mut self.text)
    }

    #[expect(
        clippy::disallowed_methods,
        reason = "PARITY_OUT and PARITY_UPDATE are explicit test controls, never application secrets"
    )]
    pub fn finish(self) {
        let relative = PathBuf::from(&self.suite).join(format!("{}.txt", self.name));
        let golden = golden_root().join(&relative);
        let update = std::env::var("PARITY_UPDATE").as_deref() == Ok("1");
        for (id, sql) in &self.statements {
            write_statement(&golden_root().join(&self.suite), id, sql, update);
        }
        if let Ok(out) = std::env::var("PARITY_OUT") {
            for (id, sql) in &self.statements {
                write_statement(&PathBuf::from(&out).join(&self.suite), id, sql, true);
            }
            write_file(&PathBuf::from(&out).join(&relative), &self.text);
            write_file(
                &PathBuf::from(&out).join(relative.with_extension("callsites.txt")),
                &self.callsites,
            );
            write_file(
                &PathBuf::from(out).join(relative.with_extension("debug-spans.txt")),
                &self.debug_spans,
            );
        }
        if update {
            write_file(&golden, &self.text);
        } else {
            let expected = std::fs::read_to_string(&golden).unwrap_or_else(|error| {
                panic!(
                    "{}: {error}; generate with PARITY_UPDATE=1",
                    golden.display()
                )
            });
            if expected != self.text {
                panic!("{}", difference(&expected, &self.text));
            }
        }
    }
}

fn statement_id(sql: &str) -> String {
    format!("{:x}", Sha256::digest(sql.as_bytes()))[..12].to_owned()
}

fn write_statement(suite: &Path, id: &str, sql: &str, create: bool) {
    let directory = suite.join("sql");
    let path = directory.join(format!("{id}.sql"));
    if create {
        std::fs::create_dir_all(&directory).expect("SQL directory");
        let temporary = directory.join(format!(".{}.tmp", uuid::Uuid::now_v7()));
        std::fs::write(&temporary, sql).expect("write complete SQL statement");
        // Linking a completed sibling file publishes atomically without replacing
        // another process's statement. Readers never see a partially written file.
        let linked = std::fs::hard_link(&temporary, &path);
        std::fs::remove_file(&temporary).expect("remove temporary SQL statement");
        if let Err(error) = linked {
            assert_eq!(
                error.kind(),
                std::io::ErrorKind::AlreadyExists,
                "publish SQL statement {}: {error}",
                path.display()
            );
        }
    }
    let actual = std::fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!("{}: {error}; generate with PARITY_UPDATE=1", path.display())
    });
    assert_eq!(actual, sql, "SQL statement contents: {}", path.display());
}

pub(super) fn assert_sql_references(suite: &Path, referenced: BTreeSet<String>) {
    let directory = suite.join("sql");
    let mut stored = BTreeSet::new();
    if directory.exists() {
        for entry in std::fs::read_dir(directory).expect("SQL statements") {
            let path = entry.expect("SQL entry").path();
            assert_eq!(
                path.extension().and_then(|s| s.to_str()),
                Some("sql"),
                "unexpected SQL file {}",
                path.display()
            );
            let id = path.file_stem().expect("SQL hash").to_str().expect("UTF-8");
            let sql = std::fs::read_to_string(&path).expect("SQL text");
            assert_eq!(
                statement_id(&sql),
                id,
                "SQL content address: {}",
                path.display()
            );
            stored.insert(id.to_owned());
        }
    }
    assert_eq!(
        stored,
        referenced,
        "orphan or missing SQL statement in {}",
        suite.display()
    );
}

fn render_spans(out: &mut String, value: &Value, parent: Option<usize>, depth: usize) {
    let Some(spans) = value.as_array() else {
        return;
    };
    let mut children: Vec<_> = spans
        .iter()
        .enumerate()
        .filter(|(_, span)| span["parent"].as_u64().map(|n| n as usize) == parent)
        .collect();
    // Only publish tasks race the serial handler. Keep serial creation order
    // and place concurrent publisher siblings last in canonical field order.
    children.sort_by_key(|(index, span)| {
        if span["name"] == "kafka.publish" {
            (true, 0, span["fields"].to_string())
        } else {
            (false, *index, String::new())
        }
    });
    if children.is_empty() && parent.is_none() {
        out.push_str("  []\n");
    }
    for (index, span) in children {
        writeln!(
            out,
            "{}{} {} {}",
            "  ".repeat(depth),
            span["level"].as_str().expect("span level"),
            span["name"].as_str().expect("span name"),
            span["fields"]
        )
        .expect("span line");
        render_spans(out, value, Some(index), depth + 1);
    }
}

pub(super) fn golden_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src/parity/golden")
}

fn write_file(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().expect("transcript directory"))
        .expect("create transcript directory");
    std::fs::write(path, text).expect("write transcript");
}

pub(super) fn difference(expected: &str, actual: &str) -> String {
    if expected == actual {
        return String::new();
    }
    let before: Vec<_> = expected.lines().collect();
    let after: Vec<_> = actual.lines().collect();
    let prefix = before
        .iter()
        .zip(&after)
        .take_while(|(a, b)| a == b)
        .count();
    let suffix = before[prefix..]
        .iter()
        .rev()
        .zip(after[prefix..].iter().rev())
        .take_while(|(a, b)| a == b)
        .count();
    let start = prefix.saturating_sub(2);
    let old_end = (before.len() - suffix + 2).min(before.len());
    let new_end = (after.len() - suffix + 2).min(after.len());
    let mut out = format!(
        "--- golden\n+++ actual\n@@ -{},{} +{},{} @@\n",
        start + 1,
        old_end - start,
        start + 1,
        new_end - start
    );
    for line in &before[start..prefix] {
        writeln!(out, " {line}").expect("diff context");
    }
    for line in &before[prefix..before.len() - suffix] {
        writeln!(out, "-{line}").expect("diff removal");
    }
    for line in &after[prefix..after.len() - suffix] {
        writeln!(out, "+{line}").expect("diff addition");
    }
    for line in &before[before.len() - suffix..old_end] {
        writeln!(out, " {line}").expect("diff context");
    }
    out
}
