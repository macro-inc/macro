//! Microsoft Graph calendar adapter using the same transport and admission as mail.
mod automatic_decline;
mod conference_body;
mod normalize;
mod recurrence;
mod replacement;
#[cfg(test)]
mod test;
mod zones;

use super::OutlookApiClientRepository;
use crate::domain::{
    models::{AccessToken, EmailApiError, MailboxAccess, StreamToken},
    ports::ScopedMailboxRepository,
};
use calendar_events::domain::{models::*, outlook::*, ports::*};
use reqwest::Method;
use serde_json::{Value, json};
use std::collections::BTreeSet;
use url::Url;
use uuid::Uuid;

// Named MAPI property owned by Macro. Email and extra popup reminders are dispatched by
// Macro; Graph's single native reminder remains the nearest one to the start.
const CREATION_ID: &str =
    "String {81f532e3-7ace-4e0b-bae9-312ce0d50c8c} Name MacroCalendarCreation";
const APPOINTMENT_SEQUENCE_ID: &str = "Integer {00062002-0000-0000-C000-000000000046} Id 0x8201";
const PREFERENCES_ID: &str =
    "String {81f532e3-7ace-4e0b-bae9-312ce0d50c8c} Name MacroCalendarPreferences";

fn invalid() -> CalendarProviderError {
    CalendarProviderError::new(
        CalendarProviderErrorKind::Permanent,
        "Microsoft returned an invalid calendar response",
    )
}
fn unsupported(message: &str) -> CalendarProviderError {
    CalendarProviderError::new(CalendarProviderErrorKind::Permanent, message)
}
fn error(error: EmailApiError) -> CalendarProviderError {
    let kind = match &error {
        EmailApiError::AuthRequired => CalendarProviderErrorKind::ReauthRequired,
        EmailApiError::OutdatedCursor => CalendarProviderErrorKind::SyncTokenExpired,
        EmailApiError::Transient { .. } | EmailApiError::RateLimited { .. } => {
            CalendarProviderErrorKind::Transient
        }
        _ => CalendarProviderErrorKind::Permanent,
    };
    CalendarProviderError::new(
        kind,
        if matches!(error, EmailApiError::Conflict) {
            "The event changed in Outlook. Refresh it before editing again."
        } else {
            "Microsoft calendar request failed"
        },
    )
}
fn string<'a>(value: &'a Value, key: &str) -> Result<&'a str, CalendarProviderError> {
    value[key]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(invalid)
}
fn access(binding: CalendarGrantBinding) -> MailboxAccess {
    MailboxAccess {
        link_id: binding.link_id,
        sync_generation: binding.sync_generation,
        grant_generation: binding.grant_generation,
    }
}

impl OutlookApiClientRepository {
    async fn calendar_creations(
        &self,
        token: &AccessToken,
        target: &ProviderCalendarTarget,
        key: &str,
    ) -> Result<Vec<Value>, CalendarProviderError> {
        let mut url =
            self.calendar_endpoint(&["me", "calendars", &target.provider_calendar_id, "events"])?;
        url.query_pairs_mut().append_pair("$filter",&format!("singleValueExtendedProperties/any(ep:ep/id eq '{CREATION_ID}' and ep/value eq '{key}')"));
        let events = self.calendar_pages(token, url).await?.0;
        if events
            .iter()
            .any(|v| v["transactionId"].as_str() != Some(key))
        {
            return Err(unsupported(
                "The event creation marker no longer matches. Review the event in Outlook.",
            ));
        }
        Ok(events)
    }
    async fn check_calendar_conference(
        &self,
        token: &AccessToken,
        target: &ProviderCalendarTarget,
        change: Option<ConferenceChange>,
    ) -> Result<(), CalendarProviderError> {
        if matches!(
            change,
            Some(ConferenceChange::MicrosoftTeams | ConferenceChange::ProviderDefault)
        ) {
            let calendar = self
                .calendar_get(
                    token,
                    self.calendar_endpoint(&["me", "calendars", &target.provider_calendar_id])?,
                )
                .await?;
            if !calendar["allowedOnlineMeetingProviders"]
                .as_array()
                .is_some_and(|ps| ps.iter().any(|p| p.as_str() == Some("teamsForBusiness")))
            {
                return Err(unsupported(
                    "This Microsoft calendar cannot create Teams meetings. Use a Macro call or an existing meeting link.",
                ));
            }
        }
        Ok(())
    }

    fn calendar_scope(
        &self,
        target: &ProviderCalendarTarget,
    ) -> Result<Self, CalendarProviderError> {
        if target.provider != CalendarProvider::Outlook {
            return Err(invalid());
        }
        let binding = target
            .binding
            .filter(|b| b.link_id == target.email_link_id)
            .ok_or_else(invalid)?;
        Ok(self.for_mailbox(access(binding)))
    }
    fn calendar_endpoint(&self, segments: &[&str]) -> Result<Url, CalendarProviderError> {
        self.endpoint(segments).map_err(error)
    }
    async fn calendar_get(
        &self,
        token: &AccessToken,
        url: Url,
    ) -> Result<Value, CalendarProviderError> {
        self.get(token, url).await.map_err(error)
    }
    async fn calendar_pages(
        &self,
        token: &AccessToken,
        mut url: Url,
    ) -> Result<(Vec<Value>, Option<String>), CalendarProviderError> {
        let mut seen = BTreeSet::new();
        let mut values = vec![];
        loop {
            if !seen.insert(url.to_string()) {
                return Err(invalid());
            }
            let page = self.calendar_get(token, url).await?;
            values.extend(
                page["value"]
                    .as_array()
                    .ok_or_else(invalid)?
                    .iter()
                    .cloned(),
            );
            if let Some(next) = page["@odata.nextLink"].as_str() {
                url = self
                    .continuation(&StreamToken::new(next.to_owned()))
                    .map_err(error)?;
            } else {
                let delta = page["@odata.deltaLink"].as_str().map(str::to_owned);
                if let Some(delta) = &delta {
                    self.continuation(&StreamToken::new(delta.clone()))
                        .map_err(error)?;
                }
                return Ok((values, delta));
            }
        }
    }
    async fn calendar_event(
        &self,
        token: &AccessToken,
        target: &ProviderCalendarTarget,
        id: &str,
    ) -> Result<Option<Value>, CalendarProviderError> {
        let mut url = self.calendar_endpoint(&[
            "me",
            "calendars",
            &target.provider_calendar_id,
            "events",
            id,
        ])?;
        url.query_pairs_mut().append_pair(
            "$expand",
            &format!("singleValueExtendedProperties($filter=id eq '{PREFERENCES_ID}' or id eq '{APPOINTMENT_SEQUENCE_ID}')"),
        );
        match self.get(token, url).await {
            Ok(event) => Ok(Some(event)),
            Err(EmailApiError::NotFound) => Ok(None),
            Err(err) => Err(error(err)),
        }
    }
    async fn calendar_instances(
        &self,
        token: &AccessToken,
        target: &ProviderCalendarTarget,
        master: &str,
    ) -> Result<Vec<Value>, CalendarProviderError> {
        let mut url = self.calendar_endpoint(&["me", "events", master, "instances"])?;
        url.query_pairs_mut()
            .append_pair("startDateTime", &target.range.starts_at.to_rfc3339())
            .append_pair("endDateTime", &target.range.ends_at.to_rfc3339())
            .append_pair("$top", "1000")
            .append_pair(
                "$expand",
                &format!(
                    "singleValueExtendedProperties($filter=id eq '{APPOINTMENT_SEQUENCE_ID}' or id eq '{PREFERENCES_ID}')"
                ),
            );
        Ok(self.calendar_pages(token, url).await?.0)
    }
    async fn calendar_echo(
        &self,
        token: &AccessToken,
        target: &ProviderCalendarTarget,
        master: Value,
    ) -> Result<CalendarEventUpsert, CalendarProviderError> {
        let instances = if master["type"].as_str() == Some("seriesMaster") {
            self.calendar_instances(token, target, string(&master, "id")?)
                .await?
        } else {
            vec![master.clone()]
        };
        normalize::projection(target, master, instances)
    }
    async fn calendar_refresh(
        &self,
        token: &AccessToken,
        target: &ProviderCalendarTarget,
        id: &str,
    ) -> Result<Option<CalendarEventUpsert>, CalendarProviderError> {
        let event = self.calendar_event(token, target, id).await?;
        match event {
            Some(master) => self.calendar_echo(token, target, master).await.map(Some),
            None => Ok(None),
        }
    }
    async fn patch_calendar_event(
        &self,
        token: &AccessToken,
        current: &Value,
        body: &Value,
    ) -> Result<(), CalendarProviderError> {
        let version = string(current, "@odata.etag")?;
        self.conditional_request(
            token,
            Method::PATCH,
            self.calendar_endpoint(&["me", "events", string(current, "id")?])?,
            Some(body),
            Some(version),
        )
        .await
        .map_err(error)?;
        Ok(())
    }
    async fn delete_calendar_event(
        &self,
        token: &AccessToken,
        current: &Value,
    ) -> Result<(), CalendarProviderError> {
        let result = self
            .conditional_request(
                token,
                Method::DELETE,
                self.calendar_endpoint(&["me", "events", string(current, "id")?])?,
                None,
                Some(string(current, "@odata.etag")?),
            )
            .await;
        match result {
            Ok(_) | Err(EmailApiError::NotFound) => Ok(()),
            Err(err) => Err(error(err)),
        }
    }
    async fn instance_at(
        &self,
        token: &AccessToken,
        target: &ProviderCalendarTarget,
        master: &Value,
        key: &str,
    ) -> Result<Option<Value>, CalendarProviderError> {
        if master["type"].as_str() != Some("seriesMaster") {
            return Err(unsupported("This event is not a recurring series"));
        }
        for instance in self
            .calendar_instances(token, target, string(master, "id")?)
            .await?
        {
            if normalize::original(&instance)?.is_some_and(|v| v.occurrence_key() == key) {
                return Ok(Some(instance));
            }
        }
        Ok(None)
    }
}

impl OutlookCalendarReader for OutlookApiClientRepository {
    async fn calendars(
        &self,
        token: &str,
        binding: CalendarGrantBinding,
    ) -> Result<Vec<OutlookCalendar>, CalendarProviderError> {
        let api = self.for_mailbox(access(binding));
        let token = AccessToken::new(token.to_owned());
        let settings = api
            .calendar_get(&token, api.calendar_endpoint(&["me", "mailboxSettings"])?)
            .await?;
        let zone = zones::zone(settings["timeZone"].as_str().unwrap_or("UTC"))
            .ok_or_else(invalid)?
            .name()
            .to_owned();
        let (calendars, _) = api
            .calendar_pages(&token, api.calendar_endpoint(&["me", "calendars"])?)
            .await?;
        calendars
            .into_iter()
            .map(|c| {
                Ok(OutlookCalendar {
                    calendar: ProviderCalendar {
                        provider_calendar_id: string(&c, "id")?.into(),
                        name: c["name"].as_str().unwrap_or("Calendar").into(),
                        description: None,
                        time_zone: Some(zone.clone()),
                        color: c["hexColor"]
                            .as_str()
                            .filter(|c| !c.is_empty())
                            .map(str::to_owned),
                        access_role: Some(
                            if c["canEdit"].as_bool() == Some(true) {
                                "writer"
                            } else {
                                "reader"
                            }
                            .into(),
                        ),
                        is_primary: c["isDefaultCalendar"].as_bool() == Some(true),
                        is_selected: true,
                        default_reminders: vec![EventReminderOverride {
                            method: "popup".into(),
                            minutes: 15,
                        }],
                    },
                    online_meeting_providers: c["allowedOnlineMeetingProviders"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|v| v.as_str().map(str::to_owned))
                        .collect(),
                })
            })
            .collect()
    }
    async fn calendar_page(
        &self,
        token: &str,
        target: &ProviderCalendarTarget,
        primary: bool,
        cursor: Option<&str>,
    ) -> Result<OutlookCalendarPage, CalendarProviderError> {
        let api = self.calendar_scope(target)?;
        let token = AccessToken::new(token.to_owned());
        let url = if let Some(cursor) = cursor {
            api.continuation(&StreamToken::new(cursor.to_owned()))
                .map_err(error)?
        } else {
            // Only the primary calendar has v1.0 delta; other calendars use
            // complete bounded calendarView snapshots, without beta APIs.
            let mut url = if primary {
                api.calendar_endpoint(&["me", "calendarView", "delta"])?
            } else {
                api.calendar_endpoint(&[
                    "me",
                    "calendars",
                    &target.provider_calendar_id,
                    "calendarView",
                ])?
            };
            url.query_pairs_mut()
                .append_pair("startDateTime", &target.range.starts_at.to_rfc3339())
                .append_pair("endDateTime", &target.range.ends_at.to_rfc3339());
            if !primary {
                url.query_pairs_mut().append_pair("$top", "1000");
            }
            url
        };
        let page = api.calendar_get(&token, url).await?;
        let next = page["@odata.nextLink"].as_str().map(str::to_owned);
        let delta = page["@odata.deltaLink"].as_str().map(str::to_owned);
        for cursor in next.iter().chain(delta.iter()) {
            api.continuation(&StreamToken::new(cursor.clone()))
                .map_err(error)?;
        }
        if next.is_none() && primary && delta.is_none() {
            return Err(invalid());
        }
        let mut members = vec![];
        let mut removed = vec![];
        for event in page["value"].as_array().ok_or_else(invalid)? {
            let id = string(event, "id")?;
            if !event["@removed"].is_null() {
                removed.push(id.to_owned());
            } else {
                members.push((
                    id.to_owned(),
                    event["seriesMasterId"].as_str().unwrap_or(id).to_owned(),
                ));
            }
        }
        Ok(OutlookCalendarPage {
            members,
            removed,
            next,
            delta,
        })
    }
    async fn refresh_calendar_event(
        &self,
        token: &str,
        target: &ProviderCalendarTarget,
        id: &str,
    ) -> Result<Option<CalendarEventUpsert>, CalendarProviderError> {
        self.calendar_scope(target)?
            .calendar_refresh(&AccessToken::new(token.to_owned()), target, id)
            .await
    }
}

fn attendee_body(attendees: &[CalendarAttendeeInput]) -> Value {
    json!(attendees.iter().map(|a|json!({"emailAddress":{"address":a.email},"type":if a.is_optional {"optional"} else {"required"}})).collect::<Vec<_>>())
}

/// Teams owns its invitation block. Preserve it when an editor supplies only
/// user description text; never reconstruct dial-in/passcode details ourselves.
fn preserve_meeting_details(
    description: &str,
    current: Option<&Value>,
) -> Result<String, CalendarProviderError> {
    let Some(current) = current.filter(|v| v["isOnlineMeeting"].as_bool() == Some(true)) else {
        return Ok(description.into());
    };
    let existing = current["body"]["content"].as_str().unwrap_or_default();
    let Some(join) = current["onlineMeeting"]["joinUrl"]
        .as_str()
        .or(current["onlineMeetingUrl"].as_str())
    else {
        return Err(unsupported(
            "Outlook has not finished preparing this online meeting. Try the description edit again shortly.",
        ));
    };
    if description.contains(join) {
        return Ok(description.into());
    }
    let (_, meeting) = conference_body::split(existing, join)?;
    Ok(format!("{description}{meeting}"))
}

fn patch_body(
    patch: &CalendarEventPatch,
    current: Option<&Value>,
) -> Result<Value, CalendarProviderError> {
    let mut body = json!({});
    if let Some(title) = &patch.title {
        body["subject"] = json!(title);
    }
    if let Some(description) = &patch.description {
        body["body"] =
            json!({"contentType":"html","content":preserve_meeting_details(description,current)?});
    }
    if let Some(location) = &patch.location {
        body["location"] = json!({"displayName":location});
    }
    if let Some(time) = &patch.time {
        let (start, end, _, _) = normalize::time_body(time)?;
        body["start"] = start;
        body["end"] = end;
        body["isAllDay"] = json!(matches!(time, EventTime::AllDay { .. }));
    }
    if let Some(attendees) = &patch.attendees {
        body["attendees"] = attendee_body(attendees);
    }
    if let Some(lines) = &patch.recurrence_lines {
        let time = patch
            .time
            .clone()
            .or_else(|| current.and_then(|v| normalize::event_time(v).ok()))
            .ok_or_else(invalid)?;
        body["recurrence"] = recurrence::to_graph(lines, &time)?;
    }
    if let Some(visibility) = patch.visibility {
        body["sensitivity"] = json!(match visibility {
            EventVisibility::Private => "private",
            EventVisibility::Confidential => "confidential",
            _ => "normal",
        });
    }
    if let Some(transparency) = patch.transparency {
        body["showAs"] = json!(if transparency == EventTransparency::Transparent {
            "free"
        } else {
            "busy"
        });
    }
    let mut preferences = current
        .map(normalize::preferences)
        .unwrap_or_else(|| json!({}));
    let mut preferences_changed = false;
    if let Some(ooo) = &patch.out_of_office {
        body["showAs"] = json!("oof");
        let previous: Option<AutomaticDeclinePolicy> = preferences
            .get("automaticDecline")
            .cloned()
            .and_then(|v| serde_json::from_value(v).ok());
        let policy = match previous {
            Some(mut policy)
                if current.is_some_and(|event| event["showAs"].as_str() == Some("oof"))
                    && policy.properties.auto_decline_mode == ooo.auto_decline_mode =>
            {
                policy.properties = ooo.clone();
                policy
            }
            _ => AutomaticDeclinePolicy {
                id: Uuid::now_v7(),
                enabled_at: chrono::Utc::now(),
                properties: ooo.clone(),
            },
        };
        preferences["automaticDecline"] = serde_json::to_value(policy).map_err(|_| invalid())?;
        preferences_changed = true;
    }
    if let Some(reminders) = &patch.reminders {
        if reminders
            .overrides
            .iter()
            .any(|r| !matches!(r.method.as_str(), "popup" | "email"))
        {
            return Err(unsupported("Choose an email or notification reminder."));
        }
        // Graph exposes no per-calendar default reminder setting. Macro's
        // Outlook default is an explicit 15-minute notification, also published
        // in the calendar catalog so the editor and delivery worker agree.
        let minutes = if reminders.use_default {
            Some(15)
        } else {
            reminders
                .overrides
                .iter()
                .filter(|r| r.method == "popup")
                .map(|r| r.minutes)
                .min()
        };
        body["isReminderOn"] = json!(minutes.is_some());
        if let Some(minutes) = minutes {
            body["reminderMinutesBeforeStart"] = json!(minutes);
        }

        preferences["reminders"] = serde_json::to_value(reminders).map_err(|_| invalid())?;
        preferences["nativeReminderOn"] = body["isReminderOn"].clone();
        preferences["nativeReminderMinutes"] = body["reminderMinutesBeforeStart"].clone();
        preferences_changed = true;
    }
    if preferences_changed {
        body["singleValueExtendedProperties"] =
            json!([{"id":PREFERENCES_ID,"value":preferences.to_string()}]);
    }
    if let Some(conference) = patch.conference {
        match conference {
            ConferenceChange::ProviderDefault | ConferenceChange::MicrosoftTeams => {
                body["isOnlineMeeting"] = json!(true);
                body["onlineMeetingProvider"] = json!("teamsForBusiness");
            }
            ConferenceChange::GoogleMeet => {
                return Err(unsupported("Choose Microsoft Teams for an Outlook event"));
            }
            ConferenceChange::Removed
                if current.is_some_and(|v| v["isOnlineMeeting"].as_bool() == Some(true)) =>
            {
                return Err(unsupported(
                    "Microsoft does not allow removing an online meeting from an existing event. Create a replacement event without a meeting link.",
                ));
            }
            ConferenceChange::Removed => {}
        }
    }
    Ok(body)
}

impl CalendarMutationProvider for OutlookApiClientRepository {
    async fn delete_created_event(
        &self,
        token: &str,
        target: &ProviderCalendarTarget,
        key: Uuid,
    ) -> Result<Vec<String>, CalendarProviderError> {
        let api = self.calendar_scope(target)?;
        let token = AccessToken::new(token.to_owned());
        let key = creation_provider_id(key, &target.owner_id);
        let mut removed = vec![];
        for event in api.calendar_creations(&token, target, &key).await? {
            api.delete_calendar_event(&token, &event).await?;
            removed.push(string(&event, "id")?.to_owned());
        }
        Ok(removed)
    }

    async fn create_event(
        &self,
        token: &str,
        target: &ProviderCalendarTarget,
        draft: &CalendarEventDraft,
    ) -> Result<CalendarEventUpsert, CalendarProviderError> {
        let api = self.calendar_scope(target)?;
        let token = AccessToken::new(token.to_owned());
        let patch = CalendarEventPatch {
            title: Some(draft.title.clone()),
            description: draft.description.clone(),
            location: draft.location.clone(),
            time: Some(draft.time.clone()),
            attendees: Some(draft.attendees.clone()),
            recurrence_lines: Some(draft.recurrence_lines.clone()),
            visibility: draft.visibility,
            transparency: draft.transparency,
            reminders: Some(draft.reminders.clone().unwrap_or_else(|| {
                if draft.out_of_office.is_some() {
                    EventReminders {
                        use_default: false,
                        overrides: vec![],
                    }
                } else {
                    EventReminders::default()
                }
            })),
            conference: draft.conference,
            out_of_office: draft.out_of_office.clone(),
        };
        let mut body = patch_body(&patch, None)?;
        let key = creation_provider_id(
            draft.idempotency_key.unwrap_or_else(Uuid::new_v4),
            &target.owner_id,
        );
        if draft.idempotency_key.is_some() {
            let existing = api.calendar_creations(&token, target, &key).await?;
            if existing.len() > 1 {
                return Err(unsupported(
                    "Multiple events match this booking. Review them in Outlook before continuing.",
                ));
            }
            if let Some(existing) = existing.first() {
                return api
                    .calendar_refresh(&token, target, string(existing, "id")?)
                    .await?
                    .ok_or_else(invalid);
            }
        }
        api.check_calendar_conference(&token, target, draft.conference)
            .await?;
        body["transactionId"] = json!(key);
        if !body["singleValueExtendedProperties"].is_array() {
            body["singleValueExtendedProperties"] = json!([]);
        }
        body["singleValueExtendedProperties"]
            .as_array_mut()
            .ok_or_else(invalid)?
            .push(json!({"id":CREATION_ID,"value":key}));
        let created: Value = api
            .request(
                &token,
                Method::POST,
                api.calendar_endpoint(&[
                    "me",
                    "calendars",
                    &target.provider_calendar_id,
                    "events",
                ])?,
                Some(&body),
            )
            .await
            .map_err(error)?
            .json()
            .await
            .map_err(|_| invalid())?;
        api.calendar_refresh(&token, target, string(&created, "id")?)
            .await?
            .ok_or_else(invalid)
    }
    async fn update_event(
        &self,
        token: &str,
        target: &ProviderCalendarTarget,
        id: &str,
        patch: &CalendarEventPatch,
    ) -> Result<Option<CalendarEventUpsert>, CalendarProviderError> {
        let api = self.calendar_scope(target)?;
        let token = AccessToken::new(token.to_owned());
        let Some(current) = api.calendar_event(&token, target, id).await? else {
            return Ok(None);
        };
        let body = patch_body(patch, Some(&current))?;
        api.check_calendar_conference(&token, target, patch.conference)
            .await?;
        api.patch_calendar_event(&token, &current, &body).await?;
        api.calendar_refresh(&token, target, id).await
    }
    async fn update_event_instance(
        &self,
        token: &str,
        target: &ProviderCalendarTarget,
        id: &str,
        key: &str,
        patch: &CalendarEventPatch,
    ) -> Result<ProviderInstanceUpdateOutcome, CalendarProviderError> {
        let api = self.calendar_scope(target)?;
        let token = AccessToken::new(token.to_owned());
        let Some(master) = api.calendar_event(&token, target, id).await? else {
            return Ok(ProviderInstanceUpdateOutcome::SeriesGone);
        };
        let instance = api.instance_at(&token, target, &master, key).await?;
        if let Some(instance) = &instance {
            api.check_calendar_conference(&token, target, patch.conference)
                .await?;
            api.patch_calendar_event(&token, instance, &patch_body(patch, Some(instance))?)
                .await?;
        }
        match api.calendar_refresh(&token, target, id).await? {
            Some(echo) if instance.is_some() => {
                Ok(ProviderInstanceUpdateOutcome::Applied(Box::new(echo)))
            }
            Some(echo) => Ok(ProviderInstanceUpdateOutcome::OccurrenceGone(Box::new(
                echo,
            ))),
            None => Ok(ProviderInstanceUpdateOutcome::SeriesGone),
        }
    }
    async fn delete_event(
        &self,
        token: &str,
        target: &ProviderCalendarTarget,
        id: &str,
    ) -> Result<(), CalendarProviderError> {
        let api = self.calendar_scope(target)?;
        let token = AccessToken::new(token.to_owned());
        if let Some(current) = api.calendar_event(&token, target, id).await? {
            api.delete_calendar_event(&token, &current).await?;
        }
        Ok(())
    }
    async fn delete_event_instance(
        &self,
        token: &str,
        target: &ProviderCalendarTarget,
        id: &str,
        key: &str,
    ) -> Result<ProviderSeriesMutationOutcome, CalendarProviderError> {
        let api = self.calendar_scope(target)?;
        let token = AccessToken::new(token.to_owned());
        let Some(master) = api.calendar_event(&token, target, id).await? else {
            return Ok(ProviderSeriesMutationOutcome::Gone);
        };
        if let Some(instance) = api.instance_at(&token, target, &master, key).await? {
            api.delete_calendar_event(&token, &instance).await?;
        }
        Ok(match api.calendar_refresh(&token, target, id).await? {
            Some(echo) => ProviderSeriesMutationOutcome::Applied(Box::new(echo)),
            None => ProviderSeriesMutationOutcome::SeriesDeleted,
        })
    }
    async fn truncate_recurring_event(
        &self,
        token: &str,
        target: &ProviderCalendarTarget,
        id: &str,
        key: &str,
    ) -> Result<ProviderSeriesMutationOutcome, CalendarProviderError> {
        let api = self.calendar_scope(target)?;
        let token = AccessToken::new(token.to_owned());
        let Some(master) = api.calendar_event(&token, target, id).await? else {
            return Ok(ProviderSeriesMutationOutcome::Gone);
        };
        let Some(instance) = api.instance_at(&token, target, &master, key).await? else {
            return Err(unsupported(
                "This occurrence no longer exists. Refresh the calendar.",
            ));
        };
        let original = normalize::original(&instance)?.ok_or_else(invalid)?;
        let mut recurrence = master["recurrence"].clone();
        let zone = zones::zone(
            recurrence["range"]["recurrenceTimeZone"]
                .as_str()
                .or(master["originalStartTimeZone"].as_str())
                .unwrap_or("UTC"),
        )
        .ok_or_else(invalid)?;
        let date = match original {
            EventStart::Timed(start) => start.with_timezone(&zone).date_naive(),
            EventStart::AllDay(date) => date,
        };
        let start = chrono::NaiveDate::parse_from_str(
            string(&recurrence["range"], "startDate")?,
            "%Y-%m-%d",
        )
        .map_err(|_| invalid())?;
        if date <= start {
            api.delete_calendar_event(&token, &master).await?;
            return Ok(ProviderSeriesMutationOutcome::SeriesDeleted);
        }
        recurrence["range"]["type"] = json!("endDate");
        recurrence["range"]["endDate"] = json!(date.pred_opt().ok_or_else(invalid)?.to_string());
        recurrence["range"]
            .as_object_mut()
            .ok_or_else(invalid)?
            .remove("numberOfOccurrences");
        api.patch_calendar_event(&token, &master, &json!({"recurrence":recurrence}))
            .await?;
        Ok(match api.calendar_refresh(&token, target, id).await? {
            Some(echo) => ProviderSeriesMutationOutcome::Applied(Box::new(echo)),
            None => ProviderSeriesMutationOutcome::SeriesDeleted,
        })
    }
    async fn rsvp_event(
        &self,
        token: &str,
        target: &ProviderCalendarTarget,
        id: &str,
        actor: &ActorInboxes,
        response: AttendeeResponseStatus,
        scope: &CalendarRsvpScope,
    ) -> Result<ProviderRsvpOutcome, CalendarProviderError> {
        let api = self.calendar_scope(target)?;
        let token = AccessToken::new(token.to_owned());
        let Some(master) = api.calendar_event(&token, target, id).await? else {
            return Ok(ProviderRsvpOutcome::Gone);
        };
        let mut me = api.calendar_endpoint(&["me"])?;
        me.query_pairs_mut()
            .append_pair("$select", "mail,userPrincipalName");
        let me = api.calendar_get(&token, me).await?;
        let address = me["mail"]
            .as_str()
            .or(me["userPrincipalName"].as_str())
            .ok_or_else(invalid)?;
        if !actor.matches(address) || master["isOrganizer"].as_bool() == Some(true) {
            return Ok(ProviderRsvpOutcome::NotAttendee);
        }
        let event = match scope {
            CalendarRsvpScope::All => master.clone(),
            CalendarRsvpScope::ThisEvent { recurrence_id } => api
                .instance_at(&token, target, &master, recurrence_id)
                .await?
                .ok_or_else(|| unsupported("This occurrence no longer exists"))?,
        };
        let action = match response {
            AttendeeResponseStatus::Accepted => "accept",
            AttendeeResponseStatus::Tentative => "tentativelyAccept",
            AttendeeResponseStatus::Declined => "decline",
            AttendeeResponseStatus::NeedsAction => {
                return Err(unsupported(
                    "Outlook cannot reset a meeting response to unanswered",
                ));
            }
        };
        api.request(
            &token,
            Method::POST,
            api.calendar_endpoint(&["me", "events", string(&event, "id")?, action])?,
            Some(&json!({"sendResponse":true})),
        )
        .await
        .map_err(error)?;
        if let Some(echo) = api.calendar_refresh(&token, target, id).await? {
            return Ok(ProviderRsvpOutcome::Applied(Box::new(echo)));
        }
        // Outlook may remove a declined event from the attendee's calendar.
        // The successful response must not be reported as a failed RSVP.
        let mut echo = normalize::projection(target, master, vec![])?;
        for attendee in &mut echo.event.attendees {
            if attendee.email.eq_ignore_ascii_case(address) {
                attendee.response_status = response;
            }
        }
        Ok(ProviderRsvpOutcome::RespondedAndRemoved(Box::new(
            echo.event,
        )))
    }
    async fn stop_watch_channel(
        &self,
        _token: &str,
        _link: Uuid,
        _channel: &str,
        _resource: &str,
    ) -> Result<(), CalendarProviderError> {
        Err(unsupported(
            "Google watch channels cannot be closed through Microsoft Graph",
        ))
    }
}
