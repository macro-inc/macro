use super::*;
use crate::outbound::inbox_source::recording::{Recorded, RecordingContactLists};

fn refresh(
    contacts: RecordingContactLists,
) -> (
    DeletionRefresh<RecordingContactLists>,
    Arc<RecordingContactLists>,
) {
    let contacts = Arc::new(contacts);
    let refresh = DeletionRefresh {
        gateway: ConnectionGatewayClient::new("test".to_string(), "http://127.0.0.1:9".to_string()),
        contacts: contacts.clone(),
    };
    (refresh, contacts)
}

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|owner@example.com".to_string()).unwrap()
}

#[tokio::test]
async fn a_removed_inbox_tells_its_owners_clients_to_rescan_their_directory() {
    let (refresh, contacts) = refresh(RecordingContactLists::default());

    refresh.directory_changed(&owner()).await;

    assert_eq!(
        contacts.calls(),
        [Recorded::DirectoryChanged(vec![owner()], Vec::new())]
    );
}

#[tokio::test]
async fn a_failed_directory_notification_does_not_fail_the_deletion() {
    let (refresh, _) = refresh(RecordingContactLists::failing());

    refresh.directory_changed(&owner()).await;
}
