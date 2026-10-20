use super::*;
use crate::native_messaging::files::linked::LinkedFiles;
use crate::native_messaging::native::linked::LinkedComposition;
use meta_messaging::domain::linked::{
    models::*,
    ports::{LinkedNative, LinkedRepository},
};
use meta_messaging::outbound::linked::repository::PgLinkedRepository;

#[async_trait]
impl LinkedFiles for TextOnlyFiles {
    async fn receive(
        &self,
        _: &Account,
        event: &Event,
        _: &meta_messaging::outbound::linked::repository::native::Reservation,
    ) -> PortResult<()> {
        assert!(event.message.as_ref().unwrap().media.is_empty());
        Ok(())
    }
    async fn attach_sent(
        &self,
        _: &SendWork,
        _: &Binding,
        _: &ProviderId,
        _: Uuid,
        _: Uuid,
    ) -> PortResult<()> {
        panic!("text fixture must not store media")
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn seven_observers_converge_in_the_native_timeline_and_revoke_access(pool: PgPool) {
    let (native, foundation, outsider) = setup(&pool, Provider::Whatsapp).await;
    let repo = Arc::new(PgLinkedRepository::new(pool.clone(), true));
    let native = native.with_linked(LinkedComposition {
        repository: repo.clone(),
        files: Arc::new(TextOnlyFiles),
    });
    let mut accounts = Vec::new();
    for i in 0..7 {
        let id = if i == 0 {
            foundation.user_id.clone()
        } else {
            user(&pool, &format!("observer-{i}"), Some(foundation.team_id)).await
        };
        let p = repo.begin_pairing(&id, false).await.unwrap();
        let account = repo
            .complete_pairing(&p, &format!("1555000000{i}@s.whatsapp.net"))
            .await
            .unwrap();
        sqlx::query!("INSERT INTO whatsapp_session_owner(account_id,worker_id,epoch,state,lease_until) VALUES($1,$2,1,'running',now()+interval '1 hour')",account.id,Uuid::now_v7()).execute(&pool).await.unwrap();
        accounts.push(repo.linked_account(account.id).await.unwrap().unwrap());
    }
    let mut group = GroupInfo {
        jid: "120363100@g.us".into(),
        name: "Existing group of nine".into(),
        announce: false,
        disappearing: false,
        community: false,
        version: 1,
        observed_at: Utc::now(),
        participants: accounts
            .iter()
            .map(|a| Participant {
                identity: Identity {
                    jid: a.identity_jid.clone().unwrap(),
                    alternate_jid: None,
                    display_name: None,
                },
                admin: false,
            })
            .collect(),
    };
    for i in 0..2 {
        group.participants.push(Participant {
            identity: Identity {
                jid: format!("1555999999{i}@s.whatsapp.net"),
                alternate_jid: Some(format!("1000000{i}@lid")),
                display_name: Some("Customer".into()),
            },
            admin: false,
        });
    }
    let request = AdoptGroup {
        team_id: foundation.team_id,
        group_jid: group.jid.clone(),
        users: accounts.iter().map(|a| a.user_id.clone()).collect(),
    };
    native
        .authorize_adoption(&accounts[0].user_id, &request, &group)
        .await
        .unwrap();
    let binding = native
        .adopt(&accounts[0].user_id, &accounts[0], &request, &group)
        .await
        .unwrap();
    let bindings = futures::future::join_all(
        accounts
            .iter()
            .map(|a| native.adopt(&a.user_id, a, &request, &group)),
    )
    .await;
    assert!(
        bindings
            .into_iter()
            .all(|b| b.unwrap().channel_id == binding.channel_id)
    );
    assert!(
        native
            .adopt(&outsider, &accounts[0], &request, &group)
            .await
            .is_err()
    );
    let source = meta_messaging::domain::linked::models::Message {
        source_id: "same-source".into(),
        sender: group.participants[7].identity.clone(),
        text: "One message observed seven times".into(),
        kind: "text".into(),
        history: false,
        revision: 0,
        target: None,
        media: vec![],
    };
    let event = Event {
        schema_version: 1,
        event_id: Uuid::now_v7(),
        scope: accounts[0].scope().unwrap(),
        group_jid: Some(group.jid.clone()),
        source_at: Utc::now(),
        observed_at: Utc::now(),
        kind: "message".into(),
        message: Some(source),
        group: None,
        receipt: None,
    };
    let events: Vec<_> = accounts
        .iter()
        .enumerate()
        .map(|(i, a)| {
            let mut e = event.clone();
            e.scope = a.scope().unwrap();
            e.event_id = Uuid::now_v7();
            if i % 2 == 0 {
                let sender = &mut e.message.as_mut().unwrap().sender;
                let alt = sender.alternate_jid.take().unwrap();
                sender.alternate_jid = Some(std::mem::replace(&mut sender.jid, alt));
            }
            e
        })
        .collect();
    for _ in 0..2 {
        for result in futures::future::join_all(
            accounts
                .iter()
                .zip(&events)
                .rev()
                .map(|(a, e)| native.ingest_linked(a, e)),
        )
        .await
        {
            result.unwrap();
        }
    }
    let rows = sqlx::query!(
        "SELECT message_id,effect_revision FROM whatsapp_external_message WHERE binding_id=$1",
        binding.id
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].effect_revision, 1);
    let message_id = rows[0].message_id.unwrap();
    let messages = PgMessageRepository::new(pool.clone());
    let stored = messages
        .get(&MessageParent::Channel(binding.channel_id), message_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stored.content, "One message observed seven times");
    assert!(stored.sender_id.as_user().is_none());
    // Seven concurrent quoted observations must not need a second pool
    // connection while the canonical group transaction holds its lock.
    let mut quote = event.clone();
    quote.message.as_mut().unwrap().source_id = "quoted-source".into();
    quote.message.as_mut().unwrap().text = "A quoted reply".into();
    quote.message.as_mut().unwrap().target = Some(Target {
        source_id: "same-source".into(),
        sender_jid: group.participants[7].identity.jid.clone(),
    });
    let quote_events: Vec<_> = accounts
        .iter()
        .map(|a| {
            let mut e = quote.clone();
            e.scope = a.scope().unwrap();
            e.event_id = Uuid::now_v7();
            e
        })
        .collect();
    for result in futures::future::join_all(
        accounts
            .iter()
            .zip(&quote_events)
            .map(|(a, e)| native.ingest_linked(a, e)),
    )
    .await
    {
        result.unwrap();
    }
    let quote_id=sqlx::query_scalar!("SELECT message_id FROM whatsapp_external_message WHERE binding_id=$1 AND source_id='quoted-source'",binding.id).fetch_one(&pool).await.unwrap().unwrap();
    assert_eq!(
        messages
            .get(&MessageParent::Channel(binding.channel_id), quote_id)
            .await
            .unwrap()
            .unwrap()
            .content,
        "> One message observed seven times\n\nA quoted reply"
    );
    // Different actors may use the same source ID; no text/time-based merge.
    let mut collision = event.clone();
    collision.message.as_mut().unwrap().sender = group.participants[8].identity.clone();
    native
        .ingest_linked(&accounts[0], &collision)
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar!(
            r#"SELECT count(*) AS "count!" FROM whatsapp_external_message WHERE binding_id=$1"#,
            binding.id
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        3
    );
    // An edit and deletion update the original native row, including late replays.
    let mut edit = event.clone();
    edit.message.as_mut().unwrap().kind = "edit".into();
    edit.message.as_mut().unwrap().target = Some(Target {
        source_id: "same-source".into(),
        sender_jid: group.participants[7].identity.jid.clone(),
    });
    edit.message.as_mut().unwrap().revision = 10;
    edit.message.as_mut().unwrap().text = "Corrected".into();
    native.ingest_linked(&accounts[0], &edit).await.unwrap();
    assert_eq!(
        messages
            .get(&MessageParent::Channel(binding.channel_id), message_id)
            .await
            .unwrap()
            .unwrap()
            .content,
        "Corrected"
    );
    edit.message.as_mut().unwrap().kind = "delete".into();
    edit.message.as_mut().unwrap().revision = 11;
    native.ingest_linked(&accounts[0], &edit).await.unwrap();
    native.ingest_linked(&accounts[0], &event).await.unwrap();
    assert!(
        messages
            .get(&MessageParent::Channel(binding.channel_id), message_id)
            .await
            .unwrap()
            .unwrap()
            .deleted_at
            .is_some()
    );
    // Actual owning access adapter, not a predicate-only fixture.
    native
        .require_send(binding.team_id, binding.channel_id, &accounts[1].user_id)
        .await
        .unwrap();
    group.participants.remove(1);
    group.observed_at = Utc::now();
    group.version = 2;
    repo.reconcile_group(&accounts[0], &group).await.unwrap();
    assert!(
        native
            .require_send(binding.team_id, binding.channel_id, &accounts[1].user_id)
            .await
            .is_err()
    );
    assert!(native.ingest_linked(&accounts[1], &events[1]).await.is_ok()); // no permitted bindings: drop
    native
        .require_send(binding.team_id, binding.channel_id, &accounts[2].user_id)
        .await
        .unwrap();
    let notification = Uuid::now_v7();
    sqlx::query!("INSERT INTO notification(id,event_item_id,event_item_type,notification_event_type,service_sender,metadata) VALUES($1,$2,'channel','channel_message','fixture','{}')",notification,binding.channel_id.to_string()).execute(&pool).await.unwrap();
    assert!(
        !sqlx::query_scalar!(
            r#"SELECT whatsapp_linked_notification_allowed($1,$2) AS "allowed!""#,
            notification,
            accounts[1].user_id
        )
        .fetch_one(&pool)
        .await
        .unwrap()
    );
    assert!(
        sqlx::query_scalar!(
            r#"SELECT whatsapp_linked_notification_allowed($1,$2) AS "allowed!""#,
            notification,
            accounts[2].user_id
        )
        .fetch_one(&pool)
        .await
        .unwrap()
    );
    sqlx::query!(
        "DELETE FROM team_user WHERE team_id=$1 AND user_id=$2",
        binding.team_id,
        accounts[0].user_id
    )
    .execute(&pool)
    .await
    .unwrap();
    let mut next = event;
    next.scope = accounts[2].scope().unwrap();
    next.message.as_mut().unwrap().source_id = "after-owner-removal".into();
    assert!(native.ingest_linked(&accounts[2], &next).await.is_err());
    assert_eq!(
        repo.binding(binding.channel_id)
            .await
            .unwrap()
            .unwrap()
            .ownership_state,
        "transfer_required"
    );
}
