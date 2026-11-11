use super::*;
use lexical_rich_nodes::{code, link, list, mark, rich_text, table};

pub(super) const DEFAULT_NAMESPACE: &str = "document-session";
#[derive(Clone)]
pub(super) struct ClipboardNamespace(pub String);

/// Core and rich-node registry used until the application supplies its own factory.
pub fn default_editor_builder(mode: EditorMode, peer: u64) -> EditorBuilder {
    let builder = lexical_rich_nodes::register_rich_text_nodes(Editor::builder(mode));
    let builder = list::register_list_nodes(builder);
    let builder = code::register_code_nodes(builder)
        .node::<link::LinkNode>()
        .node::<link::AutoLinkNode>()
        .node::<mark::MarkNode>();
    with_session_plugins(
        table::register_table(builder, &table::TableConfig::default()),
        peer,
    )
}

/// Install editing commands without registering nodes or allocating node identities.
pub fn register_editor_commands(builder: EditorBuilder) -> EditorBuilder {
    crate::staging::register_staged_updates(builder).plugin(RichCommands)
}

/// Install session commands and standalone durable identity tracking.
pub fn with_session_plugins(builder: EditorBuilder, peer: u64) -> EditorBuilder {
    with_session_plugins_with_id_state(builder, peer, &ID)
}

/// Install session tracking with the same identity state key as the node importers.
pub fn with_session_plugins_with_id_state(
    builder: EditorBuilder,
    peer: u64,
    id_state: &'static StateKey<Option<String>>,
) -> EditorBuilder {
    install_session_plugins(builder, peer, id_state, true, IdMint::Session)
}

/// Application tracking: Root carries no tracked id, and nodes created without
/// one receive Source nodeIdPlugin `nanoid(id_length)` from NodeRandom.
#[cfg(feature = "application")]
pub(crate) fn with_session_plugins_excluding_root(
    builder: EditorBuilder,
    peer: u64,
    id_state: &'static StateKey<Option<String>>,
    id_length: usize,
) -> EditorBuilder {
    install_session_plugins(
        builder,
        peer,
        id_state,
        false,
        IdMint::Nanoid { length: id_length },
    )
}

fn install_session_plugins(
    builder: EditorBuilder,
    peer: u64,
    id_state: &'static StateKey<Option<String>>,
    track_root: bool,
    mint: IdMint,
) -> EditorBuilder {
    register_editor_commands(builder.extension_state(NodeIdIndex::default())).plugin(NodeIds {
        peer,
        id_state,
        track_root,
        mint,
    })
}

/// How a node without a usable id receives one.
#[derive(Clone, Copy)]
enum IdMint {
    /// Standalone sessions: `session-{peer}-{key}`, suffixed on collision.
    Session,
    /// Application sessions: Source `nanoid(length)` from the NodeRandom stream.
    #[cfg(feature = "application")]
    Nanoid { length: usize },
}

/// Fresh draws before a nanoid mint fails instead of reusing a taken id.
#[cfg(feature = "application")]
const NANOID_ATTEMPTS: usize = 16;

/// Draw fresh Source nanoids until one is neither indexed nor reserved by an
/// incoming node of the same commit; fail after a bounded number of draws.
#[cfg(feature = "application")]
fn mint_nanoid(tx: &Transaction<'_>, length: usize, reserved: &[String]) -> Result<String, Error> {
    for _ in 0..NANOID_ATTEMPTS {
        let candidate = macro_document_model::nanoid(tx, length)
            .map_err(|error| Error::invariant(error.to_string()))?;
        if !tx.extension::<NodeIdIndex>()?.ids.contains_key(&candidate)
            && !reserved.contains(&candidate)
        {
            return Ok(candidate);
        }
    }
    Err(Error::Invariant("node id generation exhausted"))
}

pub(super) static ID: StateKey<Option<String>> = StateKey::new("id", |value| {
    // Keep the standalone String key's empty/missing serialization contract.
    Some(
        value
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_owned(),
    )
});
#[derive(Clone, Default)]
struct NodeIdIndex {
    ids: imbl::GenericOrdMap<String, NodeKey, imbl::shared_ptr::ArcK>,
    keys: imbl::GenericOrdMap<NodeKey, String, imbl::shared_ptr::ArcK>,
}
struct NodeIds {
    peer: u64,
    id_state: &'static StateKey<Option<String>>,
    track_root: bool,
    mint: IdMint,
}
impl Plugin for NodeIds {
    fn name(&self) -> &'static str {
        "session-node-id"
    }
    fn commands(&self) -> &[CommandRegistration] {
        const COMMANDS: &[CommandRegistration] = &[CommandRegistration {
            command: CommandKind::InsertClipboardNodes,
            priority: CommandPriority::Critical,
            placement: Placement::Before,
        }];
        COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        if let Command::InsertClipboardNodes { nodes, .. } = command {
            // Clipboard copies lose durable identities even across documents.
            // Yield so selection/table handlers still own actual insertion.
            for node in nodes {
                for record in lexical_rich_nodes::utils::dfs(tx.view(), Some(*node), None) {
                    if !self.track_root && record.node == NodeKey::ROOT {
                        continue;
                    }
                    tx.set_state(record.node, self.id_state, None)?;
                }
            }
        }
        Ok(Handled::No)
    }
    fn after_commit(&self, tx: &mut Transaction<'_>, commit: &Commit) -> Result<(), Error> {
        // Application minting must not take an id an incoming attached node of
        // this commit already stores but the index has not seen yet. Reserving
        // reads ids only; it neither writes state nor changes the index.
        #[cfg(feature = "application")]
        let reserved = match self.mint {
            IdMint::Nanoid { .. } => self.incoming_ids(tx, commit)?,
            IdMint::Session => Vec::new(),
        };
        for (key, mutation) in &commit.changes.mutations {
            if !self.track_root && *key == NodeKey::ROOT {
                continue;
            }
            let old = tx.extension::<NodeIdIndex>()?.keys.get(key).cloned();
            let mut id = if *mutation == Mutation::Destroyed || !tx.is_attached(*key) {
                None
            } else {
                Some(tx.get_state(*key, self.id_state)?.unwrap_or_default())
            };
            // Subtree removal can leave stale descendant index entries. Only
            // an attached owner can conflict with a restored durable identity.
            if let Some(value) = &mut id
                && (value.is_empty()
                    || tx
                        .extension::<NodeIdIndex>()?
                        .ids
                        .get(value)
                        .is_some_and(|owner| owner != key && tx.is_attached(*owner)))
            {
                *value = match self.mint {
                    IdMint::Session => {
                        let base = format!("session-{}-{key}", self.peer);
                        let mut candidate = base.clone();
                        let mut suffix = 0_u64;
                        while tx.extension::<NodeIdIndex>()?.ids.contains_key(&candidate) {
                            suffix += 1;
                            candidate = format!("{base}-{suffix}");
                        }
                        candidate
                    }
                    #[cfg(feature = "application")]
                    IdMint::Nanoid { length } => mint_nanoid(tx, length, &reserved)?,
                };
                tx.set_state(*key, self.id_state, Some(value.clone()))?;
            }
            if old != id {
                let index = tx.extension_mut::<NodeIdIndex>()?;
                if let Some(old) = old {
                    index.ids.remove(&old);
                    index.keys.remove(key);
                }
                if let Some(id) = id {
                    index.ids.insert(id.clone(), *key);
                    index.keys.insert(*key, id);
                }
            }
        }
        Ok(())
    }
}
#[cfg(feature = "application")]
impl NodeIds {
    /// Nonempty stored ids of this commit's attached, non-destroyed mutations.
    fn incoming_ids(&self, tx: &Transaction<'_>, commit: &Commit) -> Result<Vec<String>, Error> {
        let mut ids = Vec::new();
        for (key, mutation) in &commit.changes.mutations {
            if *mutation == Mutation::Destroyed
                || (!self.track_root && *key == NodeKey::ROOT)
                || !tx.is_attached(*key)
            {
                continue;
            }
            if let Some(id) = tx.get_state(*key, self.id_state)?
                && !id.is_empty()
            {
                ids.push(id);
            }
        }
        Ok(ids)
    }
}
struct RichCommands;
impl Plugin for RichCommands {
    fn name(&self) -> &'static str {
        "session-rich-text"
    }
    fn commands(&self) -> &[CommandRegistration] {
        const KINDS: &[CommandKind] = &[
            CommandKind::Click,
            CommandKind::Key(KeyCommand::ArrowLeft),
            CommandKind::Key(KeyCommand::ArrowRight),
            CommandKind::InsertText,
            CommandKind::DeleteCharacter,
            CommandKind::DeleteWord,
            CommandKind::DeleteLine,
            CommandKind::RemoveText,
            CommandKind::InsertParagraph,
            CommandKind::InsertLineBreak,
            CommandKind::InsertTab,
            CommandKind::IndentContent,
            CommandKind::OutdentContent,
            CommandKind::FormatText,
            CommandKind::FormatElement,
            CommandKind::SelectAll,
            CommandKind::ClearEditor,
            CommandKind::Paste,
            CommandKind::InsertClipboardNodes,
        ];
        static REGISTRATIONS: std::sync::LazyLock<Vec<CommandRegistration>> =
            std::sync::LazyLock::new(|| {
                KINDS
                    .iter()
                    .map(|command| CommandRegistration {
                        command: *command,
                        priority: CommandPriority::Editor,
                        placement: Placement::After,
                    })
                    .collect()
            });
        &REGISTRATIONS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        if let Command::Paste(payload) = command {
            let namespace = tx
                .try_extension::<ClipboardNamespace>()
                .map_or(DEFAULT_NAMESPACE, |configured| configured.0.as_str())
                .to_owned();
            let entries = payload
                .data
                .iter()
                .map(|(mime, data)| lexical_rich_nodes::clipboard::ClipboardEntry { mime, data })
                .collect::<Vec<_>>();
            let handled = lexical_rich_nodes::clipboard::insert_data_transfer_for_rich_text(
                tx,
                &namespace,
                &entries,
                payload.html_nodes.as_deref(),
                SelectionSlot::Active,
            )?;
            return Ok(if handled { Handled::Yes } else { Handled::No });
        }
        if let Command::InsertClipboardNodes { nodes, selection } = command {
            tx.insert_nodes_at(*selection, nodes)?;
            return Ok(Handled::Yes);
        }
        if let Command::Key {
            command: command @ (KeyCommand::ArrowLeft | KeyCommand::ArrowRight),
            event,
        } = command
        {
            return arrow_horizontal(
                tx,
                *command == KeyCommand::ArrowLeft,
                event.as_ref().is_some_and(|event| event.shift),
            );
        }
        let handled = match command {
            Command::Click => {
                rich_text::click(tx, &rich_text::EscapeFormatTriggerConfig::default())
            }
            Command::InsertText(text) => rich_text::controlled_text_insertion(tx, text),
            Command::DeleteCharacter { direction, target } => {
                rich_text::delete_character(tx, *direction, target.clone())
            }
            Command::DeleteWord {
                direction,
                target,
                character_target,
            } => rich_text::delete_word(tx, *direction, target.clone(), character_target.clone()),
            Command::DeleteLine {
                direction,
                target,
                character_target,
            } => rich_text::delete_line(tx, *direction, target.clone(), character_target.clone()),
            Command::RemoveText => rich_text::remove_text(tx),
            Command::InsertParagraph => rich_text::insert_paragraph(tx),
            Command::InsertLineBreak { select_start } => {
                rich_text::insert_line_break(tx, *select_start)
            }
            Command::InsertTab => rich_text::insert_tab(tx),
            Command::IndentContent => rich_text::indent_content(tx),
            Command::OutdentContent => rich_text::outdent_content(tx),
            Command::FormatText(format) => rich_text::format_text(tx, *format),
            Command::FormatElement(format) => rich_text::format_element(tx, *format),
            Command::SelectAll(_) => rich_text::select_all(tx),
            Command::ClearEditor => rich_text::clear_editor(tx),
            _ => return Ok(Handled::No),
        }
        .map_err(|lexical_rich_nodes::Error::Model(error)| error)?;
        Ok(if handled { Handled::Yes } else { Handled::No })
    }
}

/// Upstream registerRichText KEY_ARROW_LEFT/RIGHT: model-owned NodeSelection and
/// decorator movement; ordinary character movement stays with the browser.
fn arrow_horizontal(tx: &mut Transaction<'_>, left: bool, shift: bool) -> Result<Handled, Error> {
    let rtl = is_parent_element_rtl(tx);
    let cfg = rich_text::EscapeFormatTriggerConfig::default();
    let outcome = if left {
        rich_text::arrow_left(tx, shift, rtl, &cfg)
    } else {
        rich_text::arrow_right(tx, shift, rtl, &cfg)
    }
    .map_err(|lexical_rich_nodes::Error::Model(error)| error)?;
    match outcome {
        rich_text::ArrowOutcome::NotHandled => Ok(Handled::No),
        rich_text::ArrowOutcome::Handled => {
            tx.prevent_default();
            Ok(Handled::Yes)
        }
        rich_text::ArrowOutcome::MoveCharacter { backward } => {
            // $moveCharacter: modify() handles decorator and block boundaries in
            // the model; plain text movement is the browser's own caret step.
            let direction = if backward != rtl {
                EditDirection::Backward
            } else {
                EditDirection::Forward
            };
            let alter = if shift { Alter::Extend } else { Alter::Move };
            match tx.modify_selection(
                alter,
                direction,
                Granularity::Character,
                ModifyTarget::RequireView,
            ) {
                Ok(()) => {
                    tx.prevent_default();
                    Ok(Handled::Yes)
                }
                Err(Error::LayoutRequired) => Ok(Handled::No),
                Err(error) => Err(error),
            }
        }
    }
}

/// Upstream $isParentElementRTL: the anchor's parent (or root) direction field.
fn is_parent_element_rtl(tx: &Transaction<'_>) -> bool {
    let Some(Selection::Range(range)) = tx.selection() else {
        return false;
    };
    let anchor = range.anchor.key();
    let parent = if anchor == NodeKey::ROOT {
        Some(anchor)
    } else {
        tx.view().parent(anchor)
    };
    parent
        .and_then(|key| tx.view().element(key))
        .is_some_and(|element| element.direction == Some(TextDirection::Rtl))
}

// Remote cursor repair is a model operation; headless editors reject view inputs.
pub(super) static RESTORE_MODEL_SELECTION: CommandKey<Option<RangeSelection>> =
    CommandKey::new("session-restore-model-selection");
pub(super) struct RestoreModelSelection;
impl Plugin for RestoreModelSelection {
    fn name(&self) -> &'static str {
        "session-restore-model-selection"
    }
    fn commands(&self) -> &[CommandRegistration] {
        static COMMANDS: [CommandRegistration; 1] = [CommandRegistration {
            command: CommandKind::Extension(&RESTORE_MODEL_SELECTION),
            priority: CommandPriority::Critical,
            placement: Placement::Before,
        }];
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        let Some(range) = command.payload(&RESTORE_MODEL_SELECTION) else {
            return Ok(Handled::No);
        };
        tx.selection_from_view(range.as_ref().map_or(ViewSelection::None, |range| {
            ViewSelection::Range {
                anchor: range.anchor,
                focus: range.focus,
                resolution_dirty: false,
            }
        }))?;
        Ok(Handled::Yes)
    }
}

#[derive(Clone, Debug)]
pub(super) struct HistoryAwarenessRestore {
    pub(super) range: RangeSelection,
    pub(super) focused: bool,
}

pub(super) static RESTORE_HISTORY_AWARENESS: CommandKey<HistoryAwarenessRestore> =
    CommandKey::new("session-restore-history-awareness");

pub(super) struct RestoreHistoryAwareness;
impl Plugin for RestoreHistoryAwareness {
    fn name(&self) -> &'static str {
        "session-restore-history-awareness"
    }
    fn commands(&self) -> &[CommandRegistration] {
        static COMMANDS: [CommandRegistration; 1] = [CommandRegistration {
            command: CommandKind::Extension(&RESTORE_HISTORY_AWARENESS),
            priority: CommandPriority::Critical,
            placement: Placement::Before,
        }];
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        let Some(restore) = command.payload(&RESTORE_HISTORY_AWARENESS) else {
            return Ok(Handled::No);
        };
        tx.add_tag(UpdateTag::Custom("collab-selection".into()));
        tx.add_tag(UpdateTag::SkipScrollIntoView);
        if !restore.focused {
            tx.add_tag(UpdateTag::SkipDomSelection);
        }
        tx.set_selection(Some(Selection::Range(restore.range.clone())))?;
        Ok(Handled::Yes)
    }
}

#[cfg(all(test, feature = "application"))]
mod test;
