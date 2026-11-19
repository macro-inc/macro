(* Generated from packages/sdk/specs/static-files.json by packages/sdk-ocaml/gen. Do not edit. *)

module Json = Macro_sdk_runtime.Json
module Request = Macro_sdk_runtime.Request

type nonrec bulk_delete_request = {
  file_ids : string list;  (** List of file IDs to delete *)
}

let bulk_delete_request_of_yojson : Yojson.Safe.t -> bulk_delete_request =
 fun json ->
  let fields = Json.obj json in
  { file_ids = Json.required fields "file_ids" (Json.list Json.string) }

and yojson_of_bulk_delete_request : bulk_delete_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("file_ids", Some ((Json.of_list Json.of_string) value.file_ids)) ]

let make_bulk_delete_request ~(file_ids : string list) () =
  ({ file_ids } : bulk_delete_request)

type nonrec delete_result = {
  error : string option;  (** Error message if deletion failed *)
  file_id : string;  (** File ID that was attempted to delete *)
  success : bool;  (** Whether the deletion was successful *)
}

let delete_result_of_yojson : Yojson.Safe.t -> delete_result =
 fun json ->
  let fields = Json.obj json in
  {
    error = Json.optional fields "error" Json.string;
    file_id = Json.required fields "file_id" Json.string;
    success = Json.required fields "success" Json.bool;
  }

and yojson_of_delete_result : delete_result -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("error", Option.map Json.of_string value.error);
      ("file_id", Some (Json.of_string value.file_id));
      ("success", Some (Json.of_bool value.success));
    ]

let make_delete_result ?error ~(file_id : string) ~(success : bool) () =
  ({ error; file_id; success } : delete_result)

type nonrec bulk_delete_response = {
  failed : int;  (** Number of failed deletions *)
  results : delete_result list;  (** Individual results for each file *)
  succeeded : int;  (** Number of successful deletions *)
  total : int;  (** Total number of files attempted *)
}

let bulk_delete_response_of_yojson : Yojson.Safe.t -> bulk_delete_response =
 fun json ->
  let fields = Json.obj json in
  {
    failed = Json.required fields "failed" Json.int;
    results = Json.required fields "results" (Json.list delete_result_of_yojson);
    succeeded = Json.required fields "succeeded" Json.int;
    total = Json.required fields "total" Json.int;
  }

and yojson_of_bulk_delete_response : bulk_delete_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("failed", Some (Json.of_int value.failed));
      ("results", Some ((Json.of_list yojson_of_delete_result) value.results));
      ("succeeded", Some (Json.of_int value.succeeded));
      ("total", Some (Json.of_int value.total));
    ]

let make_bulk_delete_response ~(failed : int) ~(results : delete_result list)
    ~(succeeded : int) ~(total : int) () =
  ({ failed; results; succeeded; total } : bulk_delete_response)

type nonrec error_response = {
  message : string;  (** Message to explain failure *)
}
(** A plain old json error response for use with axum.
yup, thats it. *)

let error_response_of_yojson : Yojson.Safe.t -> error_response =
 fun json ->
  let fields = Json.obj json in
  { message = Json.required fields "message" Json.string }

and yojson_of_error_response : error_response -> Yojson.Safe.t =
 fun value -> Json.record [ ("message", Some (Json.of_string value.message)) ]

let make_error_response ~(message : string) () = ({ message } : error_response)

type nonrec file_metadata = {
  content_type : string;  (** mimetype *)
  extension_data : Yojson.Safe.t option;
      (** extra metadata, uploaded with the file *)
  file_id : string;  (** id of static file *)
  file_name : string;  (** file name *)
  is_uploaded : bool;  (** is data uploaded to s3 *)
  owner_id : string;  (** owner *)
  s3_key : string;  (** s3 key *)
}
(** File metadata for static files *)

let file_metadata_of_yojson : Yojson.Safe.t -> file_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    content_type = Json.required fields "content_type" Json.string;
    extension_data = Json.optional fields "extension_data" Json.json;
    file_id = Json.required fields "file_id" Json.string;
    file_name = Json.required fields "file_name" Json.string;
    is_uploaded = Json.required fields "is_uploaded" Json.bool;
    owner_id = Json.required fields "owner_id" Json.string;
    s3_key = Json.required fields "s3_key" Json.string;
  }

and yojson_of_file_metadata : file_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("content_type", Some (Json.of_string value.content_type));
      ("extension_data", Option.map Json.of_json value.extension_data);
      ("file_id", Some (Json.of_string value.file_id));
      ("file_name", Some (Json.of_string value.file_name));
      ("is_uploaded", Some (Json.of_bool value.is_uploaded));
      ("owner_id", Some (Json.of_string value.owner_id));
      ("s3_key", Some (Json.of_string value.s3_key));
    ]

let make_file_metadata ~(content_type : string) ?extension_data
    ~(file_id : string) ~(file_name : string) ~(is_uploaded : bool)
    ~(owner_id : string) ~(s3_key : string) () =
  ({
     content_type;
     extension_data;
     file_id;
     file_name;
     is_uploaded;
     owner_id;
     s3_key;
   }
    : file_metadata)

type nonrec put_file_request = {
  content_length : int64 option;
      (** Exact size of the upload in bytes. When set, it is signed into the upload
URL, so storage rejects a body of any other size. *)
  content_type : string option;
      (** optional mime type if type cannot be infered from file_name *)
  extension_data : Yojson.Safe.t option;
      (** extra metadata to store with file
don't put anything private in here it is public *)
  file_name : string;  (** file name *)
}

let put_file_request_of_yojson : Yojson.Safe.t -> put_file_request =
 fun json ->
  let fields = Json.obj json in
  {
    content_length = Json.optional fields "content_length" Json.int64;
    content_type = Json.optional fields "content_type" Json.string;
    extension_data = Json.optional fields "extension_data" Json.json;
    file_name = Json.required fields "file_name" Json.string;
  }

and yojson_of_put_file_request : put_file_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("content_length", Option.map Json.of_int64 value.content_length);
      ("content_type", Option.map Json.of_string value.content_type);
      ("extension_data", Option.map Json.of_json value.extension_data);
      ("file_name", Some (Json.of_string value.file_name));
    ]

let make_put_file_request ?content_length ?content_type ?extension_data
    ~(file_name : string) () =
  ({ content_length; content_type; extension_data; file_name }
    : put_file_request)

type nonrec put_file_response = {
  file_location : string;  (** permalink *)
  id : string;  (** key to retrieve metadata *)
  upload_url : string;  (** expiring url to upload file blob to *)
}

let put_file_response_of_yojson : Yojson.Safe.t -> put_file_response =
 fun json ->
  let fields = Json.obj json in
  {
    file_location = Json.required fields "file_location" Json.string;
    id = Json.required fields "id" Json.string;
    upload_url = Json.required fields "upload_url" Json.string;
  }

and yojson_of_put_file_response : put_file_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("file_location", Some (Json.of_string value.file_location));
      ("id", Some (Json.of_string value.id));
      ("upload_url", Some (Json.of_string value.upload_url));
    ]

let make_put_file_response ~(file_location : string) ~(id : string)
    ~(upload_url : string) () =
  ({ file_location; id; upload_url } : put_file_response)

(** [PUT /api/file] *)
let put_presigned_url ~(file_name : string) ?content_length ?content_type
    ?extension_data () =
  ({
     Request.service = "static-files";
     operation = "put_presigned_url";
     meth = `PUT;
     path = "/api/file";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_put_file_request
               ({ content_length; content_type; extension_data; file_name }
                 : put_file_request)));
     decode_reply = Request.json put_file_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( put_file_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /api/file/bulk-delete]

Bulk delete files. *)
let handle_bulk_delete_file ~(file_ids : string list) () =
  ({
     Request.service = "static-files";
     operation = "handle_bulk_delete_file";
     meth = `POST;
     path = "/api/file/bulk-delete";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_bulk_delete_request ({ file_ids } : bulk_delete_request)));
     decode_reply = Request.json bulk_delete_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 403; 500 ] error_response_of_yojson;
   }
    : (bulk_delete_response, error_response) Macro_sdk_runtime.Request.t)

(** [GET /api/file/metadata/{file_id}] *)
let handle_get_metadata ~(file_id : string) () =
  ({
     Request.service = "static-files";
     operation = "handle_get_metadata";
     meth = `GET;
     path =
       String.concat ""
         [
           "/api/file/metadata/"; Request.segment ((fun value -> value) file_id);
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json file_metadata_of_yojson;
     decode_error = Request.no_error;
   }
    : ( file_metadata,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [DELETE /api/file/{file_id}] *)
let handle_delete_file ~(file_id : string) () =
  ({
     Request.service = "static-files";
     operation = "handle_delete_file";
     meth = `DELETE;
     path =
       String.concat ""
         [ "/api/file/"; Request.segment ((fun value -> value) file_id) ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.text;
     decode_error = Request.no_error;
   }
    : (string, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t)

(** [GET /file/{file_id}] *)
let get_file_documentation ~(file_id : string) () =
  ({
     Request.service = "static-files";
     operation = "get_file_documentation";
     meth = `GET;
     path =
       String.concat ""
         [ "/file/"; Request.segment ((fun value -> value) file_id) ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.text;
     decode_error = Request.no_error;
   }
    : (string, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t)
