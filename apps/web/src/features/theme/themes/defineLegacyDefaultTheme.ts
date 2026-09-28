import type { ThemeV2, ThemeV2Tokens, ThemeV3 } from '../types/themeTypes';
import {
  getThemeColorMode,
  legacyThemeToVNextTokens,
} from '../utils/themeColorTokens';

type LegacyDefaultThemeDefinition<TId extends string> = {
  id: TId;
  name?: string;
  tokens: ThemeV2Tokens;
  overrides?: ThemeV2['overrides'];
};

/** Converts a temporary legacy ramp definition into a token-only built-in. */
export function defineLegacyDefaultTheme<const TId extends string>(
  definition: LegacyDefaultThemeDefinition<TId>
): ThemeV3 & { id: TId } {
  const mode = getThemeColorMode(definition.tokens);
  return {
    id: definition.id,
    name: definition.name ?? definition.id,
    version: 3,
    mode,
    colorTokens: legacyThemeToVNextTokens(definition, mode),
  };
}
