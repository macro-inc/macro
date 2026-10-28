use super::*;
use crate::domain::booking_links::{BookingLinkDraft, BookingLinkListing};
use ai_toolset::{RequestContext, ToolSet};
use serde_json::{Value, json};
use std::sync::Mutex;
use uuid::Uuid;

#[derive(Default)]
struct Scheduling {
    writes: Mutex<Vec<(&'static str, String, Option<Uuid>, BookingLinkDraft)>>,
}
impl BookingLinks for Scheduling {
    async fn list_links(
        &self,
        _: &str,
        _: Option<Uuid>,
        _: Option<&str>,
    ) -> Result<BookingLinkListing, Error> {
        unreachable!("mutation tests do not discover links")
    }
    async fn create_link(
        &self,
        user: &str,
        team: Option<Uuid>,
        draft: BookingLinkDraft,
    ) -> Result<BookingLink, Error> {
        self.writes
            .lock()
            .unwrap()
            .push(("create", user.into(), team, draft.clone()));
        Ok(BookingLink {
            profile_id: Uuid::nil(),
            event_type_id: Uuid::nil(),
            revision: 1,
            draft,
        })
    }
    async fn edit_link(
        &self,
        user: &str,
        team: Option<Uuid>,
        event: Uuid,
        revision: i64,
        draft: BookingLinkDraft,
    ) -> Result<BookingLink, Error> {
        self.writes
            .lock()
            .unwrap()
            .push(("edit", user.into(), team, draft.clone()));
        Ok(BookingLink {
            profile_id: Uuid::nil(),
            event_type_id: event,
            revision: revision + 1,
            draft,
        })
    }
}
fn args() -> Value {
    json!({"teamId": null, "draft": {
        "event": {"title":"Intro", "slug":"intro", "description":"", "durationMinutes":30, "location":"Office", "googleMeet":false, "enabled":true, "mode":"individual", "hosts":["macro|owner@macro.com"], "beforeMinutes":0, "afterMinutes":0, "noticeMinutes":60, "horizonDays":30, "intervalMinutes":30, "dailyLimit":null, "requiresConfirmation":false, "questions":[]},
        "schedule":{"name":"Working hours", "timeZone":"UTC", "weekly":(0..7).map(|day| json!({"day":day, "windows":[{"start":"09:00", "end":"17:00"}]})).collect::<Vec<_>>(), "overrides":[]}
    }})
}

#[tokio::test]
async fn mutations_require_confirmation_and_execute_without_elicitation() {
    for tool in ["CreateBookingLink", "EditBookingLink"] {
        let service = Arc::new(Scheduling::default());
        let context = BookingLinkToolContext {
            service: service.clone(),
            public_origin: "https://macro.com".into(),
        };
        let tools = booking_link_toolset();
        assert!(!tools.user_tools.contains_key(tool));
        let mut args = args();
        if tool == "EditBookingLink" {
            args["eventTypeId"] = json!(Uuid::nil());
            args["expectedRevision"] = json!(3);
        }
        for confirmation in [None, Some(""), Some(" \n\t")] {
            if let Some(quote) = confirmation {
                args["userConfirmation"] = json!(quote);
            }
            let response = tools
                .try_tool_call(
                    context.clone(),
                    RequestContext::new(
                        serde_json::from_value(json!("macro|owner@macro.com")).unwrap(),
                    ),
                    tool,
                    &args,
                )
                .await;
            assert!(
                response.is_err() || response.unwrap().is_err(),
                "{tool} must reject missing or blank approval"
            );
            assert!(service.writes.lock().unwrap().is_empty());
        }
        args["userConfirmation"] = json!("Yes, create the link with those details.");
        let response = tools
            .try_tool_call(
                context,
                RequestContext::new(
                    serde_json::from_value(json!("macro|owner@macro.com")).unwrap(),
                ),
                tool,
                &args,
            )
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            response["url"],
            "https://macro.com/app/book/00000000-0000-0000-0000-000000000000/intro"
        );
        assert_eq!(response["draft"], args["draft"]);
        assert_eq!(
            response["revision"],
            if tool == "EditBookingLink" { 4 } else { 1 }
        );
        let writes = service.writes.lock().unwrap();
        assert_eq!(writes.len(), 1);
        assert_eq!(writes[0].1, "macro|owner@macro.com");
        assert_eq!(writes[0].2, None);
        assert_eq!(serde_json::to_value(&writes[0].3).unwrap(), args["draft"]);
    }
}
