(** A minimal blocking HTTP/1.1 client: one request per connection, plain
    [http://] only. The runner uses it to ask the permission endpoint and
    register runs; the test SDK uses it to reach the proxy. *)

type response = { status : int; body : string }

val post_json :
  url:string -> ?bearer:string -> string -> (response, string) result
(** [post_json ~url ?bearer body] sends [body] as [application/json] and reads
    the whole reply. [Error] names what failed (bad URL, connection, malformed
    reply); an HTTP error status is an [Ok] response. *)

val request :
  meth:string -> url:string -> ?bearer:string -> ?body:string -> unit -> (response, string) result
(** [request ~meth ~url ?bearer ?body ()] sends one request, the body (if
    any) as [application/json]; results as [post_json]. *)
