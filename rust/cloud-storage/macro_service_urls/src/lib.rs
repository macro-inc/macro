#![deny(missing_docs)]
//! Service URL resolution based on the current environment.

use macro_env::Environment;
use url::Url;

#[cfg(test)]
mod test;

/// Extension trait that provides service URLs based on the current environment.
pub trait EnvExtMacroServiceUrls {
    /// The main app URL.
    fn app(&self) -> Url;
    /// Authentication service URL.
    fn auth_service(&self) -> Url;
    /// PDF rendering service URL.
    fn pdf_service(&self) -> Url;
    /// Document storage service URL.
    fn document_storage_service(&self) -> Url;
    /// WebSocket service URL.
    fn websocket_service(&self) -> Url;
    /// Document cognition service URL.
    fn cognition_service(&self) -> Url;
    /// WebSocket connection gateway URL.
    fn connection_gateway(&self) -> Url;
    /// Notification service URL.
    fn notification_service(&self) -> Url;
    /// Static file service URL.
    fn static_file_service(&self) -> Url;
    /// Link unfurl service URL.
    fn unfurl_service(&self) -> Url;
    /// Contacts service URL.
    fn contacts_service(&self) -> Url;
    /// Email service URL.
    fn email_service(&self) -> Url;
    /// Image proxy service URL.
    fn image_proxy_service(&self) -> Url;
}

/// Helper to parse a static URL string. All URLs here are compile-time constants
/// so parsing can never fail.
fn url(s: &str) -> Url {
    Url::parse(s).unwrap()
}

impl EnvExtMacroServiceUrls for Environment {
    fn app(&self) -> Url {
        match self {
            Environment::Production => url("https://macro.com"),
            Environment::Develop => url("https://dev.macro.com"),
            Environment::Local => url("http://localhost:3000"),
        }
    }

    fn auth_service(&self) -> Url {
        match self {
            Environment::Production => url("https://auth-service.macro.com"),
            Environment::Develop => url("https://auth-service-dev.macro.com"),
            Environment::Local => url("http://localhost:8080"),
        }
    }

    fn pdf_service(&self) -> Url {
        match self {
            Environment::Production => url("https://pdf-service.macro.com"),
            Environment::Develop => url("https://pdf-service-dev.macro.com"),
            Environment::Local => url("http://localhost:4567"),
        }
    }

    fn document_storage_service(&self) -> Url {
        match self {
            Environment::Production => url("https://cloud-storage.macro.com"),
            Environment::Develop => url("https://cloud-storage-dev.macro.com"),
            Environment::Local => url("http://localhost:8086"),
        }
    }

    fn websocket_service(&self) -> Url {
        match self {
            Environment::Production => url("wss://services.macro.com"),
            Environment::Develop => url("wss://services-dev.macro.com"),
            Environment::Local => url("ws://localhost:6969"),
        }
    }

    fn cognition_service(&self) -> Url {
        match self {
            Environment::Production => url("https://document-cognition.macro.com"),
            Environment::Develop => url("https://document-cognition-dev.macro.com"),
            Environment::Local => url("http://localhost:8085"),
        }
    }

    fn connection_gateway(&self) -> Url {
        match self {
            Environment::Production => url("wss://connection-gateway.macro.com"),
            Environment::Develop => url("wss://connection-gateway-dev.macro.com"),
            Environment::Local => url("ws://localhost:8082"),
        }
    }

    fn notification_service(&self) -> Url {
        match self {
            Environment::Production => url("https://notifications.macro.com"),
            Environment::Develop => url("https://notifications-dev.macro.com"),
            Environment::Local => url("http://localhost:8089"),
        }
    }

    fn static_file_service(&self) -> Url {
        match self {
            Environment::Production => url("https://static-file-service.macro.com"),
            Environment::Develop => url("https://static-file-service-dev.macro.com"),
            Environment::Local => url("http://localhost:8100"),
        }
    }

    fn unfurl_service(&self) -> Url {
        match self {
            Environment::Production => url("https://unfurl-service.macro.com"),
            Environment::Develop => url("https://unfurl-service-dev.macro.com"),
            Environment::Local => url("http://localhost:8095"),
        }
    }

    fn contacts_service(&self) -> Url {
        match self {
            Environment::Production => url("https://contacts.macro.com"),
            Environment::Develop => url("https://contacts-dev.macro.com"),
            Environment::Local => url("http://localhost:8083"),
        }
    }

    fn email_service(&self) -> Url {
        match self {
            Environment::Production => url("https://email-service.macro.com"),
            Environment::Develop => url("https://email-service-dev.macro.com"),
            Environment::Local => url("http://localhost:8087"),
        }
    }

    fn image_proxy_service(&self) -> Url {
        match self {
            Environment::Production => url("https://image-proxy.macro.com"),
            Environment::Develop => url("https://image-proxy-dev.macro.com"),
            Environment::Local => url("http://localhost:8097"),
        }
    }
}
