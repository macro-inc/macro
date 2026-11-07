use super::hooks::{AssignIds, Ids};
use super::*;
use proptest::prelude::*;
use serde_json::Value;
use std::io::Write;
use std::process::{Command, Stdio};

fn bun(input: Value) -> Value {
    let mut child = Command::new("bun")
        .arg(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/src/test/differential/runner.ts"
        ))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("Bun is required for the collab differential");
    child
        .stdin
        .take()
        .expect("stdin")
        .write_all(input.to_string().as_bytes())
        .expect("write input");
    let output = child.wait_with_output().expect("Bun completion");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("mirror JSON")
}
fn observe(doc: &LoroDoc) -> Result<Value> {
    fn visit(container: Container, path: String, kinds: &mut serde_json::Map<String, Value>) {
        let kind = match &container {
            Container::Map(_) => "Map",
            Container::List(_) => "List",
            Container::MovableList(_) => "MovableList",
            Container::Text(_) => "Text",
            _ => panic!("unexpected persisted container"),
        };
        kinds.insert(path.clone(), json!(kind));
        let mut item = |key: String, value: ValueOrContainer| {
            if let ValueOrContainer::Container(container) = value {
                visit(container, format!("{path}/{key}"), kinds);
            }
        };
        match container {
            Container::Map(map) => map.for_each(|key, value| item(key.to_owned(), value)),
            Container::List(list) => {
                for i in 0..list.len() {
                    item(i.to_string(), list.get(i).expect("item"));
                }
            }
            Container::MovableList(list) => {
                for i in 0..list.len() {
                    item(i.to_string(), list.get(i).expect("item"));
                }
            }
            _ => {}
        }
    }
    let mut kinds = serde_json::Map::new();
    visit(
        Container::Map(doc.get_map("root")),
        "root".into(),
        &mut kinds,
    );
    Ok(json!({"value": schema::from_loro(&doc.get_deep_value())?, "kinds": kinds}))
}
fn stream(script: &[(u8, u8)]) -> Result<(Value, Vec<Value>)> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .extension_state(Ids {
            peer: "fuzz",
            next: 0,
        })
        .plugin(AssignIds)
        .build()
        .expect("editor");
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("start😀")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.select_end(text)
    })?;
    let doc = new_doc(17)?;
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0)?;
    let snapshot = doc.export(ExportMode::Snapshot)?;
    let mut states = Vec::new();
    let mut observations = Vec::new();
    // Adapt the collab fuzzer's weighted per-peer key stream and end-of-block
    // precondition (apps/web/.../LexicalMarkdown/fuzz/{commands,model}.ts).
    // Shortcut/code inputs remain literal text: application transforms are WP-29.
    for (i, (weight, glyph)) in script.iter().enumerate() {
        let (_, commit) = editor.update(|tx| match weight % 100 {
            0..=44 => tx.insert_text(["a", "é", "😀", "中", "\u{301}"][usize::from(*glyph) % 5]),
            45..=59 => tx.insert_paragraph().map(|_| ()),
            60..=64 => tx.insert_line_break(false),
            65..=78 => {
                tx.delete_character(EditDirection::Backward, ModifyTarget::ModelSegmentation)
            }
            79..=90 => tx.insert_text("# "),
            _ => tx.insert_text("```"),
        })?;
        projection.local_commit(&doc, &[commit], LOCAL_ORIGIN, i as i64 + 1)?;
        projection
            .check(&doc, editor.state())
            .expect("native projection consistent");
        states.push(serde_json::to_value(synced_json(editor.state(), &PLAIN)?).expect("state"));
        observations.push(observe(&doc)?);
    }
    Ok((
        json!({"snapshot": snapshot, "states": states}),
        observations,
    ))
}

#[test]
fn literal_loro_pair_native_snapshots_updates_and_mirror_values_and_kinds() -> Result<()> {
    let script = [
        (0, 0),
        (0, 2),
        (45, 0),
        (0, 1),
        (60, 0),
        (0, 3),
        (65, 0),
        (0, 0),
    ];
    let (run, expected) = stream(&script)?;
    let result = bun(json!({"runs":[run]}));
    assert_eq!(result[0]["observations"], json!(expected));
    let bytes: Vec<u8> =
        serde_json::from_value(result[0]["snapshot"].clone()).expect("snapshot bytes");
    let native = new_doc(19)?;
    native.import(&bytes)?;
    assert_eq!(observe(&native)?, *expected.last().expect("last"));
    Ok(())
}
proptest! {
    #![proptest_config(ProptestConfig { cases: 32, ..ProptestConfig::default() })]
    #[test]
    fn collab_key_stream_matches_current_mirror(script in prop::collection::vec((any::<u8>(),any::<u8>()),1..80)) {
        let (run, expected) = stream(&script).expect("native stream");
        let result = bun(json!({"runs":[run]}));
        prop_assert_eq!(&result[0]["observations"], &json!(expected));
    }
}
