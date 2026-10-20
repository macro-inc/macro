use super::*;
use crate::outbound::repository::test::{channel, team};
use chrono::Utc;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sha2::{Digest, Sha256};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn seven_personal_senders_share_one_group_order_and_revoke_independently(pool: PgPool) {
    let (workspace, owner) = team(&pool, "linked_owner").await;
    let channel = channel(&pool, &owner).await;
    sqlx::query!(
        "UPDATE comms_channels SET messaging_binding='whatsapp_linked_group' WHERE id=$1",
        channel
    )
    .execute(&pool)
    .await
    .unwrap();
    let binding = Uuid::now_v7();
    sqlx::query!("INSERT INTO whatsapp_group_binding(id,team_id,group_jid,channel_id,user_id,state) VALUES($1,$2,'120363123@g.us',$3,$4,'active')",binding,workspace,channel,owner).execute(&pool).await.unwrap();
    let repo = PgLinkedRepository::new(pool.clone(), true);
    let mut accounts = vec![];
    for index in 0..7 {
        let user = if index == 0 {
            owner.clone()
        } else {
            team(&pool, &format!("linked_{index}")).await.1
        };
        sqlx::query!(
            "INSERT INTO team_user(team_id,user_id,team_role) VALUES($1,$2,'member')",
            workspace,
            user
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query!("INSERT INTO comms_channel_participants(channel_id,user_id,role) VALUES($1,$2,'member')",channel,user).execute(&pool).await.unwrap();
        let pairing = repo.begin_pairing(&user, false).await.unwrap();
        let identity = format!("1555000000{index}@s.whatsapp.net");
        let account = repo.complete_pairing(&pairing, &identity).await.unwrap();
        sqlx::query!("INSERT INTO whatsapp_session_owner(account_id,worker_id,epoch,state,lease_until) VALUES($1,$2,1,'running',now()+interval '1 hour')",account.id,Uuid::now_v7()).execute(&pool).await.unwrap();
        sqlx::query!("INSERT INTO whatsapp_group_audience(binding_id,user_id,identity_jid,history_granted_at,remote_member,reconciled,membership_version,observed_at) VALUES($1,$2,$3,now(),true,true,1,now())",binding,user,identity).execute(&pool).await.unwrap();
        sqlx::query!("INSERT INTO whatsapp_group_membership(binding_id,account_id,authorization_generation,consent_at,remote_member,can_post,observed_at,metadata_version,reconciled) VALUES($1,$2,1,now(),true,true,now(),1,true)",binding,account.id).execute(&pool).await.unwrap();
        accounts.push(repo.linked_account(account.id).await.unwrap().unwrap());
    }
    // Nine remote people, seven independent Macro accounts, no cloud group limit.
    let mut participants = accounts
        .iter()
        .map(|a| Participant {
            identity: Identity {
                jid: a.identity_jid.clone().unwrap(),
                alternate_jid: None,
                display_name: None,
            },
            admin: false,
        })
        .collect::<Vec<_>>();
    participants.push(Participant {
        identity: Identity {
            jid: "15558880001@s.whatsapp.net".into(),
            alternate_jid: None,
            display_name: Some("Customer".into()),
        },
        admin: false,
    });
    participants.push(Participant {
        identity: Identity {
            jid: "15558880002@s.whatsapp.net".into(),
            alternate_jid: None,
            display_name: Some("Customer colleague".into()),
        },
        admin: false,
    });
    let group = GroupInfo {
        jid: "120363123@g.us".into(),
        name: "Existing customer group".into(),
        participants,
        announce: false,
        disappearing: false,
        community: false,
        version: 2,
        observed_at: Utc::now(),
    };
    assert_eq!(group.participants.len(), 9);
    for account in &accounts {
        repo.reconcile_group(account, &group).await.unwrap();
    }
    let conversation = repo.conversation(channel).await.unwrap().unwrap();
    for (index, account) in accounts.iter().enumerate() {
        let selected = repo
            .account_for_sender(&conversation, &account.user_id)
            .await
            .unwrap();
        assert_eq!(selected.id, account.id);
        let request = SendReply {
            idempotency_key: Uuid::now_v7(),
            message: ReplyContent::Text {
                text: format!("Deliberate reply {index}"),
            },
            reply_to: None,
            human_support: false,
        };
        let digest = Sha256::digest(serde_json::to_vec(&request).unwrap());
        repo.enqueue_send(account.id, channel, &account.user_id, &request, &digest)
            .await
            .unwrap();
        assert!(
            repo.enqueue_send(
                accounts[(index + 1) % 7].id,
                channel,
                &account.user_id,
                &request,
                &digest
            )
            .await
            .is_err()
        );
    }
    let first = repo.claim_send().await.unwrap().unwrap();
    assert_eq!(first.connection_id, accounts[0].id);
    assert!(
        repo.claim_send().await.unwrap().is_none(),
        "another sender bypassed group FIFO"
    );
    repo.disconnect_account(
        &accounts[0].user_id,
        accounts[0].id,
        accounts[0].authorization_generation,
    )
    .await
    .unwrap();
    // Disconnect ends observation/sending consent, while independent native access survives.
    assert!(
        sqlx::query_scalar!(
            r#"SELECT whatsapp_linked_can_view($1,$2) AS "allowed!""#,
            channel,
            accounts[0].user_id
        )
        .fetch_one(&pool)
        .await
        .unwrap()
    );
    let next = repo.claim_send().await.unwrap().unwrap();
    assert_eq!(next.connection_id, accounts[1].id);
    sqlx::query!(
        "UPDATE whatsapp_group_audience SET remote_member=false WHERE binding_id=$1 AND user_id=$2",
        binding,
        accounts[1].user_id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        !sqlx::query_scalar!(
            r#"SELECT whatsapp_linked_can_view($1,$2) AS "allowed!""#,
            channel,
            accounts[1].user_id
        )
        .fetch_one(&pool)
        .await
        .unwrap()
    );
    let scope = repo
        .account_for_sender(&conversation, &accounts[1].user_id)
        .await
        .unwrap();
    assert!(!repo.eligible(&scope, &conversation).await.unwrap());
    let scope = repo
        .account_for_sender(&conversation, &accounts[2].user_id)
        .await
        .unwrap();
    assert!(repo.eligible(&scope, &conversation).await.unwrap());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pairing_cannot_be_stolen_replayed_or_complete_after_expiry(pool: PgPool) {
    let (_, owner) = team(&pool, "pair_owner").await;
    let (_, other) = team(&pool, "pair_other").await;
    let repo = PgLinkedRepository::new(pool.clone(), true);
    let pairing = repo.begin_pairing(&owner, false).await.unwrap();
    assert!(repo.pairing(&other, pairing.id).await.is_err());
    repo.complete_pairing(&pairing, "15550000000@s.whatsapp.net")
        .await
        .unwrap();
    assert!(repo.pairing(&owner, pairing.id).await.is_err());
    let duplicate = repo
        .complete_pairing(&pairing, "15550000000@s.whatsapp.net")
        .await
        .unwrap();
    assert!(!repo.cancel_pairing(&pairing).await.unwrap());
    assert_eq!(
        repo.linked_account(duplicate.id)
            .await
            .unwrap()
            .unwrap()
            .authorization_generation,
        1
    );
    let steal = repo.begin_pairing(&other, false).await.unwrap();
    assert!(
        repo.complete_pairing(&steal, "15550000000@s.whatsapp.net")
            .await
            .is_err()
    );
    sqlx::query!(
        "UPDATE whatsapp_pairing SET expires_at=now()-interval '1 second' WHERE id=$1",
        steal.id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        repo.complete_pairing(&steal, "15550000001@s.whatsapp.net")
            .await
            .is_err()
    );
    repo.active_accounts().await.unwrap();
    let expired = repo
        .linked_account(steal.account_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(expired.state, AccountState::Disconnected);
    assert_eq!(expired.authorization_generation, 2);
}
