use super::*;
/// Exact reported callback error positions in one encoded native output.
/// Copy this metadata before consuming that output; resolve the JS cause afterwards.
#[wasm_bindgen]
pub struct ViewCommandFailure {
    pub(super) scope: u64,
    pub(super) invocation: u64,
    pub(super) effect_ordinals: Vec<u32>,
    pub(super) current: Arc<std::sync::atomic::AtomicBool>,
}
#[wasm_bindgen]
impl ViewCommandFailure {
    /// Issued scope whose invocation-owned JS slot retains the original cause.
    #[wasm_bindgen(getter)]
    pub fn scope(&self) -> u64 {
        self.scope
    }
    /// Actual outer native invocation associated with this output.
    #[wasm_bindgen(getter)]
    pub fn invocation(&self) -> u64 {
        self.invocation
    }
    /// Whether these ordinals still belong to the current native output.
    /// A subsequent real input invalidates them; pure metadata reads do not.
    #[wasm_bindgen(getter)]
    pub fn current(&self) -> bool {
        self.current.load(Ordering::Relaxed)
    }
    /// Exact tag-16 view-effect ordinals; unrelated error effects must still run.
    #[wasm_bindgen(js_name=effectOrdinals)]
    pub fn effect_ordinals(&self) -> Vec<u32> {
        self.effect_ordinals.clone()
    }
}

pub(super) struct Report {
    pub(super) cause: CallbackFailure,
    pub(super) view_index: usize,
}

pub(super) fn model_error(effect: &document_session::ViewEffect) -> Option<&Error> {
    use document_session::{SessionError, ViewEffect};
    match effect {
        ViewEffect::Error(SessionError::Model(error)) => Some(error),
        ViewEffect::Error(SessionError::Projection(lexical_loro::ProjectionError::Editor(
            error,
        ))) => Some(error),
        _ => None,
    }
}
pub(super) fn encode(
    reports: &[Report],
    view: &[document_session::ViewEffect],
) -> Result<std::collections::VecDeque<ViewCommandFailure>, &'static str> {
    use document_session::{InitialView, ViewEffect};
    let mut leases: std::collections::VecDeque<ViewCommandFailure> =
        std::collections::VecDeque::new();
    let mut previous = None;
    for report in reports {
        if previous.is_some_and(|index| index >= report.view_index) {
            return Err("view command error positions are not ordered");
        }
        previous = Some(report.view_index);
        let effect = view
            .get(report.view_index)
            .ok_or("view command failure effect missing")?;
        let exact = match model_error(effect) {
            Some(Error::Extension(source)) => {
                source.downcast_ref::<CallbackFailure>() == Some(&report.cause)
            }
            _ => matches!(effect, ViewEffect::Editor(Effect::FollowUpFailed { .. })),
        };
        if !exact {
            return Err("view command failure effect mismatch");
        }
        let mut ordinal = 0usize;
        for effect in &view[..report.view_index] {
            let count = match effect {
                ViewEffect::Diff(_) => 0,
                ViewEffect::Initialize(InitialView::Editor { .. }) => 1,
                ViewEffect::Cursors(peers) => peers
                    .len()
                    .checked_add(1)
                    .ok_or("view command cursor count exhausted")?,
                _ => 1,
            };
            ordinal = ordinal
                .checked_add(count)
                .ok_or("view command effect count exhausted")?;
        }
        let ordinal =
            u32::try_from(ordinal).map_err(|_| "view command effect ordinal exhausted")?;
        let scope = report.cause.scope.raw();
        let invocation = report.cause.invocation.raw();
        if let Some(lease) = leases
            .iter_mut()
            .find(|lease| lease.scope == scope && lease.invocation == invocation)
        {
            lease.effect_ordinals.push(ordinal);
        } else {
            leases.push_back(ViewCommandFailure {
                scope,
                invocation,
                effect_ordinals: vec![ordinal],
                current: Arc::new(std::sync::atomic::AtomicBool::new(true)),
            });
        }
    }
    Ok(leases)
}
pub(super) fn retired(reports: &[Report]) -> std::collections::VecDeque<ViewCommandFailure> {
    let mut leases = std::collections::VecDeque::new();
    for report in reports {
        if !leases
            .iter()
            .any(|lease: &ViewCommandFailure| lease.scope == report.cause.scope.raw())
        {
            leases.push_back(ViewCommandFailure {
                scope: report.cause.scope.raw(),
                invocation: report.cause.invocation.raw(),
                effect_ordinals: vec![],
                current: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            });
        }
    }
    leases
}
