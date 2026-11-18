// The VM test's broken self-edit: records what the agent can reach from
// inside macro-agent.service, then fails to boot.
const exitCode = (argv: string[]) => Bun.spawnSync(argv, { stdout: "ignore", stderr: "ignore" }).exitCode;
const status = await Bun.file("/proc/self/status").text();
await Bun.write(
  `${process.env.HOME}/probe.json`,
  JSON.stringify({
    sudo: exitCode(["sudo", "-n", "true"]),
    docker: exitCode(["docker", "ps"]),
    noNewPrivileges: /^NoNewPrivs:\s+1$/m.test(status),
    otherHome: await Bun.file("/home/macro/work/secret").exists(),
    apiKeyInEnvironment: "MACRO_API_KEY" in process.env,
    // How the runtime starts Claude Code and capability scripts: they must
    // not see the credential file.
    credentialsInChildren: exitCode([
      "bwrap", "--dev-bind", "/", "/", "--tmpfs", "/run/credentials", "--",
      "test", "-e", process.env.MUPPET_CREDENTIALS_FILE ?? "",
    ]),
    credentialsReadable: (await Bun.file(process.env.MUPPET_CREDENTIALS_FILE ?? "").text()).includes("MACRO_API_KEY="),
  }),
);
process.exit(1);
