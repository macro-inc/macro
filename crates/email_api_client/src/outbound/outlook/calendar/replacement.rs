//! Microsoft event-copy I/O. The calendar domain owns confirmation and step ordering.
use super::*;
use calendar_events::domain::replacement::*;
use chrono::{DateTime, Duration, NaiveDate};

const STEP_ID: &str =
    "String {81f532e3-7ace-4e0b-bae9-312ce0d50c8c} Name MacroCalendarReplacementStep";

fn changed() -> CalendarProviderError {
    unsupported(
        "The event changed in Outlook after the preview. Open both events to review them; no changed event has been overwritten or cancelled.",
    )
}
fn safe_event_url(event: &Value) -> Option<String> {
    let url = Url::parse(event["webLink"].as_str()?).ok()?;
    (url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && matches!(
            url.host_str(),
            Some("outlook.office365.com" | "outlook.office.com" | "outlook.live.com")
        ))
    .then(|| url.to_string())
}
fn marker(event: &Value, property: &str) -> Option<String> {
    event["singleValueExtendedProperties"]
        .as_array()?
        .iter()
        .find(|p| {
            p["id"]
                .as_str()
                .is_some_and(|id| id.eq_ignore_ascii_case(property))
        })?["value"]
        .as_str()
        .map(str::to_owned)
}
fn add_marker(body: &mut Value, property: &str, value: &str) {
    if !body["singleValueExtendedProperties"].is_array() {
        body["singleValueExtendedProperties"] = json!([]);
    }
    body["singleValueExtendedProperties"]
        .as_array_mut()
        .expect("initialized above")
        .push(json!({"id":property,"value":value}));
}
fn occurrence_date(id: &str) -> Result<NaiveDate, CalendarProviderError> {
    id.rsplit_once('.')
        .filter(|_| id.starts_with("OID."))
        .and_then(|(_, date)| date.parse().ok())
        .ok_or_else(invalid)
}
fn day_range(date: NaiveDate) -> OccurrenceRange {
    let start_date = date - Duration::days(2);
    let end_date = date + Duration::days(3);
    OccurrenceRange {
        starts_at: start_date.and_hms_opt(0, 0, 0).unwrap().and_utc(),
        ends_at: end_date.and_hms_opt(0, 0, 0).unwrap().and_utc(),
        start_date,
        end_date,
    }
}
fn key_date(key: &str) -> Result<NaiveDate, CalendarProviderError> {
    key.parse()
        .or_else(|_| DateTime::parse_from_rfc3339(key).map(|v| v.date_naive()))
        .map_err(|_| invalid())
}

/// Copy writable fields, preserving provider-native content beyond Macro's normalized subset.
fn copy_body(event: &Value, remove_conference: bool) -> Result<Value, CalendarProviderError> {
    if event["hasAttachments"].as_bool() == Some(true) {
        return Err(unsupported(
            "This event has Outlook attachments. Replace it in Outlook so its attachments are preserved.",
        ));
    }
    if event["isCancelled"].as_bool() == Some(true) {
        return Err(unsupported("This event is already cancelled."));
    }
    let mut body = json!({});
    for key in [
        "subject",
        "body",
        "location",
        "locations",
        "categories",
        "sensitivity",
        "showAs",
        "importance",
        "isAllDay",
        "isReminderOn",
        "reminderMinutesBeforeStart",
        "responseRequested",
        "allowNewTimeProposals",
        "hideAttendees",
        "recurrence",
    ] {
        if let Some(value) = event.get(key) {
            body[key] = value.clone();
        }
    }
    // GET defaults to UTC. Recreating a recurring series must keep its local wall-clock time.
    for (field, zone_field) in [
        ("start", "originalStartTimeZone"),
        ("end", "originalEndTimeZone"),
    ] {
        let name = event[zone_field]
            .as_str()
            .or(event["originalStartTimeZone"].as_str())
            .or(event[field]["timeZone"].as_str())
            .unwrap_or("UTC");
        let zone = zones::zone(name).ok_or_else(|| unsupported("This event uses a custom Outlook time zone. Replace it in Outlook to preserve the schedule."))?;
        body[field] = json!({"dateTime":normalize::instant(&event[field])?.with_timezone(&zone)
            .format("%Y-%m-%dT%H:%M:%S").to_string(),"timeZone":zone.name()});
    }
    // Attendee status and response timestamps must never be copied into a new invitation.
    body["attendees"] = Value::Array(
        event["attendees"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|a| json!({"emailAddress":a["emailAddress"],"type":a["type"]}))
            .collect(),
    );
    if let Some(prefs) = marker(event, PREFERENCES_ID) {
        add_marker(&mut body, PREFERENCES_ID, &prefs);
    }
    let old_join = event["onlineMeeting"]["joinUrl"]
        .as_str()
        .or(event["onlineMeetingUrl"].as_str());
    if let Some(join) = old_join {
        if let Some(content) = body["body"]["content"].as_str() {
            body["body"]["content"] = json!(conference_body::split(content, join)?.0);
        }
        if body["location"]["displayName"].as_str() == Some(join) {
            body["location"] = json!({"displayName":""});
        }
        if let Some(locations) = body["locations"].as_array_mut() {
            locations.retain(|v| v["displayName"].as_str() != Some(join));
        }
    }
    if !remove_conference && event["isOnlineMeeting"].as_bool() == Some(true) {
        if event["onlineMeetingProvider"].as_str() != Some("teamsForBusiness") {
            return Err(unsupported(
                "This meeting uses an online provider Microsoft cannot recreate. Choose Remove Teams or replace it in Outlook.",
            ));
        }
        body["isOnlineMeeting"] = json!(true);
        body["onlineMeetingProvider"] = json!("teamsForBusiness");
    }
    Ok(body)
}

impl OutlookApiClientRepository {
    async fn replacement_event(
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
        url.query_pairs_mut().append_pair("$expand", &format!("singleValueExtendedProperties($filter=id eq '{PREFERENCES_ID}' or id eq '{STEP_ID}')"));
        match self.get(token, url).await {
            Ok(event) => Ok(Some(event)),
            Err(EmailApiError::NotFound) => Ok(None),
            Err(e) => Err(error(e)),
        }
    }
    async fn replacement_exceptions(
        &self,
        token: &AccessToken,
        target: &ProviderCalendarTarget,
        master: &str,
    ) -> Result<(Value, Vec<Value>), CalendarProviderError> {
        let mut url = self.calendar_endpoint(&[
            "me",
            "calendars",
            &target.provider_calendar_id,
            "events",
            master,
        ])?;
        url.query_pairs_mut()
            .append_pair("$select", "id,exceptionOccurrences,cancelledOccurrences")
            .append_pair("$expand", "exceptionOccurrences($select=id,occurrenceId)");
        let series = self.calendar_get(token, url).await?;
        let mut exceptions = series["exceptionOccurrences"]
            .as_array()
            .ok_or_else(invalid)?
            .clone();
        if let Some(next) = series["exceptionOccurrences@odata.nextLink"].as_str() {
            exceptions.extend(
                self.calendar_pages(
                    token,
                    self.continuation(&StreamToken::new(next.into()))
                        .map_err(error)?,
                )
                .await?
                .0,
            );
        }
        Ok((series, exceptions))
    }
    async fn original_replacement_occurrence(
        &self,
        token: &AccessToken,
        target: &ProviderCalendarTarget,
        master: &Value,
        key: &str,
    ) -> Result<Option<Value>, CalendarProviderError> {
        if master["type"].as_str() != Some("seriesMaster") {
            return Err(unsupported("This event is not a recurring series"));
        }
        let (_, exceptions) = self
            .replacement_exceptions(token, target, string(master, "id")?)
            .await?;
        // An exception can move years away from its original slot. /instances filters its
        // current time, so resolve the complete exception relationship first.
        for reference in exceptions {
            let event = self
                .replacement_event(token, target, string(&reference, "id")?)
                .await?
                .ok_or_else(changed)?;
            if normalize::original(&event)?.is_some_and(|original| original.occurrence_key() == key)
            {
                return Ok(Some(event));
            }
        }
        let mut scoped = target.clone();
        scoped.range = day_range(key_date(key)?);
        self.instance_at(token, &scoped, master, key).await
    }
    async fn replacement_instance(
        &self,
        token: &AccessToken,
        target: &ProviderCalendarTarget,
        master: &str,
        date: NaiveDate,
    ) -> Result<Value, CalendarProviderError> {
        let mut url = self.calendar_endpoint(&["me", "events", master, "instances"])?;
        let range = day_range(date);
        url.query_pairs_mut()
            .append_pair("startDateTime", &range.starts_at.to_rfc3339())
            .append_pair("endDateTime", &range.ends_at.to_rfc3339())
            .append_pair(
                "$select",
                "id,occurrenceId,originalStart,originalStartTimeZone,isAllDay,start,end",
            )
            .append_pair("$top", "1000");
        let values = self.calendar_pages(token, url).await?.0;
        let mut matches = values.iter().filter(|v| {
            v["occurrenceId"]
                .as_str()
                .and_then(|id| occurrence_date(id).ok())
                == Some(date)
        });
        let matched = matches.next().ok_or_else(|| {
            unsupported("The replacement occurrence is not available yet. Check progress again.")
        })?;
        if matches.next().is_some() {
            return Err(invalid());
        }
        self.replacement_event(token, target, string(matched, "id")?)
            .await?
            .ok_or_else(invalid)
    }
    async fn verify_source_version(
        &self,
        token: &AccessToken,
        target: &ProviderCalendarTarget,
        source: &Value,
    ) -> Result<(), CalendarProviderError> {
        let current = self
            .replacement_event(token, target, string(source, "id")?)
            .await?
            .ok_or_else(changed)?;
        if current["@odata.etag"] != source["@odata.etag"] {
            return Err(changed());
        }
        Ok(())
    }
}

impl CalendarReplacementProvider for OutlookApiClientRepository {
    async fn inspect_replacement(
        &self,
        token: &str,
        target: &ProviderCalendarTarget,
        master_id: &str,
        recurrence_id: Option<&str>,
        remove_conference: bool,
    ) -> Result<ReplacementSnapshot, CalendarProviderError> {
        let api = self.calendar_scope(target)?;
        let token = AccessToken::new(token.to_owned());
        let master = api
            .replacement_event(&token, target, master_id)
            .await?
            .ok_or_else(invalid)?;
        let mut source = master.clone();
        if let Some(key) = recurrence_id {
            source = api
                .original_replacement_occurrence(&token, target, &master, key)
                .await?
                .ok_or_else(|| unsupported("This occurrence no longer exists."))?;
        }
        string(&source, "@odata.etag")?;
        let is_series = recurrence_id.is_none() && source["type"].as_str() == Some("seriesMaster");
        let mut occurrences = vec![];
        if is_series {
            let (series, exceptions) = api
                .replacement_exceptions(&token, target, master_id)
                .await?;
            if series["@odata.etag"] != source["@odata.etag"] {
                return Err(changed());
            }
            for exception in exceptions {
                let event = api
                    .replacement_event(&token, target, string(&exception, "id")?)
                    .await?
                    .ok_or_else(changed)?;
                let date = occurrence_date(string(&exception, "occurrenceId")?)?;
                occurrences.push(
                    json!({"date":date,"source":event,"body":copy_body(&event,remove_conference)?}),
                );
            }
            for cancelled in series["cancelledOccurrences"]
                .as_array()
                .ok_or_else(invalid)?
            {
                let date = occurrence_date(cancelled.as_str().ok_or_else(invalid)?)?;
                occurrences.push(json!({"date":date,"cancelled":true}));
            }
        }
        let mut body = copy_body(&source, remove_conference)?;
        if !is_series {
            body.as_object_mut()
                .ok_or_else(invalid)?
                .remove("recurrence");
        }
        api.verify_source_version(&token, target, &source).await?;
        Ok(ReplacementSnapshot {
            source_id: string(&source, "id")?.into(),
            is_organizer: source["isOrganizer"].as_bool() == Some(true),
            title: source["subject"].as_str().unwrap_or("").into(),
            time: normalize::event_time(&source)?,
            attendee_count: source["attendees"].as_array().map_or(0, Vec::len),
            is_series,
            remove_conference,
            provider_url: safe_event_url(&source),
            payload: json!({"source":source,"body":body}),
            occurrences,
        })
    }
    async fn event_url(
        &self,
        token: &str,
        target: &ProviderCalendarTarget,
        id: &str,
        recurrence_id: Option<&str>,
    ) -> Result<Option<String>, CalendarProviderError> {
        let api = self.calendar_scope(target)?;
        let token = AccessToken::new(token.to_owned());
        let Some(event) = api.replacement_event(&token, target, id).await? else {
            return Ok(None);
        };
        if let Some(key) = recurrence_id {
            return Ok(api
                .original_replacement_occurrence(&token, target, &event, key)
                .await?
                .as_ref()
                .and_then(safe_event_url));
        }
        Ok(safe_event_url(&event))
    }
    async fn prepare_replacement_write(
        &self,
        token: &str,
        target: &ProviderCalendarTarget,
        operation: &CalendarReplacement,
    ) -> Result<Value, CalendarProviderError> {
        let api = self.calendar_scope(target)?;
        let token = AccessToken::new(token.to_owned());
        let snapshot = &operation.snapshot;
        if operation.next_step == 0 {
            api.verify_source_version(&token, target, &snapshot.payload["source"])
                .await?;
            for occurrence in &snapshot.occurrences {
                if !occurrence["source"].is_null() {
                    api.verify_source_version(&token, target, &occurrence["source"])
                        .await?;
                }
            }
            let mut body = snapshot.payload["body"].clone();
            if body["isOnlineMeeting"].as_bool() == Some(true) {
                api.check_calendar_conference(
                    &token,
                    target,
                    Some(ConferenceChange::MicrosoftTeams),
                )
                .await?;
            }
            let key = creation_provider_id(operation.id, &target.owner_id);
            body["transactionId"] = json!(key);
            add_marker(&mut body, CREATION_ID, &key);
            return Ok(json!({"kind":"create","key":key,"body":body}));
        }
        if operation.next_step == snapshot.write_count() - 1 {
            if api
                .replacement_event(&token, target, &snapshot.source_id)
                .await?
                .is_some()
            {
                api.verify_source_version(&token, target, &snapshot.payload["source"])
                    .await?;
                for occurrence in &snapshot.occurrences {
                    if !occurrence["source"].is_null() {
                        api.verify_source_version(&token, target, &occurrence["source"])
                            .await?;
                    }
                }
            }
            return Ok(
                json!({"kind":"delete","source":snapshot.payload["source"],"replacementId":operation.replacement_provider_id}),
            );
        }
        let occurrence = snapshot
            .occurrences
            .get(operation.next_step as usize - 1)
            .ok_or_else(invalid)?;
        let created = operation
            .replacement_provider_id
            .as_deref()
            .ok_or_else(invalid)?;
        let date = string(occurrence, "date")?.parse().map_err(|_| invalid())?;
        let current = api
            .replacement_instance(&token, target, created, date)
            .await?;
        if occurrence["cancelled"].as_bool() == Some(true) {
            return Ok(json!({"kind":"delete","source":current}));
        }
        let mut body = occurrence["body"].clone();
        body.as_object_mut()
            .ok_or_else(invalid)?
            .remove("recurrence");
        // The series already owns its new conference. Never ask Graph to reset it on an instance.
        body.as_object_mut()
            .ok_or_else(invalid)?
            .remove("isOnlineMeeting");
        body.as_object_mut()
            .ok_or_else(invalid)?
            .remove("onlineMeetingProvider");
        if let Some(description) = body["body"]["content"].as_str() {
            body["body"] = json!({"contentType":"html", "content":preserve_meeting_details(description,Some(&current))?});
        }
        let key = format!("{}:{}", operation.id, operation.next_step);
        add_marker(&mut body, STEP_ID, &key);
        Ok(json!({"kind":"patch","source":current,"body":body,"key":key}))
    }
    async fn apply_replacement_write(
        &self,
        token: &str,
        target: &ProviderCalendarTarget,
        command: &Value,
        allow_create: bool,
    ) -> Result<ReplacementWriteOutcome, CalendarProviderError> {
        let api = self.calendar_scope(target)?;
        let token = AccessToken::new(token.to_owned());
        match string(command, "kind")? {
            "create" => {
                let key = string(command, "key")?;
                if !allow_create {
                    let existing = api.calendar_creations(&token, target, key).await?;
                    if existing.len() > 1 {
                        return Err(unsupported(
                            "Multiple events match this replacement. Review them in Outlook before continuing.",
                        ));
                    }
                    if let Some(event) = existing.first() {
                        let id = string(event, "id")?;
                        if api.replacement_event(&token, target, id).await?.is_none() {
                            return Err(changed());
                        }
                        return Ok(ReplacementWriteOutcome::Applied(Some(id.into())));
                    }
                    return Ok(ReplacementWriteOutcome::Unconfirmed);
                }
                let response = api
                    .request(
                        &token,
                        Method::POST,
                        api.calendar_endpoint(&[
                            "me",
                            "calendars",
                            &target.provider_calendar_id,
                            "events",
                        ])?,
                        Some(&command["body"]),
                    )
                    .await;
                let response = match response {
                    Ok(response) => response,
                    Err(
                        e @ (EmailApiError::AuthRequired
                        | EmailApiError::Forbidden
                        | EmailApiError::NotFound
                        | EmailApiError::OutdatedCursor
                        | EmailApiError::Conflict
                        | EmailApiError::RateLimited { .. }
                        | EmailApiError::Permanent { .. }),
                    ) => {
                        return Ok(ReplacementWriteOutcome::Rejected(error(e)));
                    }
                    Err(e) => return Err(error(e)),
                };
                let created: Value = response.json().await.map_err(|_| invalid())?;
                Ok(ReplacementWriteOutcome::Applied(Some(
                    string(&created, "id")?.into(),
                )))
            }
            "patch" | "delete" => {
                if let Some(created) = command["replacementId"].as_str()
                    && api
                        .replacement_event(&token, target, created)
                        .await?
                        .is_none()
                {
                    return Err(unsupported(
                        "The replacement event was removed. The original will not be cancelled.",
                    ));
                }
                let source = &command["source"];
                let id = string(source, "id")?;
                let current = api.replacement_event(&token, target, id).await?;
                if string(command, "kind")? == "delete" && current.is_none() {
                    return Ok(ReplacementWriteOutcome::Applied(None));
                }
                let current = current.ok_or_else(changed)?;
                if string(command, "kind")? == "patch"
                    && marker(&current, STEP_ID).as_deref() == command["key"].as_str()
                {
                    return Ok(ReplacementWriteOutcome::Applied(None));
                }
                if current["@odata.etag"] != source["@odata.etag"] {
                    return Err(changed());
                }
                if string(command, "kind")? == "patch" {
                    api.patch_calendar_event(&token, source, &command["body"])
                        .await?;
                } else {
                    api.delete_calendar_event(&token, source).await?;
                }
                Ok(ReplacementWriteOutcome::Applied(None))
            }
            _ => Err(invalid()),
        }
    }
    async fn replacement_echo(
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

#[cfg(test)]
mod test;
