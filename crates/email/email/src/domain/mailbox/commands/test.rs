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
