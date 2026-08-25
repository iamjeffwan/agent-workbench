import * as React from 'react';
import { styled, GlobalStyles, lightTheme, ThemeProvider } from './upstream/theme';
import { Sidebar, type SidebarPage } from './upstream/Sidebar';
import { ModelSettingsPage } from './workbench-preview/ModelSettingsPage';
import { useWorkbenchState } from './workbench-preview/use-workbench-state';
import { OptimizationPage } from './workbench-preview/OptimizationPage';

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

const ActivityCenter = styled.aside`
  position: fixed;
  z-index: 1200;
  right: 18px;
  bottom: 18px;
  width: min(340px, calc(100vw - 110px));
  padding: 11px 13px;
  border: 1px solid ${p => p.theme.containerBorder};
  border-left: 5px solid ${p => p.theme.popColor};
  border-radius: 4px;
  background: ${p => p.theme.mainBackground};
  box-shadow: 0 4px 20px rgba(0,0,0,0.18);
  h2 { margin: 0 0 7px; font-size: 14px; }
  p { margin: 4px 0; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  button { float: right; border: 0; background: transparent; cursor: pointer; }
`;

export function App() {
  const [selectedPage, setSelectedPage] = React.useState<SidebarPage>('view');
  const [activityVisible, setActivityVisible] = React.useState(true);
  const [acknowledgedActivities, setAcknowledgedActivities] = React.useState<Set<string>>(() => new Set());
  const connection = useWorkbenchState();
  const visibleActivities = connection.taskActivities.filter(change => !acknowledgedActivities.has(activityKey(change)));
  const dailyReminders = connection.dailyReviewSchedule?.reminders ?? [];
  const working = visibleActivities.filter(change => change.task.status === 'queued' || change.task.status === 'generating');
  const failed = visibleActivities.filter(change => change.task.status === 'failed');
  const ready = visibleActivities.filter(change => change.task.status === 'ready');
  const badge = failed.length > 0
    ? { count: failed.length, tone: 'failed' as const }
    : working.length > 0
      ? { count: working.length, tone: 'working' as const }
      : ready.length > 0 ? { count: ready.length, tone: 'ready' as const } : null;
  React.useEffect(() => {
    if (visibleActivities.length > 0) setActivityVisible(true);
  }, [connection.taskActivities]);
  const acknowledgeActivities = React.useCallback(() => {
    setAcknowledgedActivities(current => new Set([
      ...current,
      ...connection.taskActivities.map(activityKey),
    ]));
    setActivityVisible(false);
  }, [connection.taskActivities]);
  const navigate = React.useCallback((page: SidebarPage) => {
    setSelectedPage(page);
    if (page === 'library') acknowledgeActivities();
  }, [acknowledgeActivities]);
  return (
    <CompatibleThemeProvider theme={lightTheme}>
      <CompatibleGlobalStyles />
      <AppContainer>
        <Sidebar
          workbenchMode
          selectedPage={selectedPage}
          onNavigate={navigate}
          libraryBadge={badge}
        />
        {selectedPage === 'settings'
          ? <ModelSettingsPage />
          : selectedPage === 'prompts'
            ? <OptimizationPage projectRoot={connection.state?.projectRoot ?? null} listPrompts={connection.listTemporaryPrompts} hidePrompt={connection.hideTemporaryPrompt} listIssues={connection.listOptimizationIssues} getIssue={connection.getOptimizationIssue} retry={connection.retryOptimizationIssues} reassign={connection.reassignOptimizationDailyIssue} merge={connection.mergeOptimizationIssues} />
          : <React.Suspense fallback={null}><PreviewApp page={selectedPage} onNavigate={navigate} /></React.Suspense>}
        {activityVisible && visibleActivities.length > 0 ? <ActivityCenter aria-label="Task activity">
          <button onClick={acknowledgeActivities} aria-label="Dismiss task activity">×</button>
          <h2>Task activity</h2>
          {visibleActivities.slice(0, 4).map(({ task }) => <p key={task.id} title={task.title}>{task.status.toUpperCase()} · {task.title}</p>)}
        </ActivityCenter> : null}
        {dailyReminders.length > 0 ? <ActivityCenter aria-label="Daily review reminders" style={{ bottom: 18 + (visibleActivities.length > 0 ? 150 : 0) }}>
          <h2>Daily review</h2>
          {dailyReminders.slice(0, 4).map(reminder => <p key={`${reminder.projectRoot}:${reminder.localDate}`} title={reminder.projectRoot}>
            {reminder.localDate} · {reminder.projectRoot}
            <button type="button" onClick={() => { void connection.runPendingDailyReview(reminder.projectRoot, reminder.localDate); }}>Run</button>
            <button type="button" onClick={() => { void connection.snoozeDailyReview(reminder.projectRoot, reminder.localDate); }}>Later</button>
          </p>)}
        </ActivityCenter> : null}
      </AppContainer>
    </CompatibleThemeProvider>
  );
}

function activityKey(change: { task: { id: string }; reason: string }): string {
  return `${change.task.id}:${change.reason}`;
}
