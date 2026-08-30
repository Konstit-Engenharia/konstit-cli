/** A generated consumer used for local TypeScript diagnostics. */
export interface TypecheckScenario {
  readonly name: string;
  readonly source: string;
}

const header = `
import { command, flag, option, parsers, type Infer } from '@konstit/cli';
import { generateCompletion } from '@konstit/cli/completion';

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Expect<Value extends true> = Value;
`;

function argumentScenario(count: number): TypecheckScenario {
  const argumentsSource = Array.from(
    { length: count },
    (_, index) => `    option('arg${index}', parsers.string),`,
  ).join('\n');
  const properties = Array.from(
    { length: count },
    (_, index) => `  readonly arg${index}: string | undefined;`,
  ).join('\n');
  return {
    name: `args-${count}`,
    source: `${header}
const cli = command('arguments-${count}', {
  args: [
${argumentsSource}
  ],
});
type Actual = Infer<typeof cli>;
type Expected = {
${properties}
};
type Result = Expect<Equal<Actual, Expected>>;
const completion: string = generateCompletion(cli, 'bash');
void (null as unknown as Result);
void completion;
`,
  };
}

function subcommandsScenario(): TypecheckScenario {
  const children = Array.from({ length: 12 }, (_, childIndex) => {
    const childArguments = Array.from(
      { length: 8 },
      (_, argumentIndex) => `    option('value${argumentIndex}', parsers.string),`,
    ).join('\n');
    return `const child${childIndex} = command('child${childIndex}', {
  args: [
${childArguments}
  ],
});`;
  }).join('\n');
  const childNames = Array.from(
    { length: 12 },
    (_, index) => `child${index}`,
  ).join(', ');
  return {
    name: 'subcommands',
    source: `${header}
${children}
const cli = command('subcommands', {
  args: [flag('verbose')],
  subcommands: [${childNames}],
  subcommandRequired: true,
});
type Result = Infer<typeof cli>;
declare const result: Result;
const selected: string = result.subcommand.name;
void selected;
`,
  };
}

function nestingScenario(): TypecheckScenario {
  const levels = Array.from({ length: 10 }, (_, reverseIndex) => 9 - reverseIndex)
    .map((level) => {
      const child = level === 9 ? '' : `, subcommands: [level${level + 1}]`;
      return `const level${level} = command('level${level}', { args: [option('value${level}') ]${child} });`;
    })
    .join('\n');
  return {
    name: 'nesting',
    source: `${header}
${levels}
const cli = command('nested', { subcommands: [level0], subcommandRequired: true });
type Result = Infer<typeof cli>;
declare const result: Result;
const first: 'level0' = result.subcommand.name;
void first;
`,
  };
}

function complexScenario(): TypecheckScenario {
  const argumentCount = 100;
  const argumentsSource = Array.from({ length: argumentCount }, (_, index) => {
    return index % 5 === 0
      ? `    flag('arg${index}'),`
      : `    option('arg${index}', parsers.string),`;
  }).join('\n');
  const requires = Array.from(
    { length: argumentCount - 1 },
    (_, index) => `    ['arg${index}', 'arg${index + 1}'],`,
  ).join('\n');
  const conditional = Array.from(
    { length: argumentCount / 5 },
    (_, index) => `    { conditions: [['arg${index * 5}', true]], target: 'arg${index * 5 + 1}' },`,
  ).join('\n');
  const groups = Array.from({ length: argumentCount / 5 }, (_, index) => {
    const first = index * 5;
    return `    {
      name: 'group${index}',
      members: ['arg${first}', 'arg${first + 1}', 'arg${first + 2}', 'arg${first + 3}', 'arg${first + 4}'],
      multiple: true,
      requires: ['arg${(first + 6) % argumentCount}'],
      conflicts: ['arg${(first + 7) % argumentCount}'],
    },`;
  }).join('\n');
  return {
    name: 'complex-relations-groups',
    source: `${header}
const cli = command('complex', {
  args: [
${argumentsSource}
  ],
  requires: [
${requires}
  ],
  requiredIfAny: [
${conditional}
  ],
  groups: [
${groups}
  ],
});
type Result = Infer<typeof cli>;
declare const result: Result;
const first: boolean = result.arg0;
const last: string | undefined = result.arg99;
void [first, last];
`,
  };
}

export const typecheckScenarios: readonly TypecheckScenario[] = [
  {
    name: 'baseline',
    source: `${header}
const cli = command('baseline');
type Result = Infer<typeof cli>;
void (null as unknown as Result);
`,
  },
  argumentScenario(10),
  argumentScenario(50),
  argumentScenario(100),
  argumentScenario(250),
  subcommandsScenario(),
  nestingScenario(),
  complexScenario(),
];
