//! Trigger rendering shared by typed server calls and strict source-wire replay.
use super::*;
mod routine;
mod snapshots;
fn array<'a>(value: &'a Value, field: &str) -> &'a [Value] {
    value
        .get(field)
        .and_then(Value::as_array)
        .map_or(&[], Vec::as_slice)
}
fn person(tag: &str, source: &Value) -> XmlNode {
    attrs(
        el(tag, vec![]),
        source,
        &[("name", "name"), ("email", "email"), ("id", "id")],
    )
}
fn person_attrs(mut node: XmlNode, source: &Value, prefix: &str) -> XmlNode {
    for (name, field) in [
        (prefix.to_owned(), "name"),
        (format!("{prefix}_email"), "email"),
        (format!("{prefix}_id"), "id"),
    ] {
        if let Some(value) = string(source, field) {
            node = node.attribute(name, value);
        }
    }
    node
}
fn readable(source: &Value, field: &str) -> String {
    crate::parsers::markdown_to_embedding_text(string(source, field).unwrap_or(""))
}
fn message(source: &Value, marker: &str, id: &str) -> XmlNode {
    let mut children = vec![text(readable(source, "content"))];
    children.extend(array(source, "attachments").iter().map(|a| {
        attrs(
            el("attachment", vec![]),
            a,
            &[("type", "entity_type"), ("id", "entity_id"), ("url", "url")],
        )
    }));
    let mut node = attrs(el("message", children), source, &[("id", "id")]);
    node = person_attrs(node, &source["author"], "author");
    node = attrs(node, source, &[("at", "posted_at")]);
    if string(source, "id") == Some(id) {
        node = node.attribute(marker, "true");
    }
    node
}
fn thread(source: &Value, marker: &str, id: &str) -> XmlNode {
    let mut children = Vec::new();
    if source["messages_omitted"] == true {
        children.push(note("Some messages of this thread are not shown."));
    }
    children.extend(
        array(source, "messages")
            .iter()
            .map(|m| message(m, marker, id)),
    );
    let node = attrs(el("thread", children), source, &[("root", "root_id")]);
    if source["messages_omitted"] == true {
        node.attribute("messages_omitted", "true")
    } else {
        node
    }
}
fn anchor(source: &Value) -> Result<XmlNode> {
    let ty = string(source, "type").unwrap_or("");
    Ok(match ty {
        "spreadsheet" => attrs(el("anchor",vec![note("Use ReadSpreadsheet to read the live cells in this range.")]).attribute("type",ty),source,&[("sheet_id","sheet_id"),("sheet_name","sheet_name"),("range","range")]),
        "pdf_pin" => attrs(el("anchor",vec![note("The comment is pinned to a point on a PDF page rather than to text, so it covers no words.")]).attribute("type",ty),source,&[("pin","anchor_id")]),
        "pdf_highlight" => attrs(el("anchor",vec![source.get("marked_text").map_or_else(||note("The PDF highlight carries no text, so which words it covers is not known."),|value|el("marked_text",vec![text(lexical_model::js_string(value))]))]).attribute("type",ty),source,&[("highlight","anchor_id")]),
        "mark" => {
            let mut children = Vec::new();
            if let Some(current) = source.get("current").filter(|value|!value.is_null()) {
                children.push(note("marked_text is what the mark covers in the document now and surrounding_text the passage around it."));
                children.push(el("marked_text",vec![text(string(current,"marked_text").unwrap_or(""))]));
                children.push(el("surrounding_text",vec![text(string(current,"surrounding_text").unwrap_or(""))]));
                if let Some(old) = string(source,"marked_text").filter(|old|Some(*old)!=string(current,"marked_text")) { children.push(el("marked_text_when_posted",vec![text(old)])); }
            } else if let Some(old) = string(source,"marked_text") {
                children.push(note("marked_text_when_posted is what the mark covered when the comment was posted; the document may have changed since."));
                children.push(el("marked_text_when_posted",vec![text(old)]));
            }
            attrs(el("anchor",children).attribute("type",ty),source,&[("mark","mark_id")])
        }
        _ => return Err(Error::InvalidArgument("unknown comment anchor".into())),
    })
}
fn surface(source: &Value) -> Result<(XmlNode, &'static str)> {
    let (tag, description) = match string(source, "type") {
        Some("channel") => ("channel", "a channel thread"),
        Some("document_comment") => ("document", "a document comment thread"),
        Some("project_comment") => ("project", "a project comment thread"),
        Some("crm_company_comment") => ("crm_company", "a CRM company comment thread"),
        Some("crm_contact_comment") => ("crm_contact", "a CRM contact comment thread"),
        Some("call_chat") => ("call", "a call chat thread"),
        _ => return Err(Error::InvalidArgument("unknown discussion surface".into())),
    };
    let mut children = Vec::new();
    if tag == "document"
        && let Some(value) = source.get("anchor").filter(|value| !value.is_null())
    {
        children.push(anchor(value)?);
    }
    let node = attrs(
        el(tag, children),
        source,
        if tag == "call" {
            &[("id", "id"), ("title", "title")]
        } else {
            &[("id", "id"), ("name", "name")]
        },
    );
    Ok((
        if tag == "channel" {
            attrs(node, source, &[("type", "channel_type")])
        } else {
            node
        },
        description,
    ))
}
fn has_attachments(discussion: &Value) -> bool {
    !array(&discussion["reply_target"]["message"], "attachments").is_empty()
        || array(&discussion["thread"], "messages")
            .iter()
            .any(|m| !array(m, "attachments").is_empty())
        || array(discussion, "channel").iter().any(|t| {
            array(t, "messages")
                .iter()
                .any(|m| !array(m, "attachments").is_empty())
        })
}
fn discussion(
    source: &Value,
    marker: &str,
    subject: &str,
    replies_here: bool,
    origin: Option<&str>,
) -> Result<XmlNode> {
    let (surface, description) = surface(&source["surface"])?;
    let mut children = vec![surface];
    if replies_here {
        children.push(el("origin",vec![text(origin.map(str::to_owned).unwrap_or_else(||format!("This {subject} was posted in {description}, not the agent session view. Your reply is posted back into that thread, and it is where the user will answer anything you ask.")))]));
    }
    children.push(person("sender", &source["sender"]));
    if let Some(request) = source.get("agent_request") {
        children.push(
            el(
                "agent_request",
                vec![person("on_behalf_of", &request["on_behalf_of"])],
            )
            .attribute("hops", lexical_model::js_string(&request["hops"])),
        );
    }
    let id = string(source, "prompt_message_id").unwrap_or("");
    let target = &source["reply_target"];
    children.push(match string(target,"kind") {
        Some("quote") => {
            let body = target.get("message").filter(|v|!v.is_null()).map_or_else(||el("preview",vec![text(readable(target,"preview"))]),|m|message(m,marker,id));
            attrs(el("reply_target",vec![note(format!("The {subject} quote-replies to this message. It is what the {subject} is about.")),body]).attribute("kind","quote"),target,&[("message","message_id"),("thread","thread_id")])
        }
        Some("thread") => attrs(el("reply_target",vec![note(format!("The {subject} was posted as a reply in the thread below. It is about that thread."))]).attribute("kind","thread"),target,&[("thread","root_id")]),
        Some("none") => el("reply_target",vec![note(format!("The {subject} was posted at the top level of the channel and replies to no particular message."))]).attribute("kind","none"),
        _ => return Err(Error::InvalidArgument("unknown reply target kind".into())),
    });
    if has_attachments(source) {
        children.push(note(
            "Attachments are listed on each message and can be fetched by their url.",
        ));
    }
    let own_thread = source.get("thread").filter(|value| !value.is_null());
    if let Some(value) = own_thread {
        children.push(thread(value, marker, id));
    }
    if !array(source, "channel").is_empty() {
        let mut channel = vec![note(if own_thread.is_some() {
            format!(
                "Other recent messages in this channel, outside the thread above, oldest first. Background only: they are not what the {subject} is about."
            )
        } else {
            "Recent messages in this channel, grouped by thread, oldest first.".into()
        })];
        channel.extend(array(source, "channel").iter().map(|value| {
            let messages = array(value, "messages");
            if value["messages_omitted"] == false
                && messages.len() == 1
                && messages
                    .first()
                    .is_some_and(|m| m["id"] == value["root_id"])
            {
                message(messages.first().unwrap_or(&Value::Null), marker, id)
            } else {
                thread(value, marker, id)
            }
        }));
        children.push(el(
            if own_thread.is_some() {
                "channel_background"
            } else {
                "channel_recent"
            },
            channel,
        ));
    }
    Ok(el("discussion", children))
}
fn agent_request(source: &Value) -> String {
    source.get("agent_request").map_or_else(String::new,|request| {
        let name = string(&request["on_behalf_of"],"name").unwrap_or("");
        format!(" {} is another agent asking on behalf of {name}; {name} did not write this message. Address your reply to {} in the discussion, where {name} can read it too.",string(&source["sender"],"name").unwrap_or(""),string(&source["sender"],"name").unwrap_or(""))
    })
}
pub(super) fn render(source: &Value) -> Result<XmlNode> {
    let kind = string(source, "kind")
        .ok_or_else(|| Error::InvalidArgument("missing trigger kind".into()))?;
    let sender = string(&source["sender"], "name").unwrap_or("");
    match kind {
        "mentioned" => Ok(el("trigger",vec![note(format!("{sender} mentioned you, and that mention opened this session. Their message is the prompt.{}",agent_request(source))),discussion(source,"mentioned_you","prompt",true,None)?]).attribute("kind",kind)),
        "conversation" => Ok(el("trigger",vec![note(format!("{sender} wrote to you in your private conversation with them. Their message is the prompt; the conversation before it is this session's history.")),discussion(source,"wrote_to_you","prompt",true,Some("This prompt was posted in your private conversation with the user, not the agent session view. They read it as you work: your reply is posted there, and a question you ask with AskUser or a draft you open for review appears there for them to answer."))?]).attribute("kind",kind)),
        "follow_up" => {
            let d = &source["discussion"]; let name = string(&d["sender"],"name").unwrap_or("");
            let addressed = string(source,"addressed_by").unwrap_or("");
            let (marker,explanation) = match addressed { "mention" => ("mentioned_you","It mentions you."), "explicit_reply" => ("replied_to_you","It quote-replies to one of your messages without mentioning you."), "inferred" => ("addressed_to_you","It neither mentions you nor quote-replies to you: a model judged from the discussion that it was meant for you. That judgment can be wrong, so if the message reads as meant for someone else, say so briefly instead of acting on it."), _ => return Err(Error::InvalidArgument("unknown follow-up address".into())) };
            Ok(el("trigger",vec![note(format!("This session was already running when {name} posted this message in its discussion. {explanation} The message is the prompt.{}",agent_request(d))),discussion(d,marker,"prompt",true,None)?]).attribute("kind",kind).attribute("addressed_by",addressed))
        }
        "task_assigned" => {
            let name = string(&source["assigned_by"],"name").unwrap_or("");
            let assigned = attrs(person_attrs(el("assigned",vec![]),&source["assigned_by"],"by"),source,&[("at","assigned_at")]);
            Ok(attrs(el("trigger",vec![note(format!("{name} assigned you this task. Your replies are posted to your own discussion on the task, where {name} and others on the task read them.")),assigned,snapshots::task(&source["task"])]).attribute("kind",kind),source,&[("discussion","discussion_id")]))
        }
        "requested" => {
            let name = string(&source["requested_by"],"name").unwrap_or("");
            let request = attrs(person_attrs(el("requested",vec![]),&source["requested_by"],"by"),source,&[("at","requested_at"),("repo","repo_url")]);
            Ok(el("trigger",vec![note(format!("{name} opened this session from the composer. Their prompt follows.")),request]).attribute("kind",kind))
        }
        "dispatched" => {
            let name = string(&source["dispatched_by"],"name").unwrap_or("");
            let request = attrs(person_attrs(el("dispatched",vec![]),&source["dispatched_by"],"by"),source,&[("at","dispatched_at"),("from_bot","from_bot"),("from_session","from_session"),("repo","repo_url")]);
            Ok(el("trigger",vec![note(format!("Another agent handed you this task on behalf of {name}. The prompt is the task it handed over.")),request]).attribute("kind",kind))
        }
        "routine" => routine::render(source),
        _ => Err(Error::InvalidArgument("unknown trigger kind".into())),
    }
}
