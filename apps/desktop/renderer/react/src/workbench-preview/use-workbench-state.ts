import * as React from 'react';
import type { WorkbenchState } from './workbench-data';

export interface WorkbenchConnection {
  state: WorkbenchState | null;
  loading: boolean;
  bridgeAvailable: boolean;
  openProject(): Promise<void>;
  refresh(): Promise<WorkbenchState | null>;
}

export function useWorkbenchState(): WorkbenchConnection {
  const bridge = window.workbench;
  const [state, setState] = React.useState<WorkbenchState | null>(null);
  const [loading, setLoading] = React.useState(Boolean(bridge));

  React.useEffect(() => {
    if (!bridge) return;
    let active = true;
    const unsubscribe = bridge.onState(next => {
      if (active) {
        setState(next);
        setLoading(false);
      }
    });
    void bridge.getState()
      .then(next => {
        if (active) setState(next);
      })
      .catch(error => {
        if (!active) return;
        setState(emptyState(error instanceof Error ? error.message : 'Unable to read project state.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge]);

  const openProject = React.useCallback(async () => {
    if (!bridge) return;
    setLoading(true);
    try {
      setState(await bridge.openProject());
    } catch (error) {
      setState(current => ({
        ...(current ?? emptyState(null)),
        error: error instanceof Error ? error.message : 'Unable to open the project.',
      }));
    } finally {
      setLoading(false);
    }
  }, [bridge]);

  const refresh = React.useCallback(async () => {
    if (!bridge) return state;
    setLoading(true);
    try {
      const next = await bridge.refresh();
      setState(next);
      return next;
    } catch (error) {
      setState(current => ({
        ...(current ?? emptyState(null)),
        error: error instanceof Error ? error.message : 'Unable to refresh project activity.',
      }));
      return null;
    } finally {
      setLoading(false);
    }
  }, [bridge, state]);

  return {
    state,
    loading,
    bridgeAvailable: Boolean(bridge),
    openProject,
    refresh,
  };
}

function emptyState(error: string | null): WorkbenchState {
  return {
    projectRoot: null,
    turns: [],
    error,
    observation: null,
    adapters: {},
    sources: {},
    files: {},
    fileBus: {
      status: 'idle',
      directory: null,
      lastRefreshAt: null,
      error: null,
    },
  };
}
