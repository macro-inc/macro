//! Exact class export callbacks; DOM ordering is owned by lexical_html.
use super::*;
use crate::nodes::*;
use lexical_html::nodes::*;
use serde_json::{Map, Value};

fn field(data: &Map<String, Value>, key: &str) -> String {
    data.get(key)
        .map_or_else(|| "undefined".into(), lexical_model::js_string)
}
fn dom_field(data: &Map<String, Value>, key: &str) -> String {
    data.get(key)
        .map_or_else(String::new, lexical_model::js_string)
}
fn dom_text(data: &Map<String, Value>, key: &str) -> String {
    data.get(key)
        .filter(|v| !v.is_null())
        .map_or_else(String::new, lexical_model::js_string)
}
fn attrs(
    element: &mut HtmlElement,
    data: &Map<String, Value>,
    fields: &[(&str, &str)],
    strict: bool,
) -> lexical_html::Result<()> {
    for (attribute, key) in fields {
        if strict {
            if *key == "mentionUuid" {
                element.set_attribute(
                    attribute,
                    data.get(*key)
                        .filter(|v| lexical_model::js_truthy(v))
                        .map_or_else(String::new, lexical_model::js_string),
                );
                continue;
            }
            let value = data.get(*key).filter(|value| !value.is_null()).ok_or(
                lexical_html::Error::InvalidExport("undefined or null data attribute toString"),
            )?;
            element.set_attribute(attribute, lexical_model::js_string(value));
        } else if let Some(value) = data
            .get(*key)
            .filter(|value| lexical_model::js_truthy(value))
        {
            element.set_attribute(
                attribute,
                if value.is_object() || value.is_array() {
                    lexical_model::to_js_json_string(value)
                } else {
                    lexical_model::js_string(value)
                },
            );
        }
    }
    Ok(())
}
fn truthy(data: &Map<String, Value>, key: &str) -> bool {
    data.get(key).is_some_and(lexical_model::js_truthy)
}
pub(super) fn export<'a>(
    ctx: &ExportCtx<'a>,
    key: NodeKey,
) -> lexical_html::Result<DomExportOutput<'a>> {
    let view = ctx.state.view();
    let ty = view.type_name(key)?;
    if let Some(node) = view.get::<CustomCodeNode>(key) {
        return node.code.export_dom(ctx, key);
    }
    if let Some(node) = view.get::<TaskListNode>(key) {
        return node.list.export_dom(ctx, key);
    }
    if matches!(ty, "agent-context" | "await" | "completion") {
        return Ok(DomExportOutput::skip());
    }
    if ty == "comment-mark" && view.get::<CommentNode>(key).is_some_and(|n| n.ids_missing) {
        return Err(lexical_html::Error::InvalidExport("undefined comment ids"));
    }
    if matches!(ty, "comment-mark" | "search-match") {
        return Ok(DomExportOutput::node(HtmlNode::Fragment(vec![])));
    }
    let mut data = view.export_json(key)?;
    if ty == "document-card"
        && !data
            .get("previewData")
            .is_some_and(lexical_model::js_truthy)
    {
        data.insert("previewData".into(), serde_json::json!({}));
    }
    if matches!(ty, "unlinked-text" | "inline-search" | "diff-text") {
        let mut element = text_create_dom(ctx, key)?;
        if ty == "inline-search" {
            element.set_class_name(ctx.theme.inline_search.as_deref().unwrap_or("undefined"));
        }
        if ty == "diff-text" {
            element.class_list_add([format!("diff-{}", field(&data, "diffStatus")).as_str()]);
            element.set_attribute("data-diff-status", dom_field(&data, "diffStatus"));
            attrs(
                &mut element,
                &data,
                &[("data-diff-author", "author")],
                false,
            )?;
        }
        return Ok(DomExportOutput::node(text_export_dom(ctx, key, element)?));
    }
    if matches!(ty, "image" | "video") {
        return media(ctx, key, ty, &data);
    }
    let tag = match ty {
        "horizontalrule" => "hr",
        "classed-block" => data.get("tag").and_then(Value::as_str).unwrap_or("div"),
        "database-query" if data.get("displayMode").and_then(Value::as_str) == Some("scalar") => {
            "span"
        }
        "equation" if data.get("inline") == Some(&Value::Bool(false)) => "div",
        "agent-activity"
        | "system-notification"
        | "database-query"
        | "diff"
        | "diff-delete"
        | "diff-insert"
        | "document-card"
        | "html-render"
        | "magic-chip"
        | "paste"
        | "reply-target"
        | "unknown-mention" => "div",
        "agent-session-mention" if truthy(&data, "expanded") => "div",
        _ => "span",
    };
    let mut element = HtmlElement::new(tag);
    match ty {
        "account-manager-request" => {
            element.set_attribute("data-account-manager-request", dom_field(&data, "grantId"));
            element.set_text_content("Account manager request");
        }
        "agent-activity" => {
            element.set_attribute("data-agent-activity", dom_field(&data, "agentSessionId"));
            let rows = data.get("rows").and_then(Value::as_array).ok_or(
                lexical_html::Error::InvalidExport("activity rows must be an array"),
            )?;
            element.set_text_content(&agent_activity_text(rows));
        }
        "agent-session-mention" => {
            element.set_attribute("data-agent-session-mention", "true");
            attrs(
                &mut element,
                &data,
                &[
                    ("data-agent-session-id", "id"),
                    ("data-agent-session-label", "label"),
                    ("data-mention-uuid", "mentionUuid"),
                    ("data-agent-session-expanded", "expanded"),
                ],
                false,
            )?;
            element.set_text_content(
                data.get("label")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                    .unwrap_or("Agent session"),
            );
        }
        "booking-link-mention" => {
            element.set_attribute("data-booking-link-mention", "true");
            attrs(
                &mut element,
                &data,
                &[
                    ("data-booking-profile-id", "profileId"),
                    ("data-booking-slug", "slug"),
                    ("data-booking-label", "label"),
                    ("data-booking-url", "url"),
                ],
                false,
            )?;
            element.set_text_content(&view.text_content(key));
        }
        "classed-block" => {
            element.set_attribute("data-classed-block", "true");
            if let Some(classes) = data.get("classes").and_then(Value::as_array) {
                element.class_list_add(classes.iter().filter_map(Value::as_str));
            }
            if let Some(attrs) = data.get("attributes").and_then(Value::as_object) {
                for (name, value) in attrs {
                    element.set_attribute(name, lexical_model::js_string(value));
                }
            }
        }
        "connect-app" => {
            element.set_attribute("data-connect-app", dom_field(&data, "appSlug"));
            element.set_text_content(&format!("Connect {}", field(&data, "name")));
        }
        "contact-mention" => {
            element.set_attribute("data-contact-mention", "true");
            attrs(
                &mut element,
                &data,
                &[
                    ("data-contact-id", "contactId"),
                    ("data-name", "name"),
                    ("data-email-or-domain", "emailOrDomain"),
                    ("data-is-company", "isCompany"),
                    ("data-mention-uuid", "mentionUuid"),
                ],
                true,
            )?;
            element.set_text_content(&view.text_content(key));
        }
        "system-notification" => {
            element.set_attribute("data-system-notification", field(&data, "source"));
            element.set_text_content(&field(&data, "text"));
        }
        "database-query" => {
            element.set_attribute("data-database-query", "true");
            element.set_text_content(
                ["title", "prompt"]
                    .iter()
                    .find_map(|name| {
                        data.get(*name)
                            .and_then(Value::as_str)
                            .filter(|value| !value.is_empty())
                    })
                    .unwrap_or("Database answer"),
            );
        }
        "date-mention" => {
            element.set_attribute("data-date-mention", "true");
            attrs(
                &mut element,
                &data,
                &[
                    ("data-date", "date"),
                    ("data-display-format", "displayFormat"),
                    ("data-mention-uuid", "mentionUuid"),
                ],
                true,
            )?;
            element.set_text_content(&field(&data, "displayFormat"));
        }
        "diff" | "diff-delete" => {
            element.set_class_name(if ty == "diff" {
                "md-diff"
            } else {
                "md-diff-delete"
            });
            if ty == "diff" {
                element.set_attribute("data-diff-user-id", dom_field(&data, "userId"));
                element.set_attribute("data-diff-label", dom_field(&data, "label"));
            }
            element_export_dom(ctx, key, &mut element)?;
        }
        "diff-insert" | "horizontalrule" => {}
        "document-card" | "document-mention" => {
            element.set_attribute(
                if ty == "document-card" {
                    "data-document-card"
                } else {
                    "data-document-mention"
                },
                "true",
            );
            attrs(
                &mut element,
                &data,
                &[
                    ("data-document-id", "documentId"),
                    ("data-document-name", "documentName"),
                    ("data-block-name", "blockName"),
                    ("data-block-params", "blockParams"),
                ],
                false,
            )?;
            if ty == "document-card" {
                attrs(
                    &mut element,
                    &data,
                    &[
                        ("data-preview-box", "previewBox"),
                        ("data-preview-data", "previewData"),
                    ],
                    false,
                )?;
            }
            attrs(
                &mut element,
                &data,
                &[("data-mention-uuid", "mentionUuid")],
                false,
            )?;
            if ty == "document-mention" {
                attrs(
                    &mut element,
                    &data,
                    &[
                        ("data-channel-type", "channelType"),
                        ("data-created-at", "createdAt"),
                    ],
                    false,
                )?;
                element.set_attribute("data-collapsed", field(&data, "collapsed"));
                element.set_text_content(&dom_text(&data, "documentName"));
            }
        }
        "equation" => {
            let equation = field(&data, "equation");
            element.set_attribute(
                "data-lexical-equation",
                lexical_html::js::btoa_or_utf8(&equation),
            );
            element.set_attribute("data-lexical-inline", field(&data, "inline"));
        }
        "group-mention" => {
            element.set_attribute("data-group-mention", "true");
            attrs(
                &mut element,
                &data,
                &[("data-group-alias", "groupAlias")],
                true,
            )?;
            element.set_text_content(&format!("@{}", field(&data, "groupAlias")));
        }
        "html-render" => {
            element.set_attribute("data-html-render", "true");
            element.set_class_name(if truthy(&data, "adaptColors") {
                "macro_html_render macro_html_render_adapt"
            } else {
                "macro_html_render"
            });
            let mut template = HtmlElement::new("template");
            template.set_attribute("shadowrootmode", "open");
            for node in
                super::fragment::parse_fragment(data.get("html").and_then(Value::as_str).ok_or(
                    lexical_html::Error::InvalidExport("template HTML must be a string"),
                )?)?
            {
                template.append(node);
            }
            element.append(HtmlNode::Element(template));
        }
        "magic-chip" => {
            element.set_attribute("data-magic-chip", dom_field(&data, "agentSessionId"));
            element.set_text_content(&dom_text(&data, "status"));
        }
        "paste" => {
            element.set_attribute("data-paste-node", "true");
            attrs(
                &mut element,
                &data,
                &[("data-content", "content"), ("data-paste-origin", "origin")],
                false,
            )?;
            element.set_text_content(&dom_text(&data, "content"));
        }
        "pr-mention" => {
            element.set_attribute("data-pr-mention", "true");
            attrs(
                &mut element,
                &data,
                &[
                    ("data-pr-id", "id"),
                    ("data-pr-label", "label"),
                    ("data-mention-uuid", "mentionUuid"),
                    ("data-pr-url", "url"),
                ],
                false,
            )?;
            element.set_text_content(
                data.get("label")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                    .unwrap_or("Pull request"),
            );
        }
        "reply-target" => {
            element.set_attribute("data-reply-target-node", field(&data, "targetMessageId"));
            element.set_text_content(&field(&data, "displayText"));
        }
        "snapshot" => {
            element.set_attribute("data-snapshot-node", "true");
            attrs(
                &mut element,
                &data,
                &[
                    ("data-document-id", "documentId"),
                    ("data-document-name", "documentName"),
                    ("data-block-name", "blockName"),
                    ("data-content", "content"),
                    ("data-snapshot-date", "snapshotDate"),
                    ("data-mention-uuid", "mentionUuid"),
                ],
                false,
            )?;
            element.set_text_content(&dom_text(&data, "documentName"));
        }
        "tag-mention" => {
            element.set_attribute("data-tag-mention", "true");
            for (attr, key) in [
                ("data-tag-option-id", "optionId"),
                ("data-tag-property-definition-id", "propertyDefinitionId"),
                ("data-tag-name", "name"),
                ("data-tag-scope", "scope"),
            ] {
                element.set_attribute(attr, dom_field(&data, key));
            }
            attrs(&mut element, &data, &[("data-tag-color", "color")], false)?;
            element.set_text_content(&dom_text(&data, "name"));
        }
        "theme-mention" => {
            element.set_attribute("data-theme-mention", "true");
            element.set_attribute(
                "data-theme-json",
                data.get("data")
                    .map_or_else(String::new, lexical_model::to_js_json_string),
            );
            element.set_text_content(&dom_text(&data, "name"));
        }
        "unknown-mention" => {
            element.set_attribute("data-unknown-mention", "true");
            element.set_attribute("data-name", dom_field(&data, "name"));
        }
        "watermark" => {
            element.set_attribute("data-watermark", "true");
            attrs(&mut element, &data, &[("data-content", "content")], true)?;
            element.set_class_name("macro-watermark-node");
            element.set_text_content(&dom_text(&data, "content"));
        }
        "user-mention" => {
            element.set_attribute("data-user-mention", "true");
            attrs(
                &mut element,
                &data,
                &[
                    ("data-user-id", "userId"),
                    ("data-email", "email"),
                    ("data-display-name", "displayName"),
                    ("data-mention-uuid", "mentionUuid"),
                ],
                true,
            )?;
            element.set_text_content(&view.text_content(key));
        }
        _ => {
            return Err(lexical_html::Error::UnregisteredNodeType {
                type_name: ty.to_owned(),
            });
        }
    }
    Ok(DomExportOutput::element(element))
}
fn media<'a>(
    ctx: &ExportCtx<'a>,
    key: NodeKey,
    ty: &str,
    data: &Map<String, Value>,
) -> lexical_html::Result<DomExportOutput<'a>> {
    let view = ctx.state.view();
    if ["width", "height"]
        .iter()
        .any(|key| data.get(*key).is_some_and(Value::is_null))
        || !["constrainedWidth", "constrainedHeight"]
            .iter()
            .any(|key| data.get(*key).is_some_and(lexical_model::js_truthy))
            && ["width", "height"]
                .iter()
                .any(|key| data.get(*key).is_none_or(Value::is_null))
    {
        return Err(lexical_html::Error::InvalidExport(
            "undefined media dimensions",
        ));
    }
    let dimensions = if let Some(node) = view.get::<ImageNode>(key) {
        node.effective_dimensions()
    } else {
        view.get::<VideoNode>(key)
            .ok_or(lexical_model::Error::NodeTypeMismatch(key))?
            .effective_dimensions()
    };
    let mut media = HtmlElement::new(if ty == "image" { "img" } else { "video" });
    media.set_attribute("src", dom_field(data, "url"));
    media.set_attribute(
        "width",
        lexical_html::js::js_number_to_string(dimensions.width),
    );
    media.set_attribute(
        "height",
        lexical_html::js::js_number_to_string(dimensions.height),
    );
    media.set_attribute("data-src-type", dom_field(data, "srcType"));
    media.set_attribute(&format!("data-{ty}-id"), dom_field(data, "id"));
    media.set_attribute("data-scale", field(data, "scale"));
    for (attr, key) in [
        ("data-constrained-width", "constrainedWidth"),
        ("data-constrained-height", "constrainedHeight"),
    ] {
        if let Some(value) = data.get(key).filter(|v| !v.is_null()) {
            media.set_attribute(attr, lexical_model::js_string(value));
        }
    }
    media.set_attribute(
        if ty == "image" { "alt" } else { "controls" },
        dom_field(data, if ty == "image" { "alt" } else { "controls" }),
    );
    let mut wrapper = HtmlElement::new("div");
    wrapper.append(HtmlNode::Element(media));
    Ok(DomExportOutput::element(wrapper))
}
