use super::*;

const ENVS: [Environment; 3] = [
    Environment::Production,
    Environment::Develop,
    Environment::Local,
];

#[test]
fn app_parses() {
    for env in ENVS {
        let _ = env.app();
    }
}

#[test]
fn auth_service_parses() {
    for env in ENVS {
        let _ = env.auth_service();
    }
}

#[test]
fn pdf_service_parses() {
    for env in ENVS {
        let _ = env.pdf_service();
    }
}

#[test]
fn document_storage_service_parses() {
    for env in ENVS {
        let _ = env.document_storage_service();
    }
}

#[test]
fn websocket_service_parses() {
    for env in ENVS {
        let _ = env.websocket_service();
    }
}

#[test]
fn cognition_service_parses() {
    for env in ENVS {
        let _ = env.cognition_service();
    }
}

#[test]
fn connection_gateway_parses() {
    for env in ENVS {
        let _ = env.connection_gateway();
    }
}

#[test]
fn notification_service_parses() {
    for env in ENVS {
        let _ = env.notification_service();
    }
}

#[test]
fn static_file_service_parses() {
    for env in ENVS {
        let _ = env.static_file_service();
    }
}

#[test]
fn unfurl_service_parses() {
    for env in ENVS {
        let _ = env.unfurl_service();
    }
}

#[test]
fn contacts_service_parses() {
    for env in ENVS {
        let _ = env.contacts_service();
    }
}

#[test]
fn email_service_parses() {
    for env in ENVS {
        let _ = env.email_service();
    }
}

#[test]
fn image_proxy_service_parses() {
    for env in ENVS {
        let _ = env.image_proxy_service();
    }
}
