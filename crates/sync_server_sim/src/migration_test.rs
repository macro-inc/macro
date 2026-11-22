use crate::{ports::SimPorts, replay::SimRoom};
use bebop::{Record, SliceWrapper};
use futures::executor::block_on;
use sync_protocol::InitializeFromSnapshotRequest;
use sync_server_core::domain::{
    ports::{RoomStorage, SnapshotStore},
    room::{
        FaultPlan, FaultPoint, MigrationOutcome, RequestGate, RouteClass, SurfacePreparation,
        SurfaceRequest,
    },
    state::DocumentState,
    types::SessionKey,
};

fn snapshot() -> Vec<u8> {
    let doc = loro::LoroDoc::new();
    doc.set_peer_id(7).unwrap();
    doc.get_text("content").push_str("source").unwrap();
    doc.commit();
    doc.export(loro::ExportMode::Snapshot).unwrap()
}
async fn source(ports: SimPorts, id: &str) -> SimRoom {
    let mut room = SimRoom::new(ports);
    let mut wire = Vec::new();
    let snapshot = snapshot();
    InitializeFromSnapshotRequest {
        snapshot: SliceWrapper::Raw(&snapshot),
    }
    .serialize(&mut wire)
    .unwrap();
    room.room_mut()
        .initialize(SessionKey::new(id.into()), &wire)
        .await
        .unwrap();
    room
}

#[test]
fn native_source_migration_recovers_each_persistence_boundary_without_compacting_live_storage() {
    block_on(async {
        let id = uuid_types::Uuid::from_u128(7).to_string();
        let operation = uuid_types::Uuid::from_u128(8);
        let freeze = serde_json::to_vec(&serde_json::json!({"operation_id":operation})).unwrap();
        for point in [
            FaultPoint::SourceClaim,
            FaultPoint::SourceExport,
            FaultPoint::SourceFrozen,
        ] {
            let ports = SimPorts::new();
            let mut room = source(ports.clone(), &id).await;
            let original = ports.get(&SessionKey::new(id.clone())).await.unwrap();
            assert!(
                room.room_mut()
                    .source_migration(&freeze, FaultPlan::StopAfter(point), &id, "freeze")
                    .await
                    .is_err()
            );
            let mut cold = SimRoom::new(ports.clone());
            let MigrationOutcome::Export(export) = cold
                .room_mut()
                .source_migration(&freeze, FaultPlan::None, &id, "freeze")
                .await
                .unwrap()
            else {
                panic!("freeze retry")
            };
            assert_eq!(
                ports.get(&SessionKey::new(id.clone())).await.unwrap(),
                original
            );
            assert_eq!(
                DocumentState::try_from_snapshot(&export.snapshot)
                    .unwrap()
                    .loro_doc
                    .get_text("content")
                    .to_string(),
                "source"
            );
            assert_eq!(
                cold.room_mut()
                    .gate_request(RouteClass::Document)
                    .await
                    .unwrap(),
                RequestGate::SourceBlocked
            );
            let proof = serde_json::to_vec(&export.proof).unwrap();
            assert!(
                cold.room_mut()
                    .source_migration(
                        &proof,
                        FaultPlan::StopAfter(FaultPoint::SourceThawed),
                        &id,
                        "thaw"
                    )
                    .await
                    .is_err()
            );
            let mut cold = SimRoom::new(ports.clone());
            assert!(matches!(
                cold.room_mut()
                    .source_migration(&proof, FaultPlan::None, &id, "thaw")
                    .await
                    .unwrap(),
                MigrationOutcome::Proof(_)
            ));
            assert_eq!(
                cold.room_mut()
                    .gate_request(RouteClass::Document)
                    .await
                    .unwrap(),
                RequestGate::Allowed
            );
        }
        for (operation_name, point) in [
            ("seal", FaultPoint::SourceSealed),
            ("retire", FaultPoint::SourceRetired),
        ] {
            let ports = SimPorts::new();
            let mut room = source(ports.clone(), &id).await;
            let MigrationOutcome::Export(export) = room
                .room_mut()
                .source_migration(&freeze, FaultPlan::None, &id, "freeze")
                .await
                .unwrap()
            else {
                panic!("freeze")
            };
            let proof = serde_json::to_vec(&export.proof).unwrap();
            if operation_name == "retire" {
                room.room_mut()
                    .source_migration(&proof, FaultPlan::None, &id, "seal")
                    .await
                    .unwrap();
            }
            assert!(
                room.room_mut()
                    .source_migration(&proof, FaultPlan::StopAfter(point), &id, operation_name)
                    .await
                    .is_err()
            );
            let mut cold = SimRoom::new(ports);
            assert!(matches!(
                cold.room_mut()
                    .source_migration(&proof, FaultPlan::None, &id, operation_name)
                    .await
                    .unwrap(),
                MigrationOutcome::Proof(_)
            ));
            assert_eq!(
                cold.room_mut()
                    .gate_request(RouteClass::Document)
                    .await
                    .unwrap(),
                RequestGate::SourceBlocked
            );
            assert!(matches!(
                cold.room_mut()
                    .source_migration(&proof, FaultPlan::None, &id, "thaw")
                    .await
                    .unwrap(),
                MigrationOutcome::Conflict
            ));
        }
    });
}

#[test]
fn native_target_migration_recovers_claim_snapshot_verification_activation_and_readiness() {
    block_on(async {
        for point in [
            FaultPoint::TargetClaim,
            FaultPoint::TargetSnapshot,
            FaultPoint::TargetVerified,
            FaultPoint::TargetActive,
            FaultPoint::TargetReady,
        ] {
            let ports = SimPorts::new();
            let mut room = SimRoom::new(ports.clone());
            let key = SessionKey::new(format!("surface:{}", uuid_types::Uuid::from_u128(7)));
            let body = serde_json::to_vec(&serde_json::json!({"operation_id":uuid_types::Uuid::from_u128(8),"snapshot":snapshot()})).unwrap();
            assert_eq!(
                room.room_mut()
                    .prepare_surface(&key, SurfaceRequest::Migration)
                    .await
                    .unwrap(),
                SurfacePreparation::Proceed
            );
            assert!(
                room.room_mut()
                    .target_migration(
                        &body,
                        FaultPlan::StopAfter(point),
                        key.as_str(),
                        "initialize_verified"
                    )
                    .await
                    .is_err()
            );
            let mut cold = SimRoom::new(ports.clone());
            assert_eq!(
                cold.room_mut()
                    .prepare_surface(&key, SurfaceRequest::Migration)
                    .await
                    .unwrap(),
                SurfacePreparation::Proceed
            );
            let MigrationOutcome::Proof(proof) = cold
                .room_mut()
                .target_migration(&body, FaultPlan::None, key.as_str(), "initialize_verified")
                .await
                .unwrap()
            else {
                panic!("target retry")
            };
            assert_eq!(
                ports.surface_lifecycle().await.unwrap(),
                Some(sync_server_core::domain::connection::SurfaceLifecycle::Ready)
            );
            let proof_bytes = serde_json::to_vec(&proof).unwrap();
            assert!(matches!(
                cold.room_mut()
                    .target_migration(&proof_bytes, FaultPlan::None, key.as_str(), "verify")
                    .await
                    .unwrap(),
                MigrationOutcome::Proof(_)
            ));
            assert!(matches!(
                cold.room_mut()
                    .target_migration(&proof_bytes, FaultPlan::None, key.as_str(), "activate")
                    .await
                    .unwrap(),
                MigrationOutcome::Proof(_)
            ));
            assert_eq!(
                DocumentState::try_from_snapshot(
                    &cold.room_mut().surface_snapshot().await.unwrap()
                )
                .unwrap()
                .loro_doc
                .get_text("content")
                .to_string(),
                "source"
            );
            let wrong = serde_json::to_vec(&serde_json::json!({"operation_id":uuid_types::Uuid::from_u128(99),"snapshot":snapshot()})).unwrap();
            assert!(matches!(
                cold.room_mut()
                    .target_migration(&wrong, FaultPlan::None, key.as_str(), "initialize_verified")
                    .await
                    .unwrap(),
                MigrationOutcome::Conflict
            ));
        }
    });
}
