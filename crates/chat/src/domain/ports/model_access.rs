/// Decides which chat models a user may use, based on whether they are a
/// professional (paid) user.
///
/// Pure domain logic with no I/O, so it can be called directly (e.g. from DCS
/// to validate a requested model).
pub trait ModelAccessService: Send + Sync + 'static {
    /// The default model for a `professional` (`true`) or free (`false`) user.
    fn best_model(&self, professional: bool) -> &'static str;

    /// Whether a `professional` (`true`) or free (`false`) user may use the
    /// provider-qualified model identified by `model_id`. Unknown ids return
    /// `false`.
    fn has_access(&self, professional: bool, model_id: &str) -> bool;
}
