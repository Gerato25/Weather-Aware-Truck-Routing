import { useCallback, useEffect, useState } from 'react'

import { pageFromPath, pathForPage, type Page } from '../lib/navigation'

export function usePage() {
  const [page, setPage] = useState<Page>(() =>
    typeof window === 'undefined' ? 'home' : pageFromPath(),
  )

  useEffect(() => {
    const onPop = () => setPage(pageFromPath())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const go = useCallback((next: Page, hash = '') => {
    const path = `${pathForPage(next)}${hash}`
    if (`${window.location.pathname}${window.location.hash}` !== path) {
      window.history.pushState(null, '', path)
    }
    setPage(next)
  }, [])

  return { page, go }
}
