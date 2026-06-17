use rig_core::completion::CompletionModel;

pub trait Model {
    /// The provider-specific completion model this resolves to.
    type Completion: CompletionModel;
    /// Build the completion model used to drive an agent.
    fn completion(&self) -> Self::Completion;
    /// Best-effort reasoning / extended-thinking config, or `None` if the
    /// model doesn't support it.
    fn thinking_params(&self) -> Option<serde_json::Value>;
}

/// Routes a validated, provider-specific model id to a runtime model.
///
/// Routing is infallible: validation lives in the id type. Each router's
/// [`ModelId`](ModelRouter::ModelId) is a newtype whose only constructor checks
/// the id against the provider's namespace (e.g.
/// [`AnthropicModelId`](crate::model::anthropic::AnthropicModelId)), so by the
/// time `route_model` receives one it is guaranteed to belong to this provider.
pub trait ModelRouter {
    /// The validated id type this router accepts.
    type ModelId;
    /// The runtime model this router produces.
    type RoutedModel: Model;
    /// Bind an already-validated id to this router's provider client.
    fn route_model(&self, model: Self::ModelId) -> Self::RoutedModel;
}
