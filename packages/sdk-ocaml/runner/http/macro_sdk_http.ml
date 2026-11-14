type response = { status : int; body : string }

type target = { host : string; port : int; path : string }

(* Accepts http://host[:port][/path]; nothing else is needed for local
   endpoints, so https and userinfo are refused rather than half-supported. *)
let parse_url url =
  let prefix = "http://" in
  let prefix_length = String.length prefix in
  if
    String.length url < prefix_length
    || String.sub url 0 prefix_length <> prefix
  then Error (Printf.sprintf "only http:// URLs are supported: %s" url)
  else
    let rest = String.sub url prefix_length (String.length url - prefix_length) in
    let authority, path =
      match String.index_opt rest '/' with
      | Some slash ->
          (String.sub rest 0 slash, String.sub rest slash (String.length rest - slash))
      | None -> (rest, "/")
    in
    match String.rindex_opt authority ':' with
    | None -> Ok { host = authority; port = 80; path }
    | Some colon -> (
        let host = String.sub authority 0 colon in
        let port_text =
          String.sub authority (colon + 1) (String.length authority - colon - 1)
        in
        match int_of_string_opt port_text with
        | Some port -> Ok { host; port; path }
        | None -> Error (Printf.sprintf "bad port in URL: %s" url))

let connect { host; port; _ } =
  let addresses =
    Unix.getaddrinfo host (string_of_int port) [ Unix.AI_SOCKTYPE Unix.SOCK_STREAM ]
  in
  let rec first = function
    | [] -> Error (Printf.sprintf "cannot connect to %s:%d" host port)
    | address :: others -> (
        let socket = Unix.socket address.Unix.ai_family Unix.SOCK_STREAM 0 in
        match Unix.connect socket address.Unix.ai_addr with
        | () -> Ok socket
        | exception Unix.Unix_error _ ->
            Unix.close socket;
            first others)
  in
  first addresses

let rec write_all socket bytes offset =
  if offset < Bytes.length bytes then
    let written = Unix.write socket bytes offset (Bytes.length bytes - offset) in
    write_all socket bytes (offset + written)

let find_substring haystack needle =
  let needle_length = String.length needle in
  let rec search index =
    if index + needle_length > String.length haystack then None
    else if String.sub haystack index needle_length = needle then Some index
    else search (index + 1)
  in
  search 0

let header_value raw name =
  let lowered = String.lowercase_ascii raw in
  match find_substring lowered ("\r\n" ^ name ^ ":") with
  | None -> None
  | Some start ->
      let value_start = start + String.length name + 3 in
      let value_end = Option.value (find_substring (String.sub lowered value_start (String.length lowered - value_start)) "\r\n") ~default:0 in
      Some (String.trim (String.sub lowered value_start value_end))

(* Reads until the reply is complete. Servers may keep the connection open
   despite "connection: close", so stop at Content-Length or the final chunk
   instead of waiting for end of file. *)
let read_response socket =
  let buffer = Buffer.create 4096 in
  let chunk = Bytes.create 4096 in
  let complete () =
    let raw = Buffer.contents buffer in
    match find_substring raw "\r\n\r\n" with
    | None -> false
    | Some header_end -> (
        let head = String.sub raw 0 header_end ^ "\r\n" in
        let body_length = String.length raw - header_end - 4 in
        match (header_value head "content-length", header_value head "transfer-encoding") with
        | Some length, _ -> (
            match int_of_string_opt length with Some length -> body_length >= length | None -> false)
        | None, Some "chunked" -> Option.is_some (find_substring raw "\r\n0\r\n\r\n")
        | None, _ -> false)
  in
  let rec loop () =
    if not (complete ()) then
      let count = Unix.read socket chunk 0 (Bytes.length chunk) in
      if count > 0 then (
        Buffer.add_subbytes buffer chunk 0 count;
        loop ())
  in
  loop ();
  Buffer.contents buffer

(* Chunked bodies are "<hex size>\r\n<data>\r\n" repeated, ending at size 0. *)
let decode_chunked body =
  let output = Buffer.create (String.length body) in
  let rec loop position =
    match find_substring (String.sub body position (String.length body - position)) "\r\n" with
    | None -> Error "truncated chunked body"
    | Some line_end -> (
        let size_text = String.sub body position line_end in
        let size_text =
          match String.index_opt size_text ';' with
          | Some semicolon -> String.sub size_text 0 semicolon
          | None -> size_text
        in
        match int_of_string_opt ("0x" ^ String.trim size_text) with
        | None -> Error "bad chunk size"
        | Some 0 -> Ok (Buffer.contents output)
        | Some size ->
            let data_start = position + line_end + 2 in
            if data_start + size > String.length body then Error "truncated chunk"
            else (
              Buffer.add_string output (String.sub body data_start size);
              loop (data_start + size + 2)))
  in
  loop 0

let parse_response raw =
  match find_substring raw "\r\n\r\n" with
  | None -> Error "malformed HTTP response"
  | Some header_end -> (
      let head = String.sub raw 0 header_end in
      let body = String.sub raw (header_end + 4) (String.length raw - header_end - 4) in
      match String.split_on_char '\n' head with
      | [] -> Error "malformed HTTP response"
      | status_line :: header_lines -> (
          let status =
            match String.split_on_char ' ' (String.trim status_line) with
            | _version :: code :: _ -> int_of_string_opt code
            | _ -> None
          in
          let headers =
            List.filter_map
              (fun line ->
                match String.index_opt line ':' with
                | Some colon ->
                    Some
                      ( String.lowercase_ascii (String.trim (String.sub line 0 colon)),
                        String.trim
                          (String.sub line (colon + 1) (String.length line - colon - 1)) )
                | None -> None)
              header_lines
          in
          let chunked =
            match List.assoc_opt "transfer-encoding" headers with
            | Some encoding -> String.lowercase_ascii encoding = "chunked"
            | None -> false
          in
          let body =
            if chunked then decode_chunked body
            else
              match Option.bind (List.assoc_opt "content-length" headers) int_of_string_opt with
              | Some length when length <= String.length body -> Ok (String.sub body 0 length)
              | _ -> Ok body
          in
          match (status, body) with
          | Some status, Ok body -> Ok { status; body }
          | None, _ -> Error "malformed HTTP status line"
          | _, Error message -> Error message))

let request ~meth ~url ?bearer ?body () =
  match parse_url url with
  | Error message -> Error message
  | Ok target -> (
      match connect target with
      | Error message -> Error message
      | Ok socket ->
          let authorization =
            match bearer with
            | Some token -> Printf.sprintf "authorization: Bearer %s\r\n" token
            | None -> ""
          in
          let content =
            match body with
            | Some body ->
                Printf.sprintf "content-type: application/json\r\ncontent-length: %d\r\n" (String.length body)
            | None -> if meth = "GET" || meth = "HEAD" then "" else "content-length: 0\r\n"
          in
          let request =
            Printf.sprintf "%s %s HTTP/1.1\r\nhost: %s:%d\r\n%s%sconnection: close\r\n\r\n%s" meth target.path
              target.host target.port content authorization (Option.value body ~default:"")
          in
          let result =
            match
              write_all socket (Bytes.of_string request) 0;
              read_response socket
            with
            | raw -> parse_response raw
            | exception Unix.Unix_error (error, _, _) ->
                Error (Printf.sprintf "%s: %s" url (Unix.error_message error))
          in
          Unix.close socket;
          result)

let post_json ~url ?bearer body = request ~meth:"POST" ~url ?bearer ~body ()
