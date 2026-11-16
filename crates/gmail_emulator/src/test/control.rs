use super::*;

const SEED: &str = r#"
clock: "2026-03-01T09:00:00Z"
mailboxes:
  - email: ada@example.com
    name: Ada Example
    labels:
      - name: Receipts
    messages:
      - from: Grace <grace@example.com>
        subject: Invoice 42
        text: Please find the invoice attached.
        labels: [INBOX, UNREAD, Label_1]
        date: "2026-02-27T10:00:00Z"
  - email: bob@example.com
"#;

#[tokio::test]
async fn the_control_api_seeds_delivers_injects_and_reports() {
    let emulator = GmailEmulator::start(Seed::default()).await.unwrap();
    let http = reqwest::Client::new();
    let control = format!("{}/_emulator", emulator.base_url());

    let seeded = http
        .post(format!("{control}/seed"))
        .body(SEED)
        .send()
        .await
        .unwrap();
    assert_eq!(seeded.status().as_u16(), 200);
    let state: serde_json::Value = http
        .get(format!("{control}/state"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(state["mailboxes"][0]["messages"], 1);
    assert!(
        state["now"]
            .as_str()
            .unwrap()
            .starts_with("2026-03-01T09:00")
    );

    let delivered: serde_json::Value = http
        .post(format!("{control}/mailboxes/ada@example.com/messages"))
        .json(&serde_json::json!({ "from": "alan@example.com", "subject": "New", "text": "Hello" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(delivered["history_id"], 1002);

    let token: serde_json::Value = http
        .post(format!("{control}/mailboxes/ada@example.com/access-tokens"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let ada = token["access_token"].as_str().unwrap();
    let client = client(&emulator);
    let receipts = client.list_messages(ada, 10, &["Label_1"]).await.unwrap();
    assert_eq!(receipts.len(), 1);
    let seeded_message = client
        .get_message(ada, &receipts[0])
        .await
        .unwrap()
        .unwrap();
    assert_eq!(seeded_message.internal_date, "1772186400000");

    let fault = http
        .post(format!("{control}/faults"))
        .json(&serde_json::json!({ "route": "messages.get", "error": "unavailable", "times": 1 }))
        .send()
        .await
        .unwrap();
    assert_eq!(fault.status().as_u16(), 200);
    let failed = client.get_message(ada, &receipts[0]).await.unwrap_err();
    assert_eq!(failed.status().unwrap().as_u16(), 503);

    let requests: Vec<crate::RequestRecord> = http
        .get(format!("{control}/requests?route=messages.get"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let statuses: Vec<u16> = requests.iter().map(|request| request.status).collect();
    assert_eq!(statuses, vec![200, 503]);
    assert_eq!(requests[0].mailbox.as_deref(), Some(ADA));

    let unknown = http
        .post(format!("{control}/mailboxes/nobody@example.com/messages"))
        .json(&serde_json::json!({ "subject": "x" }))
        .send()
        .await
        .unwrap();
    assert_eq!(unknown.status().as_u16(), 404);
}

#[tokio::test]
async fn the_authentication_service_stand_in_answers_like_the_real_route() {
    let emulator = two_mailboxes().await;
    let http = reqwest::Client::new();
    let route = format!(
        "{}/internal/google_access_token",
        emulator.authentication_service_url()
    );
    let ask = |email: &'static str| {
        http.get(&route)
            .query(&[("fusionauth_user_id", "fusion-1"), ("email", email)])
            .send()
    };

    let granted: serde_json::Value = ask(ADA).await.unwrap().json().await.unwrap();
    let access = granted["access_token"].as_str().unwrap();
    assert_eq!(
        client(&emulator)
            .get_profile(access)
            .await
            .unwrap()
            .email_address,
        ADA
    );

    assert_eq!(
        ask("nobody@example.com").await.unwrap().status().as_u16(),
        404
    );
    emulator.revoke_grant(ADA).unwrap();
    assert_eq!(ask(ADA).await.unwrap().status().as_u16(), 403);
}

#[tokio::test]
async fn the_example_seed_file_starts_an_emulator() {
    let seed = Seed::parse(include_str!("../../seed.example.yaml")).unwrap();

    let emulator = GmailEmulator::start(seed).await.unwrap();

    let sizes: Vec<(String, usize, usize)> = emulator
        .mailboxes()
        .into_iter()
        .map(|mailbox| (mailbox.email, mailbox.messages, mailbox.threads))
        .collect();
    assert_eq!(
        sizes,
        vec![
            (ADA.to_string(), 6, 4),
            (BOB.to_string(), 2, 2),
            ("carol@example.com".to_string(), 0, 0),
        ]
    );

    let calendars: Vec<(String, usize)> = emulator
        .calendars(ADA)
        .unwrap()
        .into_iter()
        .map(|calendar| (calendar.summary, calendar.events))
        .collect();
    assert_eq!(
        calendars,
        vec![
            ("Ada Example".to_string(), 3),
            ("Holidays".to_string(), 1),
            ("Team".to_string(), 1),
        ]
    );
    // Bob holds his own event and the standup Ada invited him to.
    assert_eq!(emulator.calendars(BOB).unwrap()[0].events, 2);
}

#[tokio::test]
async fn the_control_api_puts_events_on_a_calendar_and_reports_what_it_holds() {
    let emulator = GmailEmulator::start(Seed::default()).await.unwrap();
    let http = reqwest::Client::new();
    let control = format!("{}/_emulator", emulator.base_url());
    let seed = r#"
mailboxes:
  - email: ada@example.com
    calendars:
      - summary: Ada
        time_zone: Europe/Paris
        events:
          - id: lunch
            summary: Lunch
            start: { dateTime: "2026-11-12T12:00:00+01:00" }
            end: { dateTime: "2026-11-12T13:00:00+01:00" }
            attendees: [{ email: grace@example.com }]
"#;
    let seeded = http
        .post(format!("{control}/seed"))
        .body(seed)
        .send()
        .await
        .unwrap();
    assert_eq!(seeded.status().as_u16(), 200);
    let primary = format!("{control}/mailboxes/ada@example.com/calendars/primary");
    let json = |response: reqwest::Response| async move {
        let status = response.status().as_u16();
        (status, response.json::<serde_json::Value>().await.unwrap())
    };

    let added = http
        .post(format!("{control}/mailboxes/ada@example.com/calendars"))
        .json(&serde_json::json!({ "secondary": true, "summary": "Side project" }))
        .send()
        .await
        .unwrap();
    let (_, added) = json(added).await;
    assert!(
        added["id"]
            .as_str()
            .unwrap()
            .ends_with("@group.calendar.google.com")
    );
    let (_, calendars) = json(
        http.get(format!("{control}/mailboxes/ada@example.com/calendars"))
            .send()
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(calendars[0]["time_zone"], "Europe/Paris");
    assert_eq!(calendars[1]["summary"], "Side project");

    let dinner = serde_json::json!({
        "summary": "Dinner",
        "start": { "dateTime": "2026-11-12T19:00:00+01:00" },
        "end": { "dateTime": "2026-11-12T21:00:00+01:00" },
    });
    let (_, dinner) = json(
        http.post(format!("{primary}/events"))
            .json(&dinner)
            .send()
            .await
            .unwrap(),
    )
    .await;
    let dinner_id = dinner["id"].as_str().unwrap();
    let (status, _) = json(
        http.patch(format!("{primary}/events/{dinner_id}"))
            .json(&serde_json::json!({ "location": "Chez Ada" }))
            .send()
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(status, 200);
    let (_, answered) = json(
        http.post(format!("{primary}/events/lunch/responses"))
            .json(&serde_json::json!({ "attendee": "grace@example.com", "response": "accepted" }))
            .send()
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(answered["attendees"][0]["responseStatus"], "accepted");
    let deleted = http
        .delete(format!("{primary}/events/lunch"))
        .send()
        .await
        .unwrap();
    assert_eq!(deleted.status().as_u16(), 200);

    let (_, events) = json(http.get(format!("{primary}/events")).send().await.unwrap()).await;
    let held: Vec<(&str, &str)> = events
        .as_array()
        .unwrap()
        .iter()
        .map(|event| {
            (
                event["summary"].as_str().unwrap(),
                event["status"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(held, vec![("Dinner", "confirmed"), ("Lunch", "cancelled")]);
    // Times are shown in the calendar's zone, as Google answers them.
    assert_eq!(events[0]["start"]["dateTime"], "2026-11-12T19:00:00+01:00");
    assert_eq!(events[0]["location"], "Chez Ada");

    let unknown = http
        .get(format!(
            "{control}/mailboxes/ada@example.com/calendars/nope/events"
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(unknown.status().as_u16(), 404);
    let invalid = http
        .post(format!("{primary}/events"))
        .json(&serde_json::json!({ "summary": "No time" }))
        .send()
        .await
        .unwrap();
    assert_eq!(invalid.status().as_u16(), 400);
    let expired = http
        .post(format!("{primary}/sync-tokens/expire"))
        .send()
        .await
        .unwrap();
    assert_eq!(expired.status().as_u16(), 200);
}
