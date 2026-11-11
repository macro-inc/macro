//! Receiver canonical comparison differs from the source writer's draft-stripped wire form.
use lexical_loro::{LoroProjection, PlainPolicy, new_doc, reconstruct_state};
use lexical_model::*;
use loro::ExportMode;
use macro_document_model::{EditorType, Result, preset_builder_with_mode, sync::MACRO_SYNC_POLICY};
use serde_json::Value;

#[test]
fn draft_receiver_compares_source_export_without_mutating_writer_or_storage() -> Result<()> {
    let oracle: Value = serde_json::from_str(include_str!("corpus/draft_cache.json"))?;
    for row in oracle["rows"]
        .as_array()
        .expect("actual Source bootstrap cases")
    {
        let writer = preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .initial_state(serde_json::from_value(row["writerWire"].clone())?)
            .build()?;
        let writer_json = lexical_loro::synced_json(writer.state(), &MACRO_SYNC_POLICY)?;
        assert_eq!(serde_json::to_value(&writer_json)?, row["strippedWire"]);
        let doc = new_doc(99)?;
        let writer_projection =
            LoroProjection::initialize(&doc, writer.state(), &MACRO_SYNC_POLICY, 0)?;
        let snapshot = doc
            .export(ExportMode::Snapshot)
            .expect("actual stored snapshot");
        let updates = doc
            .export(ExportMode::updates(&Default::default()))
            .expect("actual stored operations");
        let vv = doc.oplog_vv();
        let raw = reconstruct_state(&doc, &PlainPolicy)?;
        assert_eq!(serde_json::to_value(&raw)?, row["strippedWire"]);
        let receiver = preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .initial_state(reconstruct_state(&doc, &MACRO_SYNC_POLICY)?)
            .build()?;
        assert_eq!(
            serde_json::to_value(receiver.state().to_json()?)?,
            row["attachedJSON"]
        );
        let paragraph = receiver
            .state()
            .view()
            .first_child(NodeKey::ROOT)
            .expect("actual paragraph");
        assert_eq!(
            receiver.state().view().element_data(paragraph)?.text_format,
            TextFormat::BOLD
        );
        assert_eq!(
            receiver
                .state()
                .view()
                .element_data(paragraph)?
                .text_style
                .as_ref(),
            "color:red"
        );
        let projection = LoroProjection::attach(&doc, receiver.state(), &MACRO_SYNC_POLICY)?;
        projection
            .check_nodes(&doc, receiver.state(), &[paragraph])
            .expect("incremental receiver comparison");
        projection
            .check(&doc, receiver.state())
            .expect("complete receiver comparison");
        writer_projection
            .check(&doc, writer.state())
            .expect("complete writer comparison");
        assert_eq!(
            lexical_loro::synced_json(writer.state(), &MACRO_SYNC_POLICY)?,
            writer_json
        );
        assert_eq!(reconstruct_state(&doc, &PlainPolicy)?, raw);
        assert_eq!(doc.oplog_vv(), vv);
        assert_eq!(
            doc.export(ExportMode::Snapshot)
                .expect("unchanged snapshot"),
            snapshot
        );
        assert_eq!(
            doc.export(ExportMode::updates(&Default::default()))
                .expect("unchanged operations"),
            updates
        );
    }
    Ok(())
}

#[test]
fn changed_child_invalidates_parent_comparison_and_raw_wire_updates_remain_visible() -> Result<()> {
    let oracle: Value = serde_json::from_str(include_str!("corpus/draft_cache.json"))?;
    let row = &oracle["rows"][0];
    let writer = preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
        .initial_state(serde_json::from_value(row["writerWire"].clone())?)
        .build()?;
    let doc = new_doc(100)?;
    LoroProjection::initialize(&doc, writer.state(), &MACRO_SYNC_POLICY, 0)?;
    let receiver = preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
        .initial_state(reconstruct_state(&doc, &MACRO_SYNC_POLICY)?)
        .build()?;
    let paragraph = receiver
        .state()
        .view()
        .first_child(NodeKey::ROOT)
        .expect("paragraph");
    let text = receiver
        .state()
        .view()
        .all_text_nodes(NodeKey::ROOT)
        .next()
        .expect("text");
    let mut projection = LoroProjection::attach(&doc, receiver.state(), &MACRO_SYNC_POLICY)?;
    let mut core = EditorCore::new(
        receiver,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    let Some(loro::Container::Map(text_map)) =
        doc.get_container(projection.container_of(text).expect("text binding").clone())
    else {
        panic!("actual text map");
    };
    text_map.insert("format", 1).expect("actual remote format");
    text_map
        .insert("style", "color: blue;")
        .expect("actual remote style");
    doc.commit_with(
        loro::CommitOptions::new()
            .origin("remote-format")
            .timestamp(1),
    );
    assert!(
        projection
            .check_nodes(&doc, core.state(), &[paragraph])
            .is_err(),
        "a parent-only check must read changed projected text fields"
    );
    let changes = projection.take_remote(&doc, core.state())?;
    let output = core
        .apply(
            Input::ApplyRemote {
                changes: changes.changes.clone(),
                options: UpdateOptions::default(),
            },
            HistoryTime(1),
        )
        .expect("actual remote format application");
    let created = output
        .effects
        .iter()
        .flat_map(|effect| match effect {
            Effect::RemoteNodesCreated(pairs) => pairs.clone(),
            _ => vec![],
        })
        .collect::<Vec<_>>();
    projection.bind_created(changes, &created)?;
    projection.local_commit(&doc, &output.commits, lexical_loro::FIXUP_ORIGIN, 1)?;
    projection
        .check_nodes(&doc, core.state(), &[paragraph])
        .expect("updated parent comparison");
    projection
        .check(&doc, core.state())
        .expect("updated complete comparison");
    let Some(loro::Container::Map(parent_map)) = doc.get_container(
        projection
            .container_of(paragraph)
            .expect("parent binding")
            .clone(),
    ) else {
        panic!("actual paragraph map");
    };
    parent_map
        .insert("textFormat", 2)
        .expect("actual incoming raw cache");
    doc.commit_with(
        loro::CommitOptions::new()
            .origin("remote-cache")
            .timestamp(2),
    );
    let changes = projection.take_remote(&doc, core.state())?;
    assert!(changes.changes.iter().any(|change| matches!(change, NodeChange::Update { node: NodeTarget::Key(key), .. } if *key == paragraph)), "comparison equivalence must not erase a real wire cache update");
    Ok(())
}

#[test]
fn ordinary_typing_never_enters_comparison_canonicalization_on_small_or_large_docs() -> Result<()> {
    use lexical_loro::{ComparisonKind, SyncPolicy};
    use std::sync::atomic::{AtomicUsize, Ordering};
    struct CountingPolicy(AtomicUsize);
    impl SyncPolicy for CountingPolicy {
        fn own_undefined_fields(&self, ty: &str) -> &[String] {
            MACRO_SYNC_POLICY.own_undefined_fields(ty)
        }
        fn allows_null_text(&self, ty: &str) -> bool {
            MACRO_SYNC_POLICY.allows_null_text(ty)
        }
        fn comparison_kind(&self, ty: &str) -> ComparisonKind {
            self.0.fetch_add(1, Ordering::Relaxed);
            MACRO_SYNC_POLICY.comparison_kind(ty)
        }
        fn is_dropped(&self, view: StateRef<'_>, key: NodeKey) -> bool {
            MACRO_SYNC_POLICY.is_dropped(view, key)
        }
        fn is_transparent(&self, view: StateRef<'_>, key: NodeKey) -> bool {
            MACRO_SYNC_POLICY.is_transparent(view, key)
        }
        fn is_dropped_json(&self, node: &SerializedNode) -> bool {
            MACRO_SYNC_POLICY.is_dropped_json(node)
        }
        fn is_transparent_json(&self, node: &SerializedNode) -> bool {
            MACRO_SYNC_POLICY.is_transparent_json(node)
        }
        fn canonicalize_node_json(&self, node: &mut SerializedNode) {
            MACRO_SYNC_POLICY.canonicalize_node_json(node);
        }
        fn local_state_keys(&self) -> &'static [&'static str] {
            MACRO_SYNC_POLICY.local_state_keys()
        }
        fn ignore_in_remote_compare(
            &self,
            ty: &str,
            node: &SerializedNode,
        ) -> &'static [&'static str] {
            MACRO_SYNC_POLICY.ignore_in_remote_compare(ty, node)
        }
        fn keep_local_on_remote(&self, ty: &str) -> &'static [&'static str] {
            MACRO_SYNC_POLICY.keep_local_on_remote(ty)
        }
    }
    static POLICY: CountingPolicy = CountingPolicy(AtomicUsize::new(0));
    for paragraphs in [10, 10_000] {
        let mut editor =
            preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached).build()?;
        let (text, _) = editor.update(|tx| {
            let mut children = Vec::new();
            let mut last = None;
            for _ in 0..paragraphs {
                let paragraph = tx.create(Paragraph {})?;
                let text = tx.create_text("fixture")?;
                tx.append(paragraph, &[text.key()])?;
                children.push(paragraph.key());
                last = Some(text.key());
            }
            tx.append(NodeKey::ROOT, &children)?;
            Ok(last.expect("actual large document text"))
        })?;
        let doc = new_doc(101)?;
        let mut projection = LoroProjection::initialize(&doc, editor.state(), &POLICY, 0)?;
        POLICY.0.store(0, Ordering::Relaxed);
        for edit in 0..10 {
            let (_, commit) = editor.update(|tx| {
                tx.text(text)?
                    .set_text_content(&format!("fixture-{edit}"))?;
                Ok(())
            })?;
            projection.local_commit(&doc, &[commit], lexical_loro::LOCAL_ORIGIN, edit + 1)?;
        }
        assert_eq!(
            POLICY.0.load(Ordering::Relaxed),
            0,
            "comparison work entered ordinary typing for {paragraphs} paragraphs"
        );
    }
    Ok(())
}

#[test]
fn comparison_preserves_meaningful_empty_and_nested_paragraph_typing_attributes() -> Result<()> {
    for children in [
        serde_json::json!([]),
        serde_json::json!([{
            "type":"paragraph","version":1,"children":[{
                "type":"text","version":1,"text":"nested","format":0,"detail":0,"mode":"normal","style":""
            }]
        }]),
    ] {
        let editor = preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .initial_state(serde_json::from_value(serde_json::json!({"root":{
                "type":"root","version":1,"children":[{
                    "type":"paragraph","version":1,"textFormat":1,"textStyle":"color:red","children":children
                }]
            }}))?)
            .build()?;
        let paragraph = editor
            .state()
            .view()
            .first_child(NodeKey::ROOT)
            .expect("actual paragraph");
        let doc = new_doc(102)?;
        let projection = LoroProjection::initialize(&doc, editor.state(), &MACRO_SYNC_POLICY, 0)?;
        let Some(loro::Container::Map(map)) = doc.get_container(
            projection
                .container_of(paragraph)
                .expect("actual paragraph binding")
                .clone(),
        ) else {
            panic!("actual paragraph map");
        };
        map.insert("textFormat", 2)
            .expect("meaningful source typing format");
        doc.commit_with(
            loro::CommitOptions::new()
                .origin("remote-empty-format")
                .timestamp(1),
        );
        assert!(
            projection.check(&doc, editor.state()).is_err(),
            "non-direct text descendants must not erase paragraph-owned typing attributes"
        );
        assert!(
            projection
                .check_nodes(&doc, editor.state(), &[paragraph])
                .is_err()
        );
    }
    Ok(())
}
