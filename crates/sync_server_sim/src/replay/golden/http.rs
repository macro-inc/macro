//! Trusted fixture HTTP decoding. JWT verification remains a Worker boundary;
//! native replay normalizes the already verified claims and calls real Room policy.
use super::*;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use macro_sync_service_jwt::session::SessionKind;
use sync_server_core::domain::{
    permissions::{AccessLevel, AuthToken},
    room::*,
};

fn grant(req: &RoomRequest) -> Result<AuthToken, ReplayError> {
    let token = req
        .query
        .strip_prefix("?token=")
        .or_else(|| {
            req.headers
                .get("authorization")
                .and_then(Value::as_str)?
                .strip_prefix("Bearer ")
        })
        .ok_or_else(|| invalid("missing fixture grant"))?;
    let payload = token
        .split('.')
        .nth(1)
        .ok_or_else(|| invalid("invalid JWT"))?;
    let claims: Value = serde_json::from_slice(
        &URL_SAFE_NO_PAD
            .decode(payload)
            .map_err(|e| invalid(e.to_string()))?,
    )
    .map_err(|e| invalid(e.to_string()))?;
    let surface = claims["session_kind"] == "surface";
    Ok(AuthToken::new(
        claims[if surface { "surface_id" } else { "document_id" }]
            .as_str()
            .ok_or_else(|| invalid("missing grant identity"))?
            .into(),
        serde_json::from_value::<AccessLevel>(claims["access_level"].clone())
            .map_err(|e| invalid(e.to_string()))?,
        if surface {
            SessionKind::Surface
        } else {
            SessionKind::Document
        },
        claims["user_id"].as_str().map(str::to_owned),
        claims["actor"].as_str().map(str::to_owned),
        claims["agent_correlation_id"]
            .as_str()
            .map(str::parse)
            .transpose()
            .map_err(|e| invalid(format!("{e}")))?,
        if surface {
            claims["exp"].as_u64().map(|n| n as usize)
        } else {
            None
        },
    ))
}
#[derive(serde::Serialize)]
struct UpdateResponse {
    revision: String,
    applied: bool,
}
fn surface_status(status: SurfaceStatus) -> u16 {
    match status {
        SurfaceStatus::Ok => 200,
        SurfaceStatus::Conflict => 409,
        SurfaceStatus::Forbidden => 403,
    }
}
fn migration(outcome: MigrationOutcome) -> Result<(u16, Vec<u8>, bool), ReplayError> {
    let json = match outcome {
        MigrationOutcome::BadRequest => return Ok((400, vec![], false)),
        MigrationOutcome::Conflict => return Ok((409, vec![], false)),
        MigrationOutcome::NotFound => return Ok((404, vec![], false)),
        MigrationOutcome::Proof(proof) => serde_json::to_vec(&proof),
        MigrationOutcome::Export(export) => serde_json::to_vec(&export),
    }
    .map_err(|e| invalid(e.to_string()))?;
    Ok((200, json, true))
}
pub(super) fn replay(
    room: &mut Room<SimPorts>,
    req: &RoomRequest,
    key: &str,
    records: &[&Value],
    receipts: &mut receipts::Receipts,
) -> Result<(), ReplayError> {
    use bebop::Record;
    let req = &receipts.input(req)?;
    let key = SessionKey::new(key.to_owned());
    let surface = req.path.starts_with("/surface/");
    let source = req.path.contains("/migration/");
    let operation = req.path.rsplit('/').next().unwrap_or("");
    let response = records
        .iter()
        .find(|r| r["out"] == "response")
        .ok_or_else(|| invalid("missing HTTP response"))?;
    let future = async {
        let route = if surface {
            RouteClass::Surface
        } else if source {
            RouteClass::Migration
        } else {
            RouteClass::Document
        };
        if room.gate_request(route).await? != RequestGate::Allowed {
            return Ok((403, vec![], false));
        }
        if (source
            || surface
                && matches!(
                    operation,
                    "initialize"
                        | "revoke"
                        | "initialize_verified"
                        | "import"
                        | "verify"
                        | "activate"
                ))
            && req
                .headers
                .get("x-internal-auth-key")
                .and_then(Value::as_str)
                != Some("local")
        {
            return Ok((401, vec![], false));
        }
        if source && req.method != "POST" {
            return Ok((405, vec![], false));
        }
        if surface
            && matches!(
                operation,
                "connect" | "snapshot" | "exists" | "active_peers" | "peer"
            )
            && grant(req)?.session_kind != SessionKind::Surface
        {
            return Ok((401, vec![], false));
        }
        if surface {
            let action = match operation {
                "revoke" => SurfaceRequest::Revoke,
                "initialize" => SurfaceRequest::Initialize,
                "import" | "verify" | "activate" | "initialize_verified" => {
                    SurfaceRequest::Migration
                }
                _ => SurfaceRequest::Read,
            };
            if let SurfacePreparation::Return(status) = room.prepare_surface(&key, action).await? {
                return Ok((surface_status(status), vec![], false));
            }
            match operation {
                "initialize" => {
                    let body = sync_protocol::InitializeFromSnapshotRequest::deserialize(&req.body)
                        .map_err(|e| invalid(e.to_string()))?;
                    return Ok((
                        surface_status(
                            room.initialize_surface(&key, &body.snapshot, FaultPlan::None)
                                .await?,
                        ),
                        vec![],
                        false,
                    ));
                }
                "import" | "verify" | "activate" | "initialize_verified" => {
                    return migration(
                        room.target_migration(&req.body, FaultPlan::None, key.as_str(), operation)
                            .await?,
                    );
                }
                "snapshot" => return Ok((200, room.surface_snapshot().await?, false)),
                "exists" => return Ok((200, vec![], false)),
                _ => {}
            }
        }
        if source {
            return migration(
                room.source_migration(&req.body, FaultPlan::None, key.as_str(), operation)
                    .await?,
            );
        }
        match (req.method.as_str(), operation) {
            ("GET", "connect") => {
                let grant = grant(req)?;
                if !surface
                    && grant
                        .require_document_permission(key.as_str(), &AccessLevel::View)
                        .is_err()
                {
                    return Ok((401, vec![], false));
                }
                room.connect(grant, key.clone()).await?;
                Ok((101, vec![], false))
            }
            ("POST", "initialize") => Ok(match room.initialize(key.clone(), &req.body).await? {
                InitializeOutcome::Initialized => (200, vec![], false),
                InitializeOutcome::AlreadyInitialized => {
                    (409, b"snapshot already exists".to_vec(), false)
                }
            }),
            ("GET" | "POST", "snapshot") => {
                if grant(req)?
                    .require_document_permission(key.as_str(), &AccessLevel::View)
                    .is_err()
                {
                    return Ok((401, vec![], false));
                }
                let body = if req.body.is_empty() {
                    None
                } else {
                    Some(serde_json::from_slice(&req.body).map_err(|e| invalid(e.to_string()))?)
                };
                Ok(match room.snapshot(&key, body).await? {
                    SnapshotOutcome::NotFound => (404, vec![], false),
                    SnapshotOutcome::BadRequest => (400, vec![], false),
                    SnapshotOutcome::Snapshot(bytes) => (200, bytes, false),
                })
            }
            ("GET", "state") => {
                let access = grant(req)?
                    .document_access(key.as_str())
                    .map_err(|e| invalid(e.to_string()))?;
                Ok(match room.read_document(&key,&access,req.query=="?shallow=true").await? {
                    Some((snapshot,revision))=>(200,serde_json::to_vec(&json!({"snapshot":STANDARD.encode(snapshot),"revision":STANDARD.encode(revision)})).unwrap(),true),
                    None=>(404,vec![],false),
                })
            }
            ("POST", "update") => {
                let claims = grant(req)?;
                let access = claims
                    .document_access(key.as_str())
                    .map_err(|e| invalid(e.to_string()))?;
                if !room.prepare_document_update(&key, &access).await? {
                    return Ok((404, vec![], false));
                }
                let body: Value =
                    serde_json::from_slice(&req.body).map_err(|e| invalid(e.to_string()))?;
                let prepared = room
                    .update_document(
                        &key,
                        &access,
                        claims,
                        &decode(&body["expectedRevision"])?,
                        &decode(&body["update"])?,
                    )
                    .await?;
                Ok((
                    200,
                    serde_json::to_vec(&UpdateResponse {
                        revision: STANDARD.encode(prepared.revision),
                        applied: prepared.applied,
                    })
                    .unwrap(),
                    true,
                ))
            }
            ("GET", "raw" | "exists") => {
                let value = if operation == "exists" {
                    room.exists(&key).await?.then(String::new)
                } else {
                    room.raw_json(&key).await?
                };
                Ok(match value {
                    Some(body) => (200, body.into_bytes(), false),
                    None => (404, vec![], false),
                })
            }
            ("DELETE", "delete") => {
                room.delete(&key).await?;
                Ok((200, vec![], false))
            }
            _ => Err(ReplayError::Unsupported(format!(
                "HTTP {} {}",
                req.method, req.path
            ))),
        }
    };
    let (status, body, json_body) = future
        .now_or_never()
        .ok_or_else(|| invalid("HTTP port blocked"))??;
    let mut headers = json!({"access-control-allow-credentials":"true","access-control-allow-headers":"authorization,content-type,traceparent,tracestate","access-control-allow-methods":"GET,POST,PUT,PATCH,DELETE,OPTIONS"});
    if json_body {
        headers["content-type"] = json!("application/json");
    }
    let expected = decode(&response["body_b64"])?;
    let same = if status == 200 && response["status"] == 200 && source && operation == "freeze" {
        let a: Value = serde_json::from_slice(&expected).map_err(|e| invalid(e.to_string()))?;
        let b: Value = serde_json::from_slice(&body).map_err(|e| invalid(e.to_string()))?;
        let sa: Vec<u8> =
            serde_json::from_value(a["snapshot"].clone()).map_err(|e| invalid(e.to_string()))?;
        let sb: Vec<u8> =
            serde_json::from_value(b["snapshot"].clone()).map_err(|e| invalid(e.to_string()))?;
        let same = receipts.bind(&a["proof"], &b["proof"], &sa, &sb)?;
        let mut translated = a;
        translated["proof"] = b["proof"].clone();
        translated["snapshot"] = b["snapshot"].clone();
        same && translated == b
    } else if status == 200
        && matches!(
            operation,
            "initialize_verified" | "import" | "verify" | "activate" | "seal" | "thaw" | "retire"
        )
    {
        let a: Value = serde_json::from_slice(&expected).map_err(|e| invalid(e.to_string()))?;
        let b: Value = serde_json::from_slice(&body).map_err(|e| invalid(e.to_string()))?;
        if operation == "initialize_verified" {
            let request: Value =
                serde_json::from_slice(&req.body).map_err(|e| invalid(e.to_string()))?;
            let snapshot: Vec<u8> = serde_json::from_value(request["snapshot"].clone())
                .map_err(|e| invalid(e.to_string()))?;
            receipts.bind(&a, &b, &snapshot, &snapshot)?
        } else {
            receipts.proof(&a) == b
        }
    } else if status == 200 && response["status"] == 200 && operation == "snapshot" {
        equivalent_snapshots(&expected, &body)?
    } else if status == 200 && operation == "state" {
        let mut a: Value = serde_json::from_slice(&expected).map_err(|e| invalid(e.to_string()))?;
        let mut b: Value = serde_json::from_slice(&body).map_err(|e| invalid(e.to_string()))?;
        let same = equivalent_snapshots(&decode(&a["snapshot"])?, &decode(&b["snapshot"])?)?;
        a.as_object_mut().unwrap().remove("snapshot");
        b.as_object_mut().unwrap().remove("snapshot");
        // /state bodies already use S6 §4.3 semantic comparison. Its revision
        // uses the same VV encoding covered by the orchestrator's /update ruling.
        same && equivalent_revisions(&mut a, &mut b)?
    } else if status == 200 && operation == "update" {
        // Orchestrator ruling on S6 §4.3 (2026-11-07): only native /update revision peer
        // ordering is semantic. The workerd re-record still compares exact bytes.
        let mut a: Value = serde_json::from_slice(&expected).map_err(|e| invalid(e.to_string()))?;
        let mut b: Value = serde_json::from_slice(&body).map_err(|e| invalid(e.to_string()))?;
        equivalent_revisions(&mut a, &mut b)?
    } else {
        expected == body
    };
    if response["status"] != status || response["headers"] != headers || !same {
        return Err(ReplayError::Mismatch(format!(
            "HTTP {} {} response differs (native {status}); expected {} actual {} headers {headers}",
            req.method,
            req.path,
            String::from_utf8_lossy(&expected),
            String::from_utf8_lossy(&body)
        )));
    }
    Ok(())
}
impl From<RoomError> for ReplayError {
    fn from(error: RoomError) -> Self {
        ReplayError::Callback(error.to_string())
    }
}

fn equivalent_revisions(a: &mut Value, b: &mut Value) -> Result<bool, ReplayError> {
    let av = loro::VersionVector::decode(&decode(&a["revision"])?)
        .map_err(|e| invalid(e.to_string()))?;
    let bv = loro::VersionVector::decode(&decode(&b["revision"])?)
        .map_err(|e| invalid(e.to_string()))?;
    a.as_object_mut().unwrap().remove("revision");
    b.as_object_mut().unwrap().remove("revision");
    Ok(av == bv && a == b)
}

#[cfg(test)]
mod test {
    use super::*;
    #[test]
    fn native_revisions_compare_maps_and_preserve_other_response_fields() {
        let first = "AofhosTTrsCYjAEC/LvVz8uznvJRAg==";
        let reordered = "Avy71c/Ls57yUQKH4aLE067AmIwBAg==";
        assert!(
            equivalent_revisions(
                &mut json!({"revision":first,"applied":true}),
                &mut json!({"revision":reordered,"applied":true}),
            )
            .unwrap()
        );
        assert!(
            !equivalent_revisions(
                &mut json!({"revision":first,"applied":true}),
                &mut json!({"revision":reordered,"applied":false}),
            )
            .unwrap()
        );
        assert!(!equivalent_revisions(
            &mut json!({"revision":first,"applied":true}),
            &mut json!({"revision":STANDARD.encode(loro::VersionVector::default().encode()),"applied":true}),
        ).unwrap());
    }
}
