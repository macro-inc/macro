use super::*;
use macro_document_model::node_ids::ID_STATE;
use macro_document_model::{NodeClock, NodeHost, NodeRandom};
use std::sync::atomic::{AtomicI64, AtomicUsize, Ordering};

type TestResult = Result<(), Box<dyn std::error::Error>>;

fn config() -> EditorConfig {
    crate::application_editor_config(
        EditorConfig::default(),
        Arc::new(AtomicI64::new(1000)),
        macro_document_model::EditorType::MarkdownSync,
    )
}

const FIXTURE: &str = r#"{"root":{"type":"root","children":[
    {"type":"paragraph","$":{"id":"existing"},"children":[
        {"type":"text","text":"kept","$":{"id":"keptText"}}
    ]}
]}}"#;

/// FIXTURE with a stored root id: the open keeps it and draws nothing for the root, so a row's
/// deterministic draw sequence goes to its own nodes only (purpose-preserving fixture for the
/// rows below that count draws; the root's own open id is covered by root_id_test).
const FIXTURE_STORED_ROOT: &str = r#"{"root":{"type":"root","$":{"id":"rootId01"},"children":[
    {"type":"paragraph","$":{"id":"existing"},"children":[
        {"type":"text","text":"kept","$":{"id":"keptText"}}
    ]}
]}}"#;

/// The real application factory, or its composition with deterministic entropy.
fn editor_from(
    config: &EditorConfig,
    peer: u64,
    entropy: Option<NodeRandom>,
) -> Result<Editor, Box<dyn std::error::Error>> {
    editor_with(config, peer, entropy, FIXTURE)
}

/// editor_from over a chosen stored fixture.
fn editor_with(
    config: &EditorConfig,
    peer: u64,
    entropy: Option<NodeRandom>,
    fixture: &str,
) -> Result<Editor, Box<dyn std::error::Error>> {
    let builder = match entropy {
        None => (config.builder)(EditorMode::ViewAttached, peer),
        Some(entropy) => builder::with_session_plugins_excluding_root(
            macro_document_model::surface::preset_builder_with_mode(
                macro_document_model::EditorType::MarkdownSync,
                EditorMode::ViewAttached,
            )
            .extension_state(NodeClock(Arc::new(|| 1000)))
            .extension_state(entropy)
            .extension_state(NodeHost::default()),
            peer,
            &ID_STATE,
            8,
        ),
    };
    Ok(builder
        .initial_state(serde_json::from_str(fixture)?)
        .build()?)
}

fn id(editor: &Editor, key: NodeKey) -> Result<Option<String>, Box<dyn std::error::Error>> {
    Ok(editor.state().view().get_state(key, &ID_STATE)?)
}

/// Source nodeIdPlugin: nanoid(8) over the URL-safe alphabet.
fn assert_source_shaped(value: Option<String>) -> String {
    let value = value.expect("id");
    assert_eq!(value.len(), 8, "{value}");
    assert!(
        value
            .bytes()
            .all(|byte| macro_document_model::node_ids::NANOID_ALPHABET.contains(&byte)),
        "{value}"
    );
    value
}

fn append_paragraph(
    editor: &mut Editor,
    stored: Option<&str>,
) -> Result<(NodeKey, NodeKey), Box<dyn std::error::Error>> {
    let (keys, _) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let text = tx.create_text("new")?;
        tx.append(paragraph, &[text.key()])?;
        if let Some(stored) = stored {
            tx.set_state(paragraph, &ID_STATE, Some(stored.to_owned()))?;
        }
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok((paragraph.key(), text.key()))
    })?;
    Ok(keys)
}

/// Bytes whose draw number `n` yields `indexes[n]`-repeated characters, counting draws.
fn sequence(indexes: Vec<u8>, calls: Arc<AtomicUsize>) -> NodeRandom {
    NodeRandom(Arc::new(move |length| {
        let call = calls.fetch_add(1, Ordering::SeqCst);
        vec![indexes[call.min(indexes.len() - 1)]; length]
    }))
}

fn repeated(index: usize) -> String {
    char::from(macro_document_model::node_ids::NANOID_ALPHABET[index])
        .to_string()
        .repeat(8)
}

/// Formerly `runtime_nodes_get_source_shaped_ids_existing_ids_stay_and_root_gets_none`. The
/// application root now gets the id its open mints (ID_STORED_AT_OPEN, root-id open control
/// outcome 6e501bb9); the surviving purpose is unchanged: runtime nodes get Source-shaped ids
/// and existing ids stay.
#[test]
fn runtime_and_root_ids_are_source_shaped_and_existing_ids_stay() -> TestResult {
    let mut editor = editor_from(&config(), 77, None)?;
    let (paragraph, text) = append_paragraph(&mut editor, None)?;
    let paragraph_id = assert_source_shaped(id(&editor, paragraph)?);
    let text_id = assert_source_shaped(id(&editor, text)?);
    assert_ne!(paragraph_id, text_id);
    let first = editor.state().view().children_keys(NodeKey::ROOT)?[0];
    assert_eq!(id(&editor, first)?.as_deref(), Some("existing"));
    let root_id = assert_source_shaped(id(&editor, NodeKey::ROOT)?);
    assert_ne!(root_id, paragraph_id);
    assert_ne!(root_id, text_id);
    Ok(())
}

#[test]
fn a_duplicate_of_an_existing_attached_id_is_regenerated() -> TestResult {
    let mut editor = editor_from(&config(), 77, None)?;
    let (paragraph, _) = append_paragraph(&mut editor, Some("existing"))?;
    let regenerated = assert_source_shaped(id(&editor, paragraph)?);
    assert_ne!(regenerated, "existing");
    let first = editor.state().view().children_keys(NodeKey::ROOT)?[0];
    assert_eq!(id(&editor, first)?.as_deref(), Some("existing"));
    Ok(())
}

/// Collaborators draw from separate per-peer streams; a rebuild through the
/// same application config continues its peer's stream. A brand-new config
/// restarts the stream and is not covered here.
#[test]
fn peers_differ_and_a_same_config_rebuild_continues_the_stream() -> TestResult {
    let shared = config();
    let mut first = editor_from(&shared, 91, None)?;
    let mut second = editor_from(&shared, 92, None)?;
    let (left, _) = append_paragraph(&mut first, None)?;
    let (right, _) = append_paragraph(&mut second, None)?;
    assert_ne!(id(&first, left)?, id(&second, right)?);
    let mut rebuilt = editor_from(&shared, 91, None)?;
    let (again, _) = append_paragraph(&mut rebuilt, None)?;
    assert_ne!(id(&first, left)?, id(&rebuilt, again)?);
    Ok(())
}

#[test]
fn a_colliding_draw_is_retried_with_a_fresh_one() -> TestResult {
    let calls = Arc::new(AtomicUsize::new(0));
    let mut editor = editor_with(
        &config(),
        77,
        Some(sequence(vec![0, 0, 1, 2], calls.clone())),
        FIXTURE_STORED_ROOT,
    )?;
    let (paragraph, text) = append_paragraph(&mut editor, None)?;
    let (paragraph_id, text_id) = (id(&editor, paragraph)?, id(&editor, text)?);
    assert_ne!(paragraph_id, text_id);
    assert_eq!(
        [paragraph_id, text_id]
            .map(|id| id.is_some_and(|id| id == repeated(0) || id == repeated(1))),
        [true, true]
    );
    assert_eq!(calls.load(Ordering::SeqCst), 3);
    Ok(())
}

/// Source nodeIdPlugin's transform order (nodeIdPlugin.ts:120-131): Lexical 0.45
/// $applyAllTransforms runs dirty leaves before dirty elements, so the TEXT node takes the only
/// draw; the paragraph's transform cannot mint a free id, so it stays without one and the update
/// still commits. The follow-up then reports the bounded mint error once and
/// rolls back its own round. Draws: 1 accepted (first transform) + 16 refused (second
/// transform) + 16 refused (the follow-up's mint for that same node) = 33.
#[test]
fn exhausted_draws_leave_new_nodes_without_ids_instead_of_a_duplicate() -> TestResult {
    let calls = Arc::new(AtomicUsize::new(0));
    let mut editor = editor_with(
        &config(),
        77,
        Some(sequence(vec![0], calls.clone())),
        FIXTURE_STORED_ROOT,
    )?;
    let ((paragraph, text), commit) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let text = tx.create_text("new")?;
        tx.append(paragraph, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok((paragraph.key(), text.key()))
    })?;
    let failure = commit.follow_up_error.expect("follow-up error");
    assert_eq!(failure.plugin, "session-node-id");
    assert!(
        matches!(
            &*failure.error,
            Error::Invariant("node id generation exhausted")
        ),
        "{:?}",
        failure.error
    );
    assert_eq!(calls.load(Ordering::SeqCst), 33);
    assert_eq!(
        [id(&editor, paragraph)?, id(&editor, text)?],
        [None, Some(repeated(0))]
    );
    assert_eq!(editor.state().view().children_keys(NodeKey::ROOT)?.len(), 2);
    Ok(())
}

/// Source nodeIdPlugin's transform order (nodeIdPlugin.ts:120-131): the minted node is
/// transformed first and takes the first draw; the incoming node then finds its stored id owned
/// by another key in this update's map and regenerates ($regenId) with the next draw.
#[test]
fn incoming_stored_ids_are_reserved_before_minting_in_the_same_commit() -> TestResult {
    let calls = Arc::new(AtomicUsize::new(0));
    let mut editor = editor_with(
        &config(),
        77,
        Some(sequence(vec![0, 1, 2], calls.clone())),
        FIXTURE_STORED_ROOT,
    )?;
    let zeros = repeated(0);
    let ((minted, imported), _) = editor.update(|tx| {
        let minted = tx.create(Paragraph::default())?;
        let imported = tx.create(Paragraph::default())?;
        tx.set_state(imported, &ID_STATE, Some(zeros.clone()))?;
        tx.append(NodeKey::ROOT, &[minted.key(), imported.key()])?;
        Ok((minted.key(), imported.key()))
    })?;
    assert_eq!(id(&editor, minted)?, Some(zeros));
    assert_eq!(id(&editor, imported)?, Some(repeated(1)));
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    Ok(())
}

/// Two incoming nodes storing the same id keep the existing policy: the one the
/// index sees first keeps it and the other is regenerated.
#[test]
fn duplicate_incoming_ids_keep_the_existing_first_seen_policy() -> TestResult {
    let calls = Arc::new(AtomicUsize::new(0));
    let mut editor = editor_with(
        &config(),
        77,
        Some(sequence(vec![3, 4], calls.clone())),
        FIXTURE_STORED_ROOT,
    )?;
    let ((first, second), _) = editor.update(|tx| {
        let first = tx.create(Paragraph::default())?;
        let second = tx.create(Paragraph::default())?;
        tx.set_state(first, &ID_STATE, Some("sharedId".to_owned()))?;
        tx.set_state(second, &ID_STATE, Some("sharedId".to_owned()))?;
        tx.append(NodeKey::ROOT, &[first.key(), second.key()])?;
        Ok((first.key(), second.key()))
    })?;
    let ids = [id(&editor, first)?, id(&editor, second)?];
    assert_eq!(
        ids.iter()
            .filter(|id| id.as_deref() == Some("sharedId"))
            .count(),
        1
    );
    assert!(ids.contains(&Some(repeated(3))), "{ids:?}");
    Ok(())
}

/// The in-update id transform runs on exactly Source SupportedNodeTypes (lexical-core
/// node-list.ts:75-133, 57 classes): the core types plus every native supported registration.
#[test]
fn transform_scope_is_the_source_supported_node_types() {
    use super::builder::SOURCE_ID_TYPES;
    let scope: std::collections::BTreeSet<&str> = SOURCE_ID_TYPES.iter().copied().collect();
    let source: std::collections::BTreeSet<&str> = ["paragraph", "text", "linebreak", "tab"]
        .into_iter()
        .chain(macro_document_model::supported_node_types())
        .collect();
    assert_eq!(scope, source);
    assert_eq!(SOURCE_ID_TYPES.len(), 57);
}

/// The paragraph the fixture stores as "existing".
fn existing(editor: &Editor) -> Result<NodeKey, Box<dyn std::error::Error>> {
    Ok(editor.state().view().children_keys(NodeKey::ROOT)?[0])
}

/// Source keeps a node's OLD id in idToNodeKeyMap when its id changes in place (only destroyed
/// nodes are deleted, nodeIdPlugin.ts:142-148), so another node carrying that old id in the same
/// update still regenerates.
#[test]
fn an_id_changed_in_place_stays_reserved_for_the_rest_of_the_update() -> TestResult {
    let mut editor = editor_from(&config(), 77, None)?;
    let paragraph = existing(&editor)?;
    let (incoming, _) = editor.update(|tx| {
        tx.set_state(paragraph, &ID_STATE, Some("renamed0".into()))?;
        let incoming = tx.create(Paragraph::default())?;
        tx.set_state(incoming, &ID_STATE, Some("existing".into()))?;
        tx.append(NodeKey::ROOT, &[incoming.key()])?;
        Ok(incoming.key())
    })?;
    assert_eq!(id(&editor, paragraph)?.as_deref(), Some("renamed0"));
    let fresh = assert_source_shaped(id(&editor, incoming)?);
    assert_ne!(fresh, "existing");
    Ok(())
}

/// A node this update destroys keeps its id reserved until commit (Source's destroyed listener
/// runs after the commit), so a new node carrying it regenerates.
#[test]
fn a_destroyed_nodes_id_stays_reserved_until_commit() -> TestResult {
    let mut editor = editor_from(&config(), 77, None)?;
    let paragraph = existing(&editor)?;
    let (incoming, _) = editor.update(|tx| {
        tx.remove_from_parent(paragraph)?;
        let incoming = tx.create(Paragraph::default())?;
        tx.set_state(incoming, &ID_STATE, Some("existing".into()))?;
        tx.append(NodeKey::ROOT, &[incoming.key()])?;
        Ok(incoming.key())
    })?;
    let fresh = assert_source_shaped(id(&editor, incoming)?);
    assert_ne!(fresh, "existing");
    Ok(())
}

/// Source's map.set by a later writer (Doc.assignRef's $updateAllNodeIds) overrides the earlier
/// owner: with a claim for the copy, the dirty original regenerates and the copy keeps the id.
#[test]
fn a_claim_overrides_the_index_so_the_claimant_keeps_the_id() -> TestResult {
    let mut editor = editor_from(&config(), 77, None)?;
    let paragraph = existing(&editor)?;
    let (copy, _) = editor.update(|tx| {
        let copy = tx.create(Paragraph::default())?;
        tx.set_state(copy, &ID_STATE, Some("existing".into()))?;
        tx.append(NodeKey::ROOT, &[copy.key()])?;
        macro_document_model::node_ids::claim_id(tx, "existing", copy.key())?;
        tx.mark_dirty(paragraph)?;
        Ok(copy.key())
    })?;
    assert_eq!(id(&editor, copy)?.as_deref(), Some("existing"));
    let fresh = assert_source_shaped(id(&editor, paragraph)?);
    assert_ne!(fresh, "existing");
    Ok(())
}
