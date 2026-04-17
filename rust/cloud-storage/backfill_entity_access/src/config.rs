use macro_env_var::env_var;

env_var! {
    pub struct EnvVars {
        /// macrodb url
        pub DatabaseUrl,
        /// macro user id
        pub MacroUserId,
    }
}
