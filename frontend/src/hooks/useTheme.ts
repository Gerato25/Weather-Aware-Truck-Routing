import { useEffect, useState } from 'react'

import { applyTheme, type Theme } from '../lib/theme'

export function useTheme() {
  const [theme] = useState<Theme>('light')

  useEffect(() => {
    applyTheme('light')
  }, [])

  return { theme }
}
