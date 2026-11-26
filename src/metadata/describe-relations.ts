import type { CommandDefinition } from '../command/schema.js';
import type {
  CommandMetadata,
  ConditionalRequirementMetadata,
  RequiredUnlessMetadata,
} from './types.js';
import { toMetadataValue } from './value.js';

export function describeRelations(
  definition: CommandDefinition,
  visibleArguments: ReadonlySet<string>,
  includeHidden: boolean,
): Pick<
  CommandMetadata,
  | 'requirements'
  | 'conditionalRequirements'
  | 'requiresValue'
  | 'defaultIf'
  | 'conditionalSetRequirements'
  | 'requiredUnless'
  | 'requiredUnlessAll'
  | 'exclusiveArguments'
  | 'overrides'
  | 'conflicts'
  | 'groups'
> {
  const isVisible = (name: string): boolean => includeHidden || visibleArguments.has(name);
  const sensitive = new Set(definition.arguments.filter((argument) => argument.sensitive).map(({ name }) => name));
  const requirements = definition.requirements
    .filter(({ source, target }) => isVisible(source) && isVisible(target))
    .map(({ source, target }) => Object.freeze({ source, target }));
  const defaultIf = definition.defaultIf
    .filter(({ source, target }) => isVisible(source) && isVisible(target) && !sensitive.has(target))
    .map(({ source, target, hasEquals, equals, value }) => {
      const safeEquals = hasEquals && !sensitive.has(source) ? toMetadataValue(equals) : undefined;
      const safeValue = toMetadataValue(value);
      return Object.freeze({
        source,
        target,
        hasEquals,
        ...(safeEquals === undefined ? {} : { equals: safeEquals }),
        ...(safeValue === undefined ? {} : { value: safeValue }),
      });
    });
  function describeExpectedValues(
    rules: CommandDefinition['conditionalRequirements'],
    valueArgument: 'source' | 'target',
  ): readonly ConditionalRequirementMetadata[] {
    return Object.freeze(
      rules
        .filter(({ source, target }) => isVisible(source) && isVisible(target))
        .map((rule) => {
          const { source, target, expected, valueCount } = rule;
          const safeExpected = sensitive.has(rule[valueArgument]) ? undefined : toMetadataValue(expected);
          return Object.freeze({
            source,
            target,
            ...(safeExpected === undefined ? {} : { expected: safeExpected }),
            ...(valueCount === undefined ? {} : { valueCount }),
          });
        }),
    );
  }
  const conditionalSetRequirements = definition.conditionalSetRequirements
    .map(({ target, conditions, match }) => {
      if (!isVisible(target) || conditions.some(({ source }) => !isVisible(source))) {
        return undefined;
      }
      return Object.freeze({
        target,
        conditions: Object.freeze(
          conditions.map(({ source, expected }) => {
            const safeExpected = sensitive.has(source) ? undefined : toMetadataValue(expected);
            return Object.freeze({
              source,
              ...(safeExpected === undefined ? {} : { expected: safeExpected }),
            });
          }),
        ),
        match,
      });
    })
    .filter((relation): relation is NonNullable<typeof relation> => relation !== undefined);
  const requiredUnless = describeRequiredUnless(
    definition.requiredUnless,
    isVisible,
  );
  const requiredUnlessAll = describeRequiredUnless(
    definition.requiredUnlessAll,
    isVisible,
  );
  const exclusiveArguments = definition.exclusiveArguments.every(isVisible)
    ? definition.exclusiveArguments
    : [];
  const overrides = definition.overrides
    .filter(({ source, target }) => isVisible(source) && isVisible(target))
    .map(({ source, target }) => Object.freeze({ source, target }));
  const conflicts = definition.conflicts
    .filter((conflict) => conflict.every(isVisible))
    .map((conflict) => Object.freeze([...conflict]));
  const groups = definition.groups
    .map((group) => {
      if (
        !group.members.every(isVisible)
        || !group.requires.every(isVisible)
        || !group.conflicts.every(isVisible)
      ) {
        return undefined;
      }
      return Object.freeze({
        name: group.name,
        members: Object.freeze([...group.members]),
        required: group.required,
        multiple: group.multiple,
        requires: Object.freeze([...group.requires]),
        conflicts: Object.freeze([...group.conflicts]),
      });
    })
    .filter((group): group is NonNullable<typeof group> => group !== undefined);
  return {
    requirements: Object.freeze(requirements),
    defaultIf: Object.freeze(defaultIf),
    conditionalRequirements: describeExpectedValues(definition.conditionalRequirements, 'source'),
    requiresValue: describeExpectedValues(definition.requiresValue, 'target'),
    conditionalSetRequirements: Object.freeze(conditionalSetRequirements),
    requiredUnless: Object.freeze(requiredUnless),
    requiredUnlessAll: Object.freeze(requiredUnlessAll),
    exclusiveArguments: Object.freeze([...exclusiveArguments]),
    overrides: Object.freeze(overrides),
    conflicts: Object.freeze(conflicts),
    groups: Object.freeze(groups),
  };
}

function describeRequiredUnless(
  relations: readonly { readonly target: string; readonly alternatives: readonly string[]; }[],
  isVisible: (name: string) => boolean,
): readonly RequiredUnlessMetadata[] {
  return relations.flatMap(({ target, alternatives }) => {
    return isVisible(target) && alternatives.length > 0 && alternatives.every(isVisible)
      ? [Object.freeze({
        target,
        alternatives: Object.freeze([...alternatives]),
      })]
      : [];
  });
}
