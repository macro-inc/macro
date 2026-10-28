//! Sharing a form with channels, as a database is shared.

use entity_access::domain::models::OwnerAccessLevel;
use models_permissions::share_permission::access_level::AccessLevel as ShareAccessLevel;
use models_permissions::share_permission::channel_share_permission::{
    ChannelSharePermission, UpdateChannelSharePermission, UpdateOperation,
};
use models_permissions::share_permission::{
    LinkShare, SharePermissionV2, UpdateSharePermissionRequestV2,
};

use super::*;
use crate::domain::models::{FormError, SharingRefusal};
use crate::domain::sharing::FormSharingService;

const CHANNEL: &str = "0199b1a2-0000-7000-8000-00000000c4a1";

fn owner() -> EntityAccessReceipt<OwnerAccessLevel> {
    form_receipt::<OwnerAccessLevel>(RSVP_FORM, OWNER, AccessLevel::Owner)
}

fn request(grants: Vec<UpdateChannelSharePermission>) -> UpdateSharePermissionRequestV2 {
    UpdateSharePermissionRequestV2 {
        link_share: None,
        link_share_access_level: None,
        team_share_access_level: None,
        channel_share_permissions: Some(grants),
    }
}

#[tokio::test]
async fn an_owner_shares_a_form_with_a_channel_at_view() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let forms = service(&world);
    let shared = forms
        .update_share_permissions(
            owner(),
            request(vec![UpdateChannelSharePermission {
                operation: UpdateOperation::Add,
                channel_id: CHANNEL.into(),
                access_level: Some(ShareAccessLevel::View),
            }]),
        )
        .await
        .unwrap();
    assert_eq!(
        shared,
        SharePermissionV2 {
            id: RSVP_FORM.to_string(),
            link_share: None,
            link_share_access_level: None,
            team_share_access_level: None,
            owner: OWNER.into(),
            channel_share_permissions: Some(vec![ChannelSharePermission {
                channel_id: CHANNEL.into(),
                access_level: ShareAccessLevel::View,
            }]),
        }
    );
    assert_eq!(forms.share_permissions(owner()).await.unwrap(), shared);
    assert_eq!(
        world.lock().unwrap().event_types(),
        vec!["form.sharing_changed"]
    );
}

#[tokio::test]
async fn link_team_and_malformed_channel_shares_are_refused() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let forms = service(&world);
    let link = forms
        .update_share_permissions(
            owner(),
            UpdateSharePermissionRequestV2 {
                link_share: Some(Some(LinkShare::Public)),
                link_share_access_level: None,
                team_share_access_level: None,
                channel_share_permissions: None,
            },
        )
        .await;
    assert!(matches!(
        link,
        Err(FormError::InvalidSharing(SharingRefusal::LinkShare))
    ));
    for grant in [
        UpdateChannelSharePermission {
            operation: UpdateOperation::Add,
            channel_id: "not-a-channel".into(),
            access_level: Some(ShareAccessLevel::View),
        },
        UpdateChannelSharePermission {
            operation: UpdateOperation::Add,
            channel_id: CHANNEL.into(),
            access_level: Some(ShareAccessLevel::Owner),
        },
        UpdateChannelSharePermission {
            operation: UpdateOperation::Add,
            channel_id: CHANNEL.into(),
            access_level: None,
        },
    ] {
        let refused = forms
            .update_share_permissions(owner(), request(vec![grant]))
            .await;
        assert!(matches!(
            refused,
            Err(FormError::InvalidSharing(
                SharingRefusal::InvalidChannelGrant
            ))
        ));
    }
    assert!(world.lock().unwrap().events.is_empty());
}

#[tokio::test]
async fn a_trashed_form_cannot_be_shared() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    world.lock().unwrap().forms[0].trashed_at = Some(start_of_tests());
    assert!(matches!(
        service(&world).share_permissions(owner()).await,
        Err(FormError::NotFound)
    ));
}
