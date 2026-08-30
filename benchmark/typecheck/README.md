# Type-check benchmark

This benchmark compiles generated consumers against the real package tarball.
It covers a baseline, 10/50/100/250 arguments, subcommands, nesting, and a
relation/group-heavy command.

Run `bun run benchmark:types`. The command checks deterministic TypeScript
instantiation limits and writes full `extendedDiagnostics` data to
`reports/typecheck-benchmark.json`. Time and memory are reported but do not
fail the build.

After an intentional type-level change, review the result and run
`bun run benchmark:types:update` to accept the new instantiation counts.
