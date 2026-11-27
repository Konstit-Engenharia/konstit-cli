import type { CompletionShell } from './shell.js';
import bashTemplate from './templates/bash.txt' with { type: 'text' };
import bourneDefaultTemplate from './templates/bourne-default.txt' with { type: 'text' };
import fishTemplate from './templates/fish.txt' with { type: 'text' };
import powerShellTemplate from './templates/powershell.txt' with { type: 'text' };
import zshTemplate from './templates/zsh.txt' with { type: 'text' };

const completionTemplates: Readonly<Record<CompletionShell, string>> = Object.freeze({
  bash: bashTemplate,
  zsh: zshTemplate,
  fish: fishTemplate,
  powershell: powerShellTemplate,
});

const blockTemplatePlaceholder = /^\{\{([A-Z_]+)\}\}\n/gm;
const templatePlaceholder = /\{\{([A-Z_]+)\}\}/g;

/** The PowerShell expression that preserves command parameter spelling. */
export const powerShellArgvWord =
  'if ($_ -is [System.Management.Automation.Language.CommandParameterAst]) { $_.Extent.Text } else { [string]$_.Value }';

export const bourneDefaultRouting = bourneDefaultTemplate.trimEnd();

/** Replaces generated completion sections in a shell template. */
export function renderTemplate(
  shell: CompletionShell,
  replacements: Readonly<Record<string, string>>,
): string {
  const replace = (placeholder: string, name: string): string => {
    return replacements[name] ?? placeholder;
  };
  const blocksRendered = completionTemplates[shell].replace(
    blockTemplatePlaceholder,
    (placeholder, name: string) => {
      const replacement = replace(placeholder, name);
      return replacement.length === 0 ? '' : `${replacement}\n`;
    },
  );
  return blocksRendered.replace(templatePlaceholder, replace);
}
