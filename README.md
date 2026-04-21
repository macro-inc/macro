<div align="center">
<a target="_blank" href="https://macro.com">
<img width="1414" height="314" alt="Frame 2 (1)" src="https://github.com/user-attachments/assets/48250880-b1cf-4e18-bcaf-f314be1d1bfb" />
</a>


  
<p align="center">
  Extremely fast email, messaging, tasks and docs @linked together in one system.
</div>


##  Features
<div>
<table>
<tr>
<td width="64" align="center">
<img src=".github/icons/email.svg" width="32" height="32" alt="email">
</td>
<td>
<strong>Email</strong><br>
Full email client with keyboard-driven triage, instant search, and Gmail sync.
</td>
</tr>

<tr>
<td width="64" align="center">
<img src=".github/icons/channel.svg" width="32" height="32" alt="channel">
</td>
<td>
<strong>Channels & Groups</strong><br>
Team messaging with bi-directional @links. Mention a doc or task to create a reference you can trace back.
</td>
</tr>

<tr>
<td width="64" align="center">
<img src=".github/icons/book.svg" width="32" height="32" alt="docs">
</td>
<td>
<strong>Docs & Notes</strong><br>
Real-time collaborative documents using CRDT. @link to any message, task, or file in the system.
</td>
</tr>

<tr>
<td width="64" align="center">
<img src=".github/icons/diagram.svg" width="32" height="32" alt="canvas">
</td>
<td>
<strong>Canvas</strong><br>
2D diagramming with embedded @links to tasks, files, and emails. Embeds update automatically.
</td>
</tr>

<tr>
<td width="64" align="center">
<img src=".github/icons/file-md.svg" width="32" height="32" alt="editor">
</td>
<td>
<strong>Unified Editor</strong><br>
Same rich text editor across emails, notes, channels, and tasks. One surface, everywhere.
</td>
</tr>

<tr>
<td width="64" align="center">
<img src=".github/icons/ai.svg" width="32" height="32" alt="ai">
</td>
<td>
<strong>AI Chat</strong><br>
Query your emails, messages, docs, and the web. @mention anything for context. Agent mode for autonomous search.
</td>
</tr>

<tr>
<td width="64" align="center">
<img src=".github/icons/search.svg" width="32" height="32" alt="search">
</td>
<td>
<strong>Unified Search</strong><br>
Search and query everything: <code>type:email inbox:true</code>, <code>type:task due:[1 week]</code>, <code>type:file "contract"</code>
</td>
</tr>

<tr>
<td width="64" align="center">
<img src=".github/icons/folder.svg" width="32" height="32" alt="folder">
</td>
<td>
<strong>File Storage</strong><br>
Store and share videos, images, and documents. Auto-imports attachments from emails and channels.
</td>
</tr>

<tr>
<td width="64" align="center">
<img src=".github/icons/pdf.svg" width="32" height="32" alt="pdf">
</td>
<td>
<strong>PDF Viewer</strong><br>
Intelligent parsing with text extraction. Full-text search over PDF contents.
</td>
</tr>

<tr>
<td width="64" align="center">
<img src=".github/icons/keyboard.svg" width="32" height="32" alt="keyboard">
</td>
<td>
<strong>Keyboard First</strong><br>
Every action has a hotkey. Navigate, triage, search, and execute from anywhere without touching the mouse.
</td>
</tr>

<tr>
<td width="64" align="center">
<img src=".github/icons/user.svg" width="32" height="32" alt="permissions">
</td>
<td>
<strong>Intuitive Permissions</strong><br>
Permissions inherit from channels. Send a document to someone and they can access it.
</td>
</tr>
</table>

</p>
<h1 style="border-bottom: none">
</h1>
</div>

## Directory Structure

While we're not accepting contributions yet, we encourage you to explore the codebase. This overview should help you navigate.

```
macro/
├── js/app/                      # Frontend (SolidJS + Tauri)
│   ├── packages/
│   │   ├── app/                 # Web/Desktop app entry point
│   │   ├── core/                # Core shared logic and components
│   │   ├── lexical-core/        # Core text editor (Lexical-based)
│   │   ├── block-*/             # UI block components (email, chat, canvas, etc.)
│   │   └── service-*/           # API clients for backend services
│   └── src-tauri/               # Tauri Rust backend for desktop
│
├── rust/cloud-storage/          # Backend services (Rust)
│   ├── document-storage-service/    # Document storage API
│   ├── email_service/               # Email processing
│   ├── comms_service/               # Messaging
│   ├── search_service/              # Full-text search
│   ├── authentication_service/      # Auth
│   ├── connection_gateway/          # WebSocket gateway
│   ├── macro_db_client/             # PostgreSQL client
│   └── ...                          # Other services and shared crates
│
├── infra/                       # Infrastructure (Pulumi + AWS)
│   ├── stacks/                  # Pulumi deployment stacks
│   ├── lambda/                  # Lambda function configs
│   └── resources/               # Reusable AWS resource definitions
│
└── scripts/                     # Build and utility scripts
```

## Feature Requests

For feature requests, please email contact@macro.com

## Hiring

We're hiring! If you're interested in working on macro, please email teo@macro.com


## CONTRIBUTIONS

Email contribute@macro.com to join the community.


## Star History

<a href="https://www.star-history.com/?repos=macro-inc%2Fmacro&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=macro-inc/macro&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=macro-inc/macro&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=macro-inc/macro&type=date&legend=top-left" />
 </picture>
</a>
