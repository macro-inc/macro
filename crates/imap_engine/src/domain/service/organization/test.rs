use super::*;
fn folder(id: &str, path: &str, label: Option<&str>, role: FolderRole) -> FolderState {
    FolderState {
        monitored: true,
        virtual_label: label.map(str::to_owned),
        uid_next: None,
        phantom: None,
        detected_role: None,
        folder: Folder {
            sync_enabled: true,
            id: id.into(),
            parent_id: None,
            name: id.into(),
            role,
            has_children: false,
            total_items: None,
        },
        path: path.into(),
        uid_validity: 1,
        highest_modseq: None,
        sync_tier: None,
        sequence: 0,
        journal: Vec::new(),
    }
}
fn facts(labels: Option<Vec<&str>>) -> RemoteMessage {
    RemoteMessage {
        gmail_labels: labels.map(|labels| labels.into_iter().map(str::to_owned).collect()),
        uid: 1,
        flags: Vec::new(),
        mime: Vec::new().into(),
        size: 10,
        received_at: Utc::now(),
        modseq: None,
        gmail_message_id: None,
        native_message_id: None,
        native_thread_id: None,
    }
}
#[test]
fn gmail_archive_and_filing_change_labels_instead_of_moving_all_mail() {
    let inbox = folder(
        "inbox",
        "[Gmail]/All Mail",
        Some("\\Inbox"),
        FolderRole::Inbox,
    );
    let all = folder(
        "all",
        "[Gmail]/All Mail",
        Some("\\All"),
        FolderRole::Archive,
    );
    let custom = folder(
        "custom",
        "[Gmail]/All Mail",
        Some("Work/Review"),
        FolderRole::Other,
    );
    let current = facts(Some(vec!["\\Inbox", "\\Sent", "Keep"]));
    let (action, physical) =
        remote_action(&MessageAction::Archive, &inbox, Some(&all), &current).unwrap();
    assert!(!physical);
    assert!(
        matches!(action,RemoteAction::GmailLabels {add,remove} if add.is_empty() && remove==["\\Inbox"])
    );
    let action = MessageAction::MoveToFolder(
        email_api_client::domain::models::ProviderId::new("custom").unwrap(),
    );
    let (action, physical) = remote_action(&action, &inbox, Some(&custom), &current).unwrap();
    assert!(!physical);
    assert!(
        matches!(action,RemoteAction::GmailLabels {add,remove} if add==["Work/Review"] && remove==["\\Inbox"])
    );
}
#[test]
fn gmail_keywords_preserve_system_labels_and_plain_imap_keeps_keyword_flags() {
    let inbox = folder("inbox", "All", Some("\\Inbox"), FolderRole::Inbox);
    let desired = MessageAction::SetTags(vec!["New".into()]);
    let (action, physical) = remote_action(
        &desired,
        &inbox,
        None,
        &facts(Some(vec!["\\Inbox", "\\Sent", "Old"])),
    )
    .unwrap();
    assert!(!physical);
    assert!(
        matches!(action,RemoteAction::GmailLabels {add,remove} if add==["New"] && remove==["Old"])
    );
    let (action, physical) = remote_action(&desired, &inbox, None, &facts(None)).unwrap();
    assert!(!physical);
    assert!(matches!(action,RemoteAction::Keywords(tags) if tags==["New"]));
    let invalid = MessageAction::SetTags(vec!["\\Trash".into()]);
    assert!(matches!(
        remote_action(&invalid, &inbox, None, &facts(Some(vec![]))),
        Err(Error::Invalid)
    ));
}
#[test]
fn physical_trash_and_plain_imap_moves_remain_physical_despite_effective_role_overrides() {
    let inbox = folder("inbox", "All", Some("\\Inbox"), FolderRole::Inbox);
    let trash = folder("trash", "Trash", Some("\\Trash"), FolderRole::Trash);
    let custom_trash = folder("custom", "All", Some("CustomTrash"), FolderRole::Trash);
    let action = MessageAction::MoveToFolder(
        email_api_client::domain::models::ProviderId::new("trash").unwrap(),
    );
    let (remote, physical) =
        remote_action(&action, &inbox, Some(&trash), &facts(Some(vec!["\\Inbox"]))).unwrap();
    assert!(physical);
    assert!(matches!(remote,RemoteAction::Move(path) if path=="Trash"));
    let (remote, physical) = remote_action(
        &action,
        &inbox,
        Some(&custom_trash),
        &facts(Some(vec!["\\Inbox"])),
    )
    .unwrap();
    assert!(!physical);
    assert!(matches!(remote,RemoteAction::GmailLabels {add,..} if add==["CustomTrash"]));
    let generic = folder("inbox", "INBOX", None, FolderRole::Inbox);
    let (remote, physical) = remote_action(&action, &generic, Some(&trash), &facts(None)).unwrap();
    assert!(physical);
    assert!(matches!(remote,RemoteAction::Move(path) if path=="Trash"));
}
