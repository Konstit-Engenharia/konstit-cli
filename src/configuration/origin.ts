import type { CommandConfig } from './shape.js';

const configFiles = new WeakMap<CommandConfig, string | ReadonlyMap<string, string>>();

export function setLoadedConfigFile(config: CommandConfig, file: string): void {
  configFiles.set(config, file);
  for (const child of Object.values(config.subcommands ?? {})) {
    setLoadedConfigFile(child, file);
  }
}

export function configEntryFile(config: CommandConfig, name: string): string | undefined {
  const files = configFiles.get(config);
  return typeof files === 'string' ? files : files?.get(name);
}

export function setMergedConfigFiles(config: CommandConfig, files: ReadonlyMap<string, string>): void {
  configFiles.set(config, files);
}
