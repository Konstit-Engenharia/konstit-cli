import {
  command,
  option,
  parsers,
} from '../src';

const color = option('color', parsers.enum(['auto', 'never']), {
  default: 'auto',
});
command('consumer', {
  args: [color],
  handler: ({ color }) => ({ color: color satisfies 'auto' | 'never' }),
});

// @ts-expect-error undefined is not a valid string default
option('undefined-default', parsers.string, { default: undefined });

// @ts-expect-error required arguments cannot also have defaults
option('conflicting-presence', parsers.string, { required: true, default: undefined });

// @ts-expect-error undefined is not a valid string defaultMissing value
option('undefined-default-missing', parsers.string, { defaultMissing: undefined });
