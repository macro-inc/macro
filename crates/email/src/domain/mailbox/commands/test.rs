use super::*;
use email_api_client::domain::models::MailboxState;

#[test]
fn restoring_junk_chooses_drafts_for_drafts_and_inbox_for_received_mail() {
    let folders: Vec<_> = [("drafts", FolderRole::Drafts), ("inbox", FolderRole::Inbox)]
        .into_iter()
        .map(|(id, role)| MailFolder {
            id: ProviderId::try_from(id.to_string()).unwrap(),
            parent_id: None,
            name: id.into(),
            role,
            has_children: false,
            total_items: None,
        })
        .collect();
    for (is_draft, destination) in [(true, "drafts"), (false, "inbox")] {
        let current = MailboxOrganization {
            state: MailboxState {
                is_draft,
                in_junk: true,
                ..Default::default()
            },
            folder_id: None,
            tags: vec![],
            version: None,
            is_sent: false,
        };
        assert_eq!(
            provider_action(&MailboxAction::Junk(false), &current, &folders).unwrap(),
            Some(MessageAction::MoveToFolder(
                ProviderId::try_from(destination.to_string()).unwrap()
            ))
        );
    }
}

#[test]
fn restoring_a_conversation_leaves_its_drafts_in_drafts() {
    let folders = vec![MailFolder {
        id: ProviderId::try_from("inbox".to_string()).unwrap(),
        parent_id: None,
        name: "inbox".into(),
        role: FolderRole::Inbox,
        has_children: false,
        total_items: None,
    }];
    let organization = |is_draft| MailboxOrganization {
        state: MailboxState {
            is_draft,
            ..Default::default()
        },
        folder_id: None,
        tags: vec![],
        version: None,
        is_sent: false,
    };
    assert_eq!(
        provider_action(
            &MailboxAction::Archived(false),
            &organization(true),
            &folders
        )
        .unwrap(),
        None
    );
    assert_eq!(
        provider_action(
            &MailboxAction::Archived(false),
            &organization(false),
            &folders
        )
        .unwrap(),
        Some(MessageAction::MoveToFolder(folders[0].id.clone()))
    );
}
