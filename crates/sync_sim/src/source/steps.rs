//! Each variant names its own Rust type; nested enums never depend on wildcard imports.
use crate::*;
fn client(name: &ClientName) -> String {
    format!("ClientName({:?}.into())", name.0)
}
fn profile(name: &ProfileName) -> String {
    format!("ProfileName({:?}.into())", name.0)
}
pub(super) fn source(step: &Step) -> String {
    match step {
        Step::Open(spec) => format!(
            "Step::Open(OpenSpec {{ client: {}, profile: {}, doc: DocIx({}), access: Access::{:?}, kind: ClientKind::{:?} }})",
            client(&spec.client),
            profile(&spec.profile),
            spec.doc.0,
            spec.access,
            spec.kind
        ),
        Step::Edit {
            client: name,
            op: AbstractOp::Editor(op),
        } => {
            let operation = match op {
                EditorOp::Type { at, text } => format!(
                    "EditorOp::Type {{ at: Pos {{ block: {}, offset: {} }}, text: {:?}.into() }}",
                    at.block, at.offset, text
                ),
                EditorOp::Select { from, to } => format!(
                    "EditorOp::Select {{ from: Pos {{ block: {}, offset: {} }}, to: Pos {{ block: {}, offset: {} }} }}",
                    from.block, from.offset, to.block, to.offset
                ),
                EditorOp::Backspace { .. }
                | EditorOp::DeleteRange { .. }
                | EditorOp::SplitBlock { .. }
                | EditorOp::Format { .. }
                | EditorOp::Indent { .. }
                | EditorOp::Outdent { .. } => format!("EditorOp::{op:?}"),
                EditorOp::Undo => "EditorOp::Undo".into(),
                EditorOp::Redo => "EditorOp::Redo".into(),
            };
            format!(
                "Step::Edit {{ client: {}, op: AbstractOp::Editor({operation}) }}",
                client(name)
            )
        }
        Step::Edit { client: name, op } => format!(
            "Step::Edit {{ client: {}, op: AbstractOp::{op:?} }}",
            client(name)
        ),
        Step::Run(ms) => format!("Step::Run(Millis({}))", ms.0),
        Step::Settle => "Step::Settle".into(),
        Step::Net(net) => format!("Step::Net({})", net_source(net)),
        Step::Crash { client: name } => format!("Step::Crash {{ client: {} }}", client(name)),
        Step::CrashProfile {
            profile: name,
            mode,
        } => format!(
            "Step::CrashProfile {{ profile: {}, mode: CrashMode::{mode:?} }}",
            profile(name)
        ),
        Step::Close { client: name } => format!("Step::Close {{ client: {} }}", client(name)),
        Step::Reopen { client: name } => format!("Step::Reopen {{ client: {} }}", client(name)),
        Step::ReopenCrashed => "Step::ReopenCrashed".into(),
        Step::Host {
            client: name,
            signal,
        } => format!(
            "Step::Host {{ client: {}, signal: doc_sync_core::HostSignal::{signal:?} }}",
            client(name)
        ),
        Step::Offline {
            client: name,
            offline,
        } => format!(
            "Step::Offline {{ client: {}, offline: {offline} }}",
            client(name)
        ),
        Step::Freeze { client: name } => format!("Step::Freeze {{ client: {} }}", client(name)),
        Step::Thaw { client: name } => format!("Step::Thaw {{ client: {} }}", client(name)),
        Step::Flush { client: name } => format!("Step::Flush {{ client: {} }}", client(name)),
        Step::EditorError { client: name } => {
            format!("Step::EditorError {{ client: {} }}", client(name))
        }
        Step::Storage {
            profile: name,
            fault,
        } => format!(
            "Step::Storage {{ profile: {}, fault: StorageFault::{fault:?} }}",
            profile(name)
        ),
        Step::Server(server) => format!("Step::Server(ServerStep::{server:?})"),
        Step::Grant {
            client: name,
            access,
            force_reconnect,
        } => format!(
            "Step::Grant {{ client: {}, access: Access::{access:?}, force_reconnect: {force_reconnect} }}",
            client(name)
        ),
        Step::TokenExpire { client: name } => {
            format!("Step::TokenExpire {{ client: {} }}", client(name))
        }
        Step::TokenFetchFail { client: name, n } => format!(
            "Step::TokenFetchFail {{ client: {}, n: {n} }}",
            client(name)
        ),
        Step::ClockSkew {
            client: name,
            wall_offset_ms,
        } => format!(
            "Step::ClockSkew {{ client: {}, wall_offset_ms: {wall_offset_ms} }}",
            client(name)
        ),
        Step::AssertProfileDrained { profile: name } => format!(
            "Step::AssertProfileDrained {{ profile: {} }}",
            profile(name)
        ),
        Step::SignIn {
            profile: name,
            user,
        } => format!(
            "Step::SignIn {{ profile: {}, user: {user:?}.into() }}",
            profile(name)
        ),
        Step::AdvanceWall(ms) => format!("Step::AdvanceWall(Millis({}))", ms.0),
    }
}
fn net_source(step: &NetStep) -> String {
    match step {
        NetStep::Partition(name) => format!("NetStep::Partition({})", client(name)),
        NetStep::Heal(name) => format!("NetStep::Heal({})", client(name)),
        NetStep::Break(name) => format!("NetStep::Break({})", client(name)),
        NetStep::LoseAcks {
            client: name,
            count,
        } => format!(
            "NetStep::LoseAcks {{ client: {}, count: {count} }}",
            client(name)
        ),
        NetStep::DropNext {
            client: name,
            direction,
            kind,
            frames,
        } => format!(
            "NetStep::DropNext {{ client: {}, direction: Direction::{direction:?}, kind: {}, frames: {frames} }}",
            client(name),
            kind.map(|kind| format!("Some(FrameKind::{kind:?})"))
                .unwrap_or("None".into())
        ),
        NetStep::CorruptNext {
            client: name,
            direction,
        } => format!(
            "NetStep::CorruptNext {{ client: {}, direction: Direction::{direction:?} }}",
            client(name)
        ),
        NetStep::Profile(profile) => format!("NetStep::Profile({profile:?})"),
    }
}
