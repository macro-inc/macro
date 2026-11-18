//! Keyed Database creation commands and private own-main receipt extraction.
use super::*;
use crate::nodes::{
    AwaitNode, DocumentCardNode, DocumentMentionNode, Maybe, convert_mention_to_card,
    create_await_node, create_document_mention_node,
};

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct StartInput {}
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompleteInput {
    key: u32,
    document_id: String,
    #[serde(default)]
    mention_uuid: Option<String>,
}
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct KeyInput {
    key: u32,
}
#[derive(Clone, Debug)]
struct Input<Value> {
    generation: u32,
    value: Value,
}
static START: CommandKey<Input<StartInput>> = CommandKey::new("group-b.database-create-start");
static COMPLETE: CommandKey<Input<CompleteInput>> =
    CommandKey::new("group-b.database-create-complete");
static REMOVE_AWAIT: CommandKey<Input<KeyInput>> = CommandKey::new("group-b.database-remove-await");
static REMOVE_ANY: CommandKey<Input<KeyInput>> = CommandKey::new("group-b.database-remove-any");
#[derive(Clone, Debug)]
struct Started {
    key: NodeKey,
    await_id: String,
}
#[derive(Clone, Debug)]
enum Completion {
    Inserted { target: NodeKey, card: NodeKey },
    NotAwait { target: NodeKey },
}
#[derive(Clone, Debug)]
struct Removal {
    key: NodeKey,
    removed: bool,
}
static STARTED: ReceiptKey<Started> = ReceiptKey::new("database-started");
static COMPLETED: ReceiptKey<Completion> = ReceiptKey::new("database-completed");
static AWAIT_REMOVED: ReceiptKey<Removal> = ReceiptKey::new("database-await-removed");
static ANY_REMOVED: ReceiptKey<Removal> = ReceiptKey::new("database-any-removed");
fn key(index: u32, generation: u32) -> NodeKey {
    NodeKey::from_parts(KeyParts { index, generation })
}

pub(super) fn decode(name: &str, json: &str, generation: u32) -> Result<Option<Command>, Error> {
    if name != START.name()
        && name != COMPLETE.name()
        && name != REMOVE_AWAIT.name()
        && name != REMOVE_ANY.name()
    {
        return Ok(None);
    }
    let object: serde_json::Map<String, serde_json::Value> = serde_json::from_str(json)?;
    if name == START.name() {
        let value = serde_json::from_str(json)?;
        return Ok(Some(Command::Extension(ExtensionCommand::new(
            &START,
            Input { generation, value },
        ))));
    }
    if name == COMPLETE.name() {
        if object
            .get("mentionUuid")
            .is_some_and(|value| !value.is_string())
        {
            return Err(Error::Invariant(
                "database mention UUID requires a string when present",
            ));
        }
        let value = serde_json::from_str(json)?;
        return Ok(Some(Command::Extension(ExtensionCommand::new(
            &COMPLETE,
            Input { generation, value },
        ))));
    }
    let value = serde_json::from_str(json)?;
    let command = if name == REMOVE_AWAIT.name() {
        &REMOVE_AWAIT
    } else {
        &REMOVE_ANY
    };
    Ok(Some(Command::Extension(ExtensionCommand::new(
        command,
        Input { generation, value },
    ))))
}
pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(DatabaseCreateActions)
}
struct DatabaseCreateActions;
impl Plugin for DatabaseCreateActions {
    fn name(&self) -> &'static str {
        "group-b.database-create"
    }
    fn commands(&self) -> &[CommandRegistration] {
        const COMMANDS: [CommandRegistration; 4] = [
            CommandRegistration {
                command: CommandKind::Extension(&START),
                priority: CommandPriority::Normal,
                placement: Placement::After,
            },
            CommandRegistration {
                command: CommandKind::Extension(&COMPLETE),
                priority: CommandPriority::Normal,
                placement: Placement::After,
            },
            CommandRegistration {
                command: CommandKind::Extension(&REMOVE_AWAIT),
                priority: CommandPriority::Normal,
                placement: Placement::After,
            },
            CommandRegistration {
                command: CommandKind::Extension(&REMOVE_ANY),
                priority: CommandPriority::Normal,
                placement: Placement::After,
            },
        ];
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        if let Some(input) = command.payload(&START) {
            if input.generation != tx.committed_state().max_key().generation() {
                return Ok(Handled::No);
            }
            // Session admission owns edit access. The constructor uses NodeRandom.
            let pending = create_await_node(tx, None, Some("Creating database…".into()), true)?;
            let await_id = match &tx.get_or_err::<AwaitNode>(pending)?.await_id {
                Maybe::Value(value) => value.clone(),
                _ => return Err(Error::Invariant("authored database Await id")),
            };
            tx.insert_nodes_at_selection(&[pending.key()])?;
            tx.emit_receipt(
                &STARTED,
                Started {
                    key: pending.key(),
                    await_id,
                },
            );
            return Ok(Handled::Yes);
        }
        if let Some(input) = command.payload(&COMPLETE) {
            if input.generation != tx.committed_state().max_key().generation() {
                return Ok(Handled::No);
            }
            let target = key(input.value.key, input.generation);
            if tx.get::<AwaitNode>(target).is_none() {
                tx.emit_receipt(&COMPLETED, Completion::NotAwait { target });
                return Ok(Handled::Yes);
            }
            let focused = match tx.selection().and_then(Selection::as_range) {
                Some(range) => range.nodes(tx.view())?.contains(&target),
                None => false,
            };
            let mention = create_document_mention_node(
                tx,
                DocumentMentionNode {
                    document_id: Maybe::Value(input.value.document_id.clone()),
                    document_name: Maybe::Value("Untitled database".into()),
                    block_name: Maybe::Value("database".into()),
                    mention_uuid: Maybe::from_option(input.value.mention_uuid.clone()),
                    ..Default::default()
                },
            )?;
            tx.replace(target, mention.key(), false)?;
            let card = convert_mention_to_card(tx, mention, None, Maybe::Missing)?;
            if tx.next_sibling(card.key()).is_none() {
                let paragraph = tx.create(Paragraph::default())?;
                tx.insert_after(card, paragraph, true)?;
                if focused {
                    tx.select_start(paragraph)?;
                }
            }
            // RULED: atomic completion, no partial success before trailing work.
            tx.emit_receipt(
                &COMPLETED,
                Completion::Inserted {
                    target,
                    card: card.key(),
                },
            );
            return Ok(Handled::Yes);
        }
        let (input, await_only, receipt) = if let Some(input) = command.payload(&REMOVE_AWAIT) {
            (input, true, &AWAIT_REMOVED)
        } else if let Some(input) = command.payload(&REMOVE_ANY) {
            (input, false, &ANY_REMOVED)
        } else {
            return Ok(Handled::No);
        };
        if input.generation != tx.committed_state().max_key().generation() {
            return Ok(Handled::No);
        }
        let target = key(input.value.key, input.generation);
        let removed = tx.view().node(target).is_some()
            && (!await_only || tx.get::<AwaitNode>(target).is_some());
        if removed {
            tx.remove(target, false)?;
        }
        tx.emit_receipt(
            receipt,
            Removal {
                key: target,
                removed,
            },
        );
        Ok(Handled::Yes)
    }
}

pub(super) fn query(
    name: &str,
    data: &serde_json::Value,
    generation: u32,
    state: &EditorState,
) -> Result<Option<serde_json::Value>, Error> {
    if name != "group-b.database-target" {
        return Ok(None);
    }
    if generation != state.max_key().generation() {
        return Err(Error::Invariant("database query generation"));
    }
    let object = data
        .as_object()
        .ok_or(Error::Invariant("database target requires an object"))?;
    let input: KeyInput = serde_json::from_value(serde_json::Value::Object(object.clone()))?;
    let target = key(input.key, generation);
    Ok(Some(
        serde_json::json!({"present":state.view().node(target).is_some(),"isAwait":state.view().get::<AwaitNode>(target).is_some()}),
    ))
}

/// Closed reason why a declared Database result lacks trustworthy authority.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DatabaseCaptureFailure {
    /// A main commit carried multiple or contradictory private facts.
    ReceiptMultiplicity,
    /// A declared fact disagreed with this main commit's actual node mutations.
    MutationMismatch,
    /// An authored Await id did not match the constructor's actual payload.
    AwaitIdentity,
    /// The same capture ran more than once within one observation attempt.
    ReusedCapture,
}
/// A typed Database operation result; never a generic JSON value or event.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DatabaseCommandResult {
    /// No declared operation completed; this is not insertion or rollback evidence.
    None,
    /// The exact newly inserted Await, validated against this main mutation set.
    Started {
        /// Actual generation-aware key, not a predicted allocation.
        key: NodeKey,
        /// Actual nanoid minted by the constructor.
        await_id: String,
    },
    /// Mention, card and any trailing paragraph completed atomically.
    Inserted,
    /// The keyed target was not an Await; no constructor ran.
    NotAwait,
    /// The declared cleanup removed its keyed target.
    Removed,
    /// The declared cleanup had no eligible keyed target.
    Absent,
    /// Main publication remains known, but operation authority is invalid.
    Invalid(DatabaseCaptureFailure),
}
/// Copied result beside, never inside, the id-only main publication outcome.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DatabaseMainCommitResult {
    /// Identity of the main commit from which the fact was actually extracted.
    pub commit_id: CommitId,
    /// Closed Database authority, independent of later view consumption.
    pub result: DatabaseCommandResult,
}
#[derive(Clone, Copy, Debug)]
enum Intent {
    Start,
    Complete { key: NodeKey },
    Remove { key: NodeKey, await_only: bool },
}
/// One declared input's native-only Database receipt extractor.
/// A new observation clears any earlier copied result before admission.
pub struct DatabaseCommitCapture {
    intent: Option<Intent>,
    result: Option<DatabaseMainCommitResult>,
    captured: bool,
}
impl DatabaseCommitCapture {
    /// Bind only a declared closed Database command; batches and other inputs opt out.
    pub fn new(input: &lexical_model::Input) -> Self {
        let intent = match input {
            lexical_model::Input::Command {
                command: Command::Extension(command),
                ..
            } => {
                if command.payload(&START).is_some() {
                    Some(Intent::Start)
                } else if let Some(input) = command.payload(&COMPLETE) {
                    Some(Intent::Complete {
                        key: key(input.value.key, input.generation),
                    })
                } else if let Some(input) = command.payload(&REMOVE_AWAIT) {
                    Some(Intent::Remove {
                        key: key(input.value.key, input.generation),
                        await_only: true,
                    })
                } else {
                    command.payload(&REMOVE_ANY).map(|input| Intent::Remove {
                        key: key(input.value.key, input.generation),
                        await_only: false,
                    })
                }
            }
            _ => None,
        };
        Self {
            intent,
            result: None,
            captured: false,
        }
    }
    /// Consume copied facts after the input settles; absent means no capture occurred.
    pub fn into_result(self) -> Option<DatabaseMainCommitResult> {
        self.result
    }
}
fn invalid(reason: DatabaseCaptureFailure) -> DatabaseCommandResult {
    DatabaseCommandResult::Invalid(reason)
}
fn extract(
    intent: Intent,
    commit: &Commit,
    receipts: MainCommitReceiptView<'_>,
    handled: Handled,
) -> DatabaseCommandResult {
    let count = receipts.values(&STARTED).count()
        + receipts.values(&COMPLETED).count()
        + receipts.values(&AWAIT_REMOVED).count()
        + receipts.values(&ANY_REMOVED).count();
    if count == 0 {
        return DatabaseCommandResult::None;
    }
    if count != 1 || handled != Handled::Yes {
        return invalid(DatabaseCaptureFailure::ReceiptMultiplicity);
    }
    match intent {
        Intent::Start => {
            let Some(started) = receipts.values(&STARTED).next() else {
                return invalid(DatabaseCaptureFailure::ReceiptMultiplicity);
            };
            let created = commit
                .mutations_of::<AwaitNode>()
                .filter(|(_, mutation)| *mutation == Mutation::Created)
                .map(|(key, _)| key)
                .collect::<Vec<_>>();
            if created != [started.key] {
                return invalid(DatabaseCaptureFailure::MutationMismatch);
            }
            let Some(node) = commit.next.view().get::<AwaitNode>(started.key) else {
                return invalid(DatabaseCaptureFailure::MutationMismatch);
            };
            if node.await_id.as_deref() != Some(started.await_id.as_str())
                || started.await_id.len() != 21
                || !started
                    .await_id
                    .bytes()
                    .all(|byte| crate::node_ids::NANOID_ALPHABET.contains(&byte))
            {
                return invalid(DatabaseCaptureFailure::AwaitIdentity);
            }
            DatabaseCommandResult::Started {
                key: started.key,
                await_id: started.await_id.clone(),
            }
        }
        Intent::Complete { key } => {
            let Some(completed) = receipts.values(&COMPLETED).next() else {
                return invalid(DatabaseCaptureFailure::ReceiptMultiplicity);
            };
            match completed {
                Completion::NotAwait { target }
                    if *target == key
                        && commit.next.view().get::<AwaitNode>(key).is_none()
                        && commit.is_noop() =>
                {
                    DatabaseCommandResult::NotAwait
                }
                Completion::Inserted { target, card }
                    if *target == key
                        && commit.prev.view().get::<AwaitNode>(key).is_some()
                        && commit.changes.mutations.get(&key) == Some(&Mutation::Destroyed)
                        && commit.changes.mutations.get(card) == Some(&Mutation::Created)
                        && commit.next.view().get::<DocumentCardNode>(*card).is_some() =>
                {
                    DatabaseCommandResult::Inserted
                }
                _ => invalid(DatabaseCaptureFailure::MutationMismatch),
            }
        }
        Intent::Remove { key, await_only } => {
            let expected = if await_only {
                &AWAIT_REMOVED
            } else {
                &ANY_REMOVED
            };
            let Some(removal) = receipts.values(expected).next() else {
                return invalid(DatabaseCaptureFailure::ReceiptMultiplicity);
            };
            if removal.key != key {
                return invalid(DatabaseCaptureFailure::MutationMismatch);
            }
            if removal.removed {
                if commit.changes.mutations.get(&key) != Some(&Mutation::Destroyed)
                    || commit.next.view().node(key).is_some()
                    || (await_only && commit.prev.view().get::<AwaitNode>(key).is_none())
                {
                    return invalid(DatabaseCaptureFailure::MutationMismatch);
                }
                DatabaseCommandResult::Removed
            } else {
                let absent = if await_only {
                    commit.next.view().get::<AwaitNode>(key).is_none()
                } else {
                    commit.next.view().node(key).is_none()
                };
                if !absent || !commit.is_noop() {
                    return invalid(DatabaseCaptureFailure::MutationMismatch);
                }
                DatabaseCommandResult::Absent
            }
        }
    }
}
impl MainCommitReceiptCapture for DatabaseCommitCapture {
    fn begin(&mut self) {
        self.result = None;
        self.captured = false;
    }
    fn capture(&mut self, commit: &Commit, receipts: MainCommitReceiptView<'_>, handled: Handled) {
        let Some(intent) = self.intent else {
            return;
        };
        let result = if self.captured {
            invalid(DatabaseCaptureFailure::ReusedCapture)
        } else {
            extract(intent, commit, receipts, handled)
        };
        self.captured = true;
        self.result = Some(DatabaseMainCommitResult {
            commit_id: commit.id,
            result,
        });
    }
}

#[cfg(test)]
mod test;
