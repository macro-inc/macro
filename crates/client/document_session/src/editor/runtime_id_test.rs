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

/// The real application factory, or its composition with deterministic entropy.
fn editor_from(
    config: &EditorConfig,
    peer: u64,
    random: Option<NodeRandom>,
) -> Result<Editor, Box<dyn std::error::Error>> {
    let builder = match random {
        None => (config.builder)(EditorMode::ViewAttached, peer),
        Some(random) => builder::with_session_plugins_excluding_root(
            macro_document_model::surface::preset_builder_with_mode(
                macro_document_model::EditorType::MarkdownSync,
                EditorMode::ViewAttached,
            )
            .extension_state(NodeClock(Arc::new(|| 1000)))
            .extension_state(random)
            .extension_state(NodeHost::default()),
            peer,
            &ID_STATE,
            8,
        ),
    };
    Ok(builder
        .initial_state(serde_json::from_str(FIXTURE)?)
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

#[test]
fn runtime_nodes_get_source_shaped_ids_existing_ids_stay_and_root_gets_none() -> TestResult {
    let mut editor = editor_from(&config(), 77, None)?;
    let (paragraph, text) = append_paragraph(&mut editor, None)?;
    let paragraph_id = assert_source_shaped(id(&editor, paragraph)?);
    let text_id = assert_source_shaped(id(&editor, text)?);
    assert_ne!(paragraph_id, text_id);
    let first = editor.state().view().children_keys(NodeKey::ROOT)?[0];
    assert_eq!(id(&editor, first)?.as_deref(), Some("existing"));
    assert_eq!(id(&editor, NodeKey::ROOT)?, None);
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
    let mut editor = editor_from(
        &config(),
        77,
        Some(sequence(vec![0, 0, 1, 2], calls.clone())),
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
    let mut editor = editor_from(&config(), 77, Some(sequence(vec![0], calls.clone())))?;
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
    let mut editor = editor_from(&config(), 77, Some(sequence(vec![0, 1, 2], calls.clone())))?;
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
    let mut editor = editor_from(&config(), 77, Some(sequence(vec![3, 4], calls.clone())))?;
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
