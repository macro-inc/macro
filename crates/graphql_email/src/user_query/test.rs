use std::sync::{Arc, Mutex};

use async_graphql::{EmptyMutation, EmptySubscription, Schema};
use chrono::{TimeZone, Utc};
use email::domain::{
    models::{
        EmailErr, EmailSyncStatus, LabelListVisibility, LabelType, LinkLabel,
        MessageListVisibility, UserEmailLink, UserEmailLinkSettings, UserProvider,
    },
    ports::EmailUserService,
};
use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use uuid::Uuid;

use super::GraphqlEmailQuery;

#[derive(Default)]
struct FakeEmailUserService {
    requested_users: Mutex<Vec<MacroUserIdStr<'static>>>,
    fail: bool,
}

impl EmailUserService for FakeEmailUserService {
    async fn get_user_email_labels(
        &self,
        macro_id: MacroUserIdStr<'static>,
    ) -> Result<Vec<LinkLabel>, EmailErr> {
        self.requested_users.lock().unwrap().push(macro_id);
        if self.fail {
            return Err(EmailErr::InvalidEmailFilter(
                "sensitive label database detail".to_owned(),
            ));
        }
        Ok(vec![label()])
    }

    async fn get_user_email_links(
        &self,
        macro_id: MacroUserIdStr<'static>,
    ) -> Result<Vec<UserEmailLink>, EmailErr> {
        self.requested_users.lock().unwrap().push(macro_id);
        if self.fail {
            return Err(EmailErr::InvalidEmailFilter(
                "sensitive link database detail".to_owned(),
            ));
        }
        Ok(vec![link()])
    }
}

fn user_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|viewer@example.com").unwrap()
}

fn label() -> LinkLabel {
    LinkLabel {
        id: Uuid::from_u128(1),
        link_id: Uuid::from_u128(2),
        provider_label_id: "Label_42".to_owned(),
        name: "Customers".to_owned(),
        created_at: Utc.with_ymd_and_hms(2025, 1, 2, 3, 4, 5).unwrap(),
        message_list_visibility: MessageListVisibility::Show,
        label_list_visibility: LabelListVisibility::LabelShowIfUnread,
        type_: LabelType::User,
    }
}

fn link() -> UserEmailLink {
    UserEmailLink {
        id: Uuid::from_u128(2),
        macro_id: MacroUserIdStr::try_from_email("owner@example.com").unwrap(),
        email_address: EmailStr::try_from("inbox@example.com".to_owned()).unwrap(),
        photo_url: Some("https://example.com/photo.png".to_owned()),
        provider: UserProvider::Gmail,
        is_sync_active: true,
        sync_status: EmailSyncStatus::NeedsReauth,
        needs_reauth: true,
        settings: UserEmailLinkSettings {
            signature_on_replies_forwards: true,
            signature: Some("<p>Regards</p>".to_owned()),
        },
        is_primary: false,
        created_at: Utc.with_ymd_and_hms(2025, 1, 2, 3, 4, 5).unwrap(),
        updated_at: Utc.with_ymd_and_hms(2025, 2, 3, 4, 5, 6).unwrap(),
    }
}

#[tokio::test]
async fn resolves_labels_and_links_for_the_bound_authenticated_user() {
    let service = Arc::new(FakeEmailUserService::default());
    let schema = Schema::build(
        GraphqlEmailQuery::new(Arc::clone(&service), user_id()),
        EmptyMutation,
        EmptySubscription,
    )
    .finish();

    let response = schema
        .execute(
            r#"{
                emailLabels {
                    __typename id linkId providerLabelId name createdAt
                    messageListVisibility labelListVisibility type
                }
                emailLinks {
                    id macroId emailAddress photoUrl provider isSyncActive syncStatus
                    needsReauth settings { signatureOnRepliesForwards signature }
                    isPrimary createdAt updatedAt
                }
            }"#,
        )
        .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    let label = &data["emailLabels"][0];
    assert_eq!(label["__typename"], "GraphqlSoupEmailLabel");
    assert_eq!(label["id"], Uuid::from_u128(1).to_string());
    assert_eq!(label["linkId"], Uuid::from_u128(2).to_string());
    assert_eq!(label["messageListVisibility"], "show");
    assert_eq!(label["labelListVisibility"], "label_show_if_unread");
    assert_eq!(label["type"], "user");

    let link = &data["emailLinks"][0];
    assert_eq!(link["macroId"], "macro|owner@example.com");
    assert_eq!(link["emailAddress"], "inbox@example.com");
    assert_eq!(link["provider"], "GMAIL");
    assert_eq!(link["syncStatus"], "NEEDS_REAUTH");
    assert_eq!(link["needsReauth"], true);
    assert_eq!(link["settings"]["signatureOnRepliesForwards"], true);
    assert_eq!(link["settings"]["signature"], "<p>Regards</p>");
    assert_eq!(
        *service.requested_users.lock().unwrap(),
        vec![user_id(), user_id()]
    );

    let sdl = schema.sdl();
    assert!(!sdl.to_ascii_lowercase().contains("fusionauth"));
}

#[tokio::test]
async fn returns_safe_graphql_errors_for_domain_failures() {
    let service = Arc::new(FakeEmailUserService {
        fail: true,
        ..Default::default()
    });
    let schema = Schema::build(
        GraphqlEmailQuery::new(service, user_id()),
        EmptyMutation,
        EmptySubscription,
    )
    .finish();

    let response = schema
        .execute("{ emailLabels { id } emailLinks { id } }")
        .await;

    assert_eq!(response.errors.len(), 2);
    let messages = response
        .errors
        .iter()
        .map(|error| error.message.as_str())
        .collect::<Vec<_>>();
    assert!(messages.contains(&"email labels are unavailable"));
    assert!(messages.contains(&"email links are unavailable"));
    assert!(
        response
            .errors
            .iter()
            .all(|error| !error.message.contains("sensitive"))
    );
}
