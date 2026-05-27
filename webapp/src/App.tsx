import { useEffect, useState } from 'react';
import { HomeView } from './views/HomeView';
import { ProjectView } from './views/ProjectView';
import { MetricsView } from './views/MetricsView';
import { GlobalView } from './views/GlobalView';
import { DoctorView } from './views/DoctorView';
import { GraphView } from './views/GraphView';
import { UpdateBanner } from './components/UpdateBanner';

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
      <UpdateBanner />
      <main style={{ maxWidth: 1240, margin: '0 auto', padding: 'var(--space-5) var(--space-5) var(--space-8)' }}>
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
  const projectGraph = route.match(/^#\/p\/([a-f0-9]+)\/graph\/?$/);
  if (projectGraph) return <GraphView projectId={projectGraph[1]} />;
  const project = route.match(/^#\/p\/([a-f0-9]+)\/?$/);
  if (project) return <ProjectView projectId={project[1]} />;
  return (
    <div style={{ color: 'var(--text-dim)' }}>
      Unknown route: <code>{route}</code>. <a href="#/">Go home</a>.
    </div>
  );
}

function Nav({ route }: { route: string }) {
  const isHome = route === '#/' || route === '';
  const isGlobal = route === '#/global';
  const isDoctor = route === '#/doctor';
  return (
    <nav style={{
      maxWidth: 1240, margin: '0 auto',
      padding: 'var(--space-5) var(--space-5) 0',
      display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
    }}>
      <a href="#/" style={{
        fontSize: 'var(--size-h2)', fontWeight: 'var(--weight-bold)',
        letterSpacing: '-0.01em', marginRight: 'var(--space-5)',
        color: 'var(--text-dark)',
      }}>
        Knit<span style={{ color: 'var(--surface-lavender)' }}>.</span>
      </a>
      <NavLink href="#/" active={isHome}>Brain</NavLink>
      <NavLink href="#/global" active={isGlobal}>Cross-project</NavLink>
      <NavLink href="#/doctor" active={isDoctor}>Health</NavLink>
    </nav>
  );
}

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <a
      href={href}
      style={{
        padding: '8px 14px',
        borderRadius: 'var(--radius-pill)',
        fontSize: 'var(--size-label)',
        fontWeight: 'var(--weight-medium)',
        background: active ? 'var(--surface-dark)' : 'transparent',
        color: active ? 'var(--text-light)' : 'var(--text-mute-dark)',
        transition: 'background var(--duration-fast) var(--ease), color var(--duration-fast) var(--ease)',
      }}
    >
      {children}
    </a>
  );
}
