import type { ArgumentDefinition } from '../../argument/index.js';
import type { DeprecationWarning } from '../../result/deprecation.js';
import type { ParseDisplay } from '../../result/error.js';
import type { Environment } from '../environment.js';
import type { CommandDefinition } from '../schema.js';
import type { RelationState } from './relations.js';

/** Signals that parsing produced a help or version display. */
export class DisplayRequest {
  constructor(readonly outcome: ParseDisplay) {}
}

export type ColorMode = 'auto' | 'always' | 'never';

export interface ParseSessionData {
  readonly defaultColor: boolean;
  readonly env: Environment;
  readonly warnings: DeprecationWarning[];
  colorMode?: ColorMode;
}

export interface CollectingParseSession extends ParseSessionData {
  readonly validation: {
    readonly phase: 'collecting';
    readonly validators: Array<() => void>;
  };
}

export interface RunningParseSession extends ParseSessionData {
  readonly validation: {
    readonly phase: 'running';
    readonly validators: readonly (() => void)[];
  };
}

export interface CompleteParseSession extends ParseSessionData {
  readonly validation: {
    readonly phase: 'complete';
  };
}

export interface ParseState extends RelationState {
  readonly session: CollectingParseSession;
  positionalIndex: number;
  subcommand?: { readonly name: string; readonly args: Record<string, unknown>; };
}

export interface SubcommandConflict {
  readonly argument: ArgumentDefinition;
  readonly tokenIndex: number | undefined;
}

export interface GlobalBinding {
  readonly argument: ArgumentDefinition;
  readonly definition: CommandDefinition;
  readonly state: ParseState;
}
