//! JSON envelopes retain each source constructor's validation and field order.
use crate::nodes::*;
use lexical_markdown::{Error, Result};
use lexical_model::*;
use serde_json::{Map, Value, json};
pub(super) struct Envelope {
    pub ty: &'static str,
    pub tag: &'static str,
    pub fields: &'static [&'static str],
    pub required: &'static [&'static str],
    pub unknown: &'static str,
}
pub(super) fn spec(name: &str) -> Option<Envelope> {
    let (ty, tag, fields, required, unknown): (_, _, &[_], &[_], _) = match name {
        "I_USER_MENTION" => (
            "user-mention",
            "m-user-mention",
            &["userId", "email", "displayName"],
            &["userId"],
            "Unknown User",
        ),
        "I_CONTACT_MENTION" => (
            "contact-mention",
            "m-contact-mention",
            &["contactId", "name", "emailOrDomain", "isCompany"],
            &["contactId", "name", "emailOrDomain", "isCompany"],
            "Unknown Contact",
        ),
        "I_DATE_MENTION" => (
            "date-mention",
            "m-date-mention",
            &["date", "displayFormat", "mentionUuid"],
            &["date", "displayFormat"],
            "Unknown Date",
        ),
        "I_DOCUMENT_MENTION" => (
            "document-mention",
            "m-document-mention",
            &[
                "documentId",
                "blockName",
                "documentName",
                "blockParams",
                "collapsed",
            ],
            &["documentId"],
            "Unknown Item",
        ),
        "I_DOCUMENT_CARD" => (
            "document-card",
            "m-document-card",
            &[
                "documentId",
                "blockName",
                "documentName",
                "blockParams",
                "previewBox",
                "previewData",
                "mentionUuid",
            ],
            &["documentId", "blockName"],
            "Unknown Item",
        ),
        "I_PR_MENTION" => (
            "pr-mention",
            "m-pr-mention",
            &["id", "label", "mentionUuid", "url"],
            &[],
            "Unknown Pull Request",
        ),
        "I_GROUP_MENTION" => (
            "group-mention",
            "m-group-mention",
            &["groupAlias"],
            &["groupAlias"],
            "Unknown Group",
        ),
        "I_AGENT_SESSION_MENTION" | "I_AGENT_SESSION_CARD" => (
            "agent-session-mention",
            "m-agent-session-mention",
            &["id", "label", "mentionUuid", "expanded"],
            &["id"],
            "Unknown Agent Session",
        ),
        "I_BOOKING_LINK_MENTION" => (
            "booking-link-mention",
            "m-booking-link-mention",
            &["profileId", "slug", "label", "url"],
            &[],
            "Unknown Booking Link",
        ),
        "I_THEME_MENTION" => (
            "theme-mention",
            "m-theme-mention",
            &["name", "data"],
            &["name"],
            "Unknown Theme",
        ),
        "I_TAG_MENTION" => (
            "tag-mention",
            "m-tag",
            &["optionId", "propertyDefinitionId", "scope", "name", "color"],
            &["optionId", "propertyDefinitionId", "scope", "name"],
            "Unknown Tag",
        ),
        "I_CONNECT_APP" => (
            "connect-app",
            "m-connect-app",
            &["appSlug", "name", "target"],
            &["appSlug", "name"],
            "Connect app",
        ),
        "I_ACCOUNT_MANAGER_REQUEST" => (
            "account-manager-request",
            "m-account-manager-request",
            &["id"],
            &["id"],
            "Account manager request",
        ),
        "I_EQUATION_NODE" => (
            "equation",
            "m-katex-equation",
            &["equation", "inline"],
            &["equation", "inline"],
            "Unknown Equation",
        ),
        "I_AWAIT_NODE" => (
            "await",
            "m-await",
            &["awaitId", "text", "inline"],
            &[],
            "Unknown Await",
        ),
        "I_HTML_RENDER" => (
            "html-render",
            "m-html-render",
            &["html", "adaptColors"],
            &["html"],
            "Unknown Content",
        ),
        "I_SNAPSHOT_NODE" => (
            "snapshot",
            "m-snapshot",
            &[
                "documentId",
                "documentName",
                "blockName",
                "content",
                "snapshotDate",
                "mentionUuid",
            ],
            &["documentId", "documentName", "blockName", "content"],
            "Unknown Snapshot",
        ),
        "I_PASTE_NODE" => (
            "paste",
            "m-paste",
            &["content", "origin"],
            &["content"],
            "Unknown Paste",
        ),
        "I_WATERMARK" => (
            "watermark",
            "m-watermark",
            &["content"],
            &["content"],
            "Unknown Watermark",
        ),
        "I_AGENT_CONTEXT" => (
            "agent-context",
            "m-agent-context",
            &["version", "text"],
            &["version", "text"],
            "Unknown Agent Context",
        ),
        "I_AGENT_ACTIVITY" => (
            "agent-activity",
            "m-agent-activity",
            &["agentSessionId", "turn", "segment", "rows", "sealed"],
            &["agentSessionId", "turn", "segment", "rows", "sealed"],
            "Unknown agent activity",
        ),
        "I_REPLY_TARGET_NODE" => (
            "reply-target",
            "m-reply-target",
            &[
                "parent",
                "channelId",
                "targetMessageId",
                "targetThreadId",
                "displayText",
                "senderId",
            ],
            &[],
            "Unknown Reply Target",
        ),
        "I_MAGIC_CHIP" => (
            "magic-chip",
            "m-magic-chip",
            &["agentSessionId", "channelId", "promptedMessage", "status"],
            &["agentSessionId", "promptedMessage", "status"],
            "Unknown Magic Chip",
        ),
        _ => return None,
    };
    Some(Envelope {
        ty,
        tag,
        fields,
        required,
        unknown,
    })
}
fn construct<T: NodeType>(tx: &mut Transaction<'_>, data: &Map<String, Value>) -> Result<NodeKey> {
    Ok(tx.create(T::import_json(data)?)?.key())
}
pub(super) fn create(tx: &mut Transaction<'_>, spec: &Envelope, body: &str) -> Result<NodeKey> {
    if spec.ty == "date-mention" {
        return Ok(tx
            .create(
                parse_date_mention_body(body)
                    .ok_or(Error::InvalidArgument("invalid date mention"))?,
            )?
            .key());
    }
    let value: Value = serde_json::from_str(body).map_err(lexical_model::Error::from)?;
    let mut data = value
        .as_object()
        .cloned()
        .ok_or(Error::InvalidArgument("envelope requires object"))?;
    if spec.required.iter().any(|field| !data.contains_key(*field)) {
        return Err(Error::InvalidArgument("missing envelope field"));
    }
    if spec.ty == "agent-context" && data.len() != 2 {
        return Err(Error::InvalidArgument("invalid agent context"));
    }
    if spec.ty != "agent-activity" {
        data.retain(|key, _| spec.fields.contains(&key.as_str()));
    }
    match spec.ty {
        "user-mention" => {
            let id = data
                .get("userId")
                .and_then(Value::as_str)
                .filter(|s| !js_trim(s).is_empty())
                .ok_or(Error::InvalidArgument("invalid user mention"))?
                .to_owned();
            let mut email = data
                .get("email")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned();
            if email.is_empty()
                && let Some(rest) = id.strip_prefix("macro|")
            {
                email = rest.into();
            }
            let display = data.get("displayName").and_then(Value::as_str);
            if email.is_empty() && display.is_none_or(|s| js_trim(s).is_empty()) {
                return Err(Error::InvalidArgument("missing user label"));
            }
            if display.is_none() {
                data.shift_remove("displayName");
            }
            data.insert("email".into(), email.into());
            construct::<UserMentionNode>(tx, &data)
        }
        "document-mention" => {
            data.entry("documentName").or_insert(json!(""));
            data.entry("blockName").or_insert(json!("unknown"));
            construct::<DocumentMentionNode>(tx, &data)
        }
        "document-card" => {
            data.entry("documentName").or_insert(json!(""));
            construct::<DocumentCardNode>(tx, &data)
        }
        "pr-mention" => {
            let id = data
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned();
            let url = data
                .get("url")
                .and_then(Value::as_str)
                .filter(|url| is_github_pull_request_url(url))
                .map(str::to_owned);
            if id.is_empty() && url.is_none() {
                return Err(Error::InvalidArgument("missing PR identity"));
            }
            data.insert("id".into(), id.into());
            data.shift_remove("url");
            if let Some(url) = url {
                data.insert("url".into(), url.into());
            }
            for key in ["label", "mentionUuid"] {
                if !data.get(key).is_some_and(Value::is_string) {
                    data.shift_remove(key);
                }
            }
            construct::<PullRequestMentionNode>(tx, &data)
        }
        "agent-session-mention" => {
            if !data.get("id").is_some_and(Value::is_string) {
                return Err(Error::InvalidArgument("invalid session identity"));
            }
            for key in ["label", "mentionUuid"] {
                if !data.get(key).is_some_and(Value::is_string) {
                    data.shift_remove(key);
                }
            }
            data.insert(
                "expanded".into(),
                json!(data.get("expanded") == Some(&Value::Bool(true))),
            );
            construct::<AgentSessionMentionNode>(tx, &data)
        }
        "booking-link-mention" => {
            let id = data
                .get("profileId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned();
            let url = data
                .get("url")
                .and_then(Value::as_str)
                .filter(|url| is_macro_booking_url(url))
                .map(str::to_owned);
            if id.is_empty() && url.is_none() {
                return Err(Error::InvalidArgument("missing booking identity"));
            }
            data.insert("profileId".into(), id.clone().into());
            data.insert(
                "url".into(),
                url.unwrap_or_else(|| format!("https://macro.com/app/book/{id}"))
                    .into(),
            );
            construct::<BookingLinkMentionNode>(tx, &data)
        }
        "theme-mention" => {
            if !data.get("name").is_some_and(Value::is_string) {
                return Err(Error::InvalidArgument("invalid theme name"));
            }
            construct::<ThemeMentionNode>(tx, &data)
        }
        "tag-mention" => {
            if !matches!(
                data.get("scope").and_then(Value::as_str),
                Some("user" | "team")
            ) {
                return Err(Error::InvalidArgument("invalid tag scope"));
            }
            if !data.get("color").is_some_and(Value::is_string) {
                data.shift_remove("color");
            }
            construct::<TagMentionNode>(tx, &data)
        }
        "connect-app" => {
            if !data
                .get("appSlug")
                .and_then(Value::as_str)
                .is_some_and(is_connect_app_slug)
                || data
                    .get("name")
                    .and_then(Value::as_str)
                    .is_none_or(|s| s.is_empty())
                || data
                    .get("target")
                    .is_some_and(|v| !matches!(v.as_str(), Some("connections" | "harness")))
            {
                return Err(Error::InvalidArgument("invalid connect app"));
            }
            construct::<ConnectAppNode>(tx, &data)
        }
        "account-manager-request" => {
            let id = data
                .get("id")
                .and_then(Value::as_str)
                .filter(|s| is_account_manager_grant_id(s))
                .ok_or(Error::InvalidArgument("invalid grant id"))?
                .to_owned();
            Ok(tx
                .create(AccountManagerRequestNode {
                    grant_id: Maybe::Value(id),
                })?
                .key())
        }
        "await" => {
            for key in ["awaitId", "text"] {
                if !data.get(key).is_some_and(Value::is_string) {
                    data.shift_remove(key);
                }
            }
            if !data.get("inline").is_some_and(Value::is_boolean) {
                data.insert("inline".into(), true.into());
            }
            if !data.contains_key("awaitId") {
                data.insert("awaitId".into(), crate::nanoid(tx, 21)?.into());
            }
            construct::<AwaitNode>(tx, &data)
        }
        "html-render" => {
            if !data.get("html").is_some_and(Value::is_string) {
                return Err(Error::InvalidArgument("invalid HTML payload"));
            }
            if !data.get("adaptColors").is_some_and(Value::is_boolean) {
                data.shift_remove("adaptColors");
            }
            construct::<HtmlRenderNode>(tx, &data)
        }
        "snapshot" => {
            if !data.get("snapshotDate").is_some_and(js_truthy) {
                data.insert("snapshotDate".into(), crate::now_iso(tx)?.into());
            }
            construct::<SnapshotNode>(tx, &data)
        }
        "agent-context" => {
            if data.len() != 2
                || data.get("version") != Some(&json!(1))
                || !data.get("text").is_some_and(Value::is_string)
            {
                return Err(Error::InvalidArgument("invalid agent context"));
            }
            construct::<AgentContextNode>(tx, &data)
        }
        "reply-target" => {
            let value = read_reply_target_data(&Value::Object(data))
                .ok_or(Error::InvalidArgument("invalid reply target"))?;
            construct::<ReplyTargetNode>(
                tx,
                value
                    .as_object()
                    .ok_or(Error::InvalidArgument("invalid reply target"))?,
            )
        }
        "agent-activity" => {
            if !is_agent_activity_data(&Value::Object(data.clone())) {
                return Err(Error::InvalidArgument("invalid activity data"));
            }
            Ok(tx.create(AgentActivityNode(data))?.key())
        }
        "magic-chip" => construct::<MagicChipNode>(tx, &data),
        "contact-mention" => construct::<ContactMentionNode>(tx, &data),
        "date-mention" => construct::<DateMentionNode>(tx, &data),
        "group-mention" => construct::<GroupMentionNode>(tx, &data),
        "equation" => construct::<EquationNode>(tx, &data),
        "paste" => construct::<PasteNode>(tx, &data),
        "watermark" => construct::<WatermarkNode>(tx, &data),
        _ => Err(Error::InvalidArgument("unsupported envelope node")),
    }
}
pub(super) fn unknown(tx: &mut Transaction<'_>, name: &str) -> Result<NodeKey> {
    Ok(tx
        .create(UnknownMentionNode {
            name: Maybe::Value(name.into()),
        })?
        .key())
}
pub(super) fn export(
    spec: &Envelope,
    cx: &mut lexical_markdown::ExportCx<'_>,
    node: NodeKey,
) -> Result<Option<String>> {
    if cx.state().node(node).map(|n| n.type_name()) != Some(spec.ty) {
        return Ok(None);
    }
    if let Some(data) = cx.state().get::<AgentActivityNode>(node) {
        let body = to_js_json_string(&Value::Object(data.0.clone()))
            .replace('<', "\\u003c")
            .replace('\u{2028}', "\\u2028")
            .replace('\u{2029}', "\\u2029");
        return Ok(Some(format!("<{}>{body}</{}>", spec.tag, spec.tag)));
    }
    let json = cx.state().export_node(node)?;
    let mut data = Map::new();
    for field in spec.fields {
        if *field == "expanded" && json.get("expanded") != Some(&Value::Bool(true)) {
            continue;
        }
        if spec.ty == "connect-app"
            && *field == "target"
            && json.get("target").and_then(Value::as_str) != Some("harness")
        {
            continue;
        }
        if spec.ty == "account-manager-request" && *field == "id" {
            if let Some(id) = json.get("grantId") {
                data.insert("id".into(), id.clone());
            }
            continue;
        }
        if let Some(value) = json.get(*field) {
            data.insert((*field).into(), value.clone());
        }
    }
    let mut body = to_js_json_string(&Value::Object(data));
    match spec.ty {
        "paste" | "snapshot" | "html-render" => {
            body = body.replace('<', "\\u003c").replace('>', "\\u003e")
        }
        "agent-context" | "agent-activity" => {
            body = body
                .replace('<', "\\u003c")
                .replace('\u{2028}', "\\u2028")
                .replace('\u{2029}', "\\u2029")
        }
        "reply-target" | "agent-session-mention" => body = body.replace('<', "\\u003c"),
        _ => {}
    }
    Ok(Some(format!("<{}>{body}</{}>", spec.tag, spec.tag)))
}
