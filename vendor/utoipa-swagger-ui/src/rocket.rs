#![cfg(feature = "rocket")]

use std::{borrow::Cow, io::Cursor, sync::Arc};

use base64::{prelude::BASE64_STANDARD, Engine};
use rocket::{
    http::{Header, Status},
    request::{self, FromRequest},
    response::{status::NotFound, Responder as RocketResponder},
    route::{Handler, Outcome},
    serde::json::Json,
    Data as RocketData, Request, Response, Route,
};

use crate::{ApiDoc, BasicAuth, Config, SwaggerFile, SwaggerUi};

impl From<SwaggerUi> for Vec<Route> {
    fn from(swagger_ui: SwaggerUi) -> Self {
        let mut routes =
            Vec::<Route>::with_capacity(swagger_ui.urls.len() + 1 + swagger_ui.external_urls.len());
        let mut api_docs =
            Vec::<Route>::with_capacity(swagger_ui.urls.len() + swagger_ui.external_urls.len());

        let urls = swagger_ui
            .urls
            .into_iter()
            .map(|(url, openapi)| (url, ApiDoc::Utoipa(openapi)))
            .chain(
                swagger_ui
                    .external_urls
                    .into_iter()
                    .map(|(url, api_doc)| (url, ApiDoc::Value(api_doc))),
            )
            .map(|(url, openapi)| {
                api_docs.push(Route::new(
                    rocket::http::Method::Get,
                    &url.url,
                    ServeApiDoc(openapi),
                ));
                url
            });

        routes.push(Route::new(
            rocket::http::Method::Get,
            swagger_ui.path.as_ref(),
            ServeSwagger(
                swagger_ui.path.clone(),
                Arc::new(if let Some(config) = swagger_ui.config {
                    if config.url.is_some() || !config.urls.is_empty() {
                        config
                    } else {
                        config.configure_defaults(urls)
                    }
                } else {
                    Config::new(urls)
                }),
            ),
        ));
        routes.extend(api_docs);

        routes
    }
}

#[derive(Clone)]
struct ServeApiDoc(ApiDoc);

#[rocket::async_trait]
impl Handler for ServeApiDoc {
    async fn handle<'r>(&self, request: &'r Request<'_>, _: RocketData<'r>) -> Outcome<'r> {
        Outcome::from(request, Json(self.0.clone()))
    }
}

#[derive(Clone)]
struct ServeSwagger(Cow<'static, str>, Arc<Config<'static>>);

#[rocket::async_trait]
impl Handler for ServeSwagger {
    async fn handle<'r>(&self, request: &'r Request<'_>, _: RocketData<'r>) -> Outcome<'r> {
        if let Some(basic_auth) = &self.1.clone().basic_auth {
            let request_guard = request.guard::<BasicAuth>().await;
            match request_guard {
                request::Outcome::Success(BasicAuth { username, password })
                    if username == basic_auth.username && password == basic_auth.password =>
                {
                    ()
                }
                _ => return Outcome::from(request, BasicAuthErrorResponse),
            }
        }

        let mut base_path = self.0.as_ref();
        if let Some(index) = self.0.find('<') {
            base_path = &base_path[..index];
        }

        let request_path = request.uri().path().as_str();
        let request_path = match request_path.strip_prefix(base_path) {
            Some(stripped) => stripped,
            None => return Outcome::from(request, RedirectResponder(base_path.into())),
        };
        match super::serve(request_path, self.1.clone()) {
            Ok(swagger_file) => swagger_file
                .map(|file| Outcome::from(request, file))
                .unwrap_or_else(|| Outcome::from(request, NotFound("Swagger UI file not found"))),
            Err(error) => Outcome::from(
                request,
                rocket::response::status::Custom(Status::InternalServerError, error.to_string()),
            ),
        }
    }
}

pub struct BasicAuthErrorResponse;

impl<'r, 'o: 'r> RocketResponder<'r, 'o> for BasicAuthErrorResponse {
    fn respond_to(self, _: &'r Request<'_>) -> rocket::response::Result<'o> {
        Response::build()
            .status(Status::Unauthorized)
            .header(Header::new("WWW-Authenticate", "Basic realm=\":\""))
            .ok()
    }
}

impl<'r, 'o: 'r> RocketResponder<'r, 'o> for SwaggerFile<'o> {
    fn respond_to(self, _: &'r Request<'_>) -> rocket::response::Result<'o> {
        Ok(Response::build()
            .header(Header::new("Content-Type", self.content_type))
            .sized_body(self.bytes.len(), Cursor::new(self.bytes.to_vec()))
            .status(Status::Ok)
            .finalize())
    }
}

struct RedirectResponder(String);
impl<'r, 'a: 'r> RocketResponder<'r, 'a> for RedirectResponder {
    fn respond_to(self, _request: &'r Request<'_>) -> rocket::response::Result<'a> {
        Response::build()
            .status(Status::Found)
            .raw_header("Location", self.0)
            .ok()
    }
}

#[rocket::async_trait]
impl<'r> FromRequest<'r> for BasicAuth {
    type Error = ();

    async fn from_request(req: &'r Request<'_>) -> request::Outcome<BasicAuth, ()> {
        match req.headers().get_one("Authorization") {
            None => request::Outcome::Error((Status::BadRequest, ())),
            Some(credentials) => {
                if let Some(basic_auth) = credentials
                    .strip_prefix("Basic ")
                    .and_then(|s| BASE64_STANDARD.decode(s).ok())
                    .and_then(|b| String::from_utf8(b).ok())
                    .and_then(|s| {
                        if let Some((username, password)) = s.split_once(':') {
                            Some(BasicAuth {
                                username: username.to_string(),
                                password: password.to_string(),
                            })
                        } else {
                            None
                        }
                    })
                {
                    request::Outcome::Success(basic_auth)
                } else {
                    request::Outcome::Error((Status::BadRequest, ()))
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use rocket::local::blocking::Client;

    use crate::BasicAuth;

    use super::*;

    #[test]
    fn mount_onto_path_not_end_with_slash() {
        let routes: Vec<Route> = SwaggerUi::new("/swagger-ui").into();
        let rocket = rocket::build().mount("/", routes);
        let client = Client::tracked(rocket).unwrap();
        let response = client.get("/swagger-ui").dispatch();
        assert_eq!(response.status(), Status::Ok);
    }

    #[test]
    fn basic_auth() {
        let swagger_ui =
            SwaggerUi::new("/swagger-ui").config(Config::default().basic_auth(BasicAuth {
                username: "admin".to_string(),
                password: "password".to_string(),
            }));
        let routes: Vec<Route> = swagger_ui.into();
        let rocket = rocket::build().mount("/", routes);
        let client = Client::tracked(rocket).unwrap();
        let response = client.get("/swagger-ui").dispatch();
        assert_eq!(response.status(), Status::Unauthorized);
        let encoded_credentials = BASE64_STANDARD.encode("admin:password");
        let response = client
            .get("/swagger-ui")
            .header(Header::new(
                "Authorization",
                format!("Basic {}", encoded_credentials),
            ))
            .dispatch();
        assert_eq!(response.status(), Status::Ok);
    }
}
