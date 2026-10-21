export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'spotter-theme-v4'

export const MAP_STYLES: Record<Theme, string> = {
  light: 'https://tiles.openfreemap.org/styles/bright',
  dark: 'https://tiles.openfreemap.org/styles/dark',
}

/** Keyless CARTO basemaps, used when OpenFreeMap's style or tiles fail to load. */
export const MAP_FALLBACK_STYLES: Record<Theme, string> = {
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
}

export function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    /* private mode */
  }
  return 'light'
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    /* private mode */
  }
}
