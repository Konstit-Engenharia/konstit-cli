import {
  command,
  completionShells,
  flag,
  option,
  parsers,
  positional,
  type CompletionShell,
  type Infer,
} from "../src";
import {
  generateCompletion,
} from "../src/completion";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Expect<Value extends true> = Value;

const typedCli = command("deploy")
  .arg(option("port", parsers.integer).required())
  .arg(option("mode", parsers.enum(["dev", "prod"])).default("dev"))
  .arg(option("labels").repeatable())
  .arg(flag("verbose"))
  .arg(positional("directory"))
  .subcommand(
    command("init").arg(flag("bare")),
  )
  .subcommand(
    command("remote").arg(positional("url").required()),
  )
  .requireSubcommand();

type Actual = Infer<typeof typedCli>;
type Expected = {
  readonly port: number;
  readonly mode: "dev" | "prod";
  readonly labels: readonly string[];
  readonly verbose: boolean;
  readonly directory: string | undefined;
  readonly subcommand:
    | { readonly name: "init"; readonly args: { readonly bare: boolean } }
    | { readonly name: "remote"; readonly args: { readonly url: string } };
};

type _ResultIsExact = Expect<Equal<Actual, Expected>>;

const parsedOutcome = typedCli.parse(["--port", "3000", "init"]);
if (parsedOutcome.type !== "value") throw new Error("expected parsed arguments");
const parsed = parsedOutcome.value;
const port: number = parsed.port;
const mode: "dev" | "prod" = parsed.mode;
const labels: readonly string[] = parsed.labels;
void [port, mode, labels];

switch (parsed.subcommand.name) {
  case "init": {
    const bare: boolean = parsed.subcommand.args.bare;
    void bare;
    break;
  }
  case "remote": {
    const url: string = parsed.subcommand.args.url;
    void url;
    break;
  }
}

const unique = command("unique").arg(flag("verbose"));
const related = command("related").arg(flag("one")).arg(flag("two"));
const shell: CompletionShell = completionShells[0];
const completionScript: string = generateCompletion(typedCli, shell);
void completionScript;

const advanced = command("advanced")
  .arg(option("pair").numArgs(2).required())
  .arg(option("points", parsers.integer).numArgs(2).repeatable())
  .arg(option("values", parsers.integer).numArgs({ min: 1, max: 3 }))
  .arg(option("mode", parsers.enum(["fast", "safe"])).defaultMissing("safe"))
  .arg(positional("command").trailingVarArg());
const advancedOutcome = advanced.parse(["--pair", "left", "right"]);
if (advancedOutcome.type !== "value") throw new Error("expected parsed arguments");
const advancedResult = advancedOutcome.value;
const pair: readonly [string, string] = advancedResult.pair;
const points: readonly number[] = advancedResult.points;
const values: readonly number[] | undefined = advancedResult.values;
const advancedMode: "fast" | "safe" | undefined = advancedResult.mode;
const trailingCommand: readonly string[] = advancedResult.command;
void [pair, points, values, advancedMode, trailingCommand];

const conditional = command("conditional")
  .arg(option("mode", parsers.enum(["dev", "prod"])))
  .arg(option("config"))
  .arg(flag("offline"))
  .requiresIf("mode", "prod", "config")
  .requiredUnlessPresent(["offline"], "config")
  .overrides("offline", "config");

const handlerBase = command("handler")
  .arg(option("port", parsers.integer).required())
  .arg(option("mode", parsers.enum(["dev", "prod"])).default("dev"))
  .arg(flag("verbose"));
const handlerCommand = handlerBase.handler((args) => {
  type _HandlerArgsAreExact = Expect<Equal<typeof args, Infer<typeof handlerBase>>>;
  const { port, mode, verbose } = args;
  const typedPort: number = port;
  const typedMode: "dev" | "prod" = mode;
  const typedVerbose: boolean = verbose;
  void [typedPort, typedMode, typedVerbose];
  return 4;
});
type _HandlerKeepsCommandResult = Expect<
  Equal<Infer<typeof handlerCommand>, Infer<typeof handlerBase>>
>;

const asyncHandlerCommand = command("async-handler")
  .arg(positional("file").required())
  .handler(async ({ file }) => file === "ok" ? 0 : 1);

const nestedHandler = command("serve")
  .arg(option("port", parsers.integer).required())
  .handler(({ port }) => {
    const typedPort: number = port;
    void typedPort;
  });
const handlerRoot = command("tool")
  .arg(flag("verbose"))
  .subcommand(nestedHandler)
  .handler(({ verbose }) => {
    const typedVerbose: boolean = verbose;
    void typedVerbose;
  });

if (false) {
  const defaultArgvExitCode: Promise<number> = handlerCommand.run();
  const syncExitCode: Promise<number> = handlerCommand.run(["--port", "3000"]);
  const asyncExitCode: Promise<number> = asyncHandlerCommand.run(["ok"]);
  const nestedExitCode: Promise<number> = handlerRoot.run(["serve", "--port", "3000"]);
  void [defaultArgvExitCode, syncExitCode, asyncExitCode, nestedExitCode];
  // @ts-expect-error parse requires explicit argv
  typedCli.parse();
  // @ts-expect-error tryParse requires explicit argv
  typedCli.tryParse();
  // @ts-expect-error handler arguments only contain configured fields
  command("bad-handler").arg(flag("verbose")).handler(({ missing }) => missing);
  // @ts-expect-error handlers return void or a numeric exit code
  command("bad-exit").handler(() => "failure");
  // @ts-expect-error handlers are a terminal schema step
  handlerCommand.arg(flag("late"));
  // @ts-expect-error subcommands must be registered before a handler
  handlerCommand.subcommand(command("late"));
  // @ts-expect-error duplicate argument names are rejected
  unique.arg(flag("verbose"));
  // @ts-expect-error relation names must refer to declared arguments
  related.requires("one", "missing");
  // @ts-expect-error group names must refer to declared arguments
  related.group("bad", ["one", "missing"]);
  // @ts-expect-error a short option is exactly one character
  flag("verbose").short("vv");
  // @ts-expect-error repeatable values always use an empty-array fallback
  option("tag").repeatable().default("latest");
  // @ts-expect-error flags cannot collect values
  flag("verbose").repeatable();
  // @ts-expect-error positionals cannot have option names
  positional("file").short("f");
  // @ts-expect-error completion shells are a closed union
  generateCompletion(typedCli, "nu");
  // @ts-expect-error flags do not consume values
  flag("verbose").valueHint("file");
  // @ts-expect-error value hints are a closed union
  option("database").valueHint("database");
  // @ts-expect-error conditional relation values match the source parser
  conditional.requiresIf("mode", "preview", "config");
  // @ts-expect-error conditional relation names must exist
  conditional.requiredUnlessPresent(["offline"], "missing");
  // @ts-expect-error global positional arguments are not supported
  positional("file").global();
}
