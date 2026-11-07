//! Block callbacks and wrapped lists; ordinary Markdown callbacks remain upstream.
use super::*;
use crate::nodes::*;
use lexical_markdown::{Error, Result};
use lexical_model::*;
use lexical_rich_nodes::{heading::HeadingNode, list::*};
impl ElementTransformer for Callback {
    fn dependencies(&self) -> &[&'static str] {
        &self.entry.dependencies
    }
    fn reg_exp(&self) -> &dyn Matcher {
        &*self.pattern
    }
    fn trigger_on_enter(&self) -> bool {
        self.entry.trigger_on_enter
    }
    fn export(&self, cx: &mut ExportCx<'_>, node: NodeKey) -> Result<Option<String>> {
        let name = self.entry.name;
        if let Some(spec) = envelope::spec(name) {
            if name == "I_AGENT_SESSION_CARD"
                && !cx
                    .state()
                    .get::<AgentSessionMentionNode>(node)
                    .is_some_and(|n| n.expanded)
            {
                return Ok(None);
            }
            return envelope::export(&spec, cx, node);
        }
        match name {
            "MACRO_ORDERED_LIST" | "ORDERED_LIST_ENTER" => OrderedList.export(cx, node),
            "MACRO_UNORDERED_LIST" => UnorderedList.export(cx, node),
            "MACRO_CHECK_LIST" => CheckList.export(cx, node),
            "I_TABLE_NODE" | "E_TABLE_NODE" => {
                super::table::export(cx, node, name == "I_TABLE_NODE", &self.options)
            }
            "I_MACRO_QUOTE" => super::quote::macro_export(cx, node, &self.options),
            "HR" => Ok(cx
                .state()
                .is::<HorizontalRuleNode>(node)
                .then(|| "---".into())),
            "PRESERVE_LINES" => {
                if cx.state().is::<Paragraph>(node)
                    && js_trim(&cx.state().text_content(node)).is_empty()
                    && !cx
                        .state()
                        .children(node)
                        .any(|n| cx.state().kind(n) == Some(NodeKind::Decorator))
                {
                    Ok(Some("\n \n".into()))
                } else {
                    Ok(None)
                }
            }
            "I_DATABASE_QUERY_BLOCK" => {
                let Some(n) = cx.state().get::<DatabaseQueryNode>(node) else {
                    return Ok(None);
                };
                if n.data.display_mode == DatabaseQueryDisplayMode::Scalar {
                    return Ok(None);
                }
                Ok(Some(database_query_markdown(
                    &serde_json::to_value(&n.data).map_err(lexical_model::Error::from)?,
                )?))
            }
            "IMAGE" | "I_IMAGE_CONSTRAINED" | "I_VIDEO" | "VIDEO_LINK" => {
                super::media::export(cx, node, name)
            }
            name if name.starts_with("E_") => export_external(cx, node, name, &self.options),
            _ => Ok(None),
        }
    }
    fn replace(
        &self,
        tx: &mut Transaction<'_>,
        opts: &MarkdownOptions,
        parent: NodeKey,
        children: &[NodeKey],
        m: &Match,
        is_import: bool,
    ) -> Result<ReplaceResult> {
        let name = self.entry.name;
        if name == "I_AGENT_SESSION_CARD" {
            return Ok(ReplaceResult::NotHandled);
        }
        if let Some(spec) = envelope::spec(name) {
            if name == "I_AGENT_CONTEXT"
                && (tx.view().parent(parent) != Some(NodeKey::ROOT)
                    || tx.view().prev_sibling(parent).is_some())
            {
                tx.clear(parent)?;
                let text = tx.create_text(m.full())?;
                tx.append(parent, &[text.key()])?;
                return Ok(ReplaceResult::Handled);
            }
            match envelope::create(tx, &spec, m.get(1).unwrap_or("")) {
                Ok(node) => {
                    if name == "I_WATERMARK" {
                        tx.append(parent, &[node])?;
                    } else {
                        tx.replace(parent, node, false)?;
                    }
                }
                Err(_) => {
                    let p = tx.create(Paragraph {})?;
                    let unknown = envelope::unknown(tx, spec.unknown)?;
                    tx.append(p, &[unknown])?;
                    tx.replace(parent, p, false)?;
                }
            }
            return Ok(ReplaceResult::Handled);
        }
        match name {
            "MACRO_ORDERED_LIST"
            | "ORDERED_LIST_ENTER"
            | "MACRO_CHECK_LIST"
            | "MACRO_UNORDERED_LIST" => {
                if tx.view().is::<HeadingNode>(parent) {
                    return Ok(ReplaceResult::NotHandled);
                }
                if matches!(name, "MACRO_ORDERED_LIST" | "ORDERED_LIST_ENTER") {
                    if let Some(next) = tx.view().next_sibling(parent)
                        && tx
                            .view()
                            .get::<ListNode>(next)
                            .is_some_and(|n| n.list_type() == ListType::Number)
                        && let Ok(number) = m.get(2).unwrap_or("").parse::<f64>()
                        && number.is_finite()
                    {
                        tx.get_mut::<ListNode>(next)?
                            .set_start(number.clamp(i32::MIN as f64, i32::MAX as f64) as i32);
                    }
                    OrderedList.replace(tx, opts, parent, children, m, is_import)?;
                } else if name == "MACRO_CHECK_LIST" {
                    CheckList.replace(tx, opts, parent, children, m, is_import)?;
                } else {
                    UnorderedList.replace(tx, opts, parent, children, m, is_import)?;
                }
            }
            "I_TABLE_NODE" => {
                return super::table::import_internal(tx, parent, m, opts, &self.options);
            }
            "E_TABLE_NODE" => {
                return super::table::import_external(tx, parent, m, opts, &self.options);
            }
            "I_MACRO_QUOTE" => {
                return super::quote::macro_replace(tx, opts, parent, m, &self.options);
            }
            "HR" => {
                let rule = tx.create(HorizontalRuleNode::default())?;
                if is_import || tx.view().next_sibling(parent).is_some() {
                    tx.replace(parent, rule, false)?;
                } else {
                    tx.insert_before(parent, rule, true)?;
                }
                tx.select_next(rule, None, None)?;
            }
            "PRESERVE_LINES" => {
                if is_import && children.len() == 1 {
                    let empty = tx.create_text("")?;
                    tx.append(parent, &[empty.key()])?;
                }
            }
            "I_DATABASE_QUERY_BLOCK" => {
                let key = if let Some(data) = parse_database_query_json(m.get(1).unwrap_or("")) {
                    let scalar = data.display_mode == DatabaseQueryDisplayMode::Scalar;
                    let key = tx.create(DatabaseQueryNode { data })?.key();
                    if scalar {
                        let p = tx.create(Paragraph {})?;
                        tx.append(p, &[key])?;
                        p.key()
                    } else {
                        key
                    }
                } else {
                    let p = tx.create(Paragraph {})?;
                    let unknown = envelope::unknown(tx, "Unavailable database question")?;
                    tx.append(p, &[unknown])?;
                    p.key()
                };
                tx.replace(parent, key, false)?;
            }
            "IMAGE" | "I_IMAGE_CONSTRAINED" | "I_VIDEO" | "VIDEO_LINK" => {
                return super::media::replace(tx, parent, m, is_import, name);
            }
            name if name.starts_with("E_") => return Ok(ReplaceResult::NotHandled),
            _ => {
                return Err(Error::InvalidArgument(
                    "Macro block callback is not implemented",
                ));
            }
        }
        Ok(ReplaceResult::Handled)
    }
}
impl MultilineElementTransformer for Callback {
    fn dependencies(&self) -> &[&'static str] {
        &self.entry.dependencies
    }
    fn export(&self, cx: &mut ExportCx<'_>, node: NodeKey) -> Result<Option<String>> {
        Ok(cx
            .state()
            .get::<CursorSystemNotificationNode>(node)
            .filter(|_| self.entry.name == "I_CURSOR_SYSTEM_NOTIFICATION")
            .map(build_cursor_system_notification_markdown))
    }
    fn handle_import_after_start_match(
        &self,
        tx: &mut Transaction<'_>,
        opts: &MarkdownOptions,
        lines: &[String],
        root: NodeKey,
        index: usize,
        start: &Match,
    ) -> Result<AfterStartMatch> {
        if self.entry.name == "HTML_BLOCKQUOTE" {
            super::quote::after_start(tx, opts, lines, root, index, start, &self.options)
        } else {
            Ok(AfterStartMatch::Default)
        }
    }
    fn reg_exp_start(&self) -> &dyn Matcher {
        &*self.pattern
    }
    fn reg_exp_end(&self) -> RegExpEnd<'_> {
        match (self.end.as_deref(), self.entry.reg_exp_end.as_ref()) {
            (Some(end), Some(pattern)) if pattern.optional => RegExpEnd::Optional(end),
            (Some(end), _) => RegExpEnd::Required(end),
            _ => RegExpEnd::None,
        }
    }
    fn replace(
        &self,
        tx: &mut Transaction<'_>,
        opts: &MarkdownOptions,
        root: NodeKey,
        children: Option<&[NodeKey]>,
        start: &Match,
        end: Option<&Match>,
        lines: Option<Vec<String>>,
        _: bool,
    ) -> Result<ReplaceResult> {
        match self.entry.name {
            "I_CURSOR_SYSTEM_NOTIFICATION" => {
                if children.is_some_and(|c| !c.is_empty()) {
                    return Ok(ReplaceResult::NotHandled);
                }
                let Some(data) = read_cursor_system_notification(
                    start.get(1).unwrap_or(""),
                    &lines.unwrap_or_default().join("\n"),
                )?
                else {
                    return Ok(ReplaceResult::NotHandled);
                };
                let node = tx.create(data)?;
                tx.append(root, &[node.key()])?;
                Ok(ReplaceResult::Handled)
            }
            "HTML_BLOCKQUOTE" => {
                super::quote::replace(tx, opts, root, children, start, end, lines, &self.options)
            }
            "E_MULTILINE_BLOCK_EQUATION_NODE" => {
                let latex = lines.unwrap_or_default().join("\n");
                let latex = js_trim(&latex).replace("{align}", "{align*}");
                if children.is_some_and(|c| !c.is_empty())
                    || latex.is_empty()
                    || latex.contains("$$")
                    || !js_trim(start.get(1).unwrap_or("")).is_empty()
                    || end.is_none_or(|m| !js_trim(m.get(2).unwrap_or("")).is_empty())
                {
                    return Ok(ReplaceResult::NotHandled);
                }
                let node = tx.create(EquationNode {
                    equation: Maybe::Value(latex),
                    inline: false,
                })?;
                tx.append(root, &[node.key()])?;
                Ok(ReplaceResult::Handled)
            }
            _ => Err(Error::InvalidArgument(
                "Macro multiline callback is not implemented",
            )),
        }
    }
}
fn export_external(
    cx: &mut ExportCx<'_>,
    node: NodeKey,
    name: &str,
    options: &MacroMarkdownOptions,
) -> Result<Option<String>> {
    let ty = match name {
        "E_USER_MENTION" => "user-mention",
        "E_GROUP_MENTION" => "group-mention",
        "E_DOCUMENT_MENTION" => "document-mention",
        "E_DOCUMENT_CARD" => "document-card",
        "E_PR_MENTION" => "pr-mention",
        "E_BOOKING_LINK_MENTION" => "booking-link-mention",
        "E_AGENT_SESSION_MENTION" => "agent-session-mention",
        "E_CONTACT_MENTION" => "contact-mention",
        "E_DATE_MENTION" => "date-mention",
        "E_PASTE_NODE" => "paste",
        "E_REPLY_TARGET_NODE" => "reply-target",
        "E_TAG_MENTION" => "tag-mention",
        "E_SNAPSHOT_NODE" => "snapshot",
        "E_WATERMARK" => "watermark",
        _ => return Ok(None),
    };
    if cx.state().node(node).map(|n| n.type_name()) != Some(ty) {
        return Ok(None);
    }
    let json = cx.state().export_node(node)?;
    let field = |key: &str| {
        json.get(key)
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
    };
    let text = match name {
        "E_USER_MENTION" => field("userId").into(),
        "E_GROUP_MENTION" => format!("@{}", field("groupAlias")),
        "E_CONTACT_MENTION" => {
            if field("name").is_empty() {
                String::new()
            } else {
                field("emailOrDomain").into()
            }
        }
        "E_DATE_MENTION" => field("displayFormat").into(),
        "E_TAG_MENTION" => {
            if field("name").is_empty() {
                String::new()
            } else {
                format!("#{}", field("name"))
            }
        }
        "E_PASTE_NODE" | "E_WATERMARK" => field("content").into(),
        "E_REPLY_TARGET_NODE" => field("displayText")
            .split('\n')
            .map(|line| format!("> {line}"))
            .collect::<Vec<_>>()
            .join("\n"),
        "E_BOOKING_LINK_MENTION" => {
            let label = if !field("label").is_empty() {
                field("label")
            } else if !field("slug").is_empty() {
                field("slug")
            } else {
                "Booking link"
            };
            format!("[{label}]({})", field("url"))
        }
        "E_PR_MENTION" | "E_AGENT_SESSION_MENTION" => {
            let label = if !field("label").is_empty() {
                field("label")
            } else if name == "E_PR_MENTION" {
                "Pull request"
            } else {
                "Agent session"
            };
            if field("id").is_empty() {
                if !field("url").is_empty() {
                    format!("[{label}]({})", field("url"))
                } else {
                    return Ok(None);
                }
            } else if let Some(host) = options.app_hostname.as_deref() {
                let path = if name == "E_PR_MENTION" {
                    "pr"
                } else {
                    "agent"
                };
                format!(
                    "[{label}](https://{}/app/{path}/{})",
                    clean_hostname(host),
                    field("id")
                )
            } else {
                label.into()
            }
        }
        "E_DOCUMENT_MENTION" | "E_DOCUMENT_CARD" | "E_SNAPSHOT_NODE" => {
            if field("documentName").is_empty()
                || field("documentId").is_empty()
                || field("blockName").is_empty()
            {
                return Ok(None);
            }
            let hostname = options
                .app_hostname
                .as_deref()
                .ok_or_else(|| Error::Transformer(Box::new(crate::Error::MissingHostname)))?;
            let block = field("blockName");
            let path = if name == "E_DOCUMENT_MENTION" && matches!(block, "routine" | "automation")
            {
                "routines"
            } else {
                block
            };
            format!(
                "[{}](https://{}/app/{path}/{})",
                field("documentName"),
                clean_hostname(hostname),
                field("documentId")
            )
        }
        _ => return Ok(None),
    };
    Ok((!text.is_empty()).then_some(text))
}
fn clean_hostname(host: &str) -> String {
    let host = host.replacen("www.", "", 1).to_lowercase();
    if host == "localhost" {
        "dev.macro.com".into()
    } else {
        host
    }
}
pub(super) fn export_list_image(
    cx: &mut ExportCx<'_>,
    node: NodeKey,
    name: &str,
) -> Result<Option<String>> {
    if !cx.state().is::<ImageNode>(node) {
        return Ok(None);
    }
    let Some(item) = cx
        .state()
        .parent(node)
        .filter(|key| cx.state().is::<ListItemNode>(*key))
    else {
        return Ok(None);
    };
    let Some(list) = cx
        .state()
        .parent(item)
        .filter(|key| cx.state().is::<ListNode>(*key))
    else {
        return Ok(None);
    };
    let mut depth = 0;
    let mut ancestor = cx.state().parent(list);
    while let Some(item) = ancestor.filter(|key| cx.state().is::<ListItemNode>(*key)) {
        depth += 1;
        ancestor = cx
            .state()
            .parent(item)
            .and_then(|list| cx.state().parent(list));
    }
    let marker = if cx
        .state()
        .get::<ListNode>(list)
        .is_some_and(|n| n.list_type() == ListType::Number)
    {
        format!(
            "{}. ",
            cx.state()
                .get::<ListItemNode>(item)
                .map(|n| n.value)
                .unwrap_or(1)
        )
    } else {
        "- ".into()
    };
    let mut markdown = None;
    if name != "LIST_ITEM_IMAGE_EXTERNAL" {
        markdown = super::media::export(cx, node, "I_IMAGE_CONSTRAINED")?;
    }
    if markdown.is_none() {
        markdown = super::media::export(cx, node, "IMAGE")?;
    }
    Ok(markdown.map(|text| format!("\n{}{text}", " ".repeat(depth * 2 + marker.len()))))
}
