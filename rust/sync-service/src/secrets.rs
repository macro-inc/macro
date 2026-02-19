use worker::Env;

#[derive(Clone, Debug)]
pub struct Secrets {
    pub internal_api_secret: String,
    pub document_permissions_secret: String,
}

impl From<&Env> for Secrets {
    fn from(env: &Env) -> Self {
        // NOTE: "INTERNAL_API_SECRET_KEY" actually points to the name of the secret binding that we want to use,
        // rather than the key itself. This might want to be changed in the future.
        let secret_binding = env
            .var("INTERNAL_API_SECRET_KEY")
            .unwrap_or_else(|e| {
                panic!("Couldn't get INTERNAL_API_SECRET_KEY environment variable: {e}")
            })
            .to_string();

        let internal_api_secret = env
            .secret(&secret_binding)
            .unwrap_or_else(|_e| panic!("Couldn't get secret secret for internal API key"))
            .to_string();
        let document_permissions_secret = env
            .var("DOCUMENT_PERMISSIONS_SECRET")
            .unwrap_or_else(|e| {
                panic!("Couldn't get DOCUMENT_PERMISSIONS_SECRET environment variable: {e}")
            })
            .to_string();

        Self {
            internal_api_secret,
            document_permissions_secret,
        }
    }
}
