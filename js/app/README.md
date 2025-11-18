# Macro App Frontend

This is the root directory for the [solidjs](https://www.solidjs.com/) frontend application known as _Macro_

We use the [bun](https://bun.sh/) as a javascript package manager and runtime for the [vite](https://vite.dev/) development server.

The production application is compiled down to a static javascript bundle using a traditional SPA-like architecture.

### Toolchain Management

If you have the [nix](https://nixos.org/learn/) package manager installed on your system then you can drop into a nix shell where everything you need is installed for you.

`nix develop`


## Tauri 🤝 Macro

We are currently in the process of bundling the frontend javascript application as a [Tauri](https://tauri.app/) app.
You will need the following dependencies installed on your system to develop in this environment.

1. The [rust programming language](https://rust-lang.org/tools/install/)
1. The [Tauri CLI](https://v2.tauri.app/reference/cli/)
1. The [bun](https://bun.sh/) runtime
1. *For Android Development* The [Android Studio IDE](https://developer.android.com/studio)
1. *For iOS Development* [XCode](https://developer.apple.com/xcode/) for MacOS

If you do not want to manage these dependencies manually, it is recommended to use `nix develop`


### Running Tauri

After the dependencies are installed you can use the tauri cli to run the app.
Note the first command should be substituted with the package manager you used to install the cli e.g. cargo, bun, etc.
In the nix shell the cli is installed for the cargo package manager.


Run the Desktop App for your host operating system
  > `cargo tauri dev`

Run the Android App
  > `cargo tauri android dev`

Run the iOS App (note: I haven't had the chance to test this yet)
  > `cargo tauri ios dev`

