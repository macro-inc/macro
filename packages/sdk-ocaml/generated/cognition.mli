(* Generated from packages/sdk/specs/cognition.json by packages/sdk-ocaml/gen. Do not edit. *)

(** Ordered from least to most access top -> bottom *)
type nonrec access_level =
  | View
  | Comment
  | Edit
  | Owner
  | Unknown of string  (** A value this SDK version does not know. *)

val access_level_of_yojson : Yojson.Safe.t -> access_level
val yojson_of_access_level : access_level -> Yojson.Safe.t

(** Fixed calendar granularity, always in UTC, with Monday-start weeks. *)
type nonrec granularity =
  | Day
  | Week
  | Month
  | Summary
  | Unknown of string  (** A value this SDK version does not know. *)

val granularity_of_yojson : Yojson.Safe.t -> granularity
val yojson_of_granularity : granularity -> Yojson.Safe.t

type nonrec activity = {
  content : string;
  granularity : granularity;
  period_end : string;
  period_start : string;
}
(** A privacy-reviewed activity report; period_end is inclusive. *)

val activity_of_yojson : Yojson.Safe.t -> activity
val yojson_of_activity : activity -> Yojson.Safe.t

val make_activity :
  content:string ->
  granularity:granularity ->
  period_end:string ->
  period_start:string ->
  unit ->
  activity
(** A privacy-reviewed activity report; period_end is inclusive. *)

type nonrec activity_error_body = { error : string  (** Error description. *) }
(** Error body for activity reads. *)

val activity_error_body_of_yojson : Yojson.Safe.t -> activity_error_body
val yojson_of_activity_error_body : activity_error_body -> Yojson.Safe.t

val make_activity_error_body : error:string -> unit -> activity_error_body
(** Error body for activity reads. *)

type nonrec activity_reports = { reports : activity list }
(** Activity reports for one user, ordered by period. *)

val activity_reports_of_yojson : Yojson.Safe.t -> activity_reports
val yojson_of_activity_reports : activity_reports -> Yojson.Safe.t

val make_activity_reports : reports:activity list -> unit -> activity_reports
(** Activity reports for one user, ordered by period. *)

type nonrec add_server_request = {
  server_name : string;  (** Human-readable name for the server. *)
  url : string;  (** The MCP server's streamable HTTP URL. *)
}
(** Request body for adding a new MCP server. *)

val add_server_request_of_yojson : Yojson.Safe.t -> add_server_request
val yojson_of_add_server_request : add_server_request -> Yojson.Safe.t

val make_add_server_request :
  server_name:string -> url:string -> unit -> add_server_request
(** Request body for adding a new MCP server. *)

(** Everything we use AI for. The wire / DB form of each variant is its
[snake_case] name. *)
type nonrec ai_feature =
  | Chat
  | Memory
  | Automation
  | Dynamic_completions_api
  | Chat_rename
  | Call_summary
  | Channel_bot
  | Ai_projection
  | Ai_editing
  | Import
  | Agent_session
  | Agent_repository_choice
  | Agent_mode_choice
  | Agent_activity_summary
  | Dictation
  | Image_generation
  | Email_focus
  | Web_search
  | Non_billable_agent_session
  | Unknown of string  (** A value this SDK version does not know. *)

val ai_feature_of_yojson : Yojson.Safe.t -> ai_feature
val yojson_of_ai_feature : ai_feature -> Yojson.Safe.t

(** A structured part within an assistant message.

When the model responds with tool calls the full turn is persisted as a
flat sequence of these parts.  \[[crate::convert::to_rig_messages]\]
reconstructs the turn boundaries that providers expect. *)
type nonrec assistant_message_part =
  | Text of { text : string  (** The text content. *) }
      (** Plain text produced by the model. *)
  | Tool_call of {
      id : string;  (** Provider-assigned call id. *)
      json : Yojson.Safe.t;  (** Tool arguments as JSON. *)
      name : string;  (** Tool name. *)
    }  (** A native tool call issued by the model. *)
  | Mcp_tool_call of {
      display_name : string option;  (** Optional human-readable name. *)
      id : string;  (** Provider-assigned call id. *)
      json : Yojson.Safe.t;  (** Tool arguments as JSON. *)
      name : string;  (** Tool name. *)
      service : string;  (** MCP service identifier. *)
    }  (** A tool call routed through an MCP service. *)
  | Tool_call_response_json of {
      id : string;  (** Corresponding call id. *)
      json : Yojson.Safe.t;  (** Response payload. *)
      name : string;  (** Tool name. *)
    }  (** A JSON response from a tool call. *)
  | Tool_call_err of {
      description : string;  (** Human-readable error description. *)
      id : string;  (** Corresponding call id. *)
      name : string;  (** Tool name. *)
    }  (** An error response from a tool call. *)
  | Thinking of { thinking : string  (** The thinking text content. *) }
      (** A thinking/reasoning block from the model. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val assistant_message_part_of_yojson : Yojson.Safe.t -> assistant_message_part
val yojson_of_assistant_message_part : assistant_message_part -> Yojson.Safe.t

val make_assistant_message_part_text :
  text:string -> unit -> assistant_message_part
(** Plain text produced by the model. *)

val make_assistant_message_part_tool_call :
  id:string ->
  json:Yojson.Safe.t ->
  name:string ->
  unit ->
  assistant_message_part
(** A native tool call issued by the model. *)

val make_assistant_message_part_mcp_tool_call :
  ?display_name:string ->
  id:string ->
  json:Yojson.Safe.t ->
  name:string ->
  service:string ->
  unit ->
  assistant_message_part
(** A tool call routed through an MCP service. *)

val make_assistant_message_part_tool_call_response_json :
  id:string ->
  json:Yojson.Safe.t ->
  name:string ->
  unit ->
  assistant_message_part
(** A JSON response from a tool call. *)

val make_assistant_message_part_tool_call_err :
  description:string ->
  id:string ->
  name:string ->
  unit ->
  assistant_message_part
(** An error response from a tool call. *)

val make_assistant_message_part_thinking :
  thinking:string -> unit -> assistant_message_part
(** A thinking/reasoning block from the model. *)

(** Generates a FileType enum and associated ContentType enum with their implementations.

This macro takes a list of tuples in the format:
(Variant, "extension", "mime_type", CONTENT_TYPE_VARIANT)

For each tuple it generates:
- A variant in the FileType enum
- A variant in the ContentType enum
- Implementations for:
  - FileType::to_str() - Converts FileType to extension string
  - FileType::from_str() - Converts extension string to FileType
  - From<FileType> for ContentType - Maps FileType to ContentType
  - ContentType::mime_type() - Gets MIME type for ContentType *)
type nonrec file_type =
  | Docx
  | Pdf
  | Md
  | Spreadsheet
  | Canvas
  | Coffee
  | Cson
  | Iced
  | C
  | I
  | Cpp
  | Cppm
  | Cc
  | Ccm
  | Cxx
  | Cxxm
  | Cplusplus
  | Cplusplusm
  | Hpp
  | Hh
  | Hxx
  | Hplusplus
  | H
  | Ii
  | Ino
  | Inl
  | Ipp
  | Ixx
  | Tpp
  | Txx
  | Hppin
  | Hin
  | Cu
  | Cuh
  | Cs
  | Csx
  | Cake
  | Css
  | Dart
  | Diff
  | Patch
  | Rej
  | Dockerfile
  | Containerfile
  | Go
  | Handlebars
  | Hbs
  | Hjs
  | Hlsl
  | Hlsli
  | Fx
  | Fxh
  | Vsh
  | Psh
  | Cginc
  | Compute
  | Html
  | Htm
  | Shtml
  | Xhtml
  | Xht
  | Mdoc
  | Jsp
  | Asp
  | Aspx
  | Jshtm
  | Volt
  | Ejs
  | Rhtml
  | Ini
  | Conf
  | Properties
  | Cfg
  | Directory
  | Gitattributes
  | Gitconfig
  | Gitmodules
  | Editorconfig
  | Repo
  | Java
  | Jav
  | Jsx
  | Js
  | Es6
  | Mjs
  | Cjs
  | Pac
  | Json
  | Bowerrc
  | Jscsrc
  | Webmanifest
  | Jsmap
  | Cssmap
  | Tsmap
  | Har
  | Jslintrc
  | Jsonld
  | Geojson
  | Ipynb
  | Vuerc
  | Jsonc
  | Eslintrc
  | Eslintrcjson
  | Jsfmtrc
  | Jshintrc
  | Swcrc
  | Hintrc
  | Babelrc
  | Jsonl
  | Ndjson
  | Codesnippets
  | Jl
  | Jmd
  | Sty
  | Cls
  | Bbx
  | Cbx
  | Tex
  | Ltx
  | Ctx
  | Bib
  | Less
  | Log
  | Lua
  | Mak
  | Mk
  | Mkd
  | Mdwn
  | Mdown
  | Markdown
  | Markdn
  | Mdtxt
  | Mdtext
  | Workbook
  | M
  | Mm
  | Pl
  | Pm
  | Pod
  | T
  | Psgi
  | Raku
  | Rakumod
  | Rakutest
  | Rakudoc
  | Nqp
  | P6
  | Pl6
  | Pm6
  | Php
  | Php4
  | Php5
  | Phtml
  | Ctp
  | Ps1
  | Psm1
  | Psd1
  | Pssc
  | Psrc
  | Py
  | Rpy
  | Pyw
  | Cpy
  | Gyp
  | Gypi
  | Pyi
  | Ipy
  | Pyt
  | R
  | Rhistory
  | Rprofile
  | Rt
  | Cshtml
  | Razor
  | Rb
  | Rbx
  | Rjs
  | Gemspec
  | Rake
  | Ru
  | Erb
  | Podspec
  | Rbi
  | Rs
  | Scss
  | Sass
  | Shader
  | Sh
  | Bash
  | Bashrc
  | Bashaliases
  | Bashprofile
  | Bashlogin
  | Ebuild
  | Eclass
  | Profile
  | Bashlogout
  | Xprofile
  | Xsession
  | Xsessionrc
  | Zsh
  | Zshrc
  | Zprofile
  | Zlogin
  | Zlogout
  | Zshenv
  | Zshtheme
  | Fish
  | Ksh
  | Csh
  | Cshrc
  | Tcshrc
  | Yashrc
  | Yashprofile
  | Sql
  | Dsql
  | Swift
  | Ts
  | Cts
  | Mts
  | Tsx
  | Tsbuildinfo
  | Xml
  | Xsd
  | Ascx
  | Atom
  | Axml
  | Axaml
  | Bpmn
  | Cpt
  | Csl
  | Csproj
  | Csprojuser
  | Dita
  | Ditamap
  | Dtd
  | Ent
  | Mod
  | Dtml
  | Fsproj
  | Fxml
  | Iml
  | Isml
  | Jmx
  | Launch
  | Menu
  | Mxml
  | Nuspec
  | Opml
  | Owl
  | Proj
  | Props
  | Pt
  | Publishsettings
  | Pubxml
  | Pubxmluser
  | Rbxlx
  | Rbxmx
  | Rdf
  | Rng
  | Rss
  | Shproj
  | Storyboard
  | Targets
  | Tld
  | Tmx
  | Vbproj
  | Vbprojuser
  | Vcxproj
  | Vcxprojfilters
  | Wsdl
  | Wxi
  | Wxl
  | Wxs
  | Xaml
  | Xbl
  | Xib
  | Xlf
  | Xliff
  | Xpdl
  | Xul
  | Xoml
  | Xsl
  | Xslt
  | Yaml
  | Yml
  | Eyaml
  | Eyml
  | Cff
  | Yamltmlanguage
  | Yamltmpreferences
  | Yamltmtheme
  | Winget
  | Txt
  | Csv
  | Tsv
  | Jpeg
  | Jpg
  | Png
  | Gif
  | Svg
  | Webp
  | Avif
  | Bmp
  | Ico
  | Tiff
  | Tif
  | Heic
  | Heif
  | Tar
  | Targz
  | Tgz
  | Gz
  | Bz2
  | Tarbz2
  | Tbz2
  | Z
  | Tarz
  | Lz
  | Tarlz
  | Xz
  | Tarxz
  | Txz
  | Lzma
  | Tarlzma
  | Rar
  | Sevenz
  | Zst
  | Tarzst
  | Tzst
  | Zip
  | Exe
  | Msi
  | Dll
  | Bat
  | Cmd
  | Com
  | Appimage
  | App
  | Bin
  | Deb
  | Rpm
  | Apk
  | Dmg
  | Pkg
  | Crx
  | Xpi
  | Mp3
  | Wav
  | Ogg
  | Flac
  | Aac
  | M4a
  | Wma
  | Mid
  | Midi
  | Mp4
  | Mkv
  | Webm
  | Avi
  | Mov
  | Wmv
  | Mpg
  | Mpeg
  | M4v
  | Flv
  | F4v
  | Threegp
  | Ttf
  | Otf
  | Woff
  | Woff2
  | Eot
  | Rtf
  | Odt
  | Ods
  | Odp
  | Odg
  | Odf
  | Epub
  | Mobi
  | Azw
  | Azw3
  | Djvu
  | Xls
  | Xlsm
  | Ppt
  | Doc
  | Pptx
  | Xlsx
  | Db
  | Sqlite
  | Sqlite3
  | Mdb
  | Accdb
  | Dbf
  | Plist
  | Toml
  | Env
  | Dot
  | Gv
  | Torrent
  | Ics
  | Vcf
  | Ai
  | Eps
  | Ps
  | Dxf
  | Dwg
  | Fig
  | Psd
  | Psb
  | Stl
  | Obj
  | Fbx
  | Blend
  | Dae
  | Threeds
  | Gltf
  | Glb
  | Vhd
  | Vhdx
  | Vmdk
  | Ova
  | Ovf
  | Iso
  | Img
  | Swf
  | Unknown of string  (** A value this SDK version does not know. *)

val file_type_of_yojson : Yojson.Safe.t -> file_type
val yojson_of_file_type : file_type -> Yojson.Safe.t

type nonrec channel_type =
  | Public
  | Private
  | Direct_message
  | Team
  | Unknown of string  (** A value this SDK version does not know. *)

val channel_type_of_yojson : Yojson.Safe.t -> channel_type
val yojson_of_channel_type : channel_type -> Yojson.Safe.t

type nonrec attachment_metadata =
  | Document of {
      document_name : string;  (** Name of the document *)
      document_type : file_type;
          (** Type of the document \['pdf' | 'docx' | 'md'\] *)
    }
  | Project of { project_name : string }
  | Image of {
      image_extension : file_type;  (** jpg | png | etc *)
      image_name : string;  (** image name *)
    }
  | Channel of { channel_name : string; channel_type : channel_type }
  | Email of { email_subject : string }  (** an email thread *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val attachment_metadata_of_yojson : Yojson.Safe.t -> attachment_metadata
val yojson_of_attachment_metadata : attachment_metadata -> Yojson.Safe.t

val make_attachment_metadata_document :
  document_name:string -> document_type:file_type -> unit -> attachment_metadata

val make_attachment_metadata_project :
  project_name:string -> unit -> attachment_metadata

val make_attachment_metadata_image :
  image_extension:file_type -> image_name:string -> unit -> attachment_metadata

val make_attachment_metadata_channel :
  channel_name:string ->
  channel_type:channel_type ->
  unit ->
  attachment_metadata

val make_attachment_metadata_email :
  email_subject:string -> unit -> attachment_metadata
(** an email thread *)

type nonrec attachment_type =
  | Document
  | Image
  | Channel
  | Email
  | Project
  | Skill
  | Unknown of string  (** A value this SDK version does not know. *)

val attachment_type_of_yojson : Yojson.Safe.t -> attachment_type
val yojson_of_attachment_type : attachment_type -> Yojson.Safe.t

type nonrec call_tool_request = {
  args : Yojson.Safe.t option;
      (** Optional updated arguments. Uses original args if omitted. *)
  message_id : string;  (** The message ID containing the tool call. *)
  tool_call_id : string;  (** The tool call ID to execute. *)
}
(** Request body for executing a pending tool call. *)

val call_tool_request_of_yojson : Yojson.Safe.t -> call_tool_request
val yojson_of_call_tool_request : call_tool_request -> Yojson.Safe.t

val make_call_tool_request :
  ?args:Yojson.Safe.t ->
  message_id:string ->
  tool_call_id:string ->
  unit ->
  call_tool_request
(** Request body for executing a pending tool call. *)

type nonrec call_tool_response = {
  result : Yojson.Safe.t;  (** The tool execution result. *)
}
(** Response body for a successful tool call. *)

val call_tool_response_of_yojson : Yojson.Safe.t -> call_tool_response
val yojson_of_call_tool_response : call_tool_response -> Yojson.Safe.t

val make_call_tool_response : result:Yojson.Safe.t -> unit -> call_tool_response
(** Response body for a successful tool call. *)

type nonrec channel_share_permission = {
  access_level : access_level;  (** The access level for the channel *)
  channel_id : string;  (** The channel id *)
}
(** The channel share permission *)

val channel_share_permission_of_yojson :
  Yojson.Safe.t -> channel_share_permission

val yojson_of_channel_share_permission :
  channel_share_permission -> Yojson.Safe.t

val make_channel_share_permission :
  access_level:access_level ->
  channel_id:string ->
  unit ->
  channel_share_permission
(** The channel share permission *)

type nonrec chat = {
  created_at : string option;  (** The time the chat was created *)
  deleted_at : string option;  (** The time the chat was deleted *)
  id : string;  (** The chat uuid *)
  is_persistent : bool;
  model : string option;  (** The model used to generate the chat *)
  name : string;  (** The name of the chat *)
  project_id : string option;  (** The project id of the chat *)
  token_count : int64 option;
  updated_at : string option;  (** The time the chat was last updated *)
  user_id : string;  (** Who the chat belongs to *)
}

val chat_of_yojson : Yojson.Safe.t -> chat
val yojson_of_chat : chat -> Yojson.Safe.t

val make_chat :
  ?created_at:string ->
  ?deleted_at:string ->
  id:string ->
  is_persistent:bool ->
  ?model:string ->
  name:string ->
  ?project_id:string ->
  ?token_count:int64 ->
  ?updated_at:string ->
  user_id:string ->
  unit ->
  chat

type nonrec chat_attachment = {
  attachment_id : string;
      (** The id of the attachment
either a [document_id] or [project_id] or [chat_id] *)
  attachment_type : attachment_type;  (** The type of attachment *)
  chat_id : string option;
      (** The id of the chat if the attachment is a chat *)
  id : string;  (** db attachment id - unused *)
  message_id : string option;
      (** The id of the message if the attachment is a message *)
}

val chat_attachment_of_yojson : Yojson.Safe.t -> chat_attachment
val yojson_of_chat_attachment : chat_attachment -> Yojson.Safe.t

val make_chat_attachment :
  attachment_id:string ->
  attachment_type:attachment_type ->
  ?chat_id:string ->
  id:string ->
  ?message_id:string ->
  unit ->
  chat_attachment

type nonrec message_with_attachments = {
  attachment_ids : string list;
  content : string;
  date : string;
}

val message_with_attachments_of_yojson :
  Yojson.Safe.t -> message_with_attachments

val yojson_of_message_with_attachments :
  message_with_attachments -> Yojson.Safe.t

val make_message_with_attachments :
  attachment_ids:string list ->
  content:string ->
  date:string ->
  unit ->
  message_with_attachments

type nonrec conversation_record = {
  chat_id : string;
  messages : message_with_attachments list;
  title : string;
}

val conversation_record_of_yojson : Yojson.Safe.t -> conversation_record
val yojson_of_conversation_record : conversation_record -> Yojson.Safe.t

val make_conversation_record :
  chat_id:string ->
  messages:message_with_attachments list ->
  title:string ->
  unit ->
  conversation_record

type nonrec chat_history = { conversation : conversation_record list }

val chat_history_of_yojson : Yojson.Safe.t -> chat_history
val yojson_of_chat_history : chat_history -> Yojson.Safe.t

val make_chat_history :
  conversation:conversation_record list -> unit -> chat_history

type nonrec chat_history_batch_messages_request = { message_ids : string list }

val chat_history_batch_messages_request_of_yojson :
  Yojson.Safe.t -> chat_history_batch_messages_request

val yojson_of_chat_history_batch_messages_request :
  chat_history_batch_messages_request -> Yojson.Safe.t

val make_chat_history_batch_messages_request :
  message_ids:string list -> unit -> chat_history_batch_messages_request

(** The content of a \[[ChatMessage]\].

For user and system messages the content is plain \[[Text]\](Self::Text).
For assistant messages it may additionally be a sequence of
\[[AssistantMessagePart]\]s that encode tool-call round trips. *)
type nonrec chat_message_content =
  | String of string  (** Plain text content. *)
  | List of assistant_message_part list
      (** Structured assistant message parts. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val chat_message_content_of_yojson : Yojson.Safe.t -> chat_message_content
val yojson_of_chat_message_content : chat_message_content -> Yojson.Safe.t

(** The role of a message participant. *)
type nonrec role =
  | User
  | Assistant
  | System
  | Unknown of string  (** A value this SDK version does not know. *)

val role_of_yojson : Yojson.Safe.t -> role
val yojson_of_role : role -> Yojson.Safe.t

type nonrec chat_message = {
  content : chat_message_content;  (** Message content *)
  id : string;  (** The chat message id *)
  model : string option;  (** the model used to generate the message *)
  role : role;  (** Whether the chat is from the user or system *)
}

val chat_message_of_yojson : Yojson.Safe.t -> chat_message
val yojson_of_chat_message : chat_message -> Yojson.Safe.t

val make_chat_message :
  content:chat_message_content ->
  id:string ->
  ?model:string ->
  role:role ->
  unit ->
  chat_message

type nonrec chat_message_error = {
  code : string option;
      (** Stable machine-readable code for admission errors (402 or 503). *)
  error : string;
  stream_id : string option;
}
(** Error response for chat message endpoints *)

val chat_message_error_of_yojson : Yojson.Safe.t -> chat_message_error
val yojson_of_chat_message_error : chat_message_error -> Yojson.Safe.t

val make_chat_message_error :
  ?code:string ->
  error:string ->
  ?stream_id:string ->
  unit ->
  chat_message_error
(** Error response for chat message endpoints *)

(** The type of an entity in Macro *)
type nonrec entity_type =
  | User
  | Chat
  | Channel
  | Channel_message
  | Document
  | Project
  | Email_thread
  | Calendar_event
  | Team
  | Call
  | Foreign_entity
  | Static_file
  | Crm_company
  | Crm_contact
  | Crm_pipeline
  | Reminder
  | Harness
  | Skill
  | Agent_session
  | Scheduled_action
  | Initiative
  | Database
  | Database_row
  | Form
  | External_chat
  | Unknown of string  (** A value this SDK version does not know. *)

val entity_type_of_yojson : Yojson.Safe.t -> entity_type
val yojson_of_entity_type : entity_type -> Yojson.Safe.t

type nonrec entity = {
  entity_id : string;  (** The id of that entity *)
  entity_type : entity_type;  (** The type of entity we are describing *)
}
(** The Entity describes the minimum amount of information required to describe a unique thing in Macro
This contains the type of the entity \[EntityType\] and the string id of that entity *)

val entity_of_yojson : Yojson.Safe.t -> entity
val yojson_of_entity : entity -> Yojson.Safe.t

val make_entity : entity_id:string -> entity_type:entity_type -> unit -> entity
(** The Entity describes the minimum amount of information required to describe a unique thing in Macro
This contains the type of the entity \[EntityType\] and the string id of that entity *)

type nonrec chat_message_with_attachments = {
  attachments : entity list;
      (** The ids of the attachments used to generate the message *)
  content : chat_message_content;  (** Message content *)
  id : string;  (** The chat message id *)
  role : role;  (** Whether the chat is from the user or system *)
}

val chat_message_with_attachments_of_yojson :
  Yojson.Safe.t -> chat_message_with_attachments

val yojson_of_chat_message_with_attachments :
  chat_message_with_attachments -> Yojson.Safe.t

val make_chat_message_with_attachments :
  attachments:entity list ->
  content:chat_message_content ->
  id:string ->
  role:role ->
  unit ->
  chat_message_with_attachments

type nonrec chat_preview_data = {
  chat_id : string;
  chat_name : string;
  owner : string;
  updated_at : string option;
}

val chat_preview_data_of_yojson : Yojson.Safe.t -> chat_preview_data
val yojson_of_chat_preview_data : chat_preview_data -> Yojson.Safe.t

val make_chat_preview_data :
  chat_id:string ->
  chat_name:string ->
  owner:string ->
  ?updated_at:string ->
  unit ->
  chat_preview_data

type nonrec with_chat_id = { chat_id : string }

val with_chat_id_of_yojson : Yojson.Safe.t -> with_chat_id
val yojson_of_with_chat_id : with_chat_id -> Yojson.Safe.t
val make_with_chat_id : chat_id:string -> unit -> with_chat_id

type nonrec chat_preview =
  | Access of chat_preview_data
  | No_access of with_chat_id
  | Does_not_exist of with_chat_id
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val chat_preview_of_yojson : Yojson.Safe.t -> chat_preview
val yojson_of_chat_preview : chat_preview -> Yojson.Safe.t

type nonrec chat_response = {
  created_at : string option;  (** The time the chat was created. *)
  id : string;  (** The chat uuid. *)
  messages : chat_message_with_attachments list;
      (** The messages in the chat. *)
  model : string option;
      (** The model used to generate the chat ([provider/model] id). *)
  name : string;  (** The name of the chat. *)
  project_id : string option;  (** The project id the chat belongs to. *)
  updated_at : string option;  (** The time the chat was last updated. *)
  user_id : string;  (** Who the chat belongs to. *)
}
(** The full chat response, matching the DCS API response shape. *)

val chat_response_of_yojson : Yojson.Safe.t -> chat_response
val yojson_of_chat_response : chat_response -> Yojson.Safe.t

val make_chat_response :
  ?created_at:string ->
  id:string ->
  messages:chat_message_with_attachments list ->
  ?model:string ->
  name:string ->
  ?project_id:string ->
  ?updated_at:string ->
  user_id:string ->
  unit ->
  chat_response
(** The full chat response, matching the DCS API response shape. *)

type nonrec chat_stream_error_type =
  | Error_
  | Unknown of string  (** A value this SDK version does not know. *)

val chat_stream_error_type_of_yojson : Yojson.Safe.t -> chat_stream_error_type
val yojson_of_chat_stream_error_type : chat_stream_error_type -> Yojson.Safe.t

type nonrec stream_error =
  | Provider_error of { model : string; stream_id : string }
  | Model_context_overflow of { stream_id : string }
  | Internal_error of { stream_id : string }
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val stream_error_of_yojson : Yojson.Safe.t -> stream_error
val yojson_of_stream_error : stream_error -> Yojson.Safe.t

val make_stream_error_provider_error :
  model:string -> stream_id:string -> unit -> stream_error

val make_stream_error_model_context_overflow :
  stream_id:string -> unit -> stream_error

val make_stream_error_internal_error : stream_id:string -> unit -> stream_error

type nonrec chat_stream =
  | Error_ of { stream_error : stream_error  (** Misc error *) }
      (** Misc error *)
  | Chat_user_message of {
      attachments : entity list;
      chat_id : string;
      content : string;
      message_id : string;
      stream_id : string;
    }
      (** The user message that initiated this stream, sent as the first item
so other clients can add it to their local chat state. *)
  | Chat_message_response of {
      chat_id : string;
      content : assistant_message_part;
      message_id : string;
      stream_id : string;
    }
      (** Indicates a response from the chat completion API for a given message *)
  | Stream_end of { stream_id : string }
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val chat_stream_of_yojson : Yojson.Safe.t -> chat_stream
val yojson_of_chat_stream : chat_stream -> Yojson.Safe.t

val make_chat_stream_error_ : stream_error:stream_error -> unit -> chat_stream
(** Misc error *)

val make_chat_stream_chat_user_message :
  attachments:entity list ->
  chat_id:string ->
  content:string ->
  message_id:string ->
  stream_id:string ->
  unit ->
  chat_stream
(** The user message that initiated this stream, sent as the first item
so other clients can add it to their local chat state. *)

val make_chat_stream_chat_message_response :
  chat_id:string ->
  content:assistant_message_part ->
  message_id:string ->
  stream_id:string ->
  unit ->
  chat_stream
(** Indicates a response from the chat completion API for a given message *)

val make_chat_stream_stream_end : stream_id:string -> unit -> chat_stream

type nonrec complete_onboarding_request = {
  skipped : bool option;  (** Whether the user skipped rather than finished. *)
}
(** Body for completing onboarding. *)

val complete_onboarding_request_of_yojson :
  Yojson.Safe.t -> complete_onboarding_request

val yojson_of_complete_onboarding_request :
  complete_onboarding_request -> Yojson.Safe.t

val make_complete_onboarding_request :
  ?skipped:bool -> unit -> complete_onboarding_request
(** Body for completing onboarding. *)

(** How much a model may think before it gives a structured answer. *)
type nonrec completion_thinking =
  | Default
  | Low
  | Unknown of string  (** A value this SDK version does not know. *)

val completion_thinking_of_yojson : Yojson.Safe.t -> completion_thinking
val yojson_of_completion_thinking : completion_thinking -> Yojson.Safe.t

type nonrec price = {
  price_per_audio_minute : float option;
      (** Price per audio minute (USD), absent for token and credit billing. *)
  price_per_million_cache_read : float option;
      (** Price per million cache-read input tokens (USD), absent when the model
has no published rate and for audio and credit billing. *)
  price_per_million_cache_write : float option;
      (** Price per million cache-write input tokens (USD), absent when the model
has no published rate and for audio and credit billing. *)
  price_per_million_in : float;
      (** Price per million input tokens (USD); zero for audio and credit billing. *)
  price_per_million_out : float;
      (** Price per million output tokens (USD); zero for audio and credit billing. *)
  price_per_provider_credit : float option;
      (** Price per vendor credit (USD), absent for token and audio billing. *)
  total : float;  (** Total cost (USD). *)
}
(** Rates applied to an invocation and its resolved dollar cost. *)

val price_of_yojson : Yojson.Safe.t -> price
val yojson_of_price : price -> Yojson.Safe.t

val make_price :
  ?price_per_audio_minute:float ->
  ?price_per_million_cache_read:float ->
  ?price_per_million_cache_write:float ->
  price_per_million_in:float ->
  price_per_million_out:float ->
  ?price_per_provider_credit:float ->
  total:float ->
  unit ->
  price
(** Rates applied to an invocation and its resolved dollar cost. *)

type nonrec usage = {
  audio_seconds : float option;
      (** Audio duration in seconds, absent for token and credit billing. *)
  cache_read_input_tokens : int64;
      (** Input tokens read from a prompt cache; zero for audio and credit billing. *)
  cache_write_input_tokens : int64;
      (** Input tokens written to a prompt cache; zero for audio and credit billing. *)
  created_at : string;  (** Recording timestamp. *)
  input_tokens : int64;
      (** Uncached input tokens; zero for audio and credit billing. *)
  model : string;  (** Provider model identifier. *)
  output_tokens : int64;
      (** Output tokens; zero for audio and credit billing. *)
  price : price option;
  provider_credits : int64 option;
      (** Vendor credits consumed, absent for token and audio billing. *)
}
(** Measured usage for one invocation. *)

val usage_of_yojson : Yojson.Safe.t -> usage
val yojson_of_usage : usage -> Yojson.Safe.t

val make_usage :
  ?audio_seconds:float ->
  cache_read_input_tokens:int64 ->
  cache_write_input_tokens:int64 ->
  created_at:string ->
  input_tokens:int64 ->
  model:string ->
  output_tokens:int64 ->
  ?price:price ->
  ?provider_credits:int64 ->
  unit ->
  usage
(** Measured usage for one invocation. *)

type nonrec macro_user_id_str = string

val macro_user_id_str_of_yojson : Yojson.Safe.t -> macro_user_id_str
val yojson_of_macro_user_id_str : macro_user_id_str -> Yojson.Safe.t

type nonrec completion_usage = {
  cost : usage;  (** Measured usage and resolved cost. *)
  entity : string option;  (** Related entity, if any. *)
  feature : ai_feature;  (** Feature that performed the invocation. *)
  user : macro_user_id_str;  (** User the invocation was performed for. *)
}
(** User and feature attribution for one invocation. *)

val completion_usage_of_yojson : Yojson.Safe.t -> completion_usage
val yojson_of_completion_usage : completion_usage -> Yojson.Safe.t

val make_completion_usage :
  cost:usage ->
  ?entity:string ->
  feature:ai_feature ->
  user:macro_user_id_str ->
  unit ->
  completion_usage
(** User and feature attribution for one invocation. *)

type nonrec connected_server = {
  authenticated : bool;  (** Whether the user has completed OAuth against it. *)
  name : string;  (** The server's display name. *)
  url : string;  (** The server URL. *)
}
(** One of the user's MCP server connections, as the setup page sees it. *)

val connected_server_of_yojson : Yojson.Safe.t -> connected_server
val yojson_of_connected_server : connected_server -> Yojson.Safe.t

val make_connected_server :
  authenticated:bool -> name:string -> url:string -> unit -> connected_server
(** One of the user's MCP server connections, as the setup page sees it. *)

type nonrec create_chat_request = {
  name : string option;  (** Optional name for the chat. *)
  project_id : string option;
      (** Optional project to associate the chat with. *)
}
(** Request body for creating a chat. *)

val create_chat_request_of_yojson : Yojson.Safe.t -> create_chat_request
val yojson_of_create_chat_request : create_chat_request -> Yojson.Safe.t

val make_create_chat_request :
  ?name:string -> ?project_id:string -> unit -> create_chat_request
(** Request body for creating a chat. *)

(** What a successful tool call committed to the user's databases. *)
type nonrec database_change =
  | None_
  | Schema  (** Databases, tables, columns or saved views. *)
  | Rows of { count : int64 }
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val database_change_of_yojson : Yojson.Safe.t -> database_change
val yojson_of_database_change : database_change -> Yojson.Safe.t
val make_database_change_rows : count:int64 -> unit -> database_change

type nonrec database_query_chart = {
  color : string option;
  stack : bool;
  title : string;
  x : string;
  y : string list;
}
(** Chart fields name the proposal's result columns exactly. *)

val database_query_chart_of_yojson : Yojson.Safe.t -> database_query_chart
val yojson_of_database_query_chart : database_query_chart -> Yojson.Safe.t

val make_database_query_chart :
  ?color:string ->
  stack:bool ->
  title:string ->
  x:string ->
  y:string list ->
  unit ->
  database_query_chart
(** Chart fields name the proposal's result columns exactly. *)

(** Supported live-answer presentations. *)
type nonrec database_query_display_mode =
  | Scalar
  | Table
  | Bar
  | Line
  | Area
  | Scatter
  | Pie
  | Unknown of string  (** A value this SDK version does not know. *)

val database_query_display_mode_of_yojson :
  Yojson.Safe.t -> database_query_display_mode

val yojson_of_database_query_display_mode :
  database_query_display_mode -> Yojson.Safe.t

type nonrec database_query_answer = {
  answerable : bool;
  chart : database_query_chart option;
  database_id : string option;
  display_mode : database_query_display_mode;
  explanation : string;
  sql : string;
  title : string;
}
(** A proposal, never stored results or permission to read the named database. *)

val database_query_answer_of_yojson : Yojson.Safe.t -> database_query_answer
val yojson_of_database_query_answer : database_query_answer -> Yojson.Safe.t

val make_database_query_answer :
  answerable:bool ->
  ?chart:database_query_chart ->
  ?database_id:string ->
  display_mode:database_query_display_mode ->
  explanation:string ->
  sql:string ->
  title:string ->
  unit ->
  database_query_answer
(** A proposal, never stored results or permission to read the named database. *)

type nonrec database_query_request = {
  error : string option;
      (** The SQL engine's error from one failed proposal, used for a bounded repair. *)
  model : string;
  prompt : string;
  schema : Yojson.Safe.t;
  sql : string;
}
(** The question and untrusted schema hints; authorization remains in the read services. *)

val database_query_request_of_yojson : Yojson.Safe.t -> database_query_request
val yojson_of_database_query_request : database_query_request -> Yojson.Safe.t

val make_database_query_request :
  ?error:string ->
  model:string ->
  prompt:string ->
  schema:Yojson.Safe.t ->
  sql:string ->
  unit ->
  database_query_request
(** The question and untrusted schema hints; authorization remains in the read services. *)

type nonrec decision_error_body = {
  code : string;  (** Stable failure code. *)
  error : string;
      (** Human-readable explanation without provider credentials or diagnostics. *)
}
(** Sanitized, machine-readable failure of a decision request. *)

val decision_error_body_of_yojson : Yojson.Safe.t -> decision_error_body
val yojson_of_decision_error_body : decision_error_body -> Yojson.Safe.t

val make_decision_error_body :
  code:string -> error:string -> unit -> decision_error_body
(** Sanitized, machine-readable failure of a decision request. *)

type nonrec decision_request = {
  input : Yojson.Safe.t;
      (** Data to classify. The entire compact request must fit in 64 KiB. *)
  questions : (string * string) list;
      (** One to 32 questions, each at most 500 characters. Keys must be nonblank
and at most 80 UTF-8 bytes; they are preserved in the response. *)
}
(** Named yes/no questions to evaluate against one arbitrary JSON input. *)

val decision_request_of_yojson : Yojson.Safe.t -> decision_request
val yojson_of_decision_request : decision_request -> Yojson.Safe.t

val make_decision_request :
  input:Yojson.Safe.t ->
  questions:(string * string) list ->
  unit ->
  decision_request
(** Named yes/no questions to evaluate against one arbitrary JSON input. *)

type nonrec decision_response = {
  probabilities : (string * float) list;
      (** Probabilities between zero and one, inclusive; not boolean decisions. *)
}
(** The probability of yes for every requested question, under its original key. *)

val decision_response_of_yojson : Yojson.Safe.t -> decision_response
val yojson_of_decision_response : decision_response -> Yojson.Safe.t

val make_decision_response :
  probabilities:(string * float) list -> unit -> decision_response
(** The probability of yes for every requested question, under its original key. *)

type nonrec dismissed_prompts = {
  dismissed : string list;  (** Dismissed prompt ids, oldest dismissal first. *)
}
(** The prompts the user dismissed, on any device. *)

val dismissed_prompts_of_yojson : Yojson.Safe.t -> dismissed_prompts
val yojson_of_dismissed_prompts : dismissed_prompts -> Yojson.Safe.t

val make_dismissed_prompts : dismissed:string list -> unit -> dismissed_prompts
(** The prompts the user dismissed, on any device. *)

type nonrec document_cognition_service_api_version =
  | V1
  | V2
  | Unknown of string  (** A value this SDK version does not know. *)

val document_cognition_service_api_version_of_yojson :
  Yojson.Safe.t -> document_cognition_service_api_version

val yojson_of_document_cognition_service_api_version :
  document_cognition_service_api_version -> Yojson.Safe.t

type nonrec user_pdf_rect = {
  height : float;
  left : float;
  page_index : int;
  top : float;
  width : float;
}
(** UserPdfRect is in UserSpace
(0,0) top left
percent page units
1-based page index *)

val user_pdf_rect_of_yojson : Yojson.Safe.t -> user_pdf_rect
val yojson_of_user_pdf_rect : user_pdf_rect -> Yojson.Safe.t

val make_user_pdf_rect :
  height:float ->
  left:float ->
  page_index:int ->
  top:float ->
  width:float ->
  unit ->
  user_pdf_rect
(** UserPdfRect is in UserSpace
(0,0) top left
percent page units
1-based page index *)

type nonrec document_reference =
  | Pdf of user_pdf_rect
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val document_reference_of_yojson : Yojson.Safe.t -> document_reference
val yojson_of_document_reference : document_reference -> Yojson.Safe.t

type nonrec document_text_part = {
  document_id : string;
  id : string;
  reference : document_reference;
}

val document_text_part_of_yojson : Yojson.Safe.t -> document_text_part
val yojson_of_document_text_part : document_text_part -> Yojson.Safe.t

val make_document_text_part :
  document_id:string ->
  id:string ->
  reference:document_reference ->
  unit ->
  document_text_part

type nonrec dynamic_schema = {
  description : string option;
      (** Optional description of what the schema represents. *)
  name : string;  (** Name of the schema. *)
  schema : Yojson.Safe.t;  (** The JSON schema to validate against. *)
}
(** Schema definition for dynamic structured completions. *)

val dynamic_schema_of_yojson : Yojson.Safe.t -> dynamic_schema
val yojson_of_dynamic_schema : dynamic_schema -> Yojson.Safe.t

val make_dynamic_schema :
  ?description:string ->
  name:string ->
  schema:Yojson.Safe.t ->
  unit ->
  dynamic_schema
(** Schema definition for dynamic structured completions. *)

type nonrec error_body = {
  error : string;  (** Human-readable error description. *)
}
(** Error response body. *)

val error_body_of_yojson : Yojson.Safe.t -> error_body
val yojson_of_error_body : error_body -> Yojson.Safe.t

val make_error_body : error:string -> unit -> error_body
(** Error response body. *)

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

(** How long a projection remains active without being requested. *)
type nonrec expiry =
  | Day
  | Week
  | Month
  | Unknown of string  (** A value this SDK version does not know. *)

val expiry_of_yojson : Yojson.Safe.t -> expiry
val yojson_of_expiry : expiry -> Yojson.Safe.t

type nonrec explicit_memory = { content : string; revision : int64 }
(** A private explicit memory document and its optimistic concurrency token. *)

val explicit_memory_of_yojson : Yojson.Safe.t -> explicit_memory
val yojson_of_explicit_memory : explicit_memory -> Yojson.Safe.t

val make_explicit_memory :
  content:string -> revision:int64 -> unit -> explicit_memory
(** A private explicit memory document and its optimistic concurrency token. *)

type nonrec feature_usage = {
  entries : completion_usage list;  (** Recorded invocations. *)
  feature : ai_feature;  (** Feature attribution. *)
  total : float;  (** Total cost (USD). *)
}
(** Recorded invocations and total for one feature. *)

val feature_usage_of_yojson : Yojson.Safe.t -> feature_usage
val yojson_of_feature_usage : feature_usage -> Yojson.Safe.t

val make_feature_usage :
  entries:completion_usage list ->
  feature:ai_feature ->
  total:float ->
  unit ->
  feature_usage
(** Recorded invocations and total for one feature. *)

(** A [provider/model] id every user may request without professional features. *)
type nonrec free_tier_model =
  | Google_gemini_3_8_flash
  | Unknown of string  (** A value this SDK version does not know. *)

val free_tier_model_of_yojson : Yojson.Safe.t -> free_tier_model
val yojson_of_free_tier_model : free_tier_model -> Yojson.Safe.t

(** Shape of the generated image. *)
type nonrec generate_image_aspect_ratio =
  | Square
  | Landscape
  | Portrait
  | Widescreen
  | Tall
  | Unknown of string  (** A value this SDK version does not know. *)

val generate_image_aspect_ratio_of_yojson :
  Yojson.Safe.t -> generate_image_aspect_ratio

val yojson_of_generate_image_aspect_ratio :
  generate_image_aspect_ratio -> Yojson.Safe.t

type nonrec generate_image_error_body = {
  code : string;  (** Stable failure code. *)
  error : string;  (** Explanation without provider or storage diagnostics. *)
}
(** Sanitized, machine-readable failure of an image request. *)

val generate_image_error_body_of_yojson :
  Yojson.Safe.t -> generate_image_error_body

val yojson_of_generate_image_error_body :
  generate_image_error_body -> Yojson.Safe.t

val make_generate_image_error_body :
  code:string -> error:string -> unit -> generate_image_error_body
(** Sanitized, machine-readable failure of an image request. *)

(** A reference image already stored in Macro. *)
type nonrec generate_image_reference =
  | Document of { id : string  (** The Macro document ID. *) }
      (** An image document the caller can view. *)
  | Static_file of { id : string  (** The static file ID. *) }
      (** An uploaded or previously generated static file. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val generate_image_reference_of_yojson :
  Yojson.Safe.t -> generate_image_reference

val yojson_of_generate_image_reference :
  generate_image_reference -> Yojson.Safe.t

val make_generate_image_reference_document :
  id:string -> unit -> generate_image_reference
(** An image document the caller can view. *)

val make_generate_image_reference_static_file :
  id:string -> unit -> generate_image_reference
(** An uploaded or previously generated static file. *)

type nonrec generate_image_request = {
  aspect_ratio : generate_image_aspect_ratio option;
  prompt : string;
      (** Description of the image: subject, style, composition, colours, and any text to render. *)
  reference_images : generate_image_reference list option;
      (** Up to three reference images, in the order the prompt refers to them. *)
}
(** What image to generate. *)

val generate_image_request_of_yojson : Yojson.Safe.t -> generate_image_request
val yojson_of_generate_image_request : generate_image_request -> Yojson.Safe.t

val make_generate_image_request :
  ?aspect_ratio:generate_image_aspect_ratio ->
  prompt:string ->
  ?reference_images:generate_image_reference list ->
  unit ->
  generate_image_request
(** What image to generate. *)

type nonrec generate_image_response = {
  height : int;  (** Intrinsic pixel height. *)
  mime_type : string;  (** IANA media type of the image, e.g. [image/png]. *)
  note : string option;
      (** Commentary the model produced alongside the image, when any. *)
  size_bytes : int64;  (** Size of the image in bytes. *)
  static_file_id : string;
      (** Static file ID, reusable as a reference image or a message attachment. *)
  url : string;  (** Permanent URL of the image. *)
  width : int;  (** Intrinsic pixel width. *)
}
(** The stored generated image. *)

val generate_image_response_of_yojson : Yojson.Safe.t -> generate_image_response
val yojson_of_generate_image_response : generate_image_response -> Yojson.Safe.t

val make_generate_image_response :
  height:int ->
  mime_type:string ->
  ?note:string ->
  size_bytes:int64 ->
  static_file_id:string ->
  url:string ->
  width:int ->
  unit ->
  generate_image_response
(** The stored generated image. *)

type nonrec generic_error_response = {
  error : bool;  (** Indicates if an error occurred *)
  message : string;  (** Message to explain failure *)
}

val generic_error_response_of_yojson : Yojson.Safe.t -> generic_error_response
val yojson_of_generic_error_response : generic_error_response -> Yojson.Safe.t

val make_generic_error_response :
  error:bool -> message:string -> unit -> generic_error_response

type nonrec get_batch_preview_request = { chat_ids : string list }

val get_batch_preview_request_of_yojson :
  Yojson.Safe.t -> get_batch_preview_request

val yojson_of_get_batch_preview_request :
  get_batch_preview_request -> Yojson.Safe.t

val make_get_batch_preview_request :
  chat_ids:string list -> unit -> get_batch_preview_request

type nonrec get_batch_preview_response = { previews : chat_preview list }

val get_batch_preview_response_of_yojson :
  Yojson.Safe.t -> get_batch_preview_response

val yojson_of_get_batch_preview_response :
  get_batch_preview_response -> Yojson.Safe.t

val make_get_batch_preview_response :
  previews:chat_preview list -> unit -> get_batch_preview_response

(** Defines who can access an item through its share link. *)
type nonrec link_share =
  | Public
  | Team
  | Unknown of string  (** A value this SDK version does not know. *)

val link_share_of_yojson : Yojson.Safe.t -> link_share
val yojson_of_link_share : link_share -> Yojson.Safe.t

type nonrec share_permission_v2 = {
  channel_share_permissions : channel_share_permission list option;
      (** The channel share permissions for the item *)
  id : string;  (** The share permission id *)
  link_share : link_share option;
  link_share_access_level : access_level option;
  owner : string;  (** The owner of the item *)
  team_share_access_level : access_level option;
}

val share_permission_v2_of_yojson : Yojson.Safe.t -> share_permission_v2
val yojson_of_share_permission_v2 : share_permission_v2 -> Yojson.Safe.t

val make_share_permission_v2 :
  ?channel_share_permissions:channel_share_permission list ->
  id:string ->
  ?link_share:link_share ->
  ?link_share_access_level:access_level ->
  owner:string ->
  ?team_share_access_level:access_level ->
  unit ->
  share_permission_v2

type nonrec get_chat_permissions_response = {
  permissions : share_permission_v2;  (** The share permissions for the chat. *)
}
(** Response body for get chat permissions. *)

val get_chat_permissions_response_of_yojson :
  Yojson.Safe.t -> get_chat_permissions_response

val yojson_of_get_chat_permissions_response :
  get_chat_permissions_response -> Yojson.Safe.t

val make_get_chat_permissions_response :
  permissions:share_permission_v2 -> unit -> get_chat_permissions_response
(** Response body for get chat permissions. *)

type nonrec get_chat_response = {
  chat : chat_response;  (** The full chat data. *)
  user_access_level : access_level;
      (** The requesting user's access level on this chat. *)
}
(** Wrapper response for get_chat, matching the DCS API response shape. *)

val get_chat_response_of_yojson : Yojson.Safe.t -> get_chat_response
val yojson_of_get_chat_response : get_chat_response -> Yojson.Safe.t

val make_get_chat_response :
  chat:chat_response ->
  user_access_level:access_level ->
  unit ->
  get_chat_response
(** Wrapper response for get_chat, matching the DCS API response shape. *)

type nonrec get_chats_for_attachment_response = {
  all_chats : chat list;
  recent_chat : chat option;
}

val get_chats_for_attachment_response_of_yojson :
  Yojson.Safe.t -> get_chats_for_attachment_response

val yojson_of_get_chats_for_attachment_response :
  get_chats_for_attachment_response -> Yojson.Safe.t

val make_get_chats_for_attachment_response :
  all_chats:chat list ->
  ?recent_chat:chat ->
  unit ->
  get_chats_for_attachment_response

(** The requested inference speed. Standard is backward compatible with old clients. *)
type nonrec model_speed =
  | Standard
  | Fast
  | Ultrafast
  | Unknown of string  (** A value this SDK version does not know. *)

val model_speed_of_yojson : Yojson.Safe.t -> model_speed
val yojson_of_model_speed : model_speed -> Yojson.Safe.t

type nonrec tool_set =
  | All
  | None_
  | Databases
  | Databases_read_only
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val tool_set_of_yojson : Yojson.Safe.t -> tool_set
val yojson_of_tool_set : tool_set -> Yojson.Safe.t

type nonrec http_send_chat_message_request = {
  additional_instructions : string option;
      (** Additional system instructions appended to the base system prompt *)
  attachments : entity list option;  (** Attachments for the message *)
  chat_id : string option;
      (** Id of the chat the message belongs to (optional - if not provided, a new chat is created) *)
  content : string;  (** The content of the message *)
  model : string;  (** The model to respond with ([provider/model] id) *)
  speed : model_speed option;
      (** Inference speed, validated against the selected model. Defaults to standard. *)
  toolset : tool_set option;  (** Which toolset to use. Defaults to [all] *)
}
(** HTTP request payload for sending a chat message.
Unlike the WebSocket payload, this does not include stream_id as it's generated server-side. *)

val http_send_chat_message_request_of_yojson :
  Yojson.Safe.t -> http_send_chat_message_request

val yojson_of_http_send_chat_message_request :
  http_send_chat_message_request -> Yojson.Safe.t

val make_http_send_chat_message_request :
  ?additional_instructions:string ->
  ?attachments:entity list ->
  ?chat_id:string ->
  content:string ->
  model:string ->
  ?speed:model_speed ->
  ?toolset:tool_set ->
  unit ->
  http_send_chat_message_request
(** HTTP request payload for sending a chat message.
Unlike the WebSocket payload, this does not include stream_id as it's generated server-side. *)

(** Where an import entity was first staged from. Provenance only — never a
visibility filter. *)
type nonrec initiator =
  | Onboarding
  | Chat
  | Archive
  | Manual
  | Unknown of string  (** A value this SDK version does not know. *)

val initiator_of_yojson : Yojson.Safe.t -> initiator
val yojson_of_initiator : initiator -> Yojson.Safe.t

(** What an imported item is in its source system. Each source has its own
kinds; a Notion database and a Notion page, or a Linear project and a
Linear issue, are tracked and deduplicated separately. *)
type nonrec import_kind =
  | Issue
  | Project
  | Document
  | Page
  | Database
  | Data_source
  | Row
  | Jira_issue
  | Jira_project
  | Jira_epic
  | Channel
  | Unknown of string  (** A value this SDK version does not know. *)

val import_kind_of_yojson : Yojson.Safe.t -> import_kind
val yojson_of_import_kind : import_kind -> Yojson.Safe.t

(** External systems items can be imported from. *)
type nonrec import_source =
  | Linear
  | Jira
  | Notion
  | Slack
  | Unknown of string  (** A value this SDK version does not know. *)

val import_source_of_yojson : Yojson.Safe.t -> import_source
val yojson_of_import_source : import_source -> Yojson.Safe.t

(** Lifecycle of one import entity. *)
type nonrec import_status =
  | Staged
  | Importing
  | Imported
  | Discarded
  | Unknown of string  (** A value this SDK version does not know. *)

val import_status_of_yojson : Yojson.Safe.t -> import_status
val yojson_of_import_status : import_status -> Yojson.Safe.t

type nonrec import_entity = {
  created_at : string;  (** When the row was first staged. *)
  entity_id : string option;  (** The Macro entity it became, once imported. *)
  entity_type : string option;
      (** The Macro entity type ([task] | [md] | [channel]), once imported. *)
  foreign_id : string;
      (** Stable id in the source system (see
\[[ImportSource::normalize_foreign_id]\]). *)
  id : string;  (** Ledger row id. *)
  initiator : initiator;  (** Where it was first staged from. *)
  kind : import_kind;  (** What the item is in its source system. *)
  last_error : string option;
      (** Failure detail from the last import attempt, when one failed. *)
  metadata : Yojson.Safe.t;
      (** Per-source metadata (shape depends on [source]; see
\[[LinearIssueMeta]\], \[[NotionDocMeta]\], \[[SlackChannelMeta]\]). *)
  parent_id : string option;
      (** The import row this item was imported under (a subpage's parent page,
a row's database), when it was imported as part of a tree. *)
  review_id : string option;
      (** The agent session review that approved importing this item, when it
came from one. *)
  source : import_source;  (** The external system the item comes from. *)
  status : import_status;  (** Where the row is in its lifecycle. *)
  team_id : string option;
      (** The team the created entity was shared with, when it was. *)
  updated_at : string;  (** When the row last changed. *)
  user_id : string;
      (** The user who staged/imported it. Team-imported rows from teammates
are visible with their owner's id, so clients can say "created by a
teammate". *)
  waiting_on : string option;
      (** The teammate's row this one waits on: that teammate is writing the
same object for the team, and this row links to their copy once it
is imported. *)
}
(** One row of the import ledger. *)

val import_entity_of_yojson : Yojson.Safe.t -> import_entity
val yojson_of_import_entity : import_entity -> Yojson.Safe.t

val make_import_entity :
  created_at:string ->
  ?entity_id:string ->
  ?entity_type:string ->
  foreign_id:string ->
  id:string ->
  initiator:initiator ->
  kind:import_kind ->
  ?last_error:string ->
  metadata:Yojson.Safe.t ->
  ?parent_id:string ->
  ?review_id:string ->
  source:import_source ->
  status:import_status ->
  ?team_id:string ->
  updated_at:string ->
  user_id:string ->
  ?waiting_on:string ->
  unit ->
  import_entity
(** One row of the import ledger. *)

type nonrec import_entities_response = {
  entities : import_entity list;
      (** The caller's own rows and their team's imported rows, newest first. *)
}
(** The caller's ledger rows. *)

val import_entities_response_of_yojson :
  Yojson.Safe.t -> import_entities_response

val yojson_of_import_entities_response :
  import_entities_response -> Yojson.Safe.t

val make_import_entities_response :
  entities:import_entity list -> unit -> import_entities_response
(** The caller's ledger rows. *)

type nonrec import_notion_page_request = {
  page : string;  (** The Notion page URL or 32-character page id. *)
}
(** Body for importing one Notion page. *)

val import_notion_page_request_of_yojson :
  Yojson.Safe.t -> import_notion_page_request

val yojson_of_import_notion_page_request :
  import_notion_page_request -> Yojson.Safe.t

val make_import_notion_page_request :
  page:string -> unit -> import_notion_page_request
(** Body for importing one Notion page. *)

(** What importing one Notion page did. *)
type nonrec import_notion_page_result =
  | Imported
  | Already_imported
  | Already_imported_by_teammate
  | Previously_declined
  | Import_in_progress
  | Unknown of string  (** A value this SDK version does not know. *)

val import_notion_page_result_of_yojson :
  Yojson.Safe.t -> import_notion_page_result

val yojson_of_import_notion_page_result :
  import_notion_page_result -> Yojson.Safe.t

type nonrec import_notion_page_response = {
  entity : import_entity;
      (** The row behind the outcome; [entity_id] is the document once imported. *)
  outcome : import_notion_page_result;  (** What happened. *)
}
(** The outcome of importing a Notion page, with its ledger row. *)

val import_notion_page_response_of_yojson :
  Yojson.Safe.t -> import_notion_page_response

val yojson_of_import_notion_page_response :
  import_notion_page_response -> Yojson.Safe.t

val make_import_notion_page_response :
  entity:import_entity ->
  outcome:import_notion_page_result ->
  unit ->
  import_notion_page_response
(** The outcome of importing a Notion page, with its ledger row. *)

type nonrec scan_counts = {
  data_sources : int;  (** Data sources (database tables) found. *)
  pages : int;  (** Pages found. *)
}
(** What a planning run has found in the source so far. *)

val scan_counts_of_yojson : Yojson.Safe.t -> scan_counts
val yojson_of_scan_counts : scan_counts -> Yojson.Safe.t

val make_scan_counts : data_sources:int -> pages:int -> unit -> scan_counts
(** What a planning run has found in the source so far. *)

(** Lifecycle of a discovery run (one per user × source). *)
type nonrec run_status =
  | Running
  | Ready
  | Importing
  | Completed
  | Failed
  | Dismissed
  | Unknown of string  (** A value this SDK version does not know. *)

val run_status_of_yojson : Yojson.Safe.t -> run_status
val yojson_of_run_status : run_status -> Yojson.Safe.t

type nonrec import_run = {
  error : string option;  (** Discovery failure detail, when the run failed. *)
  review_id : string option;
      (** The review presenting the run's plan, once one does. A Notion plan is
presented while it is still [running]; rows staged after that take it. *)
  scanned : scan_counts option;
  source : import_source;  (** The source this run discovered from. *)
  status : run_status;  (** Where the run is in its lifecycle. *)
  updated_at : string;  (** When the run state last changed. *)
}
(** Discovery-run state for one user × source. *)

val import_run_of_yojson : Yojson.Safe.t -> import_run
val yojson_of_import_run : import_run -> Yojson.Safe.t

val make_import_run :
  ?error:string ->
  ?review_id:string ->
  ?scanned:scan_counts ->
  source:import_source ->
  status:run_status ->
  updated_at:string ->
  unit ->
  import_run
(** Discovery-run state for one user × source. *)

type nonrec import_state = {
  entities : import_entity list;  (** Visible import entities, newest first. *)
  runs : import_run list;
      (** Discovery runs, one per source that ever ran discovery. *)
}
(** The full import aggregate for a user: discovery runs plus visible ledger
rows (their own, and teammates' team-imported rows). *)

val import_state_of_yojson : Yojson.Safe.t -> import_state
val yojson_of_import_state : import_state -> Yojson.Safe.t

val make_import_state :
  entities:import_entity list -> runs:import_run list -> unit -> import_state
(** The full import aggregate for a user: discovery runs plus visible ledger
rows (their own, and teammates' team-imported rows). *)

type nonrec jwt_payload = { token : string }

val jwt_payload_of_yojson : Yojson.Safe.t -> jwt_payload
val yojson_of_jwt_payload : jwt_payload -> Yojson.Safe.t
val make_jwt_payload : token:string -> unit -> jwt_payload

type nonrec linear_issue_meta = {
  assignee : string option;  (** Assignee display name as Linear reports it. *)
  assignee_email : string option;
      (** Assignee email, when Linear exposes it. *)
  description : string option;  (** Short markdown description. *)
  due_date : string option;
      (** Due date as an ISO date ([YYYY-MM-DD]), when set. *)
  identifier : string option;
      (** Linear's human identifier (e.g. [ENG-142]). *)
  priority : string option;  (** Priority label (e.g. [Urgent]). *)
  status : string option;  (** Workflow status name (e.g. [In Progress]). *)
  title : string;  (** Issue title. *)
  url : string option;  (** Deep link back to the issue in Linear. *)
}
(** Metadata for one staged Linear issue. *)

val linear_issue_meta_of_yojson : Yojson.Safe.t -> linear_issue_meta
val yojson_of_linear_issue_meta : linear_issue_meta -> Yojson.Safe.t

val make_linear_issue_meta :
  ?assignee:string ->
  ?assignee_email:string ->
  ?description:string ->
  ?due_date:string ->
  ?identifier:string ->
  ?priority:string ->
  ?status:string ->
  title:string ->
  ?url:string ->
  unit ->
  linear_issue_meta
(** Metadata for one staged Linear issue. *)

(** An edit to one one-based line. A revision is required to prevent replay
or concurrent edits from inserting twice or deleting a different line. *)
type nonrec memory_edit =
  | Insert of { content : string; line : int }
  | Replace of { content : string; line : int }
  | Delete of { line : int }
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val memory_edit_of_yojson : Yojson.Safe.t -> memory_edit
val yojson_of_memory_edit : memory_edit -> Yojson.Safe.t
val make_memory_edit_insert : content:string -> line:int -> unit -> memory_edit
val make_memory_edit_replace : content:string -> line:int -> unit -> memory_edit
val make_memory_edit_delete : line:int -> unit -> memory_edit

type nonrec memory_error_body = { error : string  (** Error description. *) }

val memory_error_body_of_yojson : Yojson.Safe.t -> memory_error_body
val yojson_of_memory_error_body : memory_error_body -> Yojson.Safe.t
val make_memory_error_body : error:string -> unit -> memory_error_body

type nonrec memory_response = {
  memory : string;  (** The generated memory text. *)
}
(** The user's latest memory. *)

val memory_response_of_yojson : Yojson.Safe.t -> memory_response
val yojson_of_memory_response : memory_response -> Yojson.Safe.t

val make_memory_response : memory:string -> unit -> memory_response
(** The user's latest memory. *)

type nonrec new_attachment = {
  attachment_id : string;
  attachment_type : attachment_type;
}

val new_attachment_of_yojson : Yojson.Safe.t -> new_attachment
val yojson_of_new_attachment : new_attachment -> Yojson.Safe.t

val make_new_attachment :
  attachment_id:string ->
  attachment_type:attachment_type ->
  unit ->
  new_attachment

type nonrec new_chat_message = {
  attachments : new_attachment list option;
      (** The ids of the attachments used to generate the message *)
  content : chat_message_content;  (** Content of the message *)
  created_at : string;
  id : string option;
      (** Optional pre-generated ID. If None, the database generates one. *)
  model : string;  (** The model used to generate the chat (provider api id) *)
  role : role;  (** Whether the chat is from the user or system *)
  updated_at : string;
}

val new_chat_message_of_yojson : Yojson.Safe.t -> new_chat_message
val yojson_of_new_chat_message : new_chat_message -> Yojson.Safe.t

val make_new_chat_message :
  ?attachments:new_attachment list ->
  content:chat_message_content ->
  created_at:string ->
  ?id:string ->
  model:string ->
  role:role ->
  updated_at:string ->
  unit ->
  new_chat_message

type nonrec new_message_attachment = {
  attachment_id : string;
  attachment_type : attachment_type;
  message_id : string;
}

val new_message_attachment_of_yojson : Yojson.Safe.t -> new_message_attachment
val yojson_of_new_message_attachment : new_message_attachment -> Yojson.Safe.t

val make_new_message_attachment :
  attachment_id:string ->
  attachment_type:attachment_type ->
  message_id:string ->
  unit ->
  new_message_attachment

type nonrec notion_already_imported = {
  by : string;  (** The teammate who imported it, by email. *)
  entity_id : string;  (** The Macro entity it became. *)
  entity_type : string;  (** That entity's type ([md], [project]). *)
}
(** A teammate's copy of a Notion object, shared with the user's team. *)

val notion_already_imported_of_yojson : Yojson.Safe.t -> notion_already_imported
val yojson_of_notion_already_imported : notion_already_imported -> Yojson.Safe.t

val make_notion_already_imported :
  by:string ->
  entity_id:string ->
  entity_type:string ->
  unit ->
  notion_already_imported
(** A teammate's copy of a Notion object, shared with the user's team. *)

(** What a workspace import does with one Notion object. *)
type nonrec notion_decision =
  | Copy
  | Tasks
  | Skip
  | Hand
  | Unknown of string  (** A value this SDK version does not know. *)

val notion_decision_of_yojson : Yojson.Safe.t -> notion_decision
val yojson_of_notion_decision : notion_decision -> Yojson.Safe.t

type nonrec notion_task_fields = {
  assignee : string option;  (** The assignee column. *)
  due : string option;  (** The due date column. *)
  priority : string option;  (** The priority column. *)
  status : string option;  (** The status column. *)
}
(** Which Notion columns hold a task list's task fields, by property name. *)

val notion_task_fields_of_yojson : Yojson.Safe.t -> notion_task_fields
val yojson_of_notion_task_fields : notion_task_fields -> Yojson.Safe.t

val make_notion_task_fields :
  ?assignee:string ->
  ?due:string ->
  ?priority:string ->
  ?status:string ->
  unit ->
  notion_task_fields
(** Which Notion columns hold a task list's task fields, by property name. *)

type nonrec notion_plan_item = {
  already_imported : notion_already_imported option;
  decision : notion_decision option;
  path : string list option;
      (** Titles of the pages above it, outermost first. *)
  reason : string option;
      (** Why, in a short sentence, when the decision model gave one. *)
  rows : int option;  (** For a data source: rows counted while planning. *)
  sample_titles : string list option;
      (** For a data source: the titles of a few of its rows. *)
  shareable : bool option;
      (** Whether the user may change [shared]: false for users without a team. *)
  shared : bool option;
      (** Whether what it becomes is shared with the user's team. *)
  shared_reason : string option;
      (** Why it is (or is not) shared, when the decision model chose or the
import could not share it. *)
  task_fields : notion_task_fields option;
}
(** One object's place in a workspace import plan. *)

val notion_plan_item_of_yojson : Yojson.Safe.t -> notion_plan_item
val yojson_of_notion_plan_item : notion_plan_item -> Yojson.Safe.t

val make_notion_plan_item :
  ?already_imported:notion_already_imported ->
  ?decision:notion_decision ->
  ?path:string list ->
  ?reason:string ->
  ?rows:int ->
  ?sample_titles:string list ->
  ?shareable:bool ->
  ?shared:bool ->
  ?shared_reason:string ->
  ?task_fields:notion_task_fields ->
  unit ->
  notion_plan_item
(** One object's place in a workspace import plan. *)

type nonrec notion_doc_meta = {
  plan : notion_plan_item option;
  summary : string option;  (** One-line summary of what the page contains. *)
  title : string;  (** Page title. *)
  url : string option;  (** Deep link back to the page in Notion. *)
}
(** Metadata for one staged Notion page. Deliberately has NO content field:
page bodies are fetched at import time, for accepted pages only. *)

val notion_doc_meta_of_yojson : Yojson.Safe.t -> notion_doc_meta
val yojson_of_notion_doc_meta : notion_doc_meta -> Yojson.Safe.t

val make_notion_doc_meta :
  ?plan:notion_plan_item ->
  ?summary:string ->
  title:string ->
  ?url:string ->
  unit ->
  notion_doc_meta
(** Metadata for one staged Notion page. Deliberately has NO content field:
page bodies are fetched at import time, for accepted pages only. *)

type nonrec notion_importer = {
  by : string;  (** The teammate, by email. *)
  count : int;  (** How many of the plan's objects they imported. *)
}
(** A teammate who already imported some of a plan's objects. *)

val notion_importer_of_yojson : Yojson.Safe.t -> notion_importer
val yojson_of_notion_importer : notion_importer -> Yojson.Safe.t

val make_notion_importer : by:string -> count:int -> unit -> notion_importer
(** A teammate who already imported some of a plan's objects. *)

type nonrec notion_report_item = {
  import_id : string;  (** The ledger row. *)
  kind : import_kind;  (** What the object is. *)
  reason : string option;
      (** Why it is called out: the decision model's reason, or the failure. *)
  title : string;  (** The object's title. *)
  url : string option;  (** Its Notion URL. *)
}
(** One object a workspace import report calls out. *)

val notion_report_item_of_yojson : Yojson.Safe.t -> notion_report_item
val yojson_of_notion_report_item : notion_report_item -> Yojson.Safe.t

val make_notion_report_item :
  import_id:string ->
  kind:import_kind ->
  ?reason:string ->
  title:string ->
  ?url:string ->
  unit ->
  notion_report_item
(** One object a workspace import report calls out. *)

type nonrec notion_import_report = {
  already_imported_by : notion_importer list option;
      (** Who imported the objects already in Macro, most first. *)
  already_in_macro : int option;
      (** Plan objects a teammate already imported and shared with the team;
they link to that copy and are not counted as copies. *)
  copy : int;  (** Objects to copy as they are. *)
  data_sources : int;  (** Data sources (database tables) in the plan. *)
  database_rows : int;
      (** Rows those databases hold, every one counted while planning. *)
  databases : int;  (** Data sources written as databases. *)
  deciding : int option;
      (** Plan objects the decision model has not answered for yet, while
planning is still [running]. *)
  documents : int;  (** Pages written as documents. *)
  error : string option;  (** Why the run failed, when it did. *)
  failures : notion_report_item list option;
      (** Objects that failed to import, with the failure. *)
  hand : int;  (** Objects that need handling by hand. *)
  hand_items : notion_report_item list option;
      (** Objects that need handling by hand, with reasons. *)
  imported : int;  (** Plan objects already imported. *)
  issues : int option;  (** Tracker issues in the plan. *)
  on_team : bool option;
      (** Whether the user is on a team. Without one, everything the import
writes stays visible only to them. *)
  pages : int;  (** Pages in the plan. *)
  projects : int option;  (** Tracker groups written as Macro projects. *)
  review_id : string option;
      (** The review the plan is tied to, once presented. *)
  scanned : scan_counts option;
  shared_with_team : int option;
      (** Written plan objects shared with the user's team. *)
  skip : int;  (** Objects left in Notion. *)
  status : run_status option;
  task_rows : int;  (** Tasks the task lists become, one per row. *)
  tasks : int;  (** Data sources whose rows become tasks. *)
  waiting : int;  (** Plan objects still waiting to be written. *)
  waiting_on_teammates : int option;
      (** Plan objects waiting for a teammate who is writing the same object
for the team; they link to the teammate's copy once it is written. *)
  warnings : string list option;
      (** Provider items skipped because they were unreadable, or optional features unavailable. *)
  writing : int;  (** Plan objects being written now. *)
}
(** Where a Notion workspace import stands. *)

val notion_import_report_of_yojson : Yojson.Safe.t -> notion_import_report
val yojson_of_notion_import_report : notion_import_report -> Yojson.Safe.t

val make_notion_import_report :
  ?already_imported_by:notion_importer list ->
  ?already_in_macro:int ->
  copy:int ->
  data_sources:int ->
  database_rows:int ->
  databases:int ->
  ?deciding:int ->
  documents:int ->
  ?error:string ->
  ?failures:notion_report_item list ->
  hand:int ->
  ?hand_items:notion_report_item list ->
  imported:int ->
  ?issues:int ->
  ?on_team:bool ->
  pages:int ->
  ?projects:int ->
  ?review_id:string ->
  ?scanned:scan_counts ->
  ?shared_with_team:int ->
  skip:int ->
  ?status:run_status ->
  task_rows:int ->
  tasks:int ->
  waiting:int ->
  ?waiting_on_teammates:int ->
  ?warnings:string list ->
  writing:int ->
  unit ->
  notion_import_report
(** Where a Notion workspace import stands. *)

(** Lifecycle of the onboarding flow itself. *)
type nonrec onboarding_status =
  | Active
  | Completed
  | Unknown of string  (** A value this SDK version does not know. *)

val onboarding_status_of_yojson : Yojson.Safe.t -> onboarding_status
val yojson_of_onboarding_status : onboarding_status -> Yojson.Safe.t

type nonrec onboarding_row = {
  completed_at : string option;  (** When the flow completed, if it has. *)
  skipped : bool;  (** Whether the user skipped rather than finished. *)
  started_at : string;  (** When the flow was first touched. *)
  status : onboarding_status;  (** Where the flow is in its lifecycle. *)
}
(** One user's onboarding row. *)

val onboarding_row_of_yojson : Yojson.Safe.t -> onboarding_row
val yojson_of_onboarding_row : onboarding_row -> Yojson.Safe.t

val make_onboarding_row :
  ?completed_at:string ->
  skipped:bool ->
  started_at:string ->
  status:onboarding_status ->
  unit ->
  onboarding_row
(** One user's onboarding row. *)

type nonrec onboarding_state = {
  connected_servers : connected_server list;
      (** The user's MCP server connections. *)
  row : onboarding_row;  (** The user's onboarding row. *)
  suggested_team_domain : string option;
      (** The account email's domain when it can back a domain team — i.e. it
is not a generic consumer provider — [None] otherwise. Judged with
the same list the teams service uses for domain auto-join and
claiming, so the client never suggests a domain team the server
would refuse. *)
}
(** The onboarding aggregate served to the setup page. Import runs and
staged entities are served separately by [GET /import/state]. *)

val onboarding_state_of_yojson : Yojson.Safe.t -> onboarding_state
val yojson_of_onboarding_state : onboarding_state -> Yojson.Safe.t

val make_onboarding_state :
  connected_servers:connected_server list ->
  row:onboarding_row ->
  ?suggested_team_domain:string ->
  unit ->
  onboarding_state
(** The onboarding aggregate served to the setup page. Import runs and
staged entities are served separately by [GET /import/state]. *)

type nonrec update_operation =
  | Add
  | Remove
  | Replace
  | Unknown of string  (** A value this SDK version does not know. *)

val update_operation_of_yojson : Yojson.Safe.t -> update_operation
val yojson_of_update_operation : update_operation -> Yojson.Safe.t

type nonrec update_channel_share_permission = {
  access_level : access_level option;
  channel_id : string;  (** The channel id *)
  operation : update_operation;
      (** The type of operation to be performed on the chanel share permission
You can add, remove or replace and existing permission *)
}

val update_channel_share_permission_of_yojson :
  Yojson.Safe.t -> update_channel_share_permission

val yojson_of_update_channel_share_permission :
  update_channel_share_permission -> Yojson.Safe.t

val make_update_channel_share_permission :
  ?access_level:access_level ->
  channel_id:string ->
  operation:update_operation ->
  unit ->
  update_channel_share_permission

type nonrec update_share_permission_request_v2 = {
  channel_share_permissions : update_channel_share_permission list option;
      (** Any channel share permissions to be created/updated/removed *)
  link_share : link_share option;
  link_share_access_level : access_level option;
  team_share_access_level : access_level option;
}

val update_share_permission_request_v2_of_yojson :
  Yojson.Safe.t -> update_share_permission_request_v2

val yojson_of_update_share_permission_request_v2 :
  update_share_permission_request_v2 -> Yojson.Safe.t

val make_update_share_permission_request_v2 :
  ?channel_share_permissions:update_channel_share_permission list ->
  ?link_share:link_share ->
  ?link_share_access_level:access_level ->
  ?team_share_access_level:access_level ->
  unit ->
  update_share_permission_request_v2

type nonrec patch_chat_request = {
  name : string option;  (** New name for the chat. *)
  project_id : string option;
      (** New project ID for the chat. Empty string clears the project. *)
  share_permission : update_share_permission_request_v2 option;
}
(** Request body for patching a chat. *)

val patch_chat_request_of_yojson : Yojson.Safe.t -> patch_chat_request
val yojson_of_patch_chat_request : patch_chat_request -> Yojson.Safe.t

val make_patch_chat_request :
  ?name:string ->
  ?project_id:string ->
  ?share_permission:update_share_permission_request_v2 ->
  unit ->
  patch_chat_request
(** Request body for patching a chat. *)

type nonrec pipedream_catalog_entry_response = {
  app_slug : string;
      (** Pipedream app name slug — pass this to the connect flow. *)
  categories : string list option;  (** Categories assigned by Pipedream. *)
  description : string option;  (** One-line description of the app. *)
  display_name : string;  (** Human-readable name to display. *)
  icon_url : string option;  (** URL of the app's icon, when available. *)
}
(** One connectable app in the catalog. *)

val pipedream_catalog_entry_response_of_yojson :
  Yojson.Safe.t -> pipedream_catalog_entry_response

val yojson_of_pipedream_catalog_entry_response :
  pipedream_catalog_entry_response -> Yojson.Safe.t

val make_pipedream_catalog_entry_response :
  app_slug:string ->
  ?categories:string list ->
  ?description:string ->
  display_name:string ->
  ?icon_url:string ->
  unit ->
  pipedream_catalog_entry_response
(** One connectable app in the catalog. *)

type nonrec pipedream_catalog_response = {
  next_cursor : string option;
      (** Cursor for the next page. Absent on the last page. *)
  servers : pipedream_catalog_entry_response list;
      (** Catalog entries in display order (most popular first). *)
}
(** A page of the connector catalog. *)

val pipedream_catalog_response_of_yojson :
  Yojson.Safe.t -> pipedream_catalog_response

val yojson_of_pipedream_catalog_response :
  pipedream_catalog_response -> Yojson.Safe.t

val make_pipedream_catalog_response :
  ?next_cursor:string ->
  servers:pipedream_catalog_entry_response list ->
  unit ->
  pipedream_catalog_response
(** A page of the connector catalog. *)

type nonrec pipedream_complete_request = {
  account_id : string;
      (** The connected-account ID reported by the Connect UI on success. *)
  server_name : string option;
      (** Optional display name for the connector. Defaults to the app's name
for new connections; existing connections keep their name. *)
}
(** Request body for completing a Pipedream connect flow. *)

val pipedream_complete_request_of_yojson :
  Yojson.Safe.t -> pipedream_complete_request

val yojson_of_pipedream_complete_request :
  pipedream_complete_request -> Yojson.Safe.t

val make_pipedream_complete_request :
  account_id:string -> ?server_name:string -> unit -> pipedream_complete_request
(** Request body for completing a Pipedream connect flow. *)

type nonrec pipedream_connect_complete_request = {
  app_slug : string;  (** The app that was connected, by Pipedream slug. *)
  server_name : string option;
      (** Optional display name for the connector, as for completion. *)
}
(** Request body for recording a finished Macro Connect flow. *)

val pipedream_connect_complete_request_of_yojson :
  Yojson.Safe.t -> pipedream_connect_complete_request

val yojson_of_pipedream_connect_complete_request :
  pipedream_connect_complete_request -> Yojson.Safe.t

val make_pipedream_connect_complete_request :
  app_slug:string ->
  ?server_name:string ->
  unit ->
  pipedream_connect_complete_request
(** Request body for recording a finished Macro Connect flow. *)

(** Which backend a connection or connect flow uses. *)
type nonrec pipedream_provider_response =
  | Pipedream
  | Connect
  | Unknown of string  (** A value this SDK version does not know. *)

val pipedream_provider_response_of_yojson :
  Yojson.Safe.t -> pipedream_provider_response

val yojson_of_pipedream_provider_response :
  pipedream_provider_response -> Yojson.Safe.t

type nonrec pipedream_connection_response = {
  app_slug : string;  (** Pipedream app name slug, e.g. [linear]. *)
  enabled : bool;  (** Whether the connector is enabled for tool use. *)
  provider : pipedream_provider_response;  (** The backend holding the grant. *)
  server_name : string;  (** Human-readable display name. *)
}
(** A connected MCP app as returned by the API. *)

val pipedream_connection_response_of_yojson :
  Yojson.Safe.t -> pipedream_connection_response

val yojson_of_pipedream_connection_response :
  pipedream_connection_response -> Yojson.Safe.t

val make_pipedream_connection_response :
  app_slug:string ->
  enabled:bool ->
  provider:pipedream_provider_response ->
  server_name:string ->
  unit ->
  pipedream_connection_response
(** A connected MCP app as returned by the API. *)

type nonrec pipedream_overlay_response = {
  app_slug : string;
      (** Pipedream app name slug, as it appears in the catalog. *)
  server_url : string;
      (** The MCP server to authorize with the native MCP OAuth flow. *)
}
(** A catalog app that connects through its own MCP server instead of
Pipedream. *)

val pipedream_overlay_response_of_yojson :
  Yojson.Safe.t -> pipedream_overlay_response

val yojson_of_pipedream_overlay_response :
  pipedream_overlay_response -> Yojson.Safe.t

val make_pipedream_overlay_response :
  app_slug:string -> server_url:string -> unit -> pipedream_overlay_response
(** A catalog app that connects through its own MCP server instead of
Pipedream. *)

type nonrec pipedream_recover_request = {
  app_slug : string;
      (** The Pipedream app the flow was connecting, by name slug. *)
  server_name : string option;
      (** Optional display name for the connector, as for completion. *)
}
(** Request body for recovering a connect flow whose result the Connect UI
never reported. *)

val pipedream_recover_request_of_yojson :
  Yojson.Safe.t -> pipedream_recover_request

val yojson_of_pipedream_recover_request :
  pipedream_recover_request -> Yojson.Safe.t

val make_pipedream_recover_request :
  app_slug:string -> ?server_name:string -> unit -> pipedream_recover_request
(** Request body for recovering a connect flow whose result the Connect UI
never reported. *)

type nonrec pipedream_token_request = {
  app_slug : string option;
      (** The app to connect, by Pipedream slug. With it, an app Macro Connect
serves can answer with a Connect URL instead of a Pipedream token. *)
}
(** Request body for starting a connect flow. *)

val pipedream_token_request_of_yojson : Yojson.Safe.t -> pipedream_token_request
val yojson_of_pipedream_token_request : pipedream_token_request -> Yojson.Safe.t

val make_pipedream_token_request :
  ?app_slug:string -> unit -> pipedream_token_request
(** Request body for starting a connect flow. *)

type nonrec pipedream_token_response = {
  connect_link_url : string option;
      (** Shareable link that opens the same connect flow in a browser tab.
Pipedream only. *)
  connect_url : string option;
      (** URL to open in a popup or browser tab for Macro Connect's consent
flow; once it finishes, call [/pipedream/mcp/connect/complete].
Connect only. *)
  expires_at : string option;
      (** RFC 3339 expiry of the token. Pipedream only. *)
  provider : pipedream_provider_response;
      (** The backend this flow connects through. *)
  token : string option;
      (** Short-lived token to open the Pipedream Connect UI with. Pipedream only. *)
}
(** Response from starting a connect flow: a Pipedream Connect token, or for
[provider = connect] a Macro Connect URL. *)

val pipedream_token_response_of_yojson :
  Yojson.Safe.t -> pipedream_token_response

val yojson_of_pipedream_token_response :
  pipedream_token_response -> Yojson.Safe.t

val make_pipedream_token_response :
  ?connect_link_url:string ->
  ?connect_url:string ->
  ?expires_at:string ->
  provider:pipedream_provider_response ->
  ?token:string ->
  unit ->
  pipedream_token_response
(** Response from starting a connect flow: a Pipedream Connect token, or for
[provider = connect] a Macro Connect URL. *)

type nonrec pipedream_update_request = {
  app_slug : string;  (** The app slug to update. *)
  enabled : bool option;  (** Enable or disable the connector. *)
  server_name : string option;  (** New display name for the connector. *)
}
(** Request body for updating a connected app. *)

val pipedream_update_request_of_yojson :
  Yojson.Safe.t -> pipedream_update_request

val yojson_of_pipedream_update_request :
  pipedream_update_request -> Yojson.Safe.t

val make_pipedream_update_request :
  app_slug:string ->
  ?enabled:bool ->
  ?server_name:string ->
  unit ->
  pipedream_update_request
(** Request body for updating a connected app. *)

(** The materialization status of a user's projection instance. *)
type nonrec projection_status =
  | Loading
  | Cold
  | Ready
  | Refreshing
  | Error_
  | Unknown of string  (** A value this SDK version does not know. *)

val projection_status_of_yojson : Yojson.Safe.t -> projection_status
val yojson_of_projection_status : projection_status -> Yojson.Safe.t

type nonrec projection_state_response = {
  data : string option;
      (** The cached result, if any. JSON-encoded when the projection defines an
[output_schema]. *)
  error : string option;  (** The most recent materialization error, if any. *)
  generated_at : string option;  (** When the result was generated. *)
  id : string;  (** The projection id. *)
  stale_at : string option;  (** When the result becomes stale. *)
  status : projection_status;  (** The materialization status. *)
}
(** The current state of a user's projection instance. *)

val projection_state_response_of_yojson :
  Yojson.Safe.t -> projection_state_response

val yojson_of_projection_state_response :
  projection_state_response -> Yojson.Safe.t

val make_projection_state_response :
  ?data:string ->
  ?error:string ->
  ?generated_at:string ->
  id:string ->
  ?stale_at:string ->
  status:projection_status ->
  unit ->
  projection_state_response
(** The current state of a user's projection instance. *)

(** One activity action returned to the AI. *)
type nonrec tool_activity_action =
  | Created  (** The entity was created. *)
  | Edited  (** The entity's content or metadata was edited. *)
  | Opened  (** The entity was opened. *)
  | Deleted  (** The entity was soft-deleted. *)
  | Messaged  (** A message was sent in the entity. *)
  | Sent  (** An email message was sent on the thread. *)
  | Responded  (** Someone submitted a response to the entity (form). *)
  | Property_changed of {
      from : Yojson.Safe.t option;  (** The previous value, when known. *)
      from_labels : string list option;
          (** Previous select/tag option ids resolved to display labels. *)
      property : string;  (** The property definition id. *)
      property_name : string option;
          (** The property definition's human-readable display name, when it is
still visible to the caller. *)
      property_type : string option;
          (** The property's canonical data type, including [tag] for tag sets. *)
      to_ : Yojson.Safe.t option;  (** The new value, or [None] when cleared. *)
      to_labels : string list option;
          (** New select/tag option ids resolved to display labels. *)
    }  (** A property value changed on the entity. *)
  | Participant_added of { participant : string  (** The added principal. *) }
      (** A principal was added to the entity. *)
  | Participant_removed of {
      participant : string;  (** The removed principal. *)
    }  (** A principal was removed from the entity. *)
  | Call_started of { call_id : string  (** The started call's id. *) }
      (** A call was started in the entity. *)
  | Task_added
      (** A task was added to the project. Resolve references through authorized project history. *)
  | Task_removed  (** A task was removed from the project. *)
  | Unknown_ of {
      payload : Yojson.Safe.t option;  (** The stored payload, verbatim. *)
      tag : string;  (** The stored action tag. *)
    }  (** An action outside this deployment's vocabulary. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val tool_activity_action_of_yojson : Yojson.Safe.t -> tool_activity_action
val yojson_of_tool_activity_action : tool_activity_action -> Yojson.Safe.t

val make_tool_activity_action_property_changed :
  ?from:Yojson.Safe.t ->
  ?from_labels:string list ->
  property:string ->
  ?property_name:string ->
  ?property_type:string ->
  ?to_:Yojson.Safe.t ->
  ?to_labels:string list ->
  unit ->
  tool_activity_action
(** A property value changed on the entity. *)

val make_tool_activity_action_participant_added :
  participant:string -> unit -> tool_activity_action
(** A principal was added to the entity. *)

val make_tool_activity_action_participant_removed :
  participant:string -> unit -> tool_activity_action
(** A principal was removed from the entity. *)

val make_tool_activity_action_call_started :
  call_id:string -> unit -> tool_activity_action
(** A call was started in the entity. *)

val make_tool_activity_action_unknown_ :
  ?payload:Yojson.Safe.t -> tag:string -> unit -> tool_activity_action
(** An action outside this deployment's vocabulary. *)

type nonrec tool_activity_event = {
  action : tool_activity_action;  (** What the principal did. *)
  actor_id : string;
      (** The principal that mechanically performed the action. *)
  entity_id : string;  (** The entity acted on. *)
  entity_type : string;  (** The kind of entity acted on. *)
  occurred_at : string;  (** When the action occurred. *)
}
(** One activity event returned by \[[ReadActivity]\]. *)

val tool_activity_event_of_yojson : Yojson.Safe.t -> tool_activity_event
val yojson_of_tool_activity_event : tool_activity_event -> Yojson.Safe.t

val make_tool_activity_event :
  action:tool_activity_action ->
  actor_id:string ->
  entity_id:string ->
  entity_type:string ->
  occurred_at:string ->
  unit ->
  tool_activity_event
(** One activity event returned by \[[ReadActivity]\]. *)

type nonrec read_activity_response = {
  activities : tool_activity_event list;
      (** Matching activity events, newest first. *)
  truncated : bool;
      (** Whether more than 100 events matched the requested range. *)
}
(** Response from \[[ReadActivity]\]. *)

val read_activity_response_of_yojson : Yojson.Safe.t -> read_activity_response
val yojson_of_read_activity_response : read_activity_response -> Yojson.Safe.t

val make_read_activity_response :
  activities:tool_activity_event list ->
  truncated:bool ->
  unit ->
  read_activity_response
(** Response from \[[ReadActivity]\]. *)

(** How frequently an active projection is regenerated. *)
type nonrec refresh_cadence =
  | High
  | Medium
  | Low
  | Unknown of string  (** A value this SDK version does not know. *)

val refresh_cadence_of_yojson : Yojson.Safe.t -> refresh_cadence
val yojson_of_refresh_cadence : refresh_cadence -> Yojson.Safe.t

type nonrec reject_tool_call_request = {
  message_id : string;  (** The message ID containing the tool call. *)
  tool_call_id : string;  (** The tool call ID to reject. *)
}
(** Request body for rejecting a pending tool call. *)

val reject_tool_call_request_of_yojson :
  Yojson.Safe.t -> reject_tool_call_request

val yojson_of_reject_tool_call_request :
  reject_tool_call_request -> Yojson.Safe.t

val make_reject_tool_call_request :
  message_id:string -> tool_call_id:string -> unit -> reject_tool_call_request
(** Request body for rejecting a pending tool call. *)

type nonrec run_import_outcome = {
  discarded : int64;  (** How many rows were discarded. *)
  importing : int64;
      (** How many rows flipped to [importing] (jobs are now copying them in). *)
}
(** Outcome of accepting/declining staged rows via [POST /import/run]. *)

val run_import_outcome_of_yojson : Yojson.Safe.t -> run_import_outcome
val yojson_of_run_import_outcome : run_import_outcome -> Yojson.Safe.t

val make_run_import_outcome :
  discarded:int64 -> importing:int64 -> unit -> run_import_outcome
(** Outcome of accepting/declining staged rows via [POST /import/run]. *)

type nonrec run_import_request = {
  discard_ids : string list option;  (** Staged rows to discard. *)
  import_ids : string list option;  (** Staged rows to import. *)
}
(** Body for accepting/declining staged imports. *)

val run_import_request_of_yojson : Yojson.Safe.t -> run_import_request
val yojson_of_run_import_request : run_import_request -> Yojson.Safe.t

val make_run_import_request :
  ?discard_ids:string list ->
  ?import_ids:string list ->
  unit ->
  run_import_request
(** Body for accepting/declining staged imports. *)

type nonrec send_chat_message_payload = {
  token : string;
  additional_instructions : string option;
      (** Additional system instructions appended to the base system prompt *)
  attachments : entity list option;  (** Use citation prompt *)
  chat_id : string;  (** Id of the chat the message belongs to *)
  content : string;  (** The content of the message *)
  model : string;  (** the chat model to respond with ([provider/model] id) *)
  stream_id : string;  (** Stream ID for tracking the response *)
  toolset : tool_set option;  (** Which toolset to use. Defaults to [all] *)
}

val send_chat_message_payload_of_yojson :
  Yojson.Safe.t -> send_chat_message_payload

val yojson_of_send_chat_message_payload :
  send_chat_message_payload -> Yojson.Safe.t

val make_send_chat_message_payload :
  token:string ->
  ?additional_instructions:string ->
  ?attachments:entity list ->
  chat_id:string ->
  content:string ->
  model:string ->
  stream_id:string ->
  ?toolset:tool_set ->
  unit ->
  send_chat_message_payload

type nonrec send_chat_message_response = {
  chat_id : string;
      (** The chat ID (may differ from request if a new chat was created) *)
  message_id : string;  (** The message ID for the AI response *)
  stream_id : string;
      (** The stream ID that will receive the response chunks (same as message_id) *)
}
(** Response for initiating a chat message stream *)

val send_chat_message_response_of_yojson :
  Yojson.Safe.t -> send_chat_message_response

val yojson_of_send_chat_message_response :
  send_chat_message_response -> Yojson.Safe.t

val make_send_chat_message_response :
  chat_id:string ->
  message_id:string ->
  stream_id:string ->
  unit ->
  send_chat_message_response
(** Response for initiating a chat message stream *)

type nonrec server_response = {
  authenticated : bool;  (** Whether the server has valid stored credentials. *)
  enabled : bool;  (** Whether the server is enabled for tool use. *)
  server_name : string;  (** Human-readable server name. *)
  url : string;  (** The MCP server URL. *)
}
(** An MCP server record as returned by the API. *)

val server_response_of_yojson : Yojson.Safe.t -> server_response
val yojson_of_server_response : server_response -> Yojson.Safe.t

val make_server_response :
  authenticated:bool ->
  enabled:bool ->
  server_name:string ->
  url:string ->
  unit ->
  server_response
(** An MCP server record as returned by the API. *)

type nonrec set_pricing_request = {
  model : string;  (** The model api id to (re)price. *)
  price_per_audio_minute : float option;
      (** Price per minute of audio (USD), or null for token-only pricing. *)
  price_per_mil_cache_read : float option;
      (** Price per million cache-read input tokens (USD). Omit it when the model
has no published rate: calls that report cache reads then stay unpriced. *)
  price_per_mil_cache_write : float option;
      (** Price per million cache-write input tokens (USD). Omit it when the model
has no published rate: calls that report cache writes then stay unpriced. *)
  price_per_mil_in : float option;
      (** New price per million input tokens (USD). Required for token pricing. *)
  price_per_mil_out : float option;
      (** New price per million output tokens (USD). Required for token pricing. *)
  price_per_provider_credit : float option;
      (** Price per vendor credit (USD), or null unless the model bills in credits. *)
}
(** Request body for \[[set_pricing_handler]\]. *)

val set_pricing_request_of_yojson : Yojson.Safe.t -> set_pricing_request
val yojson_of_set_pricing_request : set_pricing_request -> Yojson.Safe.t

val make_set_pricing_request :
  model:string ->
  ?price_per_audio_minute:float ->
  ?price_per_mil_cache_read:float ->
  ?price_per_mil_cache_write:float ->
  ?price_per_mil_in:float ->
  ?price_per_mil_out:float ->
  ?price_per_provider_credit:float ->
  unit ->
  set_pricing_request
(** Request body for \[[set_pricing_handler]\]. *)

type nonrec skill_content_response = {
  built_in : bool;
      (** Whether this is a built-in skill, with no document behind it. *)
  content : string;  (** The skill's full markdown instructions. *)
  id : string;  (** The skill's id. *)
  name : string;  (** The skill's name. *)
}
(** A skill's complete instructions. *)

val skill_content_response_of_yojson : Yojson.Safe.t -> skill_content_response
val yojson_of_skill_content_response : skill_content_response -> Yojson.Safe.t

val make_skill_content_response :
  built_in:bool ->
  content:string ->
  id:string ->
  name:string ->
  unit ->
  skill_content_response
(** A skill's complete instructions. *)

type nonrec skill_error_body = {
  code : string;  (** Stable failure code. *)
  error : string;  (** Explanation without backend diagnostics. *)
}
(** Machine-readable failure of a skill request. *)

val skill_error_body_of_yojson : Yojson.Safe.t -> skill_error_body
val yojson_of_skill_error_body : skill_error_body -> Yojson.Safe.t

val make_skill_error_body :
  code:string -> error:string -> unit -> skill_error_body
(** Machine-readable failure of a skill request. *)

type nonrec skill_listing = {
  built_in : bool;
      (** Whether this is a built-in skill, with no document behind it. *)
  description : string option;  (** When to use the skill, when it says. *)
  id : string;
      (** The skill document's id, or a built-in skill's well-known id. *)
  name : string;  (** The skill's name. *)
  updated_at : string option;
      (** When the skill document was last updated; built-in skills have none. *)
}
(** One skill the caller can read. *)

val skill_listing_of_yojson : Yojson.Safe.t -> skill_listing
val yojson_of_skill_listing : skill_listing -> Yojson.Safe.t

val make_skill_listing :
  built_in:bool ->
  ?description:string ->
  id:string ->
  name:string ->
  ?updated_at:string ->
  unit ->
  skill_listing
(** One skill the caller can read. *)

(** How search terms are matched against skill names. *)
type nonrec skills_match_type =
  | Partial
  | Exact
  | Unknown of string  (** A value this SDK version does not know. *)

val skills_match_type_of_yojson : Yojson.Safe.t -> skills_match_type
val yojson_of_skills_match_type : skills_match_type -> Yojson.Safe.t

type nonrec skills_response = {
  skills : skill_listing list;  (** The matching skills. *)
}
(** The skills matching a listing or search, most recently updated first,
built-in skills last. *)

val skills_response_of_yojson : Yojson.Safe.t -> skills_response
val yojson_of_skills_response : skills_response -> Yojson.Safe.t

val make_skills_response : skills:skill_listing list -> unit -> skills_response
(** The skills matching a listing or search, most recently updated first,
built-in skills last. *)

type nonrec slack_participant = {
  email : string option;  (** Email, when the workspace exposes it. *)
  name : string;  (** Display name or Slack handle. *)
}
(** A person active in a staged Slack channel. *)

val slack_participant_of_yojson : Yojson.Safe.t -> slack_participant
val yojson_of_slack_participant : slack_participant -> Yojson.Safe.t

val make_slack_participant :
  ?email:string -> name:string -> unit -> slack_participant
(** A person active in a staged Slack channel. *)

type nonrec slack_channel_meta = {
  archived : bool option;  (** Whether Slack has archived this channel. *)
  channel_id : string option;
      (** Slack's channel id (e.g. [C0123456789]), stable across renames. *)
  member_count : int64 option;  (** Total human members in the Slack channel. *)
  members_resolved : bool option;
      (** Whether [participants] reflects a live membership read. *)
  name : string;  (** Channel name without the leading [#]. *)
  participants : slack_participant list option;
      (** Slack members matched to the Macro team roster when discovery resolved membership. *)
  purpose : string option;  (** The channel's purpose/topic, when set. *)
}
(** Metadata for one staged Slack channel. *)

val slack_channel_meta_of_yojson : Yojson.Safe.t -> slack_channel_meta
val yojson_of_slack_channel_meta : slack_channel_meta -> Yojson.Safe.t

val make_slack_channel_meta :
  ?archived:bool ->
  ?channel_id:string ->
  ?member_count:int64 ->
  ?members_resolved:bool ->
  name:string ->
  ?participants:slack_participant list ->
  ?purpose:string ->
  unit ->
  slack_channel_meta
(** Metadata for one staged Slack channel. *)

type nonrec start_auth_request = {
  server_name : string;  (** Human-readable name for the server. *)
  server_url : string;  (** The MCP server URL to authorize against. *)
}
(** Request body for starting an OAuth authorization flow. *)

val start_auth_request_of_yojson : Yojson.Safe.t -> start_auth_request
val yojson_of_start_auth_request : start_auth_request -> Yojson.Safe.t

val make_start_auth_request :
  server_name:string -> server_url:string -> unit -> start_auth_request
(** Request body for starting an OAuth authorization flow. *)

type nonrec start_auth_response = {
  authorization_url : string;
      (** The OAuth authorization URL to redirect the user to. *)
}
(** Response from starting an OAuth authorization flow. *)

val start_auth_response_of_yojson : Yojson.Safe.t -> start_auth_response
val yojson_of_start_auth_response : start_auth_response -> Yojson.Safe.t

val make_start_auth_response :
  authorization_url:string -> unit -> start_auth_response
(** Response from starting an OAuth authorization flow. *)

type nonrec stop_chat_stream_error = {
  error : string;  (** Human-readable error message. *)
}
(** Error response for the stop endpoint. *)

val stop_chat_stream_error_of_yojson : Yojson.Safe.t -> stop_chat_stream_error
val yojson_of_stop_chat_stream_error : stop_chat_stream_error -> Yojson.Safe.t

val make_stop_chat_stream_error : error:string -> unit -> stop_chat_stream_error
(** Error response for the stop endpoint. *)

type nonrec stop_chat_stream_request = {
  chat_id : string;
      (** The chat the stream belongs to. Used to verify the caller has
permission to stop the stream. *)
  stream_id : string;  (** The stream/message ID to stop. *)
}
(** Request body for stopping an in-flight chat stream. *)

val stop_chat_stream_request_of_yojson :
  Yojson.Safe.t -> stop_chat_stream_request

val yojson_of_stop_chat_stream_request :
  stop_chat_stream_request -> Yojson.Safe.t

val make_stop_chat_stream_request :
  chat_id:string -> stream_id:string -> unit -> stop_chat_stream_request
(** Request body for stopping an in-flight chat stream. *)

type nonrec stop_chat_stream_response = {
  stopped : bool;
      (** [true] if a matching in-flight stream was found and cancellation was
triggered, [false] if the stream had already finished or was unknown. *)
}
(** Response from a stop request. *)

val stop_chat_stream_response_of_yojson :
  Yojson.Safe.t -> stop_chat_stream_response

val yojson_of_stop_chat_stream_response :
  stop_chat_stream_response -> Yojson.Safe.t

val make_stop_chat_stream_response :
  stopped:bool -> unit -> stop_chat_stream_response
(** Response from a stop request. *)

type nonrec string_id_response = { id : string }

val string_id_response_of_yojson : Yojson.Safe.t -> string_id_response
val yojson_of_string_id_response : string_id_response -> Yojson.Safe.t
val make_string_id_response : id:string -> unit -> string_id_response

type nonrec structured_completion_error = {
  code : string option;
      (** Stable machine-readable code for admission errors (402 or 503). *)
  error : string;
}

val structured_completion_error_of_yojson :
  Yojson.Safe.t -> structured_completion_error

val yojson_of_structured_completion_error :
  structured_completion_error -> Yojson.Safe.t

val make_structured_completion_error :
  ?code:string -> error:string -> unit -> structured_completion_error

type nonrec structured_completion_outcome =
  | Completed of { result : Yojson.Safe.t }
      (** The answer, shaped by the request's [output_schema]. *)
  | Interrupted of { reason : string }
      (** The model failed after committing database changes, so there is no
answer but [tool_activity] says what was saved. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val structured_completion_outcome_of_yojson :
  Yojson.Safe.t -> structured_completion_outcome

val yojson_of_structured_completion_outcome :
  structured_completion_outcome -> Yojson.Safe.t

val make_structured_completion_outcome_completed :
  result:Yojson.Safe.t -> unit -> structured_completion_outcome
(** The answer, shaped by the request's [output_schema]. *)

val make_structured_completion_outcome_interrupted :
  reason:string -> unit -> structured_completion_outcome
(** The model failed after committing database changes, so there is no
answer but [tool_activity] says what was saved. *)

type nonrec structured_completion_request = {
  additional_instructions : string option;
  model : string;
  output_schema : dynamic_schema;
  prompt : string;
  thinking : completion_thinking option;
      (** How much the model may think first; [low] answers faster. Applies to
completions without tools. *)
  toolset : tool_set option;
}

val structured_completion_request_of_yojson :
  Yojson.Safe.t -> structured_completion_request

val yojson_of_structured_completion_request :
  structured_completion_request -> Yojson.Safe.t

val make_structured_completion_request :
  ?additional_instructions:string ->
  model:string ->
  output_schema:dynamic_schema ->
  prompt:string ->
  ?thinking:completion_thinking ->
  ?toolset:tool_set ->
  unit ->
  structured_completion_request

type nonrec tool_outcome =
  | Succeeded of { changes : database_change }
  | Failed
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val tool_outcome_of_yojson : Yojson.Safe.t -> tool_outcome
val yojson_of_tool_outcome : tool_outcome -> Yojson.Safe.t

val make_tool_outcome_succeeded :
  changes:database_change -> unit -> tool_outcome

type nonrec structured_tool_activity = { name : string; outcome : tool_outcome }
(** One tool call the agent finished, and what it did. *)

val structured_tool_activity_of_yojson :
  Yojson.Safe.t -> structured_tool_activity

val yojson_of_structured_tool_activity :
  structured_tool_activity -> Yojson.Safe.t

val make_structured_tool_activity :
  name:string -> outcome:tool_outcome -> unit -> structured_tool_activity
(** One tool call the agent finished, and what it did. *)

type nonrec structured_completion_response = {
  outcome : structured_completion_outcome;
  tool_activity : structured_tool_activity list;
      (** Actual completed tools, independent of the model's claims. *)
}

val structured_completion_response_of_yojson :
  Yojson.Safe.t -> structured_completion_response

val yojson_of_structured_completion_response :
  structured_completion_response -> Yojson.Safe.t

val make_structured_completion_response :
  outcome:structured_completion_outcome ->
  tool_activity:structured_tool_activity list ->
  unit ->
  structured_completion_response

(** The kind of entity a projection is materialized for. *)
type nonrec target_type =
  | User
  | Team
  | Unknown of string  (** A value this SDK version does not know. *)

val target_type_of_yojson : Yojson.Safe.t -> target_type
val yojson_of_target_type : target_type -> Yojson.Safe.t

(** Whether a tracked item is a candidate or an import already made. *)
type nonrec track_import_status =
  | Staged
  | Imported
  | Unknown of string  (** A value this SDK version does not know. *)

val track_import_status_of_yojson : Yojson.Safe.t -> track_import_status
val yojson_of_track_import_status : track_import_status -> Yojson.Safe.t

type nonrec track_import_entity_request = {
  entity_id : string option;
      (** The Macro entity created from the item; required when [status] is
[imported]. *)
  foreign_id : string;
      (** Stable id of the item in its source: a Linear identifier such as
[ENG-142], a Notion page URL or id, or a Slack channel id. *)
  metadata : Yojson.Safe.t;
      (** Per-source metadata. Linear: [{identifier, title, …}]; Notion:
[{title, url?, summary?}]; Slack: [{name, …}]. *)
  source : import_source;  (** The external system the item comes from. *)
  status : track_import_status;
      (** [staged] to propose the item, [imported] to record an entity already
created from it. *)
}
(** Body for tracking one external item in the ledger. *)

val track_import_entity_request_of_yojson :
  Yojson.Safe.t -> track_import_entity_request

val yojson_of_track_import_entity_request :
  track_import_entity_request -> Yojson.Safe.t

val make_track_import_entity_request :
  ?entity_id:string ->
  foreign_id:string ->
  metadata:Yojson.Safe.t ->
  source:import_source ->
  status:track_import_status ->
  unit ->
  track_import_entity_request
(** Body for tracking one external item in the ledger. *)

(** What tracking an item did. *)
type nonrec track_import_outcome =
  | Staged
  | Recorded_imported
  | Already_imported
  | Already_imported_by_teammate
  | Previously_declined
  | Import_in_progress
  | Unknown of string  (** A value this SDK version does not know. *)

val track_import_outcome_of_yojson : Yojson.Safe.t -> track_import_outcome
val yojson_of_track_import_outcome : track_import_outcome -> Yojson.Safe.t

type nonrec track_import_entity_response = {
  entity : import_entity;  (** The row behind the outcome. *)
  outcome : track_import_outcome;  (** What happened. *)
}
(** The outcome of tracking an item, with its ledger row. *)

val track_import_entity_response_of_yojson :
  Yojson.Safe.t -> track_import_entity_response

val yojson_of_track_import_entity_response :
  track_import_entity_response -> Yojson.Safe.t

val make_track_import_entity_response :
  entity:import_entity ->
  outcome:track_import_outcome ->
  unit ->
  track_import_entity_response
(** The outcome of tracking an item, with its ledger row. *)

type nonrec update_explicit_memory_request = {
  edit : memory_edit;  (** The one-based line edit to apply. *)
  revision : int64;
      (** The revision returned by the last read or successful edit. *)
}
(** One explicit memory edit at the revision it was based on. *)

val update_explicit_memory_request_of_yojson :
  Yojson.Safe.t -> update_explicit_memory_request

val yojson_of_update_explicit_memory_request :
  update_explicit_memory_request -> Yojson.Safe.t

val make_update_explicit_memory_request :
  edit:memory_edit -> revision:int64 -> unit -> update_explicit_memory_request
(** One explicit memory edit at the revision it was based on. *)

type nonrec update_server_request = {
  enabled : bool option;  (** Enable or disable the server. *)
  server_name : string option;  (** New name for the server. *)
  url : string;  (** The server URL to update. *)
}
(** Request body for updating an MCP server. *)

val update_server_request_of_yojson : Yojson.Safe.t -> update_server_request
val yojson_of_update_server_request : update_server_request -> Yojson.Safe.t

val make_update_server_request :
  ?enabled:bool ->
  ?server_name:string ->
  url:string ->
  unit ->
  update_server_request
(** Request body for updating an MCP server. *)

type nonrec update_tool_call_request = {
  args : Yojson.Safe.t;  (** The new arguments for the tool call. *)
  message_id : string;  (** The message ID containing the tool call. *)
  tool_call_id : string;  (** The tool call ID to update. *)
}
(** Request body for updating a tool call's arguments. *)

val update_tool_call_request_of_yojson :
  Yojson.Safe.t -> update_tool_call_request

val yojson_of_update_tool_call_request :
  update_tool_call_request -> Yojson.Safe.t

val make_update_tool_call_request :
  args:Yojson.Safe.t ->
  message_id:string ->
  tool_call_id:string ->
  unit ->
  update_tool_call_request
(** Request body for updating a tool call's arguments. *)

(** User tools are pending until a user executes them *)
type nonrec user_tool_response_value =
  | Pending_user_execution  (** Tool has not yet been executed *)
  | Rejected  (** User rejected suggested tool execution *)
  | User_action of Yojson.Safe.t
      (** Tool is executed and has whatever return type the wrapped tool returns *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val user_tool_response_value_of_yojson :
  Yojson.Safe.t -> user_tool_response_value

val yojson_of_user_tool_response_value :
  user_tool_response_value -> Yojson.Safe.t

type nonrec update_tool_response_request = {
  message_id : string;  (** The message ID containing the tool response. *)
  response : user_tool_response_value;  (** The new user tool response. *)
  tool_call_id : string;
      (** The tool call ID whose response should be updated. *)
}
(** Request body for updating a tool response. *)

val update_tool_response_request_of_yojson :
  Yojson.Safe.t -> update_tool_response_request

val yojson_of_update_tool_response_request :
  update_tool_response_request -> Yojson.Safe.t

val make_update_tool_response_request :
  message_id:string ->
  response:user_tool_response_value ->
  tool_call_id:string ->
  unit ->
  update_tool_response_request
(** Request body for updating a tool response. *)

type nonrec upsert_projection_request = {
  await : bool option;
      (** When [true] and generation is needed (cold instance or [regenerate]),
the server generates inline and responds with the finished result
instead of returning immediately and pushing an update through the
connection gateway. *)
  expiry : expiry;
      (** How long the projection remains active without being requested. *)
  id : string;
      (** The frontend-defined projection id (e.g. [notification_important_widget]). *)
  model : string option;
      (** Optional [provider/model] id used for generation (e.g.
[cerebras/llama-3.3-70b]). The default model is used when absent. *)
  output_schema : Yojson.Safe.t option;
      (** Optional JSON schema the generated result must conform to. When set,
[data] holds the JSON serialization of a conforming value. Enforcement
is prompted (non-strict), so it works across providers. *)
  prompt : string;  (** The prompt used to materialize the projection. *)
  refresh_cadence : refresh_cadence;
      (** How frequently the projection should be regenerated. *)
  regenerate : bool option;
      (** When [true], regenerate even if a cached result exists. *)
  target_type : target_type;
      (** Whether the projection is materialized for the requesting user or their team. *)
}
(** Request body for getting or creating an ai projection. The concrete target
id is resolved from the authenticated user, so only the target type is sent. *)

val upsert_projection_request_of_yojson :
  Yojson.Safe.t -> upsert_projection_request

val yojson_of_upsert_projection_request :
  upsert_projection_request -> Yojson.Safe.t

val make_upsert_projection_request :
  ?await:bool ->
  expiry:expiry ->
  id:string ->
  ?model:string ->
  ?output_schema:Yojson.Safe.t ->
  prompt:string ->
  refresh_cadence:refresh_cadence ->
  ?regenerate:bool ->
  target_type:target_type ->
  unit ->
  upsert_projection_request
(** Request body for getting or creating an ai projection. The concrete target
id is resolved from the authenticated user, so only the target type is sent. *)

type nonrec usage_request = {
  features : ai_feature list option;  (** If empty, include all features. *)
  from : string option;  (** Inclusive lower bound on [created_at]. *)
  include_users : string list option;  (** If empty, include all users. *)
  until : string option;  (** Exclusive upper bound on [created_at]. *)
}
(** Request body for \[[get_usage_handler]\]. *)

val usage_request_of_yojson : Yojson.Safe.t -> usage_request
val yojson_of_usage_request : usage_request -> Yojson.Safe.t

val make_usage_request :
  ?features:ai_feature list ->
  ?from:string ->
  ?include_users:string list ->
  ?until:string ->
  unit ->
  usage_request
(** Request body for \[[get_usage_handler]\]. *)

type nonrec usage_summary = {
  entries : feature_usage list;  (** Per-feature usage. *)
  total : float;  (** Grand total (USD). *)
}
(** Per-feature breakdown and grand total. *)

val usage_summary_of_yojson : Yojson.Safe.t -> usage_summary
val yojson_of_usage_summary : usage_summary -> Yojson.Safe.t

val make_usage_summary :
  entries:feature_usage list -> total:float -> unit -> usage_summary
(** Per-feature breakdown and grand total. *)

type nonrec web_citation = {
  description : string option;  (** A description of the cited page. *)
  favicon_url : string option;  (** The URL of the page's favicon. *)
  image_url : string option;  (** The URL of the page's image. *)
  title : string;  (** The title of the cited page. *)
  url : string;  (** The URL of the citation. *)
}
(** A web citation associated with a chat message. *)

val web_citation_of_yojson : Yojson.Safe.t -> web_citation
val yojson_of_web_citation : web_citation -> Yojson.Safe.t

val make_web_citation :
  ?description:string ->
  ?favicon_url:string ->
  ?image_url:string ->
  title:string ->
  url:string ->
  unit ->
  web_citation
(** A web citation associated with a chat message. *)

type nonrec web_error_body = {
  code : string;  (** Stable failure code. *)
  error : string;  (** Explanation without provider diagnostics. *)
}
(** Machine-readable failure of a web request. *)

val web_error_body_of_yojson : Yojson.Safe.t -> web_error_body
val yojson_of_web_error_body : web_error_body -> Yojson.Safe.t

val make_web_error_body : code:string -> error:string -> unit -> web_error_body
(** Machine-readable failure of a web request. *)

type nonrec web_fetch = {
  max_chars : int option;
      (** Most characters of page text to return, 1 to 100,000 (default 20,000). *)
  url : string;  (** The [http] or [https] URL of the page. *)
}
(** Read one public web page. *)

val web_fetch_of_yojson : Yojson.Safe.t -> web_fetch
val yojson_of_web_fetch : web_fetch -> Yojson.Safe.t

val make_web_fetch : ?max_chars:int -> url:string -> unit -> web_fetch
(** Read one public web page. *)

type nonrec web_fetch_response = {
  content : string;  (** The page text as Markdown, cut to [maxChars]. *)
  title : string option;  (** The page title, when the provider reports one. *)
  truncated : bool;  (** Whether [content] was cut to [maxChars]. *)
  url : string;  (** The URL that was read. *)
}
(** The text of a fetched page. *)

val web_fetch_response_of_yojson : Yojson.Safe.t -> web_fetch_response
val yojson_of_web_fetch_response : web_fetch_response -> Yojson.Safe.t

val make_web_fetch_response :
  content:string ->
  ?title:string ->
  truncated:bool ->
  url:string ->
  unit ->
  web_fetch_response
(** The text of a fetched page. *)

(** The kind of results a search favours. *)
type nonrec web_search_topic =
  | General
  | News
  | Unknown of string  (** A value this SDK version does not know. *)

val web_search_topic_of_yojson : Yojson.Safe.t -> web_search_topic
val yojson_of_web_search_topic : web_search_topic -> Yojson.Safe.t

type nonrec web_search = {
  domains : string list option;
      (** Only return pages from these domains, e.g. `\["docs.rs", "github.com"\]`. *)
  exclude_domains : string list option;
      (** Never return pages from these domains. *)
  include_content : bool option;
      (** Also return each page's text as Markdown (up to 8,000 characters per result). *)
  max_results : int option;
      (** How many results to return, 1 to 20 (default 5). *)
  query : string;
      (** What to search for, in natural language or keywords (at most 400 characters). *)
  since : string option;
      (** Only return pages published on or after this date ([YYYY-MM-DD]). *)
  topic : web_search_topic option;
}
(** Search the public web. *)

val web_search_of_yojson : Yojson.Safe.t -> web_search
val yojson_of_web_search : web_search -> Yojson.Safe.t

val make_web_search :
  ?domains:string list ->
  ?exclude_domains:string list ->
  ?include_content:bool ->
  ?max_results:int ->
  query:string ->
  ?since:string ->
  ?topic:web_search_topic ->
  unit ->
  web_search
(** Search the public web. *)

type nonrec web_search_result = {
  content : string option;
      (** The page text as Markdown, when [includeContent] was set. *)
  published_at : string option;
      (** When the page was published, as the search provider reports it. *)
  snippet : string;  (** The part of the page most relevant to the query. *)
  title : string;  (** The page title. *)
  url : string;  (** The page URL; cite it when you use the result. *)
}
(** One page a search found. *)

val web_search_result_of_yojson : Yojson.Safe.t -> web_search_result
val yojson_of_web_search_result : web_search_result -> Yojson.Safe.t

val make_web_search_result :
  ?content:string ->
  ?published_at:string ->
  snippet:string ->
  title:string ->
  url:string ->
  unit ->
  web_search_result
(** One page a search found. *)

type nonrec web_search_response = {
  results : web_search_result list;
      (** Results, best match first. Empty when nothing matched. *)
}
(** The pages a search found, best match first. *)

val web_search_response_of_yojson : Yojson.Safe.t -> web_search_response
val yojson_of_web_search_response : web_search_response -> Yojson.Safe.t

val make_web_search_response :
  results:web_search_result list -> unit -> web_search_response
(** The pages a search found, best match first. *)

val read_my_activity :
  from:string ->
  to_:string ->
  unit ->
  (read_activity_response, activity_error_body) Macro_sdk_runtime.Request.t
(** [GET /activity]

Read the acting user's own activity in a time range, newest first. *)

val set_pricing_handler :
  model:string ->
  ?price_per_audio_minute:float ->
  ?price_per_mil_cache_read:float ->
  ?price_per_mil_cache_write:float ->
  ?price_per_mil_in:float ->
  ?price_per_mil_out:float ->
  ?price_per_provider_credit:float ->
  unit ->
  (unit, error_body) Macro_sdk_runtime.Request.t
(** [POST /ai-cost/pricing]

Set the pricing for a model and recompute its recorded rows. Admin only. *)

val get_usage_handler :
  ?features:ai_feature list ->
  ?from:string ->
  ?include_users:string list ->
  ?until:string ->
  unit ->
  (usage_summary, error_body) Macro_sdk_runtime.Request.t
(** [POST /ai-cost/usage]

Query recorded AI usage. Admin only. *)

val upsert_ai_projection :
  expiry:expiry ->
  id:string ->
  prompt:string ->
  refresh_cadence:refresh_cadence ->
  target_type:target_type ->
  ?await:bool ->
  ?model:string ->
  ?output_schema:Yojson.Safe.t ->
  ?regenerate:bool ->
  unit ->
  (projection_state_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /ai-projections]

Gets or creates an ai projection and the requesting user's instance,
triggering (or awaiting) materialization when needed. *)

val get_chats_for_attachment_handler :
  attachment_id:string ->
  unit ->
  ( get_chats_for_attachment_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /attachments/{attachment_id}/chats] *)

val create_confirmed_calendar_event :
  body:Yojson.Safe.t ->
  unit ->
  (Yojson.Safe.t, generic_error_response) Macro_sdk_runtime.Request.t
(** [POST /calendar/events/create-confirmed]

Create a calendar event the user approved in conversation, quoting their approval. *)

val delete_chat :
  chat_id:string ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [DELETE /chat/{chat_id}]

Soft-delete a chat. *)

val patch_chat :
  chat_id:string ->
  ?name:string ->
  ?project_id:string ->
  ?share_permission:update_share_permission_request_v2 ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [PATCH /chat/{chat_id}]

Patch a chat's name, project, or share permissions. *)

val permanently_delete_chat :
  chat_id:string ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [DELETE /chat/{chat_id}/permanent]

Permanently delete a chat and all associated data. *)

val create_chat :
  ?name:string ->
  ?project_id:string ->
  unit ->
  ( string_id_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /chats]

Create a new chat. *)

val get_chat_history_handler :
  chat_id:string ->
  unit ->
  (chat_history, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [GET /chats/history/{chat_id}]

Retrieves chat history for a specific chat ID *)

val get_chat_history_batch_messages_handler :
  message_ids:string list ->
  unit ->
  (chat_history, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [POST /chats/history_batch_messages]

Retrieves chat history for multiple message IDs *)

val get_chat :
  chat_id:string ->
  unit ->
  ( get_chat_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /chats/{chat_id}]

Get a chat by ID with messages and web citations. *)

val copy_chat :
  chat_id:string ->
  unit ->
  ( string_id_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /chats/{chat_id}/copy]

Copy a chat and its messages into a new chat. *)

val get_chat_permissions :
  chat_id:string ->
  unit ->
  ( get_chat_permissions_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /chats/{chat_id}/permissions]

Get the share permissions for a chat. *)

val revert_delete_chat :
  chat_id:string ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [PUT /chats/{chat_id}/revert_delete]

Revert a soft-deleted chat. *)

val call_tool :
  chat_id:string ->
  message_id:string ->
  tool_call_id:string ->
  ?args:Yojson.Safe.t ->
  unit ->
  ( call_tool_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /chats/{chat_id}/tool/call]

Execute a pending tool call, optionally with updated arguments. *)

val reject_tool_call :
  chat_id:string ->
  message_id:string ->
  tool_call_id:string ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [POST /chats/{chat_id}/tool/reject]

Reject a pending tool call. *)

val update_tool_response :
  chat_id:string ->
  message_id:string ->
  response:user_tool_response_value ->
  tool_call_id:string ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [POST /chats/{chat_id}/tool/response/update]

Update a tool response. *)

val update_tool_call :
  chat_id:string ->
  args:Yojson.Safe.t ->
  message_id:string ->
  tool_call_id:string ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [POST /chats/{chat_id}/tool/update]

Update a tool call's arguments after validation. *)

val get_citation_handler :
  id:string ->
  unit ->
  ( document_text_part,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /citations/{id}] *)

val generate_database_query :
  model:string ->
  prompt:string ->
  schema:Yojson.Safe.t ->
  sql:string ->
  ?error:string ->
  unit ->
  ( database_query_answer,
    structured_completion_error )
  Macro_sdk_runtime.Request.t
(** [POST /database-query] *)

val decisions :
  input:Yojson.Safe.t ->
  questions:(string * string) list ->
  unit ->
  (decision_response, decision_error_body) Macro_sdk_runtime.Request.t
(** [POST /decisions] *)

val send_confirmed_email :
  body:Yojson.Safe.t ->
  unit ->
  (Yojson.Safe.t, generic_error_response) Macro_sdk_runtime.Request.t
(** [POST /email/send-confirmed]

Send an email the user approved in conversation, quoting their approval. *)

val health_handler :
  unit ->
  (string, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [GET /health]

Health check *)

val generate_image :
  prompt:string ->
  ?aspect_ratio:generate_image_aspect_ratio ->
  ?reference_images:generate_image_reference list ->
  unit ->
  ( generate_image_response,
    generate_image_error_body )
  Macro_sdk_runtime.Request.t
(** [POST /images/generate]

Generate an image with Nano Banana and store it as a static file owned by
the caller. Charged to the acting user's AI allowance. *)

val list_import_entities :
  ?source:import_source ->
  ?status:import_status ->
  unit ->
  ( import_entities_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /import/entities]

List the caller's import ledger: staged candidates, running and finished
imports (with the team's imports), and declined items. *)

val track_import_entity :
  foreign_id:string ->
  metadata:Yojson.Safe.t ->
  source:import_source ->
  status:track_import_status ->
  ?entity_id:string ->
  unit ->
  ( track_import_entity_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /import/entities]

Track an external item in the ledger: stage it as a candidate, or record a
Macro entity already created from it. Says when the item was already
imported, so callers do not create a duplicate. *)

val decline_import_entity :
  id:string ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [DELETE /import/entities/{id}]

Decline one of the caller's staged candidates; it is remembered as declined
and not proposed again. *)

val notion_report_handler :
  unit ->
  ( notion_import_report,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /import/notion]

Where the user's Notion workspace import stands. *)

val cancel_notion_handler :
  unit ->
  ( notion_import_report,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /import/notion/cancel]

Stop planning or writing the user's Notion import. Objects already
imported stay. *)

val import_notion_page :
  page:string ->
  unit ->
  ( import_notion_page_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /import/notion/pages]

Import one Notion page as a Macro document through the caller's Notion
connection, deduplicated against the ledger. Notion databases are not
imported; a whole workspace goes through a reviewed import instead. *)

val run_import_handler :
  ?discard_ids:string list ->
  ?import_ids:string list ->
  unit ->
  ( run_import_outcome,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /import/run]

Accept staged imports (starts import jobs) and/or discard staged rows. *)

val discover_handler :
  source:string ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [POST /import/runs/{source}/discover]

Discover candidates for user selection. Only Slack supports discovery. *)

val get_state_handler :
  unit ->
  (import_state, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [GET /import/state]

Get the authenticated user's import state: discovery runs plus visible
ledger rows. *)

val workspace_report_handler :
  source:import_source ->
  unit ->
  ( notion_import_report,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /import/workspaces/{source}]

Report progress for one reviewed workspace source. *)

val cancel_workspace_handler :
  source:import_source ->
  unit ->
  ( notion_import_report,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /import/workspaces/{source}/cancel]

Cancel this source's plan or write, keeping completed entities. *)

val list_mcp_servers :
  unit -> (server_response list, error_response) Macro_sdk_runtime.Request.t
(** [GET /mcp/servers]

List all MCP servers configured for the authenticated user. *)

val update_mcp_server :
  url:string ->
  ?enabled:bool ->
  ?server_name:string ->
  unit ->
  (server_response, error_response) Macro_sdk_runtime.Request.t
(** [PUT /mcp/servers]

Update an existing MCP server's name or enabled status. *)

val add_mcp_server :
  server_name:string ->
  url:string ->
  unit ->
  (server_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /mcp/servers]

Add a new MCP server for the authenticated user. A URL the user already
has is returned as stored, keeping its credentials. *)

val delete_mcp_server :
  url:string -> unit -> (unit, error_response) Macro_sdk_runtime.Request.t
(** [DELETE /mcp/servers]

Delete an MCP server by URL. *)

val mcp_auth_callback :
  ?code:string ->
  ?state:string ->
  ?error:string ->
  ?error_description:string ->
  unit ->
  (unit, error_response) Macro_sdk_runtime.Request.t
(** [GET /mcp/servers/auth/callback]

OAuth callback endpoint — receives code and state, or an error, from the
authorization server. *)

val mcp_oauth_client_metadata :
  unit -> (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [GET /mcp/servers/auth/client-metadata]

Return Macro's public OAuth Client ID Metadata Document. *)

val start_mcp_auth :
  server_name:string ->
  server_url:string ->
  unit ->
  (start_auth_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /mcp/servers/auth/start]

Start the OAuth authorization flow for an MCP server. *)

val get_memory_handler :
  unit -> (memory_response, memory_error_body) Macro_sdk_runtime.Request.t
(** [GET /memory]

Get the authenticated user's latest memory. *)

val get_user_activity :
  start:string ->
  end_:string ->
  ?user:string ->
  unit ->
  (activity_reports, memory_error_body) Macro_sdk_runtime.Request.t
(** [GET /memory/activity]

Read privacy-reviewed professional activity of the caller or a current teammate. *)

val read_explicit_memory :
  unit -> (explicit_memory, memory_error_body) Macro_sdk_runtime.Request.t
(** [GET /memory/explicit]

Read the caller's private explicit memory and its revision. *)

val edit_explicit_memory :
  edit:memory_edit ->
  revision:int64 ->
  unit ->
  (explicit_memory, memory_error_body) Macro_sdk_runtime.Request.t
(** [PATCH /memory/explicit]

Apply one edit to the caller's private explicit memory. *)

val get_state_handler_2 :
  unit ->
  ( onboarding_state,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /onboarding]

Get the authenticated user's onboarding state. *)

val complete_handler :
  ?skipped:bool ->
  unit ->
  ( onboarding_row,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /onboarding/complete]

Complete (or skip) onboarding. Unreserved leftover onboarding-staged
import candidates are deleted. *)

val dismissed_prompts_handler :
  unit ->
  ( dismissed_prompts,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /onboarding/prompts]

List the sidebar prompts the authenticated user dismissed on any device. *)

val dismiss_prompt_handler :
  prompt_id:string ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [POST /onboarding/prompts/{prompt_id}/dismiss]

Dismiss one sidebar prompt for the authenticated user, on every device.
Idempotent. *)

val browse_pipedream_mcp_catalog :
  ?search:string ->
  ?cursor:string ->
  ?limit:int ->
  unit ->
  (pipedream_catalog_response, error_response) Macro_sdk_runtime.Request.t
(** [GET /pipedream/mcp/catalog]

Browse or search the catalog of connectable apps. *)

val complete_pipedream_mcp_connection :
  account_id:string ->
  ?server_name:string ->
  unit ->
  (pipedream_connection_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /pipedream/mcp/complete]

Register a connected account reported by the Pipedream Connect UI. *)

val complete_pipedream_mcp_connect :
  app_slug:string ->
  ?server_name:string ->
  unit ->
  (pipedream_connection_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /pipedream/mcp/connect/complete]

Record an app the user connected through Macro Connect. *)

val list_pipedream_mcp_connections :
  unit ->
  ( pipedream_connection_response list,
    error_response )
  Macro_sdk_runtime.Request.t
(** [GET /pipedream/mcp/connections]

List the MCP apps connected by the authenticated user. *)

val update_pipedream_mcp_connection :
  app_slug:string ->
  ?enabled:bool ->
  ?server_name:string ->
  unit ->
  (pipedream_connection_response, error_response) Macro_sdk_runtime.Request.t
(** [PUT /pipedream/mcp/connections]

Rename or enable/disable a connected app. *)

val delete_pipedream_mcp_connection :
  app_slug:string -> unit -> (unit, error_response) Macro_sdk_runtime.Request.t
(** [DELETE /pipedream/mcp/connections]

Disconnect an app, revoking its Pipedream account. *)

val list_pipedream_mcp_overlays :
  unit ->
  (pipedream_overlay_response list, error_response) Macro_sdk_runtime.Request.t
(** [GET /pipedream/mcp/overlays]

List the catalog apps that connect through their own MCP server. *)

val recover_pipedream_mcp_connection :
  app_slug:string ->
  ?server_name:string ->
  unit ->
  (pipedream_connection_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /pipedream/mcp/recover]

Register an account a Connect flow created but the Connect UI never
reported. *)

val create_pipedream_mcp_token :
  ?body:pipedream_token_request option ->
  unit ->
  (pipedream_token_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /pipedream/mcp/token]

Start a connect flow for the authenticated user. *)

val get_batch_preview :
  chat_ids:string list ->
  unit ->
  ( get_batch_preview_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /preview] *)

val list_skills :
  ?query:string ->
  ?match_type:skills_match_type ->
  unit ->
  (skills_response, skill_error_body) Macro_sdk_runtime.Request.t
(** [GET /skills]

List the caller's skills, or search them by name when [query] is given.
Built-in skills are included. *)

val read_skill :
  id:string ->
  unit ->
  (skill_content_response, skill_error_body) Macro_sdk_runtime.Request.t
(** [GET /skills/{id}]

Read one skill's complete instructions: a skill document the caller can
view, or a built-in skill. *)

val send_chat_message :
  content:string ->
  model:string ->
  ?additional_instructions:string ->
  ?attachments:entity list ->
  ?chat_id:string ->
  ?speed:model_speed ->
  ?toolset:tool_set ->
  unit ->
  (send_chat_message_response, chat_message_error) Macro_sdk_runtime.Request.t
(** [POST /stream/chat/message]

Send a new chat message and stream the AI response. *)

val stop_chat_stream :
  chat_id:string ->
  stream_id:string ->
  unit ->
  ( stop_chat_stream_response,
    stop_chat_stream_error )
  Macro_sdk_runtime.Request.t
(** [POST /stream/chat/message/stop]

Stop an in-flight AI chat stream. *)

val structured_completion :
  model:string ->
  output_schema:dynamic_schema ->
  prompt:string ->
  ?additional_instructions:string ->
  ?thinking:completion_thinking ->
  ?toolset:tool_set ->
  unit ->
  ( structured_completion_response,
    structured_completion_error )
  Macro_sdk_runtime.Request.t
(** [POST /structured-completion] *)

val fetch_web_page :
  url:string ->
  ?max_chars:int ->
  unit ->
  (web_fetch_response, web_error_body) Macro_sdk_runtime.Request.t
(** [POST /web/fetch]

Read one public web page as Markdown. Charged to the acting user's AI allowance. *)

val search_web :
  query:string ->
  ?domains:string list ->
  ?exclude_domains:string list ->
  ?include_content:bool ->
  ?max_results:int ->
  ?since:string ->
  ?topic:web_search_topic ->
  unit ->
  (web_search_response, web_error_body) Macro_sdk_runtime.Request.t
(** [POST /web/search]

Search the public web. Charged to the acting user's AI allowance. *)
