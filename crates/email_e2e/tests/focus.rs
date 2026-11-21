//! Focus: the worker that classifies arriving mail, read the way the web
//! app reads it (Home's list and a thread's `focus`).
//!
//! The model the worker asks is a stand-in the scenario sets: it finds
//! worth Focus exactly the mail that holds the text the scenario named.
//! The worker's consumer group is one for every scenario, so these run one
//! at a time.

use email_e2e::chrono::NaiveDate;
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
    inbox.deliver(&Mail::new(from, subject, "Hello."))?;
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

    bob.away_for(email_e2e::chrono::Duration::days(8)).await?;
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

    bob.opens_macro().await?;
    let back = log_mark(&stack);
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
