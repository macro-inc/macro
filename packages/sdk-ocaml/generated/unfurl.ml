(* Generated from packages/sdk/specs/unfurl.json by packages/sdk-ocaml/gen. Do not edit. *)

module Json = Macro_sdk_runtime.Json
module Request = Macro_sdk_runtime.Request

type nonrec get_unfurl_bulk_body = { url_list : string list }

let get_unfurl_bulk_body_of_yojson : Yojson.Safe.t -> get_unfurl_bulk_body =
 fun json ->
  let fields = Json.obj json in
  { url_list = Json.required fields "url_list" (Json.list Json.string) }

and yojson_of_get_unfurl_bulk_body : get_unfurl_bulk_body -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("url_list", Some ((Json.of_list Json.of_string) value.url_list)) ]

let make_get_unfurl_bulk_body ~(url_list : string list) () =
  ({ url_list } : get_unfurl_bulk_body)

(** The type of embeddable content for services that support iframe embedding. *)
type nonrec unfurl_embed_type =
  | None_
  | Video
  | Unknown of string  (** A value this SDK version does not know. *)

let unfurl_embed_type_of_yojson : Yojson.Safe.t -> unfurl_embed_type =
 fun json ->
  match Json.string json with
  | "None" -> None_
  | "Video" -> Video
  | other -> Unknown other

and yojson_of_unfurl_embed_type : unfurl_embed_type -> Yojson.Safe.t =
 fun value ->
  match value with
  | None_ -> `String "None"
  | Video -> `String "Video"
  | Unknown other -> `String other

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

let vec_item_of_yojson : Yojson.Safe.t -> vec_item =
 fun json ->
  let fields = Json.obj json in
  {
    description = Json.optional fields "description" Json.string;
    embed_type = Json.optional fields "embed_type" unfurl_embed_type_of_yojson;
    embed_url = Json.optional fields "embed_url" Json.string;
    favicon_url = Json.optional fields "favicon_url" Json.string;
    image_url = Json.optional fields "image_url" Json.string;
    title = Json.required fields "title" Json.string;
    url = Json.required fields "url" Json.string;
  }

and yojson_of_vec_item : vec_item -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("description", Option.map Json.of_string value.description);
      ("embed_type", Option.map yojson_of_unfurl_embed_type value.embed_type);
      ("embed_url", Option.map Json.of_string value.embed_url);
      ("favicon_url", Option.map Json.of_string value.favicon_url);
      ("image_url", Option.map Json.of_string value.image_url);
      ("title", Some (Json.of_string value.title));
      ("url", Some (Json.of_string value.url));
    ]

let make_vec_item ?description ?embed_type ?embed_url ?favicon_url ?image_url
    ~(title : string) ~(url : string) () =
  ({ description; embed_type; embed_url; favicon_url; image_url; title; url }
    : vec_item)

type nonrec vec = vec_item option list

let vec_of_yojson : Yojson.Safe.t -> vec =
 fun json -> (Json.list (Json.option vec_item_of_yojson)) json

and yojson_of_vec : vec -> Yojson.Safe.t =
 fun value -> (Json.of_list (Json.of_option yojson_of_vec_item)) value

type nonrec get_unfurl_bulk_response = { responses : vec }

let get_unfurl_bulk_response_of_yojson :
    Yojson.Safe.t -> get_unfurl_bulk_response =
 fun json ->
  let fields = Json.obj json in
  { responses = Json.required fields "responses" vec_of_yojson }

and yojson_of_get_unfurl_bulk_response :
    get_unfurl_bulk_response -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("responses", Some (yojson_of_vec value.responses)) ]

let make_get_unfurl_bulk_response ~(responses : vec) () =
  ({ responses } : get_unfurl_bulk_response)

type nonrec get_unfurl_query_params = {
  url : string;  (** The URL to unfurl. *)
}
(** Query parameters for [GET /unfurl]. *)

let get_unfurl_query_params_of_yojson : Yojson.Safe.t -> get_unfurl_query_params
    =
 fun json ->
  let fields = Json.obj json in
  { url = Json.required fields "url" Json.string }

and yojson_of_get_unfurl_query_params : get_unfurl_query_params -> Yojson.Safe.t
    =
 fun value -> Json.record [ ("url", Some (Json.of_string value.url)) ]

let make_get_unfurl_query_params ~(url : string) () =
  ({ url } : get_unfurl_query_params)

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

let get_unfurl_response_of_yojson : Yojson.Safe.t -> get_unfurl_response =
 fun json ->
  let fields = Json.obj json in
  {
    description = Json.optional fields "description" Json.string;
    embed_type = Json.optional fields "embed_type" unfurl_embed_type_of_yojson;
    embed_url = Json.optional fields "embed_url" Json.string;
    favicon_url = Json.optional fields "favicon_url" Json.string;
    image_url = Json.optional fields "image_url" Json.string;
    title = Json.required fields "title" Json.string;
    url = Json.required fields "url" Json.string;
  }

and yojson_of_get_unfurl_response : get_unfurl_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("description", Option.map Json.of_string value.description);
      ("embed_type", Option.map yojson_of_unfurl_embed_type value.embed_type);
      ("embed_url", Option.map Json.of_string value.embed_url);
      ("favicon_url", Option.map Json.of_string value.favicon_url);
      ("image_url", Option.map Json.of_string value.image_url);
      ("title", Some (Json.of_string value.title));
      ("url", Some (Json.of_string value.url));
    ]

let make_get_unfurl_response ?description ?embed_type ?embed_url ?favicon_url
    ?image_url ~(title : string) ~(url : string) () =
  ({ description; embed_type; embed_url; favicon_url; image_url; title; url }
    : get_unfurl_response)

type nonrec proxy_params = { url : string }

let proxy_params_of_yojson : Yojson.Safe.t -> proxy_params =
 fun json ->
  let fields = Json.obj json in
  { url = Json.required fields "url" Json.string }

and yojson_of_proxy_params : proxy_params -> Yojson.Safe.t =
 fun value -> Json.record [ ("url", Some (Json.of_string value.url)) ]

let make_proxy_params ~(url : string) () = ({ url } : proxy_params)

(** [GET /proxy] *)
let proxy_request_handler ~(url : string) () =
  ({
     Request.service = "unfurl";
     operation = "proxy_request_handler";
     meth = `GET;
     path = "/proxy";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [ ("url", [ (fun value -> value) url ]) ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.text;
     decode_error = Request.no_error;
   }
    : (string, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t)

(** [GET /unfurl]

Unfurl the URL passed via the [url] query parameter and return its
extracted metadata (title, description, image, favicon). *)
let get_unfurl ~(url : string) () =
  ({
     Request.service = "unfurl";
     operation = "get_unfurl";
     meth = `GET;
     path = "/unfurl";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [ ("url", [ (fun value -> value) url ]) ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json get_unfurl_response_of_yojson;
     decode_error =
       Request.error_json [ 500 ] (Json.option get_unfurl_response_of_yojson);
   }
    : ( get_unfurl_response,
        get_unfurl_response option )
      Macro_sdk_runtime.Request.t)

(** [POST /unfurl/bulk] *)
let get_unfurl_bulk ~(url_list : string list) () =
  ({
     Request.service = "unfurl";
     operation = "get_unfurl_bulk";
     meth = `POST;
     path = "/unfurl/bulk";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_get_unfurl_bulk_body
               ({ url_list } : get_unfurl_bulk_body)));
     decode_reply = Request.json get_unfurl_bulk_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( get_unfurl_bulk_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)
