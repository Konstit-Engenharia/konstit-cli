import { readFile } from 'node:fs/promises';
import {
  configEntryFile,
  setLoadedConfigFile,
  setMergedConfigFiles,
} from './origin.js';
import {
  validateConfigShape,
  type CommandConfig,
} from './shape.js';

/** Reads and validates a UTF-8 JSON command configuration file. */
export async function loadConfig(path: string | URL): Promise<CommandConfig> {
  const filename = JSON.stringify(String(path));
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch (cause) {
    throw new Error(`Could not read config file ${filename}. ${String(cause)}`, { cause });
  }

  let config: unknown;
  try {
    config = JSON.parse(source.replace(/^\uFEFF/, ''));
  } catch (cause) {
    throw new SyntaxError(`Invalid JSON in config file ${filename}. ${String(cause)}`, { cause });
  }

  try {
    validateConfigShape(config);
  } catch (cause) {
    throw new TypeError(`Invalid config file ${filename}. ${String(cause)}`, { cause });
  }
  const typedConfig = config as CommandConfig;
  setLoadedConfigFile(typedConfig, String(path));
  return typedConfig;
}

/** Loads JSON config files in order, with later files replacing earlier values at the same key. */
export async function loadConfigs(paths: readonly (string | URL)[]): Promise<CommandConfig> {
  let config: CommandConfig = {};
  for (const path of paths) {
    config = mergeConfigNodes(config, await loadConfig(path));
  }
  return config;
}

function mergeConfigNodes(base: CommandConfig, layer: CommandConfig): CommandConfig {
  const values = base.values === undefined && layer.values === undefined
    ? undefined
    : { ...base.values, ...layer.values };
  const children = new Map(Object.entries(base.subcommands ?? {}));
  for (const [name, node,] of Object.entries(layer.subcommands ?? {})) {
    const previous = children.get(name);
    children.set(name, previous === undefined ? node : mergeConfigNodes(previous, node));
  }
  const schema = layer.$schema ?? base.$schema;
  const config: CommandConfig = {
    ...(schema === undefined ? {} : { $schema: schema }),
    ...(values === undefined ? {} : { values }),
    ...(base.subcommands === undefined && layer.subcommands === undefined
      ? {}
      : { subcommands: Object.fromEntries(children) }),
  };
  const files = new Map<string, string>();
  for (const name of Object.keys(values ?? {})) {
    const owner = layer.values !== undefined && Object.hasOwn(layer.values, name) ? layer : base;
    const file = configEntryFile(owner, name);
    if (file !== undefined) {
      files.set(name, file);
    }
  }
  setMergedConfigFiles(config, files);
  return config;
}
