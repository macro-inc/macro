use super::*;

impl SyncCore {
    pub(super) fn replay_assistance(
        &mut self,
        now: Now,
        doc: &mut impl SyncDoc,
        out: &mut SyncOutput,
    ) {
        if self.phase != Phase::Running || self.rebase_due.is_some() {
            return;
        }
        let confirmed = std::mem::take(&mut self.assist_replay);
        for bytes in confirmed {
            let covered = |doc: &dyn SyncDoc| {
                loro::LoroDoc::decode_import_blob_meta(&bytes, true)
                    .is_ok_and(|meta| doc.oplog_vv().includes_vv(&meta.partial_end_vv))
            };
            if covered(doc) {
                continue;
            }
            if self.phase == Phase::Running && self.rebase_due.is_none() {
                self.import(&bytes, ImportOrigin::WalReplay, now, doc, out);
            }
            if !covered(doc) {
                self.assist_replay.push(bytes);
            }
        }
    }
}
