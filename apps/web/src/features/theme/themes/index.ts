import type { ThemeV3 } from '../types/themeTypes';
import { decepticonTheme } from './decepticon';
import { emberTheme } from './ember';
import { floraTheme } from './flora';
import { lapisTheme } from './lapis';
import { macroDarkTheme } from './macro-dark';
import { macroGruvboxTheme } from './macro-gruvbox';
import { macroLightTheme } from './macro-light';
import { moonTheme } from './moon';
import { paperTheme } from './paper';
import { rainTheme } from './rain';
import { satsumaTheme } from './satsuma';
import { spiritTheme } from './spirit';
import { voidTheme } from './void';

// Ordered for the theme picker: dark themes first (led by Macro Dark), then
// light themes (led by Macro Light).
export const DEFAULT_THEMES = [
  macroDarkTheme,
  macroGruvboxTheme,
  voidTheme,
  emberTheme,
  spiritTheme,
  moonTheme,
  rainTheme,
  macroLightTheme,
  satsumaTheme,
  lapisTheme,
  floraTheme,
  paperTheme,
  decepticonTheme,
] satisfies ThemeV3[];
