use super::*;

/// What earlier attempts recorded, kept the way the ledger keeps it: the
/// first record of an object wins.
#[derive(Default)]
pub(super) struct FakeStore {
    pub(super) warnings: Mutex<Vec<String>>,
    pub(super) warning_updates: std::sync::atomic::AtomicUsize,
    pub(super) written: Mutex<Vec<WrittenObject>>,
    pub(super) notices: Mutex<HashMap<(Uuid, Uuid), crate::domain::ports::TaskImportNoticeReason>>,
}

impl WrittenObjects for FakeStore {
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
