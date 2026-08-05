/*
 * Visual theme copied from HTTP Toolkit UI at commit
 * 66488157be993c88152bf0b5964cfa1c63e0fbf5.
 * Upstream license: AGPL-3.0-or-later.
 */
import styledComponents, {
  createGlobalStyle,
  css,
  ThemeProvider,
  type DefaultTheme,
} from 'styled-components';
import reset from 'styled-reset';

import '@fontsource/dm-sans';
import '@fontsource/dm-mono';
import '@fontsource/saira';

const fontSizes = {
  smallPrintSize: '12px',
  textInputFontSize: '13px',
  textSize: '14.5px',
  subHeadingSize: '17px',
  headingSize: '20px',
  largeHeadingSize: '24px',
  loudHeadingSize: '38px',
  screamingHeadingSize: '80px',
};

export const lightTheme = {
  fontFamily: '"DM Sans", Arial, sans-serif',
  titleTextFamily: 'Saira, "DM Sans", Arial, sans-serif',
  monoFontFamily: '"DM Mono", monospace',
  mainBackground: '#fafafa',
  mainLowlightBackground: '#f2f2f2',
  mainColor: '#1e2028',
  mainLowlightColor: '#53565e',
  highlightBackground: '#ffffff',
  highlightColor: '#1e2028',
  lowlightTextOpacity: 0.65,
  boxShadowAlpha: 0.3,
  pillContrast: 0.9,
  pillDefaultColor: '#9a9da8',
  primaryInputBackground: '#2d4cbd',
  primaryInputColor: '#ffffff',
  secondaryInputBorder: '#6284fa',
  secondaryInputColor: '#2d4cbd',
  inputBackground: '#ffffff',
  inputHoverBackground: '#f2f2f2',
  inputBorder: '#53565e',
  inputColor: '#1e2028',
  inputPlaceholderColor: '#53565e',
  inputWarningPlaceholder: '#8c5c1d',
  popColor: '#e1421f',
  popOverlayColor: '#ffffff',
  warningColor: '#f1971f',
  warningBackground: '#f1971f40',
  containerBackground: '#e4e8ed',
  containerWatermark: '#818490',
  containerBorder: '#9a9da8',
  linkColor: '#0000EE',
  visitedLinkColor: '#551A8B',
  editorBackground: '#ffffff',
  ...fontSizes,
} as const;

export type PrototypeTheme = typeof lightTheme;

declare module 'styled-components' {
  export interface DefaultTheme extends PrototypeTheme {}
}

export const styled = styledComponents;
export { css, ThemeProvider };
export type { DefaultTheme };

export const GlobalStyles = createGlobalStyle`
  ${reset};

  * {
    box-sizing: border-box;
  }

  html, body, #root {
    width: 100%;
    height: 100%;
    margin: 0;
    overflow: hidden;
  }

  body {
    font-family: ${p => p.theme.fontFamily};
    color: ${p => p.theme.mainColor};
    background-color: ${p => p.theme.containerBackground};
  }

  input, button {
    font-family: ${p => p.theme.fontFamily};
  }

  button {
    color: inherit;
  }

  :active {
    outline: none;
  }

  .phosphor-icon {
    vertical-align: -0.125em;
  }
`;
