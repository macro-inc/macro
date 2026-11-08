//! Development-only commit serialization; production uses the session codec.
use lexical_model::*;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use specta::Type;
use std::collections::BTreeSet;

/// Postcard envelope containing the existing flat model diff and host metadata.
#[derive(Serialize, Deserialize, Type)]
pub struct HostCommitPacket {
    /// Development envelope version; independent of the flat diff version.
    pub format_version: u32,
    /// S1 flat diff words, retaining their specified opcode/layout contract.
    pub words: Vec<u32>,
    /// S1 flat diff UTF-8 string table.
    pub strings: Vec<u8>,
    /// Ordered changed base-record fields, mutations, tags and selection as JSON.
    pub metadata_json: String,
}

impl HostCommitPacket {
    pub(crate) fn from_commit(commit: &Commit, version: u64) -> Result<Self, Error> {
        let mut buffer = DiffBuffer::default();
        commit.encode_diff(
            &DiffOptions {
                include_state: true,
            },
            &mut buffer,
        )?;
        let last = commit.chain().last().unwrap_or(commit);
        let view = last.next.view();
        let mut changed = BTreeSet::new();
        let mut mutations = Vec::new();
        for transition in commit.chain() {
            for (key, mutation) in &transition.changes.mutations {
                changed.insert(*key);
                mutations.push(json!({"key":key.to_string(),"mutation":mutation.to_string()}));
            }
        }
        let records: Vec<_> = changed
            .into_iter()
            .filter_map(|key| view.node(key).map(|node| raw_record(node)))
            .collect();
        let metadata = json!({
            "version": version,
            "commit": last.id.0,
            "records": records,
            "mutations": mutations,
            "tags": commit.tags.iter().map(ToString::to_string).collect::<Vec<_>>(),
            "selection": selection(last.next.selection()),
        });
        Ok(Self {
            format_version: 1,
            words: buffer.words,
            strings: buffer.strings,
            metadata_json: to_js_json_string(&metadata),
        })
    }
}

fn raw_record(node: NodeRef<'_>) -> Value {
    let mut record = json!({
        "__key":node.key().to_string(),
        "__type":node.type_name(),
        "__parent":node.parent().map(|k| k.to_string()),
        "__prev":node.prev().map(|k| k.to_string()),
        "__next":node.next().map(|k| k.to_string()),
    });
    match node.base() {
        BaseData::Element(data) => {
            for (name, value) in [
                ("__first", json!(data.first_child().map(|k| k.to_string()))),
                ("__last", json!(data.last_child().map(|k| k.to_string()))),
                ("__size", json!(data.children_size())),
                ("__format", json!(data.format.bits())),
                ("__indent", json!(data.indent)),
                ("__dir", json!(data.direction)),
                ("__style", json!(data.style)),
                ("__textFormat", json!(data.text_format.bits())),
                ("__textStyle", json!(data.text_style)),
            ] {
                record[name] = value;
            }
        }
        BaseData::Text(data) => {
            record["__text"] = json!(data.text.as_str());
            record["__format"] = json!(data.format.bits());
            record["__style"] = json!(data.style);
            record["__mode"] = json!(match data.mode {
                TextMode::Normal => 0,
                TextMode::Token => 1,
                TextMode::Segmented => 2,
            });
            record["__detail"] = json!(data.detail.bits());
        }
        BaseData::Decorator | BaseData::LineBreak => {}
    }
    record
}

fn point(point: Point) -> Value {
    json!({"key":point.key().to_string(),"offset":point.offset(),"type":point.point_type().to_string()})
}

fn selection(selection: Option<&Selection>) -> Value {
    match selection {
        None => Value::Null,
        Some(Selection::Range(range)) => {
            json!({"type":"range","anchor":point(range.anchor),"focus":point(range.focus),"format":range.format.bits(),"style":range.style})
        }
        Some(Selection::Node(nodes)) => {
            json!({"type":"node","nodes":nodes.keys().map(|k|k.to_string()).collect::<Vec<_>>()})
        }
        Some(Selection::Table(table)) => {
            json!({"type":"table","table":table.table.to_string(),"anchor":point(table.anchor),"focus":point(table.focus)})
        }
    }
}
