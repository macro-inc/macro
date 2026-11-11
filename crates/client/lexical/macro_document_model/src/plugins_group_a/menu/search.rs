//! Source inline-search mutation controllers; visible menu state belongs to the host.
use crate::{nodes::InlineSearchNode, peer};
use lexical_model::*;

/// The four body-editor search controllers, independent of commit-time menu answers.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
enum Kind {
    Actions,
    Mentions,
    Emojis,
    Snippets,
}
impl Kind {
    fn symbol(self) -> &'static str {
        match self {
            Self::Actions => "/",
            Self::Mentions => "@",
            Self::Emojis => ":",
            Self::Snippets => ";",
        }
    }
}
// registerMarkdownEditing installs these mutation listeners in this order.
const KINDS: [Kind; 4] = [Kind::Emojis, Kind::Mentions, Kind::Snippets, Kind::Actions];
#[derive(Clone, Debug, serde::Serialize)]
struct SearchRange {
    key: u32,
    offset: u32,
    expected: String,
}
#[derive(Clone, Debug, serde::Serialize)]
struct Snapshot {
    kind: Kind,
    open: bool,
    term: String,
    range: Option<SearchRange>,
}
#[derive(Clone)]
struct Controllers([Snapshot; 4]);
impl Default for Controllers {
    fn default() -> Self {
        Self(KINDS.map(|kind| Snapshot {
            kind,
            open: false,
            term: String::new(),
            range: None,
        }))
    }
}
#[derive(Clone, Copy, Debug, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
enum Callback {
    Open,
    Close,
    Term,
}
#[derive(Clone, Debug, serde::Serialize)]
struct Change {
    callback: Callback,
    #[serde(flatten)]
    snapshot: Snapshot,
}
static CHANGE: EventKey<Change> = EventKey::new("group-a.search-change");
#[derive(Clone, Debug)]
struct Trigger {
    kind: Kind,
    generation: u32,
}
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct KindInput {
    kind: Kind,
}
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Empty {}
static TRIGGER: CommandKey<Trigger> = CommandKey::new("group-a.search-trigger");
static CLOSE: CommandKey<u32> = CommandKey::new("group-a.search-close");
static REMOVE: CommandKey<u32> = CommandKey::new("group-a.search-remove");

pub(super) fn decode(name: &str, json: &str, generation: u32) -> Result<Option<Command>, Error> {
    if name == TRIGGER.name() {
        let input: KindInput = serde_json::from_str(json)?;
        return Ok(Some(Command::Extension(ExtensionCommand::new(
            &TRIGGER,
            Trigger {
                kind: input.kind,
                generation,
            },
        ))));
    }
    let key = match name {
        "group-a.search-close" => &CLOSE,
        "group-a.search-remove" => &REMOVE,
        _ => return Ok(None),
    };
    let _: Empty = serde_json::from_str(json)?;
    Ok(Some(Command::Extension(ExtensionCommand::new(
        key, generation,
    ))))
}
/// Snapshot only: later ordered callbacks, including equal values, are host events.
pub(crate) fn query(
    name: &str,
    data: &serde_json::Value,
    generation: u32,
    editor: &Editor,
) -> Result<Option<serde_json::Value>, Error> {
    if name != "group-a.search-query" {
        return Ok(None);
    }
    if generation != editor.state().max_key().generation() {
        return Err(Error::Invariant("application query generation"));
    }
    let input: KindInput = serde_json::from_value(data.clone())?;
    let controllers = editor.extension::<Controllers>()?;
    let snapshot = controllers
        .0
        .iter()
        .find(|state| state.kind == input.kind)
        .ok_or(Error::Invariant("search controller"))?;
    Ok(Some(serde_json::to_value(snapshot)?))
}
pub(crate) fn event_payload(event: &PluginEvent) -> Result<Option<serde_json::Value>, Error> {
    event
        .payload(&CHANGE)
        .map(serde_json::to_value)
        .transpose()
        .map_err(Error::from)
}
pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder
        .extension_state(Controllers::default())
        .transform_each(transform, TransformScope::Types(&[InlineSearchNode::TYPE]))
        .plugin(Search)
}
fn current_peer<'a>(tx: &'a Transaction<'_>) -> Option<&'a str> {
    tx.try_extension::<peer::PeerIdState>()
        .and_then(|state| state.peer_id.as_deref())
}
fn eligible(state: &EditorState, kind: Kind) -> Result<bool, Error> {
    let Some(range) = state.selection().and_then(Selection::as_range) else {
        return Ok(false);
    };
    let view = state.view();
    let anchor = range.anchor.key();
    if view.get::<InlineSearchNode>(anchor).is_some() {
        return Ok(false);
    }
    let mut node = Some(anchor);
    while let Some(key) = node {
        if view
            .get::<lexical_rich_nodes::code::CodeNode>(key)
            .is_some()
            || view.get::<crate::nodes::CustomCodeNode>(key).is_some()
        {
            return Ok(false);
        }
        node = view.parent(key);
    }
    let offset = range.anchor.offset();
    let (before, after) = if view.element(anchor).is_some() {
        let children = view.children_keys(anchor)?;
        let split = usize::try_from(offset)
            .unwrap_or(usize::MAX)
            .min(children.len());
        (
            children[..split]
                .iter()
                .map(|key| view.text_content(*key))
                .collect::<String>(),
            children[split..]
                .iter()
                .map(|key| view.text_content(*key))
                .collect::<String>(),
        )
    } else {
        let text = view.text_content(anchor);
        let utf16 = TextBuffer::new(text.as_ref());
        let before = utf16.slice(Utf16Offset(0)..Utf16Offset(offset))?.to_owned();
        let after = utf16
            .slice(Utf16Offset(offset)..utf16.utf16_len())?
            .to_owned();
        let before = if before.is_empty() && view.text(anchor).is_some() {
            view.prev_sibling(anchor)
                .filter(|key| view.text(*key).is_some())
                .map(|key| view.text_content(key).into_owned())
                .unwrap_or(before)
        } else {
            before
        };
        (before, after)
    };
    Ok(
        (before.is_empty() || before.chars().last().is_some_and(is_js_whitespace))
            && (kind == Kind::Mentions
                || after.is_empty()
                || after.chars().next().is_some_and(is_js_whitespace)),
    )
}
fn transform(tx: &mut Transaction<'_>, key: NodeKey) -> Result<(), Error> {
    let text = tx.text_content(key).into_owned();
    if KINDS
        .iter()
        .any(|kind| text.starts_with(&kind.symbol().repeat(2)))
    {
        tx.text(key)?.set_text_content(&text[1..])?;
        tx.select_end(key)?;
    }
    // Imports bypass transforms. A later real dirty transform may author a
    // missing owner, exactly as Source does, without adopting at query/import.
    if tx.try_extension::<peer::PeerIdState>().is_some() {
        peer::peer_transform(tx, key)?;
    }
    Ok(())
}
struct Search;
impl Plugin for Search {
    fn name(&self) -> &'static str {
        "group-a.search"
    }
    fn commands(&self) -> &[CommandRegistration] {
        const COMMANDS: &[CommandRegistration] = &[
            CommandRegistration {
                command: CommandKind::Extension(&TRIGGER),
                priority: CommandPriority::Low,
                placement: Placement::After,
            },
            CommandRegistration {
                command: CommandKind::Extension(&CLOSE),
                priority: CommandPriority::Low,
                placement: Placement::After,
            },
            CommandRegistration {
                command: CommandKind::Extension(&REMOVE),
                priority: CommandPriority::High,
                placement: Placement::After,
            },
        ];
        COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(extension) = command else {
            return Ok(Handled::No);
        };
        if let Some(trigger) = extension.payload(&TRIGGER) {
            if trigger.generation != tx.committed_state().max_key().generation()
                || !eligible(tx.committed_state(), trigger.kind)?
            {
                return Ok(Handled::No);
            }
            let format = tx
                .view()
                .selection()
                .and_then(Selection::as_range)
                .map(|range| range.format);
            let node = tx.create(InlineSearchNode::default())?;
            tx.text(node)?.set_text_content(trigger.kind.symbol())?;
            if let Some(format) = format {
                tx.text(node)?.set_format(format)?;
            }
            if let Some(peer) = current_peer(tx)
                .filter(|peer| !peer.is_empty())
                .map(str::to_owned)
            {
                peer::set_peer_id(tx, node.key(), peer)?;
            }
            tx.insert_nodes(&[node.key()])?;
            return Ok(Handled::Yes);
        }
        let remove = extension.payload(&REMOVE).is_some();
        let Some(generation) = extension
            .payload(&REMOVE)
            .or_else(|| extension.payload(&CLOSE))
        else {
            return Ok(Handled::No);
        };
        if *generation != tx.committed_state().max_key().generation() {
            return Ok(Handled::No);
        }
        let keys = lexical_rich_nodes::utils::dfs(tx.view(), None, None)
            .into_iter()
            .map(|record| record.node)
            .filter(|key| tx.view().get::<InlineSearchNode>(*key).is_some())
            .collect::<Vec<_>>();
        let mut handled = false;
        for key in keys {
            if peer::peer_id_valid(peer::PeerIdTarget::Node(tx.view(), key), current_peer(tx))? {
                if remove {
                    tx.remove(key, false)?;
                } else {
                    let text = tx.text_content(key).into_owned();
                    let replacement = tx.create_text(&text)?;
                    tx.replace(key, replacement, false)?;
                }
                handled = true;
            }
        }
        Ok(if handled { Handled::Yes } else { Handled::No })
    }
    fn after_commit(&self, tx: &mut Transaction<'_>, commit: &Commit) -> Result<(), Error> {
        for (index, kind) in KINDS.into_iter().enumerate() {
            for (key, mutation) in commit.mutations_of::<InlineSearchNode>() {
                let view = if mutation == Mutation::Destroyed {
                    commit.prev.view()
                } else {
                    commit.next.view()
                };
                if !peer::peer_id_valid(peer::PeerIdTarget::Node(view, key), current_peer(tx))? {
                    continue;
                }
                let callback = match mutation {
                    Mutation::Destroyed => Callback::Close,
                    Mutation::Created => {
                        if view.text_content(key) != kind.symbol() {
                            break;
                        }
                        Callback::Open
                    }
                    Mutation::Updated => {
                        if view.text_content(key).is_empty() {
                            continue;
                        }
                        Callback::Term
                    }
                };
                let snapshot = &mut tx.extension_mut::<Controllers>()?.0[index];
                match callback {
                    Callback::Open => snapshot.open = true,
                    Callback::Close => snapshot.open = false,
                    Callback::Term => {
                        let text = view.text_content(key).replace('\u{200b}', "");
                        let text = text.trim_matches(is_js_whitespace);
                        snapshot.term = text
                            .strip_prefix(['@', ':', '/', ';', '#'])
                            .unwrap_or(text)
                            .to_owned();
                    }
                }
                snapshot.range = (mutation != Mutation::Destroyed).then(|| SearchRange {
                    key: key.index(),
                    offset: 0,
                    expected: view.text_content(key).into_owned(),
                });
                let snapshot = snapshot.clone();
                tx.emit(&CHANGE, Change { callback, snapshot });
            }
        }
        // Source registers the peer created-node listener after the menu
        // listeners. Its real local-status write causes the next mutation round;
        // that round, rather than fabricated events here, invokes Term callbacks.
        if tx.try_extension::<peer::PeerIdState>().is_some() {
            for (key, mutation) in commit.mutations_of::<InlineSearchNode>() {
                if mutation != Mutation::Created || !tx.is_attached(key) {
                    continue;
                }
                if let Some(owner) = peer::get_peer_id(tx.view(), key)?
                    && peer::get_local(tx.view(), key)?.is_none()
                {
                    let local = Some(owner.as_str()) == current_peer(tx);
                    peer::set_local(tx, key, local)?;
                    tx.add_tag(UpdateTag::Custom(peer::LOCAL_STATUS_TAG.into()));
                }
            }
        }
        Ok(())
    }
}
#[cfg(test)]
mod test;
