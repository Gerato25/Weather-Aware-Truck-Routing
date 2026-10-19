export type Page = 'home' | 'planner' | 'routes' | 'weather'

const PATHS: Record<Page, string> = {
  home: '/',
  planner: '/plan',
  routes: '/routes',
  weather: '/weather',
}

export function pageFromPath(pathname = window.location.pathname): Page {
  const path = pathname.replace(/\/$/, '') || '/'
  if (path === '/plan' || path === '/routes' || path === '/weather') return 'planner'
  return 'home'
}

export function pathForPage(page: Page): string {
  return PATHS[page]
}
