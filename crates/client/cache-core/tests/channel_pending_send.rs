//! A message still queued for sending whose server copy the device already has.

use cache_core::channel_timeline::{
    ChannelEviction, ChannelTimelineCommit, TIMELINE_HEAD, TIMELINE_START, TOMBSTONE_REPLAY,
};
use cache_core::engine::{BeginOptimisticWrite, Engine, InitialClaimOutcome};
use cache_core::meta::bundled_schema;
use cache_core::queue::{MutationClaimRequest, MutationClaimToken};
use cache_core::record_selection::RecordSelection;
use cache_core::store::InMemoryStorage;
use pollster::block_on;
use serde_json::{Value, json};

#[path = "support/channels.rs"]
#[expect(dead_code, reason = "the commit tests use the rest")]
mod channels;
use channels::{
    TestEngine, changes, coverage, key, latest, listed, message, page, saying, with_preview,
    write_page, write_undated,
};

const SENT: &str = "11111111-1111-4111-8111-111111111111";
const EDIT: &str = "22222222-2222-4222-8222-222222222222";
const FIRST: &str = "44444444-4444-4444-8444-444444444444";
const REPLY: &str = "33333333-3333-4333-8333-333333333333";
/// Past every position the server gives.
const UNPLACED: &str = "90";
const FIELDS: &str = "__typename id channelId sortKey threadId deletedAt content";

fn root(id: &str, sort_key: &str) -> Value {
    message("c1", id, sort_key, None)
}

fn reply(id: &str, sort_key: &str, root: &str) -> Value {
    message("c1", id, sort_key, Some(root))
}

/// A reply as a preview selects it.
fn previewed(mut reply: Value) -> Value {
    reply.as_object_mut().unwrap().remove("thread");
    reply
}

/// The message as this device predicts it: last, with no replies.
fn predicted() -> Value {
    with_preview(saying(root(SENT, UNPLACED), "sent"), &[])
}

/// The server's copy, replied to since.
fn placed() -> Value {
    with_preview(
        saying(root(SENT, "20"), "sent"),
        &[previewed(reply("r1", "~21", SENT))],
    )
}

fn whole(seq: &str) -> ChannelTimelineCommit {
    page(
        "c1",
        seq,
        vec![coverage(None, TIMELINE_START, TIMELINE_HEAD)],
    )
}

/// The channel with one message, m1, read whole at sequence 10.
async fn held() -> TestEngine {
    let mut engine = Engine::new(InMemoryStorage::new());
    push(&mut engine, "10", &[root("m1", "10")], &whole("10")).await;
    engine
}

async fn push(
    engine: &mut TestEngine,
    seq: &str,
    entries: &[Value],
    commit: &ChannelTimelineCommit,
) {
    write_page(engine, "c1", seq, entries, Some(commit))
        .await
        .unwrap();
}

/// The server's copy and m3, sent after it.
async fn push_placed(engine: &mut TestEngine) {
    let entries = [root("m3", "30"), placed(), reply("r1", "~21", SENT)];
    push(engine, "13", &entries, &changes("c1", "10", "13")).await;
}

async fn queue(
    engine: &mut TestEngine,
    uuid: &str,
    field: &str,
    root: Option<&Value>,
    message: &Value,
) -> Option<(u64, MutationClaimToken)> {
    let shape =
        format!("{FIELDS} thread {{ __typename deletedAt replyCount preview {{ {FIELDS} }} }}");
    let query = format!(
        "mutation Write($input: Input!) {{ {field}(input: $input) {{ __typename seq \
         root {{ {shape} }} message {{ {shape} }} }} }}"
    );
    let data = json!({ field: {
        "__typename": "GraphqlChannelMessageWrite",
        "seq": "0", "root": root, "message": message,
    }});
    enqueue(engine, uuid, &query, &data).await
}

async fn enqueue(
    engine: &mut TestEngine,
    uuid: &str,
    query: &str,
    data: &Value,
) -> Option<(u64, MutationClaimToken)> {
    let queued = engine
        .enqueue_optimistic_mutation(
            None,
            BeginOptimisticWrite {
                client_metadata: None,
                uuid,
                query,
                operation_name: None,
                variables: json!({ "input": { "id": uuid } }).as_object().unwrap(),
                data,
                link_patches: &[],
                revalidations: &[],
                created_at_ms: 0,
                identity_bindings: &[],
            },
            MutationClaimRequest {
                owner: "runner".into(),
                now_ms: 0,
                lease_expires_at_ms: 100,
            },
        )
        .await
        .unwrap();
    let InitialClaimOutcome::Claimed(claimed) = queued.initial_claim else {
        return None;
    };
    let generation = claimed.lease_generation;
    Some((
        queued.transaction_id,
        MutationClaimToken {
            owner: "runner".into(),
            generation,
        },
    ))
}

async fn queue_send(engine: &mut TestEngine) -> (u64, MutationClaimToken) {
    queue(engine, SENT, "sendChannelMessage", None, &predicted())
        .await
        .expect("the only queued mutation is claimable")
}

/// An edit names the message and what it changes.
async fn queue_edit(engine: &mut TestEngine, content: &str) {
    let edited = json!({ "__typename": "GraphqlChannelMessage", "id": SENT, "content": content });
    queue(engine, EDIT, "editChannelMessage", None, &edited).await;
}

/// What a reply predicts of its root: the thread alone, naming its replies.
fn threaded(id: &str, replies: &[Value]) -> Value {
    let named = |reply: &Value| json!({ "__typename": "GraphqlChannelMessage", "id": reply["id"] });
    let previews = replies.iter().map(named).collect::<Vec<_>>();
    let thread = with_preview(json!({}), &previews)["thread"].take();
    json!({ "__typename": "GraphqlChannelMessage", "id": id, "thread": thread })
}

async fn queue_reply(engine: &mut TestEngine, root: &Value, reply: &Value) {
    queue(engine, REPLY, "sendChannelMessage", Some(root), reply).await;
}

/// A root as the device shows it.
async fn shown(engine: &mut TestEngine, id: &str) -> Value {
    let fragment = format!(
        "fragment Shown on GraphqlChannelMessage {{ {FIELDS} thread {{ __typename deletedAt \
         replyCount preview {{ {FIELDS} }} }} }}"
    );
    let selection = RecordSelection::parse(&bundled_schema(), &fragment, "Shown").unwrap();
    let read = engine.read_records_by_keys(&selection, &[key(id)]).await;
    read.unwrap().value.remove(0).record
}

/// m1 with the server's `replies`.
fn replied(replies: &[Value]) -> Value {
    let previews = replies.iter().cloned().map(previewed).collect::<Vec<_>>();
    with_preview(root("m1", "10"), &previews)
}

/// m1 read without replies at 11, and a queued reply to it.
async fn replying() -> TestEngine {
    let mut engine = held().await;
    push(
        &mut engine,
        "11",
        &[replied(&[])],
        &changes("c1", "10", "11"),
    )
    .await;
    let own = reply(REPLY, "~91", "m1");
    let predicted = threaded("m1", std::slice::from_ref(&own));
    queue_reply(&mut engine, &predicted, &own).await;
    engine
}

async fn timeline(engine: &mut TestEngine) -> Vec<String> {
    listed(engine, &latest("c1", 100)).await.unwrap()
}

#[test]
fn a_queued_send_shows_as_the_server_has_it_once_the_device_does() {
    block_on(async {
        let mut engine = held().await;
        let (transaction, claim) = queue_send(&mut engine).await;
        assert_eq!(timeline(&mut engine).await, [SENT, "m1"]);

        push_placed(&mut engine).await;
        assert_eq!(shown(&mut engine, SENT).await, placed());
        assert_eq!(timeline(&mut engine).await, ["m3", SENT, "m1"]);

        // As a device that opens the queue again has it.
        engine.refresh_optimistic_queue().await.unwrap();
        assert_eq!(shown(&mut engine, SENT).await, placed());

        engine
            .rollback_optimistic_write(transaction, claim)
            .await
            .unwrap();
        assert_eq!(shown(&mut engine, SENT).await, placed());
    });
}

#[test]
fn what_is_queued_after_the_send_still_shows_over_the_servers_copy() {
    block_on(async {
        let mut engine = held().await;
        queue_send(&mut engine).await;
        queue_edit(&mut engine, "edited").await;

        push_placed(&mut engine).await;
        assert_eq!(shown(&mut engine, SENT).await, saying(placed(), "edited"));
        assert_eq!(timeline(&mut engine).await, ["m3", SENT, "m1"]);
    });
}

#[test]
fn a_queued_reply_still_shows_on_a_queued_root() {
    block_on(async {
        let mut engine = held().await;
        queue_send(&mut engine).await;
        let own = reply(REPLY, "~91", SENT);
        let root_thread = threaded(SENT, std::slice::from_ref(&own));
        queue_reply(&mut engine, &root_thread, &own).await;

        let unanswered = with_preview(saying(root(SENT, "20"), "sent"), &[]);
        push(&mut engine, "11", &[unanswered], &changes("c1", "10", "11")).await;
        let shown = shown(&mut engine, SENT).await;
        assert_eq!(shown["sortKey"], "20");
        assert_eq!(shown["thread"]["preview"], json!([previewed(own)]));
    });
}

#[test]
fn a_copy_that_lacks_fields_leaves_the_queued_send_shown() {
    block_on(async {
        let mut engine = held().await;
        queue_send(&mut engine).await;
        write_undated(&mut engine, &root(SENT, "20")).await;
        assert_eq!(timeline(&mut engine).await, [SENT, "m1"]);
    });
}

#[test]
fn a_copy_without_a_sequence_leaves_the_queued_send_listed() {
    block_on(async {
        let mut engine = held().await;
        // Predicts no more than the undated read selects.
        let copy = |sort_key| {
            let mut copy = saying(root(SENT, sort_key), "sent");
            copy.as_object_mut().unwrap().remove("thread");
            copy
        };
        let query = format!(
            "mutation Write($input: Input!) {{ sendChannelMessage(input: $input) {{ __typename \
             seq message {{ {FIELDS} }} }} }}"
        );
        enqueue(
            &mut engine,
            SENT,
            &query,
            &json!({ "sendChannelMessage": {
                "__typename": "GraphqlChannelMessageWrite",
                "seq": "0", "message": copy(UNPLACED),
            }}),
        )
        .await;
        write_undated(&mut engine, &copy("20")).await;
        assert_eq!(timeline(&mut engine).await, [SENT, "m1"]);

        // Dated, it takes its place.
        push_placed(&mut engine).await;
        assert_eq!(timeline(&mut engine).await, ["m3", SENT, "m1"]);
        engine.refresh_optimistic_queue().await.unwrap();
        assert_eq!(timeline(&mut engine).await, ["m3", SENT, "m1"]);
    });
}

#[test]
fn a_root_shows_the_servers_replies_once_the_device_has_a_queued_one() {
    block_on(async {
        let mut engine = replying().await;
        // Somebody else's, while this one is still on its way.
        let other = reply("r2", "~21", "m1");
        let answered = replied(std::slice::from_ref(&other));
        let entries = [answered, other.clone()];
        push(&mut engine, "12", &entries, &changes("c1", "11", "12")).await;
        let thread = &shown(&mut engine, "m1").await["thread"];
        assert_eq!(thread["preview"][0]["id"], REPLY);

        // The reply itself, before its root: no copy counts both yet.
        let placed = reply(REPLY, "~22", "m1");
        let entries = std::slice::from_ref(&placed);
        push(&mut engine, "13", entries, &changes("c1", "12", "13")).await;
        let thread = &shown(&mut engine, "m1").await["thread"];
        assert_eq!(thread["replyCount"], 1);
        assert_eq!(thread["preview"][0]["id"], REPLY);

        let both = replied(&[other, placed]);
        let entries = std::slice::from_ref(&both);
        push(&mut engine, "14", entries, &changes("c1", "13", "14")).await;
        assert_eq!(shown(&mut engine, "m1").await["thread"], both["thread"]);
        engine.refresh_optimistic_queue().await.unwrap();
        assert_eq!(shown(&mut engine, "m1").await["thread"], both["thread"]);
    });
}

#[test]
fn a_root_shows_the_servers_replies_when_only_its_preview_has_the_queued_one() {
    block_on(async {
        let mut engine = replying().await;
        let both = replied(&[reply("r2", "~21", "m1"), reply(REPLY, "~22", "m1")]);
        push(&mut engine, "14", &[both], &whole("14")).await;
        let thread = &shown(&mut engine, "m1").await["thread"];
        assert_eq!(thread["replyCount"], 2);
        assert_eq!(thread["preview"][1]["id"], REPLY);
    });
}

#[test]
fn a_root_stops_counting_a_queued_reply_that_arrived_and_was_removed() {
    block_on(async {
        let mut engine = replying().await;
        let placed = reply(REPLY, "~22", "m1");
        let one = replied(std::slice::from_ref(&placed));
        push(
            &mut engine,
            "13",
            &[one.clone(), placed],
            &changes("c1", "11", "13"),
        )
        .await;
        assert_eq!(shown(&mut engine, "m1").await["thread"], one["thread"]);

        let removed = channels::removing(changes("c1", "13", "15"), &[REPLY]);
        let none = replied(&[]);
        push(&mut engine, "15", std::slice::from_ref(&none), &removed).await;
        assert_eq!(shown(&mut engine, "m1").await["thread"], none["thread"]);
    });
}

#[test]
fn a_reply_leaves_the_text_of_its_root_to_the_server() {
    block_on(async {
        let mut engine = replying().await;
        let edited = saying(replied(&[]), "edited");
        push(&mut engine, "12", &[edited], &changes("c1", "11", "12")).await;
        let shown = shown(&mut engine, "m1").await;
        assert_eq!(shown["content"], "edited");
        assert_eq!(shown["thread"]["replyCount"], 1);
    });
}

#[test]
fn a_queued_edit_restores_the_sent_text_over_a_newer_copy() {
    block_on(async {
        let mut engine = held().await;
        queue_send(&mut engine).await;
        push_placed(&mut engine).await;
        let elsewhere = saying(placed(), "edited elsewhere");
        push(&mut engine, "14", &[elsewhere], &changes("c1", "13", "14")).await;
        assert_eq!(
            shown(&mut engine, SENT).await["content"],
            "edited elsewhere"
        );
        queue_edit(&mut engine, "sent").await;
        assert_eq!(shown(&mut engine, SENT).await, placed());
    });
}

#[test]
fn an_edit_outlasting_the_send_leaves_the_servers_placement() {
    block_on(async {
        let mut engine = held().await;
        let (transaction, claim) = queue_send(&mut engine).await;
        queue_edit(&mut engine, "edited").await;
        push_placed(&mut engine).await;
        engine
            .rollback_optimistic_write(transaction, claim)
            .await
            .unwrap();
        assert_eq!(shown(&mut engine, SENT).await, saying(placed(), "edited"));
    });
}

#[test]
fn a_copy_no_timeline_can_place_leaves_the_queued_send_shown() {
    block_on(async {
        let mut engine = held().await;
        queue_send(&mut engine).await;
        let mut unplaced = placed();
        unplaced["sortKey"] = json!("");
        push(&mut engine, "13", &[unplaced], &changes("c1", "10", "13")).await;
        assert_eq!(shown(&mut engine, SENT).await["sortKey"], UNPLACED);
        engine.refresh_optimistic_queue().await.unwrap();
        assert_eq!(shown(&mut engine, SENT).await["sortKey"], UNPLACED);
    });
}

#[test]
fn a_channel_is_not_evicted_while_a_queued_send_shows_as_its_copy() {
    block_on(async {
        let mut engine = held().await;
        let (transaction, claim) = queue_send(&mut engine).await;
        push_placed(&mut engine).await;
        let eviction = ChannelEviction {
            touched_before_ms: 1,
            max_channels: 1,
        };
        let evicted = engine.channel_timeline_evict(&eviction).await.unwrap();
        assert!(evicted.channel_ids.is_empty());
        assert_eq!(shown(&mut engine, SENT).await, placed());

        engine
            .rollback_optimistic_write(transaction, claim)
            .await
            .unwrap();
        let evicted = engine.channel_timeline_evict(&eviction).await.unwrap();
        assert_eq!(evicted.channel_ids, ["c1"]);
    });
}

#[test]
fn a_removed_send_stays_out_while_it_is_queued() {
    block_on(async {
        let mut engine = held().await;
        queue_send(&mut engine).await;
        push_placed(&mut engine).await;
        let removed = channels::removing(changes("c1", "13", "14"), &[SENT]);
        push(&mut engine, "14", &[], &removed).await;
        assert_eq!(timeline(&mut engine).await, ["m3", "m1"]);

        let reset = ChannelTimelineCommit {
            reset: true,
            ..whole("15")
        };
        push(
            &mut engine,
            "15",
            &[root("m3", "30"), root("m1", "10")],
            &reset,
        )
        .await;
        let later = (15 + TOMBSTONE_REPLAY).to_string();
        push(&mut engine, &later, &[], &changes("c1", "15", &later)).await;
        engine.refresh_optimistic_queue().await.unwrap();
        assert_eq!(timeline(&mut engine).await, ["m3", "m1"]);
    });
}

async fn reply_count(engine: &mut TestEngine) -> Value {
    shown(engine, "m1").await["thread"]["replyCount"].take()
}

#[test]
fn a_reset_that_drops_the_arrived_reply_counts_it_as_queued_again() {
    block_on(async {
        let mut engine = replying().await;
        let both = replied(&[reply("r2", "~21", "m1"), reply(REPLY, "~22", "m1")]);
        push(&mut engine, "14", &[both], &whole("14")).await;
        assert_eq!(reply_count(&mut engine).await, 2);

        let reset = ChannelTimelineCommit {
            reset: true,
            ..whole("20")
        };
        push(&mut engine, "20", &[replied(&[])], &reset).await;
        assert_eq!(reply_count(&mut engine).await, 1);
        engine.refresh_optimistic_queue().await.unwrap();
        assert_eq!(reply_count(&mut engine).await, 1);
    });
}

#[test]
fn a_copy_of_a_reply_no_thread_can_place_does_not_prove_it_arrived() {
    block_on(async {
        let mut engine = replying().await;
        let unplaced = reply(REPLY, "", "m1");
        let entries = [replied(&[]), unplaced];
        push(&mut engine, "14", &entries, &changes("c1", "11", "14")).await;
        assert_eq!(reply_count(&mut engine).await, 1);
        engine.refresh_optimistic_queue().await.unwrap();
        assert_eq!(reply_count(&mut engine).await, 1);
    });
}

#[test]
fn an_arrived_reply_read_again_alone_leaves_the_servers_count() {
    block_on(async {
        let mut engine = replying().await;
        let sent = reply(REPLY, "~22", "m1");
        let both = replied(&[reply("r2", "~21", "m1"), sent.clone()]);
        push(&mut engine, "14", &[both, sent.clone()], &whole("14")).await;
        assert_eq!(reply_count(&mut engine).await, 2);

        write_page(&mut engine, "c1", "15", &[sent], None)
            .await
            .unwrap();
        assert_eq!(reply_count(&mut engine).await, 2);
    });
}

#[test]
fn a_dropped_thread_takes_the_arrived_reply_with_it() {
    block_on(async {
        let mut engine = replying().await;
        let both = replied(&[reply("r2", "~21", "m1"), reply(REPLY, "~22", "m1")]);
        push(&mut engine, "14", &[both], &whole("14")).await;
        assert_eq!(reply_count(&mut engine).await, 2);

        let dropped = ChannelTimelineCommit {
            channel_id: "c1".into(),
            dropped_thread_root_ids: vec!["m1".into()],
            ..ChannelTimelineCommit::default()
        };
        engine.channel_timeline_commit(&dropped).await.unwrap();
        let count = reply_count(&mut engine).await;
        engine.refresh_optimistic_queue().await.unwrap();
        assert_eq!(reply_count(&mut engine).await, count);
    });
}

/// m1 and its thread read whole at 11, with `replies`.
async fn threaded_channel(replies: &[Value]) -> TestEngine {
    let mut engine = held().await;
    let spans = [None, Some("m1")];
    let read = page(
        "c1",
        "11",
        spans
            .map(|thread| coverage(thread, TIMELINE_START, TIMELINE_HEAD))
            .into(),
    );
    let entries = [&[replied(replies)], replies].concat();
    push(&mut engine, "11", &entries, &read).await;
    engine
}

async fn thread(engine: &mut TestEngine) -> Vec<String> {
    listed(engine, &channels::replies("c1", "m1"))
        .await
        .unwrap()
}

#[test]
fn a_reset_that_drops_a_previewed_reply_leaves_its_root_readable() {
    block_on(async {
        let r2 = reply("r2", "~21", "m1");
        let mut engine = threaded_channel(std::slice::from_ref(&r2)).await;
        let own = reply(REPLY, "~91", "m1");
        queue_reply(&mut engine, &threaded("m1", &[r2, own.clone()]), &own).await;

        let reset = ChannelTimelineCommit {
            reset: true,
            ..whole("20")
        };
        push(&mut engine, "20", &[replied(&[])], &reset).await;
        let preview = shown(&mut engine, "m1").await["thread"]["preview"].take();
        assert_eq!(preview, json!([previewed(own)]));
    });
}

#[test]
fn a_previewed_reply_edited_meanwhile_shows_the_edit() {
    block_on(async {
        let r2 = reply("r2", "~21", "m1");
        let mut engine = threaded_channel(std::slice::from_ref(&r2)).await;
        let own = reply(REPLY, "~91", "m1");
        queue_reply(
            &mut engine,
            &threaded("m1", &[r2.clone(), own.clone()]),
            &own,
        )
        .await;

        let edited = saying(r2, "edited");
        let entries = [replied(std::slice::from_ref(&edited)), edited];
        push(&mut engine, "12", &entries, &changes("c1", "11", "12")).await;
        assert_eq!(shown(&mut engine, "r2").await["content"], "edited");
    });
}

#[test]
fn a_previewed_reply_deleted_meanwhile_stays_deleted() {
    block_on(async {
        let r2 = reply("r2", "~21", "m1");
        let mut engine = threaded_channel(std::slice::from_ref(&r2)).await;
        let own = reply(REPLY, "~91", "m1");
        queue_reply(
            &mut engine,
            &threaded("m1", &[r2.clone(), own.clone()]),
            &own,
        )
        .await;

        let mut deleted = r2;
        deleted["deletedAt"] = json!("2026-10-15T00:00:00Z");
        let entries = [replied(&[]), deleted];
        push(&mut engine, "12", &entries, &changes("c1", "11", "12")).await;
        assert_eq!(thread(&mut engine).await, [REPLY]);

        let sent = reply(REPLY, "~31", "m1");
        let root = replied(std::slice::from_ref(&sent));
        let entries = [root.clone(), sent];
        push(&mut engine, "13", &entries, &changes("c1", "12", "13")).await;
        assert_eq!(shown(&mut engine, "m1").await["thread"], root["thread"]);
        assert_eq!(thread(&mut engine).await, [REPLY]);
    });
}

#[test]
fn a_reply_rolled_back_leaves_the_preview_a_later_one_predicted() {
    block_on(async {
        let mut engine = threaded_channel(&[]).await;
        let first = reply(FIRST, "~91", "m1");
        let one = threaded("m1", std::slice::from_ref(&first));
        let claim = queue(&mut engine, FIRST, "sendChannelMessage", Some(&one), &first).await;
        let own = reply(REPLY, "~92", "m1");
        queue_reply(&mut engine, &threaded("m1", &[first, own.clone()]), &own).await;
        assert_eq!(thread(&mut engine).await, [REPLY, FIRST]);

        let (transaction, token) = claim.unwrap();
        let rolled_back = engine.rollback_optimistic_write(transaction, token).await;
        rolled_back.unwrap();
        assert_eq!(thread(&mut engine).await, [REPLY]);
        let preview = shown(&mut engine, "m1").await["thread"]["preview"].take();
        assert_eq!(preview, json!([previewed(own)]));

        let sent = reply(REPLY, "~31", "m1");
        let root = replied(std::slice::from_ref(&sent));
        let entries = [root.clone(), sent];
        push(&mut engine, "12", &entries, &changes("c1", "11", "12")).await;
        assert_eq!(shown(&mut engine, "m1").await["thread"], root["thread"]);
        assert_eq!(thread(&mut engine).await, [REPLY]);
    });
}
