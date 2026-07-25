use macro_env_var::env_vars;

env_vars!(
    /// The internal api secret key for the service.
    /// NOTE: this value may be different depending on the service that is using this middleware.
    #[derive(Clone)]
    pub struct InternalApiKey;
);
