import * as React from 'react';
import { styled, GlobalStyles, lightTheme, ThemeProvider } from './upstream/theme';
import { Sidebar, type SidebarPage } from './upstream/Sidebar';

const PreviewApp = React.lazy(() => import('./workbench-preview/PreviewApp').then(module => ({
  default: module.PreviewApp,
})));

const CompatibleThemeProvider = ThemeProvider as unknown as React.ComponentType<{
  theme: typeof lightTheme;
  children: React.ReactNode;
}>;
const CompatibleGlobalStyles = GlobalStyles as unknown as React.ComponentType;

const AppContainer = styled.div`
  display: flex;
  height: 100%;

  > :not(:first-child) {
    flex: 1 1;
    width: calc(100% - 75px);
  }
`;

export function App() {
  const [selectedPage, setSelectedPage] = React.useState<SidebarPage>('view');
  return (
    <CompatibleThemeProvider theme={lightTheme}>
      <CompatibleGlobalStyles />
      <AppContainer>
        <Sidebar
          workbenchMode
          selectedPage={selectedPage}
          onNavigate={setSelectedPage}
        />
        <React.Suspense fallback={null}><PreviewApp page={selectedPage} /></React.Suspense>
      </AppContainer>
    </CompatibleThemeProvider>
  );
}
