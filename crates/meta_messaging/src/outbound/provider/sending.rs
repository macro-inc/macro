//! Provider request construction and honest classification of external outcomes.

use super::*;

impl HttpMetaProvider {
    pub(super) async fn send_impl(
        &self,
        c: &Connection,
        token: &AccessToken,
        prepared: &PreparedReply,
    ) -> ProviderSendResult {
        let response = match self
            .client
            .post(self.endpoint(c.provider, &[c.account_id.as_str(), "messages"]))
            .bearer_auth(token.expose())
            .json(&prepared.provider_document)
            .send()
            .await
        {
            Ok(response) => response,
            Err(_) => return ProviderSendResult::Unknown,
        };
        let status = response.status();
        let retry = response
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(30)
            .clamp(5, 3600);
        let bytes = match bounded_bytes(response, 1024 * 1024).await {
            Ok(bytes) => bytes,
            Err(_) => return ProviderSendResult::Unknown,
        };
        let data: Value = match serde_json::from_slice(&bytes) {
            Ok(data) => data,
            Err(_) => return ProviderSendResult::Unknown,
        };
        let code = data["error"]["code"].as_i64();
        if status.as_u16() == 429 || is_rate_limit(code) {
            return ProviderSendResult::RetryAfter(retry);
        }
        if status.is_server_error() {
            return ProviderSendResult::Unknown;
        }
        if !status.is_success() || data.get("error").is_some() {
            return ProviderSendResult::Rejected(code.map_or_else(
                || format!("provider_http_{}", status.as_u16()),
                |c| format!("provider_error_{c}"),
            ));
        }
        let id = match c.provider {
            Provider::Whatsapp => data["messages"][0]["id"].as_str(),
            Provider::Instagram => data["message_id"].as_str(),
        };
        match id.and_then(|s| ProviderId::try_from(s.to_owned()).ok()) {
            Some(id) => ProviderSendResult::Accepted(id),
            None => ProviderSendResult::Unknown,
        }
    }

    pub(super) async fn prepare_reply_impl(
        &self,
        c: &Connection,
        token: &AccessToken,
        conversation: &Conversation,
        request: &SendReply,
        media: Option<&OutboundMedia>,
    ) -> PortResult<PreparedReply> {
        // Test senders verify recipient phones. An exact configured match is
        // already a valid provider ID; an unusable optional phone is ignored.
        let test_phone = self
            .developer
            .as_ref()
            .filter(|dev| c.developer_account && dev.phone_number_id == c.account_id)
            .and_then(|dev| {
                let phone = conversation
                    .customer_phone
                    .as_deref()?
                    .trim_start_matches('+');
                dev.recipients
                    .iter()
                    .find(|id| id.as_str() == phone)
                    .cloned()
            });
        let destination = if c.provider == Provider::Whatsapp
            && conversation.kind == crate::domain::groups::ConversationKind::Direct
            && let Some(phone) = test_phone
        {
            phone
        } else if c.provider == Provider::Whatsapp
            && conversation.kind == crate::domain::groups::ConversationKind::Direct
            && !conversation.customer_id.is_whatsapp_bsuid()
        {
            conversation
                .customer_phone
                .as_deref()
                .map(|phone| phone.trim_start_matches('+'))
                .map(str::to_owned)
                .map(ProviderId::try_from)
                .transpose()?
                .unwrap_or_else(|| conversation.customer_id.clone())
        } else {
            conversation.customer_id.clone()
        };
        if c.developer_account
            && conversation.kind == crate::domain::groups::ConversationKind::Direct
            && !self.developer.as_ref().is_some_and(|dev| {
                dev.phone_number_id == c.account_id && dev.recipients.contains(&destination)
            })
        {
            return Err(MessagingError::Invalid(
                "recipient is not authorized for this test number",
            )
            .into());
        }
        let mut rendered_text = match &request.message {
            ReplyContent::Text { text } => text.clone(),
            ReplyContent::Media { caption, .. } => caption.clone().unwrap_or_default(),
            _ => String::new(),
        };
        let mut payload = match c.provider {
            Provider::Whatsapp => {
                let mut payload =
                    json!({"messaging_product":"whatsapp","recipient_type":"individual"});
                if conversation.kind == crate::domain::groups::ConversationKind::Group {
                    payload["recipient_type"] = json!("group");
                    payload["to"] = json!(destination.as_str());
                } else if destination.is_whatsapp_bsuid() {
                    payload["recipient"] = json!(destination.as_str());
                } else if (6..=15).contains(&destination.as_str().len())
                    && destination.as_str().bytes().all(|b| b.is_ascii_digit())
                {
                    payload["to"] = json!(destination.as_str());
                } else {
                    return Err(MessagingError::Invalid("WhatsApp has not provided an addressable phone number or business-scoped user ID").into());
                }
                payload
            }
            Provider::Instagram => json!({"recipient":{"id":conversation.customer_id.as_str()}}),
        };
        match &request.message {
            ReplyContent::Text { text } => match c.provider {
                Provider::Whatsapp => {
                    payload["type"] = json!("text");
                    payload["text"] = json!({"body":text,"preview_url":false});
                }
                Provider::Instagram => {
                    payload["message"] = json!({"text":text});
                }
            },
            ReplyContent::Template {
                template_id,
                language,
                parameters,
            } => {
                if c.provider != Provider::Whatsapp {
                    return Err(MessagingError::Invalid("templates require WhatsApp").into());
                }
                // Re-read approval on dispatch, including queued sends whose template
                // was paused after the composer first displayed it.
                let template = self
                    .templates(c, token)
                    .await?
                    .into_iter()
                    .find(|t| t.id == *template_id && t.language == *language)
                    .ok_or(MessagingError::Invalid(
                        "template is no longer approved for this account/language",
                    ))?;
                if conversation.kind == crate::domain::groups::ConversationKind::Group
                    && !matches!(template.category.as_deref(), Some("MARKETING" | "UTILITY"))
                {
                    return Err(MessagingError::Invalid(
                        "this template category is unsupported for groups",
                    )
                    .into());
                }
                let components = template_parameters(&template, parameters)?;
                rendered_text =
                    crate::domain::templates::render_text(&template.components, parameters)?;
                payload["type"] = json!("template");
                payload["template"] = json!({"name":template.name,"language":{"code":template.language},"components":components});
            }
            ReplyContent::Media { kind, caption, .. } => {
                let media =
                    media.ok_or(MessagingError::Invalid("authorized attachment is missing"))?;
                crate::domain::meta_policy::media::validate(
                    c.provider,
                    *kind,
                    &media.file.mime_type,
                    media.file.bytes.len(),
                    caption.as_deref(),
                )?;
                if c.provider == Provider::Whatsapp {
                    let form = reqwest::multipart::Form::new()
                        .text("messaging_product", "whatsapp")
                        .text("type", media.file.mime_type.clone())
                        .part(
                            "file",
                            reqwest::multipart::Part::bytes(media.file.bytes.clone())
                                .file_name(media.file.filename.clone())
                                .mime_str(&media.file.mime_type)
                                .map_err(|_| {
                                    MessagingError::Invalid("invalid attachment MIME type")
                                })?,
                        );
                    let response = self
                        .client
                        .post(self.endpoint(c.provider, &[c.account_id.as_str(), "media"]))
                        .bearer_auth(token.expose())
                        .multipart(form)
                        .send()
                        .await
                        .map_err(|_| MessagingError::Unavailable)?;
                    let uploaded = checked_json(response).await?;
                    let kind = match kind {
                        MediaKind::Image => "image",
                        MediaKind::Audio => "audio",
                        MediaKind::Video => "video",
                        MediaKind::Document => "document",
                    };
                    payload["type"] = json!(kind);
                    payload[kind] = json!({"id":required(&uploaded,"id")?});
                    if kind != "audio"
                        && let Some(caption) = caption
                    {
                        payload[kind]["caption"] = json!(caption);
                    }
                    if kind == "document" {
                        payload[kind]["filename"] = json!(media.file.filename);
                    }
                } else {
                    if caption.as_ref().is_some_and(|s| !s.is_empty()) {
                        return Err(MessagingError::Invalid(
                            "send Instagram captions as a separate text reply",
                        )
                        .into());
                    }
                    let kind = match kind {
                        MediaKind::Image => "image",
                        MediaKind::Audio => "audio",
                        MediaKind::Video => "video",
                        MediaKind::Document => "file",
                    };
                    let url = media.url.as_ref().ok_or(MessagingError::Unavailable)?;
                    payload["message"] = json!({"attachment":{"type":kind,"payload":{"url":url}}});
                }
            }
        }
        if let Some(reply) = &request.reply_to {
            match c.provider {
                Provider::Whatsapp => payload["context"] = json!({"message_id":reply.as_str()}),
                Provider::Instagram => payload["reply_to"] = json!({"mid":reply.as_str()}),
            }
        }
        if c.provider == Provider::Instagram && request.human_support {
            payload["tag"] = json!("HUMAN_AGENT");
        }
        Ok(PreparedReply {
            rendered_text,
            provider_document: payload,
        })
    }
}

fn template_parameters(
    template: &Template,
    values: &[String],
) -> Result<Vec<Value>, MessagingError> {
    let layout = crate::domain::templates::text_parameters(&template.components)?;
    if layout.len() != values.len() || values.iter().any(|v| v.trim().is_empty()) {
        return Err(MessagingError::Invalid(
            "template parameter count does not match the approved text",
        ));
    }
    let mut result = Vec::new();
    for kind in ["header", "body"] {
        let parameters = layout
            .iter()
            .zip(values)
            .filter(|(p, _)| p.component == kind)
            .map(|(p, value)| {
                let mut param = json!({"type":"text","text":value});
                if let Some(name) = &p.name {
                    param["parameter_name"] = json!(name);
                }
                param
            })
            .collect::<Vec<_>>();
        if !parameters.is_empty() {
            result.push(json!({"type":kind,"parameters":parameters}));
        }
    }
    Ok(result)
}
