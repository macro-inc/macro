use super::{OutlookApiClientRepository, transport::invalid_response};
use crate::domain::{
    models::{AccessToken, CalendarPart, EmailApiError},
    ports::MailboxCalendarClient,
};
use reqwest::Method;

impl MailboxCalendarClient for OutlookApiClientRepository {
    async fn get_calendar_parts(
        &self,
        token: &AccessToken,
        message: &str,
    ) -> Result<Vec<CalendarPart>, EmailApiError> {
        let response = self
            .request(
                token,
                Method::GET,
                self.endpoint(&["me", "messages", message, "$value"])?,
                None,
            )
            .await?;
        let bytes = response
            .bytes()
            .await
            .map_err(|_| EmailApiError::Transient {
                message: "Microsoft message download was interrupted".into(),
            })?;
        let mime = mailparse::parse_mail(&bytes).map_err(|_| invalid_response())?;
        let mut parts = Vec::new();
        collect_calendar_parts(&mime, "0", &mut parts)?;
        Ok(parts)
    }
}

fn collect_calendar_parts(
    mime: &mailparse::ParsedMail<'_>,
    path: &str,
    parts: &mut Vec<CalendarPart>,
) -> Result<(), EmailApiError> {
    if mime.ctype.mimetype.eq_ignore_ascii_case("text/calendar") {
        parts.push(CalendarPart {
            part_id: Some(path.to_owned()),
            filename: mime
                .get_content_disposition()
                .params
                .get("filename")
                .cloned()
                .or_else(|| mime.ctype.params.get("name").cloned()),
            mime_type: "text/calendar".into(),
            inline_data: Some(mime.get_body_raw().map_err(|_| invalid_response())?),
            provider_attachment_id: None,
        });
    }
    // Attached messages are separate messages; their invitations are not this
    // message's actionable invitation. MIME children are only multipart bodies.
    for (index, part) in mime.subparts.iter().enumerate() {
        collect_calendar_parts(part, &format!("{path}.{index}"), parts)?;
    }
    Ok(())
}
