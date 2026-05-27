import { useEffect, useState } from 'react';
import { HomeView } from './views/HomeView';
import { ProjectView } from './views/ProjectView';
import { MetricsView } from './views/MetricsView';
import { GlobalView } from './views/GlobalView';
import { DoctorView } from './views/DoctorView';

// Tiny hash-based router. No external dep. Routes:
//   #/           → HomeView (cross-project landing)
//   #/global     → GlobalView (cross-project learnings pool)
//   #/p/:id      → ProjectView (learnings list + metrics)
//   #/p/:id/metrics → MetricsView (full compounding ROI)
function useHashRoute(): string {
  const [hash, setHash] = useState<string>(window.location.hash || '#/');
  useEffect(() => {
    const onChange = (): void => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

export function App() {
  const route = useHashRoute();
  return (
    <div style={{ minHeight: '100vh' }}>
      <Nav route={route} />
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '2.5rem 1.5rem' }}>
        {renderRoute(route)}
      </main>
    </div>
  );
}

function renderRoute(route: string): React.ReactElement {
  if (route === '#/' || route === '') return <HomeView />;
  if (route === '#/global') return <GlobalView />;
  if (route === '#/doctor') return <DoctorView />;
  const projectMetrics = route.match(/^#\/p\/([a-f0-9]+)\/metrics\/?$/);
  if (projectMetrics) return <MetricsView projectId={projectMetrics[1]} />;
  const project = route.match(/^#\/p\/([a-f0-9]+)\/?$/);
  if (project) return <ProjectView projectId={project[1]} />;
  return (
    <div style={{ color: 'var(--text-dim)' }}>
      Unknown route: <code>{route}</code>. <a href="#/">Go home</a>.
    </div>
  );
}

function Nav({ route }: { route: string }) {
  const activeStyle = { color: 'var(--text)', borderBottomColor: 'var(--accent)' } as const;
  const linkStyle = (active: boolean) => ({
    padding: '0.5rem 0',
    marginRight: '1.5rem',
    color: active ? 'var(--text)' : 'var(--text-dim)',
    borderBottom: '2px solid transparent',
    textDecoration: 'none',
    ...(active ? activeStyle : {}),
  });
  const isHome = route === '#/' || route === '';
  const isGlobal = route === '#/global';
  const isDoctor = route === '#/doctor';
  return (
    <nav style={{
      borderBottom: '1px solid var(--border)',
      padding: '1rem 1.5rem',
      display: 'flex',
      alignItems: 'baseline',
      maxWidth: 1100,
      margin: '0 auto',
    }}>
      <a href="#/" style={{
        fontSize: '1.125rem', fontWeight: 600, marginRight: '2rem',
        background: 'linear-gradient(90deg, var(--accent), var(--accent-2))',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        textDecoration: 'none',
      }}>
        Knit
      </a>
      <a href="#/" style={linkStyle(isHome)}>Projects</a>
      <a href="#/global" style={linkStyle(isGlobal)}>Cross-project</a>
      <a href="#/doctor" style={linkStyle(isDoctor)}>Health</a>
    </nav>
  );
}
