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
    #[test]
    fn collab_key_stream_matches_current_mirror(script in prop::collection::vec((any::<u8>(),any::<u8>()),1..80)) {
        let (run, expected) = stream(&script).expect("native stream");
        let result = bun(json!({"runs":[run]}));
        prop_assert_eq!(&result[0]["observations"], &json!(expected));
    }
}

#[test]
fn loro_pair_imports_updates_and_resolves_cursor_bytes_in_both_directions() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let (text, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("a😀b")?;
        tx.set_state(text, &ID, "text".into())?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.text(text)?
            .select(Some(Utf16Offset(3)), Some(Utf16Offset(3)))?;
        Ok(text)
    })?;
    let doc = new_doc(17)?;
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0)?;
    let snapshot = doc.export(ExportMode::Snapshot)?;
    let cursor = projection
        .cursor(
            &doc,
            editor.state(),
            editor.state().selection().expect("selection"),
        )
        .expect("cursor")
        .anchor;
    let baseline = doc.oplog_vv();
    let (_, commit) = editor.update(|tx| tx.insert_text("Rust"))?;
    projection.local_commit(&doc, &[commit], LOCAL_ORIGIN, 1)?;
    let map = projection.index.map(&doc, text.key())?;
    let text_id = schema::slot_id(&map, "text").expect("text").to_string();
    let result = bun(
        json!({"pair": {"snapshot":snapshot,"updates":[doc.export(ExportMode::updates(&baseline))?], "cursor":cursor.cursor.encode(), "textId":text_id}}),
    );
    assert_eq!(result["resolved"], json!(7));
    let ts_cursor: Vec<u8> = serde_json::from_value(result["cursor"].clone()).expect("cursor");
    let bytes: Vec<u8> = serde_json::from_value(result["updates"].clone()).expect("updates");
    let (_, changes) = projection.remote(&doc, editor.state(), &bytes)?;
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    assert!(!super::peers::apply_remote(&mut projection, &doc, &mut core, changes, 4)?.changed);
    projection.check(&doc, core.state()).expect("mixed peer");
    assert_eq!(observe(&doc)?, result["observation"]);
    assert_eq!(
        projection.point(
            &doc,
            core.state(),
            &NodeCursor {
                node_id: "text".into(),
                cursor: loro::cursor::Cursor::decode(&ts_cursor).expect("cursor")
            }
        ),
        Some(Point::text(text, Utf16Offset(3)))
    );
    let native = new_doc(29)?;
    native.import(
        &serde_json::from_value::<Vec<u8>>(result["snapshot"].clone()).expect("snapshot"),
    )?;
    assert_eq!(observe(&native)?, observe(&doc)?);
    Ok(())
}

fn relay_stream(script: &[(u8, u8)]) -> Result<(Value, Vec<Value>)> {
    let mut a = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    a.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("shared😀")?;
        tx.set_state(p, &ID, "p".into())?;
        tx.set_state(text, &ID, "t".into())?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])
    })?;
    let da = new_doc(17)?;
    let pa = LoroProjection::initialize(&da, a.state(), &PLAIN, 0)?;
    let snapshot = da.export(ExportMode::Snapshot)?;
    let db = fork_doc(&da, 18)?;
    let mut b = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let state = b.parse_editor_state(&a.state().to_json()?)?;
    b.set_editor_state(state, TagSet::default())?;
    let pb = LoroProjection::attach(&db, b.state(), &PLAIN)?;
    let config = || CoreConfig {
        history: None,
        editable: true,
        diff: DiffOptions::default(),
        track_text_content: false,
    };
    let mut cores = [EditorCore::new(a, config()), EditorCore::new(b, config())];
    let docs = [da, db];
    let mut projections = [pa, pb];
    let mut messages: Vec<(usize, Vec<u8>)> = Vec::new();
    let mut pending = Vec::new();
    let mut events = Vec::new();
    let mut expected = Vec::new();
    let mut online = [true, true];
    // Same key/delivery/offline/online weighting as the browser collab fuzzer.
    // Pending messages may be delivered out of order; final flush is mandatory.
    for (step, (command, data)) in script.iter().enumerate() {
        let peer = usize::from(data % 2);
        match command % 99 {
            0..=69 => {
                let key = *projections[peer].index.ids.get("t").expect("text id");
                let old = cores[peer].state().view().text_content(key);
                let value = format!("{old}{}", ["a", "é", "😀", "中"][usize::from(*data) % 4]);
                let output = cores[peer]
                    .apply(
                        Input::ApplyRemote {
                            changes: vec![NodeChange::SpliceText {
                                node: NodeTarget::Key(key),
                                range: Utf16Offset(0)
                                    ..Utf16Offset(old.encode_utf16().count() as u32),
                                insert: value,
                            }],
                            options: UpdateOptions::default(),
                        },
                        HistoryTime(step as u64 + 1),
                    )
                    .expect("local key input");
                let before = docs[peer].oplog_vv();
                projections[peer].local_commit(
                    &docs[peer],
                    &output.commits,
                    LOCAL_ORIGIN,
                    step as i64 + 1,
                )?;
                events.push(json!({"peer":peer,"state":synced_json(cores[peer].state(), &PLAIN)?}));
                messages.push((1 - peer, docs[peer].export(ExportMode::updates(&before))?));
                pending.push(messages.len() - 1);
                expected.push(observe(&docs[peer])?);
            }
            70..=94 if !pending.is_empty() => {
                let index = usize::from(*data) % pending.len();
                let message = pending[index];
                let (to, bytes) = &messages[message];
                if !online[*to] {
                    continue;
                }
                let (_, changes) =
                    projections[*to].remote(&docs[*to], cores[*to].state(), bytes)?;
                assert!(
                    !super::peers::apply_remote(
                        &mut projections[*to],
                        &docs[*to],
                        &mut cores[*to],
                        changes,
                        step as u64 + 1
                    )?
                    .changed
                );
                projections[*to]
                    .check(&docs[*to], cores[*to].state())
                    .expect("relay consistent");
                events.push(json!({"peer":to,"message":message}));
                expected.push(observe(&docs[*to])?);
                pending.remove(index);
            }
            95..=96 => online[peer] = false,
            97..=98 => online[peer] = true,
            _ => {}
        }
    }
    for message in pending.into_iter().rev() {
        let (to, bytes) = &messages[message];
        let (_, changes) = projections[*to].remote(&docs[*to], cores[*to].state(), bytes)?;
        assert!(
            !super::peers::apply_remote(
                &mut projections[*to],
                &docs[*to],
                &mut cores[*to],
                changes,
                1000
            )?
            .changed
        );
        projections[*to]
            .check(&docs[*to], cores[*to].state())
            .expect("flush consistent");
        events.push(json!({"peer":to,"message":message}));
        expected.push(observe(&docs[*to])?);
    }
    assert_eq!(docs[0].get_deep_value(), docs[1].get_deep_value());
    assert_eq!(
        synced_json(cores[0].state(), &PLAIN)?,
        synced_json(cores[1].state(), &PLAIN)?
    );
    Ok((
        json!({"relay":{"snapshot":snapshot,"events":events}}),
        expected,
    ))
}
#[test]
fn literal_four_peer_relay_matches_mirrors_through_offline_and_reordered_delivery() -> Result<()> {
    let (input, expected) = relay_stream(&[
        (0, 0),
        (0, 1),
        (0, 2),
        (95, 1),
        (70, 0),
        (0, 1),
        (98, 1),
        (71, 2),
        (0, 2),
    ])?;
    assert_eq!(bun(input), json!(expected));
    Ok(())
}
proptest! {
    #[test]
    fn four_peer_relay_converges(script in prop::collection::vec((any::<u8>(),any::<u8>()),1..80)) {
        let (input, expected) = relay_stream(&script).expect("native relay");
        prop_assert_eq!(bun(input), json!(expected));
    }
}

#[test]
fn literal_schema_inference_and_ids_null_guard_match_the_current_mirror() -> Result<()> {
    let states = [
        json!({"root":{"type":"root","version":1,"children":[],"ids":["a","b"],"$":{"id":"root","sharedPeerIds":["a"],"settings":{"x":1}},"items":[{"old":1}]}}),
        json!({"root":{"type":"root","version":1,"children":[],"ids":["x","a","b"],"$":{"id":"root","sharedPeerIds":["a"],"settings":{"x":1}},"items":[{"old":2}]}}),
        json!({"root":{"type":"root","version":1,"children":[],"ids":["b","a"],"$":{"id":"root","sharedPeerIds":["b"],"settings":{"x":2}},"items":[{"old":3}]}}),
        json!({"root":{"type":"root","version":1,"children":[],"ids":[],"$":{"id":"root","sharedPeerIds":[],"settings":{"x":2}},"items":[["numeric-key"]]}}),
    ];
    let doc = new_doc(17)?;
    let root = doc.get_map("root");
    schema::initialize_map(
        &root,
        states[0]["root"].as_object().expect("root"),
        schema::MapSchema::Node,
    )?;
    doc.commit_with(loro::CommitOptions::new().timestamp(0));
    let snapshot = doc.export(ExportMode::Snapshot)?;
    let mut expected = Vec::new();
    for pair in states.windows(2) {
        schema::diff_map(
            &root,
            pair[0]["root"].as_object().expect("old"),
            pair[1]["root"].as_object().expect("new"),
            schema::MapSchema::Node,
            &mut ProjectionStats::default(),
        )?;
        doc.commit_with(loro::CommitOptions::new().timestamp(1));
        expected.push(observe(&doc)?);
    }
    let actual = bun(json!({"runs":[{"snapshot":snapshot,"states":&states[1..]}]}));
    assert_eq!(actual[0]["observations"], json!(expected));
    // Both runtimes preserve old IDs when newId is null. This is an upstream
    // mirror quirk, not a claim that its deep value equals the requested array.
    assert_ne!(
        expected.last().expect("last")["value"]["root"]["ids"],
        json!([])
    );
    Ok(())
}

#[test]
fn fixed_seed_collab_streams_cover_two_thousand_steps_in_each_profile() -> Result<()> {
    for seed in [1u64, 0x8309, 0x11c0ffee, 0xdeadbeef] {
        let mut random = seed;
        let script = (0..512)
            .map(|_| {
                random = random.wrapping_mul(6364136223846793005).wrapping_add(1);
                ((random >> 32) as u8, (random >> 48) as u8)
            })
            .collect::<Vec<_>>();
        let (input, expected) = stream(&script)?;
        let actual = bun(json!({"runs":[input]}));
        assert_eq!(
            actual[0]["observations"],
            json!(expected),
            "key seed={seed}"
        );
        let (input, expected) = relay_stream(&script)?;
        assert_eq!(bun(input), json!(expected), "relay seed={seed}");
    }
    Ok(())
}

#[test]
fn documented_move_after_delete_exception_fixes_the_current_mirror_out_of_bounds_bug() -> Result<()>
{
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let ((a, b, c), _) = editor.update(|tx| {
        let a = tx.create(Paragraph::default())?;
        let b = tx.create(Paragraph::default())?;
        let c = tx.create(Paragraph::default())?;
        tx.set_state(a, &ID, "a".into())?;
        tx.set_state(b, &ID, "b".into())?;
        tx.set_state(c, &ID, "c".into())?;
        tx.append(NodeKey::ROOT, &[a.key(), b.key(), c.key()])?;
        Ok((a, b, c))
    })?;
    let doc = new_doc(17)?;
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0)?;
    let snapshot = doc.export(ExportMode::Snapshot)?;
    let (_, commit) = editor.update(|tx| {
        tx.remove(a, true)?;
        tx.insert_before(b, c, true)
    })?;
    projection.local_commit(&doc, &[commit], LOCAL_ORIGIN, 1)?;
    projection
        .check(&doc, editor.state())
        .expect("corrected move");
    let input =
        json!({"runs":[{"snapshot":snapshot,"states":[synced_json(editor.state(),&PLAIN)?]}]});
    let mut child = Command::new("bun")
        .arg(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/src/test/differential/runner.ts"
        ))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("Bun");
    child
        .stdin
        .take()
        .expect("stdin")
        .write_all(input.to_string().as_bytes())
        .expect("input");
    let output = child.wait_with_output().expect("mirror completion");
    // S11 Δ-2 explicitly permits this divergence. The oracle remains unchanged:
    // today's mirror issues move(2,0) after deleting index0 from a three-item list.
    assert!(!output.status.success());
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("The given pos is 2, but the length is 2")
    );
    Ok(())
}
