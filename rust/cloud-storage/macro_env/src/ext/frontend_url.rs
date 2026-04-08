use crate::Environment;
use url::Url;

/// Return the expected [Url] for the frontend javascript bundle
pub trait FrontendUrl {
    /// get the [Url]
    fn get_frontend_url(&self) -> Url;
}

impl FrontendUrl for Environment {
    fn get_frontend_url(&self) -> Url {
        match self {
            Environment::Production => "https://macro.com/app/".parse().unwrap(),
            Environment::Develop => "https://dev.macro.com/app/".parse().unwrap(),
            Environment::Local => {
                let port = std::env::var("FRONTEND_PORT").unwrap_or_else(|_| "3000".to_string());
                format!("http://localhost:{port}/app/").parse().unwrap()
            }
        }
    }
}
