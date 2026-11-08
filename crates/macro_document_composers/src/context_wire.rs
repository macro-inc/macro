//! Private context envelopes use real headless import/export and ordered XML.
use crate::{DocumentContext, Error, Result, nodes::AgentContextNode, xml::*};
use lexical_model::{NodeKey, Read, js_trim};
use serde::Deserialize;
use serde_json::Value;
mod trigger;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Prompt {
    prompt_markdown: String,
    instructions: Option<String>,
    owner: Option<Person>,
    sender: Option<Person>,
    current_time: Option<CurrentTime>,
    parent: Option<Parent>,
    anchor: Option<Value>,
    reply_target: Option<Value>,
    prompt_message_id: Option<String>,
    thread: Option<Thread>,
    #[serde(default)]
    channel: Vec<Thread>,
    trigger: Option<Value>,
}
#[derive(Deserialize)]
struct Person {
    id: String,
    name: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurrentTime {
    iso: String,
    local: String,
    time_zone: Option<String>,
}
#[derive(Deserialize)]
struct Parent {
    r#type: String,
    id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Message {
    id: String,
    author: String,
    sender_id: String,
    posted_at: String,
    content: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Thread {
    root_id: String,
    messages: Vec<Message>,
    messages_omitted: bool,
}
fn note(value: impl Into<String>) -> XmlNode {
    el("note", vec![text(value)])
}
fn string<'a>(value: &'a Value, field: &str) -> Option<&'a str> {
    value.get(field).and_then(Value::as_str)
}
fn attrs(mut node: XmlNode, source: &Value, fields: &[(&str, &str)]) -> XmlNode {
    for (name, field) in fields {
        if let Some(value) = string(source, field) {
            node = node.attribute(*name, value);
        }
    }
    node
}
fn message_node(message: &Message, prompt: Option<&str>) -> XmlNode {
    let node = el("message", vec![text(&message.content)])
        .attribute("id", &message.id)
        .attribute("author", &message.author)
        .attribute("author_id", &message.sender_id)
        .attribute("at", &message.posted_at);
    if prompt == Some(message.id.as_str()) {
        node.attribute("mentioned_you", "true")
    } else {
        node
    }
}
fn thread_node(thread: &Thread, prompt: Option<&str>) -> XmlNode {
    let mut children = Vec::new();
    if thread.messages_omitted {
        children.push(note("Some messages of this thread are not shown."));
    }
    children.extend(
        thread
            .messages
            .iter()
            .map(|message| message_node(message, prompt)),
    );
    let node = el("thread", children).attribute("root", &thread.root_id);
    if thread.messages_omitted {
        node.attribute("messages_omitted", "true")
    } else {
        node
    }
}
fn parent_description(ty: &str) -> Result<&'static str> {
    match ty {
        "channel" => Ok("a channel thread"),
        "document" => Ok("a document comment thread"),
        "initiative" => Ok("a project comment thread"),
        "crm_company" => Ok("a CRM company comment thread"),
        "crm_contact" => Ok("a CRM contact comment thread"),
        "call" => Ok("a call chat thread"),
        _ => Err(Error::InvalidArgument("unknown conversation parent".into())),
    }
}
fn reply_node(target: &Value, prompt: Option<&str>) -> Result<XmlNode> {
    match string(target, "kind") {
        Some("quote") => {
            let body = if let Some(message) = target.get("message") {
                message_node(&serde_json::from_value(message.clone())?, prompt)
            } else { el("preview", vec![text(string(target, "preview").unwrap_or(""))]) };
            Ok(attrs(el("reply_target", vec![note("The prompt quote-replies to this message. It is what the prompt is about."), body])
                .attribute("kind", "quote"), target, &[("message", "messageId"), ("thread", "threadId")]))
        }
        Some("thread") => Ok(attrs(el("reply_target", vec![note("The prompt was posted as a reply in the thread below. It is about that thread.")])
            .attribute("kind", "thread"), target, &[("thread", "threadId")])),
        Some("none") => Ok(el("reply_target", vec![note("The prompt was posted at the top level of the channel and replies to no particular message.")]).attribute("kind", "none")),
        _ => Err(Error::InvalidArgument("unknown reply target kind".into())),
    }
}
fn mark_children(mark: &Value) -> Vec<XmlNode> {
    let mut children = Vec::new();
    if let Some(current) = string(mark, "currentMarkedText") {
        children.push(note("marked_text is what the mark covers in the document now and surrounding_text the passage around it."));
        children.push(el("marked_text", vec![text(current)]));
        if let Some(surrounding) = string(mark, "surroundingText") {
            children.push(el("surrounding_text", vec![text(surrounding)]));
        }
        if let Some(posted) = string(mark, "markedText").filter(|posted| *posted != current) {
            children.push(el("marked_text_when_posted", vec![text(posted)]));
        }
    } else if let Some(posted) = string(mark, "markedText") {
        children.push(note("marked_text_when_posted is what the mark covered when the comment was posted; the document may have changed since."));
        children.push(el("marked_text_when_posted", vec![text(posted)]));
    }
    children
}
fn anchor_node(anchor: &Value) -> Result<XmlNode> {
    match string(anchor, "type") {
        Some("spreadsheet") => Ok(attrs(el("anchor", vec![note("Use ReadSpreadsheet to read the live cells in this range.")])
            .attribute("type", "spreadsheet"), anchor, &[("sheetId", "sheetId"), ("sheetName", "sheetName"), ("range", "range")])),
        Some("pdfPin") => Ok(attrs(el("anchor", vec![note("The comment is pinned to a point on a PDF page rather than to text, so it covers no words.")])
            .attribute("type", "pdf_pin"), anchor, &[("pin", "anchorId")])),
        Some("pdfHighlight") => {
            let body = string(anchor, "markedText").map_or_else(|| note("The PDF highlight carries no text, so which words it covers is not known."), |marked| el("marked_text", vec![text(marked)]));
            Ok(attrs(el("anchor", vec![body]).attribute("type", "pdf_highlight"), anchor, &[("highlight", "anchorId")]))
        }
        None | Some("markdown") => Ok(attrs(el("anchor", mark_children(anchor)).attribute("type", "markdown"), anchor, &[("mark", "markId")])),
        _ => Err(Error::InvalidArgument("unknown comment anchor".into())),
    }
}
fn conversation(input: &Prompt) -> Result<Option<XmlNode>> {
    let mut children = Vec::new();
    if let Some(parent) = &input.parent {
        children.push(el("origin", vec![text(format!("This prompt was posted in {}, not the agent session view. Your reply is posted back into that thread, and it is where the user will answer anything you ask.", parent_description(&parent.r#type)?))]));
    }
    if let Some(target) = &input.reply_target {
        children.push(reply_node(target, input.prompt_message_id.as_deref())?);
    }
    if let Some(anchor) = &input.anchor {
        children.push(anchor_node(anchor)?);
    }
    if let Some(thread) = &input.thread {
        children.push(thread_node(thread, input.prompt_message_id.as_deref()));
    }
    if !input.channel.is_empty() {
        let mut history = vec![note(if input.thread.is_some() {
            "Other recent messages in this channel, outside the thread above, oldest first. Background only: they are not what the prompt is about."
        } else {
            "Recent messages in this channel, grouped by thread, oldest first."
        })];
        for thread in &input.channel {
            history.push(
                if !thread.messages_omitted
                    && thread.messages.len() == 1
                    && thread.messages[0].id == thread.root_id
                {
                    message_node(&thread.messages[0], input.prompt_message_id.as_deref())
                } else {
                    thread_node(thread, input.prompt_message_id.as_deref())
                },
            );
        }
        children.push(el(
            if input.thread.is_some() {
                "channel_background"
            } else {
                "channel_recent"
            },
            history,
        ));
    }
    if children.is_empty() {
        return Ok(None);
    }
    let mut node = el("conversation", children);
    if let Some(parent) = &input.parent {
        node = node
            .attribute("type", &parent.r#type)
            .attribute("id", &parent.id);
    }
    Ok(Some(node))
}
fn session(owner: &Person, sender: Option<&Person>) -> XmlNode {
    let mut prompted = el("prompted_by", vec![]);
    if let Some(sender) = sender {
        prompted = prompted
            .attribute("name", &sender.name)
            .attribute("id", &sender.id);
    }
    prompted = prompted.attribute(
        "is_owner",
        if sender.is_some_and(|sender| sender.id == owner.id) {
            "true"
        } else {
            "false"
        },
    );
    let prompter = sender.map_or("A bot acting for nobody", |person| &person.name);
    let owner_name = &owner.name;
    el("session", vec![prompted, note(format!("{prompter} sent this prompt. {owner_name} owns this session. Choose acting_as explicitly on each tool that accepts it. Prefer requester: this uses the access and connected apps of the person who sent this prompt, without an extra account approval. Choose owner only when the request calls for {owner_name}'s access; when someone else prompted this turn, those calls wait for {owner_name}'s approval. Public web lookups need no account selection. A bot or system event with no authenticated acting user has no requester account. If the selected account lacks a connection, offer the connect action returned by the tool; never silently switch accounts. Do not repeat private information from another person's earlier tool results. If a call is declined or not approved, say so and do not try another way to perform it. Existing email/calendar draft confirmations still apply."))])
        .attribute("owner", &owner.name).attribute("owner_id", &owner.id)
}
fn current_time(time: &CurrentTime) -> XmlNode {
    let today: String = time.iso.chars().take(10).collect();
    let zone = time.time_zone.as_ref().map_or_else(
        || "in UTC, because the time zone of the user is unknown (no connected calendar)".into(),
        |zone| format!("in {zone}, the time zone of the primary calendar of the user"),
    );
    el("current_time", vec![text(&time.local), note(format!("The time this prompt was sent, {zone}. Today is the date above; resolve today, yesterday, this week and other relative dates from it, never from a guess or a web search. A date chip for a whole day takes the local calendar date alone as its date, {today} for today; a chip with a clock time takes a full ISO timestamp with this UTC offset."))])
        .attribute("iso", &time.iso).attribute("time_zone", time.time_zone.as_deref().unwrap_or("UTC"))
}
/// Prefix a prompt with a private context node; reserved authored tags remain literal text.
pub fn compose_agent_context_prompt(input: &Value, context: &DocumentContext) -> Result<String> {
    let prompt: Prompt = serde_json::from_value(input.clone())?;
    if prompt.trigger.is_some() {
        let legacy: Vec<_> = [
            "parent",
            "anchor",
            "replyTarget",
            "promptMessageId",
            "thread",
            "channel",
        ]
        .into_iter()
        .filter(|field| input.get(*field).is_some())
        .collect();
        if !legacy.is_empty() {
            return Err(Error::InvalidArgument(
                format!(
                    "trigger cannot be combined with legacy conversation fields: {}",
                    legacy.join(", ")
                )
                .into(),
            ));
        }
    }
    let escaped = crate::escape_agent_context_tags(&prompt.prompt_markdown);
    let mut editor = crate::markdown::editor_from_markdown(&escaped, context)?;
    let mut sections = Vec::new();
    if let Some(instructions) = prompt
        .instructions
        .as_deref()
        .map(js_trim)
        .filter(|value| !value.is_empty())
    {
        sections.push(
            build_xml(&[el("instructions", vec![text(instructions)])])
                .trim_start()
                .to_owned(),
        );
    }
    let mut nodes = Vec::new();
    if let Some(owner) = &prompt.owner {
        nodes.push(session(owner, prompt.sender.as_ref()));
    }
    if let Some(time) = &prompt.current_time {
        nodes.push(current_time(time));
    }
    if let Some(trigger) = &prompt.trigger {
        nodes.push(trigger::render(trigger)?);
    } else if let Some(conversation) = conversation(&prompt)? {
        nodes.push(conversation);
    }
    if !nodes.is_empty() {
        sections.push(build_xml(&nodes).trim_start().to_owned());
    }
    editor.update(|tx| {
        if !sections.is_empty() {
            let node = tx.create(AgentContextNode {
                text: sections.join("\n"),
            })?;
            if let Some(first) = tx.first_child(NodeKey::ROOT) {
                tx.insert_before(first, node, true)?;
            } else {
                tx.append(NodeKey::ROOT, &[node.key()])?;
            }
        }
        Ok(())
    })?;
    let transformers = crate::transformers::transformers("all", &context.markdown_options())?;
    crate::markdown::convert_to_markdown_string(
        editor.state(),
        &transformers,
        None,
        &lexical_markdown::MarkdownOptions {
            list_indent: 2,
            ..Default::default()
        },
    )
}
