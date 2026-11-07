//! Low-cardinality route templates for Graph request telemetry.

#[cfg(test)]
mod test;

/// Graph path words kept in a template. Every other segment is an id or a
/// user-chosen name, such as a category, and becomes `{id}`.
const GRAPH_PATH_WORDS: &[&str] = &[
    "$value",
    "accept",
    "archive",
    "attachments",
    "calendarView",
    "calendars",
    "cancel",
    "childFolders",
    "contactFolders",
    "contacts",
    "copy",
    "createForward",
    "createReply",
    "createReplyAll",
    "createUploadSession",
    "decline",
    "deleteditems",
    "delta",
    "drafts",
    "events",
    "forward",
    "inbox",
    "instances",
    "junkemail",
    "mailFolders",
    "mailboxSettings",
    "masterCategories",
    "me",
    "messageRules",
    "messages",
    "move",
    "msgfolderroot",
    "outbox",
    "outlook",
    "photo",
    "send",
    "sentitems",
    "subscriptions",
    "tentativelyAccept",
    "users",
];

/// The request path relative to the API root, with ids replaced by `{id}`.
/// OData key segments (`mailFolders('…')`, used by delta links) become the
/// same `mailFolders/{id}` as the path form.
pub(super) fn url_template(api_root: &str, path: &str) -> String {
    let relative = path
        .strip_prefix(api_root.trim_end_matches('/'))
        .unwrap_or(path);
    let mut template = String::new();
    for segment in relative.split('/').filter(|segment| !segment.is_empty()) {
        match segment.split_once('(') {
            Some((name, _key)) => {
                push_segment(&mut template, name);
                template.push_str("/{id}");
            }
            None => push_segment(&mut template, segment),
        }
    }
    if template.is_empty() {
        template.push('/');
    }
    template
}

fn push_segment(template: &mut String, segment: &str) {
    template.push('/');
    if GRAPH_PATH_WORDS.contains(&segment) {
        template.push_str(segment);
    } else {
        template.push_str("{id}");
    }
}
