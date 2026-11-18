//! Routine trigger and firing renderers share discussion and snapshot projections.
use super::*;
fn join(source: &Value, key: &str) -> String {
    array(source, key)
        .iter()
        .map(lexical_model::js_string)
        .collect::<Vec<_>>()
        .join(", ")
}
fn event(source: &Value) -> Result<Vec<XmlNode>> {
    Ok(match string(source, "event").unwrap_or("") {
        "document_created" | "document_updated" => vec![snapshots::document(&source["document"])],
        "document_deleted" => vec![attrs(
            el("document", vec![]),
            source,
            &[("id", "id"), ("name", "name")],
        )],
        "task_created" => vec![snapshots::task(&source["task"])],
        "task_status_changed" => vec![
            attrs(
                attrs(
                    el("change", vec![]).attribute("property", "status"),
                    &source["task"],
                    &[("to", "status")],
                ),
                &source["pull_request"],
                &[("pull_request", "url"), ("by", "github_login")],
            ),
            snapshots::task(&source["task"]),
        ],
        "task_priority_changed" => vec![
            attrs(
                el("change", vec![]).attribute("property", "priority"),
                &source["task"],
                &[("to", "priority")],
            ),
            snapshots::task(&source["task"]),
        ],
        "task_property_changed" => vec![
            el(
                "change",
                vec![note(
                    "One of the task's properties changed; which one is not recorded.",
                )],
            ),
            snapshots::task(&source["task"]),
        ],
        "email_received" => {
            let email = &source["email"];
            let node = attrs(
                el(
                    "email",
                    vec![el("body", vec![text(string(email, "body").unwrap_or(""))])],
                ),
                email,
                &[
                    ("thread", "thread_id"),
                    ("subject", "subject"),
                    ("from", "from"),
                ],
            )
            .attribute("to", join(email, "to"));
            vec![attrs(node, email, &[("received_at", "received_at")])]
        }
        "channel_created" => vec![attrs(
            el("channel", vec![]),
            source,
            &[("id", "id"), ("name", "name")],
        )],
        "channel_message_posted" | "channel_mentioned" | "channel_message_patched" => {
            vec![discussion(
                &source["discussion"],
                "fired_routine",
                "triggering message",
                false,
                None,
            )?]
        }
        "channel_message_attachment_created" => vec![
            attrs(
                el("attachment", vec![]),
                source,
                &[("entity_type", "entity_type"), ("entity_id", "entity_id")],
            ),
            discussion(
                &source["discussion"],
                "fired_routine",
                "triggering message",
                false,
                None,
            )?,
        ],
        "call_started" => vec![snapshots::call(&source["call"], true)],
        "call_ended" => vec![snapshots::call(&source["call"], false)],
        "github" => {
            let delivery = &source["delivery"];
            let child = delivery.get("payload").map_or_else(
                || note("The payload was too large to carry; read the details from GitHub."),
                |payload| {
                    el(
                        "payload",
                        vec![text(lexical_model::to_js_json_string(payload))],
                    )
                },
            );
            vec![attrs(
                el("github", vec![child]),
                delivery,
                &[
                    ("event", "event"),
                    ("action", "action"),
                    ("repository", "repository"),
                    ("sender", "sender"),
                ],
            )]
        }
        _ => return Err(Error::InvalidArgument("unknown routine event".into())),
    })
}
fn trigger(source: &Value) -> Result<XmlNode> {
    Ok(match string(source, "type").unwrap_or("") {
        "schedule" => attrs(
            el("schedule", vec![]),
            source,
            &[("cron", "cron"), ("timezone", "timezone")],
        ),
        "once" => attrs(el("once", vec![]), source, &[("at", "at")]),
        "events" => {
            let mut children = Vec::new();
            if let Some(github) = source.get("github") {
                let mut node = el("github", vec![]);
                for field in ["events", "actions", "repositories"] {
                    if github.get(field).is_some() {
                        node = node.attribute(field, join(github, field));
                    }
                }
                children.push(node.attribute(
                    "bots",
                    if github["include_bots"] == true {
                        "included"
                    } else {
                        "ignored"
                    },
                ));
            }
            children.extend(
                array(source, "payload_match")
                    .iter()
                    .map(|test| el("match", vec![text(lexical_model::js_string(test))])),
            );
            if let Some(condition) = string(source, "condition") {
                children.push(el("condition", vec![text(condition)]));
            }
            let node = el("events", children).attribute("names", join(source, "events"));
            if source.get("entity_ids").is_some() {
                node.attribute("only", join(source, "entity_ids"))
            } else {
                node
            }
        }
        _ => return Err(Error::InvalidArgument("unknown routine trigger".into())),
    })
}
pub(super) fn render(source: &Value) -> Result<XmlNode> {
    let name = string(source, "name").unwrap_or("");
    let owner = string(&source["owner"], "name").unwrap_or("");
    let routine = person_attrs(
        attrs(
            el("routine", vec![]),
            source,
            &[("id", "routine_id"), ("name", "name")],
        ),
        &source["owner"],
        "owner",
    );
    let triggers = array(source, "triggers")
        .iter()
        .map(trigger)
        .collect::<Result<Vec<_>>>()?;
    let mut children = vec![
        note(format!(
            "The routine {name}, owned by {owner}, fired. The prompt is what the routine asks you to do."
        )),
        routine,
        el(
            "instructions",
            vec![text(string(source, "instructions").unwrap_or(""))],
        ),
        el("triggers", triggers),
    ];
    let firing = &source["firing"];
    match string(firing, "type").unwrap_or("") {
        "scheduled" => children.push(attrs(
            el(
                "scheduled",
                vec![note("The routine ran because its schedule came due.")],
            ),
            firing,
            &[("for", "scheduled_for"), ("schedule", "schedule")],
        )),
        "manual" => children.push(attrs(
            el(
                "manual",
                vec![note("The routine's owner started this run by hand.")],
            ),
            firing,
            &[("requested_at", "requested_at")],
        )),
        "event" => {
            children.push(
                el("event", event(&firing["event"])?)
                    .attribute("type", string(&firing["event"], "event").unwrap_or("")),
            );
            if !array(firing, "conditions").is_empty() {
                let mut conditions = vec![note("The event answered yes to at least one of these.")];
                conditions.extend(
                    array(firing, "conditions")
                        .iter()
                        .map(|value| el("condition", vec![text(lexical_model::js_string(value))])),
                );
                children.push(el("conditions", conditions));
            }
        }
        _ => return Err(Error::InvalidArgument("unknown routine firing".into())),
    }
    Ok(el("trigger", children).attribute("kind", "routine"))
}
