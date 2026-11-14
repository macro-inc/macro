(** Test SDK following contract D5. *)

exception Error of { code : string; message : string }

module Json : sig
  type t = Yojson.Safe.t

  val member : string -> t -> t [@@macro.pure]
  val to_list : t -> t list [@@macro.pure]
  val to_number : t -> float [@@macro.pure]
  val to_text : t -> string [@@macro.pure]
end

module Tasks : sig
  val find_similar : title:string -> ?body:string -> unit -> Json.t
  [@@macro.op "storage.task_similarity_search_handler"]

  val create : name:string -> ?markdown:string -> unit -> Json.t
  [@@macro.op "storage.create_task_handler"]
end

module Document : sig
  val content : Json.t -> Json.t [@@macro.op "storage.get_document"]
  val delete : Json.t -> Json.t [@@macro.op "storage.delete_document"]
end
