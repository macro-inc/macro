//! Discussion-shaped trigger context, kept separate from the legacy wire names.
use super::*;
fn person(tag: &str, source: &Value) -> XmlNode {
    attrs(
        el(tag, vec![]),
        source,
        &[("name", "name"), ("email", "email"), ("id", "id")],
    )
}
fn message(source: &Value, marker: &str, id: &str) -> XmlNode {
    let mut children = vec![text(crate::parsers::markdown_to_embedding_text(
        string(source, "content").unwrap_or(""),
    ))];
    if let Some(attachments) = source.get("attachments").and_then(Value::as_array) {
        children.extend(attachments.iter().map(|attachment| {
            attrs(
                el("attachment", vec![]),
                attachment,
                &[("type", "entity_type"), ("id", "entity_id"), ("url", "url")],
            )
        }));
    }
    let mut node = attrs(el("message", children), source, &[("id", "id")]);
    if let Some(author) = source.get("author") {
        node = attrs(
            node,
            author,
            &[
                ("author", "name"),
                ("author_email", "email"),
                ("author_id", "id"),
            ],
        );
    }
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
    if let Some(messages) = source["messages"].as_array() {
        children.extend(messages.iter().map(|source| message(source, marker, id)));
    }
    let mut node = attrs(el("thread", children), source, &[("root", "root_id")]);
    if source["messages_omitted"] == true {
        node = node.attribute("messages_omitted", "true");
    }
    node
}
pub(super) fn render(source: &Value) -> Result<XmlNode> {
    let kind = string(source, "kind")
        .ok_or_else(|| Error::InvalidArgument("missing trigger kind".into()))?;
    if kind != "conversation" {
        return Err(Error::InvalidArgument(
            "trigger context kind is not implemented".into(),
        ));
    }
    let surface = &source["surface"];
    let surface_node = match string(surface, "type") {
        Some("channel") => attrs(
            el("channel", vec![]),
            surface,
            &[("id", "id"), ("name", "name"), ("type", "channel_type")],
        ),
        Some("document_comment") => attrs(
            el("document", vec![]),
            surface,
            &[("id", "id"), ("name", "name")],
        ),
        Some("project_comment") => attrs(
            el("project", vec![]),
            surface,
            &[("id", "id"), ("name", "name")],
        ),
        Some("crm_company_comment") => attrs(
            el("crm_company", vec![]),
            surface,
            &[("id", "id"), ("name", "name")],
        ),
        Some("crm_contact_comment") => attrs(
            el("crm_contact", vec![]),
            surface,
            &[("id", "id"), ("name", "name")],
        ),
        Some("call_chat") => attrs(
            el("call", vec![]),
            surface,
            &[("id", "id"), ("title", "title")],
        ),
        _ => return Err(Error::InvalidArgument("unknown discussion surface".into())),
    };
    let mut discussion = vec![
        surface_node,
        el(
            "origin",
            vec![text(
                "This prompt was posted in your private conversation with the user, not the agent session view. They read it as you work: your reply is posted there, and a question you ask with AskUser or a draft you open for review appears there for them to answer.",
            )],
        ),
        person("sender", &source["sender"]),
    ];
    if let Some(request) = source.get("agent_request") {
        discussion.push(
            el(
                "agent_request",
                vec![person("on_behalf_of", &request["on_behalf_of"])],
            )
            .attribute("hops", lexical_model::js_string(&request["hops"])),
        );
    }
    let target = &source["reply_target"];
    let id = string(source, "prompt_message_id").unwrap_or("");
    let marker = "wrote_to_you";
    let target = match string(target, "kind") {
        Some("quote") => {
            let body = target.get("message").map_or_else(|| el("preview", vec![text(crate::parsers::markdown_to_embedding_text(string(target, "preview").unwrap_or("")))]), |source| message(source, marker, id));
            attrs(el("reply_target", vec![note("The prompt quote-replies to this message. It is what the prompt is about."), body]).attribute("kind", "quote"), target, &[("message", "message_id"), ("thread", "thread_id")])
        }
        Some("thread") => attrs(el("reply_target", vec![note("The prompt was posted as a reply in the thread below. It is about that thread.")]).attribute("kind", "thread"), target, &[("thread", "root_id")]),
        Some("none") => el("reply_target", vec![note("The prompt was posted at the top level of the channel and replies to no particular message.")]).attribute("kind", "none"),
        _ => return Err(Error::InvalidArgument("unknown reply target kind".into())),
    };
    discussion.push(target);
    if let Some(source) = source.get("thread") {
        discussion.push(thread(source, marker, id));
    }
    if let Some(channel) = source
        .get("channel")
        .and_then(Value::as_array)
        .filter(|channel| !channel.is_empty())
    {
        let beside = source.get("thread").is_some();
        let mut children = vec![note(if beside {
            "Other recent messages in this channel, outside the thread above, oldest first. Background only: they are not what the prompt is about."
        } else {
            "Recent messages in this channel, grouped by thread, oldest first."
        })];
        for source in channel {
            let messages = source["messages"].as_array();
            children.push(
                if source["messages_omitted"] == false
                    && messages.is_some_and(|messages| {
                        messages.len() == 1 && messages[0]["id"] == source["root_id"]
                    })
                {
                    message(&source["messages"][0], marker, id)
                } else {
                    thread(source, marker, id)
                },
            );
        }
        discussion.push(el(
            if beside {
                "channel_background"
            } else {
                "channel_recent"
            },
            children,
        ));
    }
    Ok(el("trigger", vec![note(format!("{} wrote to you in your private conversation with them. Their message is the prompt; the conversation before it is this session's history.", string(&source["sender"], "name").unwrap_or(""))), el("discussion", discussion)]).attribute("kind", kind))
}
