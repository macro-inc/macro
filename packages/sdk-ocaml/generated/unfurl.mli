(* Generated from packages/sdk/specs/unfurl.json by packages/sdk-ocaml/gen. Do not edit. *)

type nonrec get_unfurl_bulk_body = { url_list : string list }

val get_unfurl_bulk_body_of_yojson : Yojson.Safe.t -> get_unfurl_bulk_body
val yojson_of_get_unfurl_bulk_body : get_unfurl_bulk_body -> Yojson.Safe.t

val make_get_unfurl_bulk_body :
  url_list:string list -> unit -> get_unfurl_bulk_body

(** The type of embeddable content for services that support iframe embedding. *)
type nonrec unfurl_embed_type =
  | None_
  | Video
  | Unknown of string  (** A value this SDK version does not know. *)

val unfurl_embed_type_of_yojson : Yojson.Safe.t -> unfurl_embed_type
val yojson_of_unfurl_embed_type : unfurl_embed_type -> Yojson.Safe.t

type nonrec vec_item = {
  description : string option;
      (** The page description (from [og:description]), if any. *)
  embed_type : unfurl_embed_type option;
      (** The type of embeddable content, if the URL supports iframe embedding. *)
  embed_url : string option;
      (** The iframe-embeddable URL for services like Loom or Supercut. *)
  favicon_url : string option;  (** The page's favicon URL, if any. *)
  image_url : string option;
      (** The page's preview image URL (from [og:image]), if any. *)
  title : string;
      (** The page title (from custom URL parser, Open Graph, or [<title>]). *)
  url : string;  (** The URL that was unfurled. *)
}
(** Unfurl response for a single URL: the URL itself plus any metadata that
was extracted from the page's [<head>] (title, description, image,
favicon). *)

val vec_item_of_yojson : Yojson.Safe.t -> vec_item
val yojson_of_vec_item : vec_item -> Yojson.Safe.t

val make_vec_item :
  ?description:string ->
  ?embed_type:unfurl_embed_type ->
  ?embed_url:string ->
  ?favicon_url:string ->
  ?image_url:string ->
  title:string ->
  url:string ->
  unit ->
  vec_item
(** Unfurl response for a single URL: the URL itself plus any metadata that
was extracted from the page's [<head>] (title, description, image,
favicon). *)

type nonrec vec = vec_item option list

val vec_of_yojson : Yojson.Safe.t -> vec
val yojson_of_vec : vec -> Yojson.Safe.t

type nonrec get_unfurl_bulk_response = { responses : vec }

val get_unfurl_bulk_response_of_yojson :
  Yojson.Safe.t -> get_unfurl_bulk_response

val yojson_of_get_unfurl_bulk_response :
  get_unfurl_bulk_response -> Yojson.Safe.t

val make_get_unfurl_bulk_response :
  responses:vec -> unit -> get_unfurl_bulk_response

type nonrec get_unfurl_query_params = {
  url : string;  (** The URL to unfurl. *)
}
(** Query parameters for [GET /unfurl]. *)

val get_unfurl_query_params_of_yojson : Yojson.Safe.t -> get_unfurl_query_params
val yojson_of_get_unfurl_query_params : get_unfurl_query_params -> Yojson.Safe.t

val make_get_unfurl_query_params : url:string -> unit -> get_unfurl_query_params
(** Query parameters for [GET /unfurl]. *)

type nonrec get_unfurl_response = {
  description : string option;
      (** The page description (from [og:description]), if any. *)
  embed_type : unfurl_embed_type option;
      (** The type of embeddable content, if the URL supports iframe embedding. *)
  embed_url : string option;
      (** The iframe-embeddable URL for services like Loom or Supercut. *)
  favicon_url : string option;  (** The page's favicon URL, if any. *)
  image_url : string option;
      (** The page's preview image URL (from [og:image]), if any. *)
  title : string;
      (** The page title (from custom URL parser, Open Graph, or [<title>]). *)
  url : string;  (** The URL that was unfurled. *)
}
(** Unfurl response for a single URL: the URL itself plus any metadata that
was extracted from the page's [<head>] (title, description, image,
favicon). *)

val get_unfurl_response_of_yojson : Yojson.Safe.t -> get_unfurl_response
val yojson_of_get_unfurl_response : get_unfurl_response -> Yojson.Safe.t

val make_get_unfurl_response :
  ?description:string ->
  ?embed_type:unfurl_embed_type ->
  ?embed_url:string ->
  ?favicon_url:string ->
  ?image_url:string ->
  title:string ->
  url:string ->
  unit ->
  get_unfurl_response
(** Unfurl response for a single URL: the URL itself plus any metadata that
was extracted from the page's [<head>] (title, description, image,
favicon). *)

type nonrec proxy_params = { url : string }

val proxy_params_of_yojson : Yojson.Safe.t -> proxy_params
val yojson_of_proxy_params : proxy_params -> Yojson.Safe.t
val make_proxy_params : url:string -> unit -> proxy_params

val proxy_request_handler :
  url:string ->
  unit ->
  (string, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [GET /proxy] *)

val get_unfurl :
  url:string ->
  unit ->
  (get_unfurl_response, get_unfurl_response option) Macro_sdk_runtime.Request.t
(** [GET /unfurl]

Unfurl the URL passed via the [url] query parameter and return its
extracted metadata (title, description, image, favicon). *)

val get_unfurl_bulk :
  url_list:string list ->
  unit ->
  ( get_unfurl_bulk_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /unfurl/bulk] *)
