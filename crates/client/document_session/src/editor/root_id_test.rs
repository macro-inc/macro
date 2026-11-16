//! C-ROOT-ID-PRESENCE-01. Source's open runs INITIALIZE_DOCUMENT_IDS, which ids the root
//! (nanoid 8) when it has none and keeps an existing one; on an Edit open that id is stored
//! by the open's FIRST write, before the history-merge metadata write (Source control
//! ce3c8b9a, outcome 6e501bb9: ID_STORED_AT_OPEN+ROOT_ID_KEPT). Read-only opens id the model
//! and write nothing (CollabProvider.tsx :162-164).
//!
//! Evidence: each row records every LOCAL COMMIT the reader makes (subscribe_local_update,
//! registered before init) and decodes each one against a scratch doc at the previous
//! version, so ops are seen per commit, not per Loro change (Loro merges consecutive commits
//! of one peer into one change). It prints one raw record (`T1YK-ROOT-ID-RECORD <row> <json>`:
//! the peer, the oplog version before and after, the model and stored root `$`, the container
//! ids, and the decoded commits in order) BEFORE any assertion. The scratch doc must end equal
//! to the live doc (state and version) and the commits together must carry exactly the
//! change-level ops, with nothing lost or doubled. Commits are whatever subscribe_local_update
//! emits; no claim is made about commits it does not emit. Every
//! negative check ("no op touches X") has a positive twin that must find a known write first.
//! A malformed decode, a foreign author or a missing known write is a fixture fault, never a RED.
use super::*;
use loro::{ContainerTrait, ToJson};
use std::sync::atomic::AtomicI64;

const SEED_PEER: u64 = 7;

fn config() -> EditorConfig {
    crate::application_editor_config(
        EditorConfig::default(),
        Arc::new(AtomicI64::new(0)),
        macro_document_model::EditorType::MarkdownSync,
    )
}
fn now() -> Now {
    Now {
        mono: doc_sync_core::Millis(0),
        wall: doc_sync_core::UnixMillis(0),
    }
}
/// Source nodeIdPlugin `$assertId(node, 8)`: an 8-character nanoid.
fn is_minted_id(id: &str) -> bool {
    id.len() == 8
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}
/// The root `$` the model exports (Null when absent).
fn model_root_state(surface: &EditorSurface) -> serde_json::Value {
    let root = surface.state().to_json().expect("model export").root;
    root.get("$").cloned().unwrap_or(serde_json::Value::Null)
}
/// The root `$` stored in Loro (Null when absent).
fn stored_root_state(doc: &loro::LoroDoc) -> serde_json::Value {
    doc.get_deep_value().to_json_value()["root"]["$"].clone()
}
fn id_of(state: &serde_json::Value) -> String {
    state["id"]
        .as_str()
        .map_or_else(|| "<absent>".to_owned(), str::to_owned)
}
/// A container id in Loro's JSON form, the string `cid:…`.
fn container(id: loro::ContainerID) -> serde_json::Value {
    serde_json::Value::String(id.to_string())
}
fn root_map_container() -> serde_json::Value {
    let id = loro::ContainerID::new_root("root", loro::ContainerType::Map).to_string();
    assert_eq!(id, "cid:root-root:Map", "fixture: root container form");
    serde_json::Value::String(id)
}
/// The stored root's `$` map container, or Null when there is none.
fn root_state_container(doc: &loro::LoroDoc) -> serde_json::Value {
    match doc.get_map("root").get("$") {
        Some(loro::ValueOrContainer::Container(loro::Container::Map(map))) => container(map.id()),
        _ => serde_json::Value::Null,
    }
}
/// The stored first root child's `$` map container.
fn first_child_state_container(doc: &loro::LoroDoc) -> serde_json::Value {
    let Some(loro::ValueOrContainer::Container(loro::Container::MovableList(children))) =
        doc.get_map("root").get("children")
    else {
        panic!("fixture: stored children list");
    };
    let Some(loro::ValueOrContainer::Container(loro::Container::Map(first))) = children.get(0)
    else {
        panic!("fixture: stored first child map");
    };
    let Some(loro::ValueOrContainer::Container(loro::Container::Map(state))) = first.get("$")
    else {
        panic!("fixture: stored first child $ map");
    };
    container(state.id())
}
/// The nested `$.documentMetadata` map container, if one is stored.
fn metadata_container(doc: &loro::LoroDoc) -> Option<serde_json::Value> {
    let Some(loro::ValueOrContainer::Container(loro::Container::Map(state))) =
        doc.get_map("root").get("$")
    else {
        return None;
    };
    match state.get("documentMetadata") {
        Some(loro::ValueOrContainer::Container(loro::Container::Map(metadata))) => {
            Some(container(metadata.id()))
        }
        _ => None,
    }
}
/// Every op of `commit` on `container` that touches map key `key` (insert or delete).
fn key_ops(
    commit: &serde_json::Value,
    container: &serde_json::Value,
    key: &str,
) -> Vec<serde_json::Value> {
    commit["ops"]
        .as_array()
        .expect("fixture: commit ops")
        .iter()
        .filter(|op| &op["container"] == container && op["content"]["key"].as_str() == Some(key))
        .map(|op| op["content"].clone())
        .collect()
}
/// Whether `commit` writes the current documentMetadata version, in the stored shape the doc has: a
/// `version` insert on the nested documentMetadata map when one exists, otherwise a
/// `documentMetadata` insert on the root `$` map whose plain value holds that version.
fn writes_metadata_version(
    commit: &serde_json::Value,
    root_state: &serde_json::Value,
    metadata: Option<&serde_json::Value>,
) -> bool {
    commit["ops"]
        .as_array()
        .expect("fixture: commit ops")
        .iter()
        .any(|op| {
            let content = &op["content"];
            match metadata {
                Some(container) => {
                    &op["container"] == container
                        && content["key"].as_str() == Some("version")
                        && content["value"] == serde_json::json!(11)
                }
                None => {
                    &op["container"] == root_state
                        && content["key"].as_str() == Some("documentMetadata")
                        && content["value"]["version"] == serde_json::json!(11)
                }
            }
        })
}
/// Every local commit's update bytes, in order, from the moment of `watch`.
struct Commits {
    from: loro::VersionVector,
    base: Vec<u8>,
    updates: Arc<std::sync::Mutex<Vec<Vec<u8>>>>,
    _subscription: loro::Subscription,
}
fn watch(doc: &loro::LoroDoc) -> Commits {
    let updates = Arc::new(std::sync::Mutex::new(Vec::new()));
    let sink = updates.clone();
    let subscription = doc.subscribe_local_update(Box::new(move |bytes| {
        sink.lock()
            .expect("fixture: commit log")
            .push(bytes.clone());
        true
    }));
    Commits {
        from: doc.oplog_vv(),
        base: doc
            .export(loro::ExportMode::Snapshot)
            .expect("fixture: base snapshot"),
        updates,
        _subscription: subscription,
    }
}
/// The ops of every change in `json`, after checking each change's author.
fn change_ops(json: &serde_json::Value, peer: u64) -> Vec<serde_json::Value> {
    let mut ops = Vec::new();
    for change in json["changes"]
        .as_array()
        .expect("fixture: decoded changes")
    {
        let id = change["id"].as_str().expect("fixture: change id");
        let (_, author) = id.split_once('@').expect("fixture: change id shape");
        let author: u64 = author.parse().expect("fixture: change peer");
        assert_eq!(author, peer, "fixture: change {id} by another peer");
        ops.extend(
            change["ops"]
                .as_array()
                .expect("fixture: change ops")
                .iter()
                .cloned(),
        );
    }
    ops
}
/// Each recorded commit decoded against a scratch doc at the previous version, with the
/// integrity checks: the scratch doc ends equal to the live doc, and the commits together carry
/// exactly the change-level ops after `from`.
fn decode(commits: &Commits, doc: &loro::LoroDoc, peer: u64) -> Vec<serde_json::Value> {
    let scratch = loro::LoroDoc::new();
    scratch
        .import(&commits.base)
        .expect("fixture: scratch base");
    let updates = commits.updates.lock().expect("fixture: commit log").clone();
    let mut decoded = Vec::new();
    let mut all = Vec::new();
    for (index, bytes) in updates.iter().enumerate() {
        let before = scratch.oplog_vv();
        scratch.import(bytes).expect("fixture: commit import");
        let json = serde_json::to_value(
            scratch
                .export_json_updates_without_peer_compression(&before, &scratch.oplog_vv())
                .expect("fixture: commit decode"),
        )
        .expect("fixture: commit JSON");
        let ops = change_ops(&json, peer);
        all.extend(ops.iter().cloned());
        decoded.push(serde_json::json!({
            "index": index,
            "bytes": bytes.len(),
            "before": format!("{before:?}"),
            "after": format!("{:?}", scratch.oplog_vv()),
            "ops": ops,
        }));
    }
    assert_eq!(
        scratch.get_deep_value().to_json_value(),
        doc.get_deep_value().to_json_value(),
        "fixture: the decoded commits rebuild the live doc"
    );
    assert_eq!(
        scratch.oplog_vv(),
        doc.oplog_vv(),
        "fixture: the decoded commits reach the live version"
    );
    let whole = serde_json::to_value(
        doc.export_json_updates_without_peer_compression(&commits.from, &doc.oplog_vv())
            .expect("fixture: change-level decode"),
    )
    .expect("fixture: change-level JSON");
    let mut by_commit: Vec<String> = all.iter().map(ToString::to_string).collect();
    let mut by_change: Vec<String> = change_ops(&whole, peer)
        .iter()
        .map(ToString::to_string)
        .collect();
    by_commit.sort();
    by_change.sort();
    assert_eq!(
        by_commit, by_change,
        "fixture: commits carry exactly the change-level ops"
    );
    decoded
}
/// One raw record per open, printed before any assertion reads it.
fn record(
    row: &str,
    peer: u64,
    commits: &Commits,
    doc: &loro::LoroDoc,
    surface: &EditorSurface,
) -> Vec<serde_json::Value> {
    let decoded = decode(commits, doc, peer);
    println!(
        "T1YK-ROOT-ID-RECORD {row} {}",
        serde_json::json!({
            "peer": peer,
            "from": format!("{:?}", commits.from),
            "to": format!("{:?}", doc.oplog_vv()),
            "modelRoot": model_root_state(surface),
            "storedRoot": stored_root_state(doc),
            "rootStateContainer": root_state_container(doc),
            "metadataContainer": metadata_container(doc),
            "commitCount": decoded.len(),
            "commits": decoded,
        })
    );
    decoded
}
/// Positive control: the matcher must find the known current metadata version write.
fn finds_metadata(commits: &[serde_json::Value], doc: &loro::LoroDoc) {
    let root_state = root_state_container(doc);
    let metadata = metadata_container(doc);
    assert!(
        commits.iter().any(|commit| writes_metadata_version(
            commit,
            &root_state,
            metadata.as_ref()
        )),
        "fixture: positive control, the metadata version write is not found"
    );
}
/// The reader's document, as production builds it: created with the session's own peer
/// (session.rs:297 `new_doc(peer)`, the surface constructed with the same peer at :298), with
/// the stored snapshot imported into it (session.rs:821-828 `seed`). The stored snapshot is
/// the Source-shaped map written by the mirror port as peer SEED_PEER.
fn seeded(root: &str, reader: u64) -> loro::LoroDoc {
    let source = lexical_loro::new_doc(SEED_PEER).expect("fixture: Loro document");
    lexical_loro::mirror::set_state(&source, &serde_json::from_str(root).expect("fixture: JSON"))
        .expect("fixture: seed write");
    let doc = lexical_loro::new_doc(reader).expect("fixture: Loro document");
    doc.import(
        &source
            .export(loro::ExportMode::Snapshot)
            .expect("fixture: snapshot"),
    )
    .expect("fixture: import");
    assert_eq!(doc.peer_id(), reader, "fixture: reader peer");
    doc
}
fn open(doc: &loro::LoroDoc, peer: u64, access: Access) -> EditorSurface {
    let mut surface = EditorSurface::new(config(), peer, now()).expect("fixture: session");
    let mut view = Vec::new();
    surface
        .init(doc, now(), access, &mut view)
        .expect("fixture: init");
    surface
}
const ABSENT_ROOT: &str = r#"{"type":"root","version":1,"format":"","indent":0,"direction":null,"children":[{"$":{"id":"para0001"},"type":"paragraph","version":1,"format":"","indent":0,"direction":null,"textFormat":0,"textStyle":"","children":[{"$":{"id":"text0001"},"type":"text","version":1,"text":"hello","format":0,"detail":0,"mode":"normal","style":""}]}]}"#;

#[test]
fn an_edit_open_stores_a_minted_root_id_in_its_first_change() {
    let doc = seeded(ABSENT_ROOT, 8);
    let commits = watch(&doc);
    let surface = open(&doc, 8, Access::Edit);
    let commits = record("absent", 8, &commits, &doc, &surface);
    finds_metadata(&commits, &doc);
    // (a) Source mints an 8-char root id at open.
    let model = id_of(&model_root_state(&surface));
    assert!(is_minted_id(&model), "ROOT-ID-RED model root id: {model}");
    // (b) Loro stores the same id.
    assert_eq!(id_of(&stored_root_state(&doc)), model, "stored root id");
    // (c) The FIRST local commit inserts it and writes no metadata version; a DISTINCT later
    // commit writes the current version.
    let root_state = root_state_container(&doc);
    let metadata = metadata_container(&doc);
    let first = commits.first().expect("a local commit");
    assert_eq!(
        key_ops(first, &root_state, "id"),
        vec![serde_json::json!({"type":"insert","key":"id","value":model})]
    );
    assert!(
        !writes_metadata_version(first, &root_state, metadata.as_ref()),
        "the first commit writes no metadata version"
    );
    assert!(
        commits.iter().skip(1).any(|commit| writes_metadata_version(
            commit,
            &root_state,
            metadata.as_ref()
        )),
        "a later, distinct commit writes the current metadata version"
    );
}

#[test]
fn an_edit_open_stores_root_and_child_ids_in_the_same_first_change() {
    let doc = seeded(
        r#"{"type":"root","version":1,"format":"","indent":0,"direction":null,"children":[{"type":"paragraph","version":1,"format":"","indent":0,"direction":null,"textFormat":0,"textStyle":"","children":[{"$":{"id":"text0001"},"type":"text","version":1,"text":"hello","format":0,"detail":0,"mode":"normal","style":""}]}]}"#,
        8,
    );
    let commits = watch(&doc);
    let surface = open(&doc, 8, Access::Edit);
    let commits = record("absent-child", 8, &commits, &doc, &surface);
    finds_metadata(&commits, &doc);
    // Positive control: the minted paragraph id is found.
    let child_state = first_child_state_container(&doc);
    assert!(
        commits
            .iter()
            .any(|commit| !key_ops(commit, &child_state, "id").is_empty()),
        "fixture: positive control, the child id write is not found"
    );
    let model = id_of(&model_root_state(&surface));
    assert!(is_minted_id(&model), "ROOT-ID-RED model root id: {model}");
    // (d) The paragraph's minted id and the root id are inserted in the same first commit.
    let paragraph = surface.state().to_json().expect("model").root["children"][0]["$"]["id"]
        .as_str()
        .expect("paragraph id")
        .to_owned();
    let first = commits.first().expect("a local commit");
    assert_eq!(
        key_ops(first, &root_state_container(&doc), "id"),
        vec![serde_json::json!({"type":"insert","key":"id","value":model})]
    );
    assert_eq!(
        key_ops(first, &child_state, "id"),
        vec![serde_json::json!({"type":"insert","key":"id","value":paragraph})],
        "the child id is in the first commit"
    );
}

#[test]
fn an_edit_open_keeps_a_stored_root_id() {
    let doc = seeded(
        &ABSENT_ROOT.replacen(
            r#""type":"root","#,
            r#""type":"root","$":{"id":"ROOTid01"},"#,
            1,
        ),
        8,
    );
    let before_container = root_state_container(&doc);
    let commits = watch(&doc);
    let surface = open(&doc, 8, Access::Edit);
    let commits = record("present", 8, &commits, &doc, &surface);
    // Positive twin of the no-write checks below: the matcher finds the metadata write.
    finds_metadata(&commits, &doc);
    assert_eq!(id_of(&model_root_state(&surface)), "ROOTid01");
    assert_eq!(id_of(&stored_root_state(&doc)), "ROOTid01");
    assert_eq!(
        root_state_container(&doc),
        before_container,
        "root $ is the same map"
    );
    for commit in &commits {
        assert!(
            key_ops(commit, &before_container, "id").is_empty(),
            "no commit touches root $.id"
        );
        assert!(
            key_ops(commit, &root_map_container(), "$").is_empty(),
            "no commit replaces root $"
        );
    }
}

#[test]
fn a_reopened_minted_root_id_is_kept() {
    let doc = seeded(ABSENT_ROOT, 8);
    let first_commits = watch(&doc);
    let first_open = open(&doc, 8, Access::Edit);
    let first_commits = record("reload-first-open", 8, &first_commits, &doc, &first_open);
    finds_metadata(&first_commits, &doc);
    let minted = id_of(&model_root_state(&first_open));
    assert!(is_minted_id(&minted), "ROOT-ID-RED model root id: {minted}");
    let reopened = lexical_loro::new_doc(9).expect("fixture: Loro document");
    reopened
        .import(
            &doc.export(loro::ExportMode::Snapshot)
                .expect("fixture: snapshot"),
        )
        .expect("fixture: import");
    assert_eq!(reopened.peer_id(), 9, "fixture: reopened peer");
    let before_container = root_state_container(&reopened);
    let reopen_from = reopened.oplog_vv();
    let commits = watch(&reopened);
    let second = open(&reopened, 9, Access::Edit);
    let commits = record("reload", 9, &commits, &reopened, &second);
    assert_eq!(id_of(&model_root_state(&second)), minted);
    assert_eq!(id_of(&stored_root_state(&reopened)), minted);
    assert_eq!(
        root_state_container(&reopened),
        before_container,
        "root $ is the same map"
    );
    if commits.is_empty() {
        // Every commit is decoded and authored by the reader, so none means no new op.
        assert_eq!(
            reopened.oplog_vv(),
            reopen_from,
            "no commit means no new op"
        );
    } else {
        let metadata = metadata_container(&reopened).expect("fixture: metadata map");
        let known = [root_map_container(), before_container.clone(), metadata];
        assert!(
            commits.iter().any(|commit| commit["ops"]
                .as_array()
                .expect("fixture: commit ops")
                .iter()
                .any(|op| known.contains(&op["container"]))),
            "fixture: positive control, no op on a known container"
        );
    }
    for commit in &commits {
        assert!(
            key_ops(commit, &before_container, "id").is_empty(),
            "no commit touches root $.id"
        );
        assert!(
            key_ops(commit, &root_map_container(), "$").is_empty(),
            "no commit replaces root $"
        );
    }
}

#[test]
fn a_read_only_open_ids_the_model_root_and_writes_nothing() {
    let doc = seeded(ABSENT_ROOT, 8);
    let before = doc.oplog_vv();
    let commits = watch(&doc);
    let surface = open(&doc, 8, Access::Read);
    let commits = record("read-only", 8, &commits, &doc, &surface);
    let model = id_of(&model_root_state(&surface));
    assert!(is_minted_id(&model), "ROOT-ID-RED model root id: {model}");
    assert_eq!(doc.oplog_vv(), before, "a read-only open writes nothing");
    assert!(commits.is_empty());
    assert_eq!(id_of(&stored_root_state(&doc)), "<absent>");
}

#[test]
fn an_empty_edit_open_stores_the_root_id_with_its_root_state_map() {
    // Source's empty-open write order is UNOBSERVED (C-ROOT-ID-EMPTY-OPEN-WRITE-ORDER-01);
    // only the observed rule is asserted: a stored root $ map never exists without its id.
    let doc = lexical_loro::new_doc(8).expect("fixture: Loro document");
    let commits = watch(&doc);
    let surface = open(&doc, 8, Access::Edit);
    let commits = record("empty-edit", 8, &commits, &doc, &surface);
    // Positive control: the matcher finds the root map's own fields being written.
    assert!(
        commits
            .iter()
            .any(|commit| !key_ops(commit, &root_map_container(), "type").is_empty()),
        "fixture: positive control, the root map write is not found"
    );
    let model = id_of(&model_root_state(&surface));
    assert!(is_minted_id(&model), "ROOT-ID-RED model root id: {model}");
    assert_eq!(id_of(&stored_root_state(&doc)), model);
    let root_state = root_state_container(&doc);
    let creating: Vec<&serde_json::Value> = commits
        .iter()
        .filter(|commit| !key_ops(commit, &root_map_container(), "$").is_empty())
        .collect();
    assert_eq!(creating.len(), 1, "exactly one commit creates root $");
    assert_eq!(
        key_ops(creating[0], &root_state, "id"),
        vec![serde_json::json!({"type":"insert","key":"id","value":model})],
        "the commit that creates root $ also inserts its id"
    );
}

#[test]
fn an_empty_read_only_open_ids_the_model_root_and_writes_nothing() {
    let doc = lexical_loro::new_doc(8).expect("fixture: Loro document");
    let before = doc.oplog_vv();
    let commits = watch(&doc);
    let surface = open(&doc, 8, Access::Read);
    let commits = record("empty-read-only", 8, &commits, &doc, &surface);
    let model = id_of(&model_root_state(&surface));
    assert!(is_minted_id(&model), "ROOT-ID-RED model root id: {model}");
    assert_eq!(
        doc.oplog_vv(),
        before,
        "an empty read-only open writes nothing"
    );
    assert!(commits.is_empty());
}

#[test]
fn a_cleanup_open_stores_the_minted_root_id_order_unobserved() {
    // Transparent-wrapper cleanup (a persisted draft comment mark) with an id-less root. Only
    // the final contents are asserted; Source's write order here is UNOBSERVED
    // (C-ROOT-ID-CLEANUP-WRITE-ORDER-01).
    let doc = seeded(
        r#"{"type":"root","version":1,"format":"","indent":0,"direction":null,"children":[{"type":"paragraph","version":1,"format":"","indent":0,"direction":null,"$":{"id":"para0001"},"children":[{"type":"comment-mark","version":1,"isDraft":true,"ids":["draft"],"format":"","indent":0,"direction":null,"$":{"id":"wrap0001"},"children":[{"type":"text","version":1,"text":"preserved","$":{"id":"text0001"}}]}]}]}"#,
        8,
    );
    let commits = watch(&doc);
    let surface = open(&doc, 8, Access::Edit);
    let _ = record("cleanup", 8, &commits, &doc, &surface);
    let model = id_of(&model_root_state(&surface));
    assert!(is_minted_id(&model), "ROOT-ID-RED model root id: {model}");
    assert_eq!(id_of(&stored_root_state(&doc)), model);
    assert!(
        !doc.get_deep_value()
            .to_json_value()
            .to_string()
            .contains("comment-mark"),
        "the draft mark is cleaned up"
    );
}
