(* Generated from packages/sdk/specs/cognition.json by packages/sdk-ocaml/gen. Do not edit. *)

module Json = Macro_sdk_runtime.Json
module Request = Macro_sdk_runtime.Request

(** Ordered from least to most access top -> bottom *)
type nonrec access_level =
  | View
  | Comment
  | Edit
  | Owner
  | Unknown of string  (** A value this SDK version does not know. *)

let access_level_of_yojson : Yojson.Safe.t -> access_level =
 fun json ->
  match Json.string json with
  | "view" -> View
  | "comment" -> Comment
  | "edit" -> Edit
  | "owner" -> Owner
  | other -> Unknown other

and yojson_of_access_level : access_level -> Yojson.Safe.t =
 fun value ->
  match value with
  | View -> `String "view"
  | Comment -> `String "comment"
  | Edit -> `String "edit"
  | Owner -> `String "owner"
  | Unknown other -> `String other

(** Fixed calendar granularity, always in UTC, with Monday-start weeks. *)
type nonrec granularity =
  | Day
  | Week
  | Month
  | Summary
  | Unknown of string  (** A value this SDK version does not know. *)

let granularity_of_yojson : Yojson.Safe.t -> granularity =
 fun json ->
  match Json.string json with
  | "day" -> Day
  | "week" -> Week
  | "month" -> Month
  | "summary" -> Summary
  | other -> Unknown other

and yojson_of_granularity : granularity -> Yojson.Safe.t =
 fun value ->
  match value with
  | Day -> `String "day"
  | Week -> `String "week"
  | Month -> `String "month"
  | Summary -> `String "summary"
  | Unknown other -> `String other

type nonrec activity = {
  content : string;
  granularity : granularity;
  period_end : string;
  period_start : string;
}
(** A privacy-reviewed activity report; period_end is inclusive. *)

let activity_of_yojson : Yojson.Safe.t -> activity =
 fun json ->
  let fields = Json.obj json in
  {
    content = Json.required fields "content" Json.string;
    granularity = Json.required fields "granularity" granularity_of_yojson;
    period_end = Json.required fields "periodEnd" Json.string;
    period_start = Json.required fields "periodStart" Json.string;
  }

and yojson_of_activity : activity -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("content", Some (Json.of_string value.content));
      ("granularity", Some (yojson_of_granularity value.granularity));
      ("periodEnd", Some (Json.of_string value.period_end));
      ("periodStart", Some (Json.of_string value.period_start));
    ]

let make_activity ~(content : string) ~(granularity : granularity)
    ~(period_end : string) ~(period_start : string) () =
  ({ content; granularity; period_end; period_start } : activity)

type nonrec activity_error_body = { error : string  (** Error description. *) }
(** Error body for activity reads. *)

let activity_error_body_of_yojson : Yojson.Safe.t -> activity_error_body =
 fun json ->
  let fields = Json.obj json in
  { error = Json.required fields "error" Json.string }

and yojson_of_activity_error_body : activity_error_body -> Yojson.Safe.t =
 fun value -> Json.record [ ("error", Some (Json.of_string value.error)) ]

let make_activity_error_body ~(error : string) () =
  ({ error } : activity_error_body)

type nonrec activity_reports = { reports : activity list }
(** Activity reports for one user, ordered by period. *)

let activity_reports_of_yojson : Yojson.Safe.t -> activity_reports =
 fun json ->
  let fields = Json.obj json in
  { reports = Json.required fields "reports" (Json.list activity_of_yojson) }

and yojson_of_activity_reports : activity_reports -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("reports", Some ((Json.of_list yojson_of_activity) value.reports)) ]

let make_activity_reports ~(reports : activity list) () =
  ({ reports } : activity_reports)

type nonrec add_server_request = {
  server_name : string;  (** Human-readable name for the server. *)
  url : string;  (** The MCP server's streamable HTTP URL. *)
}
(** Request body for adding a new MCP server. *)

let add_server_request_of_yojson : Yojson.Safe.t -> add_server_request =
 fun json ->
  let fields = Json.obj json in
  {
    server_name = Json.required fields "server_name" Json.string;
    url = Json.required fields "url" Json.string;
  }

and yojson_of_add_server_request : add_server_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("server_name", Some (Json.of_string value.server_name));
      ("url", Some (Json.of_string value.url));
    ]

let make_add_server_request ~(server_name : string) ~(url : string) () =
  ({ server_name; url } : add_server_request)

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

let ai_feature_of_yojson : Yojson.Safe.t -> ai_feature =
 fun json ->
  match Json.string json with
  | "chat" -> Chat
  | "memory" -> Memory
  | "automation" -> Automation
  | "dynamic_completions_api" -> Dynamic_completions_api
  | "chat_rename" -> Chat_rename
  | "call_summary" -> Call_summary
  | "channel_bot" -> Channel_bot
  | "ai_projection" -> Ai_projection
  | "ai_editing" -> Ai_editing
  | "import" -> Import
  | "agent_session" -> Agent_session
  | "agent_repository_choice" -> Agent_repository_choice
  | "agent_mode_choice" -> Agent_mode_choice
  | "agent_activity_summary" -> Agent_activity_summary
  | "dictation" -> Dictation
  | "image_generation" -> Image_generation
  | "email_focus" -> Email_focus
  | "web_search" -> Web_search
  | "non_billable_agent_session" -> Non_billable_agent_session
  | other -> Unknown other

and yojson_of_ai_feature : ai_feature -> Yojson.Safe.t =
 fun value ->
  match value with
  | Chat -> `String "chat"
  | Memory -> `String "memory"
  | Automation -> `String "automation"
  | Dynamic_completions_api -> `String "dynamic_completions_api"
  | Chat_rename -> `String "chat_rename"
  | Call_summary -> `String "call_summary"
  | Channel_bot -> `String "channel_bot"
  | Ai_projection -> `String "ai_projection"
  | Ai_editing -> `String "ai_editing"
  | Import -> `String "import"
  | Agent_session -> `String "agent_session"
  | Agent_repository_choice -> `String "agent_repository_choice"
  | Agent_mode_choice -> `String "agent_mode_choice"
  | Agent_activity_summary -> `String "agent_activity_summary"
  | Dictation -> `String "dictation"
  | Image_generation -> `String "image_generation"
  | Email_focus -> `String "email_focus"
  | Web_search -> `String "web_search"
  | Non_billable_agent_session -> `String "non_billable_agent_session"
  | Unknown other -> `String other

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

let assistant_message_part_of_yojson : Yojson.Safe.t -> assistant_message_part =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "type" with
  | "text" -> Text { text = Json.required fields "text" Json.string }
  | "toolCall" ->
      Tool_call
        {
          id = Json.required fields "id" Json.string;
          json = Json.required fields "json" Json.json;
          name = Json.required fields "name" Json.string;
        }
  | "mcpToolCall" ->
      Mcp_tool_call
        {
          display_name = Json.optional fields "display_name" Json.string;
          id = Json.required fields "id" Json.string;
          json = Json.required fields "json" Json.json;
          name = Json.required fields "name" Json.string;
          service = Json.required fields "service" Json.string;
        }
  | "toolCallResponseJson" ->
      Tool_call_response_json
        {
          id = Json.required fields "id" Json.string;
          json = Json.required fields "json" Json.json;
          name = Json.required fields "name" Json.string;
        }
  | "toolCallErr" ->
      Tool_call_err
        {
          description = Json.required fields "description" Json.string;
          id = Json.required fields "id" Json.string;
          name = Json.required fields "name" Json.string;
        }
  | "thinking" ->
      Thinking { thinking = Json.required fields "thinking" Json.string }
  | _ -> Unknown json

and yojson_of_assistant_message_part : assistant_message_part -> Yojson.Safe.t =
 fun value ->
  match value with
  | Text case ->
      Json.record
        [
          ("type", Some (`String "text"));
          ("text", Some (Json.of_string case.text));
        ]
  | Tool_call case ->
      Json.record
        [
          ("type", Some (`String "toolCall"));
          ("id", Some (Json.of_string case.id));
          ("json", Some (Json.of_json case.json));
          ("name", Some (Json.of_string case.name));
        ]
  | Mcp_tool_call case ->
      Json.record
        [
          ("type", Some (`String "mcpToolCall"));
          ("display_name", Option.map Json.of_string case.display_name);
          ("id", Some (Json.of_string case.id));
          ("json", Some (Json.of_json case.json));
          ("name", Some (Json.of_string case.name));
          ("service", Some (Json.of_string case.service));
        ]
  | Tool_call_response_json case ->
      Json.record
        [
          ("type", Some (`String "toolCallResponseJson"));
          ("id", Some (Json.of_string case.id));
          ("json", Some (Json.of_json case.json));
          ("name", Some (Json.of_string case.name));
        ]
  | Tool_call_err case ->
      Json.record
        [
          ("type", Some (`String "toolCallErr"));
          ("description", Some (Json.of_string case.description));
          ("id", Some (Json.of_string case.id));
          ("name", Some (Json.of_string case.name));
        ]
  | Thinking case ->
      Json.record
        [
          ("type", Some (`String "thinking"));
          ("thinking", Some (Json.of_string case.thinking));
        ]
  | Unknown json -> json

let make_assistant_message_part_text ~(text : string) () =
  (Text { text } : assistant_message_part)

let make_assistant_message_part_tool_call ~(id : string) ~(json : Yojson.Safe.t)
    ~(name : string) () =
  (Tool_call { id; json; name } : assistant_message_part)

let make_assistant_message_part_mcp_tool_call ?display_name ~(id : string)
    ~(json : Yojson.Safe.t) ~(name : string) ~(service : string) () =
  (Mcp_tool_call { display_name; id; json; name; service }
    : assistant_message_part)

let make_assistant_message_part_tool_call_response_json ~(id : string)
    ~(json : Yojson.Safe.t) ~(name : string) () =
  (Tool_call_response_json { id; json; name } : assistant_message_part)

let make_assistant_message_part_tool_call_err ~(description : string)
    ~(id : string) ~(name : string) () =
  (Tool_call_err { description; id; name } : assistant_message_part)

let make_assistant_message_part_thinking ~(thinking : string) () =
  (Thinking { thinking } : assistant_message_part)

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

let file_type_of_yojson : Yojson.Safe.t -> file_type =
 fun json ->
  match Json.string json with
  | "docx" -> Docx
  | "pdf" -> Pdf
  | "md" -> Md
  | "spreadsheet" -> Spreadsheet
  | "canvas" -> Canvas
  | "coffee" -> Coffee
  | "cson" -> Cson
  | "iced" -> Iced
  | "c" -> C
  | "i" -> I
  | "cpp" -> Cpp
  | "cppm" -> Cppm
  | "cc" -> Cc
  | "ccm" -> Ccm
  | "cxx" -> Cxx
  | "cxxm" -> Cxxm
  | "cplusplus" -> Cplusplus
  | "cplusplusm" -> Cplusplusm
  | "hpp" -> Hpp
  | "hh" -> Hh
  | "hxx" -> Hxx
  | "hplusplus" -> Hplusplus
  | "h" -> H
  | "ii" -> Ii
  | "ino" -> Ino
  | "inl" -> Inl
  | "ipp" -> Ipp
  | "ixx" -> Ixx
  | "tpp" -> Tpp
  | "txx" -> Txx
  | "hppin" -> Hppin
  | "hin" -> Hin
  | "cu" -> Cu
  | "cuh" -> Cuh
  | "cs" -> Cs
  | "csx" -> Csx
  | "cake" -> Cake
  | "css" -> Css
  | "dart" -> Dart
  | "diff" -> Diff
  | "patch" -> Patch
  | "rej" -> Rej
  | "dockerfile" -> Dockerfile
  | "containerfile" -> Containerfile
  | "go" -> Go
  | "handlebars" -> Handlebars
  | "hbs" -> Hbs
  | "hjs" -> Hjs
  | "hlsl" -> Hlsl
  | "hlsli" -> Hlsli
  | "fx" -> Fx
  | "fxh" -> Fxh
  | "vsh" -> Vsh
  | "psh" -> Psh
  | "cginc" -> Cginc
  | "compute" -> Compute
  | "html" -> Html
  | "htm" -> Htm
  | "shtml" -> Shtml
  | "xhtml" -> Xhtml
  | "xht" -> Xht
  | "mdoc" -> Mdoc
  | "jsp" -> Jsp
  | "asp" -> Asp
  | "aspx" -> Aspx
  | "jshtm" -> Jshtm
  | "volt" -> Volt
  | "ejs" -> Ejs
  | "rhtml" -> Rhtml
  | "ini" -> Ini
  | "conf" -> Conf
  | "properties" -> Properties
  | "cfg" -> Cfg
  | "directory" -> Directory
  | "gitattributes" -> Gitattributes
  | "gitconfig" -> Gitconfig
  | "gitmodules" -> Gitmodules
  | "editorconfig" -> Editorconfig
  | "repo" -> Repo
  | "java" -> Java
  | "jav" -> Jav
  | "jsx" -> Jsx
  | "js" -> Js
  | "es6" -> Es6
  | "mjs" -> Mjs
  | "cjs" -> Cjs
  | "pac" -> Pac
  | "json" -> Json
  | "bowerrc" -> Bowerrc
  | "jscsrc" -> Jscsrc
  | "webmanifest" -> Webmanifest
  | "jsmap" -> Jsmap
  | "cssmap" -> Cssmap
  | "tsmap" -> Tsmap
  | "har" -> Har
  | "jslintrc" -> Jslintrc
  | "jsonld" -> Jsonld
  | "geojson" -> Geojson
  | "ipynb" -> Ipynb
  | "vuerc" -> Vuerc
  | "jsonc" -> Jsonc
  | "eslintrc" -> Eslintrc
  | "eslintrcjson" -> Eslintrcjson
  | "jsfmtrc" -> Jsfmtrc
  | "jshintrc" -> Jshintrc
  | "swcrc" -> Swcrc
  | "hintrc" -> Hintrc
  | "babelrc" -> Babelrc
  | "jsonl" -> Jsonl
  | "ndjson" -> Ndjson
  | "codesnippets" -> Codesnippets
  | "jl" -> Jl
  | "jmd" -> Jmd
  | "sty" -> Sty
  | "cls" -> Cls
  | "bbx" -> Bbx
  | "cbx" -> Cbx
  | "tex" -> Tex
  | "ltx" -> Ltx
  | "ctx" -> Ctx
  | "bib" -> Bib
  | "less" -> Less
  | "log" -> Log
  | "lua" -> Lua
  | "mak" -> Mak
  | "mk" -> Mk
  | "mkd" -> Mkd
  | "mdwn" -> Mdwn
  | "mdown" -> Mdown
  | "markdown" -> Markdown
  | "markdn" -> Markdn
  | "mdtxt" -> Mdtxt
  | "mdtext" -> Mdtext
  | "workbook" -> Workbook
  | "m" -> M
  | "mm" -> Mm
  | "pl" -> Pl
  | "pm" -> Pm
  | "pod" -> Pod
  | "t" -> T
  | "psgi" -> Psgi
  | "raku" -> Raku
  | "rakumod" -> Rakumod
  | "rakutest" -> Rakutest
  | "rakudoc" -> Rakudoc
  | "nqp" -> Nqp
  | "p6" -> P6
  | "pl6" -> Pl6
  | "pm6" -> Pm6
  | "php" -> Php
  | "php4" -> Php4
  | "php5" -> Php5
  | "phtml" -> Phtml
  | "ctp" -> Ctp
  | "ps1" -> Ps1
  | "psm1" -> Psm1
  | "psd1" -> Psd1
  | "pssc" -> Pssc
  | "psrc" -> Psrc
  | "py" -> Py
  | "rpy" -> Rpy
  | "pyw" -> Pyw
  | "cpy" -> Cpy
  | "gyp" -> Gyp
  | "gypi" -> Gypi
  | "pyi" -> Pyi
  | "ipy" -> Ipy
  | "pyt" -> Pyt
  | "r" -> R
  | "rhistory" -> Rhistory
  | "rprofile" -> Rprofile
  | "rt" -> Rt
  | "cshtml" -> Cshtml
  | "razor" -> Razor
  | "rb" -> Rb
  | "rbx" -> Rbx
  | "rjs" -> Rjs
  | "gemspec" -> Gemspec
  | "rake" -> Rake
  | "ru" -> Ru
  | "erb" -> Erb
  | "podspec" -> Podspec
  | "rbi" -> Rbi
  | "rs" -> Rs
  | "scss" -> Scss
  | "sass" -> Sass
  | "shader" -> Shader
  | "sh" -> Sh
  | "bash" -> Bash
  | "bashrc" -> Bashrc
  | "bashaliases" -> Bashaliases
  | "bashprofile" -> Bashprofile
  | "bashlogin" -> Bashlogin
  | "ebuild" -> Ebuild
  | "eclass" -> Eclass
  | "profile" -> Profile
  | "bashlogout" -> Bashlogout
  | "xprofile" -> Xprofile
  | "xsession" -> Xsession
  | "xsessionrc" -> Xsessionrc
  | "zsh" -> Zsh
  | "zshrc" -> Zshrc
  | "zprofile" -> Zprofile
  | "zlogin" -> Zlogin
  | "zlogout" -> Zlogout
  | "zshenv" -> Zshenv
  | "zshtheme" -> Zshtheme
  | "fish" -> Fish
  | "ksh" -> Ksh
  | "csh" -> Csh
  | "cshrc" -> Cshrc
  | "tcshrc" -> Tcshrc
  | "yashrc" -> Yashrc
  | "yashprofile" -> Yashprofile
  | "sql" -> Sql
  | "dsql" -> Dsql
  | "swift" -> Swift
  | "ts" -> Ts
  | "cts" -> Cts
  | "mts" -> Mts
  | "tsx" -> Tsx
  | "tsbuildinfo" -> Tsbuildinfo
  | "xml" -> Xml
  | "xsd" -> Xsd
  | "ascx" -> Ascx
  | "atom" -> Atom
  | "axml" -> Axml
  | "axaml" -> Axaml
  | "bpmn" -> Bpmn
  | "cpt" -> Cpt
  | "csl" -> Csl
  | "csproj" -> Csproj
  | "csprojuser" -> Csprojuser
  | "dita" -> Dita
  | "ditamap" -> Ditamap
  | "dtd" -> Dtd
  | "ent" -> Ent
  | "mod" -> Mod
  | "dtml" -> Dtml
  | "fsproj" -> Fsproj
  | "fxml" -> Fxml
  | "iml" -> Iml
  | "isml" -> Isml
  | "jmx" -> Jmx
  | "launch" -> Launch
  | "menu" -> Menu
  | "mxml" -> Mxml
  | "nuspec" -> Nuspec
  | "opml" -> Opml
  | "owl" -> Owl
  | "proj" -> Proj
  | "props" -> Props
  | "pt" -> Pt
  | "publishsettings" -> Publishsettings
  | "pubxml" -> Pubxml
  | "pubxmluser" -> Pubxmluser
  | "rbxlx" -> Rbxlx
  | "rbxmx" -> Rbxmx
  | "rdf" -> Rdf
  | "rng" -> Rng
  | "rss" -> Rss
  | "shproj" -> Shproj
  | "storyboard" -> Storyboard
  | "targets" -> Targets
  | "tld" -> Tld
  | "tmx" -> Tmx
  | "vbproj" -> Vbproj
  | "vbprojuser" -> Vbprojuser
  | "vcxproj" -> Vcxproj
  | "vcxprojfilters" -> Vcxprojfilters
  | "wsdl" -> Wsdl
  | "wxi" -> Wxi
  | "wxl" -> Wxl
  | "wxs" -> Wxs
  | "xaml" -> Xaml
  | "xbl" -> Xbl
  | "xib" -> Xib
  | "xlf" -> Xlf
  | "xliff" -> Xliff
  | "xpdl" -> Xpdl
  | "xul" -> Xul
  | "xoml" -> Xoml
  | "xsl" -> Xsl
  | "xslt" -> Xslt
  | "yaml" -> Yaml
  | "yml" -> Yml
  | "eyaml" -> Eyaml
  | "eyml" -> Eyml
  | "cff" -> Cff
  | "yamltmlanguage" -> Yamltmlanguage
  | "yamltmpreferences" -> Yamltmpreferences
  | "yamltmtheme" -> Yamltmtheme
  | "winget" -> Winget
  | "txt" -> Txt
  | "csv" -> Csv
  | "tsv" -> Tsv
  | "jpeg" -> Jpeg
  | "jpg" -> Jpg
  | "png" -> Png
  | "gif" -> Gif
  | "svg" -> Svg
  | "webp" -> Webp
  | "avif" -> Avif
  | "bmp" -> Bmp
  | "ico" -> Ico
  | "tiff" -> Tiff
  | "tif" -> Tif
  | "heic" -> Heic
  | "heif" -> Heif
  | "tar" -> Tar
  | "targz" -> Targz
  | "tgz" -> Tgz
  | "gz" -> Gz
  | "bz2" -> Bz2
  | "tarbz2" -> Tarbz2
  | "tbz2" -> Tbz2
  | "z" -> Z
  | "tarz" -> Tarz
  | "lz" -> Lz
  | "tarlz" -> Tarlz
  | "xz" -> Xz
  | "tarxz" -> Tarxz
  | "txz" -> Txz
  | "lzma" -> Lzma
  | "tarlzma" -> Tarlzma
  | "rar" -> Rar
  | "sevenz" -> Sevenz
  | "zst" -> Zst
  | "tarzst" -> Tarzst
  | "tzst" -> Tzst
  | "zip" -> Zip
  | "exe" -> Exe
  | "msi" -> Msi
  | "dll" -> Dll
  | "bat" -> Bat
  | "cmd" -> Cmd
  | "com" -> Com
  | "appimage" -> Appimage
  | "app" -> App
  | "bin" -> Bin
  | "deb" -> Deb
  | "rpm" -> Rpm
  | "apk" -> Apk
  | "dmg" -> Dmg
  | "pkg" -> Pkg
  | "crx" -> Crx
  | "xpi" -> Xpi
  | "mp3" -> Mp3
  | "wav" -> Wav
  | "ogg" -> Ogg
  | "flac" -> Flac
  | "aac" -> Aac
  | "m4a" -> M4a
  | "wma" -> Wma
  | "mid" -> Mid
  | "midi" -> Midi
  | "mp4" -> Mp4
  | "mkv" -> Mkv
  | "webm" -> Webm
  | "avi" -> Avi
  | "mov" -> Mov
  | "wmv" -> Wmv
  | "mpg" -> Mpg
  | "mpeg" -> Mpeg
  | "m4v" -> M4v
  | "flv" -> Flv
  | "f4v" -> F4v
  | "threegp" -> Threegp
  | "ttf" -> Ttf
  | "otf" -> Otf
  | "woff" -> Woff
  | "woff2" -> Woff2
  | "eot" -> Eot
  | "rtf" -> Rtf
  | "odt" -> Odt
  | "ods" -> Ods
  | "odp" -> Odp
  | "odg" -> Odg
  | "odf" -> Odf
  | "epub" -> Epub
  | "mobi" -> Mobi
  | "azw" -> Azw
  | "azw3" -> Azw3
  | "djvu" -> Djvu
  | "xls" -> Xls
  | "xlsm" -> Xlsm
  | "ppt" -> Ppt
  | "doc" -> Doc
  | "pptx" -> Pptx
  | "xlsx" -> Xlsx
  | "db" -> Db
  | "sqlite" -> Sqlite
  | "sqlite3" -> Sqlite3
  | "mdb" -> Mdb
  | "accdb" -> Accdb
  | "dbf" -> Dbf
  | "plist" -> Plist
  | "toml" -> Toml
  | "env" -> Env
  | "dot" -> Dot
  | "gv" -> Gv
  | "torrent" -> Torrent
  | "ics" -> Ics
  | "vcf" -> Vcf
  | "ai" -> Ai
  | "eps" -> Eps
  | "ps" -> Ps
  | "dxf" -> Dxf
  | "dwg" -> Dwg
  | "fig" -> Fig
  | "psd" -> Psd
  | "psb" -> Psb
  | "stl" -> Stl
  | "obj" -> Obj
  | "fbx" -> Fbx
  | "blend" -> Blend
  | "dae" -> Dae
  | "threeds" -> Threeds
  | "gltf" -> Gltf
  | "glb" -> Glb
  | "vhd" -> Vhd
  | "vhdx" -> Vhdx
  | "vmdk" -> Vmdk
  | "ova" -> Ova
  | "ovf" -> Ovf
  | "iso" -> Iso
  | "img" -> Img
  | "swf" -> Swf
  | other -> Unknown other

and yojson_of_file_type : file_type -> Yojson.Safe.t =
 fun value ->
  match value with
  | Docx -> `String "docx"
  | Pdf -> `String "pdf"
  | Md -> `String "md"
  | Spreadsheet -> `String "spreadsheet"
  | Canvas -> `String "canvas"
  | Coffee -> `String "coffee"
  | Cson -> `String "cson"
  | Iced -> `String "iced"
  | C -> `String "c"
  | I -> `String "i"
  | Cpp -> `String "cpp"
  | Cppm -> `String "cppm"
  | Cc -> `String "cc"
  | Ccm -> `String "ccm"
  | Cxx -> `String "cxx"
  | Cxxm -> `String "cxxm"
  | Cplusplus -> `String "cplusplus"
  | Cplusplusm -> `String "cplusplusm"
  | Hpp -> `String "hpp"
  | Hh -> `String "hh"
  | Hxx -> `String "hxx"
  | Hplusplus -> `String "hplusplus"
  | H -> `String "h"
  | Ii -> `String "ii"
  | Ino -> `String "ino"
  | Inl -> `String "inl"
  | Ipp -> `String "ipp"
  | Ixx -> `String "ixx"
  | Tpp -> `String "tpp"
  | Txx -> `String "txx"
  | Hppin -> `String "hppin"
  | Hin -> `String "hin"
  | Cu -> `String "cu"
  | Cuh -> `String "cuh"
  | Cs -> `String "cs"
  | Csx -> `String "csx"
  | Cake -> `String "cake"
  | Css -> `String "css"
  | Dart -> `String "dart"
  | Diff -> `String "diff"
  | Patch -> `String "patch"
  | Rej -> `String "rej"
  | Dockerfile -> `String "dockerfile"
  | Containerfile -> `String "containerfile"
  | Go -> `String "go"
  | Handlebars -> `String "handlebars"
  | Hbs -> `String "hbs"
  | Hjs -> `String "hjs"
  | Hlsl -> `String "hlsl"
  | Hlsli -> `String "hlsli"
  | Fx -> `String "fx"
  | Fxh -> `String "fxh"
  | Vsh -> `String "vsh"
  | Psh -> `String "psh"
  | Cginc -> `String "cginc"
  | Compute -> `String "compute"
  | Html -> `String "html"
  | Htm -> `String "htm"
  | Shtml -> `String "shtml"
  | Xhtml -> `String "xhtml"
  | Xht -> `String "xht"
  | Mdoc -> `String "mdoc"
  | Jsp -> `String "jsp"
  | Asp -> `String "asp"
  | Aspx -> `String "aspx"
  | Jshtm -> `String "jshtm"
  | Volt -> `String "volt"
  | Ejs -> `String "ejs"
  | Rhtml -> `String "rhtml"
  | Ini -> `String "ini"
  | Conf -> `String "conf"
  | Properties -> `String "properties"
  | Cfg -> `String "cfg"
  | Directory -> `String "directory"
  | Gitattributes -> `String "gitattributes"
  | Gitconfig -> `String "gitconfig"
  | Gitmodules -> `String "gitmodules"
  | Editorconfig -> `String "editorconfig"
  | Repo -> `String "repo"
  | Java -> `String "java"
  | Jav -> `String "jav"
  | Jsx -> `String "jsx"
  | Js -> `String "js"
  | Es6 -> `String "es6"
  | Mjs -> `String "mjs"
  | Cjs -> `String "cjs"
  | Pac -> `String "pac"
  | Json -> `String "json"
  | Bowerrc -> `String "bowerrc"
  | Jscsrc -> `String "jscsrc"
  | Webmanifest -> `String "webmanifest"
  | Jsmap -> `String "jsmap"
  | Cssmap -> `String "cssmap"
  | Tsmap -> `String "tsmap"
  | Har -> `String "har"
  | Jslintrc -> `String "jslintrc"
  | Jsonld -> `String "jsonld"
  | Geojson -> `String "geojson"
  | Ipynb -> `String "ipynb"
  | Vuerc -> `String "vuerc"
  | Jsonc -> `String "jsonc"
  | Eslintrc -> `String "eslintrc"
  | Eslintrcjson -> `String "eslintrcjson"
  | Jsfmtrc -> `String "jsfmtrc"
  | Jshintrc -> `String "jshintrc"
  | Swcrc -> `String "swcrc"
  | Hintrc -> `String "hintrc"
  | Babelrc -> `String "babelrc"
  | Jsonl -> `String "jsonl"
  | Ndjson -> `String "ndjson"
  | Codesnippets -> `String "codesnippets"
  | Jl -> `String "jl"
  | Jmd -> `String "jmd"
  | Sty -> `String "sty"
  | Cls -> `String "cls"
  | Bbx -> `String "bbx"
  | Cbx -> `String "cbx"
  | Tex -> `String "tex"
  | Ltx -> `String "ltx"
  | Ctx -> `String "ctx"
  | Bib -> `String "bib"
  | Less -> `String "less"
  | Log -> `String "log"
  | Lua -> `String "lua"
  | Mak -> `String "mak"
  | Mk -> `String "mk"
  | Mkd -> `String "mkd"
  | Mdwn -> `String "mdwn"
  | Mdown -> `String "mdown"
  | Markdown -> `String "markdown"
  | Markdn -> `String "markdn"
  | Mdtxt -> `String "mdtxt"
  | Mdtext -> `String "mdtext"
  | Workbook -> `String "workbook"
  | M -> `String "m"
  | Mm -> `String "mm"
  | Pl -> `String "pl"
  | Pm -> `String "pm"
  | Pod -> `String "pod"
  | T -> `String "t"
  | Psgi -> `String "psgi"
  | Raku -> `String "raku"
  | Rakumod -> `String "rakumod"
  | Rakutest -> `String "rakutest"
  | Rakudoc -> `String "rakudoc"
  | Nqp -> `String "nqp"
  | P6 -> `String "p6"
  | Pl6 -> `String "pl6"
  | Pm6 -> `String "pm6"
  | Php -> `String "php"
  | Php4 -> `String "php4"
  | Php5 -> `String "php5"
  | Phtml -> `String "phtml"
  | Ctp -> `String "ctp"
  | Ps1 -> `String "ps1"
  | Psm1 -> `String "psm1"
  | Psd1 -> `String "psd1"
  | Pssc -> `String "pssc"
  | Psrc -> `String "psrc"
  | Py -> `String "py"
  | Rpy -> `String "rpy"
  | Pyw -> `String "pyw"
  | Cpy -> `String "cpy"
  | Gyp -> `String "gyp"
  | Gypi -> `String "gypi"
  | Pyi -> `String "pyi"
  | Ipy -> `String "ipy"
  | Pyt -> `String "pyt"
  | R -> `String "r"
  | Rhistory -> `String "rhistory"
  | Rprofile -> `String "rprofile"
  | Rt -> `String "rt"
  | Cshtml -> `String "cshtml"
  | Razor -> `String "razor"
  | Rb -> `String "rb"
  | Rbx -> `String "rbx"
  | Rjs -> `String "rjs"
  | Gemspec -> `String "gemspec"
  | Rake -> `String "rake"
  | Ru -> `String "ru"
  | Erb -> `String "erb"
  | Podspec -> `String "podspec"
  | Rbi -> `String "rbi"
  | Rs -> `String "rs"
  | Scss -> `String "scss"
  | Sass -> `String "sass"
  | Shader -> `String "shader"
  | Sh -> `String "sh"
  | Bash -> `String "bash"
  | Bashrc -> `String "bashrc"
  | Bashaliases -> `String "bashaliases"
  | Bashprofile -> `String "bashprofile"
  | Bashlogin -> `String "bashlogin"
  | Ebuild -> `String "ebuild"
  | Eclass -> `String "eclass"
  | Profile -> `String "profile"
  | Bashlogout -> `String "bashlogout"
  | Xprofile -> `String "xprofile"
  | Xsession -> `String "xsession"
  | Xsessionrc -> `String "xsessionrc"
  | Zsh -> `String "zsh"
  | Zshrc -> `String "zshrc"
  | Zprofile -> `String "zprofile"
  | Zlogin -> `String "zlogin"
  | Zlogout -> `String "zlogout"
  | Zshenv -> `String "zshenv"
  | Zshtheme -> `String "zshtheme"
  | Fish -> `String "fish"
  | Ksh -> `String "ksh"
  | Csh -> `String "csh"
  | Cshrc -> `String "cshrc"
  | Tcshrc -> `String "tcshrc"
  | Yashrc -> `String "yashrc"
  | Yashprofile -> `String "yashprofile"
  | Sql -> `String "sql"
  | Dsql -> `String "dsql"
  | Swift -> `String "swift"
  | Ts -> `String "ts"
  | Cts -> `String "cts"
  | Mts -> `String "mts"
  | Tsx -> `String "tsx"
  | Tsbuildinfo -> `String "tsbuildinfo"
  | Xml -> `String "xml"
  | Xsd -> `String "xsd"
  | Ascx -> `String "ascx"
  | Atom -> `String "atom"
  | Axml -> `String "axml"
  | Axaml -> `String "axaml"
  | Bpmn -> `String "bpmn"
  | Cpt -> `String "cpt"
  | Csl -> `String "csl"
  | Csproj -> `String "csproj"
  | Csprojuser -> `String "csprojuser"
  | Dita -> `String "dita"
  | Ditamap -> `String "ditamap"
  | Dtd -> `String "dtd"
  | Ent -> `String "ent"
  | Mod -> `String "mod"
  | Dtml -> `String "dtml"
  | Fsproj -> `String "fsproj"
  | Fxml -> `String "fxml"
  | Iml -> `String "iml"
  | Isml -> `String "isml"
  | Jmx -> `String "jmx"
  | Launch -> `String "launch"
  | Menu -> `String "menu"
  | Mxml -> `String "mxml"
  | Nuspec -> `String "nuspec"
  | Opml -> `String "opml"
  | Owl -> `String "owl"
  | Proj -> `String "proj"
  | Props -> `String "props"
  | Pt -> `String "pt"
  | Publishsettings -> `String "publishsettings"
  | Pubxml -> `String "pubxml"
  | Pubxmluser -> `String "pubxmluser"
  | Rbxlx -> `String "rbxlx"
  | Rbxmx -> `String "rbxmx"
  | Rdf -> `String "rdf"
  | Rng -> `String "rng"
  | Rss -> `String "rss"
  | Shproj -> `String "shproj"
  | Storyboard -> `String "storyboard"
  | Targets -> `String "targets"
  | Tld -> `String "tld"
  | Tmx -> `String "tmx"
  | Vbproj -> `String "vbproj"
  | Vbprojuser -> `String "vbprojuser"
  | Vcxproj -> `String "vcxproj"
  | Vcxprojfilters -> `String "vcxprojfilters"
  | Wsdl -> `String "wsdl"
  | Wxi -> `String "wxi"
  | Wxl -> `String "wxl"
  | Wxs -> `String "wxs"
  | Xaml -> `String "xaml"
  | Xbl -> `String "xbl"
  | Xib -> `String "xib"
  | Xlf -> `String "xlf"
  | Xliff -> `String "xliff"
  | Xpdl -> `String "xpdl"
  | Xul -> `String "xul"
  | Xoml -> `String "xoml"
  | Xsl -> `String "xsl"
  | Xslt -> `String "xslt"
  | Yaml -> `String "yaml"
  | Yml -> `String "yml"
  | Eyaml -> `String "eyaml"
  | Eyml -> `String "eyml"
  | Cff -> `String "cff"
  | Yamltmlanguage -> `String "yamltmlanguage"
  | Yamltmpreferences -> `String "yamltmpreferences"
  | Yamltmtheme -> `String "yamltmtheme"
  | Winget -> `String "winget"
  | Txt -> `String "txt"
  | Csv -> `String "csv"
  | Tsv -> `String "tsv"
  | Jpeg -> `String "jpeg"
  | Jpg -> `String "jpg"
  | Png -> `String "png"
  | Gif -> `String "gif"
  | Svg -> `String "svg"
  | Webp -> `String "webp"
  | Avif -> `String "avif"
  | Bmp -> `String "bmp"
  | Ico -> `String "ico"
  | Tiff -> `String "tiff"
  | Tif -> `String "tif"
  | Heic -> `String "heic"
  | Heif -> `String "heif"
  | Tar -> `String "tar"
  | Targz -> `String "targz"
  | Tgz -> `String "tgz"
  | Gz -> `String "gz"
  | Bz2 -> `String "bz2"
  | Tarbz2 -> `String "tarbz2"
  | Tbz2 -> `String "tbz2"
  | Z -> `String "z"
  | Tarz -> `String "tarz"
  | Lz -> `String "lz"
  | Tarlz -> `String "tarlz"
  | Xz -> `String "xz"
  | Tarxz -> `String "tarxz"
  | Txz -> `String "txz"
  | Lzma -> `String "lzma"
  | Tarlzma -> `String "tarlzma"
  | Rar -> `String "rar"
  | Sevenz -> `String "sevenz"
  | Zst -> `String "zst"
  | Tarzst -> `String "tarzst"
  | Tzst -> `String "tzst"
  | Zip -> `String "zip"
  | Exe -> `String "exe"
  | Msi -> `String "msi"
  | Dll -> `String "dll"
  | Bat -> `String "bat"
  | Cmd -> `String "cmd"
  | Com -> `String "com"
  | Appimage -> `String "appimage"
  | App -> `String "app"
  | Bin -> `String "bin"
  | Deb -> `String "deb"
  | Rpm -> `String "rpm"
  | Apk -> `String "apk"
  | Dmg -> `String "dmg"
  | Pkg -> `String "pkg"
  | Crx -> `String "crx"
  | Xpi -> `String "xpi"
  | Mp3 -> `String "mp3"
  | Wav -> `String "wav"
  | Ogg -> `String "ogg"
  | Flac -> `String "flac"
  | Aac -> `String "aac"
  | M4a -> `String "m4a"
  | Wma -> `String "wma"
  | Mid -> `String "mid"
  | Midi -> `String "midi"
  | Mp4 -> `String "mp4"
  | Mkv -> `String "mkv"
  | Webm -> `String "webm"
  | Avi -> `String "avi"
  | Mov -> `String "mov"
  | Wmv -> `String "wmv"
  | Mpg -> `String "mpg"
  | Mpeg -> `String "mpeg"
  | M4v -> `String "m4v"
  | Flv -> `String "flv"
  | F4v -> `String "f4v"
  | Threegp -> `String "threegp"
  | Ttf -> `String "ttf"
  | Otf -> `String "otf"
  | Woff -> `String "woff"
  | Woff2 -> `String "woff2"
  | Eot -> `String "eot"
  | Rtf -> `String "rtf"
  | Odt -> `String "odt"
  | Ods -> `String "ods"
  | Odp -> `String "odp"
  | Odg -> `String "odg"
  | Odf -> `String "odf"
  | Epub -> `String "epub"
  | Mobi -> `String "mobi"
  | Azw -> `String "azw"
  | Azw3 -> `String "azw3"
  | Djvu -> `String "djvu"
  | Xls -> `String "xls"
  | Xlsm -> `String "xlsm"
  | Ppt -> `String "ppt"
  | Doc -> `String "doc"
  | Pptx -> `String "pptx"
  | Xlsx -> `String "xlsx"
  | Db -> `String "db"
  | Sqlite -> `String "sqlite"
  | Sqlite3 -> `String "sqlite3"
  | Mdb -> `String "mdb"
  | Accdb -> `String "accdb"
  | Dbf -> `String "dbf"
  | Plist -> `String "plist"
  | Toml -> `String "toml"
  | Env -> `String "env"
  | Dot -> `String "dot"
  | Gv -> `String "gv"
  | Torrent -> `String "torrent"
  | Ics -> `String "ics"
  | Vcf -> `String "vcf"
  | Ai -> `String "ai"
  | Eps -> `String "eps"
  | Ps -> `String "ps"
  | Dxf -> `String "dxf"
  | Dwg -> `String "dwg"
  | Fig -> `String "fig"
  | Psd -> `String "psd"
  | Psb -> `String "psb"
  | Stl -> `String "stl"
  | Obj -> `String "obj"
  | Fbx -> `String "fbx"
  | Blend -> `String "blend"
  | Dae -> `String "dae"
  | Threeds -> `String "threeds"
  | Gltf -> `String "gltf"
  | Glb -> `String "glb"
  | Vhd -> `String "vhd"
  | Vhdx -> `String "vhdx"
  | Vmdk -> `String "vmdk"
  | Ova -> `String "ova"
  | Ovf -> `String "ovf"
  | Iso -> `String "iso"
  | Img -> `String "img"
  | Swf -> `String "swf"
  | Unknown other -> `String other

type nonrec channel_type =
  | Public
  | Private
  | Direct_message
  | Team
  | Unknown of string  (** A value this SDK version does not know. *)

let channel_type_of_yojson : Yojson.Safe.t -> channel_type =
 fun json ->
  match Json.string json with
  | "public" -> Public
  | "private" -> Private
  | "direct_message" -> Direct_message
  | "team" -> Team
  | other -> Unknown other

and yojson_of_channel_type : channel_type -> Yojson.Safe.t =
 fun value ->
  match value with
  | Public -> `String "public"
  | Private -> `String "private"
  | Direct_message -> `String "direct_message"
  | Team -> `String "team"
  | Unknown other -> `String other

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

let attachment_metadata_of_yojson : Yojson.Safe.t -> attachment_metadata =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "type" with
  | "document" ->
      Document
        {
          document_name = Json.required fields "document_name" Json.string;
          document_type =
            Json.required fields "document_type" file_type_of_yojson;
        }
  | "project" ->
      Project { project_name = Json.required fields "project_name" Json.string }
  | "image" ->
      Image
        {
          image_extension =
            Json.required fields "image_extension" file_type_of_yojson;
          image_name = Json.required fields "image_name" Json.string;
        }
  | "channel" ->
      Channel
        {
          channel_name = Json.required fields "channel_name" Json.string;
          channel_type =
            Json.required fields "channel_type" channel_type_of_yojson;
        }
  | "email" ->
      Email { email_subject = Json.required fields "email_subject" Json.string }
  | _ -> Unknown json

and yojson_of_attachment_metadata : attachment_metadata -> Yojson.Safe.t =
 fun value ->
  match value with
  | Document case ->
      Json.record
        [
          ("type", Some (`String "document"));
          ("document_name", Some (Json.of_string case.document_name));
          ("document_type", Some (yojson_of_file_type case.document_type));
        ]
  | Project case ->
      Json.record
        [
          ("type", Some (`String "project"));
          ("project_name", Some (Json.of_string case.project_name));
        ]
  | Image case ->
      Json.record
        [
          ("type", Some (`String "image"));
          ("image_extension", Some (yojson_of_file_type case.image_extension));
          ("image_name", Some (Json.of_string case.image_name));
        ]
  | Channel case ->
      Json.record
        [
          ("type", Some (`String "channel"));
          ("channel_name", Some (Json.of_string case.channel_name));
          ("channel_type", Some (yojson_of_channel_type case.channel_type));
        ]
  | Email case ->
      Json.record
        [
          ("type", Some (`String "email"));
          ("email_subject", Some (Json.of_string case.email_subject));
        ]
  | Unknown json -> json

let make_attachment_metadata_document ~(document_name : string)
    ~(document_type : file_type) () =
  (Document { document_name; document_type } : attachment_metadata)

let make_attachment_metadata_project ~(project_name : string) () =
  (Project { project_name } : attachment_metadata)

let make_attachment_metadata_image ~(image_extension : file_type)
    ~(image_name : string) () =
  (Image { image_extension; image_name } : attachment_metadata)

let make_attachment_metadata_channel ~(channel_name : string)
    ~(channel_type : channel_type) () =
  (Channel { channel_name; channel_type } : attachment_metadata)

let make_attachment_metadata_email ~(email_subject : string) () =
  (Email { email_subject } : attachment_metadata)

type nonrec attachment_type =
  | Document
  | Image
  | Channel
  | Email
  | Project
  | Skill
  | Unknown of string  (** A value this SDK version does not know. *)

let attachment_type_of_yojson : Yojson.Safe.t -> attachment_type =
 fun json ->
  match Json.string json with
  | "document" -> Document
  | "image" -> Image
  | "channel" -> Channel
  | "email" -> Email
  | "project" -> Project
  | "skill" -> Skill
  | other -> Unknown other

and yojson_of_attachment_type : attachment_type -> Yojson.Safe.t =
 fun value ->
  match value with
  | Document -> `String "document"
  | Image -> `String "image"
  | Channel -> `String "channel"
  | Email -> `String "email"
  | Project -> `String "project"
  | Skill -> `String "skill"
  | Unknown other -> `String other

type nonrec call_tool_request = {
  args : Yojson.Safe.t option;
      (** Optional updated arguments. Uses original args if omitted. *)
  message_id : string;  (** The message ID containing the tool call. *)
  tool_call_id : string;  (** The tool call ID to execute. *)
}
(** Request body for executing a pending tool call. *)

let call_tool_request_of_yojson : Yojson.Safe.t -> call_tool_request =
 fun json ->
  let fields = Json.obj json in
  {
    args = Json.optional fields "args" Json.json;
    message_id = Json.required fields "messageId" Json.string;
    tool_call_id = Json.required fields "toolCallId" Json.string;
  }

and yojson_of_call_tool_request : call_tool_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("args", Option.map Json.of_json value.args);
      ("messageId", Some (Json.of_string value.message_id));
      ("toolCallId", Some (Json.of_string value.tool_call_id));
    ]

let make_call_tool_request ?args ~(message_id : string) ~(tool_call_id : string)
    () =
  ({ args; message_id; tool_call_id } : call_tool_request)

type nonrec call_tool_response = {
  result : Yojson.Safe.t;  (** The tool execution result. *)
}
(** Response body for a successful tool call. *)

let call_tool_response_of_yojson : Yojson.Safe.t -> call_tool_response =
 fun json ->
  let fields = Json.obj json in
  { result = Json.required fields "result" Json.json }

and yojson_of_call_tool_response : call_tool_response -> Yojson.Safe.t =
 fun value -> Json.record [ ("result", Some (Json.of_json value.result)) ]

let make_call_tool_response ~(result : Yojson.Safe.t) () =
  ({ result } : call_tool_response)

type nonrec channel_share_permission = {
  access_level : access_level;  (** The access level for the channel *)
  channel_id : string;  (** The channel id *)
}
(** The channel share permission *)

let channel_share_permission_of_yojson :
    Yojson.Safe.t -> channel_share_permission =
 fun json ->
  let fields = Json.obj json in
  {
    access_level = Json.required fields "access_level" access_level_of_yojson;
    channel_id = Json.required fields "channel_id" Json.string;
  }

and yojson_of_channel_share_permission :
    channel_share_permission -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("access_level", Some (yojson_of_access_level value.access_level));
      ("channel_id", Some (Json.of_string value.channel_id));
    ]

let make_channel_share_permission ~(access_level : access_level)
    ~(channel_id : string) () =
  ({ access_level; channel_id } : channel_share_permission)

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

let chat_of_yojson : Yojson.Safe.t -> chat =
 fun json ->
  let fields = Json.obj json in
  {
    created_at = Json.optional fields "createdAt" Json.string;
    deleted_at = Json.optional fields "deletedAt" Json.string;
    id = Json.required fields "id" Json.string;
    is_persistent = Json.required fields "isPersistent" Json.bool;
    model = Json.optional fields "model" Json.string;
    name = Json.required fields "name" Json.string;
    project_id = Json.optional fields "projectId" Json.string;
    token_count = Json.optional fields "tokenCount" Json.int64;
    updated_at = Json.optional fields "updatedAt" Json.string;
    user_id = Json.required fields "userId" Json.string;
  }

and yojson_of_chat : chat -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("createdAt", Option.map Json.of_string value.created_at);
      ("deletedAt", Option.map Json.of_string value.deleted_at);
      ("id", Some (Json.of_string value.id));
      ("isPersistent", Some (Json.of_bool value.is_persistent));
      ("model", Option.map Json.of_string value.model);
      ("name", Some (Json.of_string value.name));
      ("projectId", Option.map Json.of_string value.project_id);
      ("tokenCount", Option.map Json.of_int64 value.token_count);
      ("updatedAt", Option.map Json.of_string value.updated_at);
      ("userId", Some (Json.of_string value.user_id));
    ]

let make_chat ?created_at ?deleted_at ~(id : string) ~(is_persistent : bool)
    ?model ~(name : string) ?project_id ?token_count ?updated_at
    ~(user_id : string) () =
  ({
     created_at;
     deleted_at;
     id;
     is_persistent;
     model;
     name;
     project_id;
     token_count;
     updated_at;
     user_id;
   }
    : chat)

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

let chat_attachment_of_yojson : Yojson.Safe.t -> chat_attachment =
 fun json ->
  let fields = Json.obj json in
  {
    attachment_id = Json.required fields "attachment_id" Json.string;
    attachment_type =
      Json.required fields "attachment_type" attachment_type_of_yojson;
    chat_id = Json.optional fields "chat_id" Json.string;
    id = Json.required fields "id" Json.string;
    message_id = Json.optional fields "message_id" Json.string;
  }

and yojson_of_chat_attachment : chat_attachment -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("attachment_id", Some (Json.of_string value.attachment_id));
      ("attachment_type", Some (yojson_of_attachment_type value.attachment_type));
      ("chat_id", Option.map Json.of_string value.chat_id);
      ("id", Some (Json.of_string value.id));
      ("message_id", Option.map Json.of_string value.message_id);
    ]

let make_chat_attachment ~(attachment_id : string)
    ~(attachment_type : attachment_type) ?chat_id ~(id : string) ?message_id ()
    =
  ({ attachment_id; attachment_type; chat_id; id; message_id }
    : chat_attachment)

type nonrec message_with_attachments = {
  attachment_ids : string list;
  content : string;
  date : string;
}

let message_with_attachments_of_yojson :
    Yojson.Safe.t -> message_with_attachments =
 fun json ->
  let fields = Json.obj json in
  {
    attachment_ids =
      Json.required fields "attachmentIds" (Json.list Json.string);
    content = Json.required fields "content" Json.string;
    date = Json.required fields "date" Json.string;
  }

and yojson_of_message_with_attachments :
    message_with_attachments -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "attachmentIds",
        Some ((Json.of_list Json.of_string) value.attachment_ids) );
      ("content", Some (Json.of_string value.content));
      ("date", Some (Json.of_string value.date));
    ]

let make_message_with_attachments ~(attachment_ids : string list)
    ~(content : string) ~(date : string) () =
  ({ attachment_ids; content; date } : message_with_attachments)

type nonrec conversation_record = {
  chat_id : string;
  messages : message_with_attachments list;
  title : string;
}

let conversation_record_of_yojson : Yojson.Safe.t -> conversation_record =
 fun json ->
  let fields = Json.obj json in
  {
    chat_id = Json.required fields "chat_id" Json.string;
    messages =
      Json.required fields "messages"
        (Json.list message_with_attachments_of_yojson);
    title = Json.required fields "title" Json.string;
  }

and yojson_of_conversation_record : conversation_record -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("chat_id", Some (Json.of_string value.chat_id));
      ( "messages",
        Some ((Json.of_list yojson_of_message_with_attachments) value.messages)
      );
      ("title", Some (Json.of_string value.title));
    ]

let make_conversation_record ~(chat_id : string)
    ~(messages : message_with_attachments list) ~(title : string) () =
  ({ chat_id; messages; title } : conversation_record)

type nonrec chat_history = { conversation : conversation_record list }

let chat_history_of_yojson : Yojson.Safe.t -> chat_history =
 fun json ->
  let fields = Json.obj json in
  {
    conversation =
      Json.required fields "conversation"
        (Json.list conversation_record_of_yojson);
  }

and yojson_of_chat_history : chat_history -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "conversation",
        Some ((Json.of_list yojson_of_conversation_record) value.conversation)
      );
    ]

let make_chat_history ~(conversation : conversation_record list) () =
  ({ conversation } : chat_history)

type nonrec chat_history_batch_messages_request = { message_ids : string list }

let chat_history_batch_messages_request_of_yojson :
    Yojson.Safe.t -> chat_history_batch_messages_request =
 fun json ->
  let fields = Json.obj json in
  { message_ids = Json.required fields "message_ids" (Json.list Json.string) }

and yojson_of_chat_history_batch_messages_request :
    chat_history_batch_messages_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("message_ids", Some ((Json.of_list Json.of_string) value.message_ids)) ]

let make_chat_history_batch_messages_request ~(message_ids : string list) () =
  ({ message_ids } : chat_history_batch_messages_request)

(** The content of a \[[ChatMessage]\].

For user and system messages the content is plain \[[Text]\](Self::Text).
For assistant messages it may additionally be a sequence of
\[[AssistantMessagePart]\]s that encode tool-call round trips. *)
type nonrec chat_message_content =
  | String of string  (** Plain text content. *)
  | List of assistant_message_part list
      (** Structured assistant message parts. *)

let chat_message_content_of_yojson : Yojson.Safe.t -> chat_message_content =
 fun json ->
  Json.first_ok
    [
      (fun json -> String (Json.string json));
      (fun json -> List ((Json.list assistant_message_part_of_yojson) json));
    ]
    json

and yojson_of_chat_message_content : chat_message_content -> Yojson.Safe.t =
 fun value ->
  match value with
  | String inner -> Json.of_string inner
  | List inner -> (Json.of_list yojson_of_assistant_message_part) inner

(** The role of a message participant. *)
type nonrec role =
  | User
  | Assistant
  | System
  | Unknown of string  (** A value this SDK version does not know. *)

let role_of_yojson : Yojson.Safe.t -> role =
 fun json ->
  match Json.string json with
  | "user" -> User
  | "assistant" -> Assistant
  | "system" -> System
  | other -> Unknown other

and yojson_of_role : role -> Yojson.Safe.t =
 fun value ->
  match value with
  | User -> `String "user"
  | Assistant -> `String "assistant"
  | System -> `String "system"
  | Unknown other -> `String other

type nonrec chat_message = {
  content : chat_message_content;  (** Message content *)
  id : string;  (** The chat message id *)
  model : string option;  (** the model used to generate the message *)
  role : role;  (** Whether the chat is from the user or system *)
}

let chat_message_of_yojson : Yojson.Safe.t -> chat_message =
 fun json ->
  let fields = Json.obj json in
  {
    content = Json.required fields "content" chat_message_content_of_yojson;
    id = Json.required fields "id" Json.string;
    model = Json.optional fields "model" Json.string;
    role = Json.required fields "role" role_of_yojson;
  }

and yojson_of_chat_message : chat_message -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("content", Some (yojson_of_chat_message_content value.content));
      ("id", Some (Json.of_string value.id));
      ("model", Option.map Json.of_string value.model);
      ("role", Some (yojson_of_role value.role));
    ]

let make_chat_message ~(content : chat_message_content) ~(id : string) ?model
    ~(role : role) () =
  ({ content; id; model; role } : chat_message)

type nonrec chat_message_error = {
  code : string option;
      (** Stable machine-readable code for admission errors (402 or 503). *)
  error : string;
  stream_id : string option;
}
(** Error response for chat message endpoints *)

let chat_message_error_of_yojson : Yojson.Safe.t -> chat_message_error =
 fun json ->
  let fields = Json.obj json in
  {
    code = Json.optional fields "code" Json.string;
    error = Json.required fields "error" Json.string;
    stream_id = Json.optional fields "stream_id" Json.string;
  }

and yojson_of_chat_message_error : chat_message_error -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("code", Option.map Json.of_string value.code);
      ("error", Some (Json.of_string value.error));
      ("stream_id", Option.map Json.of_string value.stream_id);
    ]

let make_chat_message_error ?code ~(error : string) ?stream_id () =
  ({ code; error; stream_id } : chat_message_error)

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

let entity_type_of_yojson : Yojson.Safe.t -> entity_type =
 fun json ->
  match Json.string json with
  | "user" -> User
  | "chat" -> Chat
  | "channel" -> Channel
  | "channel_message" -> Channel_message
  | "document" -> Document
  | "project" -> Project
  | "email_thread" -> Email_thread
  | "calendar_event" -> Calendar_event
  | "team" -> Team
  | "call" -> Call
  | "foreign_entity" -> Foreign_entity
  | "static_file" -> Static_file
  | "crm_company" -> Crm_company
  | "crm_contact" -> Crm_contact
  | "crm_pipeline" -> Crm_pipeline
  | "reminder" -> Reminder
  | "harness" -> Harness
  | "skill" -> Skill
  | "agent_session" -> Agent_session
  | "scheduled_action" -> Scheduled_action
  | "initiative" -> Initiative
  | "database" -> Database
  | "database_row" -> Database_row
  | "form" -> Form
  | "external_chat" -> External_chat
  | other -> Unknown other

and yojson_of_entity_type : entity_type -> Yojson.Safe.t =
 fun value ->
  match value with
  | User -> `String "user"
  | Chat -> `String "chat"
  | Channel -> `String "channel"
  | Channel_message -> `String "channel_message"
  | Document -> `String "document"
  | Project -> `String "project"
  | Email_thread -> `String "email_thread"
  | Calendar_event -> `String "calendar_event"
  | Team -> `String "team"
  | Call -> `String "call"
  | Foreign_entity -> `String "foreign_entity"
  | Static_file -> `String "static_file"
  | Crm_company -> `String "crm_company"
  | Crm_contact -> `String "crm_contact"
  | Crm_pipeline -> `String "crm_pipeline"
  | Reminder -> `String "reminder"
  | Harness -> `String "harness"
  | Skill -> `String "skill"
  | Agent_session -> `String "agent_session"
  | Scheduled_action -> `String "scheduled_action"
  | Initiative -> `String "initiative"
  | Database -> `String "database"
  | Database_row -> `String "database_row"
  | Form -> `String "form"
  | External_chat -> `String "external_chat"
  | Unknown other -> `String other

type nonrec entity = {
  entity_id : string;  (** The id of that entity *)
  entity_type : entity_type;  (** The type of entity we are describing *)
}
(** The Entity describes the minimum amount of information required to describe a unique thing in Macro
This contains the type of the entity \[EntityType\] and the string id of that entity *)

let entity_of_yojson : Yojson.Safe.t -> entity =
 fun json ->
  let fields = Json.obj json in
  {
    entity_id = Json.required fields "entity_id" Json.string;
    entity_type = Json.required fields "entity_type" entity_type_of_yojson;
  }

and yojson_of_entity : entity -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("entity_id", Some (Json.of_string value.entity_id));
      ("entity_type", Some (yojson_of_entity_type value.entity_type));
    ]

let make_entity ~(entity_id : string) ~(entity_type : entity_type) () =
  ({ entity_id; entity_type } : entity)

type nonrec chat_message_with_attachments = {
  attachments : entity list;
      (** The ids of the attachments used to generate the message *)
  content : chat_message_content;  (** Message content *)
  id : string;  (** The chat message id *)
  role : role;  (** Whether the chat is from the user or system *)
}

let chat_message_with_attachments_of_yojson :
    Yojson.Safe.t -> chat_message_with_attachments =
 fun json ->
  let fields = Json.obj json in
  {
    attachments =
      Json.required fields "attachments" (Json.list entity_of_yojson);
    content = Json.required fields "content" chat_message_content_of_yojson;
    id = Json.required fields "id" Json.string;
    role = Json.required fields "role" role_of_yojson;
  }

and yojson_of_chat_message_with_attachments :
    chat_message_with_attachments -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("attachments", Some ((Json.of_list yojson_of_entity) value.attachments));
      ("content", Some (yojson_of_chat_message_content value.content));
      ("id", Some (Json.of_string value.id));
      ("role", Some (yojson_of_role value.role));
    ]

let make_chat_message_with_attachments ~(attachments : entity list)
    ~(content : chat_message_content) ~(id : string) ~(role : role) () =
  ({ attachments; content; id; role } : chat_message_with_attachments)

type nonrec chat_preview_data = {
  chat_id : string;
  chat_name : string;
  owner : string;
  updated_at : string option;
}

let chat_preview_data_of_yojson : Yojson.Safe.t -> chat_preview_data =
 fun json ->
  let fields = Json.obj json in
  {
    chat_id = Json.required fields "chat_id" Json.string;
    chat_name = Json.required fields "chat_name" Json.string;
    owner = Json.required fields "owner" Json.string;
    updated_at = Json.optional fields "updated_at" Json.string;
  }

and yojson_of_chat_preview_data : chat_preview_data -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("chat_id", Some (Json.of_string value.chat_id));
      ("chat_name", Some (Json.of_string value.chat_name));
      ("owner", Some (Json.of_string value.owner));
      ("updated_at", Option.map Json.of_string value.updated_at);
    ]

let make_chat_preview_data ~(chat_id : string) ~(chat_name : string)
    ~(owner : string) ?updated_at () =
  ({ chat_id; chat_name; owner; updated_at } : chat_preview_data)

type nonrec with_chat_id = { chat_id : string }

let with_chat_id_of_yojson : Yojson.Safe.t -> with_chat_id =
 fun json ->
  let fields = Json.obj json in
  { chat_id = Json.required fields "chat_id" Json.string }

and yojson_of_with_chat_id : with_chat_id -> Yojson.Safe.t =
 fun value -> Json.record [ ("chat_id", Some (Json.of_string value.chat_id)) ]

let make_with_chat_id ~(chat_id : string) () = ({ chat_id } : with_chat_id)

type nonrec chat_preview =
  | Access of chat_preview_data
  | No_access of with_chat_id
  | Does_not_exist of with_chat_id
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let chat_preview_of_yojson : Yojson.Safe.t -> chat_preview =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "type" with
  | "access" -> Access (chat_preview_data_of_yojson json)
  | "no_access" -> No_access (with_chat_id_of_yojson json)
  | "does_not_exist" -> Does_not_exist (with_chat_id_of_yojson json)
  | _ -> Unknown json

and yojson_of_chat_preview : chat_preview -> Yojson.Safe.t =
 fun value ->
  match value with
  | Access inner ->
      Json.with_tag "type" "access" (yojson_of_chat_preview_data inner)
  | No_access inner ->
      Json.with_tag "type" "no_access" (yojson_of_with_chat_id inner)
  | Does_not_exist inner ->
      Json.with_tag "type" "does_not_exist" (yojson_of_with_chat_id inner)
  | Unknown json -> json

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

let chat_response_of_yojson : Yojson.Safe.t -> chat_response =
 fun json ->
  let fields = Json.obj json in
  {
    created_at = Json.optional fields "createdAt" Json.string;
    id = Json.required fields "id" Json.string;
    messages =
      Json.required fields "messages"
        (Json.list chat_message_with_attachments_of_yojson);
    model = Json.optional fields "model" Json.string;
    name = Json.required fields "name" Json.string;
    project_id = Json.optional fields "projectId" Json.string;
    updated_at = Json.optional fields "updatedAt" Json.string;
    user_id = Json.required fields "userId" Json.string;
  }

and yojson_of_chat_response : chat_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("createdAt", Option.map Json.of_string value.created_at);
      ("id", Some (Json.of_string value.id));
      ( "messages",
        Some
          ((Json.of_list yojson_of_chat_message_with_attachments)
             value.messages) );
      ("model", Option.map Json.of_string value.model);
      ("name", Some (Json.of_string value.name));
      ("projectId", Option.map Json.of_string value.project_id);
      ("updatedAt", Option.map Json.of_string value.updated_at);
      ("userId", Some (Json.of_string value.user_id));
    ]

let make_chat_response ?created_at ~(id : string)
    ~(messages : chat_message_with_attachments list) ?model ~(name : string)
    ?project_id ?updated_at ~(user_id : string) () =
  ({ created_at; id; messages; model; name; project_id; updated_at; user_id }
    : chat_response)

type nonrec chat_stream_error_type =
  | Error_
  | Unknown of string  (** A value this SDK version does not know. *)

let chat_stream_error_type_of_yojson : Yojson.Safe.t -> chat_stream_error_type =
 fun json ->
  match Json.string json with "error" -> Error_ | other -> Unknown other

and yojson_of_chat_stream_error_type : chat_stream_error_type -> Yojson.Safe.t =
 fun value ->
  match value with Error_ -> `String "error" | Unknown other -> `String other

type nonrec stream_error =
  | Provider_error of { model : string; stream_id : string }
  | Model_context_overflow of { stream_id : string }
  | Internal_error of { stream_id : string }
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let stream_error_of_yojson : Yojson.Safe.t -> stream_error =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "stream_error" with
  | "provider_error" ->
      Provider_error
        {
          model = Json.required fields "model" Json.string;
          stream_id = Json.required fields "stream_id" Json.string;
        }
  | "model_context_overflow" ->
      Model_context_overflow
        { stream_id = Json.required fields "stream_id" Json.string }
  | "internal_error" ->
      Internal_error
        { stream_id = Json.required fields "stream_id" Json.string }
  | _ -> Unknown json

and yojson_of_stream_error : stream_error -> Yojson.Safe.t =
 fun value ->
  match value with
  | Provider_error case ->
      Json.record
        [
          ("stream_error", Some (`String "provider_error"));
          ("model", Some (Json.of_string case.model));
          ("stream_id", Some (Json.of_string case.stream_id));
        ]
  | Model_context_overflow case ->
      Json.record
        [
          ("stream_error", Some (`String "model_context_overflow"));
          ("stream_id", Some (Json.of_string case.stream_id));
        ]
  | Internal_error case ->
      Json.record
        [
          ("stream_error", Some (`String "internal_error"));
          ("stream_id", Some (Json.of_string case.stream_id));
        ]
  | Unknown json -> json

let make_stream_error_provider_error ~(model : string) ~(stream_id : string) ()
    =
  (Provider_error { model; stream_id } : stream_error)

let make_stream_error_model_context_overflow ~(stream_id : string) () =
  (Model_context_overflow { stream_id } : stream_error)

let make_stream_error_internal_error ~(stream_id : string) () =
  (Internal_error { stream_id } : stream_error)

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

let chat_stream_of_yojson : Yojson.Safe.t -> chat_stream =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "type" with
  | "error" -> Error_ { stream_error = stream_error_of_yojson json }
  | "chat_user_message" ->
      Chat_user_message
        {
          attachments =
            Json.required fields "attachments" (Json.list entity_of_yojson);
          chat_id = Json.required fields "chat_id" Json.string;
          content = Json.required fields "content" Json.string;
          message_id = Json.required fields "message_id" Json.string;
          stream_id = Json.required fields "stream_id" Json.string;
        }
  | "chat_message_response" ->
      Chat_message_response
        {
          chat_id = Json.required fields "chat_id" Json.string;
          content =
            Json.required fields "content" assistant_message_part_of_yojson;
          message_id = Json.required fields "message_id" Json.string;
          stream_id = Json.required fields "stream_id" Json.string;
        }
  | "stream_end" ->
      Stream_end { stream_id = Json.required fields "stream_id" Json.string }
  | _ -> Unknown json

and yojson_of_chat_stream : chat_stream -> Yojson.Safe.t =
 fun value ->
  match value with
  | Error_ case ->
      Json.merge
        [
          Json.record [ ("type", Some (`String "error")) ];
          yojson_of_stream_error case.stream_error;
        ]
  | Chat_user_message case ->
      Json.record
        [
          ("type", Some (`String "chat_user_message"));
          ( "attachments",
            Some ((Json.of_list yojson_of_entity) case.attachments) );
          ("chat_id", Some (Json.of_string case.chat_id));
          ("content", Some (Json.of_string case.content));
          ("message_id", Some (Json.of_string case.message_id));
          ("stream_id", Some (Json.of_string case.stream_id));
        ]
  | Chat_message_response case ->
      Json.record
        [
          ("type", Some (`String "chat_message_response"));
          ("chat_id", Some (Json.of_string case.chat_id));
          ("content", Some (yojson_of_assistant_message_part case.content));
          ("message_id", Some (Json.of_string case.message_id));
          ("stream_id", Some (Json.of_string case.stream_id));
        ]
  | Stream_end case ->
      Json.record
        [
          ("type", Some (`String "stream_end"));
          ("stream_id", Some (Json.of_string case.stream_id));
        ]
  | Unknown json -> json

let make_chat_stream_error_ ~(stream_error : stream_error) () =
  (Error_ { stream_error } : chat_stream)

let make_chat_stream_chat_user_message ~(attachments : entity list)
    ~(chat_id : string) ~(content : string) ~(message_id : string)
    ~(stream_id : string) () =
  (Chat_user_message { attachments; chat_id; content; message_id; stream_id }
    : chat_stream)

let make_chat_stream_chat_message_response ~(chat_id : string)
    ~(content : assistant_message_part) ~(message_id : string)
    ~(stream_id : string) () =
  (Chat_message_response { chat_id; content; message_id; stream_id }
    : chat_stream)

let make_chat_stream_stream_end ~(stream_id : string) () =
  (Stream_end { stream_id } : chat_stream)

type nonrec complete_onboarding_request = {
  skipped : bool option;  (** Whether the user skipped rather than finished. *)
}
(** Body for completing onboarding. *)

let complete_onboarding_request_of_yojson :
    Yojson.Safe.t -> complete_onboarding_request =
 fun json ->
  let fields = Json.obj json in
  { skipped = Json.optional fields "skipped" Json.bool }

and yojson_of_complete_onboarding_request :
    complete_onboarding_request -> Yojson.Safe.t =
 fun value -> Json.record [ ("skipped", Option.map Json.of_bool value.skipped) ]

let make_complete_onboarding_request ?skipped () =
  ({ skipped } : complete_onboarding_request)

(** How much a model may think before it gives a structured answer. *)
type nonrec completion_thinking =
  | Default
  | Low
  | Unknown of string  (** A value this SDK version does not know. *)

let completion_thinking_of_yojson : Yojson.Safe.t -> completion_thinking =
 fun json ->
  match Json.string json with
  | "default" -> Default
  | "low" -> Low
  | other -> Unknown other

and yojson_of_completion_thinking : completion_thinking -> Yojson.Safe.t =
 fun value ->
  match value with
  | Default -> `String "default"
  | Low -> `String "low"
  | Unknown other -> `String other

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

let price_of_yojson : Yojson.Safe.t -> price =
 fun json ->
  let fields = Json.obj json in
  {
    price_per_audio_minute =
      Json.optional fields "price_per_audio_minute" Json.float;
    price_per_million_cache_read =
      Json.optional fields "price_per_million_cache_read" Json.float;
    price_per_million_cache_write =
      Json.optional fields "price_per_million_cache_write" Json.float;
    price_per_million_in =
      Json.required fields "price_per_million_in" Json.float;
    price_per_million_out =
      Json.required fields "price_per_million_out" Json.float;
    price_per_provider_credit =
      Json.optional fields "price_per_provider_credit" Json.float;
    total = Json.required fields "total" Json.float;
  }

and yojson_of_price : price -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "price_per_audio_minute",
        Option.map Json.of_float value.price_per_audio_minute );
      ( "price_per_million_cache_read",
        Option.map Json.of_float value.price_per_million_cache_read );
      ( "price_per_million_cache_write",
        Option.map Json.of_float value.price_per_million_cache_write );
      ("price_per_million_in", Some (Json.of_float value.price_per_million_in));
      ("price_per_million_out", Some (Json.of_float value.price_per_million_out));
      ( "price_per_provider_credit",
        Option.map Json.of_float value.price_per_provider_credit );
      ("total", Some (Json.of_float value.total));
    ]

let make_price ?price_per_audio_minute ?price_per_million_cache_read
    ?price_per_million_cache_write ~(price_per_million_in : float)
    ~(price_per_million_out : float) ?price_per_provider_credit ~(total : float)
    () =
  ({
     price_per_audio_minute;
     price_per_million_cache_read;
     price_per_million_cache_write;
     price_per_million_in;
     price_per_million_out;
     price_per_provider_credit;
     total;
   }
    : price)

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

let usage_of_yojson : Yojson.Safe.t -> usage =
 fun json ->
  let fields = Json.obj json in
  {
    audio_seconds = Json.optional fields "audio_seconds" Json.float;
    cache_read_input_tokens =
      Json.required fields "cache_read_input_tokens" Json.int64;
    cache_write_input_tokens =
      Json.required fields "cache_write_input_tokens" Json.int64;
    created_at = Json.required fields "created_at" Json.string;
    input_tokens = Json.required fields "input_tokens" Json.int64;
    model = Json.required fields "model" Json.string;
    output_tokens = Json.required fields "output_tokens" Json.int64;
    price = Json.optional fields "price" price_of_yojson;
    provider_credits = Json.optional fields "provider_credits" Json.int64;
  }

and yojson_of_usage : usage -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("audio_seconds", Option.map Json.of_float value.audio_seconds);
      ( "cache_read_input_tokens",
        Some (Json.of_int64 value.cache_read_input_tokens) );
      ( "cache_write_input_tokens",
        Some (Json.of_int64 value.cache_write_input_tokens) );
      ("created_at", Some (Json.of_string value.created_at));
      ("input_tokens", Some (Json.of_int64 value.input_tokens));
      ("model", Some (Json.of_string value.model));
      ("output_tokens", Some (Json.of_int64 value.output_tokens));
      ("price", Option.map yojson_of_price value.price);
      ("provider_credits", Option.map Json.of_int64 value.provider_credits);
    ]

let make_usage ?audio_seconds ~(cache_read_input_tokens : int64)
    ~(cache_write_input_tokens : int64) ~(created_at : string)
    ~(input_tokens : int64) ~(model : string) ~(output_tokens : int64) ?price
    ?provider_credits () =
  ({
     audio_seconds;
     cache_read_input_tokens;
     cache_write_input_tokens;
     created_at;
     input_tokens;
     model;
     output_tokens;
     price;
     provider_credits;
   }
    : usage)

type nonrec macro_user_id_str = string

let macro_user_id_str_of_yojson : Yojson.Safe.t -> macro_user_id_str =
 fun json -> Json.string json

and yojson_of_macro_user_id_str : macro_user_id_str -> Yojson.Safe.t =
 fun value -> Json.of_string value

type nonrec completion_usage = {
  cost : usage;  (** Measured usage and resolved cost. *)
  entity : string option;  (** Related entity, if any. *)
  feature : ai_feature;  (** Feature that performed the invocation. *)
  user : macro_user_id_str;  (** User the invocation was performed for. *)
}
(** User and feature attribution for one invocation. *)

let completion_usage_of_yojson : Yojson.Safe.t -> completion_usage =
 fun json ->
  let fields = Json.obj json in
  {
    cost = Json.required fields "cost" usage_of_yojson;
    entity = Json.optional fields "entity" Json.string;
    feature = Json.required fields "feature" ai_feature_of_yojson;
    user = Json.required fields "user" macro_user_id_str_of_yojson;
  }

and yojson_of_completion_usage : completion_usage -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("cost", Some (yojson_of_usage value.cost));
      ("entity", Option.map Json.of_string value.entity);
      ("feature", Some (yojson_of_ai_feature value.feature));
      ("user", Some (yojson_of_macro_user_id_str value.user));
    ]

let make_completion_usage ~(cost : usage) ?entity ~(feature : ai_feature)
    ~(user : macro_user_id_str) () =
  ({ cost; entity; feature; user } : completion_usage)

type nonrec connected_server = {
  authenticated : bool;  (** Whether the user has completed OAuth against it. *)
  name : string;  (** The server's display name. *)
  url : string;  (** The server URL. *)
}
(** One of the user's MCP server connections, as the setup page sees it. *)

let connected_server_of_yojson : Yojson.Safe.t -> connected_server =
 fun json ->
  let fields = Json.obj json in
  {
    authenticated = Json.required fields "authenticated" Json.bool;
    name = Json.required fields "name" Json.string;
    url = Json.required fields "url" Json.string;
  }

and yojson_of_connected_server : connected_server -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("authenticated", Some (Json.of_bool value.authenticated));
      ("name", Some (Json.of_string value.name));
      ("url", Some (Json.of_string value.url));
    ]

let make_connected_server ~(authenticated : bool) ~(name : string)
    ~(url : string) () =
  ({ authenticated; name; url } : connected_server)

type nonrec create_chat_request = {
  name : string option;  (** Optional name for the chat. *)
  project_id : string option;
      (** Optional project to associate the chat with. *)
}
(** Request body for creating a chat. *)

let create_chat_request_of_yojson : Yojson.Safe.t -> create_chat_request =
 fun json ->
  let fields = Json.obj json in
  {
    name = Json.optional fields "name" Json.string;
    project_id = Json.optional fields "projectId" Json.string;
  }

and yojson_of_create_chat_request : create_chat_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("name", Option.map Json.of_string value.name);
      ("projectId", Option.map Json.of_string value.project_id);
    ]

let make_create_chat_request ?name ?project_id () =
  ({ name; project_id } : create_chat_request)

(** What a successful tool call committed to the user's databases. *)
type nonrec database_change =
  | None_
  | Schema  (** Databases, tables, columns or saved views. *)
  | Rows of { count : int64 }
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let database_change_of_yojson : Yojson.Safe.t -> database_change =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "kind" with
  | "none" -> None_
  | "schema" -> Schema
  | "rows" -> Rows { count = Json.required fields "count" Json.int64 }
  | _ -> Unknown json

and yojson_of_database_change : database_change -> Yojson.Safe.t =
 fun value ->
  match value with
  | None_ -> Json.record [ ("kind", Some (`String "none")) ]
  | Schema -> Json.record [ ("kind", Some (`String "schema")) ]
  | Rows case ->
      Json.record
        [
          ("kind", Some (`String "rows"));
          ("count", Some (Json.of_int64 case.count));
        ]
  | Unknown json -> json

let make_database_change_rows ~(count : int64) () =
  (Rows { count } : database_change)

type nonrec database_query_chart = {
  color : string option;
  stack : bool;
  title : string;
  x : string;
  y : string list;
}
(** Chart fields name the proposal's result columns exactly. *)

let database_query_chart_of_yojson : Yojson.Safe.t -> database_query_chart =
 fun json ->
  let fields = Json.obj json in
  {
    color = Json.optional fields "color" Json.string;
    stack = Json.required fields "stack" Json.bool;
    title = Json.required fields "title" Json.string;
    x = Json.required fields "x" Json.string;
    y = Json.required fields "y" (Json.list Json.string);
  }

and yojson_of_database_query_chart : database_query_chart -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("color", Option.map Json.of_string value.color);
      ("stack", Some (Json.of_bool value.stack));
      ("title", Some (Json.of_string value.title));
      ("x", Some (Json.of_string value.x));
      ("y", Some ((Json.of_list Json.of_string) value.y));
    ]

let make_database_query_chart ?color ~(stack : bool) ~(title : string)
    ~(x : string) ~(y : string list) () =
  ({ color; stack; title; x; y } : database_query_chart)

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

let database_query_display_mode_of_yojson :
    Yojson.Safe.t -> database_query_display_mode =
 fun json ->
  match Json.string json with
  | "scalar" -> Scalar
  | "table" -> Table
  | "bar" -> Bar
  | "line" -> Line
  | "area" -> Area
  | "scatter" -> Scatter
  | "pie" -> Pie
  | other -> Unknown other

and yojson_of_database_query_display_mode :
    database_query_display_mode -> Yojson.Safe.t =
 fun value ->
  match value with
  | Scalar -> `String "scalar"
  | Table -> `String "table"
  | Bar -> `String "bar"
  | Line -> `String "line"
  | Area -> `String "area"
  | Scatter -> `String "scatter"
  | Pie -> `String "pie"
  | Unknown other -> `String other

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

let database_query_answer_of_yojson : Yojson.Safe.t -> database_query_answer =
 fun json ->
  let fields = Json.obj json in
  {
    answerable = Json.required fields "answerable" Json.bool;
    chart = Json.optional fields "chart" database_query_chart_of_yojson;
    database_id = Json.optional fields "databaseId" Json.string;
    display_mode =
      Json.required fields "displayMode" database_query_display_mode_of_yojson;
    explanation = Json.required fields "explanation" Json.string;
    sql = Json.required fields "sql" Json.string;
    title = Json.required fields "title" Json.string;
  }

and yojson_of_database_query_answer : database_query_answer -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("answerable", Some (Json.of_bool value.answerable));
      ("chart", Option.map yojson_of_database_query_chart value.chart);
      ("databaseId", Option.map Json.of_string value.database_id);
      ( "displayMode",
        Some (yojson_of_database_query_display_mode value.display_mode) );
      ("explanation", Some (Json.of_string value.explanation));
      ("sql", Some (Json.of_string value.sql));
      ("title", Some (Json.of_string value.title));
    ]

let make_database_query_answer ~(answerable : bool) ?chart ?database_id
    ~(display_mode : database_query_display_mode) ~(explanation : string)
    ~(sql : string) ~(title : string) () =
  ({ answerable; chart; database_id; display_mode; explanation; sql; title }
    : database_query_answer)

type nonrec database_query_request = {
  error : string option;
      (** The SQL engine's error from one failed proposal, used for a bounded repair. *)
  model : string;
  prompt : string;
  schema : Yojson.Safe.t;
  sql : string;
}
(** The question and untrusted schema hints; authorization remains in the read services. *)

let database_query_request_of_yojson : Yojson.Safe.t -> database_query_request =
 fun json ->
  let fields = Json.obj json in
  {
    error = Json.optional fields "error" Json.string;
    model = Json.required fields "model" Json.string;
    prompt = Json.required fields "prompt" Json.string;
    schema = Json.required fields "schema" Json.json;
    sql = Json.required fields "sql" Json.string;
  }

and yojson_of_database_query_request : database_query_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("error", Option.map Json.of_string value.error);
      ("model", Some (Json.of_string value.model));
      ("prompt", Some (Json.of_string value.prompt));
      ("schema", Some (Json.of_json value.schema));
      ("sql", Some (Json.of_string value.sql));
    ]

let make_database_query_request ?error ~(model : string) ~(prompt : string)
    ~(schema : Yojson.Safe.t) ~(sql : string) () =
  ({ error; model; prompt; schema; sql } : database_query_request)

type nonrec decision_error_body = {
  code : string;  (** Stable failure code. *)
  error : string;
      (** Human-readable explanation without provider credentials or diagnostics. *)
}
(** Sanitized, machine-readable failure of a decision request. *)

let decision_error_body_of_yojson : Yojson.Safe.t -> decision_error_body =
 fun json ->
  let fields = Json.obj json in
  {
    code = Json.required fields "code" Json.string;
    error = Json.required fields "error" Json.string;
  }

and yojson_of_decision_error_body : decision_error_body -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("code", Some (Json.of_string value.code));
      ("error", Some (Json.of_string value.error));
    ]

let make_decision_error_body ~(code : string) ~(error : string) () =
  ({ code; error } : decision_error_body)

type nonrec decision_request = {
  input : Yojson.Safe.t;
      (** Data to classify. The entire compact request must fit in 64 KiB. *)
  questions : (string * string) list;
      (** One to 32 questions, each at most 500 characters. Keys must be nonblank
and at most 80 UTF-8 bytes; they are preserved in the response. *)
}
(** Named yes/no questions to evaluate against one arbitrary JSON input. *)

let decision_request_of_yojson : Yojson.Safe.t -> decision_request =
 fun json ->
  let fields = Json.obj json in
  {
    input = Json.required fields "input" Json.json;
    questions = Json.required fields "questions" (Json.map Json.string);
  }

and yojson_of_decision_request : decision_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("input", Some (Json.of_json value.input));
      ("questions", Some ((Json.of_map Json.of_string) value.questions));
    ]

let make_decision_request ~(input : Yojson.Safe.t)
    ~(questions : (string * string) list) () =
  ({ input; questions } : decision_request)

type nonrec decision_response = {
  probabilities : (string * float) list;
      (** Probabilities between zero and one, inclusive; not boolean decisions. *)
}
(** The probability of yes for every requested question, under its original key. *)

let decision_response_of_yojson : Yojson.Safe.t -> decision_response =
 fun json ->
  let fields = Json.obj json in
  { probabilities = Json.required fields "probabilities" (Json.map Json.float) }

and yojson_of_decision_response : decision_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("probabilities", Some ((Json.of_map Json.of_float) value.probabilities));
    ]

let make_decision_response ~(probabilities : (string * float) list) () =
  ({ probabilities } : decision_response)

type nonrec dismissed_prompts = {
  dismissed : string list;  (** Dismissed prompt ids, oldest dismissal first. *)
}
(** The prompts the user dismissed, on any device. *)

let dismissed_prompts_of_yojson : Yojson.Safe.t -> dismissed_prompts =
 fun json ->
  let fields = Json.obj json in
  { dismissed = Json.required fields "dismissed" (Json.list Json.string) }

and yojson_of_dismissed_prompts : dismissed_prompts -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("dismissed", Some ((Json.of_list Json.of_string) value.dismissed)) ]

let make_dismissed_prompts ~(dismissed : string list) () =
  ({ dismissed } : dismissed_prompts)

type nonrec document_cognition_service_api_version =
  | V1
  | V2
  | Unknown of string  (** A value this SDK version does not know. *)

let document_cognition_service_api_version_of_yojson :
    Yojson.Safe.t -> document_cognition_service_api_version =
 fun json ->
  match Json.string json with "v1" -> V1 | "v2" -> V2 | other -> Unknown other

and yojson_of_document_cognition_service_api_version :
    document_cognition_service_api_version -> Yojson.Safe.t =
 fun value ->
  match value with
  | V1 -> `String "v1"
  | V2 -> `String "v2"
  | Unknown other -> `String other

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

let user_pdf_rect_of_yojson : Yojson.Safe.t -> user_pdf_rect =
 fun json ->
  let fields = Json.obj json in
  {
    height = Json.required fields "height" Json.float;
    left = Json.required fields "left" Json.float;
    page_index = Json.required fields "page_index" Json.int;
    top = Json.required fields "top" Json.float;
    width = Json.required fields "width" Json.float;
  }

and yojson_of_user_pdf_rect : user_pdf_rect -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("height", Some (Json.of_float value.height));
      ("left", Some (Json.of_float value.left));
      ("page_index", Some (Json.of_int value.page_index));
      ("top", Some (Json.of_float value.top));
      ("width", Some (Json.of_float value.width));
    ]

let make_user_pdf_rect ~(height : float) ~(left : float) ~(page_index : int)
    ~(top : float) ~(width : float) () =
  ({ height; left; page_index; top; width } : user_pdf_rect)

type nonrec document_reference =
  | Pdf of user_pdf_rect
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let document_reference_of_yojson : Yojson.Safe.t -> document_reference =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "kind" with
  | "pdf" -> Pdf (user_pdf_rect_of_yojson json)
  | _ -> Unknown json

and yojson_of_document_reference : document_reference -> Yojson.Safe.t =
 fun value ->
  match value with
  | Pdf inner -> Json.with_tag "kind" "pdf" (yojson_of_user_pdf_rect inner)
  | Unknown json -> json

type nonrec document_text_part = {
  document_id : string;
  id : string;
  reference : document_reference;
}

let document_text_part_of_yojson : Yojson.Safe.t -> document_text_part =
 fun json ->
  let fields = Json.obj json in
  {
    document_id = Json.required fields "document_id" Json.string;
    id = Json.required fields "id" Json.string;
    reference = Json.required fields "reference" document_reference_of_yojson;
  }

and yojson_of_document_text_part : document_text_part -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("document_id", Some (Json.of_string value.document_id));
      ("id", Some (Json.of_string value.id));
      ("reference", Some (yojson_of_document_reference value.reference));
    ]

let make_document_text_part ~(document_id : string) ~(id : string)
    ~(reference : document_reference) () =
  ({ document_id; id; reference } : document_text_part)

type nonrec dynamic_schema = {
  description : string option;
      (** Optional description of what the schema represents. *)
  name : string;  (** Name of the schema. *)
  schema : Yojson.Safe.t;  (** The JSON schema to validate against. *)
}
(** Schema definition for dynamic structured completions. *)

let dynamic_schema_of_yojson : Yojson.Safe.t -> dynamic_schema =
 fun json ->
  let fields = Json.obj json in
  {
    description = Json.optional fields "description" Json.string;
    name = Json.required fields "name" Json.string;
    schema = Json.required fields "schema" Json.json;
  }

and yojson_of_dynamic_schema : dynamic_schema -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("description", Option.map Json.of_string value.description);
      ("name", Some (Json.of_string value.name));
      ("schema", Some (Json.of_json value.schema));
    ]

let make_dynamic_schema ?description ~(name : string) ~(schema : Yojson.Safe.t)
    () =
  ({ description; name; schema } : dynamic_schema)

type nonrec error_body = {
  error : string;  (** Human-readable error description. *)
}
(** Error response body. *)

let error_body_of_yojson : Yojson.Safe.t -> error_body =
 fun json ->
  let fields = Json.obj json in
  { error = Json.required fields "error" Json.string }

and yojson_of_error_body : error_body -> Yojson.Safe.t =
 fun value -> Json.record [ ("error", Some (Json.of_string value.error)) ]

let make_error_body ~(error : string) () = ({ error } : error_body)

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

(** How long a projection remains active without being requested. *)
type nonrec expiry =
  | Day
  | Week
  | Month
  | Unknown of string  (** A value this SDK version does not know. *)

let expiry_of_yojson : Yojson.Safe.t -> expiry =
 fun json ->
  match Json.string json with
  | "day" -> Day
  | "week" -> Week
  | "month" -> Month
  | other -> Unknown other

and yojson_of_expiry : expiry -> Yojson.Safe.t =
 fun value ->
  match value with
  | Day -> `String "day"
  | Week -> `String "week"
  | Month -> `String "month"
  | Unknown other -> `String other

type nonrec explicit_memory = { content : string; revision : int64 }
(** A private explicit memory document and its optimistic concurrency token. *)

let explicit_memory_of_yojson : Yojson.Safe.t -> explicit_memory =
 fun json ->
  let fields = Json.obj json in
  {
    content = Json.required fields "content" Json.string;
    revision = Json.required fields "revision" Json.int64;
  }

and yojson_of_explicit_memory : explicit_memory -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("content", Some (Json.of_string value.content));
      ("revision", Some (Json.of_int64 value.revision));
    ]

let make_explicit_memory ~(content : string) ~(revision : int64) () =
  ({ content; revision } : explicit_memory)

type nonrec feature_usage = {
  entries : completion_usage list;  (** Recorded invocations. *)
  feature : ai_feature;  (** Feature attribution. *)
  total : float;  (** Total cost (USD). *)
}
(** Recorded invocations and total for one feature. *)

let feature_usage_of_yojson : Yojson.Safe.t -> feature_usage =
 fun json ->
  let fields = Json.obj json in
  {
    entries =
      Json.required fields "entries" (Json.list completion_usage_of_yojson);
    feature = Json.required fields "feature" ai_feature_of_yojson;
    total = Json.required fields "total" Json.float;
  }

and yojson_of_feature_usage : feature_usage -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("entries", Some ((Json.of_list yojson_of_completion_usage) value.entries));
      ("feature", Some (yojson_of_ai_feature value.feature));
      ("total", Some (Json.of_float value.total));
    ]

let make_feature_usage ~(entries : completion_usage list)
    ~(feature : ai_feature) ~(total : float) () =
  ({ entries; feature; total } : feature_usage)

(** A [provider/model] id every user may request without professional features. *)
type nonrec free_tier_model =
  | Google_gemini_3_8_flash
  | Unknown of string  (** A value this SDK version does not know. *)

let free_tier_model_of_yojson : Yojson.Safe.t -> free_tier_model =
 fun json ->
  match Json.string json with
  | "google/gemini-3.8-flash" -> Google_gemini_3_8_flash
  | other -> Unknown other

and yojson_of_free_tier_model : free_tier_model -> Yojson.Safe.t =
 fun value ->
  match value with
  | Google_gemini_3_8_flash -> `String "google/gemini-3.8-flash"
  | Unknown other -> `String other

(** Shape of the generated image. *)
type nonrec generate_image_aspect_ratio =
  | Square
  | Landscape
  | Portrait
  | Widescreen
  | Tall
  | Unknown of string  (** A value this SDK version does not know. *)

let generate_image_aspect_ratio_of_yojson :
    Yojson.Safe.t -> generate_image_aspect_ratio =
 fun json ->
  match Json.string json with
  | "square" -> Square
  | "landscape" -> Landscape
  | "portrait" -> Portrait
  | "widescreen" -> Widescreen
  | "tall" -> Tall
  | other -> Unknown other

and yojson_of_generate_image_aspect_ratio :
    generate_image_aspect_ratio -> Yojson.Safe.t =
 fun value ->
  match value with
  | Square -> `String "square"
  | Landscape -> `String "landscape"
  | Portrait -> `String "portrait"
  | Widescreen -> `String "widescreen"
  | Tall -> `String "tall"
  | Unknown other -> `String other

type nonrec generate_image_error_body = {
  code : string;  (** Stable failure code. *)
  error : string;  (** Explanation without provider or storage diagnostics. *)
}
(** Sanitized, machine-readable failure of an image request. *)

let generate_image_error_body_of_yojson :
    Yojson.Safe.t -> generate_image_error_body =
 fun json ->
  let fields = Json.obj json in
  {
    code = Json.required fields "code" Json.string;
    error = Json.required fields "error" Json.string;
  }

and yojson_of_generate_image_error_body :
    generate_image_error_body -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("code", Some (Json.of_string value.code));
      ("error", Some (Json.of_string value.error));
    ]

let make_generate_image_error_body ~(code : string) ~(error : string) () =
  ({ code; error } : generate_image_error_body)

(** A reference image already stored in Macro. *)
type nonrec generate_image_reference =
  | Document of { id : string  (** The Macro document ID. *) }
      (** An image document the caller can view. *)
  | Static_file of { id : string  (** The static file ID. *) }
      (** An uploaded or previously generated static file. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let generate_image_reference_of_yojson :
    Yojson.Safe.t -> generate_image_reference =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "type" with
  | "document" -> Document { id = Json.required fields "id" Json.string }
  | "staticFile" -> Static_file { id = Json.required fields "id" Json.string }
  | _ -> Unknown json

and yojson_of_generate_image_reference :
    generate_image_reference -> Yojson.Safe.t =
 fun value ->
  match value with
  | Document case ->
      Json.record
        [
          ("type", Some (`String "document"));
          ("id", Some (Json.of_string case.id));
        ]
  | Static_file case ->
      Json.record
        [
          ("type", Some (`String "staticFile"));
          ("id", Some (Json.of_string case.id));
        ]
  | Unknown json -> json

let make_generate_image_reference_document ~(id : string) () =
  (Document { id } : generate_image_reference)

let make_generate_image_reference_static_file ~(id : string) () =
  (Static_file { id } : generate_image_reference)

type nonrec generate_image_request = {
  aspect_ratio : generate_image_aspect_ratio option;
  prompt : string;
      (** Description of the image: subject, style, composition, colours, and any text to render. *)
  reference_images : generate_image_reference list option;
      (** Up to three reference images, in the order the prompt refers to them. *)
}
(** What image to generate. *)

let generate_image_request_of_yojson : Yojson.Safe.t -> generate_image_request =
 fun json ->
  let fields = Json.obj json in
  {
    aspect_ratio =
      Json.optional fields "aspectRatio" generate_image_aspect_ratio_of_yojson;
    prompt = Json.required fields "prompt" Json.string;
    reference_images =
      Json.optional fields "referenceImages"
        (Json.list generate_image_reference_of_yojson);
  }

and yojson_of_generate_image_request : generate_image_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "aspectRatio",
        Option.map yojson_of_generate_image_aspect_ratio value.aspect_ratio );
      ("prompt", Some (Json.of_string value.prompt));
      ( "referenceImages",
        Option.map
          (Json.of_list yojson_of_generate_image_reference)
          value.reference_images );
    ]

let make_generate_image_request ?aspect_ratio ~(prompt : string)
    ?reference_images () =
  ({ aspect_ratio; prompt; reference_images } : generate_image_request)

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

let generate_image_response_of_yojson : Yojson.Safe.t -> generate_image_response
    =
 fun json ->
  let fields = Json.obj json in
  {
    height = Json.required fields "height" Json.int;
    mime_type = Json.required fields "mimeType" Json.string;
    note = Json.optional fields "note" Json.string;
    size_bytes = Json.required fields "sizeBytes" Json.int64;
    static_file_id = Json.required fields "staticFileId" Json.string;
    url = Json.required fields "url" Json.string;
    width = Json.required fields "width" Json.int;
  }

and yojson_of_generate_image_response : generate_image_response -> Yojson.Safe.t
    =
 fun value ->
  Json.record
    [
      ("height", Some (Json.of_int value.height));
      ("mimeType", Some (Json.of_string value.mime_type));
      ("note", Option.map Json.of_string value.note);
      ("sizeBytes", Some (Json.of_int64 value.size_bytes));
      ("staticFileId", Some (Json.of_string value.static_file_id));
      ("url", Some (Json.of_string value.url));
      ("width", Some (Json.of_int value.width));
    ]

let make_generate_image_response ~(height : int) ~(mime_type : string) ?note
    ~(size_bytes : int64) ~(static_file_id : string) ~(url : string)
    ~(width : int) () =
  ({ height; mime_type; note; size_bytes; static_file_id; url; width }
    : generate_image_response)

type nonrec generic_error_response = {
  error : bool;  (** Indicates if an error occurred *)
  message : string;  (** Message to explain failure *)
}

let generic_error_response_of_yojson : Yojson.Safe.t -> generic_error_response =
 fun json ->
  let fields = Json.obj json in
  {
    error = Json.required fields "error" Json.bool;
    message = Json.required fields "message" Json.string;
  }

and yojson_of_generic_error_response : generic_error_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("error", Some (Json.of_bool value.error));
      ("message", Some (Json.of_string value.message));
    ]

let make_generic_error_response ~(error : bool) ~(message : string) () =
  ({ error; message } : generic_error_response)

type nonrec get_batch_preview_request = { chat_ids : string list }

let get_batch_preview_request_of_yojson :
    Yojson.Safe.t -> get_batch_preview_request =
 fun json ->
  let fields = Json.obj json in
  { chat_ids = Json.required fields "chat_ids" (Json.list Json.string) }

and yojson_of_get_batch_preview_request :
    get_batch_preview_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("chat_ids", Some ((Json.of_list Json.of_string) value.chat_ids)) ]

let make_get_batch_preview_request ~(chat_ids : string list) () =
  ({ chat_ids } : get_batch_preview_request)

type nonrec get_batch_preview_response = { previews : chat_preview list }

let get_batch_preview_response_of_yojson :
    Yojson.Safe.t -> get_batch_preview_response =
 fun json ->
  let fields = Json.obj json in
  {
    previews =
      Json.required fields "previews" (Json.list chat_preview_of_yojson);
  }

and yojson_of_get_batch_preview_response :
    get_batch_preview_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("previews", Some ((Json.of_list yojson_of_chat_preview) value.previews));
    ]

let make_get_batch_preview_response ~(previews : chat_preview list) () =
  ({ previews } : get_batch_preview_response)

(** Defines who can access an item through its share link. *)
type nonrec link_share =
  | Public
  | Team
  | Unknown of string  (** A value this SDK version does not know. *)

let link_share_of_yojson : Yojson.Safe.t -> link_share =
 fun json ->
  match Json.string json with
  | "PUBLIC" -> Public
  | "TEAM" -> Team
  | other -> Unknown other

and yojson_of_link_share : link_share -> Yojson.Safe.t =
 fun value ->
  match value with
  | Public -> `String "PUBLIC"
  | Team -> `String "TEAM"
  | Unknown other -> `String other

type nonrec share_permission_v2 = {
  channel_share_permissions : channel_share_permission list option;
      (** The channel share permissions for the item *)
  id : string;  (** The share permission id *)
  link_share : link_share option;
  link_share_access_level : access_level option;
  owner : string;  (** The owner of the item *)
  team_share_access_level : access_level option;
}

let share_permission_v2_of_yojson : Yojson.Safe.t -> share_permission_v2 =
 fun json ->
  let fields = Json.obj json in
  {
    channel_share_permissions =
      Json.optional fields "channelSharePermissions"
        (Json.list channel_share_permission_of_yojson);
    id = Json.required fields "id" Json.string;
    link_share = Json.optional fields "linkShare" link_share_of_yojson;
    link_share_access_level =
      Json.optional fields "linkShareAccessLevel" access_level_of_yojson;
    owner = Json.required fields "owner" Json.string;
    team_share_access_level =
      Json.optional fields "teamShareAccessLevel" access_level_of_yojson;
  }

and yojson_of_share_permission_v2 : share_permission_v2 -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "channelSharePermissions",
        Option.map
          (Json.of_list yojson_of_channel_share_permission)
          value.channel_share_permissions );
      ("id", Some (Json.of_string value.id));
      ("linkShare", Option.map yojson_of_link_share value.link_share);
      ( "linkShareAccessLevel",
        Option.map yojson_of_access_level value.link_share_access_level );
      ("owner", Some (Json.of_string value.owner));
      ( "teamShareAccessLevel",
        Option.map yojson_of_access_level value.team_share_access_level );
    ]

let make_share_permission_v2 ?channel_share_permissions ~(id : string)
    ?link_share ?link_share_access_level ~(owner : string)
    ?team_share_access_level () =
  ({
     channel_share_permissions;
     id;
     link_share;
     link_share_access_level;
     owner;
     team_share_access_level;
   }
    : share_permission_v2)

type nonrec get_chat_permissions_response = {
  permissions : share_permission_v2;  (** The share permissions for the chat. *)
}
(** Response body for get chat permissions. *)

let get_chat_permissions_response_of_yojson :
    Yojson.Safe.t -> get_chat_permissions_response =
 fun json ->
  let fields = Json.obj json in
  {
    permissions =
      Json.required fields "permissions" share_permission_v2_of_yojson;
  }

and yojson_of_get_chat_permissions_response :
    get_chat_permissions_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("permissions", Some (yojson_of_share_permission_v2 value.permissions)) ]

let make_get_chat_permissions_response ~(permissions : share_permission_v2) () =
  ({ permissions } : get_chat_permissions_response)

type nonrec get_chat_response = {
  chat : chat_response;  (** The full chat data. *)
  user_access_level : access_level;
      (** The requesting user's access level on this chat. *)
}
(** Wrapper response for get_chat, matching the DCS API response shape. *)

let get_chat_response_of_yojson : Yojson.Safe.t -> get_chat_response =
 fun json ->
  let fields = Json.obj json in
  {
    chat = Json.required fields "chat" chat_response_of_yojson;
    user_access_level =
      Json.required fields "userAccessLevel" access_level_of_yojson;
  }

and yojson_of_get_chat_response : get_chat_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("chat", Some (yojson_of_chat_response value.chat));
      ("userAccessLevel", Some (yojson_of_access_level value.user_access_level));
    ]

let make_get_chat_response ~(chat : chat_response)
    ~(user_access_level : access_level) () =
  ({ chat; user_access_level } : get_chat_response)

type nonrec get_chats_for_attachment_response = {
  all_chats : chat list;
  recent_chat : chat option;
}

let get_chats_for_attachment_response_of_yojson :
    Yojson.Safe.t -> get_chats_for_attachment_response =
 fun json ->
  let fields = Json.obj json in
  {
    all_chats = Json.required fields "all_chats" (Json.list chat_of_yojson);
    recent_chat = Json.optional fields "recent_chat" chat_of_yojson;
  }

and yojson_of_get_chats_for_attachment_response :
    get_chats_for_attachment_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("all_chats", Some ((Json.of_list yojson_of_chat) value.all_chats));
      ("recent_chat", Option.map yojson_of_chat value.recent_chat);
    ]

let make_get_chats_for_attachment_response ~(all_chats : chat list) ?recent_chat
    () =
  ({ all_chats; recent_chat } : get_chats_for_attachment_response)

(** The requested inference speed. Standard is backward compatible with old clients. *)
type nonrec model_speed =
  | Standard
  | Fast
  | Ultrafast
  | Unknown of string  (** A value this SDK version does not know. *)

let model_speed_of_yojson : Yojson.Safe.t -> model_speed =
 fun json ->
  match Json.string json with
  | "standard" -> Standard
  | "fast" -> Fast
  | "ultrafast" -> Ultrafast
  | other -> Unknown other

and yojson_of_model_speed : model_speed -> Yojson.Safe.t =
 fun value ->
  match value with
  | Standard -> `String "standard"
  | Fast -> `String "fast"
  | Ultrafast -> `String "ultrafast"
  | Unknown other -> `String other

type nonrec tool_set =
  | All
  | None_
  | Databases
  | Databases_read_only
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let tool_set_of_yojson : Yojson.Safe.t -> tool_set =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "type" with
  | "all" -> All
  | "none" -> None_
  | "databases" -> Databases
  | "databases_read_only" -> Databases_read_only
  | _ -> Unknown json

and yojson_of_tool_set : tool_set -> Yojson.Safe.t =
 fun value ->
  match value with
  | All -> Json.record [ ("type", Some (`String "all")) ]
  | None_ -> Json.record [ ("type", Some (`String "none")) ]
  | Databases -> Json.record [ ("type", Some (`String "databases")) ]
  | Databases_read_only ->
      Json.record [ ("type", Some (`String "databases_read_only")) ]
  | Unknown json -> json

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

let http_send_chat_message_request_of_yojson :
    Yojson.Safe.t -> http_send_chat_message_request =
 fun json ->
  let fields = Json.obj json in
  {
    additional_instructions =
      Json.optional fields "additional_instructions" Json.string;
    attachments =
      Json.optional fields "attachments" (Json.list entity_of_yojson);
    chat_id = Json.optional fields "chat_id" Json.string;
    content = Json.required fields "content" Json.string;
    model = Json.required fields "model" Json.string;
    speed = Json.optional fields "speed" model_speed_of_yojson;
    toolset = Json.optional fields "toolset" tool_set_of_yojson;
  }

and yojson_of_http_send_chat_message_request :
    http_send_chat_message_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "additional_instructions",
        Option.map Json.of_string value.additional_instructions );
      ( "attachments",
        Option.map (Json.of_list yojson_of_entity) value.attachments );
      ("chat_id", Option.map Json.of_string value.chat_id);
      ("content", Some (Json.of_string value.content));
      ("model", Some (Json.of_string value.model));
      ("speed", Option.map yojson_of_model_speed value.speed);
      ("toolset", Option.map yojson_of_tool_set value.toolset);
    ]

let make_http_send_chat_message_request ?additional_instructions ?attachments
    ?chat_id ~(content : string) ~(model : string) ?speed ?toolset () =
  ({
     additional_instructions;
     attachments;
     chat_id;
     content;
     model;
     speed;
     toolset;
   }
    : http_send_chat_message_request)

(** Where an import entity was first staged from. Provenance only — never a
visibility filter. *)
type nonrec initiator =
  | Onboarding
  | Chat
  | Archive
  | Manual
  | Unknown of string  (** A value this SDK version does not know. *)

let initiator_of_yojson : Yojson.Safe.t -> initiator =
 fun json ->
  match Json.string json with
  | "onboarding" -> Onboarding
  | "chat" -> Chat
  | "archive" -> Archive
  | "manual" -> Manual
  | other -> Unknown other

and yojson_of_initiator : initiator -> Yojson.Safe.t =
 fun value ->
  match value with
  | Onboarding -> `String "onboarding"
  | Chat -> `String "chat"
  | Archive -> `String "archive"
  | Manual -> `String "manual"
  | Unknown other -> `String other

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

let import_kind_of_yojson : Yojson.Safe.t -> import_kind =
 fun json ->
  match Json.string json with
  | "issue" -> Issue
  | "project" -> Project
  | "document" -> Document
  | "page" -> Page
  | "database" -> Database
  | "data_source" -> Data_source
  | "row" -> Row
  | "jira_issue" -> Jira_issue
  | "jira_project" -> Jira_project
  | "jira_epic" -> Jira_epic
  | "channel" -> Channel
  | other -> Unknown other

and yojson_of_import_kind : import_kind -> Yojson.Safe.t =
 fun value ->
  match value with
  | Issue -> `String "issue"
  | Project -> `String "project"
  | Document -> `String "document"
  | Page -> `String "page"
  | Database -> `String "database"
  | Data_source -> `String "data_source"
  | Row -> `String "row"
  | Jira_issue -> `String "jira_issue"
  | Jira_project -> `String "jira_project"
  | Jira_epic -> `String "jira_epic"
  | Channel -> `String "channel"
  | Unknown other -> `String other

(** External systems items can be imported from. *)
type nonrec import_source =
  | Linear
  | Jira
  | Notion
  | Slack
  | Unknown of string  (** A value this SDK version does not know. *)

let import_source_of_yojson : Yojson.Safe.t -> import_source =
 fun json ->
  match Json.string json with
  | "linear" -> Linear
  | "jira" -> Jira
  | "notion" -> Notion
  | "slack" -> Slack
  | other -> Unknown other

and yojson_of_import_source : import_source -> Yojson.Safe.t =
 fun value ->
  match value with
  | Linear -> `String "linear"
  | Jira -> `String "jira"
  | Notion -> `String "notion"
  | Slack -> `String "slack"
  | Unknown other -> `String other

(** Lifecycle of one import entity. *)
type nonrec import_status =
  | Staged
  | Importing
  | Imported
  | Discarded
  | Unknown of string  (** A value this SDK version does not know. *)

let import_status_of_yojson : Yojson.Safe.t -> import_status =
 fun json ->
  match Json.string json with
  | "staged" -> Staged
  | "importing" -> Importing
  | "imported" -> Imported
  | "discarded" -> Discarded
  | other -> Unknown other

and yojson_of_import_status : import_status -> Yojson.Safe.t =
 fun value ->
  match value with
  | Staged -> `String "staged"
  | Importing -> `String "importing"
  | Imported -> `String "imported"
  | Discarded -> `String "discarded"
  | Unknown other -> `String other

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

let import_entity_of_yojson : Yojson.Safe.t -> import_entity =
 fun json ->
  let fields = Json.obj json in
  {
    created_at = Json.required fields "created_at" Json.string;
    entity_id = Json.optional fields "entity_id" Json.string;
    entity_type = Json.optional fields "entity_type" Json.string;
    foreign_id = Json.required fields "foreign_id" Json.string;
    id = Json.required fields "id" Json.string;
    initiator = Json.required fields "initiator" initiator_of_yojson;
    kind = Json.required fields "kind" import_kind_of_yojson;
    last_error = Json.optional fields "last_error" Json.string;
    metadata = Json.required fields "metadata" Json.json;
    parent_id = Json.optional fields "parent_id" Json.string;
    review_id = Json.optional fields "review_id" Json.string;
    source = Json.required fields "source" import_source_of_yojson;
    status = Json.required fields "status" import_status_of_yojson;
    team_id = Json.optional fields "team_id" Json.string;
    updated_at = Json.required fields "updated_at" Json.string;
    user_id = Json.required fields "user_id" Json.string;
    waiting_on = Json.optional fields "waiting_on" Json.string;
  }

and yojson_of_import_entity : import_entity -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("created_at", Some (Json.of_string value.created_at));
      ("entity_id", Option.map Json.of_string value.entity_id);
      ("entity_type", Option.map Json.of_string value.entity_type);
      ("foreign_id", Some (Json.of_string value.foreign_id));
      ("id", Some (Json.of_string value.id));
      ("initiator", Some (yojson_of_initiator value.initiator));
      ("kind", Some (yojson_of_import_kind value.kind));
      ("last_error", Option.map Json.of_string value.last_error);
      ("metadata", Some (Json.of_json value.metadata));
      ("parent_id", Option.map Json.of_string value.parent_id);
      ("review_id", Option.map Json.of_string value.review_id);
      ("source", Some (yojson_of_import_source value.source));
      ("status", Some (yojson_of_import_status value.status));
      ("team_id", Option.map Json.of_string value.team_id);
      ("updated_at", Some (Json.of_string value.updated_at));
      ("user_id", Some (Json.of_string value.user_id));
      ("waiting_on", Option.map Json.of_string value.waiting_on);
    ]

let make_import_entity ~(created_at : string) ?entity_id ?entity_type
    ~(foreign_id : string) ~(id : string) ~(initiator : initiator)
    ~(kind : import_kind) ?last_error ~(metadata : Yojson.Safe.t) ?parent_id
    ?review_id ~(source : import_source) ~(status : import_status) ?team_id
    ~(updated_at : string) ~(user_id : string) ?waiting_on () =
  ({
     created_at;
     entity_id;
     entity_type;
     foreign_id;
     id;
     initiator;
     kind;
     last_error;
     metadata;
     parent_id;
     review_id;
     source;
     status;
     team_id;
     updated_at;
     user_id;
     waiting_on;
   }
    : import_entity)

type nonrec import_entities_response = {
  entities : import_entity list;
      (** The caller's own rows and their team's imported rows, newest first. *)
}
(** The caller's ledger rows. *)

let import_entities_response_of_yojson :
    Yojson.Safe.t -> import_entities_response =
 fun json ->
  let fields = Json.obj json in
  {
    entities =
      Json.required fields "entities" (Json.list import_entity_of_yojson);
  }

and yojson_of_import_entities_response :
    import_entities_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("entities", Some ((Json.of_list yojson_of_import_entity) value.entities));
    ]

let make_import_entities_response ~(entities : import_entity list) () =
  ({ entities } : import_entities_response)

type nonrec import_notion_page_request = {
  page : string;  (** The Notion page URL or 32-character page id. *)
}
(** Body for importing one Notion page. *)

let import_notion_page_request_of_yojson :
    Yojson.Safe.t -> import_notion_page_request =
 fun json ->
  let fields = Json.obj json in
  { page = Json.required fields "page" Json.string }

and yojson_of_import_notion_page_request :
    import_notion_page_request -> Yojson.Safe.t =
 fun value -> Json.record [ ("page", Some (Json.of_string value.page)) ]

let make_import_notion_page_request ~(page : string) () =
  ({ page } : import_notion_page_request)

(** What importing one Notion page did. *)
type nonrec import_notion_page_result =
  | Imported
  | Already_imported
  | Already_imported_by_teammate
  | Previously_declined
  | Import_in_progress
  | Unknown of string  (** A value this SDK version does not know. *)

let import_notion_page_result_of_yojson :
    Yojson.Safe.t -> import_notion_page_result =
 fun json ->
  match Json.string json with
  | "imported" -> Imported
  | "already_imported" -> Already_imported
  | "already_imported_by_teammate" -> Already_imported_by_teammate
  | "previously_declined" -> Previously_declined
  | "import_in_progress" -> Import_in_progress
  | other -> Unknown other

and yojson_of_import_notion_page_result :
    import_notion_page_result -> Yojson.Safe.t =
 fun value ->
  match value with
  | Imported -> `String "imported"
  | Already_imported -> `String "already_imported"
  | Already_imported_by_teammate -> `String "already_imported_by_teammate"
  | Previously_declined -> `String "previously_declined"
  | Import_in_progress -> `String "import_in_progress"
  | Unknown other -> `String other

type nonrec import_notion_page_response = {
  entity : import_entity;
      (** The row behind the outcome; [entity_id] is the document once imported. *)
  outcome : import_notion_page_result;  (** What happened. *)
}
(** The outcome of importing a Notion page, with its ledger row. *)

let import_notion_page_response_of_yojson :
    Yojson.Safe.t -> import_notion_page_response =
 fun json ->
  let fields = Json.obj json in
  {
    entity = Json.required fields "entity" import_entity_of_yojson;
    outcome = Json.required fields "outcome" import_notion_page_result_of_yojson;
  }

and yojson_of_import_notion_page_response :
    import_notion_page_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("entity", Some (yojson_of_import_entity value.entity));
      ("outcome", Some (yojson_of_import_notion_page_result value.outcome));
    ]

let make_import_notion_page_response ~(entity : import_entity)
    ~(outcome : import_notion_page_result) () =
  ({ entity; outcome } : import_notion_page_response)

type nonrec scan_counts = {
  data_sources : int;  (** Data sources (database tables) found. *)
  pages : int;  (** Pages found. *)
}
(** What a planning run has found in the source so far. *)

let scan_counts_of_yojson : Yojson.Safe.t -> scan_counts =
 fun json ->
  let fields = Json.obj json in
  {
    data_sources = Json.required fields "dataSources" Json.int;
    pages = Json.required fields "pages" Json.int;
  }

and yojson_of_scan_counts : scan_counts -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("dataSources", Some (Json.of_int value.data_sources));
      ("pages", Some (Json.of_int value.pages));
    ]

let make_scan_counts ~(data_sources : int) ~(pages : int) () =
  ({ data_sources; pages } : scan_counts)

(** Lifecycle of a discovery run (one per user × source). *)
type nonrec run_status =
  | Running
  | Ready
  | Importing
  | Completed
  | Failed
  | Dismissed
  | Unknown of string  (** A value this SDK version does not know. *)

let run_status_of_yojson : Yojson.Safe.t -> run_status =
 fun json ->
  match Json.string json with
  | "running" -> Running
  | "ready" -> Ready
  | "importing" -> Importing
  | "completed" -> Completed
  | "failed" -> Failed
  | "dismissed" -> Dismissed
  | other -> Unknown other

and yojson_of_run_status : run_status -> Yojson.Safe.t =
 fun value ->
  match value with
  | Running -> `String "running"
  | Ready -> `String "ready"
  | Importing -> `String "importing"
  | Completed -> `String "completed"
  | Failed -> `String "failed"
  | Dismissed -> `String "dismissed"
  | Unknown other -> `String other

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

let import_run_of_yojson : Yojson.Safe.t -> import_run =
 fun json ->
  let fields = Json.obj json in
  {
    error = Json.optional fields "error" Json.string;
    review_id = Json.optional fields "review_id" Json.string;
    scanned = Json.optional fields "scanned" scan_counts_of_yojson;
    source = Json.required fields "source" import_source_of_yojson;
    status = Json.required fields "status" run_status_of_yojson;
    updated_at = Json.required fields "updated_at" Json.string;
  }

and yojson_of_import_run : import_run -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("error", Option.map Json.of_string value.error);
      ("review_id", Option.map Json.of_string value.review_id);
      ("scanned", Option.map yojson_of_scan_counts value.scanned);
      ("source", Some (yojson_of_import_source value.source));
      ("status", Some (yojson_of_run_status value.status));
      ("updated_at", Some (Json.of_string value.updated_at));
    ]

let make_import_run ?error ?review_id ?scanned ~(source : import_source)
    ~(status : run_status) ~(updated_at : string) () =
  ({ error; review_id; scanned; source; status; updated_at } : import_run)

type nonrec import_state = {
  entities : import_entity list;  (** Visible import entities, newest first. *)
  runs : import_run list;
      (** Discovery runs, one per source that ever ran discovery. *)
}
(** The full import aggregate for a user: discovery runs plus visible ledger
rows (their own, and teammates' team-imported rows). *)

let import_state_of_yojson : Yojson.Safe.t -> import_state =
 fun json ->
  let fields = Json.obj json in
  {
    entities =
      Json.required fields "entities" (Json.list import_entity_of_yojson);
    runs = Json.required fields "runs" (Json.list import_run_of_yojson);
  }

and yojson_of_import_state : import_state -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("entities", Some ((Json.of_list yojson_of_import_entity) value.entities));
      ("runs", Some ((Json.of_list yojson_of_import_run) value.runs));
    ]

let make_import_state ~(entities : import_entity list) ~(runs : import_run list)
    () =
  ({ entities; runs } : import_state)

type nonrec jwt_payload = { token : string }

let jwt_payload_of_yojson : Yojson.Safe.t -> jwt_payload =
 fun json ->
  let fields = Json.obj json in
  { token = Json.required fields "token" Json.string }

and yojson_of_jwt_payload : jwt_payload -> Yojson.Safe.t =
 fun value -> Json.record [ ("token", Some (Json.of_string value.token)) ]

let make_jwt_payload ~(token : string) () = ({ token } : jwt_payload)

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

let linear_issue_meta_of_yojson : Yojson.Safe.t -> linear_issue_meta =
 fun json ->
  let fields = Json.obj json in
  {
    assignee = Json.optional fields "assignee" Json.string;
    assignee_email = Json.optional fields "assignee_email" Json.string;
    description = Json.optional fields "description" Json.string;
    due_date = Json.optional fields "due_date" Json.string;
    identifier = Json.optional fields "identifier" Json.string;
    priority = Json.optional fields "priority" Json.string;
    status = Json.optional fields "status" Json.string;
    title = Json.required fields "title" Json.string;
    url = Json.optional fields "url" Json.string;
  }

and yojson_of_linear_issue_meta : linear_issue_meta -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("assignee", Option.map Json.of_string value.assignee);
      ("assignee_email", Option.map Json.of_string value.assignee_email);
      ("description", Option.map Json.of_string value.description);
      ("due_date", Option.map Json.of_string value.due_date);
      ("identifier", Option.map Json.of_string value.identifier);
      ("priority", Option.map Json.of_string value.priority);
      ("status", Option.map Json.of_string value.status);
      ("title", Some (Json.of_string value.title));
      ("url", Option.map Json.of_string value.url);
    ]

let make_linear_issue_meta ?assignee ?assignee_email ?description ?due_date
    ?identifier ?priority ?status ~(title : string) ?url () =
  ({
     assignee;
     assignee_email;
     description;
     due_date;
     identifier;
     priority;
     status;
     title;
     url;
   }
    : linear_issue_meta)

(** An edit to one one-based line. A revision is required to prevent replay
or concurrent edits from inserting twice or deleting a different line. *)
type nonrec memory_edit =
  | Insert of { content : string; line : int }
  | Replace of { content : string; line : int }
  | Delete of { line : int }
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let memory_edit_of_yojson : Yojson.Safe.t -> memory_edit =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "action" with
  | "insert" ->
      Insert
        {
          content = Json.required fields "content" Json.string;
          line = Json.required fields "line" Json.int;
        }
  | "replace" ->
      Replace
        {
          content = Json.required fields "content" Json.string;
          line = Json.required fields "line" Json.int;
        }
  | "delete" -> Delete { line = Json.required fields "line" Json.int }
  | _ -> Unknown json

and yojson_of_memory_edit : memory_edit -> Yojson.Safe.t =
 fun value ->
  match value with
  | Insert case ->
      Json.record
        [
          ("action", Some (`String "insert"));
          ("content", Some (Json.of_string case.content));
          ("line", Some (Json.of_int case.line));
        ]
  | Replace case ->
      Json.record
        [
          ("action", Some (`String "replace"));
          ("content", Some (Json.of_string case.content));
          ("line", Some (Json.of_int case.line));
        ]
  | Delete case ->
      Json.record
        [
          ("action", Some (`String "delete"));
          ("line", Some (Json.of_int case.line));
        ]
  | Unknown json -> json

let make_memory_edit_insert ~(content : string) ~(line : int) () =
  (Insert { content; line } : memory_edit)

let make_memory_edit_replace ~(content : string) ~(line : int) () =
  (Replace { content; line } : memory_edit)

let make_memory_edit_delete ~(line : int) () = (Delete { line } : memory_edit)

type nonrec memory_error_body = { error : string  (** Error description. *) }

let memory_error_body_of_yojson : Yojson.Safe.t -> memory_error_body =
 fun json ->
  let fields = Json.obj json in
  { error = Json.required fields "error" Json.string }

and yojson_of_memory_error_body : memory_error_body -> Yojson.Safe.t =
 fun value -> Json.record [ ("error", Some (Json.of_string value.error)) ]

let make_memory_error_body ~(error : string) () =
  ({ error } : memory_error_body)

type nonrec memory_response = {
  memory : string;  (** The generated memory text. *)
}
(** The user's latest memory. *)

let memory_response_of_yojson : Yojson.Safe.t -> memory_response =
 fun json ->
  let fields = Json.obj json in
  { memory = Json.required fields "memory" Json.string }

and yojson_of_memory_response : memory_response -> Yojson.Safe.t =
 fun value -> Json.record [ ("memory", Some (Json.of_string value.memory)) ]

let make_memory_response ~(memory : string) () = ({ memory } : memory_response)

type nonrec new_attachment = {
  attachment_id : string;
  attachment_type : attachment_type;
}

let new_attachment_of_yojson : Yojson.Safe.t -> new_attachment =
 fun json ->
  let fields = Json.obj json in
  {
    attachment_id = Json.required fields "attachment_id" Json.string;
    attachment_type =
      Json.required fields "attachment_type" attachment_type_of_yojson;
  }

and yojson_of_new_attachment : new_attachment -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("attachment_id", Some (Json.of_string value.attachment_id));
      ("attachment_type", Some (yojson_of_attachment_type value.attachment_type));
    ]

let make_new_attachment ~(attachment_id : string)
    ~(attachment_type : attachment_type) () =
  ({ attachment_id; attachment_type } : new_attachment)

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

let new_chat_message_of_yojson : Yojson.Safe.t -> new_chat_message =
 fun json ->
  let fields = Json.obj json in
  {
    attachments =
      Json.optional fields "attachments" (Json.list new_attachment_of_yojson);
    content = Json.required fields "content" chat_message_content_of_yojson;
    created_at = Json.required fields "createdAt" Json.string;
    id = Json.optional fields "id" Json.string;
    model = Json.required fields "model" Json.string;
    role = Json.required fields "role" role_of_yojson;
    updated_at = Json.required fields "updatedAt" Json.string;
  }

and yojson_of_new_chat_message : new_chat_message -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "attachments",
        Option.map (Json.of_list yojson_of_new_attachment) value.attachments );
      ("content", Some (yojson_of_chat_message_content value.content));
      ("createdAt", Some (Json.of_string value.created_at));
      ("id", Option.map Json.of_string value.id);
      ("model", Some (Json.of_string value.model));
      ("role", Some (yojson_of_role value.role));
      ("updatedAt", Some (Json.of_string value.updated_at));
    ]

let make_new_chat_message ?attachments ~(content : chat_message_content)
    ~(created_at : string) ?id ~(model : string) ~(role : role)
    ~(updated_at : string) () =
  ({ attachments; content; created_at; id; model; role; updated_at }
    : new_chat_message)

type nonrec new_message_attachment = {
  attachment_id : string;
  attachment_type : attachment_type;
  message_id : string;
}

let new_message_attachment_of_yojson : Yojson.Safe.t -> new_message_attachment =
 fun json ->
  let fields = Json.obj json in
  {
    attachment_id = Json.required fields "attachmentId" Json.string;
    attachment_type =
      Json.required fields "attachmentType" attachment_type_of_yojson;
    message_id = Json.required fields "messageId" Json.string;
  }

and yojson_of_new_message_attachment : new_message_attachment -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("attachmentId", Some (Json.of_string value.attachment_id));
      ("attachmentType", Some (yojson_of_attachment_type value.attachment_type));
      ("messageId", Some (Json.of_string value.message_id));
    ]

let make_new_message_attachment ~(attachment_id : string)
    ~(attachment_type : attachment_type) ~(message_id : string) () =
  ({ attachment_id; attachment_type; message_id } : new_message_attachment)

type nonrec notion_already_imported = {
  by : string;  (** The teammate who imported it, by email. *)
  entity_id : string;  (** The Macro entity it became. *)
  entity_type : string;  (** That entity's type ([md], [project]). *)
}
(** A teammate's copy of a Notion object, shared with the user's team. *)

let notion_already_imported_of_yojson : Yojson.Safe.t -> notion_already_imported
    =
 fun json ->
  let fields = Json.obj json in
  {
    by = Json.required fields "by" Json.string;
    entity_id = Json.required fields "entityId" Json.string;
    entity_type = Json.required fields "entityType" Json.string;
  }

and yojson_of_notion_already_imported : notion_already_imported -> Yojson.Safe.t
    =
 fun value ->
  Json.record
    [
      ("by", Some (Json.of_string value.by));
      ("entityId", Some (Json.of_string value.entity_id));
      ("entityType", Some (Json.of_string value.entity_type));
    ]

let make_notion_already_imported ~(by : string) ~(entity_id : string)
    ~(entity_type : string) () =
  ({ by; entity_id; entity_type } : notion_already_imported)

(** What a workspace import does with one Notion object. *)
type nonrec notion_decision =
  | Copy
  | Tasks
  | Skip
  | Hand
  | Unknown of string  (** A value this SDK version does not know. *)

let notion_decision_of_yojson : Yojson.Safe.t -> notion_decision =
 fun json ->
  match Json.string json with
  | "copy" -> Copy
  | "tasks" -> Tasks
  | "skip" -> Skip
  | "hand" -> Hand
  | other -> Unknown other

and yojson_of_notion_decision : notion_decision -> Yojson.Safe.t =
 fun value ->
  match value with
  | Copy -> `String "copy"
  | Tasks -> `String "tasks"
  | Skip -> `String "skip"
  | Hand -> `String "hand"
  | Unknown other -> `String other

type nonrec notion_task_fields = {
  assignee : string option;  (** The assignee column. *)
  due : string option;  (** The due date column. *)
  priority : string option;  (** The priority column. *)
  status : string option;  (** The status column. *)
}
(** Which Notion columns hold a task list's task fields, by property name. *)

let notion_task_fields_of_yojson : Yojson.Safe.t -> notion_task_fields =
 fun json ->
  let fields = Json.obj json in
  {
    assignee = Json.optional fields "assignee" Json.string;
    due = Json.optional fields "due" Json.string;
    priority = Json.optional fields "priority" Json.string;
    status = Json.optional fields "status" Json.string;
  }

and yojson_of_notion_task_fields : notion_task_fields -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("assignee", Option.map Json.of_string value.assignee);
      ("due", Option.map Json.of_string value.due);
      ("priority", Option.map Json.of_string value.priority);
      ("status", Option.map Json.of_string value.status);
    ]

let make_notion_task_fields ?assignee ?due ?priority ?status () =
  ({ assignee; due; priority; status } : notion_task_fields)

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

let notion_plan_item_of_yojson : Yojson.Safe.t -> notion_plan_item =
 fun json ->
  let fields = Json.obj json in
  {
    already_imported =
      Json.optional fields "alreadyImported" notion_already_imported_of_yojson;
    decision = Json.optional fields "decision" notion_decision_of_yojson;
    path = Json.optional fields "path" (Json.list Json.string);
    reason = Json.optional fields "reason" Json.string;
    rows = Json.optional fields "rows" Json.int;
    sample_titles = Json.optional fields "sampleTitles" (Json.list Json.string);
    shareable = Json.optional fields "shareable" Json.bool;
    shared = Json.optional fields "shared" Json.bool;
    shared_reason = Json.optional fields "sharedReason" Json.string;
    task_fields = Json.optional fields "taskFields" notion_task_fields_of_yojson;
  }

and yojson_of_notion_plan_item : notion_plan_item -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "alreadyImported",
        Option.map yojson_of_notion_already_imported value.already_imported );
      ("decision", Option.map yojson_of_notion_decision value.decision);
      ("path", Option.map (Json.of_list Json.of_string) value.path);
      ("reason", Option.map Json.of_string value.reason);
      ("rows", Option.map Json.of_int value.rows);
      ( "sampleTitles",
        Option.map (Json.of_list Json.of_string) value.sample_titles );
      ("shareable", Option.map Json.of_bool value.shareable);
      ("shared", Option.map Json.of_bool value.shared);
      ("sharedReason", Option.map Json.of_string value.shared_reason);
      ("taskFields", Option.map yojson_of_notion_task_fields value.task_fields);
    ]

let make_notion_plan_item ?already_imported ?decision ?path ?reason ?rows
    ?sample_titles ?shareable ?shared ?shared_reason ?task_fields () =
  ({
     already_imported;
     decision;
     path;
     reason;
     rows;
     sample_titles;
     shareable;
     shared;
     shared_reason;
     task_fields;
   }
    : notion_plan_item)

type nonrec notion_doc_meta = {
  plan : notion_plan_item option;
  summary : string option;  (** One-line summary of what the page contains. *)
  title : string;  (** Page title. *)
  url : string option;  (** Deep link back to the page in Notion. *)
}
(** Metadata for one staged Notion page. Deliberately has NO content field:
page bodies are fetched at import time, for accepted pages only. *)

let notion_doc_meta_of_yojson : Yojson.Safe.t -> notion_doc_meta =
 fun json ->
  let fields = Json.obj json in
  {
    plan = Json.optional fields "plan" notion_plan_item_of_yojson;
    summary = Json.optional fields "summary" Json.string;
    title = Json.required fields "title" Json.string;
    url = Json.optional fields "url" Json.string;
  }

and yojson_of_notion_doc_meta : notion_doc_meta -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("plan", Option.map yojson_of_notion_plan_item value.plan);
      ("summary", Option.map Json.of_string value.summary);
      ("title", Some (Json.of_string value.title));
      ("url", Option.map Json.of_string value.url);
    ]

let make_notion_doc_meta ?plan ?summary ~(title : string) ?url () =
  ({ plan; summary; title; url } : notion_doc_meta)

type nonrec notion_importer = {
  by : string;  (** The teammate, by email. *)
  count : int;  (** How many of the plan's objects they imported. *)
}
(** A teammate who already imported some of a plan's objects. *)

let notion_importer_of_yojson : Yojson.Safe.t -> notion_importer =
 fun json ->
  let fields = Json.obj json in
  {
    by = Json.required fields "by" Json.string;
    count = Json.required fields "count" Json.int;
  }

and yojson_of_notion_importer : notion_importer -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("by", Some (Json.of_string value.by));
      ("count", Some (Json.of_int value.count));
    ]

let make_notion_importer ~(by : string) ~(count : int) () =
  ({ by; count } : notion_importer)

type nonrec notion_report_item = {
  import_id : string;  (** The ledger row. *)
  kind : import_kind;  (** What the object is. *)
  reason : string option;
      (** Why it is called out: the decision model's reason, or the failure. *)
  title : string;  (** The object's title. *)
  url : string option;  (** Its Notion URL. *)
}
(** One object a workspace import report calls out. *)

let notion_report_item_of_yojson : Yojson.Safe.t -> notion_report_item =
 fun json ->
  let fields = Json.obj json in
  {
    import_id = Json.required fields "importId" Json.string;
    kind = Json.required fields "kind" import_kind_of_yojson;
    reason = Json.optional fields "reason" Json.string;
    title = Json.required fields "title" Json.string;
    url = Json.optional fields "url" Json.string;
  }

and yojson_of_notion_report_item : notion_report_item -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("importId", Some (Json.of_string value.import_id));
      ("kind", Some (yojson_of_import_kind value.kind));
      ("reason", Option.map Json.of_string value.reason);
      ("title", Some (Json.of_string value.title));
      ("url", Option.map Json.of_string value.url);
    ]

let make_notion_report_item ~(import_id : string) ~(kind : import_kind) ?reason
    ~(title : string) ?url () =
  ({ import_id; kind; reason; title; url } : notion_report_item)

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

let notion_import_report_of_yojson : Yojson.Safe.t -> notion_import_report =
 fun json ->
  let fields = Json.obj json in
  {
    already_imported_by =
      Json.optional fields "alreadyImportedBy"
        (Json.list notion_importer_of_yojson);
    already_in_macro = Json.optional fields "alreadyInMacro" Json.int;
    copy = Json.required fields "copy" Json.int;
    data_sources = Json.required fields "dataSources" Json.int;
    database_rows = Json.required fields "databaseRows" Json.int;
    databases = Json.required fields "databases" Json.int;
    deciding = Json.optional fields "deciding" Json.int;
    documents = Json.required fields "documents" Json.int;
    error = Json.optional fields "error" Json.string;
    failures =
      Json.optional fields "failures" (Json.list notion_report_item_of_yojson);
    hand = Json.required fields "hand" Json.int;
    hand_items =
      Json.optional fields "handItems" (Json.list notion_report_item_of_yojson);
    imported = Json.required fields "imported" Json.int;
    issues = Json.optional fields "issues" Json.int;
    on_team = Json.optional fields "onTeam" Json.bool;
    pages = Json.required fields "pages" Json.int;
    projects = Json.optional fields "projects" Json.int;
    review_id = Json.optional fields "reviewId" Json.string;
    scanned = Json.optional fields "scanned" scan_counts_of_yojson;
    shared_with_team = Json.optional fields "sharedWithTeam" Json.int;
    skip = Json.required fields "skip" Json.int;
    status = Json.optional fields "status" run_status_of_yojson;
    task_rows = Json.required fields "taskRows" Json.int;
    tasks = Json.required fields "tasks" Json.int;
    waiting = Json.required fields "waiting" Json.int;
    waiting_on_teammates = Json.optional fields "waitingOnTeammates" Json.int;
    warnings = Json.optional fields "warnings" (Json.list Json.string);
    writing = Json.required fields "writing" Json.int;
  }

and yojson_of_notion_import_report : notion_import_report -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "alreadyImportedBy",
        Option.map
          (Json.of_list yojson_of_notion_importer)
          value.already_imported_by );
      ("alreadyInMacro", Option.map Json.of_int value.already_in_macro);
      ("copy", Some (Json.of_int value.copy));
      ("dataSources", Some (Json.of_int value.data_sources));
      ("databaseRows", Some (Json.of_int value.database_rows));
      ("databases", Some (Json.of_int value.databases));
      ("deciding", Option.map Json.of_int value.deciding);
      ("documents", Some (Json.of_int value.documents));
      ("error", Option.map Json.of_string value.error);
      ( "failures",
        Option.map (Json.of_list yojson_of_notion_report_item) value.failures );
      ("hand", Some (Json.of_int value.hand));
      ( "handItems",
        Option.map (Json.of_list yojson_of_notion_report_item) value.hand_items
      );
      ("imported", Some (Json.of_int value.imported));
      ("issues", Option.map Json.of_int value.issues);
      ("onTeam", Option.map Json.of_bool value.on_team);
      ("pages", Some (Json.of_int value.pages));
      ("projects", Option.map Json.of_int value.projects);
      ("reviewId", Option.map Json.of_string value.review_id);
      ("scanned", Option.map yojson_of_scan_counts value.scanned);
      ("sharedWithTeam", Option.map Json.of_int value.shared_with_team);
      ("skip", Some (Json.of_int value.skip));
      ("status", Option.map yojson_of_run_status value.status);
      ("taskRows", Some (Json.of_int value.task_rows));
      ("tasks", Some (Json.of_int value.tasks));
      ("waiting", Some (Json.of_int value.waiting));
      ("waitingOnTeammates", Option.map Json.of_int value.waiting_on_teammates);
      ("warnings", Option.map (Json.of_list Json.of_string) value.warnings);
      ("writing", Some (Json.of_int value.writing));
    ]

let make_notion_import_report ?already_imported_by ?already_in_macro
    ~(copy : int) ~(data_sources : int) ~(database_rows : int)
    ~(databases : int) ?deciding ~(documents : int) ?error ?failures
    ~(hand : int) ?hand_items ~(imported : int) ?issues ?on_team ~(pages : int)
    ?projects ?review_id ?scanned ?shared_with_team ~(skip : int) ?status
    ~(task_rows : int) ~(tasks : int) ~(waiting : int) ?waiting_on_teammates
    ?warnings ~(writing : int) () =
  ({
     already_imported_by;
     already_in_macro;
     copy;
     data_sources;
     database_rows;
     databases;
     deciding;
     documents;
     error;
     failures;
     hand;
     hand_items;
     imported;
     issues;
     on_team;
     pages;
     projects;
     review_id;
     scanned;
     shared_with_team;
     skip;
     status;
     task_rows;
     tasks;
     waiting;
     waiting_on_teammates;
     warnings;
     writing;
   }
    : notion_import_report)

(** Lifecycle of the onboarding flow itself. *)
type nonrec onboarding_status =
  | Active
  | Completed
  | Unknown of string  (** A value this SDK version does not know. *)

let onboarding_status_of_yojson : Yojson.Safe.t -> onboarding_status =
 fun json ->
  match Json.string json with
  | "active" -> Active
  | "completed" -> Completed
  | other -> Unknown other

and yojson_of_onboarding_status : onboarding_status -> Yojson.Safe.t =
 fun value ->
  match value with
  | Active -> `String "active"
  | Completed -> `String "completed"
  | Unknown other -> `String other

type nonrec onboarding_row = {
  completed_at : string option;  (** When the flow completed, if it has. *)
  skipped : bool;  (** Whether the user skipped rather than finished. *)
  started_at : string;  (** When the flow was first touched. *)
  status : onboarding_status;  (** Where the flow is in its lifecycle. *)
}
(** One user's onboarding row. *)

let onboarding_row_of_yojson : Yojson.Safe.t -> onboarding_row =
 fun json ->
  let fields = Json.obj json in
  {
    completed_at = Json.optional fields "completed_at" Json.string;
    skipped = Json.required fields "skipped" Json.bool;
    started_at = Json.required fields "started_at" Json.string;
    status = Json.required fields "status" onboarding_status_of_yojson;
  }

and yojson_of_onboarding_row : onboarding_row -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("completed_at", Option.map Json.of_string value.completed_at);
      ("skipped", Some (Json.of_bool value.skipped));
      ("started_at", Some (Json.of_string value.started_at));
      ("status", Some (yojson_of_onboarding_status value.status));
    ]

let make_onboarding_row ?completed_at ~(skipped : bool) ~(started_at : string)
    ~(status : onboarding_status) () =
  ({ completed_at; skipped; started_at; status } : onboarding_row)

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

let onboarding_state_of_yojson : Yojson.Safe.t -> onboarding_state =
 fun json ->
  let fields = Json.obj json in
  {
    connected_servers =
      Json.required fields "connected_servers"
        (Json.list connected_server_of_yojson);
    row = Json.required fields "row" onboarding_row_of_yojson;
    suggested_team_domain =
      Json.optional fields "suggested_team_domain" Json.string;
  }

and yojson_of_onboarding_state : onboarding_state -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "connected_servers",
        Some ((Json.of_list yojson_of_connected_server) value.connected_servers)
      );
      ("row", Some (yojson_of_onboarding_row value.row));
      ( "suggested_team_domain",
        Option.map Json.of_string value.suggested_team_domain );
    ]

let make_onboarding_state ~(connected_servers : connected_server list)
    ~(row : onboarding_row) ?suggested_team_domain () =
  ({ connected_servers; row; suggested_team_domain } : onboarding_state)

type nonrec update_operation =
  | Add
  | Remove
  | Replace
  | Unknown of string  (** A value this SDK version does not know. *)

let update_operation_of_yojson : Yojson.Safe.t -> update_operation =
 fun json ->
  match Json.string json with
  | "add" -> Add
  | "remove" -> Remove
  | "replace" -> Replace
  | other -> Unknown other

and yojson_of_update_operation : update_operation -> Yojson.Safe.t =
 fun value ->
  match value with
  | Add -> `String "add"
  | Remove -> `String "remove"
  | Replace -> `String "replace"
  | Unknown other -> `String other

type nonrec update_channel_share_permission = {
  access_level : access_level option;
  channel_id : string;  (** The channel id *)
  operation : update_operation;
      (** The type of operation to be performed on the chanel share permission
You can add, remove or replace and existing permission *)
}

let update_channel_share_permission_of_yojson :
    Yojson.Safe.t -> update_channel_share_permission =
 fun json ->
  let fields = Json.obj json in
  {
    access_level = Json.optional fields "accessLevel" access_level_of_yojson;
    channel_id = Json.required fields "channelId" Json.string;
    operation = Json.required fields "operation" update_operation_of_yojson;
  }

and yojson_of_update_channel_share_permission :
    update_channel_share_permission -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("accessLevel", Option.map yojson_of_access_level value.access_level);
      ("channelId", Some (Json.of_string value.channel_id));
      ("operation", Some (yojson_of_update_operation value.operation));
    ]

let make_update_channel_share_permission ?access_level ~(channel_id : string)
    ~(operation : update_operation) () =
  ({ access_level; channel_id; operation } : update_channel_share_permission)

type nonrec update_share_permission_request_v2 = {
  channel_share_permissions : update_channel_share_permission list option;
      (** Any channel share permissions to be created/updated/removed *)
  link_share : link_share option;
  link_share_access_level : access_level option;
  team_share_access_level : access_level option;
}

let update_share_permission_request_v2_of_yojson :
    Yojson.Safe.t -> update_share_permission_request_v2 =
 fun json ->
  let fields = Json.obj json in
  {
    channel_share_permissions =
      Json.optional fields "channelSharePermissions"
        (Json.list update_channel_share_permission_of_yojson);
    link_share = Json.optional fields "linkShare" link_share_of_yojson;
    link_share_access_level =
      Json.optional fields "linkShareAccessLevel" access_level_of_yojson;
    team_share_access_level =
      Json.optional fields "teamShareAccessLevel" access_level_of_yojson;
  }

and yojson_of_update_share_permission_request_v2 :
    update_share_permission_request_v2 -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "channelSharePermissions",
        Option.map
          (Json.of_list yojson_of_update_channel_share_permission)
          value.channel_share_permissions );
      ("linkShare", Option.map yojson_of_link_share value.link_share);
      ( "linkShareAccessLevel",
        Option.map yojson_of_access_level value.link_share_access_level );
      ( "teamShareAccessLevel",
        Option.map yojson_of_access_level value.team_share_access_level );
    ]

let make_update_share_permission_request_v2 ?channel_share_permissions
    ?link_share ?link_share_access_level ?team_share_access_level () =
  ({
     channel_share_permissions;
     link_share;
     link_share_access_level;
     team_share_access_level;
   }
    : update_share_permission_request_v2)

type nonrec patch_chat_request = {
  name : string option;  (** New name for the chat. *)
  project_id : string option;
      (** New project ID for the chat. Empty string clears the project. *)
  share_permission : update_share_permission_request_v2 option;
}
(** Request body for patching a chat. *)

let patch_chat_request_of_yojson : Yojson.Safe.t -> patch_chat_request =
 fun json ->
  let fields = Json.obj json in
  {
    name = Json.optional fields "name" Json.string;
    project_id = Json.optional fields "projectId" Json.string;
    share_permission =
      Json.optional fields "sharePermission"
        update_share_permission_request_v2_of_yojson;
  }

and yojson_of_patch_chat_request : patch_chat_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("name", Option.map Json.of_string value.name);
      ("projectId", Option.map Json.of_string value.project_id);
      ( "sharePermission",
        Option.map yojson_of_update_share_permission_request_v2
          value.share_permission );
    ]

let make_patch_chat_request ?name ?project_id ?share_permission () =
  ({ name; project_id; share_permission } : patch_chat_request)

type nonrec pipedream_catalog_entry_response = {
  app_slug : string;
      (** Pipedream app name slug — pass this to the connect flow. *)
  categories : string list option;  (** Categories assigned by Pipedream. *)
  description : string option;  (** One-line description of the app. *)
  display_name : string;  (** Human-readable name to display. *)
  icon_url : string option;  (** URL of the app's icon, when available. *)
}
(** One connectable app in the catalog. *)

let pipedream_catalog_entry_response_of_yojson :
    Yojson.Safe.t -> pipedream_catalog_entry_response =
 fun json ->
  let fields = Json.obj json in
  {
    app_slug = Json.required fields "app_slug" Json.string;
    categories = Json.optional fields "categories" (Json.list Json.string);
    description = Json.optional fields "description" Json.string;
    display_name = Json.required fields "display_name" Json.string;
    icon_url = Json.optional fields "icon_url" Json.string;
  }

and yojson_of_pipedream_catalog_entry_response :
    pipedream_catalog_entry_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("app_slug", Some (Json.of_string value.app_slug));
      ("categories", Option.map (Json.of_list Json.of_string) value.categories);
      ("description", Option.map Json.of_string value.description);
      ("display_name", Some (Json.of_string value.display_name));
      ("icon_url", Option.map Json.of_string value.icon_url);
    ]

let make_pipedream_catalog_entry_response ~(app_slug : string) ?categories
    ?description ~(display_name : string) ?icon_url () =
  ({ app_slug; categories; description; display_name; icon_url }
    : pipedream_catalog_entry_response)

type nonrec pipedream_catalog_response = {
  next_cursor : string option;
      (** Cursor for the next page. Absent on the last page. *)
  servers : pipedream_catalog_entry_response list;
      (** Catalog entries in display order (most popular first). *)
}
(** A page of the connector catalog. *)

let pipedream_catalog_response_of_yojson :
    Yojson.Safe.t -> pipedream_catalog_response =
 fun json ->
  let fields = Json.obj json in
  {
    next_cursor = Json.optional fields "next_cursor" Json.string;
    servers =
      Json.required fields "servers"
        (Json.list pipedream_catalog_entry_response_of_yojson);
  }

and yojson_of_pipedream_catalog_response :
    pipedream_catalog_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("next_cursor", Option.map Json.of_string value.next_cursor);
      ( "servers",
        Some
          ((Json.of_list yojson_of_pipedream_catalog_entry_response)
             value.servers) );
    ]

let make_pipedream_catalog_response ?next_cursor
    ~(servers : pipedream_catalog_entry_response list) () =
  ({ next_cursor; servers } : pipedream_catalog_response)

type nonrec pipedream_complete_request = {
  account_id : string;
      (** The connected-account ID reported by the Connect UI on success. *)
  server_name : string option;
      (** Optional display name for the connector. Defaults to the app's name
for new connections; existing connections keep their name. *)
}
(** Request body for completing a Pipedream connect flow. *)

let pipedream_complete_request_of_yojson :
    Yojson.Safe.t -> pipedream_complete_request =
 fun json ->
  let fields = Json.obj json in
  {
    account_id = Json.required fields "account_id" Json.string;
    server_name = Json.optional fields "server_name" Json.string;
  }

and yojson_of_pipedream_complete_request :
    pipedream_complete_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("account_id", Some (Json.of_string value.account_id));
      ("server_name", Option.map Json.of_string value.server_name);
    ]

let make_pipedream_complete_request ~(account_id : string) ?server_name () =
  ({ account_id; server_name } : pipedream_complete_request)

type nonrec pipedream_connect_complete_request = {
  app_slug : string;  (** The app that was connected, by Pipedream slug. *)
  server_name : string option;
      (** Optional display name for the connector, as for completion. *)
}
(** Request body for recording a finished Macro Connect flow. *)

let pipedream_connect_complete_request_of_yojson :
    Yojson.Safe.t -> pipedream_connect_complete_request =
 fun json ->
  let fields = Json.obj json in
  {
    app_slug = Json.required fields "app_slug" Json.string;
    server_name = Json.optional fields "server_name" Json.string;
  }

and yojson_of_pipedream_connect_complete_request :
    pipedream_connect_complete_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("app_slug", Some (Json.of_string value.app_slug));
      ("server_name", Option.map Json.of_string value.server_name);
    ]

let make_pipedream_connect_complete_request ~(app_slug : string) ?server_name ()
    =
  ({ app_slug; server_name } : pipedream_connect_complete_request)

(** Which backend a connection or connect flow uses. *)
type nonrec pipedream_provider_response =
  | Pipedream
  | Connect
  | Unknown of string  (** A value this SDK version does not know. *)

let pipedream_provider_response_of_yojson :
    Yojson.Safe.t -> pipedream_provider_response =
 fun json ->
  match Json.string json with
  | "pipedream" -> Pipedream
  | "connect" -> Connect
  | other -> Unknown other

and yojson_of_pipedream_provider_response :
    pipedream_provider_response -> Yojson.Safe.t =
 fun value ->
  match value with
  | Pipedream -> `String "pipedream"
  | Connect -> `String "connect"
  | Unknown other -> `String other

type nonrec pipedream_connection_response = {
  app_slug : string;  (** Pipedream app name slug, e.g. [linear]. *)
  enabled : bool;  (** Whether the connector is enabled for tool use. *)
  provider : pipedream_provider_response;  (** The backend holding the grant. *)
  server_name : string;  (** Human-readable display name. *)
}
(** A connected MCP app as returned by the API. *)

let pipedream_connection_response_of_yojson :
    Yojson.Safe.t -> pipedream_connection_response =
 fun json ->
  let fields = Json.obj json in
  {
    app_slug = Json.required fields "app_slug" Json.string;
    enabled = Json.required fields "enabled" Json.bool;
    provider =
      Json.required fields "provider" pipedream_provider_response_of_yojson;
    server_name = Json.required fields "server_name" Json.string;
  }

and yojson_of_pipedream_connection_response :
    pipedream_connection_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("app_slug", Some (Json.of_string value.app_slug));
      ("enabled", Some (Json.of_bool value.enabled));
      ("provider", Some (yojson_of_pipedream_provider_response value.provider));
      ("server_name", Some (Json.of_string value.server_name));
    ]

let make_pipedream_connection_response ~(app_slug : string) ~(enabled : bool)
    ~(provider : pipedream_provider_response) ~(server_name : string) () =
  ({ app_slug; enabled; provider; server_name } : pipedream_connection_response)

type nonrec pipedream_overlay_response = {
  app_slug : string;
      (** Pipedream app name slug, as it appears in the catalog. *)
  server_url : string;
      (** The MCP server to authorize with the native MCP OAuth flow. *)
}
(** A catalog app that connects through its own MCP server instead of
Pipedream. *)

let pipedream_overlay_response_of_yojson :
    Yojson.Safe.t -> pipedream_overlay_response =
 fun json ->
  let fields = Json.obj json in
  {
    app_slug = Json.required fields "app_slug" Json.string;
    server_url = Json.required fields "server_url" Json.string;
  }

and yojson_of_pipedream_overlay_response :
    pipedream_overlay_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("app_slug", Some (Json.of_string value.app_slug));
      ("server_url", Some (Json.of_string value.server_url));
    ]

let make_pipedream_overlay_response ~(app_slug : string) ~(server_url : string)
    () =
  ({ app_slug; server_url } : pipedream_overlay_response)

type nonrec pipedream_recover_request = {
  app_slug : string;
      (** The Pipedream app the flow was connecting, by name slug. *)
  server_name : string option;
      (** Optional display name for the connector, as for completion. *)
}
(** Request body for recovering a connect flow whose result the Connect UI
never reported. *)

let pipedream_recover_request_of_yojson :
    Yojson.Safe.t -> pipedream_recover_request =
 fun json ->
  let fields = Json.obj json in
  {
    app_slug = Json.required fields "app_slug" Json.string;
    server_name = Json.optional fields "server_name" Json.string;
  }

and yojson_of_pipedream_recover_request :
    pipedream_recover_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("app_slug", Some (Json.of_string value.app_slug));
      ("server_name", Option.map Json.of_string value.server_name);
    ]

let make_pipedream_recover_request ~(app_slug : string) ?server_name () =
  ({ app_slug; server_name } : pipedream_recover_request)

type nonrec pipedream_token_request = {
  app_slug : string option;
      (** The app to connect, by Pipedream slug. With it, an app Macro Connect
serves can answer with a Connect URL instead of a Pipedream token. *)
}
(** Request body for starting a connect flow. *)

let pipedream_token_request_of_yojson : Yojson.Safe.t -> pipedream_token_request
    =
 fun json ->
  let fields = Json.obj json in
  { app_slug = Json.optional fields "app_slug" Json.string }

and yojson_of_pipedream_token_request : pipedream_token_request -> Yojson.Safe.t
    =
 fun value ->
  Json.record [ ("app_slug", Option.map Json.of_string value.app_slug) ]

let make_pipedream_token_request ?app_slug () =
  ({ app_slug } : pipedream_token_request)

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

let pipedream_token_response_of_yojson :
    Yojson.Safe.t -> pipedream_token_response =
 fun json ->
  let fields = Json.obj json in
  {
    connect_link_url = Json.optional fields "connect_link_url" Json.string;
    connect_url = Json.optional fields "connect_url" Json.string;
    expires_at = Json.optional fields "expires_at" Json.string;
    provider =
      Json.required fields "provider" pipedream_provider_response_of_yojson;
    token = Json.optional fields "token" Json.string;
  }

and yojson_of_pipedream_token_response :
    pipedream_token_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("connect_link_url", Option.map Json.of_string value.connect_link_url);
      ("connect_url", Option.map Json.of_string value.connect_url);
      ("expires_at", Option.map Json.of_string value.expires_at);
      ("provider", Some (yojson_of_pipedream_provider_response value.provider));
      ("token", Option.map Json.of_string value.token);
    ]

let make_pipedream_token_response ?connect_link_url ?connect_url ?expires_at
    ~(provider : pipedream_provider_response) ?token () =
  ({ connect_link_url; connect_url; expires_at; provider; token }
    : pipedream_token_response)

type nonrec pipedream_update_request = {
  app_slug : string;  (** The app slug to update. *)
  enabled : bool option;  (** Enable or disable the connector. *)
  server_name : string option;  (** New display name for the connector. *)
}
(** Request body for updating a connected app. *)

let pipedream_update_request_of_yojson :
    Yojson.Safe.t -> pipedream_update_request =
 fun json ->
  let fields = Json.obj json in
  {
    app_slug = Json.required fields "app_slug" Json.string;
    enabled = Json.optional fields "enabled" Json.bool;
    server_name = Json.optional fields "server_name" Json.string;
  }

and yojson_of_pipedream_update_request :
    pipedream_update_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("app_slug", Some (Json.of_string value.app_slug));
      ("enabled", Option.map Json.of_bool value.enabled);
      ("server_name", Option.map Json.of_string value.server_name);
    ]

let make_pipedream_update_request ~(app_slug : string) ?enabled ?server_name ()
    =
  ({ app_slug; enabled; server_name } : pipedream_update_request)

(** The materialization status of a user's projection instance. *)
type nonrec projection_status =
  | Loading
  | Cold
  | Ready
  | Refreshing
  | Error_
  | Unknown of string  (** A value this SDK version does not know. *)

let projection_status_of_yojson : Yojson.Safe.t -> projection_status =
 fun json ->
  match Json.string json with
  | "loading" -> Loading
  | "cold" -> Cold
  | "ready" -> Ready
  | "refreshing" -> Refreshing
  | "error" -> Error_
  | other -> Unknown other

and yojson_of_projection_status : projection_status -> Yojson.Safe.t =
 fun value ->
  match value with
  | Loading -> `String "loading"
  | Cold -> `String "cold"
  | Ready -> `String "ready"
  | Refreshing -> `String "refreshing"
  | Error_ -> `String "error"
  | Unknown other -> `String other

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

let projection_state_response_of_yojson :
    Yojson.Safe.t -> projection_state_response =
 fun json ->
  let fields = Json.obj json in
  {
    data = Json.optional fields "data" Json.string;
    error = Json.optional fields "error" Json.string;
    generated_at = Json.optional fields "generated_at" Json.string;
    id = Json.required fields "id" Json.string;
    stale_at = Json.optional fields "stale_at" Json.string;
    status = Json.required fields "status" projection_status_of_yojson;
  }

and yojson_of_projection_state_response :
    projection_state_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("data", Option.map Json.of_string value.data);
      ("error", Option.map Json.of_string value.error);
      ("generated_at", Option.map Json.of_string value.generated_at);
      ("id", Some (Json.of_string value.id));
      ("stale_at", Option.map Json.of_string value.stale_at);
      ("status", Some (yojson_of_projection_status value.status));
    ]

let make_projection_state_response ?data ?error ?generated_at ~(id : string)
    ?stale_at ~(status : projection_status) () =
  ({ data; error; generated_at; id; stale_at; status }
    : projection_state_response)

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

let tool_activity_action_of_yojson : Yojson.Safe.t -> tool_activity_action =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "type" with
  | "created" -> Created
  | "edited" -> Edited
  | "opened" -> Opened
  | "deleted" -> Deleted
  | "messaged" -> Messaged
  | "sent" -> Sent
  | "responded" -> Responded
  | "propertyChanged" ->
      Property_changed
        {
          from = Json.optional fields "from" Json.json;
          from_labels =
            Json.optional fields "from_labels" (Json.list Json.string);
          property = Json.required fields "property" Json.string;
          property_name = Json.optional fields "property_name" Json.string;
          property_type = Json.optional fields "property_type" Json.string;
          to_ = Json.optional fields "to" Json.json;
          to_labels = Json.optional fields "to_labels" (Json.list Json.string);
        }
  | "participantAdded" ->
      Participant_added
        { participant = Json.required fields "participant" Json.string }
  | "participantRemoved" ->
      Participant_removed
        { participant = Json.required fields "participant" Json.string }
  | "callStarted" ->
      Call_started { call_id = Json.required fields "call_id" Json.string }
  | "taskAdded" -> Task_added
  | "taskRemoved" -> Task_removed
  | "unknown" ->
      Unknown_
        {
          payload = Json.optional fields "payload" Json.json;
          tag = Json.required fields "tag" Json.string;
        }
  | _ -> Unknown json

and yojson_of_tool_activity_action : tool_activity_action -> Yojson.Safe.t =
 fun value ->
  match value with
  | Created -> Json.record [ ("type", Some (`String "created")) ]
  | Edited -> Json.record [ ("type", Some (`String "edited")) ]
  | Opened -> Json.record [ ("type", Some (`String "opened")) ]
  | Deleted -> Json.record [ ("type", Some (`String "deleted")) ]
  | Messaged -> Json.record [ ("type", Some (`String "messaged")) ]
  | Sent -> Json.record [ ("type", Some (`String "sent")) ]
  | Responded -> Json.record [ ("type", Some (`String "responded")) ]
  | Property_changed case ->
      Json.record
        [
          ("type", Some (`String "propertyChanged"));
          ("from", Option.map Json.of_json case.from);
          ( "from_labels",
            Option.map (Json.of_list Json.of_string) case.from_labels );
          ("property", Some (Json.of_string case.property));
          ("property_name", Option.map Json.of_string case.property_name);
          ("property_type", Option.map Json.of_string case.property_type);
          ("to", Option.map Json.of_json case.to_);
          ("to_labels", Option.map (Json.of_list Json.of_string) case.to_labels);
        ]
  | Participant_added case ->
      Json.record
        [
          ("type", Some (`String "participantAdded"));
          ("participant", Some (Json.of_string case.participant));
        ]
  | Participant_removed case ->
      Json.record
        [
          ("type", Some (`String "participantRemoved"));
          ("participant", Some (Json.of_string case.participant));
        ]
  | Call_started case ->
      Json.record
        [
          ("type", Some (`String "callStarted"));
          ("call_id", Some (Json.of_string case.call_id));
        ]
  | Task_added -> Json.record [ ("type", Some (`String "taskAdded")) ]
  | Task_removed -> Json.record [ ("type", Some (`String "taskRemoved")) ]
  | Unknown_ case ->
      Json.record
        [
          ("type", Some (`String "unknown"));
          ("payload", Option.map Json.of_json case.payload);
          ("tag", Some (Json.of_string case.tag));
        ]
  | Unknown json -> json

let make_tool_activity_action_property_changed ?from ?from_labels
    ~(property : string) ?property_name ?property_type ?to_ ?to_labels () =
  (Property_changed
     {
       from;
       from_labels;
       property;
       property_name;
       property_type;
       to_;
       to_labels;
     }
    : tool_activity_action)

let make_tool_activity_action_participant_added ~(participant : string) () =
  (Participant_added { participant } : tool_activity_action)

let make_tool_activity_action_participant_removed ~(participant : string) () =
  (Participant_removed { participant } : tool_activity_action)

let make_tool_activity_action_call_started ~(call_id : string) () =
  (Call_started { call_id } : tool_activity_action)

let make_tool_activity_action_unknown_ ?payload ~(tag : string) () =
  (Unknown_ { payload; tag } : tool_activity_action)

type nonrec tool_activity_event = {
  action : tool_activity_action;  (** What the principal did. *)
  actor_id : string;
      (** The principal that mechanically performed the action. *)
  entity_id : string;  (** The entity acted on. *)
  entity_type : string;  (** The kind of entity acted on. *)
  occurred_at : string;  (** When the action occurred. *)
}
(** One activity event returned by \[[ReadActivity]\]. *)

let tool_activity_event_of_yojson : Yojson.Safe.t -> tool_activity_event =
 fun json ->
  let fields = Json.obj json in
  {
    action = Json.required fields "action" tool_activity_action_of_yojson;
    actor_id = Json.required fields "actorId" Json.string;
    entity_id = Json.required fields "entityId" Json.string;
    entity_type = Json.required fields "entityType" Json.string;
    occurred_at = Json.required fields "occurredAt" Json.string;
  }

and yojson_of_tool_activity_event : tool_activity_event -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("action", Some (yojson_of_tool_activity_action value.action));
      ("actorId", Some (Json.of_string value.actor_id));
      ("entityId", Some (Json.of_string value.entity_id));
      ("entityType", Some (Json.of_string value.entity_type));
      ("occurredAt", Some (Json.of_string value.occurred_at));
    ]

let make_tool_activity_event ~(action : tool_activity_action)
    ~(actor_id : string) ~(entity_id : string) ~(entity_type : string)
    ~(occurred_at : string) () =
  ({ action; actor_id; entity_id; entity_type; occurred_at }
    : tool_activity_event)

type nonrec read_activity_response = {
  activities : tool_activity_event list;
      (** Matching activity events, newest first. *)
  truncated : bool;
      (** Whether more than 100 events matched the requested range. *)
}
(** Response from \[[ReadActivity]\]. *)

let read_activity_response_of_yojson : Yojson.Safe.t -> read_activity_response =
 fun json ->
  let fields = Json.obj json in
  {
    activities =
      Json.required fields "activities"
        (Json.list tool_activity_event_of_yojson);
    truncated = Json.required fields "truncated" Json.bool;
  }

and yojson_of_read_activity_response : read_activity_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "activities",
        Some ((Json.of_list yojson_of_tool_activity_event) value.activities) );
      ("truncated", Some (Json.of_bool value.truncated));
    ]

let make_read_activity_response ~(activities : tool_activity_event list)
    ~(truncated : bool) () =
  ({ activities; truncated } : read_activity_response)

(** How frequently an active projection is regenerated. *)
type nonrec refresh_cadence =
  | High
  | Medium
  | Low
  | Unknown of string  (** A value this SDK version does not know. *)

let refresh_cadence_of_yojson : Yojson.Safe.t -> refresh_cadence =
 fun json ->
  match Json.string json with
  | "high" -> High
  | "medium" -> Medium
  | "low" -> Low
  | other -> Unknown other

and yojson_of_refresh_cadence : refresh_cadence -> Yojson.Safe.t =
 fun value ->
  match value with
  | High -> `String "high"
  | Medium -> `String "medium"
  | Low -> `String "low"
  | Unknown other -> `String other

type nonrec reject_tool_call_request = {
  message_id : string;  (** The message ID containing the tool call. *)
  tool_call_id : string;  (** The tool call ID to reject. *)
}
(** Request body for rejecting a pending tool call. *)

let reject_tool_call_request_of_yojson :
    Yojson.Safe.t -> reject_tool_call_request =
 fun json ->
  let fields = Json.obj json in
  {
    message_id = Json.required fields "messageId" Json.string;
    tool_call_id = Json.required fields "toolCallId" Json.string;
  }

and yojson_of_reject_tool_call_request :
    reject_tool_call_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("messageId", Some (Json.of_string value.message_id));
      ("toolCallId", Some (Json.of_string value.tool_call_id));
    ]

let make_reject_tool_call_request ~(message_id : string)
    ~(tool_call_id : string) () =
  ({ message_id; tool_call_id } : reject_tool_call_request)

type nonrec run_import_outcome = {
  discarded : int64;  (** How many rows were discarded. *)
  importing : int64;
      (** How many rows flipped to [importing] (jobs are now copying them in). *)
}
(** Outcome of accepting/declining staged rows via [POST /import/run]. *)

let run_import_outcome_of_yojson : Yojson.Safe.t -> run_import_outcome =
 fun json ->
  let fields = Json.obj json in
  {
    discarded = Json.required fields "discarded" Json.int64;
    importing = Json.required fields "importing" Json.int64;
  }

and yojson_of_run_import_outcome : run_import_outcome -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("discarded", Some (Json.of_int64 value.discarded));
      ("importing", Some (Json.of_int64 value.importing));
    ]

let make_run_import_outcome ~(discarded : int64) ~(importing : int64) () =
  ({ discarded; importing } : run_import_outcome)

type nonrec run_import_request = {
  discard_ids : string list option;  (** Staged rows to discard. *)
  import_ids : string list option;  (** Staged rows to import. *)
}
(** Body for accepting/declining staged imports. *)

let run_import_request_of_yojson : Yojson.Safe.t -> run_import_request =
 fun json ->
  let fields = Json.obj json in
  {
    discard_ids = Json.optional fields "discard_ids" (Json.list Json.string);
    import_ids = Json.optional fields "import_ids" (Json.list Json.string);
  }

and yojson_of_run_import_request : run_import_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("discard_ids", Option.map (Json.of_list Json.of_string) value.discard_ids);
      ("import_ids", Option.map (Json.of_list Json.of_string) value.import_ids);
    ]

let make_run_import_request ?discard_ids ?import_ids () =
  ({ discard_ids; import_ids } : run_import_request)

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

let send_chat_message_payload_of_yojson :
    Yojson.Safe.t -> send_chat_message_payload =
 fun json ->
  let fields = Json.obj json in
  {
    token = Json.required fields "token" Json.string;
    additional_instructions =
      Json.optional fields "additional_instructions" Json.string;
    attachments =
      Json.optional fields "attachments" (Json.list entity_of_yojson);
    chat_id = Json.required fields "chat_id" Json.string;
    content = Json.required fields "content" Json.string;
    model = Json.required fields "model" Json.string;
    stream_id = Json.required fields "stream_id" Json.string;
    toolset = Json.optional fields "toolset" tool_set_of_yojson;
  }

and yojson_of_send_chat_message_payload :
    send_chat_message_payload -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("token", Some (Json.of_string value.token));
      ( "additional_instructions",
        Option.map Json.of_string value.additional_instructions );
      ( "attachments",
        Option.map (Json.of_list yojson_of_entity) value.attachments );
      ("chat_id", Some (Json.of_string value.chat_id));
      ("content", Some (Json.of_string value.content));
      ("model", Some (Json.of_string value.model));
      ("stream_id", Some (Json.of_string value.stream_id));
      ("toolset", Option.map yojson_of_tool_set value.toolset);
    ]

let make_send_chat_message_payload ~(token : string) ?additional_instructions
    ?attachments ~(chat_id : string) ~(content : string) ~(model : string)
    ~(stream_id : string) ?toolset () =
  ({
     token;
     additional_instructions;
     attachments;
     chat_id;
     content;
     model;
     stream_id;
     toolset;
   }
    : send_chat_message_payload)

type nonrec send_chat_message_response = {
  chat_id : string;
      (** The chat ID (may differ from request if a new chat was created) *)
  message_id : string;  (** The message ID for the AI response *)
  stream_id : string;
      (** The stream ID that will receive the response chunks (same as message_id) *)
}
(** Response for initiating a chat message stream *)

let send_chat_message_response_of_yojson :
    Yojson.Safe.t -> send_chat_message_response =
 fun json ->
  let fields = Json.obj json in
  {
    chat_id = Json.required fields "chat_id" Json.string;
    message_id = Json.required fields "message_id" Json.string;
    stream_id = Json.required fields "stream_id" Json.string;
  }

and yojson_of_send_chat_message_response :
    send_chat_message_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("chat_id", Some (Json.of_string value.chat_id));
      ("message_id", Some (Json.of_string value.message_id));
      ("stream_id", Some (Json.of_string value.stream_id));
    ]

let make_send_chat_message_response ~(chat_id : string) ~(message_id : string)
    ~(stream_id : string) () =
  ({ chat_id; message_id; stream_id } : send_chat_message_response)

type nonrec server_response = {
  authenticated : bool;  (** Whether the server has valid stored credentials. *)
  enabled : bool;  (** Whether the server is enabled for tool use. *)
  server_name : string;  (** Human-readable server name. *)
  url : string;  (** The MCP server URL. *)
}
(** An MCP server record as returned by the API. *)

let server_response_of_yojson : Yojson.Safe.t -> server_response =
 fun json ->
  let fields = Json.obj json in
  {
    authenticated = Json.required fields "authenticated" Json.bool;
    enabled = Json.required fields "enabled" Json.bool;
    server_name = Json.required fields "server_name" Json.string;
    url = Json.required fields "url" Json.string;
  }

and yojson_of_server_response : server_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("authenticated", Some (Json.of_bool value.authenticated));
      ("enabled", Some (Json.of_bool value.enabled));
      ("server_name", Some (Json.of_string value.server_name));
      ("url", Some (Json.of_string value.url));
    ]

let make_server_response ~(authenticated : bool) ~(enabled : bool)
    ~(server_name : string) ~(url : string) () =
  ({ authenticated; enabled; server_name; url } : server_response)

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

let set_pricing_request_of_yojson : Yojson.Safe.t -> set_pricing_request =
 fun json ->
  let fields = Json.obj json in
  {
    model = Json.required fields "model" Json.string;
    price_per_audio_minute =
      Json.optional fields "price_per_audio_minute" Json.float;
    price_per_mil_cache_read =
      Json.optional fields "price_per_mil_cache_read" Json.float;
    price_per_mil_cache_write =
      Json.optional fields "price_per_mil_cache_write" Json.float;
    price_per_mil_in = Json.optional fields "price_per_mil_in" Json.float;
    price_per_mil_out = Json.optional fields "price_per_mil_out" Json.float;
    price_per_provider_credit =
      Json.optional fields "price_per_provider_credit" Json.float;
  }

and yojson_of_set_pricing_request : set_pricing_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("model", Some (Json.of_string value.model));
      ( "price_per_audio_minute",
        Option.map Json.of_float value.price_per_audio_minute );
      ( "price_per_mil_cache_read",
        Option.map Json.of_float value.price_per_mil_cache_read );
      ( "price_per_mil_cache_write",
        Option.map Json.of_float value.price_per_mil_cache_write );
      ("price_per_mil_in", Option.map Json.of_float value.price_per_mil_in);
      ("price_per_mil_out", Option.map Json.of_float value.price_per_mil_out);
      ( "price_per_provider_credit",
        Option.map Json.of_float value.price_per_provider_credit );
    ]

let make_set_pricing_request ~(model : string) ?price_per_audio_minute
    ?price_per_mil_cache_read ?price_per_mil_cache_write ?price_per_mil_in
    ?price_per_mil_out ?price_per_provider_credit () =
  ({
     model;
     price_per_audio_minute;
     price_per_mil_cache_read;
     price_per_mil_cache_write;
     price_per_mil_in;
     price_per_mil_out;
     price_per_provider_credit;
   }
    : set_pricing_request)

type nonrec skill_content_response = {
  built_in : bool;
      (** Whether this is a built-in skill, with no document behind it. *)
  content : string;  (** The skill's full markdown instructions. *)
  id : string;  (** The skill's id. *)
  name : string;  (** The skill's name. *)
}
(** A skill's complete instructions. *)

let skill_content_response_of_yojson : Yojson.Safe.t -> skill_content_response =
 fun json ->
  let fields = Json.obj json in
  {
    built_in = Json.required fields "builtIn" Json.bool;
    content = Json.required fields "content" Json.string;
    id = Json.required fields "id" Json.string;
    name = Json.required fields "name" Json.string;
  }

and yojson_of_skill_content_response : skill_content_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("builtIn", Some (Json.of_bool value.built_in));
      ("content", Some (Json.of_string value.content));
      ("id", Some (Json.of_string value.id));
      ("name", Some (Json.of_string value.name));
    ]

let make_skill_content_response ~(built_in : bool) ~(content : string)
    ~(id : string) ~(name : string) () =
  ({ built_in; content; id; name } : skill_content_response)

type nonrec skill_error_body = {
  code : string;  (** Stable failure code. *)
  error : string;  (** Explanation without backend diagnostics. *)
}
(** Machine-readable failure of a skill request. *)

let skill_error_body_of_yojson : Yojson.Safe.t -> skill_error_body =
 fun json ->
  let fields = Json.obj json in
  {
    code = Json.required fields "code" Json.string;
    error = Json.required fields "error" Json.string;
  }

and yojson_of_skill_error_body : skill_error_body -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("code", Some (Json.of_string value.code));
      ("error", Some (Json.of_string value.error));
    ]

let make_skill_error_body ~(code : string) ~(error : string) () =
  ({ code; error } : skill_error_body)

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

let skill_listing_of_yojson : Yojson.Safe.t -> skill_listing =
 fun json ->
  let fields = Json.obj json in
  {
    built_in = Json.required fields "builtIn" Json.bool;
    description = Json.optional fields "description" Json.string;
    id = Json.required fields "id" Json.string;
    name = Json.required fields "name" Json.string;
    updated_at = Json.optional fields "updatedAt" Json.string;
  }

and yojson_of_skill_listing : skill_listing -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("builtIn", Some (Json.of_bool value.built_in));
      ("description", Option.map Json.of_string value.description);
      ("id", Some (Json.of_string value.id));
      ("name", Some (Json.of_string value.name));
      ("updatedAt", Option.map Json.of_string value.updated_at);
    ]

let make_skill_listing ~(built_in : bool) ?description ~(id : string)
    ~(name : string) ?updated_at () =
  ({ built_in; description; id; name; updated_at } : skill_listing)

(** How search terms are matched against skill names. *)
type nonrec skills_match_type =
  | Partial
  | Exact
  | Unknown of string  (** A value this SDK version does not know. *)

let skills_match_type_of_yojson : Yojson.Safe.t -> skills_match_type =
 fun json ->
  match Json.string json with
  | "partial" -> Partial
  | "exact" -> Exact
  | other -> Unknown other

and yojson_of_skills_match_type : skills_match_type -> Yojson.Safe.t =
 fun value ->
  match value with
  | Partial -> `String "partial"
  | Exact -> `String "exact"
  | Unknown other -> `String other

type nonrec skills_response = {
  skills : skill_listing list;  (** The matching skills. *)
}
(** The skills matching a listing or search, most recently updated first,
built-in skills last. *)

let skills_response_of_yojson : Yojson.Safe.t -> skills_response =
 fun json ->
  let fields = Json.obj json in
  { skills = Json.required fields "skills" (Json.list skill_listing_of_yojson) }

and yojson_of_skills_response : skills_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("skills", Some ((Json.of_list yojson_of_skill_listing) value.skills)) ]

let make_skills_response ~(skills : skill_listing list) () =
  ({ skills } : skills_response)

type nonrec slack_participant = {
  email : string option;  (** Email, when the workspace exposes it. *)
  name : string;  (** Display name or Slack handle. *)
}
(** A person active in a staged Slack channel. *)

let slack_participant_of_yojson : Yojson.Safe.t -> slack_participant =
 fun json ->
  let fields = Json.obj json in
  {
    email = Json.optional fields "email" Json.string;
    name = Json.required fields "name" Json.string;
  }

and yojson_of_slack_participant : slack_participant -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("email", Option.map Json.of_string value.email);
      ("name", Some (Json.of_string value.name));
    ]

let make_slack_participant ?email ~(name : string) () =
  ({ email; name } : slack_participant)

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

let slack_channel_meta_of_yojson : Yojson.Safe.t -> slack_channel_meta =
 fun json ->
  let fields = Json.obj json in
  {
    archived = Json.optional fields "archived" Json.bool;
    channel_id = Json.optional fields "channel_id" Json.string;
    member_count = Json.optional fields "member_count" Json.int64;
    members_resolved = Json.optional fields "members_resolved" Json.bool;
    name = Json.required fields "name" Json.string;
    participants =
      Json.optional fields "participants"
        (Json.list slack_participant_of_yojson);
    purpose = Json.optional fields "purpose" Json.string;
  }

and yojson_of_slack_channel_meta : slack_channel_meta -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("archived", Option.map Json.of_bool value.archived);
      ("channel_id", Option.map Json.of_string value.channel_id);
      ("member_count", Option.map Json.of_int64 value.member_count);
      ("members_resolved", Option.map Json.of_bool value.members_resolved);
      ("name", Some (Json.of_string value.name));
      ( "participants",
        Option.map (Json.of_list yojson_of_slack_participant) value.participants
      );
      ("purpose", Option.map Json.of_string value.purpose);
    ]

let make_slack_channel_meta ?archived ?channel_id ?member_count
    ?members_resolved ~(name : string) ?participants ?purpose () =
  ({
     archived;
     channel_id;
     member_count;
     members_resolved;
     name;
     participants;
     purpose;
   }
    : slack_channel_meta)

type nonrec start_auth_request = {
  server_name : string;  (** Human-readable name for the server. *)
  server_url : string;  (** The MCP server URL to authorize against. *)
}
(** Request body for starting an OAuth authorization flow. *)

let start_auth_request_of_yojson : Yojson.Safe.t -> start_auth_request =
 fun json ->
  let fields = Json.obj json in
  {
    server_name = Json.required fields "server_name" Json.string;
    server_url = Json.required fields "server_url" Json.string;
  }

and yojson_of_start_auth_request : start_auth_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("server_name", Some (Json.of_string value.server_name));
      ("server_url", Some (Json.of_string value.server_url));
    ]

let make_start_auth_request ~(server_name : string) ~(server_url : string) () =
  ({ server_name; server_url } : start_auth_request)

type nonrec start_auth_response = {
  authorization_url : string;
      (** The OAuth authorization URL to redirect the user to. *)
}
(** Response from starting an OAuth authorization flow. *)

let start_auth_response_of_yojson : Yojson.Safe.t -> start_auth_response =
 fun json ->
  let fields = Json.obj json in
  { authorization_url = Json.required fields "authorization_url" Json.string }

and yojson_of_start_auth_response : start_auth_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("authorization_url", Some (Json.of_string value.authorization_url)) ]

let make_start_auth_response ~(authorization_url : string) () =
  ({ authorization_url } : start_auth_response)

type nonrec stop_chat_stream_error = {
  error : string;  (** Human-readable error message. *)
}
(** Error response for the stop endpoint. *)

let stop_chat_stream_error_of_yojson : Yojson.Safe.t -> stop_chat_stream_error =
 fun json ->
  let fields = Json.obj json in
  { error = Json.required fields "error" Json.string }

and yojson_of_stop_chat_stream_error : stop_chat_stream_error -> Yojson.Safe.t =
 fun value -> Json.record [ ("error", Some (Json.of_string value.error)) ]

let make_stop_chat_stream_error ~(error : string) () =
  ({ error } : stop_chat_stream_error)

type nonrec stop_chat_stream_request = {
  chat_id : string;
      (** The chat the stream belongs to. Used to verify the caller has
permission to stop the stream. *)
  stream_id : string;  (** The stream/message ID to stop. *)
}
(** Request body for stopping an in-flight chat stream. *)

let stop_chat_stream_request_of_yojson :
    Yojson.Safe.t -> stop_chat_stream_request =
 fun json ->
  let fields = Json.obj json in
  {
    chat_id = Json.required fields "chat_id" Json.string;
    stream_id = Json.required fields "stream_id" Json.string;
  }

and yojson_of_stop_chat_stream_request :
    stop_chat_stream_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("chat_id", Some (Json.of_string value.chat_id));
      ("stream_id", Some (Json.of_string value.stream_id));
    ]

let make_stop_chat_stream_request ~(chat_id : string) ~(stream_id : string) () =
  ({ chat_id; stream_id } : stop_chat_stream_request)

type nonrec stop_chat_stream_response = {
  stopped : bool;
      (** [true] if a matching in-flight stream was found and cancellation was
triggered, [false] if the stream had already finished or was unknown. *)
}
(** Response from a stop request. *)

let stop_chat_stream_response_of_yojson :
    Yojson.Safe.t -> stop_chat_stream_response =
 fun json ->
  let fields = Json.obj json in
  { stopped = Json.required fields "stopped" Json.bool }

and yojson_of_stop_chat_stream_response :
    stop_chat_stream_response -> Yojson.Safe.t =
 fun value -> Json.record [ ("stopped", Some (Json.of_bool value.stopped)) ]

let make_stop_chat_stream_response ~(stopped : bool) () =
  ({ stopped } : stop_chat_stream_response)

type nonrec string_id_response = { id : string }

let string_id_response_of_yojson : Yojson.Safe.t -> string_id_response =
 fun json ->
  let fields = Json.obj json in
  { id = Json.required fields "id" Json.string }

and yojson_of_string_id_response : string_id_response -> Yojson.Safe.t =
 fun value -> Json.record [ ("id", Some (Json.of_string value.id)) ]

let make_string_id_response ~(id : string) () = ({ id } : string_id_response)

type nonrec structured_completion_error = {
  code : string option;
      (** Stable machine-readable code for admission errors (402 or 503). *)
  error : string;
}

let structured_completion_error_of_yojson :
    Yojson.Safe.t -> structured_completion_error =
 fun json ->
  let fields = Json.obj json in
  {
    code = Json.optional fields "code" Json.string;
    error = Json.required fields "error" Json.string;
  }

and yojson_of_structured_completion_error :
    structured_completion_error -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("code", Option.map Json.of_string value.code);
      ("error", Some (Json.of_string value.error));
    ]

let make_structured_completion_error ?code ~(error : string) () =
  ({ code; error } : structured_completion_error)

type nonrec structured_completion_outcome =
  | Completed of { result : Yojson.Safe.t }
      (** The answer, shaped by the request's [output_schema]. *)
  | Interrupted of { reason : string }
      (** The model failed after committing database changes, so there is no
answer but [tool_activity] says what was saved. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let structured_completion_outcome_of_yojson :
    Yojson.Safe.t -> structured_completion_outcome =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "status" with
  | "completed" ->
      Completed { result = Json.required fields "result" Json.json }
  | "interrupted" ->
      Interrupted { reason = Json.required fields "reason" Json.string }
  | _ -> Unknown json

and yojson_of_structured_completion_outcome :
    structured_completion_outcome -> Yojson.Safe.t =
 fun value ->
  match value with
  | Completed case ->
      Json.record
        [
          ("status", Some (`String "completed"));
          ("result", Some (Json.of_json case.result));
        ]
  | Interrupted case ->
      Json.record
        [
          ("status", Some (`String "interrupted"));
          ("reason", Some (Json.of_string case.reason));
        ]
  | Unknown json -> json

let make_structured_completion_outcome_completed ~(result : Yojson.Safe.t) () =
  (Completed { result } : structured_completion_outcome)

let make_structured_completion_outcome_interrupted ~(reason : string) () =
  (Interrupted { reason } : structured_completion_outcome)

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

let structured_completion_request_of_yojson :
    Yojson.Safe.t -> structured_completion_request =
 fun json ->
  let fields = Json.obj json in
  {
    additional_instructions =
      Json.optional fields "additional_instructions" Json.string;
    model = Json.required fields "model" Json.string;
    output_schema =
      Json.required fields "output_schema" dynamic_schema_of_yojson;
    prompt = Json.required fields "prompt" Json.string;
    thinking = Json.optional fields "thinking" completion_thinking_of_yojson;
    toolset = Json.optional fields "toolset" tool_set_of_yojson;
  }

and yojson_of_structured_completion_request :
    structured_completion_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "additional_instructions",
        Option.map Json.of_string value.additional_instructions );
      ("model", Some (Json.of_string value.model));
      ("output_schema", Some (yojson_of_dynamic_schema value.output_schema));
      ("prompt", Some (Json.of_string value.prompt));
      ("thinking", Option.map yojson_of_completion_thinking value.thinking);
      ("toolset", Option.map yojson_of_tool_set value.toolset);
    ]

let make_structured_completion_request ?additional_instructions
    ~(model : string) ~(output_schema : dynamic_schema) ~(prompt : string)
    ?thinking ?toolset () =
  ({ additional_instructions; model; output_schema; prompt; thinking; toolset }
    : structured_completion_request)

type nonrec tool_outcome =
  | Succeeded of { changes : database_change }
  | Failed
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let tool_outcome_of_yojson : Yojson.Safe.t -> tool_outcome =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "status" with
  | "succeeded" ->
      Succeeded
        { changes = Json.required fields "changes" database_change_of_yojson }
  | "failed" -> Failed
  | _ -> Unknown json

and yojson_of_tool_outcome : tool_outcome -> Yojson.Safe.t =
 fun value ->
  match value with
  | Succeeded case ->
      Json.record
        [
          ("status", Some (`String "succeeded"));
          ("changes", Some (yojson_of_database_change case.changes));
        ]
  | Failed -> Json.record [ ("status", Some (`String "failed")) ]
  | Unknown json -> json

let make_tool_outcome_succeeded ~(changes : database_change) () =
  (Succeeded { changes } : tool_outcome)

type nonrec structured_tool_activity = { name : string; outcome : tool_outcome }
(** One tool call the agent finished, and what it did. *)

let structured_tool_activity_of_yojson :
    Yojson.Safe.t -> structured_tool_activity =
 fun json ->
  let fields = Json.obj json in
  {
    name = Json.required fields "name" Json.string;
    outcome = Json.required fields "outcome" tool_outcome_of_yojson;
  }

and yojson_of_structured_tool_activity :
    structured_tool_activity -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("name", Some (Json.of_string value.name));
      ("outcome", Some (yojson_of_tool_outcome value.outcome));
    ]

let make_structured_tool_activity ~(name : string) ~(outcome : tool_outcome) ()
    =
  ({ name; outcome } : structured_tool_activity)

type nonrec structured_completion_response = {
  outcome : structured_completion_outcome;
  tool_activity : structured_tool_activity list;
      (** Actual completed tools, independent of the model's claims. *)
}

let structured_completion_response_of_yojson :
    Yojson.Safe.t -> structured_completion_response =
 fun json ->
  let fields = Json.obj json in
  {
    outcome =
      Json.required fields "outcome" structured_completion_outcome_of_yojson;
    tool_activity =
      Json.required fields "toolActivity"
        (Json.list structured_tool_activity_of_yojson);
  }

and yojson_of_structured_completion_response :
    structured_completion_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("outcome", Some (yojson_of_structured_completion_outcome value.outcome));
      ( "toolActivity",
        Some
          ((Json.of_list yojson_of_structured_tool_activity)
             value.tool_activity) );
    ]

let make_structured_completion_response
    ~(outcome : structured_completion_outcome)
    ~(tool_activity : structured_tool_activity list) () =
  ({ outcome; tool_activity } : structured_completion_response)

(** The kind of entity a projection is materialized for. *)
type nonrec target_type =
  | User
  | Team
  | Unknown of string  (** A value this SDK version does not know. *)

let target_type_of_yojson : Yojson.Safe.t -> target_type =
 fun json ->
  match Json.string json with
  | "user" -> User
  | "team" -> Team
  | other -> Unknown other

and yojson_of_target_type : target_type -> Yojson.Safe.t =
 fun value ->
  match value with
  | User -> `String "user"
  | Team -> `String "team"
  | Unknown other -> `String other

(** Whether a tracked item is a candidate or an import already made. *)
type nonrec track_import_status =
  | Staged
  | Imported
  | Unknown of string  (** A value this SDK version does not know. *)

let track_import_status_of_yojson : Yojson.Safe.t -> track_import_status =
 fun json ->
  match Json.string json with
  | "staged" -> Staged
  | "imported" -> Imported
  | other -> Unknown other

and yojson_of_track_import_status : track_import_status -> Yojson.Safe.t =
 fun value ->
  match value with
  | Staged -> `String "staged"
  | Imported -> `String "imported"
  | Unknown other -> `String other

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

let track_import_entity_request_of_yojson :
    Yojson.Safe.t -> track_import_entity_request =
 fun json ->
  let fields = Json.obj json in
  {
    entity_id = Json.optional fields "entityId" Json.string;
    foreign_id = Json.required fields "foreignId" Json.string;
    metadata = Json.required fields "metadata" Json.json;
    source = Json.required fields "source" import_source_of_yojson;
    status = Json.required fields "status" track_import_status_of_yojson;
  }

and yojson_of_track_import_entity_request :
    track_import_entity_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("entityId", Option.map Json.of_string value.entity_id);
      ("foreignId", Some (Json.of_string value.foreign_id));
      ("metadata", Some (Json.of_json value.metadata));
      ("source", Some (yojson_of_import_source value.source));
      ("status", Some (yojson_of_track_import_status value.status));
    ]

let make_track_import_entity_request ?entity_id ~(foreign_id : string)
    ~(metadata : Yojson.Safe.t) ~(source : import_source)
    ~(status : track_import_status) () =
  ({ entity_id; foreign_id; metadata; source; status }
    : track_import_entity_request)

(** What tracking an item did. *)
type nonrec track_import_outcome =
  | Staged
  | Recorded_imported
  | Already_imported
  | Already_imported_by_teammate
  | Previously_declined
  | Import_in_progress
  | Unknown of string  (** A value this SDK version does not know. *)

let track_import_outcome_of_yojson : Yojson.Safe.t -> track_import_outcome =
 fun json ->
  match Json.string json with
  | "staged" -> Staged
  | "recorded_imported" -> Recorded_imported
  | "already_imported" -> Already_imported
  | "already_imported_by_teammate" -> Already_imported_by_teammate
  | "previously_declined" -> Previously_declined
  | "import_in_progress" -> Import_in_progress
  | other -> Unknown other

and yojson_of_track_import_outcome : track_import_outcome -> Yojson.Safe.t =
 fun value ->
  match value with
  | Staged -> `String "staged"
  | Recorded_imported -> `String "recorded_imported"
  | Already_imported -> `String "already_imported"
  | Already_imported_by_teammate -> `String "already_imported_by_teammate"
  | Previously_declined -> `String "previously_declined"
  | Import_in_progress -> `String "import_in_progress"
  | Unknown other -> `String other

type nonrec track_import_entity_response = {
  entity : import_entity;  (** The row behind the outcome. *)
  outcome : track_import_outcome;  (** What happened. *)
}
(** The outcome of tracking an item, with its ledger row. *)

let track_import_entity_response_of_yojson :
    Yojson.Safe.t -> track_import_entity_response =
 fun json ->
  let fields = Json.obj json in
  {
    entity = Json.required fields "entity" import_entity_of_yojson;
    outcome = Json.required fields "outcome" track_import_outcome_of_yojson;
  }

and yojson_of_track_import_entity_response :
    track_import_entity_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("entity", Some (yojson_of_import_entity value.entity));
      ("outcome", Some (yojson_of_track_import_outcome value.outcome));
    ]

let make_track_import_entity_response ~(entity : import_entity)
    ~(outcome : track_import_outcome) () =
  ({ entity; outcome } : track_import_entity_response)

type nonrec update_explicit_memory_request = {
  edit : memory_edit;  (** The one-based line edit to apply. *)
  revision : int64;
      (** The revision returned by the last read or successful edit. *)
}
(** One explicit memory edit at the revision it was based on. *)

let update_explicit_memory_request_of_yojson :
    Yojson.Safe.t -> update_explicit_memory_request =
 fun json ->
  let fields = Json.obj json in
  {
    edit = Json.required fields "edit" memory_edit_of_yojson;
    revision = Json.required fields "revision" Json.int64;
  }

and yojson_of_update_explicit_memory_request :
    update_explicit_memory_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("edit", Some (yojson_of_memory_edit value.edit));
      ("revision", Some (Json.of_int64 value.revision));
    ]

let make_update_explicit_memory_request ~(edit : memory_edit)
    ~(revision : int64) () =
  ({ edit; revision } : update_explicit_memory_request)

type nonrec update_server_request = {
  enabled : bool option;  (** Enable or disable the server. *)
  server_name : string option;  (** New name for the server. *)
  url : string;  (** The server URL to update. *)
}
(** Request body for updating an MCP server. *)

let update_server_request_of_yojson : Yojson.Safe.t -> update_server_request =
 fun json ->
  let fields = Json.obj json in
  {
    enabled = Json.optional fields "enabled" Json.bool;
    server_name = Json.optional fields "server_name" Json.string;
    url = Json.required fields "url" Json.string;
  }

and yojson_of_update_server_request : update_server_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("enabled", Option.map Json.of_bool value.enabled);
      ("server_name", Option.map Json.of_string value.server_name);
      ("url", Some (Json.of_string value.url));
    ]

let make_update_server_request ?enabled ?server_name ~(url : string) () =
  ({ enabled; server_name; url } : update_server_request)

type nonrec update_tool_call_request = {
  args : Yojson.Safe.t;  (** The new arguments for the tool call. *)
  message_id : string;  (** The message ID containing the tool call. *)
  tool_call_id : string;  (** The tool call ID to update. *)
}
(** Request body for updating a tool call's arguments. *)

let update_tool_call_request_of_yojson :
    Yojson.Safe.t -> update_tool_call_request =
 fun json ->
  let fields = Json.obj json in
  {
    args = Json.required fields "args" Json.json;
    message_id = Json.required fields "messageId" Json.string;
    tool_call_id = Json.required fields "toolCallId" Json.string;
  }

and yojson_of_update_tool_call_request :
    update_tool_call_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("args", Some (Json.of_json value.args));
      ("messageId", Some (Json.of_string value.message_id));
      ("toolCallId", Some (Json.of_string value.tool_call_id));
    ]

let make_update_tool_call_request ~(args : Yojson.Safe.t) ~(message_id : string)
    ~(tool_call_id : string) () =
  ({ args; message_id; tool_call_id } : update_tool_call_request)

(** User tools are pending until a user executes them *)
type nonrec user_tool_response_value =
  | Pending_user_execution  (** Tool has not yet been executed *)
  | Rejected  (** User rejected suggested tool execution *)
  | User_action of Yojson.Safe.t
      (** Tool is executed and has whatever return type the wrapped tool returns *)

let user_tool_response_value_of_yojson :
    Yojson.Safe.t -> user_tool_response_value =
 fun json ->
  match Json.external_case json with
  | "PendingUserExecution", None -> Pending_user_execution
  | "Rejected", None -> Rejected
  | "UserAction", value ->
      User_action (Json.json (Json.payload "UserAction" value))
  | name, _ -> Json.fail "unknown case %S" name

and yojson_of_user_tool_response_value :
    user_tool_response_value -> Yojson.Safe.t =
 fun value ->
  match value with
  | Pending_user_execution -> `String "PendingUserExecution"
  | Rejected -> `String "Rejected"
  | User_action inner -> Json.external_value "UserAction" (Json.of_json inner)

type nonrec update_tool_response_request = {
  message_id : string;  (** The message ID containing the tool response. *)
  response : user_tool_response_value;  (** The new user tool response. *)
  tool_call_id : string;
      (** The tool call ID whose response should be updated. *)
}
(** Request body for updating a tool response. *)

let update_tool_response_request_of_yojson :
    Yojson.Safe.t -> update_tool_response_request =
 fun json ->
  let fields = Json.obj json in
  {
    message_id = Json.required fields "messageId" Json.string;
    response =
      Json.required fields "response" user_tool_response_value_of_yojson;
    tool_call_id = Json.required fields "toolCallId" Json.string;
  }

and yojson_of_update_tool_response_request :
    update_tool_response_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("messageId", Some (Json.of_string value.message_id));
      ("response", Some (yojson_of_user_tool_response_value value.response));
      ("toolCallId", Some (Json.of_string value.tool_call_id));
    ]

let make_update_tool_response_request ~(message_id : string)
    ~(response : user_tool_response_value) ~(tool_call_id : string) () =
  ({ message_id; response; tool_call_id } : update_tool_response_request)

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

let upsert_projection_request_of_yojson :
    Yojson.Safe.t -> upsert_projection_request =
 fun json ->
  let fields = Json.obj json in
  {
    await = Json.optional fields "await" Json.bool;
    expiry = Json.required fields "expiry" expiry_of_yojson;
    id = Json.required fields "id" Json.string;
    model = Json.optional fields "model" Json.string;
    output_schema = Json.optional fields "output_schema" Json.json;
    prompt = Json.required fields "prompt" Json.string;
    refresh_cadence =
      Json.required fields "refresh_cadence" refresh_cadence_of_yojson;
    regenerate = Json.optional fields "regenerate" Json.bool;
    target_type = Json.required fields "target_type" target_type_of_yojson;
  }

and yojson_of_upsert_projection_request :
    upsert_projection_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("await", Option.map Json.of_bool value.await);
      ("expiry", Some (yojson_of_expiry value.expiry));
      ("id", Some (Json.of_string value.id));
      ("model", Option.map Json.of_string value.model);
      ("output_schema", Option.map Json.of_json value.output_schema);
      ("prompt", Some (Json.of_string value.prompt));
      ("refresh_cadence", Some (yojson_of_refresh_cadence value.refresh_cadence));
      ("regenerate", Option.map Json.of_bool value.regenerate);
      ("target_type", Some (yojson_of_target_type value.target_type));
    ]

let make_upsert_projection_request ?await ~(expiry : expiry) ~(id : string)
    ?model ?output_schema ~(prompt : string)
    ~(refresh_cadence : refresh_cadence) ?regenerate
    ~(target_type : target_type) () =
  ({
     await;
     expiry;
     id;
     model;
     output_schema;
     prompt;
     refresh_cadence;
     regenerate;
     target_type;
   }
    : upsert_projection_request)

type nonrec usage_request = {
  features : ai_feature list option;  (** If empty, include all features. *)
  from : string option;  (** Inclusive lower bound on [created_at]. *)
  include_users : string list option;  (** If empty, include all users. *)
  until : string option;  (** Exclusive upper bound on [created_at]. *)
}
(** Request body for \[[get_usage_handler]\]. *)

let usage_request_of_yojson : Yojson.Safe.t -> usage_request =
 fun json ->
  let fields = Json.obj json in
  {
    features = Json.optional fields "features" (Json.list ai_feature_of_yojson);
    from = Json.optional fields "from" Json.string;
    include_users = Json.optional fields "include_users" (Json.list Json.string);
    until = Json.optional fields "until" Json.string;
  }

and yojson_of_usage_request : usage_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("features", Option.map (Json.of_list yojson_of_ai_feature) value.features);
      ("from", Option.map Json.of_string value.from);
      ( "include_users",
        Option.map (Json.of_list Json.of_string) value.include_users );
      ("until", Option.map Json.of_string value.until);
    ]

let make_usage_request ?features ?from ?include_users ?until () =
  ({ features; from; include_users; until } : usage_request)

type nonrec usage_summary = {
  entries : feature_usage list;  (** Per-feature usage. *)
  total : float;  (** Grand total (USD). *)
}
(** Per-feature breakdown and grand total. *)

let usage_summary_of_yojson : Yojson.Safe.t -> usage_summary =
 fun json ->
  let fields = Json.obj json in
  {
    entries = Json.required fields "entries" (Json.list feature_usage_of_yojson);
    total = Json.required fields "total" Json.float;
  }

and yojson_of_usage_summary : usage_summary -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("entries", Some ((Json.of_list yojson_of_feature_usage) value.entries));
      ("total", Some (Json.of_float value.total));
    ]

let make_usage_summary ~(entries : feature_usage list) ~(total : float) () =
  ({ entries; total } : usage_summary)

type nonrec web_citation = {
  description : string option;  (** A description of the cited page. *)
  favicon_url : string option;  (** The URL of the page's favicon. *)
  image_url : string option;  (** The URL of the page's image. *)
  title : string;  (** The title of the cited page. *)
  url : string;  (** The URL of the citation. *)
}
(** A web citation associated with a chat message. *)

let web_citation_of_yojson : Yojson.Safe.t -> web_citation =
 fun json ->
  let fields = Json.obj json in
  {
    description = Json.optional fields "description" Json.string;
    favicon_url = Json.optional fields "favicon_url" Json.string;
    image_url = Json.optional fields "image_url" Json.string;
    title = Json.required fields "title" Json.string;
    url = Json.required fields "url" Json.string;
  }

and yojson_of_web_citation : web_citation -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("description", Option.map Json.of_string value.description);
      ("favicon_url", Option.map Json.of_string value.favicon_url);
      ("image_url", Option.map Json.of_string value.image_url);
      ("title", Some (Json.of_string value.title));
      ("url", Some (Json.of_string value.url));
    ]

let make_web_citation ?description ?favicon_url ?image_url ~(title : string)
    ~(url : string) () =
  ({ description; favicon_url; image_url; title; url } : web_citation)

type nonrec web_error_body = {
  code : string;  (** Stable failure code. *)
  error : string;  (** Explanation without provider diagnostics. *)
}
(** Machine-readable failure of a web request. *)

let web_error_body_of_yojson : Yojson.Safe.t -> web_error_body =
 fun json ->
  let fields = Json.obj json in
  {
    code = Json.required fields "code" Json.string;
    error = Json.required fields "error" Json.string;
  }

and yojson_of_web_error_body : web_error_body -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("code", Some (Json.of_string value.code));
      ("error", Some (Json.of_string value.error));
    ]

let make_web_error_body ~(code : string) ~(error : string) () =
  ({ code; error } : web_error_body)

type nonrec web_fetch = {
  max_chars : int option;
      (** Most characters of page text to return, 1 to 100,000 (default 20,000). *)
  url : string;  (** The [http] or [https] URL of the page. *)
}
(** Read one public web page. *)

let web_fetch_of_yojson : Yojson.Safe.t -> web_fetch =
 fun json ->
  let fields = Json.obj json in
  {
    max_chars = Json.optional fields "maxChars" Json.int;
    url = Json.required fields "url" Json.string;
  }

and yojson_of_web_fetch : web_fetch -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("maxChars", Option.map Json.of_int value.max_chars);
      ("url", Some (Json.of_string value.url));
    ]

let make_web_fetch ?max_chars ~(url : string) () =
  ({ max_chars; url } : web_fetch)

type nonrec web_fetch_response = {
  content : string;  (** The page text as Markdown, cut to [maxChars]. *)
  title : string option;  (** The page title, when the provider reports one. *)
  truncated : bool;  (** Whether [content] was cut to [maxChars]. *)
  url : string;  (** The URL that was read. *)
}
(** The text of a fetched page. *)

let web_fetch_response_of_yojson : Yojson.Safe.t -> web_fetch_response =
 fun json ->
  let fields = Json.obj json in
  {
    content = Json.required fields "content" Json.string;
    title = Json.optional fields "title" Json.string;
    truncated = Json.required fields "truncated" Json.bool;
    url = Json.required fields "url" Json.string;
  }

and yojson_of_web_fetch_response : web_fetch_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("content", Some (Json.of_string value.content));
      ("title", Option.map Json.of_string value.title);
      ("truncated", Some (Json.of_bool value.truncated));
      ("url", Some (Json.of_string value.url));
    ]

let make_web_fetch_response ~(content : string) ?title ~(truncated : bool)
    ~(url : string) () =
  ({ content; title; truncated; url } : web_fetch_response)

(** The kind of results a search favours. *)
type nonrec web_search_topic =
  | General
  | News
  | Unknown of string  (** A value this SDK version does not know. *)

let web_search_topic_of_yojson : Yojson.Safe.t -> web_search_topic =
 fun json ->
  match Json.string json with
  | "general" -> General
  | "news" -> News
  | other -> Unknown other

and yojson_of_web_search_topic : web_search_topic -> Yojson.Safe.t =
 fun value ->
  match value with
  | General -> `String "general"
  | News -> `String "news"
  | Unknown other -> `String other

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

let web_search_of_yojson : Yojson.Safe.t -> web_search =
 fun json ->
  let fields = Json.obj json in
  {
    domains = Json.optional fields "domains" (Json.list Json.string);
    exclude_domains =
      Json.optional fields "excludeDomains" (Json.list Json.string);
    include_content = Json.optional fields "includeContent" Json.bool;
    max_results = Json.optional fields "maxResults" Json.int;
    query = Json.required fields "query" Json.string;
    since = Json.optional fields "since" Json.string;
    topic = Json.optional fields "topic" web_search_topic_of_yojson;
  }

and yojson_of_web_search : web_search -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("domains", Option.map (Json.of_list Json.of_string) value.domains);
      ( "excludeDomains",
        Option.map (Json.of_list Json.of_string) value.exclude_domains );
      ("includeContent", Option.map Json.of_bool value.include_content);
      ("maxResults", Option.map Json.of_int value.max_results);
      ("query", Some (Json.of_string value.query));
      ("since", Option.map Json.of_string value.since);
      ("topic", Option.map yojson_of_web_search_topic value.topic);
    ]

let make_web_search ?domains ?exclude_domains ?include_content ?max_results
    ~(query : string) ?since ?topic () =
  ({
     domains;
     exclude_domains;
     include_content;
     max_results;
     query;
     since;
     topic;
   }
    : web_search)

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

let web_search_result_of_yojson : Yojson.Safe.t -> web_search_result =
 fun json ->
  let fields = Json.obj json in
  {
    content = Json.optional fields "content" Json.string;
    published_at = Json.optional fields "publishedAt" Json.string;
    snippet = Json.required fields "snippet" Json.string;
    title = Json.required fields "title" Json.string;
    url = Json.required fields "url" Json.string;
  }

and yojson_of_web_search_result : web_search_result -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("content", Option.map Json.of_string value.content);
      ("publishedAt", Option.map Json.of_string value.published_at);
      ("snippet", Some (Json.of_string value.snippet));
      ("title", Some (Json.of_string value.title));
      ("url", Some (Json.of_string value.url));
    ]

let make_web_search_result ?content ?published_at ~(snippet : string)
    ~(title : string) ~(url : string) () =
  ({ content; published_at; snippet; title; url } : web_search_result)

type nonrec web_search_response = {
  results : web_search_result list;
      (** Results, best match first. Empty when nothing matched. *)
}
(** The pages a search found, best match first. *)

let web_search_response_of_yojson : Yojson.Safe.t -> web_search_response =
 fun json ->
  let fields = Json.obj json in
  {
    results =
      Json.required fields "results" (Json.list web_search_result_of_yojson);
  }

and yojson_of_web_search_response : web_search_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "results",
        Some ((Json.of_list yojson_of_web_search_result) value.results) );
    ]

let make_web_search_response ~(results : web_search_result list) () =
  ({ results } : web_search_response)

(** [GET /activity]

Read the acting user's own activity in a time range, newest first. *)
let read_my_activity ~(from : string) ~(to_ : string) () =
  ({
     Request.service = "cognition";
     operation = "read_my_activity";
     meth = `GET;
     path = "/activity";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ("from", [ (fun value -> value) from ]);
           ("to", [ (fun value -> value) to_ ]);
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json read_activity_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 500 ] activity_error_body_of_yojson;
   }
    : (read_activity_response, activity_error_body) Macro_sdk_runtime.Request.t)

(** [POST /ai-cost/pricing]

Set the pricing for a model and recompute its recorded rows. Admin only. *)
let set_pricing_handler ~(model : string) ?price_per_audio_minute
    ?price_per_mil_cache_read ?price_per_mil_cache_write ?price_per_mil_in
    ?price_per_mil_out ?price_per_provider_credit () =
  ({
     Request.service = "cognition";
     operation = "set_pricing_handler";
     meth = `POST;
     path = "/ai-cost/pricing";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_set_pricing_request
               ({
                  model;
                  price_per_audio_minute;
                  price_per_mil_cache_read;
                  price_per_mil_cache_write;
                  price_per_mil_in;
                  price_per_mil_out;
                  price_per_provider_credit;
                }
                 : set_pricing_request)));
     decode_reply = Request.unit;
     decode_error = Request.error_json [ 400; 403; 500 ] error_body_of_yojson;
   }
    : (unit, error_body) Macro_sdk_runtime.Request.t)

(** [POST /ai-cost/usage]

Query recorded AI usage. Admin only. *)
let get_usage_handler ?features ?from ?include_users ?until () =
  ({
     Request.service = "cognition";
     operation = "get_usage_handler";
     meth = `POST;
     path = "/ai-cost/usage";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_usage_request
               ({ features; from; include_users; until } : usage_request)));
     decode_reply = Request.json usage_summary_of_yojson;
     decode_error = Request.error_json [ 400; 403; 500 ] error_body_of_yojson;
   }
    : (usage_summary, error_body) Macro_sdk_runtime.Request.t)

(** [POST /ai-projections]

Gets or creates an ai projection and the requesting user's instance,
triggering (or awaiting) materialization when needed. *)
let upsert_ai_projection ~(expiry : expiry) ~(id : string) ~(prompt : string)
    ~(refresh_cadence : refresh_cadence) ~(target_type : target_type) ?await
    ?model ?output_schema ?regenerate () =
  ({
     Request.service = "cognition";
     operation = "upsert_ai_projection";
     meth = `POST;
     path = "/ai-projections";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_upsert_projection_request
               ({
                  await;
                  expiry;
                  id;
                  model;
                  output_schema;
                  prompt;
                  refresh_cadence;
                  regenerate;
                  target_type;
                }
                 : upsert_projection_request)));
     decode_reply = Request.json projection_state_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 403; 500 ] error_response_of_yojson;
   }
    : (projection_state_response, error_response) Macro_sdk_runtime.Request.t)

(** [GET /attachments/{attachment_id}/chats] *)
let get_chats_for_attachment_handler ~(attachment_id : string) () =
  ({
     Request.service = "cognition";
     operation = "get_chats_for_attachment_handler";
     meth = `GET;
     path =
       String.concat ""
         [
           "/attachments/";
           Request.segment ((fun value -> value) attachment_id);
           "/chats";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json get_chats_for_attachment_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( get_chats_for_attachment_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /calendar/events/create-confirmed]

Create a calendar event the user approved in conversation, quoting their approval. *)
let create_confirmed_calendar_event ~(body : Yojson.Safe.t) () =
  ({
     Request.service = "cognition";
     operation = "create_confirmed_calendar_event";
     meth = `POST;
     path = "/calendar/events/create-confirmed";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = Some (Request.Json (Json.of_json body));
     decode_reply = Request.json Json.json;
     decode_error =
       Request.error_json [ 400; 422 ] generic_error_response_of_yojson;
   }
    : (Yojson.Safe.t, generic_error_response) Macro_sdk_runtime.Request.t)

(** [DELETE /chat/{chat_id}]

Soft-delete a chat. *)
let delete_chat ~(chat_id : string) () =
  ({
     Request.service = "cognition";
     operation = "delete_chat";
     meth = `DELETE;
     path =
       String.concat ""
         [ "/chat/"; Request.segment ((fun value -> value) chat_id) ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.unit;
     decode_error = Request.no_error;
   }
    : (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t)

(** [PATCH /chat/{chat_id}]

Patch a chat's name, project, or share permissions. *)
let patch_chat ~(chat_id : string) ?name ?project_id ?share_permission () =
  ({
     Request.service = "cognition";
     operation = "patch_chat";
     meth = `PATCH;
     path =
       String.concat ""
         [ "/chat/"; Request.segment ((fun value -> value) chat_id) ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_patch_chat_request
               ({ name; project_id; share_permission } : patch_chat_request)));
     decode_reply = Request.unit;
     decode_error = Request.no_error;
   }
    : (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t)

(** [DELETE /chat/{chat_id}/permanent]

Permanently delete a chat and all associated data. *)
let permanently_delete_chat ~(chat_id : string) () =
  ({
     Request.service = "cognition";
     operation = "permanently_delete_chat";
     meth = `DELETE;
     path =
       String.concat ""
         [
           "/chat/";
           Request.segment ((fun value -> value) chat_id);
           "/permanent";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.unit;
     decode_error = Request.no_error;
   }
    : (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t)

(** [POST /chats]

Create a new chat. *)
let create_chat ?name ?project_id () =
  ({
     Request.service = "cognition";
     operation = "create_chat";
     meth = `POST;
     path = "/chats";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_create_chat_request
               ({ name; project_id } : create_chat_request)));
     decode_reply = Request.json string_id_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( string_id_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /chats/history/{chat_id}]

Retrieves chat history for a specific chat ID *)
let get_chat_history_handler ~(chat_id : string) () =
  ({
     Request.service = "cognition";
     operation = "get_chat_history_handler";
     meth = `GET;
     path =
       String.concat ""
         [ "/chats/history/"; Request.segment ((fun value -> value) chat_id) ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json chat_history_of_yojson;
     decode_error = Request.no_error;
   }
    : ( chat_history,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /chats/history_batch_messages]

Retrieves chat history for multiple message IDs *)
let get_chat_history_batch_messages_handler ~(message_ids : string list) () =
  ({
     Request.service = "cognition";
     operation = "get_chat_history_batch_messages_handler";
     meth = `POST;
     path = "/chats/history_batch_messages";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_chat_history_batch_messages_request
               ({ message_ids } : chat_history_batch_messages_request)));
     decode_reply = Request.json chat_history_of_yojson;
     decode_error = Request.no_error;
   }
    : ( chat_history,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /chats/{chat_id}]

Get a chat by ID with messages and web citations. *)
let get_chat ~(chat_id : string) () =
  ({
     Request.service = "cognition";
     operation = "get_chat";
     meth = `GET;
     path =
       String.concat ""
         [ "/chats/"; Request.segment ((fun value -> value) chat_id) ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json get_chat_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( get_chat_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /chats/{chat_id}/copy]

Copy a chat and its messages into a new chat. *)
let copy_chat ~(chat_id : string) () =
  ({
     Request.service = "cognition";
     operation = "copy_chat";
     meth = `POST;
     path =
       String.concat ""
         [ "/chats/"; Request.segment ((fun value -> value) chat_id); "/copy" ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json string_id_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( string_id_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /chats/{chat_id}/permissions]

Get the share permissions for a chat. *)
let get_chat_permissions ~(chat_id : string) () =
  ({
     Request.service = "cognition";
     operation = "get_chat_permissions";
     meth = `GET;
     path =
       String.concat ""
         [
           "/chats/";
           Request.segment ((fun value -> value) chat_id);
           "/permissions";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json get_chat_permissions_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( get_chat_permissions_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [PUT /chats/{chat_id}/revert_delete]

Revert a soft-deleted chat. *)
let revert_delete_chat ~(chat_id : string) () =
  ({
     Request.service = "cognition";
     operation = "revert_delete_chat";
     meth = `PUT;
     path =
       String.concat ""
         [
           "/chats/";
           Request.segment ((fun value -> value) chat_id);
           "/revert_delete";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.unit;
     decode_error = Request.no_error;
   }
    : (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t)

(** [POST /chats/{chat_id}/tool/call]

Execute a pending tool call, optionally with updated arguments. *)
let call_tool ~(chat_id : string) ~(message_id : string)
    ~(tool_call_id : string) ?args () =
  ({
     Request.service = "cognition";
     operation = "call_tool";
     meth = `POST;
     path =
       String.concat ""
         [
           "/chats/";
           Request.segment ((fun value -> value) chat_id);
           "/tool/call";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_call_tool_request
               ({ args; message_id; tool_call_id } : call_tool_request)));
     decode_reply = Request.json call_tool_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( call_tool_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /chats/{chat_id}/tool/reject]

Reject a pending tool call. *)
let reject_tool_call ~(chat_id : string) ~(message_id : string)
    ~(tool_call_id : string) () =
  ({
     Request.service = "cognition";
     operation = "reject_tool_call";
     meth = `POST;
     path =
       String.concat ""
         [
           "/chats/";
           Request.segment ((fun value -> value) chat_id);
           "/tool/reject";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_reject_tool_call_request
               ({ message_id; tool_call_id } : reject_tool_call_request)));
     decode_reply = Request.unit;
     decode_error = Request.no_error;
   }
    : (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t)

(** [POST /chats/{chat_id}/tool/response/update]

Update a tool response. *)
let update_tool_response ~(chat_id : string) ~(message_id : string)
    ~(response : user_tool_response_value) ~(tool_call_id : string) () =
  ({
     Request.service = "cognition";
     operation = "update_tool_response";
     meth = `POST;
     path =
       String.concat ""
         [
           "/chats/";
           Request.segment ((fun value -> value) chat_id);
           "/tool/response/update";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_update_tool_response_request
               ({ message_id; response; tool_call_id }
                 : update_tool_response_request)));
     decode_reply = Request.unit;
     decode_error = Request.no_error;
   }
    : (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t)

(** [POST /chats/{chat_id}/tool/update]

Update a tool call's arguments after validation. *)
let update_tool_call ~(chat_id : string) ~(args : Yojson.Safe.t)
    ~(message_id : string) ~(tool_call_id : string) () =
  ({
     Request.service = "cognition";
     operation = "update_tool_call";
     meth = `POST;
     path =
       String.concat ""
         [
           "/chats/";
           Request.segment ((fun value -> value) chat_id);
           "/tool/update";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_update_tool_call_request
               ({ args; message_id; tool_call_id } : update_tool_call_request)));
     decode_reply = Request.unit;
     decode_error = Request.no_error;
   }
    : (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t)

(** [GET /citations/{id}] *)
let get_citation_handler ~(id : string) () =
  ({
     Request.service = "cognition";
     operation = "get_citation_handler";
     meth = `GET;
     path =
       String.concat ""
         [ "/citations/"; Request.segment ((fun value -> value) id) ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json document_text_part_of_yojson;
     decode_error = Request.no_error;
   }
    : ( document_text_part,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /database-query] *)
let generate_database_query ~(model : string) ~(prompt : string)
    ~(schema : Yojson.Safe.t) ~(sql : string) ?error () =
  ({
     Request.service = "cognition";
     operation = "generate_database_query";
     meth = `POST;
     path = "/database-query";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_database_query_request
               ({ error; model; prompt; schema; sql } : database_query_request)));
     decode_reply = Request.json database_query_answer_of_yojson;
     decode_error =
       Request.error_json
         [ 402; 403; 500; 503; 504 ]
         structured_completion_error_of_yojson;
   }
    : ( database_query_answer,
        structured_completion_error )
      Macro_sdk_runtime.Request.t)

(** [POST /decisions] *)
let decisions ~(input : Yojson.Safe.t) ~(questions : (string * string) list) ()
    =
  ({
     Request.service = "cognition";
     operation = "decisions";
     meth = `POST;
     path = "/decisions";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_decision_request
               ({ input; questions } : decision_request)));
     decode_reply = Request.json decision_response_of_yojson;
     decode_error =
       Request.error_json
         [ 400; 402; 500; 502; 503; 504 ]
         decision_error_body_of_yojson;
   }
    : (decision_response, decision_error_body) Macro_sdk_runtime.Request.t)

(** [POST /email/send-confirmed]

Send an email the user approved in conversation, quoting their approval. *)
let send_confirmed_email ~(body : Yojson.Safe.t) () =
  ({
     Request.service = "cognition";
     operation = "send_confirmed_email";
     meth = `POST;
     path = "/email/send-confirmed";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = Some (Request.Json (Json.of_json body));
     decode_reply = Request.json Json.json;
     decode_error =
       Request.error_json [ 400; 422 ] generic_error_response_of_yojson;
   }
    : (Yojson.Safe.t, generic_error_response) Macro_sdk_runtime.Request.t)

(** [GET /health]

Health check *)
let health_handler () =
  ({
     Request.service = "cognition";
     operation = "health_handler";
     meth = `GET;
     path = "/health";
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

(** [POST /images/generate]

Generate an image with Nano Banana and store it as a static file owned by
the caller. Charged to the acting user's AI allowance. *)
let generate_image ~(prompt : string) ?aspect_ratio ?reference_images () =
  ({
     Request.service = "cognition";
     operation = "generate_image";
     meth = `POST;
     path = "/images/generate";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_generate_image_request
               ({ aspect_ratio; prompt; reference_images }
                 : generate_image_request)));
     decode_reply = Request.json generate_image_response_of_yojson;
     decode_error =
       Request.error_json
         [ 400; 402; 403; 422; 500; 502; 503 ]
         generate_image_error_body_of_yojson;
   }
    : ( generate_image_response,
        generate_image_error_body )
      Macro_sdk_runtime.Request.t)

(** [GET /import/entities]

List the caller's import ledger: staged candidates, running and finished
imports (with the team's imports), and declined items. *)
let list_import_entities ?source ?status () =
  ({
     Request.service = "cognition";
     operation = "list_import_entities";
     meth = `GET;
     path = "/import/entities";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "source",
             match source with
             | None -> []
             | Some value ->
                 [
                   (fun value -> Json.string (yojson_of_import_source value))
                     value;
                 ] );
           ( "status",
             match status with
             | None -> []
             | Some value ->
                 [
                   (fun value -> Json.string (yojson_of_import_status value))
                     value;
                 ] );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json import_entities_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( import_entities_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /import/entities]

Track an external item in the ledger: stage it as a candidate, or record a
Macro entity already created from it. Says when the item was already
imported, so callers do not create a duplicate. *)
let track_import_entity ~(foreign_id : string) ~(metadata : Yojson.Safe.t)
    ~(source : import_source) ~(status : track_import_status) ?entity_id () =
  ({
     Request.service = "cognition";
     operation = "track_import_entity";
     meth = `POST;
     path = "/import/entities";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_track_import_entity_request
               ({ entity_id; foreign_id; metadata; source; status }
                 : track_import_entity_request)));
     decode_reply = Request.json track_import_entity_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( track_import_entity_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [DELETE /import/entities/{id}]

Decline one of the caller's staged candidates; it is remembered as declined
and not proposed again. *)
let decline_import_entity ~(id : string) () =
  ({
     Request.service = "cognition";
     operation = "decline_import_entity";
     meth = `DELETE;
     path =
       String.concat ""
         [ "/import/entities/"; Request.segment ((fun value -> value) id) ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.unit;
     decode_error = Request.no_error;
   }
    : (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t)

(** [GET /import/notion]

Where the user's Notion workspace import stands. *)
let notion_report_handler () =
  ({
     Request.service = "cognition";
     operation = "notion_report_handler";
     meth = `GET;
     path = "/import/notion";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json notion_import_report_of_yojson;
     decode_error = Request.no_error;
   }
    : ( notion_import_report,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /import/notion/cancel]

Stop planning or writing the user's Notion import. Objects already
imported stay. *)
let cancel_notion_handler () =
  ({
     Request.service = "cognition";
     operation = "cancel_notion_handler";
     meth = `POST;
     path = "/import/notion/cancel";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json notion_import_report_of_yojson;
     decode_error = Request.no_error;
   }
    : ( notion_import_report,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /import/notion/pages]

Import one Notion page as a Macro document through the caller's Notion
connection, deduplicated against the ledger. Notion databases are not
imported; a whole workspace goes through a reviewed import instead. *)
let import_notion_page ~(page : string) () =
  ({
     Request.service = "cognition";
     operation = "import_notion_page";
     meth = `POST;
     path = "/import/notion/pages";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_import_notion_page_request
               ({ page } : import_notion_page_request)));
     decode_reply = Request.json import_notion_page_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( import_notion_page_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /import/run]

Accept staged imports (starts import jobs) and/or discard staged rows. *)
let run_import_handler ?discard_ids ?import_ids () =
  ({
     Request.service = "cognition";
     operation = "run_import_handler";
     meth = `POST;
     path = "/import/run";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_run_import_request
               ({ discard_ids; import_ids } : run_import_request)));
     decode_reply = Request.json run_import_outcome_of_yojson;
     decode_error = Request.no_error;
   }
    : ( run_import_outcome,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /import/runs/{source}/discover]

Discover candidates for user selection. Only Slack supports discovery. *)
let discover_handler ~(source : string) () =
  ({
     Request.service = "cognition";
     operation = "discover_handler";
     meth = `POST;
     path =
       String.concat ""
         [
           "/import/runs/";
           Request.segment ((fun value -> value) source);
           "/discover";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.unit;
     decode_error = Request.no_error;
   }
    : (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t)

(** [GET /import/state]

Get the authenticated user's import state: discovery runs plus visible
ledger rows. *)
let get_state_handler () =
  ({
     Request.service = "cognition";
     operation = "get_state_handler";
     meth = `GET;
     path = "/import/state";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json import_state_of_yojson;
     decode_error = Request.no_error;
   }
    : ( import_state,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /import/workspaces/{source}]

Report progress for one reviewed workspace source. *)
let workspace_report_handler ~(source : import_source) () =
  ({
     Request.service = "cognition";
     operation = "workspace_report_handler";
     meth = `GET;
     path =
       String.concat ""
         [
           "/import/workspaces/";
           Request.segment
             ((fun value -> Json.string (yojson_of_import_source value)) source);
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json notion_import_report_of_yojson;
     decode_error = Request.no_error;
   }
    : ( notion_import_report,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /import/workspaces/{source}/cancel]

Cancel this source's plan or write, keeping completed entities. *)
let cancel_workspace_handler ~(source : import_source) () =
  ({
     Request.service = "cognition";
     operation = "cancel_workspace_handler";
     meth = `POST;
     path =
       String.concat ""
         [
           "/import/workspaces/";
           Request.segment
             ((fun value -> Json.string (yojson_of_import_source value)) source);
           "/cancel";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json notion_import_report_of_yojson;
     decode_error = Request.no_error;
   }
    : ( notion_import_report,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /mcp/servers]

List all MCP servers configured for the authenticated user. *)
let list_mcp_servers () =
  ({
     Request.service = "cognition";
     operation = "list_mcp_servers";
     meth = `GET;
     path = "/mcp/servers";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json (Json.list server_response_of_yojson);
     decode_error = Request.error_json [ 500 ] error_response_of_yojson;
   }
    : (server_response list, error_response) Macro_sdk_runtime.Request.t)

(** [PUT /mcp/servers]

Update an existing MCP server's name or enabled status. *)
let update_mcp_server ~(url : string) ?enabled ?server_name () =
  ({
     Request.service = "cognition";
     operation = "update_mcp_server";
     meth = `PUT;
     path = "/mcp/servers";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_update_server_request
               ({ enabled; server_name; url } : update_server_request)));
     decode_reply = Request.json server_response_of_yojson;
     decode_error = Request.error_json [ 404; 500 ] error_response_of_yojson;
   }
    : (server_response, error_response) Macro_sdk_runtime.Request.t)

(** [POST /mcp/servers]

Add a new MCP server for the authenticated user. A URL the user already
has is returned as stored, keeping its credentials. *)
let add_mcp_server ~(server_name : string) ~(url : string) () =
  ({
     Request.service = "cognition";
     operation = "add_mcp_server";
     meth = `POST;
     path = "/mcp/servers";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_add_server_request
               ({ server_name; url } : add_server_request)));
     decode_reply = Request.json server_response_of_yojson;
     decode_error = Request.error_json [ 400; 500 ] error_response_of_yojson;
   }
    : (server_response, error_response) Macro_sdk_runtime.Request.t)

(** [DELETE /mcp/servers]

Delete an MCP server by URL. *)
let delete_mcp_server ~(url : string) () =
  ({
     Request.service = "cognition";
     operation = "delete_mcp_server";
     meth = `DELETE;
     path = "/mcp/servers";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [ ("url", [ (fun value -> value) url ]) ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.unit;
     decode_error = Request.error_json [ 500 ] error_response_of_yojson;
   }
    : (unit, error_response) Macro_sdk_runtime.Request.t)

(** [GET /mcp/servers/auth/callback]

OAuth callback endpoint — receives code and state, or an error, from the
authorization server. *)
let mcp_auth_callback ?code ?state ?error ?error_description () =
  ({
     Request.service = "cognition";
     operation = "mcp_auth_callback";
     meth = `GET;
     path = "/mcp/servers/auth/callback";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "code",
             match code with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
           ( "state",
             match state with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
           ( "error",
             match error with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
           ( "error_description",
             match error_description with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.unit;
     decode_error = Request.error_json [ 400; 500 ] error_response_of_yojson;
   }
    : (unit, error_response) Macro_sdk_runtime.Request.t)

(** [GET /mcp/servers/auth/client-metadata]

Return Macro's public OAuth Client ID Metadata Document. *)
let mcp_oauth_client_metadata () =
  ({
     Request.service = "cognition";
     operation = "mcp_oauth_client_metadata";
     meth = `GET;
     path = "/mcp/servers/auth/client-metadata";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.unit;
     decode_error = Request.no_error;
   }
    : (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t)

(** [POST /mcp/servers/auth/start]

Start the OAuth authorization flow for an MCP server. *)
let start_mcp_auth ~(server_name : string) ~(server_url : string) () =
  ({
     Request.service = "cognition";
     operation = "start_mcp_auth";
     meth = `POST;
     path = "/mcp/servers/auth/start";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_start_auth_request
               ({ server_name; server_url } : start_auth_request)));
     decode_reply = Request.json start_auth_response_of_yojson;
     decode_error = Request.error_json [ 500 ] error_response_of_yojson;
   }
    : (start_auth_response, error_response) Macro_sdk_runtime.Request.t)

(** [GET /memory]

Get the authenticated user's latest memory. *)
let get_memory_handler () =
  ({
     Request.service = "cognition";
     operation = "get_memory_handler";
     meth = `GET;
     path = "/memory";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json memory_response_of_yojson;
     decode_error = Request.error_json [ 500 ] memory_error_body_of_yojson;
   }
    : (memory_response, memory_error_body) Macro_sdk_runtime.Request.t)

(** [GET /memory/activity]

Read privacy-reviewed professional activity of the caller or a current teammate. *)
let get_user_activity ~(start : string) ~(end_ : string) ?user () =
  ({
     Request.service = "cognition";
     operation = "get_user_activity";
     meth = `GET;
     path = "/memory/activity";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "user",
             match user with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
           ("start", [ (fun value -> value) start ]);
           ("end", [ (fun value -> value) end_ ]);
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json activity_reports_of_yojson;
     decode_error =
       Request.error_json [ 400; 403; 500 ] memory_error_body_of_yojson;
   }
    : (activity_reports, memory_error_body) Macro_sdk_runtime.Request.t)

(** [GET /memory/explicit]

Read the caller's private explicit memory and its revision. *)
let read_explicit_memory () =
  ({
     Request.service = "cognition";
     operation = "read_explicit_memory";
     meth = `GET;
     path = "/memory/explicit";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json explicit_memory_of_yojson;
     decode_error = Request.error_json [ 500 ] memory_error_body_of_yojson;
   }
    : (explicit_memory, memory_error_body) Macro_sdk_runtime.Request.t)

(** [PATCH /memory/explicit]

Apply one edit to the caller's private explicit memory. *)
let edit_explicit_memory ~(edit : memory_edit) ~(revision : int64) () =
  ({
     Request.service = "cognition";
     operation = "edit_explicit_memory";
     meth = `PATCH;
     path = "/memory/explicit";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_update_explicit_memory_request
               ({ edit; revision } : update_explicit_memory_request)));
     decode_reply = Request.json explicit_memory_of_yojson;
     decode_error =
       Request.error_json [ 400; 409; 422; 500 ] memory_error_body_of_yojson;
   }
    : (explicit_memory, memory_error_body) Macro_sdk_runtime.Request.t)

(** [GET /onboarding]

Get the authenticated user's onboarding state. *)
let get_state_handler_2 () =
  ({
     Request.service = "cognition";
     operation = "get_state_handler";
     meth = `GET;
     path = "/onboarding";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json onboarding_state_of_yojson;
     decode_error = Request.no_error;
   }
    : ( onboarding_state,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /onboarding/complete]

Complete (or skip) onboarding. Unreserved leftover onboarding-staged
import candidates are deleted. *)
let complete_handler ?skipped () =
  ({
     Request.service = "cognition";
     operation = "complete_handler";
     meth = `POST;
     path = "/onboarding/complete";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_complete_onboarding_request
               ({ skipped } : complete_onboarding_request)));
     decode_reply = Request.json onboarding_row_of_yojson;
     decode_error = Request.no_error;
   }
    : ( onboarding_row,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /onboarding/prompts]

List the sidebar prompts the authenticated user dismissed on any device. *)
let dismissed_prompts_handler () =
  ({
     Request.service = "cognition";
     operation = "dismissed_prompts_handler";
     meth = `GET;
     path = "/onboarding/prompts";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json dismissed_prompts_of_yojson;
     decode_error = Request.no_error;
   }
    : ( dismissed_prompts,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /onboarding/prompts/{prompt_id}/dismiss]

Dismiss one sidebar prompt for the authenticated user, on every device.
Idempotent. *)
let dismiss_prompt_handler ~(prompt_id : string) () =
  ({
     Request.service = "cognition";
     operation = "dismiss_prompt_handler";
     meth = `POST;
     path =
       String.concat ""
         [
           "/onboarding/prompts/";
           Request.segment ((fun value -> value) prompt_id);
           "/dismiss";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.unit;
     decode_error = Request.no_error;
   }
    : (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t)

(** [GET /pipedream/mcp/catalog]

Browse or search the catalog of connectable apps. *)
let browse_pipedream_mcp_catalog ?search ?cursor ?limit () =
  ({
     Request.service = "cognition";
     operation = "browse_pipedream_mcp_catalog";
     meth = `GET;
     path = "/pipedream/mcp/catalog";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "search",
             match search with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
           ( "cursor",
             match cursor with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
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
     decode_reply = Request.json pipedream_catalog_response_of_yojson;
     decode_error = Request.error_json [ 500; 501 ] error_response_of_yojson;
   }
    : (pipedream_catalog_response, error_response) Macro_sdk_runtime.Request.t)

(** [POST /pipedream/mcp/complete]

Register a connected account reported by the Pipedream Connect UI. *)
let complete_pipedream_mcp_connection ~(account_id : string) ?server_name () =
  ({
     Request.service = "cognition";
     operation = "complete_pipedream_mcp_connection";
     meth = `POST;
     path = "/pipedream/mcp/complete";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_pipedream_complete_request
               ({ account_id; server_name } : pipedream_complete_request)));
     decode_reply = Request.json pipedream_connection_response_of_yojson;
     decode_error =
       Request.error_json [ 404; 409; 500; 501 ] error_response_of_yojson;
   }
    : ( pipedream_connection_response,
        error_response )
      Macro_sdk_runtime.Request.t)

(** [POST /pipedream/mcp/connect/complete]

Record an app the user connected through Macro Connect. *)
let complete_pipedream_mcp_connect ~(app_slug : string) ?server_name () =
  ({
     Request.service = "cognition";
     operation = "complete_pipedream_mcp_connect";
     meth = `POST;
     path = "/pipedream/mcp/connect/complete";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_pipedream_connect_complete_request
               ({ app_slug; server_name } : pipedream_connect_complete_request)));
     decode_reply = Request.json pipedream_connection_response_of_yojson;
     decode_error =
       Request.error_json [ 404; 500; 501 ] error_response_of_yojson;
   }
    : ( pipedream_connection_response,
        error_response )
      Macro_sdk_runtime.Request.t)

(** [GET /pipedream/mcp/connections]

List the MCP apps connected by the authenticated user. *)
let list_pipedream_mcp_connections () =
  ({
     Request.service = "cognition";
     operation = "list_pipedream_mcp_connections";
     meth = `GET;
     path = "/pipedream/mcp/connections";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply =
       Request.json (Json.list pipedream_connection_response_of_yojson);
     decode_error = Request.error_json [ 500 ] error_response_of_yojson;
   }
    : ( pipedream_connection_response list,
        error_response )
      Macro_sdk_runtime.Request.t)

(** [PUT /pipedream/mcp/connections]

Rename or enable/disable a connected app. *)
let update_pipedream_mcp_connection ~(app_slug : string) ?enabled ?server_name
    () =
  ({
     Request.service = "cognition";
     operation = "update_pipedream_mcp_connection";
     meth = `PUT;
     path = "/pipedream/mcp/connections";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_pipedream_update_request
               ({ app_slug; enabled; server_name } : pipedream_update_request)));
     decode_reply = Request.json pipedream_connection_response_of_yojson;
     decode_error = Request.error_json [ 404; 500 ] error_response_of_yojson;
   }
    : ( pipedream_connection_response,
        error_response )
      Macro_sdk_runtime.Request.t)

(** [DELETE /pipedream/mcp/connections]

Disconnect an app, revoking its Pipedream account. *)
let delete_pipedream_mcp_connection ~(app_slug : string) () =
  ({
     Request.service = "cognition";
     operation = "delete_pipedream_mcp_connection";
     meth = `DELETE;
     path = "/pipedream/mcp/connections";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [ ("app_slug", [ (fun value -> value) app_slug ]) ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.unit;
     decode_error = Request.error_json [ 500 ] error_response_of_yojson;
   }
    : (unit, error_response) Macro_sdk_runtime.Request.t)

(** [GET /pipedream/mcp/overlays]

List the catalog apps that connect through their own MCP server. *)
let list_pipedream_mcp_overlays () =
  ({
     Request.service = "cognition";
     operation = "list_pipedream_mcp_overlays";
     meth = `GET;
     path = "/pipedream/mcp/overlays";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply =
       Request.json (Json.list pipedream_overlay_response_of_yojson);
     decode_error = Request.error_json [ 500 ] error_response_of_yojson;
   }
    : ( pipedream_overlay_response list,
        error_response )
      Macro_sdk_runtime.Request.t)

(** [POST /pipedream/mcp/recover]

Register an account a Connect flow created but the Connect UI never
reported. *)
let recover_pipedream_mcp_connection ~(app_slug : string) ?server_name () =
  ({
     Request.service = "cognition";
     operation = "recover_pipedream_mcp_connection";
     meth = `POST;
     path = "/pipedream/mcp/recover";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_pipedream_recover_request
               ({ app_slug; server_name } : pipedream_recover_request)));
     decode_reply = Request.json pipedream_connection_response_of_yojson;
     decode_error =
       Request.error_json [ 404; 409; 500; 501 ] error_response_of_yojson;
   }
    : ( pipedream_connection_response,
        error_response )
      Macro_sdk_runtime.Request.t)

(** [POST /pipedream/mcp/token]

Start a connect flow for the authenticated user. *)
let create_pipedream_mcp_token ?body () =
  ({
     Request.service = "cognition";
     operation = "create_pipedream_mcp_token";
     meth = `POST;
     path = "/pipedream/mcp/token";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Option.map
         (fun body ->
           Request.Json
             ((Json.of_option yojson_of_pipedream_token_request) body))
         body;
     decode_reply = Request.json pipedream_token_response_of_yojson;
     decode_error = Request.error_json [ 500; 501 ] error_response_of_yojson;
   }
    : (pipedream_token_response, error_response) Macro_sdk_runtime.Request.t)

(** [POST /preview] *)
let get_batch_preview ~(chat_ids : string list) () =
  ({
     Request.service = "cognition";
     operation = "get_batch_preview";
     meth = `POST;
     path = "/preview";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_get_batch_preview_request
               ({ chat_ids } : get_batch_preview_request)));
     decode_reply = Request.json get_batch_preview_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( get_batch_preview_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /skills]

List the caller's skills, or search them by name when [query] is given.
Built-in skills are included. *)
let list_skills ?query ?match_type () =
  ({
     Request.service = "cognition";
     operation = "list_skills";
     meth = `GET;
     path = "/skills";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "query",
             match query with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
           ( "matchType",
             match match_type with
             | None -> []
             | Some value ->
                 [
                   (fun value ->
                     Json.string (yojson_of_skills_match_type value))
                     value;
                 ] );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json skills_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 500; 502 ] skill_error_body_of_yojson;
   }
    : (skills_response, skill_error_body) Macro_sdk_runtime.Request.t)

(** [GET /skills/{id}]

Read one skill's complete instructions: a skill document the caller can
view, or a built-in skill. *)
let read_skill ~(id : string) () =
  ({
     Request.service = "cognition";
     operation = "read_skill";
     meth = `GET;
     path =
       String.concat ""
         [ "/skills/"; Request.segment ((fun value -> value) id) ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json skill_content_response_of_yojson;
     decode_error =
       Request.error_json [ 404; 500; 503 ] skill_error_body_of_yojson;
   }
    : (skill_content_response, skill_error_body) Macro_sdk_runtime.Request.t)

(** [POST /stream/chat/message]

Send a new chat message and stream the AI response. *)
let send_chat_message ~(content : string) ~(model : string)
    ?additional_instructions ?attachments ?chat_id ?speed ?toolset () =
  ({
     Request.service = "cognition";
     operation = "send_chat_message";
     meth = `POST;
     path = "/stream/chat/message";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_http_send_chat_message_request
               ({
                  additional_instructions;
                  attachments;
                  chat_id;
                  content;
                  model;
                  speed;
                  toolset;
                }
                 : http_send_chat_message_request)));
     decode_reply = Request.json send_chat_message_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 402; 403; 503 ] chat_message_error_of_yojson;
   }
    : ( send_chat_message_response,
        chat_message_error )
      Macro_sdk_runtime.Request.t)

(** [POST /stream/chat/message/stop]

Stop an in-flight AI chat stream. *)
let stop_chat_stream ~(chat_id : string) ~(stream_id : string) () =
  ({
     Request.service = "cognition";
     operation = "stop_chat_stream";
     meth = `POST;
     path = "/stream/chat/message/stop";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_stop_chat_stream_request
               ({ chat_id; stream_id } : stop_chat_stream_request)));
     decode_reply = Request.json stop_chat_stream_response_of_yojson;
     decode_error = Request.error_json [ 403 ] stop_chat_stream_error_of_yojson;
   }
    : ( stop_chat_stream_response,
        stop_chat_stream_error )
      Macro_sdk_runtime.Request.t)

(** [POST /structured-completion] *)
let structured_completion ~(model : string) ~(output_schema : dynamic_schema)
    ~(prompt : string) ?additional_instructions ?thinking ?toolset () =
  ({
     Request.service = "cognition";
     operation = "structured_completion";
     meth = `POST;
     path = "/structured-completion";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_structured_completion_request
               ({
                  additional_instructions;
                  model;
                  output_schema;
                  prompt;
                  thinking;
                  toolset;
                }
                 : structured_completion_request)));
     decode_reply = Request.json structured_completion_response_of_yojson;
     decode_error =
       Request.error_json
         [ 400; 402; 403; 500; 503; 504 ]
         structured_completion_error_of_yojson;
   }
    : ( structured_completion_response,
        structured_completion_error )
      Macro_sdk_runtime.Request.t)

(** [POST /web/fetch]

Read one public web page as Markdown. Charged to the acting user's AI allowance. *)
let fetch_web_page ~(url : string) ?max_chars () =
  ({
     Request.service = "cognition";
     operation = "fetch_web_page";
     meth = `POST;
     path = "/web/fetch";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json (yojson_of_web_fetch ({ max_chars; url } : web_fetch)));
     decode_reply = Request.json web_fetch_response_of_yojson;
     decode_error =
       Request.error_json
         [ 400; 402; 404; 422; 502; 503 ]
         web_error_body_of_yojson;
   }
    : (web_fetch_response, web_error_body) Macro_sdk_runtime.Request.t)

(** [POST /web/search]

Search the public web. Charged to the acting user's AI allowance. *)
let search_web ~(query : string) ?domains ?exclude_domains ?include_content
    ?max_results ?since ?topic () =
  ({
     Request.service = "cognition";
     operation = "search_web";
     meth = `POST;
     path = "/web/search";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_web_search
               ({
                  domains;
                  exclude_domains;
                  include_content;
                  max_results;
                  query;
                  since;
                  topic;
                }
                 : web_search)));
     decode_reply = Request.json web_search_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 402; 404; 502; 503 ] web_error_body_of_yojson;
   }
    : (web_search_response, web_error_body) Macro_sdk_runtime.Request.t)
