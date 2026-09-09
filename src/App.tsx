import { Component, type ErrorInfo, type ReactNode } from 'react';
import { DashboardFilters } from './components/DashboardFilters';
import { Shell } from './components/layout/Shell';
import { Button } from './components/ui/Controls';
import { ErrorState, LoadingState, SkeletonBlock } from './components/ui/States';
import { ComparePage } from './pages/ComparePage';
import { DashboardPage } from './pages/DashboardPage';
import { EmployeeAnalysisPage } from './pages/EmployeeAnalysisPage';
import { PendingTasksPage } from './pages/PendingTasksPage';
import { RawDataPage } from './pages/RawDataPage';
import { TeamPerformancePage } from './pages/TeamPerformancePage';
import { TrendsPage } from './pages/TrendsPage';
import { DataProvider, useData } from './state/DataContext';
import { FilterProvider } from './state/FilterContext';
import { ThemeProvider } from './state/ThemeContext';
import { RouterProvider, useRouter } from './state/router';
import { useAnalytics } from './state/useAnalytics';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Dashboard error', error, info); }
  render() {
    if (this.state.error) {
      return (
        <div className="p-6">
          <ErrorState message="The dashboard hit an unexpected problem while rendering this view." onRetry={() => { this.setState({ error: null }); }} />
          <div className="mt-3 text-center"><Button variant="ghost" size="sm" onClick={() => window.location.reload()}>Reload page</Button></div>
        </div>
      );
    }
    return this.props.children;
  }
}

function Content() {
  const { dataset, loading, error, load } = useData();
  const { route } = useRouter();
  const a = useAnalytics();

  if (loading && !dataset) {
    return (
      <div className="space-y-4">
        <LoadingState />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <SkeletonBlock key={i} className="h-20" />)}</div>
        <SkeletonBlock className="h-72" />
      </div>
    );
  }
  if (error && !dataset) return <ErrorState message={error} onRetry={() => void load(true)} />;
  if (!dataset || !a) return <ErrorState message="No data was returned by the data service." onRetry={() => void load(true)} />;

  if (dataset.records.length === 0) {
    return (
      <ErrorState
        message={dataset.meta.notes?.length ? `The DB sheet did not contain readable daily records. ${dataset.meta.notes.join(' ')}` : 'The DB sheet did not contain any readable daily records. Check that it has a header row with Date, Employee and call columns.'}
        onRetry={() => void load(true)}
      />
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#f3c7c7] bg-[#fbe4e4] px-4 py-2 text-xs text-[#8f1f1f] dark:border-[#5a2323] dark:bg-[#3d1717] dark:text-[#f08c8c]">
          <span>Refresh failed: {error} Showing the last successfully loaded data.</span>
          <Button size="sm" onClick={() => void load(true)}>Retry</Button>
        </div>
      )}
      {route.page !== 'pending' && <DashboardFilters />}
      <ErrorBoundary key={route.page + (route.param ?? '')}>
        {route.page === 'dashboard' && <DashboardPage a={a} />}
        {route.page === 'team' && <TeamPerformancePage a={a} />}
        {route.page === 'employee' && <EmployeeAnalysisPage a={a} employeeId={route.param} />}
        {route.page === 'compare' && <ComparePage a={a} initialId={route.param} />}
        {route.page === 'trends' && <TrendsPage a={a} />}
        {route.page === 'raw' && <RawDataPage a={a} />}
        {route.page === 'pending' && <PendingTasksPage pending={dataset.pending} />}
      </ErrorBoundary>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <RouterProvider>
        <DataProvider>
          <FilterProvider>
            <Shell>
              <ErrorBoundary>
                <Content />
              </ErrorBoundary>
            </Shell>
          </FilterProvider>
        </DataProvider>
      </RouterProvider>
    </ThemeProvider>
  );
}
