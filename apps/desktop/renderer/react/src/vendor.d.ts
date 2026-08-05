declare module 'react-virtualized-auto-sizer' {
  import type * as React from 'react';
  const AutoSizer: React.ComponentType<{
    children(size: { height: number; width: number }): React.ReactNode;
  }>;
  export default AutoSizer;
}
