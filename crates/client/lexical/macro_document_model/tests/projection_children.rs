//! Structural projection work and exact receipts across document sizes.
use lexical_loro::{LOCAL_ORIGIN, LoroProjection, new_doc};
use lexical_model::*;
use loro::{ExportMode, ToJson};
use macro_document_model::{
    EditorType, Result, node_ids::ID_STATE, preset_builder_with_mode, sync::MACRO_SYNC_POLICY,
};
use serde_json::{Value, json};
use std::time::Instant;

fn insert_blocks(size: usize, position: usize) -> Result<(Value, lexical_loro::ProjectionStats)> {
    let mut editor =
        preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached).build()?;
    let (original, _) = editor.update(|tx| {
        let mut children = Vec::new();
        for index in 0..size {
            let paragraph = tx.create(Paragraph {})?;
            let text = tx.create_text(&format!("original-{index}"))?;
            tx.set_state(paragraph, &ID_STATE, Some(format!("block-{index}")))?;
            tx.set_state(text, &ID_STATE, Some(format!("text-{index}")))?;
            tx.append(paragraph, &[text.key()])?;
            children.push(paragraph.key());
        }
        tx.append(NodeKey::ROOT, &children)?;
        Ok(children)
    })?;
    let doc = new_doc(7)?;
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &MACRO_SYNC_POLICY, 0)?;
    doc.set_peer_id(8).expect("explicit paste peer");
    let before = doc.oplog_vv();
    let (_, commit) = editor.update(|tx| {
        let mut inserted = Vec::new();
        for index in 0..256 {
            let paragraph = tx.create(Paragraph {})?;
            let text = tx.create_text(&format!("inserted-{index}"))?;
            tx.set_state(paragraph, &ID_STATE, Some(format!("pasted-block-{index}")))?;
            tx.set_state(text, &ID_STATE, Some(format!("pasted-text-{index}")))?;
            tx.append(paragraph, &[text.key()])?;
            inserted.push(paragraph.key());
        }
        if position == size {
            tx.append(NodeKey::ROOT, &inserted)?;
        } else {
            for key in inserted {
                tx.insert_before(original[position], key, true)?;
            }
        }
        Ok(())
    })?;
    let started = Instant::now();
    let result = projection.local_commit(&doc, &[commit], LOCAL_ORIGIN, 99)?;
    let elapsed_ns = started.elapsed().as_nanos();
    projection
        .check(&doc, editor.state())
        .expect("independent full projection check");
    let peer = new_doc(9)?;
    peer.import(&doc.export(ExportMode::Snapshot).expect("actual snapshot"))
        .expect("fresh snapshot replay");
    assert_eq!(peer.get_deep_value(), doc.get_deep_value());
    assert_eq!(peer.oplog_vv(), doc.oplog_vv());
    let mut frontiers = doc
        .oplog_frontiers()
        .iter()
        .map(|id| (id.peer.to_string(), id.counter))
        .collect::<Vec<_>>();
    frontiers.sort();
    let receipt = json!({
        "size":size,"position":position,"elapsed_ns":elapsed_ns,
        "stats":{"nodes_visited":result.stats.nodes_visited,
            "children_scanned":result.stats.children_scanned,
            "containers_written":result.stats.containers_written},
        "observable":{
            "model":editor.state().to_json()?,
            "loro":doc.get_deep_value().to_json_value(),
            "vv":serde_json::to_value(doc.oplog_vv())?,
            "frontiers":frontiers,
            "ops":doc.export_json_updates(&before,&doc.oplog_vv()).expect("actual ordered operations")
        }
    });
    Ok((receipt, result.stats))
}

#[test]
fn large_middle_insertion_visits_changed_children_without_scanning_the_document() -> Result<()> {
    let (_, stats) = insert_blocks(10_000, 5_000)?;
    assert!(
        stats.children_scanned < 4096,
        "unchanged sibling slots inspected: {}",
        stats.children_scanned
    );
    Ok(())
}

#[test]
#[ignore = "explicit baseline/paired measurement, writes only to an owned temporary directory"]
fn record_projection_children_receipts() -> Result<()> {
    let directory = std::path::PathBuf::from(
        std::env::var_os("SYNC_PROJECTION_PROFILE_DIR").expect("owned receipt output directory"),
    );
    std::fs::create_dir_all(&directory).expect("owned receipt directory");
    let reference = std::env::var_os("SYNC_PROJECTION_REFERENCE_DIR").map(std::path::PathBuf::from);
    for size in [100, 10_000] {
        for position in [0, size / 2, size] {
            for repeat in 0..3 {
                let (receipt, _) = insert_blocks(size, position)?;
                let name = format!("{size}-{position}-{repeat}.json");
                std::fs::write(directory.join(&name), serde_json::to_vec(&receipt)?)
                    .expect("actual receipt output");
                if let Some(reference) = &reference {
                    let expected: Value = serde_json::from_slice(
                        &std::fs::read(reference.join(&name))
                            .expect("preserved unmodified reference receipt"),
                    )?;
                    assert!(
                        serde_json::to_vec(&receipt["observable"])?
                            == serde_json::to_vec(&expected["observable"])?,
                        "ordered operations/JSON/VV/frontiers differ for {name}; both receipts retained"
                    );
                }
                eprintln!(
                    "projection size={size} position={position} repeat={repeat} ns={} stats={}",
                    receipt["elapsed_ns"], receipt["stats"]
                );
            }
        }
    }
    Ok(())
}
