(* Generated from packages/sdk/specs/contacts.json by packages/sdk-ocaml/gen. Do not edit. *)

module Json = Macro_sdk_runtime.Json
module Request = Macro_sdk_runtime.Request

type nonrec add_contact_request = {
  user_id : string;  (** The user ID to add as a contact. *)
}
(** Request body for POST /contacts. *)

let add_contact_request_of_yojson : Yojson.Safe.t -> add_contact_request =
 fun json ->
  let fields = Json.obj json in
  { user_id = Json.required fields "user_id" Json.string }

and yojson_of_add_contact_request : add_contact_request -> Yojson.Safe.t =
 fun value -> Json.record [ ("user_id", Some (Json.of_string value.user_id)) ]

let make_add_contact_request ~(user_id : string) () =
  ({ user_id } : add_contact_request)

type nonrec get_contacts_response = {
  contacts : string list;  (** The list of contact user IDs. *)
}
(** Response body for GET /contacts. *)

let get_contacts_response_of_yojson : Yojson.Safe.t -> get_contacts_response =
 fun json ->
  let fields = Json.obj json in
  { contacts = Json.required fields "contacts" (Json.list Json.string) }

and yojson_of_get_contacts_response : get_contacts_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("contacts", Some ((Json.of_list Json.of_string) value.contacts)) ]

let make_get_contacts_response ~(contacts : string list) () =
  ({ contacts } : get_contacts_response)

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

let searched_person_of_yojson : Yojson.Safe.t -> searched_person =
 fun json ->
  let fields = Json.obj json in
  {
    is_agent = Json.required fields "isAgent" Json.bool;
    is_teammate = Json.required fields "isTeammate" Json.bool;
    name = Json.optional fields "name" Json.string;
    user_id = Json.required fields "userId" Json.string;
  }

and yojson_of_searched_person : searched_person -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("isAgent", Some (Json.of_bool value.is_agent));
      ("isTeammate", Some (Json.of_bool value.is_teammate));
      ("name", Option.map Json.of_string value.name);
      ("userId", Some (Json.of_string value.user_id));
    ]

let make_searched_person ~(is_agent : bool) ~(is_teammate : bool) ?name
    ~(user_id : string) () =
  ({ is_agent; is_teammate; name; user_id } : searched_person)

type nonrec search_people_response = {
  people : searched_person list;
      (** Matches ranked teammates first, then prefix matches, then by name or email. *)
}
(** Response body for GET /contacts/search. *)

let search_people_response_of_yojson : Yojson.Safe.t -> search_people_response =
 fun json ->
  let fields = Json.obj json in
  {
    people = Json.required fields "people" (Json.list searched_person_of_yojson);
  }

and yojson_of_search_people_response : search_people_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("people", Some ((Json.of_list yojson_of_searched_person) value.people)) ]

let make_search_people_response ~(people : searched_person list) () =
  ({ people } : search_people_response)

(** [GET /contacts]

GET /contacts handler. *)
let get_contacts () =
  ({
     Request.service = "contacts";
     operation = "get_contacts";
     meth = `GET;
     path = "/contacts";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json get_contacts_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( get_contacts_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /contacts]

POST /contacts handler. *)
let add_contact ~(user_id : string) () =
  ({
     Request.service = "contacts";
     operation = "add_contact";
     meth = `POST;
     path = "/contacts";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_add_contact_request ({ user_id } : add_contact_request)));
     decode_reply = Request.unit;
     decode_error = Request.no_error;
   }
    : (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t)

(** [GET /contacts/search]

GET /contacts/search handler: ranked search of the viewer's contacts and team. *)
let search_people ~(query : string) ?limit () =
  ({
     Request.service = "contacts";
     operation = "search_people";
     meth = `GET;
     path = "/contacts/search";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ("query", [ (fun value -> value) query ]);
           ( "limit",
             match limit with
             | None -> []
             | Some value -> [ string_of_int value ] );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json search_people_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( search_people_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)
