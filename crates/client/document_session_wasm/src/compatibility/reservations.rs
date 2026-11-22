//! Native key tickets reserve the actual editor allocator, without creating nodes.
use super::*;
use lexical_model::{ForeignReservedKey, NodeKey};
const MAX_RESERVATION: u32 = 65_536;
impl Host {
    fn prepare_keys(&self, count: u32) -> Result<Vec<ForeignReservedKey>, BoundaryError> {
        if count > MAX_RESERVATION {
            return Err(BoundaryError::Invalid(
                "compatibility key reservation limit",
            ));
        }
        self.next_reservation
            .checked_add(1)
            .ok_or(BoundaryError::Invalid("reservation identity exhausted"))?;
        let mut keys = Vec::new();
        keys.try_reserve_exact(count as usize)
            .map_err(|_| BoundaryError::Invalid("compatibility key reservation capacity"))?;
        for _ in 0..count {
            keys.push(self.keys.reserve_for_foreign_host()?);
        }
        Ok(keys)
    }
    fn issue_keys(
        &mut self,
        keys: Vec<ForeignReservedKey>,
    ) -> Result<compat::CompatKeyReservation, BoundaryError> {
        let id = self.next_reservation;
        self.next_reservation = id
            .checked_add(1)
            .ok_or(BoundaryError::Invalid("reservation identity exhausted"))?;
        let wire_keys = keys
            .iter()
            .map(|ticket| records::key(ticket.key()))
            .collect();
        self.reservations.insert(
            id,
            (
                self.update,
                keys.into_iter()
                    .map(|ticket| (ticket.key(), ticket))
                    .collect(),
            ),
        );
        Ok(compat::CompatKeyReservation {
            editor_id: self.editor,
            reservation_id: id,
            keys: wire_keys,
        })
    }
    pub(super) fn discard_reservations(&mut self) {
        let removed = self
            .capture_leases
            .release_owner(capture_leases::NativeOwner::Update(self.update));
        self.remove_captures(removed);
        self.constructed
            .retain(|_, record| record.update_id != self.update);
        self.reservations
            .retain(|_, (update, _)| *update != self.update);
    }
}
impl EditorSession {
    pub(super) fn compat_begin_compact_inner(
        &mut self,
        request: &[u8],
    ) -> Result<compat::CompatBeginReply, BoundaryError> {
        let request = compat::CompatBeginRequest::deserialize(request)?;
        let host = self
            .compatibility
            .as_mut()
            .ok_or(BoundaryError::Invalid("compatibility session required"))?;
        if host.pending.is_some() {
            return Err(BoundaryError::Invalid(
                "compatibility update already active",
            ));
        }
        let masks = host
            .class_masks
            .prepare(&request.class_mask_patches, false)?;
        let epoch = host
            .mutation_epoch
            .checked_add(1)
            .ok_or(BoundaryError::Invalid("mutation epoch exhausted"))?;
        host.ensure_publications_drained()?;
        let keys = host.prepare_keys(request.reserve_keys)?;
        masks.apply();
        self.compat_begin_inner(&bytes(&compat::CompatBegin { tags: request.tags })?)?;
        let (host, machine) = self.compat_parts()?;
        host.mutation_epoch = epoch;
        let machine::Session::Editor(session) = &mut machine.session else {
            return Err(BoundaryError::Invalid("compatibility editor surface"));
        };
        let pending = host
            .pending
            .take()
            .ok_or(BoundaryError::Invalid("compatibility update required"))?;
        let (pending, composition) =
            session.with_compat_update(pending, |tx| tx.composition_key())?;
        host.pending = Some(pending);
        Ok(compat::CompatBeginReply {
            version: host
                .pending_version
                .ok_or(BoundaryError::Invalid("pending publication version"))?,
            update_id: host.update,
            mutation_epoch: host.mutation_epoch,
            composition: compat::ForeignOptionalKey {
                present: composition.is_some(),
                key: records::key(composition.unwrap_or(NodeKey::ROOT)),
            },
            reservation: host.issue_keys(keys)?,
        })
    }
    pub(super) fn compat_reserve_keys_inner(
        &mut self,
        count: u32,
    ) -> Result<compat::CompatKeyReservation, BoundaryError> {
        let (host, _) = self.compat_parts()?;
        if host.pending.is_none() {
            return Err(BoundaryError::Invalid("compatibility update required"));
        }
        let keys = host.prepare_keys(count)?;
        host.issue_keys(keys)
    }
}
#[wasm_bindgen]
impl EditorSession {
    /// Begin a compact update with native key tickets and current composition state.
    #[wasm_bindgen(js_name=compatBeginCompact)]
    pub fn compat_begin_compact(&mut self, request: &[u8]) -> Result<Vec<u8>, JsError> {
        self.compat_begin_compact_inner(request)
            .and_then(|reply| bytes(&reply))
            .map_err(js)
    }
    /// Refill an exhausted native key ticket block in the same update.
    #[wasm_bindgen(js_name=compatReserveKeys)]
    pub fn compat_reserve_keys(&mut self, count: u32) -> Result<Vec<u8>, JsError> {
        self.compat_reserve_keys_inner(count)
            .and_then(|reply| bytes(&reply))
            .map_err(js)
    }
}
