use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use chrono::Utc;
use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use uuid::Uuid;

use crate::domain::{
    models::{
        EmailBackfillStatus, EmailInboxDetails, EmailSyncStatus, Link, LinkLabel,
        UserEmailLinkSettings, UserProvider,
    },
    ports::{EmailUserRepo, EmailUserService},
};

use super::super::EmailServiceImpl;

#[derive(Clone, Default)]
struct FakeUserRepo {
    inboxes: Vec<Link>,
    labels: HashMap<Uuid, Vec<LinkLabel>>,
    details: Vec<EmailInboxDetails>,
    requested_users: Arc<Mutex<Vec<MacroUserIdStr<'static>>>>,
    requested_label_links: Arc<Mutex<Vec<Uuid>>>,
}

impl EmailUserRepo for FakeUserRepo {
    async fn user_accessible_inboxes(
        &self,
        macro_id: MacroUserIdStr<'static>,
    ) -> Result<Vec<Link>, crate::domain::models::EmailErr> {
        self.requested_users.lock().unwrap().push(macro_id);
        Ok(self.inboxes.clone())
    }

    async fn user_labels_for_link(
        &self,
        link_id: Uuid,
    ) -> Result<Vec<LinkLabel>, crate::domain::models::EmailErr> {
        self.requested_label_links.lock().unwrap().push(link_id);
        Ok(self.labels.get(&link_id).cloned().unwrap_or_default())
    }

    async fn user_inbox_details(
        &self,
        macro_id: MacroUserIdStr<'static>,
    ) -> Result<Vec<EmailInboxDetails>, crate::domain::models::EmailErr> {
        self.requested_users.lock().unwrap().push(macro_id);
        Ok(self.details.clone())
    }
}

fn service(repo: FakeUserRepo) -> EmailServiceImpl<FakeUserRepo, (), (), (), (), ()> {
    EmailServiceImpl {
        email_repo: repo,
        frecency_service: (),
        enqueuer: (),
        crm_service: (),
        entity_access_management_service: (),
        macro_event_broker: (),
        sent_undo_delay_secs: 0,
    }
}

fn user_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|viewer@example.com").unwrap()
}

fn link(id: Uuid, owner: &str) -> Link {
    Link {
        id,
        macro_id: MacroUserIdStr::try_from_email(owner).unwrap(),
        fusionauth_user_id: "internal-auth-id".to_owned(),
        email_address: EmailStr::try_from(owner.to_owned()).unwrap(),
        provider: UserProvider::Gmail,
        is_sync_active: true,
        is_primary: true,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

fn label(id: Uuid, link_id: Uuid, name: &str) -> LinkLabel {
    LinkLabel {
        id,
        link_id,
        provider_label_id: name.to_uppercase(),
        name: name.to_owned(),
        created_at: Utc::now(),
        message_list_visibility: crate::domain::models::MessageListVisibility::Show,
        label_list_visibility: crate::domain::models::LabelListVisibility::LabelShow,
        type_: crate::domain::models::LabelType::User,
    }
}

#[tokio::test]
async fn labels_are_aggregated_across_owned_and_delegated_inboxes_in_order() {
    let owned = Uuid::from_u128(1);
    let delegated = Uuid::from_u128(2);
    let owned_label = label(Uuid::from_u128(10), owned, "Owned");
    let delegated_label = label(Uuid::from_u128(20), delegated, "Delegated");
    let repo = FakeUserRepo {
        inboxes: vec![
            link(owned, "viewer@example.com"),
            link(delegated, "delegate@example.com"),
        ],
        labels: HashMap::from([
            (owned, vec![owned_label.clone()]),
            (delegated, vec![delegated_label.clone()]),
        ]),
        ..Default::default()
    };
    let requested_users = Arc::clone(&repo.requested_users);
    let requested_label_links = Arc::clone(&repo.requested_label_links);

    let labels = service(repo)
        .get_user_email_labels(user_id())
        .await
        .unwrap();

    assert_eq!(
        labels.iter().map(|label| label.id).collect::<Vec<_>>(),
        vec![owned_label.id, delegated_label.id]
    );
    assert_eq!(*requested_users.lock().unwrap(), vec![user_id()]);
    assert_eq!(
        *requested_label_links.lock().unwrap(),
        vec![owned, delegated]
    );
}

#[tokio::test]
async fn links_are_scoped_to_the_user_and_enriched_by_domain_policy() {
    let link_id = Uuid::from_u128(30);
    let now = Utc::now();
    let repo = FakeUserRepo {
        details: vec![EmailInboxDetails {
            id: link_id,
            macro_id: MacroUserIdStr::try_from_email("delegate@example.com").unwrap(),
            email_address: EmailStr::try_from("delegate@example.com".to_owned()).unwrap(),
            photo_url: Some("https://example.com/photo.png".to_owned()),
            provider: UserProvider::Gmail,
            is_sync_active: true,
            needs_reauth: false,
            settings: UserEmailLinkSettings {
                signature_on_replies_forwards: true,
                signature: Some("<p>Regards</p>".to_owned()),
            },
            is_primary: true,
            latest_backfill_status: Some(EmailBackfillStatus::InProgress),
            created_at: now,
            updated_at: now,
        }],
        ..Default::default()
    };
    let requested_users = Arc::clone(&repo.requested_users);

    let links = service(repo).get_user_email_links(user_id()).await.unwrap();

    assert_eq!(*requested_users.lock().unwrap(), vec![user_id()]);
    assert_eq!(links.len(), 1);
    assert_eq!(links[0].id, link_id);
    assert_eq!(links[0].sync_status, EmailSyncStatus::Syncing);
    assert_eq!(
        links[0].settings.signature.as_deref(),
        Some("<p>Regards</p>")
    );
}
