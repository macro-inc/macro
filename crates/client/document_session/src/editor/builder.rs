use super::*;
use lexical_rich_nodes::{code, link, list, mark, rich_text, table};

pub(super) const DEFAULT_NAMESPACE: &str = "document-session";
#[derive(Clone)]
pub(super) struct ClipboardNamespace(pub String);

#[cfg(feature = "application")]
pub(super) static RECONCILE_ROOT_ID: CommandKey<()> = CommandKey::new("session-reconcile-root-id");

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

/// Application per-node tracking excludes Root; the open and post-Loro passes
/// handle it explicitly. Missing IDs use Source `nanoid(id_length)` from NodeRandom.
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
    let builder = match mint {
        // Source nodeIdPlugin's node transform: nodes get their ids inside the update that
        // dirtied them; the after_commit half below keeps the index and reports failures.
        #[cfg(feature = "application")]
        IdMint::Nanoid { length } => builder
            .extension_state(TransformIds { id_state, length })
            .transform_each(transform_id, TransformScope::Types(SOURCE_ID_TYPES)),
        IdMint::Session => builder,
    };
    register_editor_commands(builder.extension_state(NodeIdIndex::default())).plugin(NodeIds {
        peer,
        id_state,
        track_root,
        mint,
    })
}

/// Source SupportedNodeTypes (lexical-core node-list.ts:75-133, 57 classes), the classes the app passes to
/// nodeIdPlugin (LexicalWrapperContext.tsx:126-134); the transform runs on these types only.
#[cfg(feature = "application")]
pub(crate) const SOURCE_ID_TYPES: &[&str] = &[
    "paragraph",
    "text",
    "code",
    "custom-code",
    "database-query",
    "heading",
    "link",
    "autolink",
    "list",
    "task-list",
    "listitem",
    "quote",
    "linebreak",
    "document-mention",
    "document-card",
    "paste",
    "user-mention",
    "contact-mention",
    "date-mention",
    "pr-mention",
    "booking-link-mention",
    "agent-session-mention",
    "reply-target",
    "group-mention",
    "inline-search",
    "unlinked-text",
    "code-highlight",
    "tab",
    "image",
    "video",
    "table",
    "tablecell",
    "tablerow",
    "completion",
    "mark",
    "comment-mark",
    "search-match",
    "equation",
    "snapshot",
    "horizontalrule",
    "diff",
    "diff-insert",
    "diff-delete",
    "diff-text",
    "html-render",
    "classed-block",
    "watermark",
    "theme-mention",
    "tag-mention",
    "connect-app",
    "account-manager-request",
    "unknown-mention",
    "await",
    "magic-chip",
    "agent-activity",
    "agent-context",
    "system-notification",
];

/// The application id mint the in-update transform uses.
#[cfg(feature = "application")]
#[derive(Clone, Copy)]
struct TransformIds {
    id_state: &'static StateKey<Option<String>>,
    length: usize,
}

/// Source nodeIdPlugin's transform (nodeIdPlugin.ts:120-131): `$assertId`, then `$regenId` when
/// the id already belongs to another node; the node transformed first keeps it. An exhausted
/// mint leaves the node as it is and lets the update commit; after_commit reports it.
#[cfg(feature = "application")]
fn transform_id(tx: &mut Transaction<'_>, key: NodeKey) -> Result<(), Error> {
    let TransformIds { id_state, length } = *tx.extension::<TransformIds>()?;
    // Source's map at update start: the index minus stale entries an earlier subtree removal
    // left (Source's destroyed listener drops those); a node this update destroys still counts.
    // The same predicate decides keeping a stored id and accepting a fresh draw.
    // Source's map: this update's claims first, then the start-of-update index (shared rule,
    // macro_document_model node_ids). It decides keeping a stored id and accepting a draw.
    let owned_elsewhere = |tx: &Transaction<'_>, id: &str| -> Result<bool, Error> {
        let indexed = tx.extension::<NodeIdIndex>()?.ids.get(id).copied();
        Ok(macro_document_model::node_ids::id_owned_by_other(
            tx, indexed, id, key,
        ))
    };
    let stored = tx.get_state(key, id_state)?.unwrap_or_default();
    let id = if !stored.is_empty() && !owned_elsewhere(tx, &stored)? {
        stored.clone()
    } else {
        match try_mint_nanoid(tx, length, &owned_elsewhere)? {
            Some(id) => id,
            // Exhausted: leave the node as it is; after_commit reports it once.
            None => return Ok(()),
        }
    };
    if id != stored {
        tx.set_state(key, id_state, Some(id.clone()))?;
    }
    macro_document_model::node_ids::claim_id(tx, &id, key)
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
    try_mint_nanoid(tx, length, &|tx, candidate| {
        Ok(tx.extension::<NodeIdIndex>()?.ids.contains_key(candidate)
            || reserved.iter().any(|id| id == candidate))
    })?
    .ok_or(Error::Invariant("node id generation exhausted"))
}

/// Bounded Source nanoid draws: `None` when every draw was taken; any other error propagates.
#[cfg(feature = "application")]
fn try_mint_nanoid(
    tx: &Transaction<'_>,
    length: usize,
    taken: &dyn Fn(&Transaction<'_>, &str) -> Result<bool, Error>,
) -> Result<Option<String>, Error> {
    for _ in 0..NANOID_ATTEMPTS {
        let candidate = macro_document_model::nanoid(tx, length)
            .map_err(|error| Error::invariant(error.to_string()))?;
        if !taken(tx, &candidate)? {
            return Ok(Some(candidate));
        }
    }
    Ok(None)
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
        const COMMANDS: &[CommandRegistration] = &[
            CommandRegistration {
                command: CommandKind::InsertClipboardNodes,
                priority: CommandPriority::Critical,
                placement: Placement::Before,
            },
            #[cfg(feature = "application")]
            CommandRegistration {
                command: CommandKind::Extension(&RECONCILE_ROOT_ID),
                priority: CommandPriority::Critical,
                placement: Placement::Before,
            },
        ];
        COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        #[cfg(feature = "application")]
        if let Command::Extension(command) = command
            && command.payload(&RECONCILE_ROOT_ID).is_some()
        {
            if self.track_root || !matches!(self.mint, IdMint::Nanoid { .. }) {
                return Ok(Handled::No);
            }
            tx.add_tag(UpdateTag::Custom(COLLAB_SELECTION_TAG.into()));
            self.ensure_root_id(tx, &[])?;
            return Ok(Handled::Yes);
        }
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
            // an attached owner that still stores the id conflicts: an owner whose id
            // changed in this commit (its own mutation updates the index later in this
            // loop) gave the id up, as the in-update transform decided.
            let indexed = match &id {
                Some(value) => tx.extension::<NodeIdIndex>()?.ids.get(value).copied(),
                None => None,
            };
            let conflict = match (&id, indexed) {
                (Some(value), Some(owner)) => {
                    owner != *key
                        && tx.is_attached(owner)
                        && tx.get_state(owner, self.id_state)?.as_deref() == Some(value.as_str())
                }
                _ => false,
            };
            if let Some(value) = &mut id
                && (value.is_empty() || conflict)
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
        #[cfg(feature = "application")]
        if tx.is_initializing() {
            self.ensure_root_id(tx, &reserved)?;
        } else if !self.track_root
            && matches!(self.mint, IdMint::Nanoid { .. })
            && !commit.changes.mutations.is_empty()
            && !commit.tags.contains(&UpdateTag::Collaboration)
            && !commit.tags.contains(&UpdateTag::Historic)
            && !commit.tags.contains(&UpdateTag::SkipCollab)
            && ![
                "from-loro",
                COLLAB_SELECTION_TAG,
                "local-status",
                "code-highlight-ids",
            ]
            .iter()
            .any(|tag| commit.tags.contains(&UpdateTag::Custom((*tag).into())))
        {
            // Source ignores remote root fields, then writes its live id on the
            // next real local edit. Preserve the imported slot until that edit.
            tx.supersede_retained_root_state(
                self.id_state,
                macro_document_model::sync::RETAINED_LIVE_ROOT_STATE,
            )?;
        }
        Ok(())
    }
}
#[cfg(feature = "application")]
impl NodeIds {
    /// The open and post-Loro ID passes include Root. Ordinary local updates do not:
    /// in particular, raw SetState must retain an incoming id-less root.
    fn ensure_root_id(&self, tx: &mut Transaction<'_>, reserved: &[String]) -> Result<(), Error> {
        let IdMint::Nanoid { length } = self.mint else {
            return Ok(());
        };
        if self.track_root {
            return Ok(());
        }
        let stored = tx
            .get_state(NodeKey::ROOT, self.id_state)?
            .unwrap_or_default();
        let id = if stored.is_empty() {
            let minted = mint_nanoid(tx, length, reserved)?;
            tx.set_state(NodeKey::ROOT, self.id_state, Some(minted.clone()))?;
            minted
        } else {
            stored
        };
        let index = tx.extension_mut::<NodeIdIndex>()?;
        if !index.ids.contains_key(&id) {
            index.ids.insert(id.clone(), NodeKey::ROOT);
            index.keys.insert(NodeKey::ROOT, id);
        }
        Ok(())
    }
    /// Nonempty stored ids of this commit's attached, non-destroyed mutations.
    fn incoming_ids(&self, tx: &Transaction<'_>, commit: &Commit) -> Result<Vec<String>, Error> {
        let mut ids = Vec::new();
        for (key, mutation) in &commit.changes.mutations {
            if *mutation == Mutation::Destroyed
                || (!self.track_root && *key == NodeKey::ROOT && !tx.is_initializing())
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
            CommandKind::Key(KeyCommand::ArrowUp),
            CommandKind::Key(KeyCommand::ArrowDown),
            CommandKind::Key(KeyCommand::MoveToStart),
            CommandKind::Key(KeyCommand::MoveToEnd),
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
            lexical_rich_nodes::clipboard::insert_nodes_and_update_selection(
                tx, nodes, *selection,
            )?;
            return Ok(Handled::Yes);
        }
        if let Command::Key {
            command: KeyCommand::ArrowUp | KeyCommand::ArrowDown,
            event,
        } = command
        {
            let shift = event.as_ref().is_some_and(|event| event.shift);
            let outcome = if matches!(
                command,
                Command::Key {
                    command: KeyCommand::ArrowUp,
                    ..
                }
            ) {
                rich_text::arrow_up(tx, shift)
            } else {
                rich_text::arrow_down(tx, shift)
            }
            .map_err(|lexical_rich_nodes::Error::Model(error)| error)?;
            if outcome == rich_text::ArrowOutcome::Handled {
                tx.prevent_default();
                return Ok(Handled::Yes);
            }
            return Ok(Handled::No);
        }
        if let Command::Key {
            command: command @ (KeyCommand::MoveToStart | KeyCommand::MoveToEnd),
            event,
        } = command
        {
            let shift = event.as_ref().is_some_and(|event| event.shift);
            let outcome = if *command == KeyCommand::MoveToStart {
                rich_text::move_to_start(tx, shift)
            } else {
                rich_text::move_to_end(tx, shift)
            }
            .map_err(|lexical_rich_nodes::Error::Model(error)| error)?;
            if outcome == rich_text::ArrowOutcome::Handled {
                tx.prevent_default();
                return Ok(Handled::Yes);
            }
            return Ok(Handled::No);
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
        tx.add_tag(UpdateTag::Custom(COLLAB_SELECTION_TAG.into()));
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
