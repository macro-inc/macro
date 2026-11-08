//! Task, document and call snapshots retain their source field and child order.
use super::*;
pub(super) fn task(source: &Value) -> XmlNode {
    let mut children = Vec::new();
    if let Some(project) = source.get("project") {
        children.push(attrs(
            el("project", vec![]),
            project,
            &[("id", "id"), ("name", "name")],
        ));
    }
    if !array(source, "assignees").is_empty() {
        children.push(el(
            "assignees",
            array(source, "assignees")
                .iter()
                .map(|p| person("assignee", p))
                .collect(),
        ));
    }
    let description = readable(source, "markdown");
    if !js_trim(&description).is_empty() {
        children.push(el("description", vec![text(description)]));
    }
    attrs(
        el("task", children),
        source,
        &[
            ("id", "id"),
            ("title", "title"),
            ("status", "status"),
            ("priority", "priority"),
            ("due", "due"),
        ],
    )
}
pub(super) fn document(source: &Value) -> XmlNode {
    let children = if source.get("text").is_some() {
        vec![text(readable(source, "text"))]
    } else {
        vec![]
    };
    attrs(
        el("document", children),
        source,
        &[("id", "id"), ("name", "name"), ("file_type", "file_type")],
    )
}
pub(super) fn call(source: &Value, started: bool) -> XmlNode {
    let mut children = Vec::new();
    if started {
        children.push(person("started_by", &source["started_by"]));
    }
    children.push(el(
        "participants",
        array(source, "participants")
            .iter()
            .map(|p| person("participant", p))
            .collect(),
    ));
    if !started {
        if let Some(summary) = string(source, "summary") {
            children.push(el("summary", vec![text(summary)]));
        }
        let lines = array(source, "transcript");
        let omitted = source["transcript_omitted"] == true;
        let mut transcript = vec![note(if lines.is_empty() && !omitted {
            "Nothing was transcribed."
        } else {
            "Speakers are named by audio track, so people sharing a device share a speaker."
        })];
        transcript.extend(lines.iter().map(|line| {
            attrs(
                el("line", vec![text(string(line, "text").unwrap_or(""))]),
                line,
                &[("speaker", "speaker"), ("at", "at")],
            )
        }));
        if omitted {
            transcript.push(note("The rest of the transcript is not shown. ReadCallRecord with this call id returns all of it."));
        }
        let transcript = el("transcript", transcript);
        children.push(if omitted {
            transcript.attribute("omitted", "true")
        } else {
            transcript
        });
    }
    attrs(
        el("call", children),
        source,
        if started {
            &[
                ("id", "id"),
                ("title", "title"),
                ("channel", "channel_name"),
                ("channel_id", "channel_id"),
                ("started_at", "started_at"),
            ]
        } else {
            &[
                ("id", "id"),
                ("title", "title"),
                ("channel", "channel_name"),
                ("channel_id", "channel_id"),
                ("started_at", "started_at"),
                ("ended_at", "ended_at"),
            ]
        },
    )
}
