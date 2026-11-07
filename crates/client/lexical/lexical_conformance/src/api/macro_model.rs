//! Dispatch source node helpers to the portable Macro implementation.
use crate::replay::*;
use lexical_model::*;
use macro_document_model::{links, nodes::*, parsers};
use serde_json::{Value, json};
fn optional<T: serde::Serialize>(value: Option<T>) -> Result<Value> {
    value
        .map(serde_json::to_value)
        .transpose()
        .map(|value| value.unwrap_or_else(undefined))
        .map_err(Into::into)
}
pub(crate) fn call(
    r: &mut Replayer,
    tx: &mut Transaction<'_>,
    name: &str,
    args: &[Value],
) -> Result<Value> {
    let first = args.first().unwrap_or(&Value::Null);
    let text = || {
        first
            .as_str()
            .ok_or_else(|| fail("Macro helper requires text"))
    };
    let short = name.rsplit('.').next().unwrap_or(name);
    if let Some(class) = short.strip_prefix("$is")
        && let Some(ty) = super::wire::class_type(class)
    {
        return Ok(json!(first.get("$node").is_some() && first["type"] == ty));
    }
    let parser: Option<fn(&str) -> String> = match short {
        "parseUserMentions" => Some(parsers::parse_user_mentions),
        "parseUserMentionsForSearch" => Some(parsers::parse_user_mentions_for_search),
        "parseContactMentions" => Some(parsers::parse_contact_mentions),
        "parseDateMentions" => Some(parsers::parse_date_mentions),
        "parseDocumentMentions" => Some(parsers::parse_document_mentions),
        "parseAgentSessionMentions" => Some(parsers::parse_agent_session_mentions),
        "parsePullRequestMentions" => Some(parsers::parse_pull_request_mentions),
        "parseAccountManagerRequests" => Some(parsers::parse_account_manager_requests),
        "parseConnectApps" => Some(parsers::parse_connect_apps),
        "parseDatabaseQueries" => Some(parsers::parse_database_queries),
        "parseAgentActivities" => Some(parsers::parse_agent_activities),
        "parseCursorSystemNotifications" => Some(parsers::parse_cursor_system_notifications),
        "parseTagMentions" => Some(parsers::parse_tag_mentions),
        "parseLinks" => Some(parsers::parse_links),
        "parseGroupMentions" => Some(parsers::parse_group_mentions),
        "parseDocumentCards" => Some(parsers::parse_document_cards),
        "parseReplyTargets" => Some(parsers::parse_reply_targets),
        "parseSnapshots" => Some(parsers::parse_snapshots),
        "stripAgentContext" => Some(parsers::strip_agent_context),
        "markdownToPlainText" => Some(parsers::markdown_to_plain_text),
        "markdownToSearchText" => Some(parsers::markdown_to_search_text),
        "markdownToEmbeddingText" => Some(parsers::markdown_to_embedding_text),
        _ => None,
    };
    if let Some(parser) = parser {
        return Ok(json!(parser(text()?)));
    }
    match name.rsplit('.').next().unwrap_or(name) {
        "notionMarkdownToSerializedEditorState" => {
            Ok(super::wire::exported_object(serde_json::to_value(
                macro_document_model::notion::notion_markdown_to_serialized_editor_state(
                    text()?,
                    &serde_json::from_value(
                        args.get(1).cloned().ok_or_else(|| fail("Notion links"))?,
                    )?,
                    &r.document_context(),
                )?,
            )?))
        }
        "composeImageMarkdown" => Ok(json!(
            macro_document_model::markdown::compose_image_markdown(
                &serde_json::from_value(first.clone())?,
                &r.document_context()
            )?
        )),
        "composeAgentContextPrompt" => Ok(json!(
            macro_document_model::agent_context::compose_agent_context_prompt(
                first,
                &r.document_context()
            )?
        )),
        "markdownToSerializedEditorStateWithIds" => {
            Ok(super::wire::exported_object(serde_json::to_value(
                macro_document_model::markdown::markdown_to_serialized_editor_state_with_ids(
                    text()?,
                    &r.document_context(),
                )?,
            )?))
        }
        "serializedEditorStateToMarkdown" => Ok(json!(
            macro_document_model::markdown::serialized_editor_state_to_markdown(
                &serde_json::from_value(super::wire::json_value(first.clone()))?,
                &r.document_context()
            )?
        )),
        "extractChannelMentionsFromMarkdown" => Ok(serde_json::to_value(
            macro_document_model::mentions::extract_channel_mentions_from_markdown(
                text()?,
                &r.document_context(),
            )?,
        )?),
        "extractExplicitReply" => Ok(serde_json::to_value(
            macro_document_model::mentions::extract_explicit_reply(text()?, &r.document_context())?,
        )?),
        "composeAgentChatReply" => Ok(json!(
            macro_document_model::agent_reply::compose_agent_chat_reply(
                &serde_json::from_value(super::wire::json_value(first.clone()))?,
                &r.document_context()
            )?
        )),
        "composeAgentSessionAnnouncement" => Ok(json!(
            macro_document_model::agent_reply::compose_agent_session_announcement(
                &serde_json::from_value(super::wire::json_value(first.clone()))?,
                &r.document_context()
            )?
        )),
        "composeAgentConnectionPrompt" => Ok(json!(
            macro_document_model::agent_reply::compose_agent_connection_prompt(
                &serde_json::from_value(super::wire::json_value(first.clone()))?,
                &r.document_context()
            )?
        )),
        "protectEmptyParagraphLines" => Ok(json!(
            macro_document_model::transformers::protect_empty_paragraph_lines(
                text()?,
                args.get(1)
                    .and_then(Value::as_array)
                    .is_some_and(|items| items.iter().any(|item| item["$transformer"]
                        .as_str()
                        .is_some_and(|name| name.ends_with(".PRESERVE_LINES"))))
            )
        )),
        "$convertMentionToCard" => {
            let mention = tx
                .view()
                .cast::<DocumentMentionNode>(node_key(first)?)
                .ok_or_else(|| fail("document mention"))?;
            let preview = args
                .get(1)
                .filter(|value| value.get("$undef").is_none())
                .map(|value| serde_json::from_value(value.clone()))
                .transpose()?;
            let data = args
                .get(2)
                .filter(|value| value.get("$undef").is_none())
                .cloned()
                .map(Maybe::Value)
                .unwrap_or_default();
            let card = convert_mention_to_card(tx, mention, preview, data)?;
            r.node(tx.view(), card.key())
        }
        "$convertCardToMention" => {
            let card = tx
                .view()
                .cast::<DocumentCardNode>(node_key(first)?)
                .ok_or_else(|| fail("document card"))?;
            let mention = convert_card_to_mention(tx, card)?;
            r.node(tx.view(), mention.key())
        }
        "$insertReferencedPaste" => {
            insert_referenced_paste(tx, text()?)?;
            Ok(undefined())
        }
        "$createCommentNode" => {
            let data =
                CommentNode::import_json(first.as_object().ok_or_else(|| fail("comment params"))?)?;
            let node = create_comment_node(tx, data.mark.ids, data.thread_id, Some(data.is_draft))?;
            r.node(tx.view(), node.key())
        }
        "$getCommentMarkText" => Ok(json!(get_comment_mark_text(tx.view(), text()?)?)),
        "$getCommentMarkContext" => {
            let defaults = CommentContextOptions::default();
            let options = CommentContextOptions {
                marked_limit: args
                    .get(1)
                    .and_then(|v| v.get("markedLimit"))
                    .and_then(Value::as_u64)
                    .map_or(defaults.marked_limit, |n| n as usize),
                surrounding_limit: args
                    .get(1)
                    .and_then(|v| v.get("surroundingLimit"))
                    .and_then(Value::as_u64)
                    .map_or(defaults.surrounding_limit, |n| n as usize),
            };
            Ok(serde_json::to_value(get_comment_mark_context(
                tx.view(),
                text()?,
                options,
            )?)?)
        }
        "$createDocumentMentionNode" => {
            let node = create_document_mention_node(tx, serde_json::from_value(first.clone())?)?;
            r.node(tx.view(), node.key())
        }
        "$createClassedBlockNode" => {
            let node = create_classed_block_node(tx, serde_json::from_value(first.clone())?)?;
            r.node(tx.view(), node.key())
        }
        "$createPasteNode" => {
            let content = first
                .get("content")
                .map(|v| serde_json::from_value(v.clone()))
                .transpose()?
                .unwrap_or_default();
            let node = create_paste_node(
                tx,
                content,
                normalize_paste_origin(first.get("origin").unwrap_or(&Value::Null)),
            )?;
            r.node(tx.view(), node.key())
        }
        "$convertPasteToText" => {
            let node = tx
                .view()
                .cast::<PasteNode>(node_key(first)?)
                .ok_or_else(|| fail("paste node"))?;
            convert_paste_to_text(tx, node, &Default::default())?;
            Ok(undefined())
        }
        "$createImageNode" => {
            let node = create_image_node(
                tx,
                serde_json::from_value(first.clone())?,
                first.get("alt").and_then(Value::as_str).map(str::to_owned),
            )?;
            r.node(tx.view(), node.key())
        }
        "$createVideoNode" => {
            let node = create_video_node(
                tx,
                serde_json::from_value(first.clone())?,
                first.get("controls").and_then(Value::as_bool),
            )?;
            r.node(tx.view(), node.key())
        }
        "$createEquationNode" => {
            let equation = args
                .first()
                .filter(|v| v.get("$undef").is_none())
                .map(|v| serde_json::from_value(v.clone()))
                .transpose()?
                .unwrap_or_default();
            let node = create_equation_node(tx, equation, args.get(1).and_then(Value::as_bool))?;
            r.node(tx.view(), node.key())
        }
        "$createCustomCodeNode" => {
            let node = create_custom_code_node(tx, first.as_str())?;
            r.node(tx.view(), node.key())
        }
        "$createUnlinkedTextNode" => {
            let node = create_unlinked_text_node(tx, first.as_str())?;
            r.node(tx.view(), node.key())
        }
        "$createDateMentionNode" => {
            let node = tx.create(serde_json::from_value::<DateMentionNode>(first.clone())?)?;
            r.node(tx.view(), node.key())
        }
        "$createHtmlRenderNode" => {
            let node = tx.create(serde_json::from_value::<HtmlRenderNode>(first.clone())?)?;
            r.node(tx.view(), node.key())
        }
        "$createAgentSessionMentionNode" => {
            let node = tx.create(AgentSessionMentionNode::import_json(
                first
                    .as_object()
                    .ok_or_else(|| fail("session mention data"))?,
            )?)?;
            r.node(tx.view(), node.key())
        }
        "messageReference" => Ok(serde_json::to_value(
            macro_document_model::mentions::message_reference(
                text()?,
                args.get(1)
                    .and_then(Value::as_str)
                    .ok_or_else(|| fail("reference id"))?,
            ),
        )?),
        "normalizePasteOrigin" => Ok(serde_json::to_value(normalize_paste_origin(first))?),
        "toXml" => Ok(json!(macro_document_model::xml::to_xml(
            &serde_json::from_value(super::wire::json_value(first.clone()))?
        )?)),
        "quoteMarkdown" => {
            Ok(parsers::quote_markdown(text()?).map_or_else(undefined, Value::String))
        }
        "parseDateMentionBody" => Ok(serde_json::to_value(parse_date_mention_body(text()?))?),
        "normalizeLinkUrl" => Ok(json!(links::normalize_link_url(text()?))),
        "findAutoLinkMatches" | "findNextAutoLinkMatch" => {
            let mode = match args.get(1).and_then(Value::as_str) {
                None | Some("protocol") => links::AutoLinkMode::Protocol,
                Some("common-tlds") => links::AutoLinkMode::CommonTlds,
                Some("fuzzy") => links::AutoLinkMode::Fuzzy,
                _ => return Err(fail("unknown auto-link mode")),
            };
            if short == "findAutoLinkMatches" {
                Ok(serde_json::to_value(links::find_auto_link_matches(
                    text()?,
                    mode,
                ))?)
            } else {
                Ok(serde_json::to_value(links::find_next_auto_link_match(
                    text()?,
                    mode,
                ))?)
            }
        }
        "isAgentActivityData" => Ok(json!(is_agent_activity_data(first))),
        "isAgentActivityCard" => Ok(json!(is_agent_activity_card(first))),
        "isAgentActivityStatus" => Ok(json!(is_agent_activity_status(first))),
        "agentActivityText" => Ok(json!(agent_activity_text(
            first
                .as_array()
                .ok_or_else(|| fail("activity rows must be an array"))?
        ))),
        "isConnectAppSlug" => Ok(json!(first.as_str().is_some_and(is_connect_app_slug))),
        "isConnectAppTarget" => Ok(json!(matches!(
            first.as_str(),
            Some("connections" | "harness")
        ))),
        "isAccountManagerGrantId" => Ok(json!(
            first.as_str().is_some_and(is_account_manager_grant_id)
        )),
        "isDatabaseQueryChartMode" => Ok(json!(is_database_query_chart_mode(first))),
        "isDatabaseQueryDisplayMode" => Ok(json!(is_database_query_display_mode(first))),
        "parseCursorSystemNotificationAttributes" => Ok(serde_json::to_value(
            parse_cursor_system_notification_attributes(text()?)?,
        )?),
        "readCursorSystemNotification" => optional(read_cursor_system_notification(
            text()?,
            args.get(1)
                .and_then(Value::as_str)
                .ok_or_else(|| fail("notification body"))?,
        )?),
        "buildCursorSystemNotificationMarkdown" => Ok(json!(
            build_cursor_system_notification_markdown(&serde_json::from_value(first.clone())?)
        )),
        "isGithubPullRequestUrl" => Ok(json!(
            first.as_str().is_some_and(is_github_pull_request_url)
        )),
        "parseDatabaseQueryChart" => optional(parse_database_query_chart(first)),
        "parseDatabaseQueryData" => optional(parse_database_query_data(first)),
        "parseDatabaseQueryJson" => optional(parse_database_query_json(text()?)),
        "databaseQueryMarkdown" => Ok(json!(database_query_markdown(first)?)),
        "isReplyTargetData" => Ok(json!(is_reply_target_data(first))),
        "readReplyTargetData" => Ok(read_reply_target_data(first).unwrap_or_else(undefined)),
        "buildReplyTargetMarkdown" => Ok(json!(build_reply_target_markdown(first))),
        "stripLeadingReplyTargetMarkdown" => {
            Ok(json!(strip_leading_reply_target_markdown(text()?)))
        }
        "buildAgentSessionMentionMarkdown" => {
            Ok(json!(build_agent_session_mention_markdown(first)))
        }
        "$isCursorSystemNotificationNode"
        | "$isUnknownMentionNode"
        | "$isAccountManagerRequestNode" => {
            let snapshot = r.read_state.clone();
            let view = snapshot
                .as_ref()
                .map(EditorState::view)
                .unwrap_or(tx.view());
            let is = if first.get("$node").is_some() {
                let key = node_key(first)?;
                match name.rsplit('.').next().unwrap_or(name) {
                    "$isCursorSystemNotificationNode" => {
                        view.is::<CursorSystemNotificationNode>(key)
                    }
                    "$isUnknownMentionNode" => view.is::<UnknownMentionNode>(key),
                    _ => view.is::<AccountManagerRequestNode>(key),
                }
            } else {
                false
            };
            Ok(json!(is))
        }
        _ => Err(fail(format!("unmapped Macro API: {name}"))),
    }
}
pub(crate) fn node_method(view: StateRef<'_>, key: NodeKey, method: &str) -> Result<Option<Value>> {
    if method == "getEffectiveDimensions" {
        let dimensions = if let Some(node) = view.get::<ImageNode>(key) {
            node.effective_dimensions()
        } else if let Some(node) = view.get::<VideoNode>(key) {
            node.effective_dimensions()
        } else {
            return Ok(None);
        };
        return Ok(Some(
            json!({ "width": JsNumber(dimensions.width), "height": JsNumber(dimensions.height) }),
        ));
    }
    if let Some(node) = view.get::<CursorSystemNotificationNode>(key) {
        return Ok(match method {
            "getText" => Some(json!(node.text)),
            "getSource" => Some(json!(node.source)),
            "getAttributes" => Some(serde_json::to_value(&node.attributes)?),
            _ => None,
        });
    }
    if let Some(node) = view.get::<ConnectAppNode>(key) {
        return Ok(match method {
            "getAppSlug" => Some(serde_json::to_value(&node.app_slug)?),
            "getName" => Some(serde_json::to_value(&node.name)?),
            "getTarget" => Some(serde_json::to_value(node.target)?),
            _ => None,
        });
    }
    let field = match method {
        "getName" => Some("name"),
        "getContent" => Some("content"),
        "getDate" => Some("date"),
        "getDisplayFormat" => Some("displayFormat"),
        "getEquation" => Some("equation"),
        "getUrl" => Some("url"),
        "getUserId" => Some("userId"),
        "getOrigin" => Some("origin"),
        "getWidth" => Some("width"),
        "getHeight" => Some("height"),
        "getAlt" => Some("alt"),
        "getControls" => Some("controls"),
        "getText" => Some("text"),
        "getInline" => Some("inline"),
        "getEmail" => Some("email"),
        "getIsDraft" => Some("isDraft"),
        "getId" => Some("id"),
        "getChecked" => Some("checked"),
        "getThreadId" => Some("threadId"),
        "getSrcType" => Some("srcType"),
        "getValue" => Some("value"),
        "getListType" => Some("listType"),
        "getStart" => Some("start"),
        "getConstrainedWidth" => Some("constrainedWidth"),
        "getConstrainedHeight" => Some("constrainedHeight"),
        "getColWidths" => Some("colWidths"),
        "getColSpan" => Some("colSpan"),
        "getRowSpan" => Some("rowSpan"),
        _ => None,
    };
    if let Some(field) = field {
        let data = view.export_json(key)?;
        return Ok(Some(data.get(field).cloned().unwrap_or_else(undefined)));
    }
    if method == "exportComponentProps" {
        let ty = view.node_or_err(key)?.type_name();
        let mut data = view.export_json(key)?;
        for field in [
            "type",
            "version",
            "$",
            "children",
            "direction",
            "format",
            "indent",
            "textFormat",
            "textStyle",
        ] {
            data.shift_remove(field);
        }
        let mut value = super::wire::exported_object(Value::Object({
            let mut tagged = data.clone();
            tagged.insert("type".into(), ty.into());
            tagged
        }));
        if let Some(object) = value.as_object_mut() {
            object.shift_remove("type");
        }
        return Ok(Some(value));
    }
    Ok(None)
}
