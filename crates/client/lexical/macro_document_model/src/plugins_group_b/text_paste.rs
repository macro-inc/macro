//! Source high-priority text paste, with asynchronous lookup requests as effects.
use super::*;
use crate::nodes::{
    BookingLinkMentionNode, DocumentMentionNode, Maybe, PasteOrigin, PullRequestMentionNode,
    ThemeMentionNode, create_booking_link_mention_node, create_document_mention_node,
    create_paste_node, parse_booking_url,
};
use lexical_rich_nodes::{
    code::CodeNode,
    link::{LinkAttributes, LinkNode, create_link_node},
};
use serde_json::Value;
pub(super) mod urls;

const FACTS_MIME: &str = "application/x-macro-text-paste";
#[derive(Clone, Debug, Default, serde::Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct TextFacts {
    hostname: String,
    native_host: bool,
    cached_pr: Option<CachedPr>,
    resolved_app_link: Option<urls::AppLink>,
}
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedPr {
    github_key: String,
    id: String,
}
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrLookup {
    key: u32,
    generation: u32,
    url: String,
    github_key: String,
}
#[derive(Clone, Debug, serde::Deserialize)]
struct PrResult {
    request: PrLookup,
    id: String,
}
#[derive(Clone, Debug)]
struct ResolvePr {
    result: PrResult,
    generation: u32,
}
static LOOKUP: EventKey<PrLookup> = EventKey::new("group-b.resolve-pr");
static RESOLVE: CommandKey<ResolvePr> = CommandKey::new("group-b.resolve-pr");

pub(super) fn decode(name: &str, json: &str, generation: u32) -> Result<Option<Command>, Error> {
    if name != RESOLVE.name() {
        return Ok(None);
    }
    Ok(Some(Command::Extension(ExtensionCommand::new(
        &RESOLVE,
        ResolvePr {
            result: serde_json::from_str(json)?,
            generation,
        },
    ))))
}
pub(super) fn event_payload(event: &PluginEvent) -> Result<Option<Value>, Error> {
    event
        .payload(&LOOKUP)
        .map(serde_json::to_value)
        .transpose()
        .map_err(Error::from)
}
pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(TextPaste)
}
static COMMANDS: [CommandRegistration; 2] = [
    CommandRegistration {
        command: CommandKind::Paste,
        priority: CommandPriority::High,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::Extension(&RESOLVE),
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
];
struct TextPaste;
impl Plugin for TextPaste {
    fn name(&self) -> &'static str {
        "group-b.text-paste"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        match command {
            Command::Paste(payload) => paste(tx, payload),
            Command::Extension(extension) => {
                let Some(command) = extension.payload(&RESOLVE) else {
                    return Ok(Handled::No);
                };
                resolve_pr(tx, command)
            }
            _ => Ok(Handled::No),
        }
    }
}
fn expanded(tx: &Transaction<'_>) -> bool {
    tx.selection()
        .and_then(Selection::as_range)
        .is_some_and(|range| !range.is_collapsed())
}
fn collapsed_range(tx: &Transaction<'_>) -> bool {
    tx.selection()
        .and_then(Selection::as_range)
        .is_some_and(RangeSelection::is_collapsed)
}
fn paste(tx: &mut Transaction<'_>, payload: &ClipboardPayload) -> Result<Handled, Error> {
    let text = payload.get("text/plain").unwrap_or_default();
    if let Some(range) = tx.selection().and_then(Selection::as_range) {
        let code = |key| tx.find_matching_parent(key, |state, key| state.is::<CodeNode>(key));
        if let Some(anchor) = code(range.anchor.key())
            && Some(anchor) == code(range.focus.key())
        {
            let facts = super::clipboard::PasteFacts::read(payload)?;
            if text.is_empty() || payload.has_files || facts.mobile_image_recovery {
                return Ok(Handled::No);
            }
            tx.insert_raw_text(text)?;
            return Ok(Handled::Yes);
        }
    }
    if let Some(data) = super::theme::parse_pasted_theme(text)? {
        if expanded(tx) {
            return Ok(Handled::No);
        }
        let name = data
            .get("name")
            .and_then(Value::as_str)
            .ok_or(Error::Invariant("pasted theme name"))?
            .to_owned();
        let mention = tx.create(ThemeMentionNode {
            name: Maybe::Value(name),
            data: Maybe::Value(data),
        })?;
        insert_inline(tx, mention.key())?;
        return Ok(Handled::Yes);
    }
    let facts: TextFacts = payload
        .get(FACTS_MIME)
        .map(serde_json::from_str)
        .transpose()?
        .unwrap_or_default();
    if let Some(pr) = urls::parse_pr(text) {
        if !collapsed_range(tx) {
            return Ok(Handled::No);
        }
        if let Some(cached) = facts
            .cached_pr
            .filter(|cached| cached.github_key == pr.github_key)
        {
            let mention = pr_mention(tx, cached.id, &pr)?;
            insert_inline(tx, mention)?;
        } else {
            let url = urls::trim_js(text);
            let link = create_link_node(tx, url, LinkAttributes::default())?;
            let text = tx.create_text(url)?;
            tx.append(link, &[text.key()])?;
            tx.insert_nodes(&[link.key()])?;
            tx.emit(
                &LOOKUP,
                PrLookup {
                    key: link.key().index(),
                    generation: link.key().generation(),
                    url: url.into(),
                    github_key: pr.github_key,
                },
            );
        }
        return Ok(Handled::Yes);
    }
    let trimmed = urls::trim_js(text);
    if let Some((profile_id, slug)) = parse_booking_url(trimmed) {
        if !collapsed_range(tx) {
            return Ok(Handled::No);
        }
        let mention = create_booking_link_mention_node(
            tx,
            BookingLinkMentionNode {
                profile_id: Maybe::Value(profile_id),
                slug: slug.clone().map(Maybe::Value).unwrap_or(Maybe::Missing),
                label: slug.map(Maybe::Value).unwrap_or(Maybe::Missing),
                url: trimmed.into(),
                ..Default::default()
            },
        )?;
        tx.insert_nodes(&[mention.key()])?;
        return Ok(Handled::Yes);
    }
    let hostname = if facts.hostname.is_empty() {
        tx.try_extension::<crate::NodeHost>()
            .and_then(|host| host.0.as_deref())
            .unwrap_or_default()
    } else {
        &facts.hostname
    };
    let app_link = urls::parse_app(text, hostname, facts.native_host).or(facts.resolved_app_link);
    if let Some(link) = app_link.filter(|link| !link.id.is_empty() && !link.block.is_empty()) {
        if expanded(tx) {
            return Ok(Handled::No);
        }
        let mention = if link.block == "pr" {
            tx.create(PullRequestMentionNode {
                id: Maybe::Value(link.id),
                ..Default::default()
            })?
            .key()
        } else {
            create_document_mention_node(
                tx,
                DocumentMentionNode {
                    document_id: Maybe::Value(link.id),
                    document_name: Maybe::Value(String::new()),
                    block_name: Maybe::Value(link.block),
                    block_params: link.params,
                    ..Default::default()
                },
            )?
            .key()
        };
        insert_inline(tx, mention)?;
        return Ok(Handled::Yes);
    }
    let rich = ["application/x-lexical-editor", "text/html"]
        .iter()
        .any(|mime| payload.get(mime).is_some_and(|value| !value.is_empty()));
    if !rich && text.encode_utf16().count() > 1500 {
        if expanded(tx) {
            return Ok(Handled::No);
        }
        let paste = create_paste_node(tx, Maybe::Value(text.into()), PasteOrigin::Pasted)?;
        super::list_insert::insert_and_split_list(tx, &[paste.key()])?;
        return Ok(Handled::Yes);
    }
    Ok(Handled::No)
}
fn insert_inline(tx: &mut Transaction<'_>, key: NodeKey) -> Result<(), Error> {
    tx.insert_nodes(&[key])?;
    if tx
        .parent(key)
        .is_some_and(|parent| tx.is_root_or_shadow_root(parent))
    {
        let p = tx.create(Paragraph::default())?;
        tx.insert_before(key, p, true)?;
        tx.append(p, &[key])?;
    }
    tx.select_end(key)?;
    Ok(())
}
fn pr_mention(tx: &mut Transaction<'_>, id: String, pr: &urls::PrUrl) -> Result<NodeKey, Error> {
    Ok(tx
        .create(PullRequestMentionNode {
            id: Maybe::Value(id),
            label: Maybe::Value(pr.label.clone()),
            url: Maybe::Value(pr.canonical.clone()),
            ..Default::default()
        })?
        .key())
}
fn resolve_pr(tx: &mut Transaction<'_>, command: &ResolvePr) -> Result<Handled, Error> {
    let PrResult { request, id } = &command.result;
    if request.generation != command.generation {
        return Ok(Handled::No);
    }
    let key = NodeKey::from_parts(KeyParts {
        generation: request.generation,
        index: request.key,
    });
    let Some(link) = tx.get::<LinkNode>(key).filter(|_| tx.is_attached(key)) else {
        return Ok(Handled::No);
    };
    if link.url != request.url || tx.text_content(key) != request.url {
        return Ok(Handled::No);
    }
    let Some(pr) = urls::parse_pr(&request.url).filter(|pr| pr.github_key == request.github_key)
    else {
        return Ok(Handled::No);
    };
    let caret_inside = tx
        .selection()
        .and_then(Selection::as_range)
        .is_some_and(|range| {
            range.is_collapsed()
                && (range.anchor.key() == key || tx.is_parent_of(key, range.anchor.key()))
        });
    let mention = pr_mention(tx, id.clone(), &pr)?;
    tx.replace(key, mention, false)?;
    if caret_inside {
        tx.select_end(mention)?;
    }
    tx.add_tag(UpdateTag::HistoryMerge);
    Ok(Handled::Yes)
}
