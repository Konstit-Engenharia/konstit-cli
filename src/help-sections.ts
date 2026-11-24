/** A contiguous group of arguments rendered under one documentation heading. */
export interface HelpArgumentGroup<Argument> {
  readonly heading: string;
  readonly arguments: readonly Argument[];
}

/**
 * Groups arguments by their configured heading while retaining first-seen order.
 * The default heading may depend on an argument kind so positional and named
 * arguments keep their historical sections when no custom heading is used.
 */
export function groupHelpArguments<
  Argument extends { readonly helpHeading?: string; },
>(
  argumentsToGroup: readonly Argument[],
  defaultHeading: string | ((argument: Argument) => string),
): readonly HelpArgumentGroup<Argument>[] {
  const groups: Array<{ readonly heading: string; readonly arguments: Argument[]; }> = [];
  const byHeading = new Map<string, Argument[]>();
  for (const argument of argumentsToGroup) {
    const heading = argument.helpHeading
      ?? (typeof defaultHeading === 'function' ? defaultHeading(argument) : defaultHeading);
    let group = byHeading.get(heading);
    if (group === undefined) {
      group = [];
      byHeading.set(heading, group);
      groups.push({ heading, arguments: group });
    }
    group.push(argument);
  }
  return groups;
}
