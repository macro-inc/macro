use super::*;
use crate::domain::{insights::InsightQuery, management::BookingChange};

#[tokio::test]
async fn reports_require_membership_and_preserve_range_semantics() {
    let service = TestService::new(
        Arc::new(Memory::default()),
        Arc::new(Calendar::default()),
        Members,
    );
    let team = Some(Uuid::now_v7());
    let query = InsightQuery {
        from: "2026-10-01".parse().unwrap(),
        to: "2026-10-31".parse().unwrap(),
        time_zone: chrono_tz::America::New_York,
        event_type_id: None,
        host_id: None,
    };
    assert!(matches!(
        service
            .booking_insights("outsider", team, query.clone())
            .await,
        Err(Error::Forbidden)
    ));
    let report = service
        .booking_insights("member", team, query.clone())
        .await
        .unwrap();
    assert_eq!(report.previous_from.to_string(), "2026-08-31");
    assert_eq!(report.previous_to.to_string(), "2026-09-30");
    assert_eq!(report.current.days.len(), 31);
    assert_eq!(report.current.counts.total, 0);
    let mut invalid = query;
    invalid.to = "2028-01-01".parse().unwrap();
    assert!(matches!(
        service.booking_insights("member", team, invalid).await,
        Err(Error::Invalid(_))
    ));
}

#[tokio::test]
async fn management_uses_existing_authorization_and_availability() {
    let service = TestService::new(
        Arc::new(Memory::default()),
        Arc::new(Calendar::default()),
        Members,
    );
    let p = service.save("admin", None, profile(None)).await.unwrap();
    let record = service
        .book(p.id, p.event_types[0].id, request())
        .await
        .unwrap();
    let id = record.booking.id;
    let date = record.booking.starts_at.date_naive();
    assert!(matches!(
        service.host_replacement_slots("outsider", id, date).await,
        Err(Error::Forbidden)
    ));
    assert!(matches!(
        service
            .change_booking("outsider", id, BookingChange::Cancel)
            .await,
        Err(Error::Forbidden)
    ));
    assert!(matches!(
        service
            .change_booking(
                "admin",
                id,
                BookingChange::Attendance {
                    attendance: BookingAttendance::Attended
                }
            )
            .await,
        Err(Error::Invalid(_))
    ));
    let slots = service
        .host_replacement_slots("admin", id, date)
        .await
        .unwrap();
    let replacement = slots
        .iter()
        .find(|slot| slot.starts_at != record.booking.starts_at)
        .unwrap();
    let moved = service
        .change_booking(
            "admin",
            id,
            BookingChange::Reschedule {
                starts_at: replacement.starts_at,
            },
        )
        .await
        .unwrap();
    assert_eq!(moved.starts_at, replacement.starts_at);
    assert_eq!(moved.reschedule_count, 1);
    assert_eq!(
        service
            .change_booking("admin", id, BookingChange::Cancel)
            .await
            .unwrap()
            .status,
        BookingStatus::Cancelled
    );
}

#[cfg(feature = "ai_tools")]
#[tokio::test]
async fn management_tools_read_save_and_reject_stale_or_unauthorized_writes() {
    use crate::inbound::toolset::{BookingManagementToolContext, booking_management_toolset};
    use ai_toolset::{RequestContext, ToolSet};
    use serde_json::json;
    let service = Arc::new(TestService::new(
        Arc::new(Memory::default()),
        Arc::new(Calendar::default()),
        Members,
    ));
    let team = Some(Uuid::now_v7());
    service.save("admin", team, profile(team)).await.unwrap();
    let context = BookingManagementToolContext {
        service: service.clone(),
        public_origin: String::new(),
    };
    let tools = booking_management_toolset();
    let request =
        || RequestContext::new(serde_json::from_value(json!("macro|host@example.com")).unwrap());
    // A personal read does not depend on externally supplied actor IDs.
    let personal = tools
        .try_tool_call(
            context.clone(),
            request(),
            "ReadBookingSettings",
            &json!({}),
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(personal["profile"]["revision"], 0);
    assert!(
        personal["pageUrl"]
            .as_str()
            .unwrap()
            .starts_with("/app/book/")
    );
    let mut changed = personal["profile"].clone();
    changed["name"] = json!("My new booking page");
    assert!(
        tools
            .try_tool_call(
                context.clone(),
                request(),
                "UpdateBookingSettings",
                &json!({"profile": changed, "userConfirmation": " "})
            )
            .await
            .unwrap()
            .is_err()
    );
    let saved = tools
        .try_tool_call(
            context.clone(),
            request(),
            "UpdateBookingSettings",
            &json!({"profile": changed, "userConfirmation": "Yes, save those settings."}),
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(saved["profile"]["name"], "My new booking page");
    assert_eq!(saved["profile"]["revision"], 1);
    assert!(
        tools
            .try_tool_call(
                context.clone(),
                request(),
                "UpdateBookingSettings",
                &json!({"profile": personal["profile"], "userConfirmation": "Yes, save those settings."})
            )
            .await
            .unwrap()
            .is_err()
    );
    assert!(
        tools
            .try_tool_call(
                context,
                request(),
                "ReadBookingSettings",
                &json!({"teamId": team})
            )
            .await
            .unwrap()
            .is_err()
    );
}
