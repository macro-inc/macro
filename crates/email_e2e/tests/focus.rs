//! Focus: the worker that classifies arriving mail, read the way the web
//! app reads it (Home's list and a thread's `focus`).
//!
//! The model the worker asks is a stand-in the scenario sets: it finds
//! worth Focus exactly the mail that holds the text the scenario named.
//! The worker's consumer group is one for every scenario, so these run one
//! at a time.

use email_e2e::chrono::{DateTime, Days, NaiveDate, SubsecRound as _, TimeDelta, Utc};
use email_e2e::{
    DEFAULT_TIMEOUT, Inbox, Mail, Provider, Report, Stack, StackOptions, User, eventually,
};
use serde_json::{Value, json};

const GRACE: &str = "Grace <grace@example.net>";
const GRACE_ADDRESS: &str = "grace@example.net";
const MALLORY: &str = "Mallory <mallory@example.net>";

const FOCUS: &str = "query { user { id emailFocus { id name \
     focus { isFocus category needsReply dueOn } } } }";
const THREAD_FOCUS: &str = "query($input: EmailThreadInput!) { \
     user { id emailThread(input: $input) { id focus { isFocus category } } } }";
const THREAD_LABELS: &str = "query($input: EmailThreadInput!) { \
     user { id emailThread(input: $input) { id focus { isFocus needsReply needsFollowUp } } } }";
const THREAD_CLASSIFIED_AT: &str = "query($input: EmailThreadInput!) { \
     user { id emailThread(input: $input) { id focus { classifiedAt } } } }";

/// How long before the scenario's meeting ends, or its wait for an answer
/// does, from when it starts: long enough for the worker to classify the
/// mail first, short enough to wait for.
const ENDS_IN: TimeDelta = TimeDelta::seconds(90);
/// Days the owner waits on an answer before a thread they wrote last on comes
/// back to Focus (`FOLLOW_UP_AFTER_DAYS` in `crates/email`'s Focus service).
const FOLLOW_UP_AFTER: TimeDelta = TimeDelta::days(3);

async fn focus_stack() -> Result<Stack, Report> {
    Stack::start_with(StackOptions {
        document_storage: true,
        focus: true,
        ..StackOptions::default()
    })
    .await
}

/// The threads Home lists for the user as worth their attention.
async fn on_home(user: &User) -> Result<Vec<Value>, Report> {
    let read = user.graphql(FOCUS, &json!({})).await?;
    Ok(read["user"]["emailFocus"]
        .as_array()
        .cloned()
        .unwrap_or_default())
}

/// Waits until Home lists exactly the threads with these names, and
/// answers them in order of name.
async fn wait_for_home(user: &User, names: &[&str]) -> Result<Vec<Value>, Report> {
    let mut seen = Vec::new();
    let waited = eventually(
        &format!("Home to list {names:?}"),
        DEFAULT_TIMEOUT,
        async || {
            let mut listed = on_home(user).await?;
            listed.sort_by_key(|thread| thread["name"].as_str().map(str::to_owned));
            let done = listed.iter().map(|thread| &thread["name"]).eq(names);
            seen = listed;
            Ok(done.then(|| seen.clone()))
        },
    )
    .await;
    waited.map_err(|error| rootcause::report!("{error}; Home listed {seen:?}"))
}

/// What the thread says of its place in Focus: `null` until it is classified.
async fn thread_focus(user: &User, thread_id: &str) -> Result<Value, Report> {
    let read = user
        .graphql(THREAD_FOCUS, &json!({ "input": { "threadId": thread_id } }))
        .await?;
    Ok(read["user"]["emailThread"]["focus"].clone())
}

/// Waits until the worker has classified the thread, and answers its `focus`.
async fn wait_until_classified(user: &User, thread_id: &str) -> Result<Value, Report> {
    eventually("the thread to be classified", DEFAULT_TIMEOUT, async || {
        let focus = thread_focus(user, thread_id).await?;
        Ok((!focus.is_null()).then_some(focus))
    })
    .await
}

/// Delivers mail and waits for it in the inbox; answers its thread's id.
async fn arrives(inbox: &Inbox, from: &str, subject: &str) -> Result<String, Report> {
    delivered(inbox, &Mail::new(from, subject, "Hello.")).await
}

/// Delivers this mail and waits for its thread in the inbox; answers the
/// thread's id.
async fn delivered(inbox: &Inbox, mail: &Mail) -> Result<String, Report> {
    let subject = mail.subject.as_str();
    inbox.deliver(mail)?;
    let preview = inbox.wait_for_preview("inbox", subject).await?;
    let id = preview["id"]
        .as_str()
        .ok_or_else(|| rootcause::report!("the preview of {subject} has no thread id"))?;
    Ok(id.to_owned())
}

/// The pushes that told the inbox's readers its Focus changed.
fn focus_pushes(stack: &Stack, inbox: &Inbox) -> Vec<Value> {
    let link_id = inbox.link_id().to_string();
    stack
        .service_requests()
        .into_iter()
        .filter(|request| request.service == "connection-gateway")
        .filter_map(|request| request.body)
        .filter(|body| {
            body["message_type"] == "refresh_email"
                && body["message"]["event"] == "focus_updated"
                && body["message"]["link_id"] == link_id.as_str()
        })
        .collect()
}

/// Mail the model finds worth the owner's attention is listed on Home, in
/// Focus, with the day it is due; mail it does not is classified as left
/// out and stays off Home; and the owner's open app is told to read Focus
/// again. Nothing changes at the provider.
///
/// When it fails: Home stays empty or lists everything whatever the model
/// answered, a thread never gets its verdict, or the list only changes
/// when the app is reloaded.
async fn mail_the_model_wants_is_in_focus_and_other_mail_is_not(
    provider: Provider,
) -> Result<(), Report> {
    let stack = focus_stack().await?;
    let due = NaiveDate::from_ymd_opt(2031, 5, 16).unwrap_or_default();
    let classifier = stack.focus_classifier()?;
    classifier.put_in_focus_when_mail_contains("Contract renewal");
    classifier.due_on_when_mail_contains("Contract renewal", due);
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    assert_eq!(on_home(&ada).await?, Vec::<Value>::new());

    let wanted = arrives(&inbox, MALLORY, "Contract renewal").await?;
    let digest = arrives(&inbox, MALLORY, "Weekly digest").await?;

    let verdict = wait_until_classified(&ada, &wanted).await?;
    assert_eq!(verdict, json!({ "isFocus": true, "category": "OTHER" }));
    let verdict = wait_until_classified(&ada, &digest).await?;
    assert_eq!(
        verdict,
        json!({ "isFocus": false, "category": "LOW_RELEVANCE" })
    );

    let listed = wait_for_home(&ada, &["Contract renewal"]).await?;
    assert_eq!(listed[0]["id"], wanted.as_str());
    assert_eq!(
        listed[0]["focus"],
        json!({
            "isFocus": true,
            "category": "OTHER",
            "needsReply": false,
            "dueOn": "2031-05-16",
        })
    );
    // The model was asked about each thread once, and decided.
    assert_eq!(classifier.times_asked_about("Contract renewal"), 1);
    assert_eq!(classifier.times_asked_about("Weekly digest"), 1);

    // The push is sent after the verdict is stored, so it may come after
    // Home shows the thread.
    let push = eventually(
        "a push telling the app Focus changed",
        DEFAULT_TIMEOUT,
        async || Ok(focus_pushes(&stack, &inbox).into_iter().next()),
    )
    .await?;
    assert!(
        push["entities"].to_string().contains(ada.macro_id()),
        "the push is not for the inbox's owner: {push}"
    );

    // Classifying is Macro's own: the mailbox is as it was delivered.
    let at_provider = inbox.provider_messages()?;
    assert_eq!(at_provider.len(), 2, "{at_provider:?}");
    assert!(
        at_provider
            .iter()
            .all(|message| message.in_inbox && !message.read && !message.starred),
        "{at_provider:?}"
    );

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_mail_the_model_wants_is_in_focus_and_other_mail_is_not() -> Result<(), Report> {
    mail_the_model_wants_is_in_focus_and_other_mail_is_not(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_mail_the_model_wants_is_in_focus_and_other_mail_is_not() -> Result<(), Report> {
    mail_the_model_wants_is_in_focus_and_other_mail_is_not(Provider::Outlook).await
}

/// How many mails the services have announced as received in the inbox.
async fn announced(stack: &Stack, inbox: &Inbox) -> Result<usize, Report> {
    Ok(stack
        .email_events(inbox.link_id())
        .await?
        .iter()
        .filter(|event| event["event_type"] == "email.message_received")
        .count())
}

/// Focus follows a sender between Signal and Noise. Grace's mail is in
/// Focus; once the owner marks her Noise her thread leaves Focus and her
/// next mail is not shown to the model at all, while another sender's
/// mail still is; marked Signal again, her thread is back and her next
/// mail is classified.
///
/// When it fails: mail of a sender the owner called Noise stays on Home or
/// keeps going to the model, or a sender called Signal again stays out of
/// Focus.
async fn a_senders_mail_leaves_focus_as_noise_and_returns_as_signal(
    provider: Provider,
) -> Result<(), Report> {
    let stack = focus_stack().await?;
    let classifier = stack.focus_classifier()?;
    // Everything Grace writes is worth Focus to the model, and so is one
    // mail of Mallory's.
    classifier.put_in_focus_when_mail_contains(GRACE_ADDRESS);
    classifier.put_in_focus_when_mail_contains("Quarterly figures");
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    let notes = arrives(&inbox, GRACE, "Compiler notes").await?;
    wait_for_home(&ada, &["Compiler notes"]).await?;
    // The thread says of itself what Home says of it.
    assert_eq!(thread_focus(&ada, &notes).await?["isFocus"], true);

    let rule = json!({ "email_address": GRACE_ADDRESS, "is_important": false });
    inbox.put("/email/filters", Some(&rule)).await?.ok()?;
    wait_for_home(&ada, &[]).await?;

    let announced_before = announced(&stack, &inbox).await?;
    let lunch = arrives(&inbox, GRACE, "Lunch on Friday").await?;
    // Proof that the worker passed her mail over: it has been announced,
    // and mail announced after it has been classified.
    eventually(
        "Grace's mail to be announced",
        DEFAULT_TIMEOUT,
        async || Ok((announced(&stack, &inbox).await? > announced_before).then_some(())),
    )
    .await?;
    arrives(&inbox, MALLORY, "Quarterly figures").await?;
    wait_for_home(&ada, &["Quarterly figures"]).await?;
    assert_eq!(classifier.times_asked_about("Lunch on Friday"), 0);
    assert_eq!(thread_focus(&ada, &lunch).await?, Value::Null);

    let rule = json!({ "email_address": GRACE_ADDRESS, "is_important": true });
    inbox.put("/email/filters", Some(&rule)).await?.ok()?;
    wait_for_home(&ada, &["Compiler notes", "Quarterly figures"]).await?;
    arrives(&inbox, GRACE, "Weekend plans").await?;
    wait_for_home(
        &ada,
        &["Compiler notes", "Quarterly figures", "Weekend plans"],
    )
    .await?;
    assert_eq!(classifier.times_asked_about("Weekend plans"), 1);

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_a_senders_mail_leaves_focus_as_noise_and_returns_as_signal() -> Result<(), Report> {
    a_senders_mail_leaves_focus_as_noise_and_returns_as_signal(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_a_senders_mail_leaves_focus_as_noise_and_returns_as_signal() -> Result<(), Report>
{
    a_senders_mail_leaves_focus_as_noise_and_returns_as_signal(Provider::Outlook).await
}

/// Focus reads the mail of an owner only while they have the Focus flag.
/// Bob does not: his mail never reaches the model, his thread gets no
/// verdict and his Home stays empty, while Ada's mail, which arrives after
/// his, is classified and her app told.
///
/// When it fails: the worker classifies the mail of an owner the rollout
/// leaves out, and shows it to the model.
#[tokio::test(flavor = "multi_thread")]
async fn gmail_mail_of_an_owner_without_the_focus_flag_is_not_classified() -> Result<(), Report> {
    let stack = focus_stack().await?;
    let classifier = stack.focus_classifier()?;
    classifier.put_in_focus_when_mail_contains("Contract renewal");
    let ada = stack.user("ada").await?;
    let bob = stack.user("bob").await?;
    classifier.turn_off_focus_flag_for(bob.email())?;
    let bobs = bob.link(Provider::Gmail, bob.email()).await?;
    let adas = ada.link(Provider::Gmail, ada.email()).await?;

    let left_out = arrives(&bobs, MALLORY, "Contract renewal for Bob").await?;
    eventually(
        "the worker to leave Bob's mail for his flag",
        DEFAULT_TIMEOUT,
        async || Ok(stack.focus_skipped_without_flag(&left_out).then_some(())),
    )
    .await?;
    let wanted = arrives(&adas, MALLORY, "Contract renewal for Ada").await?;
    let verdict = wait_until_classified(&ada, &wanted).await?;
    assert_eq!(verdict, json!({ "isFocus": true, "category": "OTHER" }));
    wait_for_home(&ada, &["Contract renewal for Ada"]).await?;
    eventually(
        "a push telling Ada's app Focus changed",
        DEFAULT_TIMEOUT,
        async || Ok(focus_pushes(&stack, &adas).into_iter().next()),
    )
    .await?;

    assert_eq!(classifier.times_asked_about("for Bob"), 0);
    assert_eq!(thread_focus(&bob, &left_out).await?, Value::Null);
    assert_eq!(on_home(&bob).await?, Vec::<Value>::new());
    assert_eq!(focus_pushes(&stack, &bobs), Vec::<Value>::new());

    stack.finish().await
}

/// The id of the account that owns the inbox, as the user who linked it
/// lists it.
async fn owner_of(user: &User, inbox: &Inbox) -> Result<Value, Report> {
    let links = user.get("/email/links").await?.ok()?;
    let link = links["links"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|link| link["id"] == inbox.link_id().to_string().as_str())
        .ok_or_else(|| rootcause::report!("the inbox is not listed: {links}"))?;
    Ok(link["macro_id"].clone())
}

/// A linked inbox follows the Focus flag of the person whose tab lists it.
/// Ada has the flag and links Bob's mailbox. Bob has a Macro account and no
/// flag, so the inbox stays Bob's. Mail to it is classified, listed on
/// Ada's Home, and Ada's app is told. Carol, without the flag, links Dan's
/// mailbox, and Dan lacks it too: that mail never reaches the model.
///
/// When it fails: an inbox linked to someone with the flag gets no Focus
/// because the worker asks only its owner's flag, or a linked inbox is
/// classified while nobody whose tab shows it has the flag.
#[tokio::test(flavor = "multi_thread")]
async fn gmail_a_linked_inbox_follows_the_flag_of_the_user_who_linked_it() -> Result<(), Report> {
    let stack = focus_stack().await?;
    let classifier = stack.focus_classifier()?;
    classifier.put_in_focus_when_mail_contains("Contract renewal");
    let ada = stack.user("ada").await?;
    let bob = stack.user("bob").await?;
    let carol = stack.user("carol").await?;
    let dan = stack.user("dan").await?;
    for outside in [&bob, &carol, &dan] {
        classifier.turn_off_focus_flag_for(outside.email())?;
    }
    let bobs = ada.link(Provider::Gmail, bob.email()).await?;
    let dans = carol.link(Provider::Gmail, dan.email()).await?;
    assert_eq!(owner_of(&ada, &bobs).await?, bob.macro_id());
    assert_eq!(owner_of(&carol, &dans).await?, dan.macro_id());

    let left_out = arrives(&dans, MALLORY, "Contract renewal for Dan").await?;
    eventually(
        "the worker to leave Dan's mail, linked to Carol, for their flags",
        DEFAULT_TIMEOUT,
        async || Ok(stack.focus_skipped_without_flag(&left_out).then_some(())),
    )
    .await?;
    let wanted = arrives(&bobs, MALLORY, "Contract renewal for Bob").await?;
    let verdict = wait_until_classified(&ada, &wanted).await?;
    assert_eq!(verdict, json!({ "isFocus": true, "category": "OTHER" }));
    wait_for_home(&ada, &["Contract renewal for Bob"]).await?;
    let push = eventually(
        "a push telling Ada's app Focus changed",
        DEFAULT_TIMEOUT,
        async || Ok(focus_pushes(&stack, &bobs).into_iter().next()),
    )
    .await?;
    assert!(
        push["entities"].to_string().contains(ada.macro_id()),
        "{push}"
    );

    assert_eq!(classifier.times_asked_about("for Dan"), 0);
    assert_eq!(thread_focus(&carol, &left_out).await?, Value::Null);
    assert_eq!(on_home(&carol).await?, Vec::<Value>::new());

    stack.finish().await
}

/// What the worker logs when a sweep is done, whatever it found.
const SWEEP_FINISHED: &str = "focus sweep finished";
/// What the worker logs when a backfill pass over an inbox is done.
const BACKFILL_PASS_FINISHED: &str = "focus backfill pass finished";

/// How many lines the worker has logged so far: a mark to count from.
fn log_mark(stack: &Stack) -> usize {
    stack.focus_worker_log().lines().count()
}

/// How many lines after `mark` say `message`, and name `id` when given.
fn logged_since(stack: &Stack, mark: usize, message: &str, id: Option<&str>) -> usize {
    stack
        .focus_worker_log()
        .lines()
        .skip(mark)
        .filter(|line| line.contains(message) && id.is_none_or(|id| line.contains(id)))
        .count()
}

/// Waits until `count` lines after `mark` say `message`, naming `id` when
/// given. A minute apart at most, so this waits for up to two of them and
/// what they took.
async fn wait_for_logged(
    stack: &Stack,
    mark: usize,
    message: &str,
    id: Option<&str>,
    count: usize,
) -> Result<(), Report> {
    eventually(
        &format!("the worker to log {message:?} {count} times"),
        DEFAULT_TIMEOUT * 2,
        async || Ok((logged_since(stack, mark, message, id) >= count).then_some(())),
    )
    .await
}

/// Focus works an inbox only while someone whose tab shows it uses Macro.
/// Bob had Macro open a week and a day ago and not since: mail arriving in
/// Bob's inbox is not shown to the model, the sweeps leave the inbox though
/// it holds Focus, and the minute's look no longer counts it in the
/// rollout, so it forgets the inbox. Once Bob opens Macro again the next
/// sweep classifies the mail that came in the meantime, and the next look
/// finds the inbox joining and backfills it, whichever runs first.
///
/// When it fails: the worker spends the model on the mail of people who
/// stopped using Macro, or someone who comes back never has the mail of
/// their time away classified.
#[tokio::test(flavor = "multi_thread")]
async fn gmail_an_owner_away_from_macro_gets_no_focus_until_they_come_back() -> Result<(), Report> {
    let stack = Stack::start_with(StackOptions {
        document_storage: true,
        focus: true,
        env: vec![
            // Sweeps a minute apart, so the scenario sees them.
            ("FOCUS_SWEEP_INTERVAL_SECS".to_owned(), "60".to_owned()),
            // Whether someone is active is read on every check, so leaving
            // and coming back show at once.
            ("FOCUS_ACTIVITY_CACHE_SECS".to_owned(), "0".to_owned()),
        ],
        ..StackOptions::default()
    })
    .await?;
    let classifier = stack.focus_classifier()?;
    classifier.put_in_focus_when_mail_contains("Contract renewal");
    let bob = stack.user("bob").await?;
    let inbox = bob.link(Provider::Gmail, bob.email()).await?;
    let link_id = inbox.link_id().to_string();

    // While Bob uses Macro the mail is classified, and the look finds the
    // inbox and fills it in its two passes.
    let march = arrives(&inbox, MALLORY, "Contract renewal in March").await?;
    wait_until_classified(&bob, &march).await?;
    wait_for_logged(&stack, 0, BACKFILL_PASS_FINISHED, Some(&link_id), 2).await?;

    bob.away_for(TimeDelta::days(8)).await?;
    let away = log_mark(&stack);
    let april = arrives(&inbox, MALLORY, "Contract renewal in April").await?;
    eventually(
        "the worker to leave the mail that came while Bob was away",
        DEFAULT_TIMEOUT,
        async || Ok(stack.focus_skipped_without_flag(&april).then_some(())),
    )
    .await?;
    // The second sweep since Bob left started after the first ended.
    wait_for_logged(&stack, away, SWEEP_FINISHED, None, 2).await?;
    assert_eq!(thread_focus(&bob, &april).await?, Value::Null);
    assert_eq!(classifier.times_asked_about("April"), 0);

    // No pass over the inbox while Bob was away: the look left it out.
    assert_eq!(
        logged_since(&stack, away, BACKFILL_PASS_FINISHED, Some(&link_id)),
        0
    );

    // Counted from before Bob is back: the look may find the inbox and finish
    // a pass over it before `opens_macro` returns. While Bob was away no pass
    // covered it, so every pass counted from here came after his return.
    let back = log_mark(&stack);
    bob.opens_macro().await?;
    let verdict = wait_until_classified(&bob, &april).await?;
    assert_eq!(verdict, json!({ "isFocus": true, "category": "OTHER" }));
    wait_for_logged(&stack, back, BACKFILL_PASS_FINISHED, Some(&link_id), 1).await?;
    wait_for_home(
        &bob,
        &["Contract renewal in April", "Contract renewal in March"],
    )
    .await?;

    stack.finish().await
}

/// What a thread says of its labels in Focus.
async fn thread_labels(user: &User, thread_id: &str) -> Result<Value, Report> {
    let read = user
        .graphql(
            THREAD_LABELS,
            &json!({ "input": { "threadId": thread_id } }),
        )
        .await?;
    Ok(read["user"]["emailThread"]["focus"].clone())
}

/// Waits until the thread's Focus labels are `labels`.
async fn wait_for_labels(user: &User, thread_id: &str, labels: &Value) -> Result<(), Report> {
    let mut seen = Value::Null;
    let waited = eventually(
        &format!("the thread's Focus labels to be {labels}"),
        DEFAULT_TIMEOUT,
        async || {
            seen = thread_labels(user, thread_id).await?;
            Ok((&seen == labels).then_some(()))
        },
    )
    .await;
    waited.map_err(|error| rootcause::report!("{error}; the thread read {seen}"))
}

/// A calendar file for an update to a single meeting that ends at `ends`.
fn meeting_update(uid: &str, ends: DateTime<Utc>) -> String {
    let stamp = |at: DateTime<Utc>| at.format("%Y%m%dT%H%M%SZ").to_string();
    let starts = ends - TimeDelta::minutes(30);
    format!(
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Example//EN\r\nMETHOD:REQUEST\r\n\
         BEGIN:VEVENT\r\nUID:{uid}\r\nSEQUENCE:1\r\nDTSTAMP:{now}\r\n\
         DTSTART:{start}\r\nDTEND:{end}\r\nSUMMARY:Design review\r\n\
         ORGANIZER:mailto:{GRACE_ADDRESS}\r\n\
         ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:ada@example.com\r\n\
         END:VEVENT\r\nEND:VCALENDAR\r\n",
        now = stamp(Utc::now()),
        start = stamp(starts),
        end = stamp(ends),
    )
}

/// A meeting update is in Focus while its meeting is ahead and leaves once
/// the meeting is over, though the model wants the thread there for its own
/// sake too.
///
/// When it fails: mail about a meeting that is over stays on Home because it
/// also reads as worth Focus, or the update never shows as Calendar.
#[tokio::test(flavor = "multi_thread")]
async fn gmail_a_meeting_update_leaves_focus_once_the_meeting_is_over() -> Result<(), Report> {
    let stack = focus_stack().await?;
    let classifier = stack.focus_classifier()?;
    classifier.put_in_focus_when_mail_contains("Design review");
    let ada = stack.user("ada").await?;
    let inbox = ada.link(Provider::Gmail, ada.email()).await?;

    // In whole seconds, as the invite carries it.
    let ends = (Utc::now() + ENDS_IN).trunc_subsecs(0);
    let update = Mail::new(
        GRACE,
        "Updated invitation: Design review",
        "Moved to this afternoon.",
    )
    .with_attachment(
        "invite.ics",
        "text/calendar; method=REQUEST",
        meeting_update("design-review-1@example.net", ends).as_bytes(),
    );
    let thread = delivered(&inbox, &update).await?;

    let listed = wait_for_home(&ada, &["Updated invitation: Design review"]).await?;
    assert!(
        Utc::now() < ends,
        "the update was classified after its meeting"
    );
    assert_eq!(listed[0]["focus"]["category"], "CALENDAR", "{listed:?}");
    wait_for_home(&ada, &[]).await?;
    assert!(
        Utc::now() >= ends,
        "the update left Focus before its meeting ended"
    );
    assert_eq!(thread_focus(&ada, &thread).await?["isFocus"], false);

    stack.finish().await
}

/// When the thread's Focus classification was made: `null` until it is
/// classified.
async fn classified_at(user: &User, thread_id: &str) -> Result<Value, Report> {
    let read = user
        .graphql(
            THREAD_CLASSIFIED_AT,
            &json!({ "input": { "threadId": thread_id } }),
        )
        .await?;
    Ok(read["user"]["emailThread"]["focus"]["classifiedAt"].clone())
}

/// Waits until the thread is classified again, after the classification made
/// at `before`. The worker classifies a thread again only for a newer message.
async fn wait_until_classified_again(
    user: &User,
    thread_id: &str,
    before: &Value,
) -> Result<(), Report> {
    eventually(
        "the thread to be classified again",
        DEFAULT_TIMEOUT,
        async || Ok((classified_at(user, thread_id).await? != *before).then_some(())),
    )
    .await
}

/// Mail about a meeting whose day is over is out of Focus, though the model
/// wants it, while mail about a meeting still ahead is in. Notes written once
/// the meeting is over keep the thread out; a question to the owner after it
/// is judged on its own and brings the thread back.
///
/// When it fails: Home keeps mail about meetings that are over or their
/// notes, or a thread stays out though it now asks the owner something,
/// because of the meeting its old mail named.
#[tokio::test(flavor = "multi_thread")]
async fn gmail_mail_about_a_meeting_that_is_over_is_out_of_focus() -> Result<(), Report> {
    let stack = focus_stack().await?;
    let classifier = stack.focus_classifier()?;
    let today = Utc::now().date_naive();
    classifier.put_in_focus_when_mail_contains("Quarterly planning");
    classifier.put_in_focus_when_mail_contains("Board prep");
    classifier.event_on_when_mail_contains("Quarterly planning", today - Days::new(2));
    classifier.event_on_when_mail_contains("Board prep", today + Days::new(2));
    classifier.ask_the_owner_when_mail_contains("send me the slides");
    let ada = stack.user("ada").await?;
    let inbox = ada.link(Provider::Gmail, ada.email()).await?;

    // Written three days ago, about the meeting the day after.
    let agenda = Mail {
        message_id: Some("planning-1@example.net".to_owned()),
        ..Mail::new(GRACE, "Quarterly planning", "The agenda for our meeting.")
    }
    .dated(Utc::now() - TimeDelta::days(3));
    let planning = delivered(&inbox, &agenda).await?;
    let verdict = wait_until_classified(&ada, &planning).await?;
    assert_eq!(verdict["isFocus"], false, "{verdict}");
    arrives(&inbox, MALLORY, "Board prep").await?;
    wait_for_home(&ada, &["Board prep"]).await?;

    let agenda_classified_at = classified_at(&ada, &planning).await?;
    let notes = Mail {
        message_id: Some("planning-2@example.net".to_owned()),
        ..Mail::new(GRACE, "Re: Quarterly planning", "Notes from the meeting.")
    }
    .in_reply_to("planning-1@example.net");
    inbox.deliver(&notes)?;
    wait_until_classified_again(&ada, &planning, &agenda_classified_at).await?;
    assert_eq!(thread_focus(&ada, &planning).await?["isFocus"], false);
    let listed = on_home(&ada).await?;
    assert_eq!(
        listed
            .iter()
            .map(|thread| &thread["name"])
            .collect::<Vec<_>>(),
        ["Board prep"],
        "{listed:?}"
    );

    let question = Mail::new(
        GRACE,
        "Re: Quarterly planning",
        "Could you send me the slides you showed?",
    )
    .in_reply_to("planning-2@example.net");
    inbox.deliver(&question)?;
    let listed = wait_for_home(&ada, &["Board prep", "Re: Quarterly planning"]).await?;
    assert_eq!(listed[1]["id"], planning.as_str());
    wait_for_labels(
        &ada,
        &planning,
        &json!({ "isFocus": true, "needsReply": true, "needsFollowUp": false }),
    )
    .await?;

    stack.finish().await
}

/// The owner's answer, sent from another mail client, takes a thread out of
/// Focus, and the thread comes back to follow up once it has waited three days
/// for an answer. Here the answer was sent just under three days ago, so the
/// wait ends while the scenario looks.
///
/// When it fails: a thread the owner already answered stays on Home, or one
/// that still needs following up never comes back.
#[tokio::test(flavor = "multi_thread")]
async fn gmail_an_answered_thread_leaves_focus_until_it_needs_following_up() -> Result<(), Report> {
    let stack = focus_stack().await?;
    let classifier = stack.focus_classifier()?;
    classifier.put_in_focus_when_mail_contains("Vendor contract");
    let ada = stack.user("ada").await?;
    let inbox = ada.link(Provider::Gmail, ada.email()).await?;

    let asked = Mail {
        message_id: Some("vendor-1@example.net".to_owned()),
        ..Mail::new(GRACE, "Vendor contract", "Can you review the draft?")
    }
    .dated(Utc::now() - TimeDelta::days(4));
    let thread = delivered(&inbox, &asked).await?;
    wait_for_home(&ada, &["Vendor contract"]).await?;
    wait_for_labels(
        &ada,
        &thread,
        &json!({ "isFocus": true, "needsReply": false, "needsFollowUp": false }),
    )
    .await?;

    // In whole seconds, as the Date header carries it.
    let waited_at = (Utc::now() + ENDS_IN).trunc_subsecs(0);
    let answer = Mail {
        to: Some(GRACE.to_owned()),
        ..Mail::new(
            ada.email(),
            "Re: Vendor contract",
            "Here are my comments. Can you confirm the dates?",
        )
    }
    .in_reply_to("vendor-1@example.net")
    .dated(waited_at - FOLLOW_UP_AFTER)
    .sent_from_mailbox();
    inbox.deliver(&answer)?;
    wait_for_home(&ada, &[]).await?;
    assert!(
        Utc::now() < waited_at,
        "the answer was classified after the wait"
    );
    assert_eq!(thread_focus(&ada, &thread).await?["isFocus"], false);

    wait_for_home(&ada, &["Re: Vendor contract"]).await?;
    assert!(
        Utc::now() >= waited_at,
        "the thread came back before the wait ended"
    );
    wait_for_labels(
        &ada,
        &thread,
        &json!({ "isFocus": true, "needsReply": false, "needsFollowUp": true }),
    )
    .await?;

    stack.finish().await
}

/// A thread the owner answered comes back to follow up as soon as its due day
/// has come, without the three days' wait; one whose due day is ahead stays
/// out; and one the owner closed with thanks stays out though its day has come.
///
/// When it fails: a thread past its due day waits out the full wait for an
/// answer, one due later comes back at once, or a closed thread comes back.
#[tokio::test(flavor = "multi_thread")]
async fn gmail_an_answered_thread_comes_back_on_its_due_day_unless_the_answer_closed_it()
-> Result<(), Report> {
    let stack = focus_stack().await?;
    let classifier = stack.focus_classifier()?;
    let today = Utc::now().date_naive();
    for (subject, due) in [
        ("Budget sign-off", today - Days::new(1)),
        ("Offsite venue", today + Days::new(3)),
        ("Logo files", today - Days::new(1)),
    ] {
        classifier.put_in_focus_when_mail_contains(subject);
        classifier.due_on_when_mail_contains(subject, due);
    }
    let ada = stack.user("ada").await?;
    let inbox = ada.link(Provider::Gmail, ada.email()).await?;

    let mut threads = Vec::new();
    for (subject, id) in [
        ("Budget sign-off", "budget-1@example.net"),
        ("Offsite venue", "offsite-1@example.net"),
        ("Logo files", "logo-1@example.net"),
    ] {
        let asked = Mail {
            message_id: Some(id.to_owned()),
            ..Mail::new(GRACE, subject, "Could you send this over?")
        }
        .dated(Utc::now() - TimeDelta::days(2));
        threads.push(delivered(&inbox, &asked).await?);
    }
    wait_for_home(&ada, &["Budget sign-off", "Logo files", "Offsite venue"]).await?;

    for (subject, id, text) in [
        (
            "Budget sign-off",
            "budget-1@example.net",
            "Nearly done. Can I send it Monday?",
        ),
        (
            "Offsite venue",
            "offsite-1@example.net",
            "Checking with the team. Is Thursday fine?",
        ),
        ("Logo files", "logo-1@example.net", "Thanks!"),
    ] {
        let answer = Mail {
            to: Some(GRACE.to_owned()),
            ..Mail::new(ada.email(), &format!("Re: {subject}"), text)
        }
        .in_reply_to(id)
        .sent_from_mailbox();
        inbox.deliver(&answer)?;
    }
    wait_for_labels(
        &ada,
        &threads[0],
        &json!({ "isFocus": true, "needsReply": false, "needsFollowUp": true }),
    )
    .await?;
    wait_for_home(&ada, &["Re: Budget sign-off"]).await?;
    for left in &threads[1..] {
        wait_for_labels(
            &ada,
            left,
            &json!({ "isFocus": false, "needsReply": false, "needsFollowUp": false }),
        )
        .await?;
    }

    stack.finish().await
}
