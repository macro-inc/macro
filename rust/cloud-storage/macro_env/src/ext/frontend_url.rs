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
            Environment::Local => "http://localhost:3000/app/".parse().unwrap(),
        }
    }
}
