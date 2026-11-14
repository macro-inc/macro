(* Generated from packages/sdk/specs/static-files.json by packages/sdk-ocaml/gen. Do not edit. *)

type nonrec bulk_delete_request = {
  file_ids : string list;  (** List of file IDs to delete *)
}

val bulk_delete_request_of_yojson : Yojson.Safe.t -> bulk_delete_request
val yojson_of_bulk_delete_request : bulk_delete_request -> Yojson.Safe.t

val make_bulk_delete_request :
  file_ids:string list -> unit -> bulk_delete_request

type nonrec delete_result = {
  error : string option;  (** Error message if deletion failed *)
  file_id : string;  (** File ID that was attempted to delete *)
  success : bool;  (** Whether the deletion was successful *)
}

val delete_result_of_yojson : Yojson.Safe.t -> delete_result
val yojson_of_delete_result : delete_result -> Yojson.Safe.t

val make_delete_result :
  ?error:string -> file_id:string -> success:bool -> unit -> delete_result

type nonrec bulk_delete_response = {
  failed : int;  (** Number of failed deletions *)
  results : delete_result list;  (** Individual results for each file *)
  succeeded : int;  (** Number of successful deletions *)
  total : int;  (** Total number of files attempted *)
}

val bulk_delete_response_of_yojson : Yojson.Safe.t -> bulk_delete_response
val yojson_of_bulk_delete_response : bulk_delete_response -> Yojson.Safe.t

val make_bulk_delete_response :
  failed:int ->
  results:delete_result list ->
  succeeded:int ->
  total:int ->
  unit ->
  bulk_delete_response

type nonrec error_response = {
  message : string;  (** Message to explain failure *)
}
(** A plain old json error response for use with axum.
yup, thats it. *)

val error_response_of_yojson : Yojson.Safe.t -> error_response
val yojson_of_error_response : error_response -> Yojson.Safe.t

val make_error_response : message:string -> unit -> error_response
(** A plain old json error response for use with axum.
yup, thats it. *)

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

val file_metadata_of_yojson : Yojson.Safe.t -> file_metadata
val yojson_of_file_metadata : file_metadata -> Yojson.Safe.t

val make_file_metadata :
  content_type:string ->
  ?extension_data:Yojson.Safe.t ->
  file_id:string ->
  file_name:string ->
  is_uploaded:bool ->
  owner_id:string ->
  s3_key:string ->
  unit ->
  file_metadata
(** File metadata for static files *)

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

val put_file_request_of_yojson : Yojson.Safe.t -> put_file_request
val yojson_of_put_file_request : put_file_request -> Yojson.Safe.t

val make_put_file_request :
  ?content_length:int64 ->
  ?content_type:string ->
  ?extension_data:Yojson.Safe.t ->
  file_name:string ->
  unit ->
  put_file_request

type nonrec put_file_response = {
  file_location : string;  (** permalink *)
  id : string;  (** key to retrieve metadata *)
  upload_url : string;  (** expiring url to upload file blob to *)
}

val put_file_response_of_yojson : Yojson.Safe.t -> put_file_response
val yojson_of_put_file_response : put_file_response -> Yojson.Safe.t

val make_put_file_response :
  file_location:string ->
  id:string ->
  upload_url:string ->
  unit ->
  put_file_response

val put_presigned_url :
  file_name:string ->
  ?content_length:int64 ->
  ?content_type:string ->
  ?extension_data:Yojson.Safe.t ->
  unit ->
  ( put_file_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [PUT /api/file] *)

val handle_bulk_delete_file :
  file_ids:string list ->
  unit ->
  (bulk_delete_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /api/file/bulk-delete]

Bulk delete files. *)

val handle_get_metadata :
  file_id:string ->
  unit ->
  ( file_metadata,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /api/file/metadata/{file_id}] *)

val handle_delete_file :
  file_id:string ->
  unit ->
  (string, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [DELETE /api/file/{file_id}] *)

val get_file_documentation :
  file_id:string ->
  unit ->
  (string, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [GET /file/{file_id}] *)
