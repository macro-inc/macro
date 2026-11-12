//! What senders are called in the timeline and members list: their WhatsApp
//! or contact name, else their phone number, else a generic name.
use super::*;
use crate::domain::people::UNKNOWN_PERSON;

const CUSTOMER_LID: &str = "987654321@lid";

/// How a phone-number JID reads when nothing names its person.
fn number(jid: &str) -> String {
    crate::domain::jid::phone_number(jid).expect("a phone-number JID")
}

/// `sender` wrote `body`, named `name` (`None`: the message carried none).
fn from(event: u128, sender: &str, source: &str, name: Option<&str>) -> InboundEvent {
    let mut message = text(event, sender, source, source);
    if let InboundKind::Message(message) = &mut message.kind {
        message.sender.display_name = name.map(str::to_owned);
    }
    message
}

async fn sender_names(linked: &Linked, chat: &ChatRef) -> Vec<String> {
    linked
        .chats
        .messages(&receipt::<MessageView>(ALICE, chat.id), None, Some(50))
        .await
        .unwrap()
        .messages
        .into_iter()
        .rev()
        .map(|message| message.sender.name)
        .collect()
}

/// The roster pairs the customer's phone number with their LID, as group
/// metadata of LID groups does; it names nobody.
async fn paired_roster(session: &SessionService, alice: SessionScope, customer_name: Option<&str>) {
    let mut info = group(&[ALICE_JID, BOB_JID, CUSTOMER_JID]);
    info.participants[2].identity.alternate_jid = Some(CUSTOMER_LID.to_owned());
    info.participants[2].identity.display_name = customer_name.map(str::to_owned);
    session.update_groups(alice, &[info], true).await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_lid_only_sender_with_a_push_name_shows_it(pool: PgPool) {
    let (linked, session, _, binding, alice, _) = adopted(&pool).await;
    paired_roster(&session, alice, None).await;

    session
        .ingest_event(alice, &from(1, CUSTOMER_LID, "LID1", Some("Ana")))
        .await
        .unwrap();

    assert_eq!(sender_names(&linked, &binding).await, vec!["Ana"]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_unnamed_sender_shows_their_number_until_a_message_names_them(pool: PgPool) {
    let (linked, session, _, binding, alice, _) = adopted(&pool).await;
    paired_roster(&session, alice, None).await;

    // A history page message: by LID, with no WhatsApp name.
    let mut history = from(1, CUSTOMER_LID, "OLD1", None);
    if let InboundKind::Message(message) = &mut history.kind {
        message.history = true;
    }
    session.ingest_event(alice, &history).await.unwrap();
    assert_eq!(
        sender_names(&linked, &binding).await,
        vec![number(CUSTOMER_JID)],
        "the phone number paired with their LID, not a generic name"
    );

    session
        .ingest_event(alice, &from(2, CUSTOMER_JID, "NEW1", Some("Ana")))
        .await
        .unwrap();
    assert_eq!(
        sender_names(&linked, &binding).await,
        vec!["Ana", "Ana"],
        "a later name applies to their earlier messages too"
    );

    session
        .ingest_event(alice, &from(3, CUSTOMER_JID, "NEW2", None))
        .await
        .unwrap();
    session
        .ingest_event(alice, &from(4, CUSTOMER_LID, "NEW3", Some("Ana B")))
        .await
        .unwrap();
    assert_eq!(
        sender_names(&linked, &binding).await,
        vec!["Ana B"; 4],
        "an unnamed message keeps the name; a new name replaces it"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_group_sync_names_people_stored_without_a_name(pool: PgPool) {
    let (linked, session, _, binding, alice, _) = adopted(&pool).await;
    paired_roster(&session, alice, None).await;
    session
        .ingest_event(alice, &from(1, CUSTOMER_LID, "OLD1", None))
        .await
        .unwrap();

    // The session names roster participants from the account's contacts.
    paired_roster(&session, alice, Some("Ana")).await;

    assert_eq!(
        sqlx::query_scalar!(
            "SELECT display_name FROM external_chat_person WHERE chat_id = $1 AND user_id IS NULL",
            binding.id
        )
        .fetch_all(&pool)
        .await
        .unwrap(),
        vec![Some("Ana".to_owned())]
    );
    assert_eq!(sender_names(&linked, &binding).await, vec!["Ana"]);
    let members = linked
        .chats
        .detail(&receipt::<MessageView>(ALICE, binding.id))
        .await
        .unwrap()
        .members
        .expect("Alice's account read the group");
    let names: Vec<&str> = members
        .participants
        .iter()
        .map(|participant| participant.name.as_str())
        .collect();
    assert_eq!(
        names,
        vec![number(ALICE_JID).as_str(), number(BOB_JID).as_str(), "Ana"],
        "members are named, else their phone number"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_owners_chat_with_an_unnamed_sender_names_them(pool: PgPool) {
    let (linked, session, _, binding, alice, _) = adopted(&pool).await;
    session
        .ingest_event(alice, &from(1, CUSTOMER_JID, "OLD1", None))
        .await
        .unwrap();
    assert_eq!(
        sender_names(&linked, &binding).await,
        vec![number(CUSTOMER_JID)]
    );

    // Alice's address book lists the customer (a saved contact).
    sqlx::query!(
        "INSERT INTO whatsapp_chat (account_id, chat_jid, kind, name) VALUES ($1, $2, 'direct', 'Ana Smith')",
        alice.account_id,
        CUSTOMER_JID
    )
    .execute(&pool)
    .await
    .unwrap();

    assert_eq!(sender_names(&linked, &binding).await, vec!["Ana Smith"]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_sender_known_only_by_lid_and_no_name_is_a_generic_participant(pool: PgPool) {
    let (linked, session, _, binding, alice, _) = adopted(&pool).await;
    // The LID is paired by the message itself, with another LID: no number.
    let mut message = from(1, CUSTOMER_LID, "OLD1", None);
    if let InboundKind::Message(message) = &mut message.kind {
        message.sender.alternate_jid = Some("123123123@lid".to_owned());
    }
    session.ingest_event(alice, &message).await.unwrap();

    assert_eq!(sender_names(&linked, &binding).await, vec![UNKNOWN_PERSON]);
}
