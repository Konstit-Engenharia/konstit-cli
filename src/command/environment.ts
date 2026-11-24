export type Environment = Readonly<Record<string, string | undefined>>;

export function readEnv(env: Environment, name: string): string | undefined {
  return Object.hasOwn(env, name) ? env[name] : undefined;
}
