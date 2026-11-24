use super::*;
use crate::domain::ports::OwnerInboxes;

const MINE: &str = "01900000-0000-7000-8000-0000000000a1";
const SHARED_WITH_ME: &str = "01900000-0000-7000-8000-0000000000a2";
const SOMEONE_ELSES: &str = "01900000-0000-7000-8000-0000000000a3";

/// The owner's inboxes, which they can connect and disconnect.
#[derive(Default)]
struct Inboxes(Mutex<Vec<Uuid>>);

impl Inboxes {
    fn set(&self, inboxes: &[&str]) {
        *self.0.lock().unwrap() = inboxes.iter().map(|id| id.parse().unwrap()).collect();
    }
}

#[async_trait::async_trait]
impl OwnerInboxes for Inboxes {
    async fn among(
        &self,
        owner: &MacroUserIdStr<'_>,
        inboxes: &[Uuid],
    ) -> std::result::Result<Vec<Uuid>, crate::domain::ports::OwnerInboxesError> {
        assert_eq!(owner.as_ref(), user().as_ref());
        let theirs = self.0.lock().unwrap();
        Ok(inboxes
            .iter()
            .copied()
            .filter(|inbox| theirs.contains(inbox))
            .collect())
    }
}

fn picking(inboxes: &[&str]) -> ActionConfiguration {
    ActionConfiguration {
        trigger: serde_json::from_value(json!({
            "type": "events",
            "filters": [{"events": ["email.message_received"], "inboxes": inboxes}]
        }))
        .unwrap(),
        ..configuration(true)
    }
}

#[tokio::test]
async fn an_inbox_filter_names_only_inboxes_its_owner_receives_mail_in() {
    let inboxes = Arc::new(Inboxes::default());
    inboxes.set(&[MINE, SHARED_WITH_ME]);
    let svc = inbox_service(Arc::<Inboxes>::clone(&inboxes));

    assert_policy(
        svc.create_action(&user_principal(), picking(&[MINE, SOMEONE_ELSES]))
            .await,
        ActionPolicyError::UnknownInboxes,
    );
    let created = svc
        .create_action(&user_principal(), picking(&[MINE, SHARED_WITH_ME]))
        .await
        .unwrap();
    let id = created.id.unwrap();
    assert_policy(
        svc.update_action(
            edit_receipt(id),
            update(picking(&[SOMEONE_ELSES])),
            Requester::Person,
        )
        .await,
        ActionPolicyError::UnknownInboxes,
    );
    let check = svc
        .check_action(
            &user_principal(),
            picking(&[SOMEONE_ELSES]),
            Vec::new(),
            Vec::new(),
            None,
        )
        .await
        .unwrap();
    assert!(!check.ok);
    assert_eq!(
        check.problems,
        [ActionPolicyError::UnknownInboxes.to_string()]
    );
}

#[tokio::test]
async fn an_inbox_disconnected_later_blocks_only_a_change_of_trigger() {
    let inboxes = Arc::new(Inboxes::default());
    inboxes.set(&[MINE, SHARED_WITH_ME]);
    let svc = inbox_service(Arc::<Inboxes>::clone(&inboxes));
    let created = svc
        .create_action(&user_principal(), picking(&[SHARED_WITH_ME]))
        .await
        .unwrap();
    let id = created.id.unwrap();
    inboxes.set(&[MINE]);

    let renamed = svc
        .update_action(
            edit_receipt(id),
            update(ActionConfiguration {
                name: "renamed".into(),
                ..picking(&[SHARED_WITH_ME])
            }),
            Requester::Person,
        )
        .await
        .unwrap();
    assert_eq!(renamed.name, "renamed");
    assert_policy(
        svc.update_action(
            edit_receipt(id),
            update(picking(&[MINE, SHARED_WITH_ME])),
            Requester::Person,
        )
        .await,
        ActionPolicyError::UnknownInboxes,
    );
    // Every inbox needs no check.
    svc.update_action(edit_receipt(id), update(picking(&[])), Requester::Person)
        .await
        .unwrap();
}

#[tokio::test]
async fn without_a_list_of_inboxes_none_can_be_picked() {
    let svc = service(true);
    assert_policy(
        svc.create_action(&user_principal(), picking(&[MINE])).await,
        ActionPolicyError::UnknownInboxes,
    );
    svc.create_action(&user_principal(), picking(&[]))
        .await
        .unwrap();
}
