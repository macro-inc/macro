use super::*;

const LINK: Uuid = Uuid::from_u128(1);
const MESSAGE: Uuid = Uuid::from_u128(2);
const IMPORTED: Uuid = Uuid::from_u128(3);
const ORIGINAL: Uuid = Uuid::from_u128(4);
const CANONICAL: Uuid = Uuid::from_u128(5);

struct Fake {
    calls: Vec<(&'static str, Vec<Uuid>)>,
    imported: Option<Uuid>,
    canonical: Option<Uuid>,
    empty: bool,
    duplicates: Vec<(Uuid, Uuid)>,
    fail: Option<&'static str>,
}
impl Fake {
    fn ready() -> Self {
        Self {
            calls: vec![],
            imported: Some(IMPORTED),
            canonical: Some(CANONICAL),
            empty: true,
            duplicates: vec![
                (Uuid::from_u128(11), Uuid::from_u128(21)),
                (Uuid::from_u128(12), Uuid::from_u128(22)),
            ],
            fail: None,
        }
    }
    fn hit(&mut self, name: &'static str, ids: Vec<Uuid>) -> anyhow::Result<()> {
        self.calls.push((name, ids));
        anyhow::ensure!(self.fail != Some(name), "{name} failed");
        Ok(())
    }
    fn names(&self) -> Vec<&'static str> {
        self.calls.iter().map(|(name, _)| *name).collect()
    }
}
impl MessageIdentityQueries for Fake {
    async fn imported_message(
        &mut self,
        link_id: Uuid,
        message_id: Uuid,
        provider_id: &str,
    ) -> anyhow::Result<Option<Uuid>> {
        assert_eq!(provider_id, "provider");
        self.hit("imported_message", vec![link_id, message_id])?;
        Ok(self.imported)
    }
    async fn adopt_metadata(
        &mut self,
        link_id: Uuid,
        message_id: Uuid,
        imported_id: Uuid,
    ) -> anyhow::Result<()> {
        self.hit("adopt_metadata", vec![link_id, message_id, imported_id])?;
        Ok(())
    }
    async fn adopt_labels(&mut self, message_id: Uuid, imported_id: Uuid) -> anyhow::Result<()> {
        self.hit("adopt_labels", vec![message_id, imported_id])?;
        Ok(())
    }
    async fn adopt_recipients(
        &mut self,
        message_id: Uuid,
        imported_id: Uuid,
    ) -> anyhow::Result<()> {
        self.hit("adopt_recipients", vec![message_id, imported_id])?;
        Ok(())
    }
    async fn adopt_calendar(&mut self, message_id: Uuid, imported_id: Uuid) -> anyhow::Result<()> {
        self.hit("adopt_calendar", vec![message_id, imported_id])?;
        Ok(())
    }
    async fn adopt_replies(&mut self, message_id: Uuid, imported_id: Uuid) -> anyhow::Result<()> {
        self.hit("adopt_replies", vec![message_id, imported_id])?;
        Ok(())
    }
    async fn adopt_client_ids(
        &mut self,
        message_id: Uuid,
        imported_id: Uuid,
    ) -> anyhow::Result<()> {
        self.hit("adopt_client_ids", vec![message_id, imported_id])?;
        Ok(())
    }
    async fn adopt_draft_attachments(
        &mut self,
        message_id: Uuid,
        imported_id: Uuid,
    ) -> anyhow::Result<()> {
        self.hit("adopt_draft_attachments", vec![message_id, imported_id])?;
        Ok(())
    }
    async fn adopt_forwarded_attachments(
        &mut self,
        message_id: Uuid,
        imported_id: Uuid,
    ) -> anyhow::Result<()> {
        self.hit("adopt_forwarded_attachments", vec![message_id, imported_id])?;
        Ok(())
    }
    async fn remove_imported_message(&mut self, imported_id: Uuid) -> anyhow::Result<()> {
        self.hit("remove_imported_message", vec![imported_id])?;
        Ok(())
    }
    async fn duplicate_attachments(
        &mut self,
        message_id: Uuid,
        imported_id: Uuid,
    ) -> anyhow::Result<Vec<(Uuid, Uuid)>> {
        self.hit("duplicate_attachments", vec![message_id, imported_id])?;
        Ok(self.duplicates.clone())
    }
    async fn adopt_attachment_storage(
        &mut self,
        provider_attachment_id: Uuid,
        local_attachment_id: Uuid,
    ) -> anyhow::Result<()> {
        self.hit(
            "adopt_attachment_storage",
            vec![provider_attachment_id, local_attachment_id],
        )?;
        Ok(())
    }
    async fn adopt_forwarded_references(
        &mut self,
        provider_attachment_id: Uuid,
        local_attachment_id: Uuid,
    ) -> anyhow::Result<()> {
        self.hit(
            "adopt_forwarded_references",
            vec![provider_attachment_id, local_attachment_id],
        )?;
        Ok(())
    }
    async fn adopt_document_references(
        &mut self,
        provider_attachment_id: Uuid,
        local_attachment_id: Uuid,
    ) -> anyhow::Result<()> {
        self.hit(
            "adopt_document_references",
            vec![provider_attachment_id, local_attachment_id],
        )?;
        Ok(())
    }
    async fn remove_duplicate_attachment(
        &mut self,
        local_attachment_id: Uuid,
    ) -> anyhow::Result<()> {
        self.hit("remove_duplicate_attachment", vec![local_attachment_id])?;
        Ok(())
    }
    async fn adopt_attachments(
        &mut self,
        message_id: Uuid,
        imported_id: Uuid,
    ) -> anyhow::Result<()> {
        self.hit("adopt_attachments", vec![message_id, imported_id])?;
        Ok(())
    }
}
impl ThreadIdentityQueries for Fake {
    async fn original_thread(&mut self, message_id: Uuid, link_id: Uuid) -> anyhow::Result<Uuid> {
        self.hit("original_thread", vec![message_id, link_id])?;
        Ok(ORIGINAL)
    }
    async fn canonical_thread(
        &mut self,
        link_id: Uuid,
        provider_thread_id: &str,
    ) -> anyhow::Result<Option<Uuid>> {
        assert_eq!(provider_thread_id, "thread-provider");
        self.hit("canonical_thread", vec![link_id])?;
        Ok(self.canonical)
    }
    async fn move_message_thread(
        &mut self,
        message_id: Uuid,
        link_id: Uuid,
        canonical: Uuid,
    ) -> anyhow::Result<()> {
        self.hit("move_message_thread", vec![message_id, link_id, canonical])?;
        Ok(())
    }
    async fn move_attempt_thread(
        &mut self,
        message_id: Uuid,
        link_id: Uuid,
        canonical: Uuid,
    ) -> anyhow::Result<()> {
        self.hit("move_attempt_thread", vec![message_id, link_id, canonical])?;
        Ok(())
    }
    async fn original_thread_empty(&mut self, original: Uuid) -> anyhow::Result<bool> {
        self.hit("original_thread_empty", vec![original])?;
        Ok(self.empty)
    }
    async fn redirect_thread_aliases(
        &mut self,
        link_id: Uuid,
        original: Uuid,
        canonical: Uuid,
    ) -> anyhow::Result<()> {
        self.hit(
            "redirect_thread_aliases",
            vec![link_id, original, canonical],
        )?;
        Ok(())
    }
    async fn redirect_original_thread(
        &mut self,
        original: Uuid,
        link_id: Uuid,
        canonical: Uuid,
    ) -> anyhow::Result<()> {
        self.hit(
            "redirect_original_thread",
            vec![original, link_id, canonical],
        )?;
        Ok(())
    }
    async fn metadata(&mut self, thread: Uuid, link: Uuid) -> anyhow::Result<()> {
        self.hit("metadata", vec![thread, link])?;
        Ok(())
    }
    async fn attachment_flags(&mut self, thread: Uuid) -> anyhow::Result<()> {
        self.hit("attachment_flags", vec![thread])?;
        Ok(())
    }
    async fn mark_sent(
        &mut self,
        provider: &str,
        provider_thread: &str,
        link: Uuid,
        message: Uuid,
    ) -> anyhow::Result<()> {
        assert_eq!(provider, "provider");
        assert_eq!(provider_thread, "thread-provider");
        self.hit("mark_sent", vec![link, message])?;
        Ok(())
    }
    async fn thread_provider(
        &mut self,
        thread: Uuid,
        link: Uuid,
        provider: &str,
    ) -> anyhow::Result<()> {
        assert_eq!(provider, "thread-provider");
        self.hit("thread_provider", vec![thread, link])?;
        Ok(())
    }
}

#[tokio::test]
async fn absent_import_does_not_change_any_identity() {
    let mut fake = Fake::ready();
    fake.imported = None;
    reconcile_message(&mut fake, LINK, MESSAGE, "provider")
        .await
        .unwrap();
    assert_eq!(fake.names(), ["imported_message"]);
}
#[tokio::test]
async fn duplicate_attachment_references_move_before_each_duplicate_and_import_are_deleted() {
    let mut fake = Fake::ready();
    reconcile_message(&mut fake, LINK, MESSAGE, "provider")
        .await
        .unwrap();
    assert_eq!(
        fake.names(),
        [
            "imported_message",
            "adopt_metadata",
            "adopt_labels",
            "adopt_recipients",
            "adopt_calendar",
            "adopt_replies",
            "adopt_client_ids",
            "adopt_draft_attachments",
            "adopt_forwarded_attachments",
            "duplicate_attachments",
            "adopt_attachment_storage",
            "adopt_forwarded_references",
            "adopt_document_references",
            "remove_duplicate_attachment",
            "adopt_attachment_storage",
            "adopt_forwarded_references",
            "adopt_document_references",
            "remove_duplicate_attachment",
            "adopt_attachments",
            "remove_imported_message"
        ]
    );
    assert_eq!(fake.calls[0].1, [LINK, MESSAGE]);
    assert_eq!(fake.calls[1].1, [LINK, MESSAGE, IMPORTED]);
    assert_eq!(fake.calls[10].1, [Uuid::from_u128(21), Uuid::from_u128(11)]);
    assert_eq!(fake.calls[14].1, [Uuid::from_u128(22), Uuid::from_u128(12)]);
    assert_eq!(fake.calls[18].1, [MESSAGE, IMPORTED]);
    assert_eq!(fake.calls[19].1, [IMPORTED]);
}
#[tokio::test]
async fn no_duplicate_still_moves_provider_attachments_before_deleting_import() {
    let mut fake = Fake::ready();
    fake.duplicates.clear();
    reconcile_message(&mut fake, LINK, MESSAGE, "provider")
        .await
        .unwrap();
    assert_eq!(
        &fake.names()[9..],
        [
            "duplicate_attachments",
            "adopt_attachments",
            "remove_imported_message"
        ]
    );
}
#[tokio::test]
async fn every_message_adoption_error_stops_with_original_cause() {
    for fail in [
        "imported_message",
        "adopt_metadata",
        "adopt_labels",
        "adopt_recipients",
        "adopt_calendar",
        "adopt_replies",
        "adopt_client_ids",
        "adopt_draft_attachments",
        "adopt_forwarded_attachments",
        "duplicate_attachments",
        "adopt_attachment_storage",
        "adopt_forwarded_references",
        "adopt_document_references",
        "remove_duplicate_attachment",
        "adopt_attachments",
        "remove_imported_message",
    ] {
        let mut fake = Fake::ready();
        fake.fail = Some(fail);
        assert_eq!(
            reconcile_message(&mut fake, LINK, MESSAGE, "provider")
                .await
                .unwrap_err()
                .to_string(),
            format!("{fail} failed")
        );
        assert_eq!(fake.names().last(), Some(&fail));
    }
}
#[tokio::test]
async fn no_canonical_or_same_thread_keeps_original_without_writes() {
    for canonical in [None, Some(ORIGINAL)] {
        let mut fake = Fake::ready();
        fake.canonical = canonical;
        assert_eq!(
            reconcile_sent_thread(&mut fake, LINK, MESSAGE, "thread-provider")
                .await
                .unwrap(),
            ORIGINAL
        );
        assert_eq!(fake.names(), ["original_thread", "canonical_thread"]);
    }
}
#[tokio::test]
async fn aliases_redirect_only_once_the_original_is_empty_and_projections_always_refresh() {
    for empty in [false, true] {
        let mut fake = Fake::ready();
        fake.empty = empty;
        assert_eq!(
            reconcile_sent_thread(&mut fake, LINK, MESSAGE, "thread-provider")
                .await
                .unwrap(),
            CANONICAL
        );
        let expected = if empty {
            vec![
                "original_thread",
                "canonical_thread",
                "move_message_thread",
                "move_attempt_thread",
                "original_thread_empty",
                "redirect_thread_aliases",
                "redirect_original_thread",
                "metadata",
                "attachment_flags",
            ]
        } else {
            vec![
                "original_thread",
                "canonical_thread",
                "move_message_thread",
                "move_attempt_thread",
                "original_thread_empty",
                "metadata",
                "attachment_flags",
            ]
        };
        assert_eq!(fake.names(), expected);
        assert_eq!(fake.calls[2].1, [MESSAGE, LINK, CANONICAL]);
        assert_eq!(fake.calls.last().unwrap().1, [ORIGINAL]);
    }
}
#[tokio::test]
async fn every_thread_adoption_error_preserves_cause_and_stops() {
    for fail in [
        "original_thread",
        "canonical_thread",
        "move_message_thread",
        "move_attempt_thread",
        "original_thread_empty",
        "redirect_thread_aliases",
        "redirect_original_thread",
        "metadata",
        "attachment_flags",
    ] {
        let mut fake = Fake::ready();
        fake.fail = Some(fail);
        assert_eq!(
            reconcile_sent_thread(&mut fake, LINK, MESSAGE, "thread-provider")
                .await
                .unwrap_err()
                .to_string(),
            format!("{fail} failed")
        );
        assert_eq!(fake.names().last(), Some(&fail));
    }
}
fn sent() -> MessageToSend {
    MessageToSend {
        db_id: Some(MESSAGE),
        provider_id: Some("provider".into()),
        replying_to_id: None,
        provider_thread_id: Some("thread-provider".into()),
        thread_db_id: Some(ORIGINAL),
        link_id: LINK,
        subject: String::new(),
        to: None,
        cc: None,
        bcc: None,
        body_text: None,
        body_html: None,
        body_macro: None,
        attachments: None,
        headers_json: None,
        send_time: None,
    }
}
#[tokio::test]
async fn completion_updates_message_thread_before_the_original_projection_sequence() {
    let mut fake = Fake::ready();
    fake.imported = None;
    let mut message = sent();
    process_sent_message(&mut fake, &mut message).await.unwrap();
    assert_eq!(message.thread_db_id, Some(CANONICAL));
    assert_eq!(
        &fake.names()[fake.calls.len() - 4..],
        [
            "mark_sent",
            "thread_provider",
            "metadata",
            "attachment_flags"
        ]
    );
    assert_eq!(fake.calls[fake.calls.len() - 4].1, [LINK, MESSAGE]);
    assert_eq!(fake.calls.last().unwrap().1, [CANONICAL]);
}
#[tokio::test]
async fn missing_provider_identifiers_preserve_errors_and_prior_adoption_boundary() {
    let mut fake = Fake::ready();
    let mut message = sent();
    message.provider_id = None;
    assert_eq!(
        process_sent_message(&mut fake, &mut message)
            .await
            .unwrap_err()
            .to_string(),
        "sent message has no provider ID"
    );
    assert!(fake.calls.is_empty());
    let mut fake = Fake::ready();
    fake.imported = None;
    let mut message = sent();
    message.provider_thread_id = None;
    assert_eq!(
        process_sent_message(&mut fake, &mut message)
            .await
            .unwrap_err()
            .to_string(),
        "sent message has no provider thread ID"
    );
    assert_eq!(fake.names(), ["imported_message"]);
}
#[tokio::test]
async fn each_final_projection_error_stops_after_the_selected_thread_is_applied() {
    for fail in [
        "mark_sent",
        "thread_provider",
        "metadata",
        "attachment_flags",
    ] {
        let mut fake = Fake::ready();
        fake.imported = None;
        fake.canonical = None;
        fake.fail = Some(fail);
        let mut message = sent();
        assert_eq!(
            process_sent_message(&mut fake, &mut message)
                .await
                .unwrap_err()
                .to_string(),
            format!("{fail} failed")
        );
        assert_eq!(fake.names().last(), Some(&fail));
        assert_eq!(message.thread_db_id, Some(ORIGINAL));
    }
}
