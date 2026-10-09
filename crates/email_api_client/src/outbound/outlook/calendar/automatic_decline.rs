use super::*;
use calendar_events::domain::outlook::automatic_decline::*;

impl AutomaticDeclineProvider for OutlookApiClientRepository {
    async fn away_occurrence(
        &self,
        token: &str,
        target: &ProviderCalendarTarget,
        id: &str,
        recurrence: Option<&str>,
    ) -> Result<Option<AwayOccurrence>, CalendarProviderError> {
        let api = self.calendar_scope(target)?;
        let token = AccessToken::new(token.to_owned());
        let Some(master) = api.calendar_event(&token, target, id).await? else {
            return Ok(None);
        };
        let occurrence = match recurrence {
            Some(recurrence) => match api.instance_at(&token, target, &master, recurrence).await? {
                Some(event) => event,
                None => return Ok(None),
            },
            None => master.clone(),
        };
        let own_preferences = normalize::preferences(&occurrence);
        let preferences = if own_preferences.get("automaticDecline").is_some() {
            own_preferences
        } else {
            normalize::preferences(&master)
        };
        let policy = if occurrence["showAs"].as_str() == Some("oof") {
            preferences
                .get("automaticDecline")
                .cloned()
                .map(serde_json::from_value)
                .transpose()
                .map_err(|_| invalid())?
        } else {
            None
        };
        let created = master["createdDateTime"]
            .as_str()
            .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
            .map(|value| value.with_timezone(&chrono::Utc))
            .ok_or_else(invalid)?;
        Ok(Some(AwayOccurrence {
            provider_id: string(&occurrence, "id")?.into(),
            starts_at: normalize::instant(&occurrence["start"])?,
            ends_at: normalize::instant(&occurrence["end"])?,
            created_at: created,
            is_organizer: occurrence["isOrganizer"]
                .as_bool()
                .or(master["isOrganizer"].as_bool())
                .ok_or_else(invalid)?,
            cancelled: occurrence["isCancelled"].as_bool().unwrap_or(false),
            response: normalize::response(occurrence["responseStatus"]["response"].as_str()),
            policy,
        }))
    }
    async fn decline_away_invitation(
        &self,
        token: &str,
        target: &ProviderCalendarTarget,
        invitation: &str,
        comment: Option<&str>,
    ) -> Result<AwaySubmissionOutcome, CalendarProviderError> {
        let api = self.calendar_scope(target)?;
        let result = api
            .request(
                &AccessToken::new(token.to_owned()),
                Method::POST,
                api.calendar_endpoint(&[
                    "me",
                    "calendars",
                    &target.provider_calendar_id,
                    "events",
                    invitation,
                    "decline",
                ])?,
                Some(&json!({"sendResponse":true,"comment":comment.unwrap_or_default()})),
            )
            .await;
        match result {
            Ok(_) => Ok(AwaySubmissionOutcome::Submitted),
            Err(EmailApiError::RateLimited { retry_after, .. }) => Ok(
                AwaySubmissionOutcome::Deferred(retry_after.map_or(60, |delay| {
                    u32::try_from(delay.as_secs().saturating_add(1)).unwrap_or(86400)
                })),
            ),
            Err(EmailApiError::AuthRequired) => Ok(AwaySubmissionOutcome::Deferred(300)),
            Err(failure) => Err(error(failure)),
        }
    }
}
