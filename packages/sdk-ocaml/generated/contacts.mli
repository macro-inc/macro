(* Generated from packages/sdk/specs/contacts.json by packages/sdk-ocaml/gen. Do not edit. *)

type nonrec add_contact_request = {
  user_id : string;  (** The user ID to add as a contact. *)
}
(** Request body for POST /contacts. *)

val add_contact_request_of_yojson : Yojson.Safe.t -> add_contact_request
val yojson_of_add_contact_request : add_contact_request -> Yojson.Safe.t

val make_add_contact_request : user_id:string -> unit -> add_contact_request
(** Request body for POST /contacts. *)

type nonrec get_contacts_response = {
  contacts : string list;  (** The list of contact user IDs. *)
}
(** Response body for GET /contacts. *)

val get_contacts_response_of_yojson : Yojson.Safe.t -> get_contacts_response
val yojson_of_get_contacts_response : get_contacts_response -> Yojson.Safe.t

val make_get_contacts_response :
  contacts:string list -> unit -> get_contacts_response
(** Response body for GET /contacts. *)

type nonrec searched_person = {
  is_agent : bool;
      (** Whether the person is an agent rather than a human; false for non-Macro contacts. *)
  is_teammate : bool;
      (** Whether the person is on the viewer's current team. *)
  name : string option;
      (** Resolved name, as the contact directory shows it; null when unknown. *)
  user_id : string;  (** The person's user ID ([macro|<email>]). *)
}
(** One ranked person in a GET /contacts/search response. *)

val searched_person_of_yojson : Yojson.Safe.t -> searched_person
val yojson_of_searched_person : searched_person -> Yojson.Safe.t

val make_searched_person :
  is_agent:bool ->
  is_teammate:bool ->
  ?name:string ->
  user_id:string ->
  unit ->
  searched_person
(** One ranked person in a GET /contacts/search response. *)

type nonrec search_people_response = {
  people : searched_person list;
      (** Matches ranked teammates first, then prefix matches, then by name or email. *)
}
(** Response body for GET /contacts/search. *)

val search_people_response_of_yojson : Yojson.Safe.t -> search_people_response
val yojson_of_search_people_response : search_people_response -> Yojson.Safe.t

val make_search_people_response :
  people:searched_person list -> unit -> search_people_response
(** Response body for GET /contacts/search. *)

val get_contacts :
  unit ->
  ( get_contacts_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /contacts]

GET /contacts handler. *)

val add_contact :
  user_id:string ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [POST /contacts]

POST /contacts handler. *)

val search_people :
  query:string ->
  ?limit:int ->
  unit ->
  ( search_people_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /contacts/search]

GET /contacts/search handler: ranked search of the viewer's contacts and team. *)
