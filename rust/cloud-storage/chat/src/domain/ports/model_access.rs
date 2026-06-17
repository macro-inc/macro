use crate::domain::models::ModelsResponse;

/// Decides which chat models a user may use, based on whether they are a
/// professional (paid) user.
///
/// Pure domain logic with no I/O, so it can be called directly (e.g. from DCS
/// to validate a requested model) or served over HTTP.
pub trait ModelAccessService: Send + Sync + 'static {
    /// List every chat model, each flagged with whether a `professional`
    /// (`true`) or free (`false`) user may use it.
    fn list_models(&self, professional: bool) -> ModelsResponse;

    /// Whether a `professional` (`true`) or free (`false`) user may use the
    /// model identified by `model_id` (a provider api id). Unknown ids return
    /// `false`.
    fn has_access(&self, professional: bool, model_id: &str) -> bool;
}
