(* A fake SDK proxy for tests: a forked process that answers each request
   with [respond index request] and records every request as one JSON line
   in a file. Like Bun, it keeps each connection open after replying (and
   serves further requests on it) until the client closes it, so a client
   that reads to end of file instead of Content-Length hangs. *)

type request = { meth : string; target : string; headers : (string * string) list; body : string }
type reply = { status : int; headers : (string * string) list; body : string; chunked : bool }
type t = { pid : int; url : string; log : string }

let reply ?(headers = []) ?(chunked = false) status body = { status; headers; body; chunked }
let json_reply ?(headers = []) ?chunked status value =
  reply ~headers:(("content-type", "application/json") :: headers) ?chunked status (Yojson.Safe.to_string value)

exception Closed

(* Read one request from the connection, or raise [Closed] at end of file
   before one starts. *)
let read_request client buffer =
  let chunk = Bytes.create 4096 in
  let more () =
    let n = Unix.read client chunk 0 (Bytes.length chunk) in
    if n = 0 then raise Closed;
    Buffer.add_subbytes buffer chunk 0 n
  in
  let rec header_end () =
    let text = Buffer.contents buffer in
    let rec find i =
      if i + 4 > String.length text then None else if String.sub text i 4 = "\r\n\r\n" then Some i else find (i + 1)
    in
    match find 0 with
    | Some i -> (text, i)
    | None ->
        more ();
        header_end ()
  in
  let text, split = header_end () in
  let lines = String.split_on_char '\n' (String.sub text 0 split) |> List.map String.trim in
  let headers =
    List.filter_map
      (fun line ->
        match String.index_opt line ':' with
        | Some i ->
            Some
              ( String.lowercase_ascii (String.sub line 0 i),
                String.trim (String.sub line (i + 1) (String.length line - i - 1)) )
        | None -> None)
      (List.tl lines)
  in
  let meth, target =
    match String.split_on_char ' ' (List.hd lines) with m :: target :: _ -> (m, target) | _ -> ("", "")
  in
  let length = Option.fold ~none:0 ~some:int_of_string (List.assoc_opt "content-length" headers) in
  let rec body () =
    if Buffer.length buffer - split - 4 >= length then begin
      let body = Buffer.sub buffer (split + 4) length in
      let rest = Buffer.sub buffer (split + 4 + length) (Buffer.length buffer - split - 4 - length) in
      Buffer.clear buffer;
      Buffer.add_string buffer rest;
      body
    end
    else (
      more ();
      body ())
  in
  let body = body () in
  { meth; target; headers; body }

let request_json (request : request) =
  `Assoc
    [
      ("method", `String request.meth);
      ("target", `String request.target);
      ("headers", `Assoc (List.map (fun (k, v) -> (k, `String v)) request.headers));
      ("body", `String request.body);
    ]

let request_of_json json =
  let open Yojson.Safe.Util in
  {
    meth = member "method" json |> to_string;
    target = member "target" json |> to_string;
    headers = member "headers" json |> to_assoc |> List.map (fun (k, v) -> (k, to_string v));
    body = member "body" json |> to_string;
  }

let write_reply client (reply : reply) =
  let framing, body =
    if reply.chunked then
      (* Two chunks with an extension, then the last chunk and a trailer. *)
      let half = String.length reply.body / 2 in
      let first = String.sub reply.body 0 half and second = String.sub reply.body half (String.length reply.body - half) in
      ( "transfer-encoding: chunked",
        Printf.sprintf "%x;ext=1\r\n%s\r\n%x\r\n%s\r\n0\r\nx-trailer: 1\r\n\r\n" (String.length first) first
          (String.length second) second )
    else (Printf.sprintf "content-length: %d" (String.length reply.body), reply.body)
  in
  let head =
    String.concat "\r\n"
      ((Printf.sprintf "HTTP/1.1 %d X" reply.status :: List.map (fun (k, v) -> k ^ ": " ^ v) reply.headers)
      @ [ framing; ""; "" ])
  in
  let text = head ^ body in
  let rec go offset =
    if offset < String.length text then go (offset + Unix.write_substring client text offset (String.length text - offset))
  in
  go 0

let serve socket log respond =
  let count = ref 0 in
  let rec accept () =
    let client, _ = Unix.accept socket in
    let buffer = Buffer.create 4096 in
    (try
       while true do
         let request = read_request client buffer in
         let channel = open_out_gen [ Open_append; Open_creat ] 0o600 log in
         output_string channel (Yojson.Safe.to_string (request_json request));
         output_char channel '\n';
         close_out channel;
         let reply = respond !count request in
         incr count;
         write_reply client reply
       done
     with Closed | Unix.Unix_error _ -> ());
    Unix.close client;
    accept ()
  in
  accept ()

let start respond =
  let socket = Unix.socket Unix.PF_INET Unix.SOCK_STREAM 0 in
  Unix.setsockopt socket Unix.SO_REUSEADDR true;
  Unix.bind socket (Unix.ADDR_INET (Unix.inet_addr_loopback, 0));
  Unix.listen socket 16;
  let port = match Unix.getsockname socket with Unix.ADDR_INET (_, port) -> port | _ -> assert false in
  let log = Filename.temp_file "fake_proxy" ".jsonl" in
  match Unix.fork () with
  | 0 -> ( try serve socket log respond with _ -> Unix._exit 1)
  | pid ->
      Unix.close socket;
      { pid; url = Printf.sprintf "http://127.0.0.1:%d" port; log }

(* Stop the server and return the requests it recorded. *)
let stop proxy =
  Unix.kill proxy.pid Sys.sigkill;
  ignore (Unix.waitpid [] proxy.pid);
  let channel = open_in proxy.log in
  let rec lines acc =
    match input_line channel with
    | line -> lines (request_of_json (Yojson.Safe.from_string line) :: acc)
    | exception End_of_file -> List.rev acc
  in
  let requests = lines [] in
  close_in channel;
  Sys.remove proxy.log;
  requests
