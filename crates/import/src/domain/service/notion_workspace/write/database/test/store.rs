use super::*;

/// What earlier attempts recorded, kept the way the ledger keeps it: the
/// first record of an object wins.
#[derive(Default)]
pub(super) struct FakeStore {
    pub(super) warnings: Mutex<Vec<String>>,
    pub(super) typed_warnings: Mutex<Vec<crate::domain::models::FidelityWarning>>,
    pub(super) warning_updates: std::sync::atomic::AtomicUsize,
    pub(super) written: Mutex<Vec<WrittenObject>>,
    pub(super) notices: Mutex<HashMap<(Uuid, Uuid), crate::domain::ports::TaskImportNoticeReason>>,
}

impl WrittenObjects for FakeStore {
    async fn confirmed_notion_writes(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &[Uuid],
    ) -> crate::domain::ports::Result<crate::domain::models::ConfirmedNotionWrites> {
        unreachable!("database write tests do not read workspace reports")
    }
    async fn replace_database_outage(
        &self,
        _: &MacroUserIdStr<'static>,
        import_id: Uuid,
        _: Uuid,
        expected: Option<&str>,
        facts: &[WrittenObject],
    ) -> crate::domain::ports::Result<()> {
        let prefix = crate::domain::models::NOTION_OUTAGE_PREFIX;
        let mut stored = self.written.lock().unwrap();
        let current: Vec<_> = stored
            .iter()
            .filter(|fact| {
                fact.import_id == import_id
                    && fact.kind == WrittenKind::DatabaseReservationFailure
                    && fact.object.starts_with(prefix)
            })
            .map(|fact| fact.object.as_str())
            .collect();
        let next = facts
            .iter()
            .find(|fact| fact.object.starts_with(prefix))
            .unwrap();
        if current == [next.object.as_str()] {
            return Ok(());
        }
        if current != expected.into_iter().collect::<Vec<_>>() {
            return Err(crate::domain::ports::ImportError::NotReady(
                "Retry state changed.",
            ));
        }
        stored.retain(|fact| {
            fact.import_id != import_id
                || fact.kind != WrittenKind::DatabaseReservationFailure
                || !fact.object.starts_with(prefix)
        });
        for fact in facts {
            if !stored.iter().any(|known| {
                known.import_id == fact.import_id
                    && known.kind == fact.kind
                    && known.object == fact.object
            }) {
                stored.push(fact.clone());
            }
        }
        Ok(())
    }

    async fn clear_database_reservation_failures(
        &self,
        _: &MacroUserIdStr<'static>,
        import_id: Uuid,
    ) -> crate::domain::ports::Result<()> {
        self.written.lock().unwrap().retain(|fact| {
            fact.import_id != import_id || fact.kind != WrittenKind::DatabaseReservationFailure
        });
        Ok(())
    }

    async fn replace_dependency_inclusions(
        &self,
        _: &MacroUserIdStr<'static>,
        _: Uuid,
        _: &[Uuid],
        _: &[Uuid],
    ) -> crate::domain::ports::Result<()> {
        Err(crate::domain::ports::ImportError::NotReady(
            "Review approval is outside this schema-writer fixture.",
        ))
    }

    async fn database_mapping(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &NotionId,
        _: Uuid,
        _: Option<&NotionId>,
    ) -> crate::domain::ports::Result<Option<crate::domain::ports::RecordedDatabaseMapping>> {
        Ok(None)
    }

    async fn record_warnings(
        &self,
        _: &MacroUserIdStr<'static>,
        _: Uuid,
        warnings: &[crate::domain::models::FidelityWarning],
    ) -> crate::domain::ports::Result<()> {
        self.warning_updates
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        self.typed_warnings
            .lock()
            .unwrap()
            .extend_from_slice(warnings);
        let mut stored = self.warnings.lock().unwrap();
        for warning in warnings {
            let warning = warning.render();
            if !stored.contains(&warning) {
                stored.push(warning);
            }
        }
        Ok(())
    }

    async fn record_task_notice(
        &self,
        _: &MacroUserIdStr<'static>,
        import_id: Uuid,
        task_id: Uuid,
        reason: crate::domain::ports::TaskImportNoticeReason,
    ) -> crate::domain::ports::Result<()> {
        self.notices
            .lock()
            .unwrap()
            .insert((import_id, task_id), reason);
        Ok(())
    }
    async fn task_notice_counts(
        &self,
        _: &MacroUserIdStr<'static>,
        import_ids: &[Uuid],
    ) -> crate::domain::ports::Result<Vec<crate::domain::ports::TaskImportNoticeCount>> {
        Ok(self
            .notices
            .lock()
            .unwrap()
            .iter()
            .filter(|((import_id, _), _)| import_ids.contains(import_id))
            .map(
                |((import_id, _), reason)| crate::domain::ports::TaskImportNoticeCount {
                    import_id: *import_id,
                    reason: *reason,
                    count: 1,
                },
            )
            .collect())
    }
    async fn clear_task_notices(
        &self,
        _: &MacroUserIdStr<'static>,
        import_id: Uuid,
    ) -> crate::domain::ports::Result<()> {
        self.notices
            .lock()
            .unwrap()
            .retain(|(source, _), _| *source != import_id);
        Ok(())
    }
    async fn written(
        &self,
        _user: &MacroUserIdStr<'static>,
        import_ids: &[Uuid],
    ) -> crate::domain::ports::Result<Vec<WrittenObject>> {
        Ok(self
            .written
            .lock()
            .unwrap()
            .iter()
            .filter(|object| import_ids.contains(&object.import_id))
            .cloned()
            .collect())
    }

    async fn record_written(
        &self,
        _user: &MacroUserIdStr<'static>,
        objects: &[WrittenObject],
    ) -> crate::domain::ports::Result<Vec<WrittenObject>> {
        let mut stored = self.written.lock().unwrap();
        Ok(objects
            .iter()
            .map(|object| {
                let existing = stored.iter().find(|known| {
                    known.import_id == object.import_id
                        && known.kind == object.kind
                        && known.object == object.object
                });
                match existing {
                    Some(known) => known.clone(),
                    None => {
                        stored.push(object.clone());
                        object.clone()
                    }
                }
            })
            .collect())
    }
}
