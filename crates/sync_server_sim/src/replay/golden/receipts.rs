//! Native-only snapshot correspondence under the orchestrator's S6 §4.3 ruling
//! (2026-11-07). Validate both SHA-256 digests and semantic snapshots before
//! translating an exact receipt reference. Never replace arbitrary digest strings.
use super::*;
use sha2::{Digest, Sha256};

struct Binding {
    recorded: Value,
    native: Value,
    recorded_snapshot: Vec<u8>,
    native_snapshot: Vec<u8>,
}
#[derive(Default)]
pub(super) struct Receipts(Vec<Binding>);
impl Receipts {
    pub(super) fn bind(
        &mut self,
        recorded: &Value,
        native: &Value,
        recorded_snapshot: &[u8],
        native_snapshot: &[u8],
    ) -> Result<bool, ReplayError> {
        for (proof, snapshot) in [(recorded, recorded_snapshot), (native, native_snapshot)] {
            if proof["digest"] != format!("{:x}", Sha256::digest(snapshot)) {
                return Err(ReplayError::Mismatch(
                    "receipt snapshot digest is not self-consistent".into(),
                ));
            }
        }
        let mut a = recorded.clone();
        let mut b = native.clone();
        a.as_object_mut()
            .ok_or_else(|| invalid("invalid recorded proof"))?
            .remove("digest");
        b.as_object_mut()
            .ok_or_else(|| invalid("invalid native proof"))?
            .remove("digest");
        if a != b || !equivalent_snapshots(recorded_snapshot, native_snapshot)? {
            return Ok(false);
        }
        if let Some(existing) = self.0.iter().find(|binding| binding.recorded == *recorded) {
            return Ok(existing.native == *native && existing.native_snapshot == native_snapshot);
        }
        self.0.push(Binding {
            recorded: recorded.clone(),
            native: native.clone(),
            recorded_snapshot: recorded_snapshot.to_vec(),
            native_snapshot: native_snapshot.to_vec(),
        });
        Ok(true)
    }
    pub(super) fn proof(&self, proof: &Value) -> Value {
        self.0
            .iter()
            .find(|binding| binding.recorded == *proof)
            .map(|binding| binding.native.clone())
            .unwrap_or_else(|| proof.clone())
    }
    pub(super) fn stored(&self, key: &str, value: &Value) -> Value {
        let mut result = value.clone();
        if matches!(key, "SURFACE_MIGRATION_SOURCE" | "SURFACE_MIGRATION_TARGET")
            && result.get("proof").is_some()
        {
            // serde-wasm-bindgen persists Option::None as JS undefined; the
            // typed native port represents the same absent source as JSON null.
            if result["proof"].is_object()
                && (result["proof"].get("source_id").is_none()
                    || result["proof"]["source_id"] == json!({"undefined":true}))
            {
                result["proof"]["source_id"] = Value::Null;
            }
            result["proof"] = self.proof(&result["proof"]);
        }
        result
    }
    pub(super) fn input(&self, request: &RoomRequest) -> Result<RoomRequest, ReplayError> {
        let mut request = request.clone();
        let operation = request.path.rsplit('/').next().unwrap_or("");
        if request.method != "POST"
            || !(request.path.contains("/migration/")
                || request.path.starts_with("/surface/")
                    && matches!(operation, "import" | "verify" | "activate"))
        {
            return Ok(request);
        }
        let Ok(mut body) = serde_json::from_slice::<Value>(&request.body) else {
            return Ok(request);
        };
        if body.get("snapshot").is_some() && body.get("proof").is_some() {
            // An altered snapshot with a valid-looking receipt must remain invalid.
            if let Some(binding) = self.0.iter().find(|binding| {
                binding.recorded == body["proof"]
                    && serde_json::to_value(&binding.recorded_snapshot)
                        .ok()
                        .as_ref()
                        == Some(&body["snapshot"])
            }) {
                body["proof"] = binding.native.clone();
                body["snapshot"] = json!(binding.native_snapshot);
            }
        } else {
            body = self.proof(&body);
        }
        request.body = serde_json::to_vec(&body).map_err(|e| invalid(e.to_string()))?;
        Ok(request)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    fn export() -> (Value, Vec<u8>) {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/transcripts/surface_migration.test/freeze_drains_acknowledged_and_racing_edits_closes_writers_and_replays_pending_logs_after_restart.jsonl");
        let transcript = Transcript::load(&path, "receipt").unwrap();
        let export = transcript
            .records
            .iter()
            .filter(|record| record["out"] == "response")
            .find_map(|record| {
                let bytes = decode(&record["body_b64"]).ok()?;
                let value: Value = serde_json::from_slice(&bytes).ok()?;
                value.get("snapshot")?;
                Some(value)
            })
            .unwrap();
        let snapshot = serde_json::from_value(export["snapshot"].clone()).unwrap();
        (export["proof"].clone(), snapshot)
    }
    #[test]
    fn receipt_translation_requires_valid_digests_and_unchanged_references() {
        let (proof, snapshot) = export();
        let state =
            sync_server_core::domain::state::DocumentState::try_from_snapshot(&snapshot).unwrap();
        let native = state.export_snapshot(None).unwrap();
        let mut native_proof = proof.clone();
        native_proof["digest"] = json!(format!("{:x}", Sha256::digest(&native)));
        let mut receipts = Receipts::default();
        assert!(
            receipts
                .bind(&proof, &native_proof, &snapshot, &native)
                .unwrap()
        );
        let request = RoomRequest {
            method: "POST".into(),
            path: "/surface/test/import".into(),
            query: String::new(),
            headers: BTreeMap::new(),
            body: serde_json::to_vec(&json!({"proof":proof,"snapshot":snapshot})).unwrap(),
        };
        let translated: Value =
            serde_json::from_slice(&receipts.input(&request).unwrap().body).unwrap();
        assert_eq!(translated, json!({"proof":native_proof,"snapshot":native}));
        let mut forged = request.clone();
        let mut body: Value = serde_json::from_slice(&forged.body).unwrap();
        body["snapshot"] = json!([0]);
        forged.body = serde_json::to_vec(&body).unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&receipts.input(&forged).unwrap().body).unwrap(),
            body
        );
        body = serde_json::from_slice(&request.body).unwrap();
        body["proof"]["content_digest"] = json!("forged");
        forged.body = serde_json::to_vec(&body).unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&receipts.input(&forged).unwrap().body).unwrap(),
            body
        );
        let mut corrupt = native_proof.clone();
        corrupt["digest"] = json!("forged");
        assert!(
            Receipts::default()
                .bind(&proof, &corrupt, &snapshot, &native)
                .is_err()
        );
        corrupt = native_proof.clone();
        corrupt["content_digest"] = json!("forged");
        assert!(
            !Receipts::default()
                .bind(&proof, &corrupt, &snapshot, &native)
                .unwrap()
        );
        let different = loro::LoroDoc::new()
            .export(loro::ExportMode::Snapshot)
            .unwrap();
        corrupt = native_proof.clone();
        corrupt["digest"] = json!(format!("{:x}", Sha256::digest(&different)));
        assert!(
            !Receipts::default()
                .bind(&proof, &corrupt, &snapshot, &different)
                .unwrap()
        );
        assert_eq!(
            receipts.stored("unrelated", &json!({"proof":proof})),
            json!({"proof":proof})
        );
    }
}
