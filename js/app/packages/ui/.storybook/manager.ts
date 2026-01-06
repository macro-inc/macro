import { addons } from 'storybook/manager-api';
import { create } from 'storybook/theming';

addons.setConfig({
  theme: create({
    base: 'dark',
    brandTitle: 'Macro UI',
    brandUrl: 'https://macro.com',
    brandImage: 'https://macro.com/app/macro-favicon.svg',

    // Typography
    fontBase: '"Forma Macro", sans-serif',
    fontCode: '"Forma Macro Mono", monospace',

    // Color
    colorPrimary: '#75fb81',
    colorSecondary: '#75fb81',

    // UI
    appBg: '#030303',
    appContentBg: '#1b1b1b',
    appPreviewBg: '#242424',
    appBorderColor: '#242424',
    appBorderRadius: 0,

    // Text colors
    textColor: '#f2f2f2',
    textInverseColor: '#030303',

    // Toolbar default and active colors
    barTextColor: '#5d5d5d',
    barSelectedColor: '#75fb8133',
    barHoverColor: '#75fb81',
    barBg: '#030303',

    // Form colors
    inputBg: '#030303',
    inputBorder: '#5d5d5d',
    inputTextColor: '#cecece',
    inputBorderRadius: 0,
  }),
});
