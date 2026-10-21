# utoipa-swagger-ui

[![Utoipa build](https://github.com/juhaku/utoipa/actions/workflows/build.yaml/badge.svg)](https://github.com/juhaku/utoipa/actions/workflows/build.yaml)
[![crates.io](https://img.shields.io/crates/v/utoipa-swagger-ui.svg?label=crates.io&color=orange&logo=rust)](https://crates.io/crates/utoipa-swagger-ui)
[![docs.rs](https://img.shields.io/static/v1?label=docs.rs&message=utoipa-swagger-ui&color=blue&logo=data:image/svg+xml;base64,PHN2ZyByb2xlPSJpbWciIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgdmlld0JveD0iMCAwIDUxMiA1MTIiPjxwYXRoIGZpbGw9IiNmNWY1ZjUiIGQ9Ik00ODguNiAyNTAuMkwzOTIgMjE0VjEwNS41YzAtMTUtOS4zLTI4LjQtMjMuNC0zMy43bC0xMDAtMzcuNWMtOC4xLTMuMS0xNy4xLTMuMS0yNS4zIDBsLTEwMCAzNy41Yy0xNC4xIDUuMy0yMy40IDE4LjctMjMuNCAzMy43VjIxNGwtOTYuNiAzNi4yQzkuMyAyNTUuNSAwIDI2OC45IDAgMjgzLjlWMzk0YzAgMTMuNiA3LjcgMjYuMSAxOS45IDMyLjJsMTAwIDUwYzEwLjEgNS4xIDIyLjEgNS4xIDMyLjIgMGwxMDMuOS01MiAxMDMuOSA1MmMxMC4xIDUuMSAyMi4xIDUuMSAzMi4yIDBsMTAwLTUwYzEyLjItNi4xIDE5LjktMTguNiAxOS45LTMyLjJWMjgzLjljMC0xNS05LjMtMjguNC0yMy40LTMzLjd6TTM1OCAyMTQuOGwtODUgMzEuOXYtNjguMmw4NS0zN3Y3My4zek0xNTQgMTA0LjFsMTAyLTM4LjIgMTAyIDM4LjJ2LjZsLTEwMiA0MS40LTEwMi00MS40di0uNnptODQgMjkxLjFsLTg1IDQyLjV2LTc5LjFsODUtMzguOHY3NS40em0wLTExMmwtMTAyIDQxLjQtMTAyLTQxLjR2LS42bDEwMi0zOC4yIDEwMiAzOC4ydi42em0yNDAgMTEybC04NSA0Mi41di03OS4xbDg1LTM4Ljh2NzUuNHptMC0xMTJsLTEwMiA0MS40LTEwMi00MS40di0uNmwxMDItMzguMiAxMDIgMzguMnYuNnoiPjwvcGF0aD48L3N2Zz4K)](https://docs.rs/utoipa-swagger-ui/latest/utoipa_swagger_ui/)
![rustc](https://img.shields.io/static/v1?label=rustc&message=1.75&color=orange&logo=rust)

This crate implements necessary boilerplate code to serve Swagger UI via web server. It
works as a bridge for serving the OpenAPI documentation created with
[utoipa](https://docs.rs/utoipa/) library in the Swagger UI.

**Currently implemented boilerplate for:**

* **actix-web** `version >= 4`
* **rocket** `version >=0.5`
* **axum** `version >=0.7`

Serving Swagger UI is framework independent thus this crate also supports serving the Swagger UI with
other frameworks as well. With other frameworks, there is a bit more manual implementation to be done. See
more details at [serve](https://docs.rs/utoipa-swagger-ui/latest/utoipa_swagger_ui/fn.serve.html) or
[examples](https://github.com/juhaku/utoipa/tree/master/examples).

## Crate Features

* **`actix-web`** Enables actix-web integration with pre-configured SwaggerUI service factory allowing
  users to use the Swagger UI without a hassle.
* **`rocket`** Enables rocket integration with pre-configured routes for serving the Swagger UI
  and api doc without a hassle.
* **`axum`** Enables `axum` integration with pre-configured Router serving Swagger UI and OpenAPI specs
  hassle free.
* **`debug-embed`** Enables `debug-embed` feature on `rust_embed` crate to allow embedding files in debug
  builds as well.
* **`reqwest`** Use `reqwest` for downloading Swagger UI according to the `SWAGGER_UI_DOWNLOAD_URL` environment
  variable. This is only enabled by default on _Windows_.
* **`url`** Enabled by default for parsing and encoding the download URL.
* **`vendored`** Enables vendored Swagger UI via `utoipa-swagger-ui-vendored` crate.
* **`cache`** Enables caching of the Swagger UI download in `utoipa-swagger-ui` during the build process.
* **`debug`**: Implement debug trait for SwaggerUi and other types.

## Install

Use only the raw types without any boilerplate implementation.

```toml
[dependencies]
utoipa-swagger-ui = "9"
```

Enable actix-web framework with Swagger UI you could define the dependency as follows.

```toml
[dependencies]
utoipa-swagger-ui = { version = "9", features = ["actix-web"] }
```

**Note!** Also remember that you already have defined `utoipa` dependency in your `Cargo.toml`

## Build Config

> [!IMPORTANT]
> _`utoipa-swagger-ui` crate will by default try to use system `curl` package for downloading the Swagger UI. It
> can optionally be downloaded with `reqwest` by enabling `reqwest` feature. Reqwest can be useful for platform
> independent builds however bringing quite a few unnecessary dependencies just to download a file.
> If the `SWAGGER_UI_DOWNLOAD_URL` is a file path then no downloading will happen._

> [!TIP]
> Use **`vendored`** feature flag to use vendored Swagger UI. This is especially useful for no network 
> environments.

**The following configuration env variables are available at build time:**

 * `SWAGGER_UI_DOWNLOAD_URL`: Defines the url from where to download the swagger-ui zip file.

   * Current Swagger UI version: <https://github.com/swagger-api/swagger-ui/archive/refs/tags/v5.17.14.zip>
   * [All available Swagger UI versions](https://github.com/swagger-api/swagger-ui/tags)

 * `SWAGGER_UI_OVERWRITE_FOLDER`: Defines an _optional_ absolute path to a directory containing files 
    to overwrite the Swagger UI files. Typically you might want to overwrite `index.html`.

## Examples

Serve Swagger UI with api doc via **`actix-web`**. See full example from [examples](https://github.com/juhaku/utoipa/tree/master/examples/todo-actix).

```rust
HttpServer::new(move || {
    App::new()
        .service(
            SwaggerUi::new("/swagger-ui/{_:.*}")
                .url("/api-docs/openapi.json", ApiDoc::openapi()),
        )
  })
  .bind((Ipv4Addr::UNSPECIFIED, 8989)).unwrap()
  .run();
```

Serve Swagger UI with api doc via **`rocket`**. See full example from [examples](https://github.com/juhaku/utoipa/tree/master/examples/rocket-todo).

```rust
#[rocket::launch]
fn rocket() -> Rocket<Build> {
    rocket::build()
        .mount(
            "/",
            SwaggerUi::new("/swagger-ui/<_..>")
                .url("/api-docs/openapi.json", ApiDoc::openapi()),
        )
}
```

Setup Router to serve Swagger UI with **`axum`** framework. See full implementation of how to serve
Swagger UI with axum from [examples](https://github.com/juhaku/utoipa/tree/master/examples/todo-axum).

```rust
let app = Router::new()
    .merge(SwaggerUi::new("/swagger-ui")
        .url("/api-docs/openapi.json", ApiDoc::openapi()));
```

## License

Licensed under either of [Apache 2.0](LICENSE-APACHE) or [MIT](LICENSE-MIT) license at your option.

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in this crate
by you, shall be dual licensed, without any additional terms or conditions.
