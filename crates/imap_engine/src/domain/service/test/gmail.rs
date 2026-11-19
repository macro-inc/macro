use super::*;
use crate::domain::service::sync::{gmail_projection, remote_organization_version};
fn remote(id: &str, label: &str, role: FolderRole, messages: Vec<RemoteMessage>) -> RemoteFolder {
    RemoteFolder {
        virtual_label: Some(label.into()),
        uid_next: Some(3),
        phantom: None,
        detected_role: Some(role),
        monitored: true,
        folder: Folder {
            sync_enabled: true,
            id: id.into(),
            parent_id: None,
            name: id.into(),
            role,
            has_children: false,
            total_items: Some(messages.len() as u32),
        },
        path: if matches!(label, "\\Spam" | "\\Trash") {
            id.into()
        } else {
            "All Mail".into()
        },
        uid_validity: 10,
        highest_modseq: None,
        sync_tier: SyncTier::Full,
        messages,
    }
}
fn message(labels: &[&str]) -> RemoteMessage {
    RemoteMessage{gmail_labels:Some(labels.iter().map(|s|(*s).to_owned()).collect()),uid:2,flags:vec![],mime:b"From: sender@example.net\r\nMessage-ID: <native@example.net>\r\nSubject: native\r\n\r\n".as_slice().into(),size:80,received_at:Utc.timestamp_opt(1_700_000_000,0).unwrap(),modseq:None,gmail_message_id:Some(42),native_message_id:Some("g:2a".into()),native_thread_id:Some("g:30".into())}
}
#[test]
fn native_label_feeds_share_identity_and_inbox_removal_has_a_real_delta() {
    let mut state = AccountState::default();
    let msg = message(&["\\Inbox", "Project"]);
    assert!(std::sync::Arc::ptr_eq(&msg.mime, &msg.clone().mime));
    merge_snapshot(
        &mut state,
        vec![
            remote("all", "\\All", FolderRole::Archive, vec![msg.clone()]),
            remote("inbox", "\\Inbox", FolderRole::Inbox, vec![msg.clone()]),
            remote("project", "Project", FolderRole::Other, vec![msg]),
        ],
    )
    .unwrap();
    assert_eq!(state.messages.len(), 1);
    assert_eq!(state.messages["g:2a"].folder_id, "inbox");
    assert_eq!(state.messages["g:2a"].tags, vec!["Project"]);
    assert_eq!(state.locations.len(), 3);
    let checkpoint = changes(&state, "inbox", None).unwrap().position;
    let archived = message(&["Project"]);
    merge_snapshot(
        &mut state,
        vec![
            remote(
                "project",
                "Project",
                FolderRole::Other,
                vec![archived.clone()],
            ),
            remote("inbox", "\\Inbox", FolderRole::Inbox, vec![]),
            remote("all", "\\All", FolderRole::Archive, vec![archived]),
        ],
    )
    .unwrap();
    assert_eq!(state.messages.len(), 1);
    assert_eq!(state.messages["g:2a"].folder_id, "all");
    assert_eq!(
        changes(&state, "inbox", Some(&checkpoint)).unwrap().removed,
        vec!["g:2a"]
    );
}
#[test]
fn physical_trash_and_junk_exclude_virtual_inbox_until_restore_and_versions_track_labels() {
    let mut state = AccountState::default();
    let inbox = message(&["\\Inbox", "Project"]);
    merge_snapshot(
        &mut state,
        vec![
            remote("all", "\\All", FolderRole::Archive, vec![inbox.clone()]),
            remote("inbox", "\\Inbox", FolderRole::Inbox, vec![inbox.clone()]),
            remote("trash", "\\Trash", FolderRole::Trash, vec![]),
            remote("junk", "\\Spam", FolderRole::Junk, vec![]),
        ],
    )
    .unwrap();
    let old = state.messages["g:2a"].version.clone();
    let mut receipt = state.locations[0].clone();
    receipt.uid = 77;
    receipt.uid_validity = 20;
    receipt.folder_id = "trash".into();
    let trashed = message(&["\\Trash", "Project"]);
    gmail_projection(&mut state, "g:2a", &trashed, &receipt).unwrap();
    assert_eq!(state.messages["g:2a"].folder_id, "trash");
    assert_eq!(state.locations.len(), 1);
    assert_eq!(state.locations[0].uid, 77);
    assert_eq!(state.locations[0].uid_validity, 20);
    assert_ne!(state.messages["g:2a"].version, old);
    receipt.folder_id = "all".into();
    receipt.uid = 88;
    receipt.uid_validity = 30;
    gmail_projection(&mut state, "g:2a", &inbox, &receipt).unwrap();
    assert_eq!(state.messages["g:2a"].folder_id, "inbox");
    assert!(
        state
            .locations
            .iter()
            .all(|l| l.uid == 88 && l.uid_validity == 30)
    );
    let mut custom = inbox.clone();
    custom.gmail_labels = Some(vec!["\\Inbox".into(), "Another".into()]);
    assert_ne!(
        remote_organization_version("inbox", &inbox).unwrap(),
        remote_organization_version("inbox", &custom).unwrap()
    );
}

#[test]
fn excluding_all_mail_and_a_custom_feed_cannot_freeze_inbox_receive_or_archive() {
    let mut state = AccountState::default();
    let first = message(&["\\Inbox", "Project"]);
    let mut all = remote("all", "\\All", FolderRole::Archive, vec![first.clone()]);
    all.folder.sync_enabled = false;
    let mut project = remote("project", "Project", FolderRole::Other, vec![]);
    project.monitored = false;
    project.folder.sync_enabled = false;
    merge_snapshot(
        &mut state,
        vec![
            all,
            remote("inbox", "\\Inbox", FolderRole::Inbox, vec![first]),
            project,
        ],
    )
    .unwrap();
    assert_eq!(state.messages["g:2a"].folder_id, "inbox");
    assert!(!state.folders["all"].folder.sync_enabled);
    let checkpoint = changes(&state, "inbox", None).unwrap().position;
    let archived = message(&["Project"]);
    let mut all = remote("all", "\\All", FolderRole::Archive, vec![archived]);
    all.folder.sync_enabled = false;
    let mut project = remote("project", "Project", FolderRole::Other, vec![]);
    project.monitored = false;
    project.folder.sync_enabled = false;
    merge_snapshot(
        &mut state,
        vec![
            remote("inbox", "\\Inbox", FolderRole::Inbox, vec![]),
            all,
            project,
        ],
    )
    .unwrap();
    assert_eq!(state.messages["g:2a"].folder_id, "all");
    assert_eq!(
        changes(&state, "inbox", Some(&checkpoint)).unwrap().removed,
        vec!["g:2a"]
    );
    assert!(!state.folders["all"].folder.sync_enabled);
    assert!(state.folders["all"].monitored);
}
