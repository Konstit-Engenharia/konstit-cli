import { describe, expect, test } from "bun:test";
import {
  command,
  completionShells,
  flag,
  isCompletionShell,
  option,
  parsers,
  positional,
} from "../src";
import {
  dynamicCompletionEnvironment,
  generateCompletion,
} from "../src/completion";

const cli = command("demo")
  .version("1.0.0")
  .arg(option("mode", parsers.enum(["dev", "prod"])).short("m"))
  .arg(option("config").valueHint("file"))
  .arg(flag("verbose").short("v"))
  .arg(positional("output").valueHint("directory"))
  .arg(option("secret").hide())
  .subcommand(
    command("run")
      .about("Run the application")
      .arg(option("target", parsers.enum(["web", "server"]))),
  )
  .subcommand(command("internal").hide().arg(flag("unsafe")));

describe("completion generation", () => {
  test("supports the common shell set", () => {
    expect(completionShells).toEqual(["bash", "zsh", "fish", "powershell"]);
    expect(isCompletionShell("bash")).toBe(true);
    expect(isCompletionShell("nu")).toBe(false);

    for (const shell of completionShells) {
      const script = generateCompletion(cli, shell);
      expect(script.endsWith("\n")).toBe(true);
      expect(script).toContain("demo");
      expect(script).toContain("--mode");
      expect(script).toContain("dev");
      expect(script).toContain("run");
      expect(script).toContain("--target");
      expect(script).not.toContain("--secret");
      expect(script).not.toContain("internal");
    }
  });

  test("provides a standalone function and executable override", () => {
    const direct = generateCompletion(cli, "bash", { executable: "demo-cli" });
    expect(direct).toContain("complete -F _bun_clap_demo_cli 'demo-cli'");
  });

  test("includes inherited globals and visible subcommand aliases", () => {
    const globalCli = command("tool")
      .arg(flag("verbose").global())
      .subcommand(command("serve").visibleAlias("server").alias("s"));
    const script = generateCompletion(globalCli, "bash");
    expect(script).toContain("--verbose");
    expect(script).toContain("server");
    expect(script).not.toContain("'s'");
  });

  test("rejects invalid runtime shell and executable input", () => {
    expect(() => generateCompletion(cli, "nu" as "bash")).toThrow("Unsupported");
    expect(() => generateCompletion(cli, "bash", { executable: "-bad" })).toThrow(
      "Invalid completion executable",
    );
  });

  test("keeps parser completion metadata immutable", () => {
    const parser = parsers.enum(["one", "two"]);
    expect(parser.completions).toEqual(["one", "two"]);
    expect(Object.isFrozen(parser.completions)).toBe(true);
    expect(parsers.boolean.completions).toEqual(["true", "false"]);
  });

  test("generates opt-in dynamic scripts for every supported shell", () => {
    for (const shell of completionShells) {
      const script = generateCompletion(cli, shell, { dynamic: true });
      expect(script).toContain(dynamicCompletionEnvironment);
      expect(script).not.toContain("--mode");
    }
    expect(
      checkSyntax("bash", generateCompletion(cli, "bash", { dynamic: true })).exitCode,
    ).toBe(0);
    expect(
      checkSyntax("zsh", generateCompletion(cli, "zsh", { dynamic: true })).exitCode,
    ).toBe(0);
  });

  test("writes dynamic provider candidates through the shell protocol", async () => {
    const dynamicCli = command("packages").arg(
      option("package").complete(async () => ["react", "redis", "vue"]),
    );
    let output = "";
    expect(await withDynamicCompletion(() => dynamicCli.run({
      argv: ["--package", "re"],
      stdout: (text) => {
        output += text;
      },
    }))).toBe(0);
    expect(output).toBe("react\nredis\n");
  });

  test("Bash dynamic scripts forward the incomplete argv", () => {
    const script = `${generateCompletion(cli, "bash", { dynamic: true })}
demo() {
  [[ "$KONSTIT_CLI_COMPLETE" == 1 ]] || return 1
  printf '%s\n' "$@"
}
COMP_WORDS=(demo run --target we)
COMP_CWORD=3
__konstit_cli_demo_dynamic
printf 'DYNAMIC:%s\n' "\${COMPREPLY[*]}"
`;
    const result = runShell("bash", script);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("DYNAMIC:run --target we");
  });
});

describe("generated shell scripts", () => {
  test("Bash output has valid syntax", () => {
    const result = checkSyntax("bash", generateCompletion(cli, "bash"));
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });

  test("Bash completes option values, inline values, and nested options", () => {
    const script = `${generateCompletion(cli, "bash")}
COMP_WORDS=(demo --mode "")
COMP_CWORD=2
_bun_clap_demo
printf 'VALUES:%s\n' "\${COMPREPLY[*]}"
COMP_WORDS=(demo --mode=d)
COMP_CWORD=1
_bun_clap_demo
printf 'INLINE:%s\n' "\${COMPREPLY[*]}"
COMP_WORDS=(demo run --t)
COMP_CWORD=2
_bun_clap_demo
printf 'NESTED:%s\n' "\${COMPREPLY[*]}"
`;
    const result = runShell("bash", script);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("VALUES:dev prod");
    expect(result.stdout).toContain("INLINE:--mode=dev");
    expect(result.stdout).toContain("NESTED:--target");
  });

  test("Zsh output has valid syntax", () => {
    const result = checkSyntax("zsh", generateCompletion(cli, "zsh"));
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });

  test("Fish and PowerShell use their native registration interfaces", () => {
    const fish = generateCompletion(cli, "fish");
    expect(fish).toContain("complete -c 'demo'");
    expect(fish).toContain("__fish_complete_directories");

    const powerShell = generateCompletion(cli, "powershell");
    expect(powerShell).toContain("Register-ArgumentCompleter -Native");
    expect(powerShell).toContain("System.Management.Automation.CompletionResult");
  });

  for (const shell of ["fish", "pwsh"] as const) {
    const executable = Bun.which(shell);
    test.skipIf(executable === null)(`${shell} output has valid syntax when installed`, () => {
      if (executable === null) return;
      const completionShell = shell === "pwsh" ? "powershell" : "fish";
      const result = checkSyntax(shell, generateCompletion(cli, completionShell));
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
    });
  }
});

function checkSyntax(shell: "bash" | "zsh" | "fish" | "pwsh", script: string) {
  const args = shell === "fish"
    ? [shell, "--no-execute"]
    : shell === "pwsh"
      ? [shell, "-NoProfile", "-NonInteractive", "-Command", "-"]
      : [shell, "-n"];
  return runShell(args, script);
}

function runShell(command: string | readonly string[], script: string) {
  const args = typeof command === "string" ? [command] : [...command];
  const result = Bun.spawnSync(args, {
    stdin: Buffer.from(script),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

async function withDynamicCompletion<Result>(
  callback: () => Promise<Result>,
): Promise<Result> {
  const previous = Bun.env[dynamicCompletionEnvironment];
  Bun.env[dynamicCompletionEnvironment] = "1";
  try {
    return await callback();
  } finally {
    if (previous === undefined) {
      delete Bun.env[dynamicCompletionEnvironment];
    } else {
      Bun.env[dynamicCompletionEnvironment] = previous;
    }
  }
}
