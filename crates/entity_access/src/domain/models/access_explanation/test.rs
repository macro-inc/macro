use super::*;
use crate::domain::models::{
    AccessLevel, EmailAttachmentReason, Entity, EntityPermission, EntityType, ParticipantRole,
};
use models_entity_access_management::EntityAccessSourceType;
use uuid::Uuid;

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("explain@example.com").unwrap()
}

fn document() -> Entity {
    Entity {
        entity_id: "doc-1".to_string(),
        entity_type: EntityType::Document,
    }
}

#[test]
fn empty_grants_mean_no_access() {
    let explanation = AccessExplanation::from_grants(user(), document(), vec![]);

    assert_eq!(explanation.effective, None);
    assert_eq!(explanation.effective_access_level(), None);
    assert!(explanation.grants.is_empty());
}

#[test]
fn strongest_access_level_wins() {
    let grants = vec![
        AccessGrant::PublicLink {
            access_level: AccessLevel::View,
        },
        AccessGrant::EntityAccess {
            source_type: EntityAccessSourceType::User,
            source_id: "macro|explain@example.com".to_string(),
            access_level: AccessLevel::Edit,
            granted_from_project_id: None,
        },
        AccessGrant::TeamLink {
            access_level: AccessLevel::Comment,
            owner_team_id: Uuid::nil(),
        },
    ];

    let explanation = AccessExplanation::from_grants(user(), document(), grants);

    assert_eq!(
        explanation.effective,
        Some(EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit
        })
    );
}

#[test]
fn inbox_owner_is_owner() {
    let explanation = AccessExplanation::from_grants(
        user(),
        Entity {
            entity_id: "thread-1".to_string(),
            entity_type: EntityType::EmailThread,
        },
        vec![
            AccessGrant::InboxOwner,
            AccessGrant::PublicLink {
                access_level: AccessLevel::View,
            },
        ],
    );

    assert_eq!(
        explanation.effective_access_level(),
        Some(AccessLevel::Owner)
    );
}

#[test]
fn channel_participant_beats_team_view_only() {
    let explanation = AccessExplanation::from_grants(
        user(),
        Entity {
            entity_id: "channel-1".to_string(),
            entity_type: EntityType::Channel,
        },
        vec![
            AccessGrant::ChannelTeamViewOnly {
                team_id: Uuid::nil(),
            },
            AccessGrant::ChannelParticipant {
                role: ParticipantRole::Admin,
            },
        ],
    );

    assert_eq!(
        explanation.effective,
        Some(EntityPermission::ChannelRole {
            role: ParticipantRole::Admin
        })
    );
}

#[test]
fn calendar_delegate_is_edit() {
    assert_eq!(
        AccessGrant::CalendarInboxDelegate.permission(),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit
        }
    );
}

#[test]
fn containing_project_is_view() {
    assert_eq!(
        AccessGrant::ContainingProject {
            project_id: "project-1".to_string(),
        }
        .permission(),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View
        }
    );
}

#[test]
fn channel_public_default_is_member() {
    assert_eq!(
        AccessGrant::ChannelPublicDefault.permission(),
        EntityPermission::ChannelRole {
            role: ParticipantRole::Member
        }
    );
}

#[test]
fn email_attachment_reason_maps_level() {
    let thread_id = Uuid::nil();
    assert_eq!(
        AccessGrant::EmailAttachmentThread {
            thread_id,
            reason: EmailAttachmentReason::InboxOwner,
        }
        .permission(),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit
        }
    );
    assert_eq!(
        AccessGrant::EmailAttachmentThread {
            thread_id,
            reason: EmailAttachmentReason::ThreadGrant,
        }
        .permission(),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View
        }
    );
}

#[test]
fn display_lists_each_grant() {
    let explanation = AccessExplanation::from_grants(
        user(),
        document(),
        vec![AccessGrant::PublicLink {
            access_level: AccessLevel::View,
        }],
    );
    let rendered = explanation.to_string();

    assert!(rendered.contains("user: macro|explain@example.com"));
    assert!(rendered.contains("entity: document / doc-1"));
    assert!(rendered.contains("effective: view"));
    assert!(rendered.contains("public_link view"));
}
