//! What chats show of profile pictures: DSS stores staged pictures as the
//! owner's static files, and every viewer sees the owner's account's view of
//! senders, members and the chat itself.

use super::{media::Files, *};
use crate::domain::pictures::PictureImports;

/// Claims the owner's due checks and gives WhatsApp's answer for each jid.
async fn answer_checks(
    session: &SessionService,
    alice: SessionScope,
    answers: &[(&str, PictureAnswer)],
) {
    let checks = session.claim_picture_checks(alice, 10).await.unwrap();
    for (jid, answer) in answers {
        let check = checks
            .iter()
            .find(|check| check.jid == *jid)
            .expect("claimed");
        session
            .complete_picture_check(alice, check, answer)
            .await
            .unwrap();
    }
}

/// WhatsApp's answer for a picture whose bytes are its id.
fn picture(id: &str) -> PictureAnswer {
    PictureAnswer::Picture {
        id: id.to_owned(),
        bytes: id.as_bytes().to_vec(),
        mime: "image/jpeg".to_owned(),
    }
}

/// The static file DSS stored for the picture with these bytes.
fn file_of(files: &Files, id: &str) -> Uuid {
    files
        .pictures
        .lock()
        .unwrap()
        .iter()
        .find(|picture| picture.bytes == id.as_bytes())
        .expect("stored")
        .file_id
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn everyone_sees_the_pictures_the_owner_sees_and_initials_once_hidden(pool: PgPool) {
    let (linked, session, repository, binding, alice, bob) = adopted(&pool).await;
    session
        .ingest_event(alice, &text(1, CUSTOMER_JID, "3EB0AAAA", "Hello"))
        .await
        .unwrap();
    session
        .ingest_event(bob, &text(2, BOB_JID, "3EB0BBBB", "Hi"))
        .await
        .unwrap();
    answer_checks(
        &session,
        alice,
        &[
            (CUSTOMER_JID, picture("1700000001")),
            (GROUP, picture("1700000002")),
        ],
    )
    .await;

    let files = Arc::new(Files::default());
    let imports = PictureImports::new(repository.clone(), files.clone());
    assert_eq!(imports.import_staged().await.unwrap(), 2);
    assert_eq!(imports.import_staged().await.unwrap(), 0);
    let customer = file_of(&files, "1700000001");
    let group = file_of(&files, "1700000002");
    assert!(
        files
            .pictures
            .lock()
            .unwrap()
            .iter()
            .all(|picture| picture.owner == ALICE && picture.mime == "image/jpeg"),
        "the owner owns the files"
    );

    // Bob only views the shared chat; he sees what Alice's account sees.
    let senders = |viewer: &'static str| {
        let linked = &linked;
        async move {
            linked
                .chats
                .messages(&receipt::<MessageView>(viewer, binding.id), None, Some(50))
                .await
                .unwrap()
                .messages
                .into_iter()
                .rev()
                .map(|message| message.sender.picture_file_id)
                .collect::<Vec<_>>()
        }
    };
    // Bob is a Macro user and shows his Macro avatar instead.
    assert_eq!(senders(BOB).await, vec![Some(customer), None]);

    let detail = linked
        .chats
        .detail(&receipt::<MessageView>(BOB, binding.id))
        .await
        .unwrap();
    assert_eq!(detail.chat.picture_file_id, Some(group));
    let members: Vec<(String, Option<Uuid>)> = detail
        .members
        .unwrap()
        .participants
        .into_iter()
        .map(|member| (member.jid, member.picture_file_id))
        .collect();
    assert_eq!(
        members,
        vec![
            (ALICE_JID.to_owned(), None),
            (BOB_JID.to_owned(), None),
            (CUSTOMER_JID.to_owned(), Some(customer)),
        ]
    );
    let listed = linked.chats.list(&person(BOB)).await.unwrap();
    assert_eq!(listed[0].picture_file_id, Some(group));

    // Their privacy setting now hides it: initials again.
    session
        .picture_changed(alice, &[CUSTOMER_JID.to_owned()], Some("1700000003"))
        .await
        .unwrap();
    answer_checks(&session, alice, &[(CUSTOMER_JID, PictureAnswer::Hidden)]).await;
    assert_eq!(senders(ALICE).await, vec![None, None]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_direct_chat_and_its_person_show_the_chats_picture_and_never_the_owner(pool: PgPool) {
    workspace(&pool).await;
    let (linked, session, repository) = services(&pool);
    let alice = pair(&linked, &session, ALICE, ALICE_JID).await;
    session
        .update_chats(alice, &[direct::customer_chat("Customer")])
        .await
        .unwrap();
    let binding = linked
        .chats
        .add(
            &person(ALICE),
            &AddChat {
                provider: ExternalChatProvider::WhatsApp,
                remote_id: CUSTOMER_JID.into(),
                kind: ExternalChatKind::Direct,
            },
            SendAuthority::Human,
        )
        .await
        .unwrap();
    session
        .ingest_event(
            alice,
            &direct::direct_text(1, CUSTOMER_JID, false, "3EB0AAAA", "Hi"),
        )
        .await
        .unwrap();
    session
        .ingest_event(
            alice,
            &direct::direct_text(2, ALICE_JID, true, "3EB0BBBB", "Hello"),
        )
        .await
        .unwrap();
    answer_checks(&session, alice, &[(CUSTOMER_JID, picture("1700000001"))]).await;
    let files = Arc::new(Files::default());
    PictureImports::new(repository, files.clone())
        .import_staged()
        .await
        .unwrap();
    let customer = file_of(&files, "1700000001");

    let detail = linked
        .chats
        .detail(&receipt::<MessageView>(ALICE, binding.id))
        .await
        .unwrap();
    assert_eq!(detail.chat.picture_file_id, Some(customer));
    let senders: Vec<Option<Uuid>> = linked
        .chats
        .messages(&receipt::<MessageView>(ALICE, binding.id), None, Some(50))
        .await
        .unwrap()
        .messages
        .into_iter()
        .rev()
        .map(|message| message.sender.picture_file_id)
        .collect();
    assert_eq!(senders, vec![Some(customer), None]);
}
