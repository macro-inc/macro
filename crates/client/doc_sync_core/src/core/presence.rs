use super::*;

impl SyncCore {
    pub(super) fn local_presence_key(&self, peer: u64) -> String {
        match &self.config.presence.key {
            PresenceKeyMode::Peer => peer.to_string(),
            PresenceKeyMode::Fixed(key) => key.clone(),
        }
    }

    pub(super) fn set_presence(&mut self, selection: Option<loro::LoroValue>, now: Now) {
        self.local_presence = selection;
        self.presence_dirty = true;
        let at = now.mono.after(self.config.wal.coalesce);
        self.presence_due = Some(self.presence_due.map(|old| old.min(at)).unwrap_or(at));
    }

    pub(super) fn flush_presence(&mut self, now: Now, doc: &impl SyncDoc, out: &mut SyncOutput) {
        if !self.presence_dirty || self.presence_due.is_none_or(|at| at > now.mono) {
            return;
        }
        let key = self.local_presence_key(doc.peer_id());
        let value = match self.local_presence.clone() {
            None => loro::LoroValue::Null,
            Some(selection) => {
                let user = loro::LoroValue::Map(
                    vec![
                        (
                            "userId".into(),
                            self.config
                                .presence
                                .user
                                .user_id
                                .as_ref()
                                .map(|id| loro::LoroValue::from(id.to_string()))
                                .unwrap_or(loro::LoroValue::Null),
                        ),
                        (
                            "color".into(),
                            loro::LoroValue::from(self.config.presence.user.color.to_string()),
                        ),
                        (
                            "peerId".into(),
                            loro::LoroValue::from(doc.peer_id().to_string()),
                        ),
                    ]
                    .into(),
                );
                loro::LoroValue::Map(
                    vec![("user".into(), user), ("selection".into(), selection)].into(),
                )
            }
        };
        let Some(store) = &mut self.presence else {
            return;
        };
        let result =
            store
                .set(&key, value, now.wall)
                .and_then(|_| match self.config.presence.key {
                    PresenceKeyMode::Fixed(_) => store.encode_all(now.wall),
                    PresenceKeyMode::Peer => store.encode(&key, now.wall),
                });
        match result {
            Ok(bytes) => {
                self.send_presence(bytes, out);
                self.presence_dirty = false;
                self.presence_due = None;
                self.presence_key = Some(key);
                self.presence_refresh = self.config.presence.refresh.map(|i| now.mono.after(i));
            }
            Err(_) => {
                self.presence_due = Some(now.mono.after(self.config.wal.coalesce));
                self.event("doc.presence.error", Vec::new(), out);
            }
        }
    }

    fn send_presence(&mut self, bytes: Vec<u8>, out: &mut SyncOutput) {
        if self.connection.opened() {
            self.send(
                sync_protocol::FromPeer::PeerAwareness {
                    awareness: SliceWrapper::from_cooked(&bytes),
                },
                out,
            );
        }
        if self.config.chatter {
            out.io
                .push(IoEffect::ChatterPost(ChatterMessage::Awareness(bytes)));
        }
    }

    pub(super) fn apply_presence(&mut self, bytes: &[u8], now: Now, out: &mut SyncOutput) {
        if bytes.is_empty() {
            return;
        }
        let Some(store) = &mut self.presence else {
            return;
        };
        if store.apply(bytes, now.wall).is_err() {
            self.event("doc.presence.error", Vec::new(), out);
            return;
        }
        out.events.push(SyncEvent::Presence(
            store.peers(self.presence_key.as_deref().unwrap_or("")),
        ));
    }

    pub(super) fn expire_presence(&mut self, now: Now, out: &mut SyncOutput) {
        let Some(store) = &mut self.presence else {
            return;
        };
        if store.remove_outdated(now.wall) {
            out.events.push(SyncEvent::Presence(
                store.peers(self.presence_key.as_deref().unwrap_or("")),
            ));
        }
    }

    pub(super) fn clear_presence(&mut self, now: Now, out: &mut SyncOutput) {
        let Some(key) = self.presence_key.clone() else {
            return;
        };
        let Some(store) = &mut self.presence else {
            return;
        };
        let encoded = store
            .set(&key, loro::LoroValue::Null, now.wall)
            .and_then(|_| store.encode(&key, now.wall));
        if let Ok(bytes) = encoded {
            self.send_presence(bytes, out);
        }
    }
}
