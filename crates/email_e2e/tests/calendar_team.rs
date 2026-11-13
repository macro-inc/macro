//! Team calendars: what teammates see of each other's out-of-office time,
//! and when their open clients are told it changed.

use email_e2e::chrono::Duration;
use email_e2e::gmail_emulator::NewEvent;
use email_e2e::{
    Calendar, DEFAULT_TIMEOUT, Report, ServiceRequest, Stack, StackOptions, User, events,
    eventually,
};
use serde_json::{Value, json};
use uuid::Uuid;

/// Google's id for a user's own calendar.
const PRIMARY: &str = "primary";
/// The Outlook emulator's name for a mailbox's own calendar.
const DEFAULT: &str = "default";
/// The stand-in that receives what the services tell open clients.
const CONNECTION_GATEWAY: &str = "connection-gateway";

async fn calendar_stack() -> Result<Stack, Report> {
    Stack::start_with(StackOptions {
        calendar: true,
        ..StackOptions::default()
    })
    .await
}

/// Puts `members` in one team, owned by the first.
async fn make_team(stack: &Stack, members: &[&User]) -> Result<(), Report> {
    let team = Uuid::now_v7();
    let owner = members.first().map(|user| user.macro_id().to_owned());
    sqlx::query("INSERT INTO team (id, name, owner_id) VALUES ($1, 'Team', $2)")
        .bind(team)
        .bind(owner)
        .execute(stack.db())
        .await?;
    for (index, member) in members.iter().enumerate() {
        let role = if index == 0 { "owner" } else { "member" };
        sqlx::query(
            "INSERT INTO team_user (user_id, team_id, team_role) \
             VALUES ($1, $2, $3::team_role)",
        )
        .bind(member.macro_id())
        .bind(team)
        .bind(role)
        .execute(stack.db())
        .await?;
    }
    Ok(())
}

/// The out-of-office time `viewer` sees of their teammates around `day`.
async fn team_out_of_office(
    viewer: &Calendar,
    day: email_e2e::chrono::DateTime<email_e2e::chrono::Utc>,
) -> Result<Vec<Value>, Report> {
    let start = (day - Duration::days(1)).to_rfc3339();
    let end = (day + Duration::days(2)).to_rfc3339();
    let path = format!(
        "/calendar-events/team-out-of-office?start={}&end={}",
        urlencoding::encode(&start),
        urlencoding::encode(&end)
    );
    let listed = viewer.read(reqwest::Method::GET, &path, None).await?.ok()?;
    Ok(listed["items"].as_array().cloned().unwrap_or_default())
}

/// A calendar refresh the services sent to a user's open clients: who it
/// went to and what it said.
#[derive(Debug)]
struct Refresh {
    #[expect(dead_code, reason = "shown when an assertion fails")]
    path: String,
    message: Value,
}

fn refreshes(requests: &[ServiceRequest]) -> Vec<Refresh> {
    requests
        .iter()
        .filter(|request| request.service == CONNECTION_GATEWAY)
        .filter_map(|request| {
            let body = request.body.as_ref()?;
            if body["message_type"] != "refresh_calendar" {
                return None;
            }
            // The message travels as JSON text or as an object.
            let message = match &body["message"] {
                Value::String(text) => serde_json::from_str(text).ok()?,
                message => message.clone(),
            };
            Some(Refresh {
                path: request.path.clone(),
                message,
            })
        })
        .collect()
}

/// Waits for the refreshes one sync round sends after the first `seen`: one
/// to the inbox's owner and one to each of `teammates` teammates.
async fn refreshes_after(
    stack: &Stack,
    seen: usize,
    teammates: usize,
) -> Result<Vec<Refresh>, Report> {
    eventually(
        "the sync round to tell open clients",
        DEFAULT_TIMEOUT,
        async || {
            let mut all = refreshes(&stack.service_requests());
            let new = all.split_off(seen.min(all.len()));
            Ok((new.len() > teammates).then_some(new))
        },
    )
    .await
}

fn out_of_office(
    title: &str,
    start: email_e2e::chrono::DateTime<email_e2e::chrono::Utc>,
) -> NewEvent {
    events::google_with(
        title,
        start,
        json!({
            "eventType": "outOfOffice",
            "end": { "dateTime": (start + Duration::hours(8)).to_rfc3339() },
        }),
    )
}

/// A teammate who shares everything shows as out of office with the
/// event's title; one who never chose shows as out of office without it;
/// one who shares nothing does not show. Fails when the default hides a
/// teammate's absence, or when it gives away the title of an event its
/// owner did not share. (cal-team-ooo-overlay)
#[tokio::test(flavor = "multi_thread")]
async fn teammates_out_of_office_shows_by_what_each_shares() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let alan = stack.user("alan").await?;
    let edsger = stack.user("edsger").await?;
    make_team(&stack, &[&ada, &grace, &alan, &edsger]).await?;
    let day = events::hour_in_days(3);
    for user in [&ada, &grace, &alan, &edsger] {
        stack
            .gmail()
            .add_mailbox(&email_e2e::gmail_emulator::SeedMailbox {
                email: user.email().to_owned(),
                ..Default::default()
            })?;
    }
    for away in [&grace, &alan, &edsger] {
        stack
            .gmail()
            .add_event(away.email(), PRIMARY, out_of_office("Vacation", day))?;
    }
    for user in [&ada, &grace, &alan, &edsger] {
        user.link_gmail_with_calendar().await?;
    }
    for away in [&grace, &alan, &edsger] {
        away.calendar()?.wait_for_event("Vacation").await?;
    }
    alan.calendar()?
        .put("/team-sharing", &json!({ "sharing": "all" }))
        .await?
        .ok()?;
    edsger
        .calendar()?
        .put("/team-sharing", &json!({ "sharing": "none" }))
        .await?
        .ok()?;

    let mut seen: Vec<(String, Option<String>)> = team_out_of_office(&ada.calendar()?, day)
        .await?
        .iter()
        .map(|item| {
            (
                item["ownerId"].as_str().unwrap_or_default().to_owned(),
                item["title"].as_str().map(str::to_owned),
            )
        })
        .collect();
    seen.sort();
    assert_eq!(
        seen,
        [
            (alan.macro_id().to_owned(), Some("Vacation".to_owned())),
            (grace.macro_id().to_owned(), None),
        ]
    );

    stack.finish().await
}

/// Open clients are told to reload teammates' out-of-office time only when
/// it changed: renaming or deleting an ordinary meeting says it did not,
/// changing an out-of-office event says it did. Fails when every sync says
/// it changed, which makes every teammate's client reload the overlay on
/// every calendar change in the team. (cal-team-ooo-overlay)
#[tokio::test(flavor = "multi_thread")]
async fn clients_reload_team_out_of_office_only_when_it_changed() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    make_team(&stack, &[&ada, &grace]).await?;
    let day = events::hour_in_days(3);
    stack
        .gmail()
        .add_mailbox(&email_e2e::gmail_emulator::SeedMailbox {
            email: grace.email().to_owned(),
            ..Default::default()
        })?;
    let vacation =
        stack
            .gmail()
            .add_event(grace.email(), PRIMARY, out_of_office("Vacation", day))?;
    let standup = stack.gmail().add_event(
        grace.email(),
        PRIMARY,
        events::google("Standup", day + Duration::days(1)),
    )?;
    let (vacation, standup) = (
        vacation["id"].as_str().unwrap_or_default().to_owned(),
        standup["id"].as_str().unwrap_or_default().to_owned(),
    );
    grace.link_gmail_with_calendar().await?;
    let calendar = grace.calendar()?;
    calendar.wait_for_event("Standup").await?;
    calendar.wait_until_synced(grace.email()).await?;

    let flags = |new: &[Refresh]| -> Vec<Value> {
        new.iter()
            .map(|refresh| refresh.message["team_ooo_changed"].clone())
            .collect()
    };

    // An ordinary meeting is renamed.
    let seen = refreshes(&stack.service_requests()).len();
    let rename = NewEvent::from_json(json!({ "summary": "Standup, renamed" }));
    stack
        .gmail()
        .change_event(grace.email(), PRIMARY, &standup, rename)?;
    calendar.wait_for_event("Standup, renamed").await?;
    let new = refreshes_after(&stack, seen, 1).await?;
    assert_eq!(flags(&new), [json!(false), json!(false)], "{new:?}");
    assert!(
        new.iter()
            .any(|refresh| refresh.message["event"] == "synced"),
        "{new:?}"
    );
    assert!(
        new.iter()
            .any(|refresh| refresh.message["event"] == "team_sharing_changed"),
        "{new:?}"
    );
    calendar.wait_until_synced(grace.email()).await?;

    // An ordinary meeting is deleted.
    let seen = seen + new.len();
    stack
        .gmail()
        .delete_event(grace.email(), PRIMARY, &standup)?;
    calendar.wait_until_gone("Standup, renamed").await?;
    let new = refreshes_after(&stack, seen, 1).await?;
    assert_eq!(flags(&new), [json!(false), json!(false)], "{new:?}");
    calendar.wait_until_synced(grace.email()).await?;

    // The out-of-office event changes.
    let seen = seen + new.len();
    let longer = NewEvent::from_json(json!({ "summary": "Vacation, longer" }));
    stack
        .gmail()
        .change_event(grace.email(), PRIMARY, &vacation, longer)?;
    calendar.wait_for_event("Vacation, longer").await?;
    let new = refreshes_after(&stack, seen, 1).await?;
    assert_eq!(flags(&new), [json!(true), json!(true)], "{new:?}");

    stack.finish().await
}

/// A teammate whose calendar is in Outlook shows as out of office like one
/// whose calendar is at Google. Fails while Outlook calendars never count
/// as ready for the team overlay, so Outlook users' absences are invisible
/// to their team. (cal-team-ooo-overlay)
#[tokio::test(flavor = "multi_thread")]
#[ignore = "known bug: cal-team-ooo-overlay"]
async fn an_outlook_teammates_out_of_office_shows_to_the_team() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    make_team(&stack, &[&ada, &grace]).await?;
    let day = events::hour_in_days(3);
    stack
        .gmail()
        .add_mailbox(&email_e2e::gmail_emulator::SeedMailbox {
            email: ada.email().to_owned(),
            ..Default::default()
        })?;
    stack
        .outlook()
        .add_mailbox(&email_e2e::outlook_emulator::SeedMailbox {
            email: grace.email().to_owned(),
            ..Default::default()
        })?;
    let vacation = events::outlook_with(
        "Vacation",
        day,
        json!({ "showAs": "oof", "end": events::graph_time(day + Duration::hours(8)) }),
    );
    stack
        .outlook()
        .add_event(grace.email(), DEFAULT, &vacation)?;
    ada.link_gmail_with_calendar().await?;
    grace.link_outlook_with_calendar().await?;
    let own = grace.calendar()?.wait_for_event("Vacation").await?;
    assert_eq!(
        own["event"]["sources"][0]["eventType"], "out_of_office",
        "{own}"
    );

    let seen = team_out_of_office(&ada.calendar()?, day).await?;
    let owners: Vec<_> = seen.iter().map(|item| item["ownerId"].clone()).collect();
    assert_eq!(owners, [json!(grace.macro_id())], "{seen:?}");

    stack.finish().await
}
