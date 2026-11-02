use super::*;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::atomic::{AtomicUsize, Ordering};

struct Repo {
    visible: bool,
    markdown: bool,
    member: bool,
    writes: AtomicUsize,
}

impl NoteRepository for Repo {
    type Err = std::io::Error;
    async fn document_links(&self, _: &str, _: &str) -> Result<Vec<DocumentNoteLink>, Self::Err> {
        Ok(vec![])
    }
    async fn visible(&self, _: &str, _: &NoteTarget) -> Result<bool, Self::Err> {
        Ok(self.visible)
    }
    async fn occurrence_exists(&self, _: &NoteTarget) -> Result<bool, Self::Err> {
        Ok(true)
    }
    async fn is_markdown(&self, _: &str) -> Result<bool, Self::Err> {
        Ok(self.markdown)
    }
    async fn team_member(&self, _: &str, _: Uuid) -> Result<bool, Self::Err> {
        Ok(self.member)
    }
    async fn list(&self, _: &str, _: &NoteTarget) -> Result<Vec<MeetingNote>, Self::Err> {
        Ok(vec![])
    }
    async fn picker(&self, _: &str, _: &str) -> Result<NotePicker, Self::Err> {
        Ok(NotePicker {
            documents: vec![],
            teams: vec![],
        })
    }
    async fn link(
        &self,
        _: &str,
        _: &NoteTarget,
        _: &str,
        _: Option<Uuid>,
    ) -> Result<(), Self::Err> {
        self.writes.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    async fn unlink(&self, _: &NoteTarget, _: &str) -> Result<(), Self::Err> {
        self.writes.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

#[tokio::test]
async fn sharing_requires_visible_meeting_markdown_and_membership_in_extra_team() {
    let target = NoteTarget {
        event_id: Uuid::now_v7(),
        occurrence_key: "2026-07-24T14:00:00+00:00".into(),
    };
    for (visible, markdown, member, extra_team, expected) in [
        (false, true, true, None, "meeting"),
        (true, false, true, None, "markdown"),
        (true, true, false, Some(Uuid::now_v7()), "team"),
        (true, true, false, None, "allowed"),
        (true, true, true, Some(Uuid::now_v7()), "allowed"),
    ] {
        let service = MeetingNotes::new(Repo {
            visible,
            markdown,
            member,
            writes: AtomicUsize::new(0),
        });
        let receipt = EntityAccessReceipt::dangerously_assert_authenticated_user(
            MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap(),
            "019f85aa-984e-7022-a018-4a242bcafe23",
            EntityType::Document,
        );
        let result = service.link(receipt, target.clone(), extra_team).await;
        match expected {
            "meeting" => assert!(matches!(result, Err(NoteError::NotFound))),
            "markdown" => assert!(matches!(result, Err(NoteError::NotMarkdown))),
            "team" => assert!(matches!(result, Err(NoteError::Forbidden))),
            _ => assert!(result.is_ok()),
        }
        assert_eq!(
            service.repo.writes.load(Ordering::SeqCst),
            usize::from(expected == "allowed")
        );
    }
}

#[tokio::test]
async fn unrelated_owner_receipt_cannot_share_a_document() {
    let service = MeetingNotes::new(Repo {
        visible: true,
        markdown: true,
        member: true,
        writes: AtomicUsize::new(0),
    });
    let receipt = EntityAccessReceipt::dangerously_assert_authenticated_user(
        MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap(),
        "019f85aa-984e-7022-a018-4a242bcafe23",
        EntityType::Project,
    );
    assert!(matches!(
        service
            .link(
                receipt,
                NoteTarget {
                    event_id: Uuid::now_v7(),
                    occurrence_key: "2026-07-24".into()
                },
                None
            )
            .await,
        Err(NoteError::Forbidden)
    ));
    assert_eq!(service.repo.writes.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn an_owner_can_revoke_sharing_after_losing_meeting_access() {
    let service = MeetingNotes::new(Repo {
        visible: false,
        markdown: true,
        member: false,
        writes: AtomicUsize::new(0),
    });
    let receipt = EntityAccessReceipt::dangerously_assert_authenticated_user(
        MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap(),
        "019f85aa-984e-7022-a018-4a242bcafe23",
        EntityType::Document,
    );
    service
        .unlink(
            receipt,
            NoteTarget {
                event_id: Uuid::now_v7(),
                occurrence_key: "2026-07-24".into(),
            },
        )
        .await
        .unwrap();
    assert_eq!(service.repo.writes.load(Ordering::SeqCst), 1);
}
