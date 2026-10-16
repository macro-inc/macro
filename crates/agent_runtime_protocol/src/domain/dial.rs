//! What a runtime declares when it dials the runtime gateway.

/// The machine operator's local consent to permission bypass, `true` or
/// `false`, sent on every dial so a changed setting reaches the server
/// without re-pairing. Runtimes that predate it omit it.
pub const OPERATOR_ALLOWS_BYPASS_HEADER: &str = "x-macro-harness-operator-allows-bypass";
