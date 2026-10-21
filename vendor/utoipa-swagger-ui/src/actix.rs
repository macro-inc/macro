#![cfg(feature = "actix-web")]

use std::future;

use actix_web::{
    dev::{HttpServiceFactory, Service, ServiceResponse},
    guard::Get,
    web,
    web::Data,
    HttpResponse, Resource, Responder as ActixResponder,
};
use base64::Engine;

use crate::{ApiDoc, BasicAuth, Config, SwaggerUi};

impl HttpServiceFactory for SwaggerUi {
    fn register(self, config: &mut actix_web::dev::AppService) {
        let mut urls = self
            .urls
            .into_iter()
            .map(|(url, openapi)| {
                register_api_doc_url_resource(url.url.as_ref(), ApiDoc::Utoipa(openapi), config);
                url
            })
            .collect::<Vec<_>>();
        let external_api_docs = self.external_urls.into_iter().map(|(url, api_doc)| {
            register_api_doc_url_resource(url.url.as_ref(), ApiDoc::Value(api_doc), config);
            url
        });
        urls.extend(external_api_docs);

        let swagger_resource = Resource::new(self.path.as_ref())
            .guard(Get())
            .app_data(Data::new(if let Some(config) = self.config.clone() {
                if config.url.is_some() || !config.urls.is_empty() {
                    config
                } else {
                    config.configure_defaults(urls)
                }
            } else {
                Config::new(urls)
            }))
            .wrap_fn(move |req, srv| {
                if let Some(BasicAuth { username, password }) = self
                    .config
                    .as_ref()
                    .and_then(|config| config.basic_auth.clone())
                {
                    let encoded_credentials = format!(
                        "Basic {}",
                        base64::prelude::BASE64_STANDARD.encode(format!("{username}:{password}"))
                    );
                    if let Some(auth_header) = req.headers().get("Authorization") {
                        if auth_header.to_str().unwrap() == encoded_credentials {
                            return srv.call(req);
                        }
                    }
                    return Box::pin(future::ready(Ok(ServiceResponse::new(
                        req.request().clone(),
                        HttpResponse::Unauthorized()
                            .insert_header(("WWW-Authenticate", "Basic realm=\":\""))
                            .finish(),
                    ))));
                }
                srv.call(req)
            })
            .to(serve_swagger_ui);

        HttpServiceFactory::register(swagger_resource, config);
    }
}

fn register_api_doc_url_resource(url: &str, api: ApiDoc, config: &mut actix_web::dev::AppService) {
    async fn get_api_doc(api_doc: web::Data<ApiDoc>) -> impl ActixResponder {
        HttpResponse::Ok().json(api_doc.as_ref())
    }

    let url_resource = Resource::new(url)
        .guard(Get())
        .app_data(Data::new(api))
        .to(get_api_doc);
    HttpServiceFactory::register(url_resource, config);
}

async fn serve_swagger_ui(path: web::Path<String>, data: web::Data<Config<'_>>) -> HttpResponse {
    match super::serve(&path.into_inner(), data.into_inner()) {
        Ok(swagger_file) => swagger_file
            .map(|file| {
                HttpResponse::Ok()
                    .content_type(file.content_type)
                    .body(file.bytes.to_vec())
            })
            .unwrap_or_else(|| HttpResponse::NotFound().finish()),
        Err(error) => HttpResponse::InternalServerError().body(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use actix_web::{http::StatusCode, test, App};
    use base64::prelude::BASE64_STANDARD;

    use super::*;
    #[actix_web::test]
    async fn mount_onto_path_with_slash() {
        let swagger_ui = SwaggerUi::new("/swagger-ui/{_:.*}");

        let app = test::init_service(App::new().service(swagger_ui)).await;
        let req = test::TestRequest::get().uri("/swagger-ui/").to_request();
        let resp = test::call_service(&app, req).await;

        assert!(resp.status().is_success());
    }

    #[actix_web::test]
    async fn basic_auth() {
        let swagger_ui =
            SwaggerUi::new("/swagger-ui/{_:.*}").config(Config::default().basic_auth(BasicAuth {
                username: "admin".to_string(),
                password: "password".to_string(),
            }));

        let app = test::init_service(App::new().service(swagger_ui)).await;
        let req = test::TestRequest::get().uri("/swagger-ui/").to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
        let encoded_credentials = BASE64_STANDARD.encode("admin:password");
        let req = test::TestRequest::get()
            .uri("/swagger-ui/")
            .insert_header(("Authorization", format!("Basic {}", encoded_credentials)))
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }
}
