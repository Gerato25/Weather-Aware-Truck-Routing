import { useCallback } from 'react'

import { usePage } from './hooks/usePage'
import { useTheme } from './hooks/useTheme'
import { useTripSession } from './hooks/useTripSession'
import { DashboardPage } from './pages/DashboardPage'
import { HomePage } from './pages/HomePage'
import type { TripFormValues } from './types'

export default function App() {
  const session = useTripSession()
  const { theme, setTheme } = useTheme()
  const { page, go } = usePage()

  const startTrip = useCallback(
    (values: TripFormValues, autoPlan: boolean) => {
      session.setForm(values)
      go('planner')
      if (autoPlan) void session.runPlan(values)
    },
    [go, session.setForm, session.runPlan],
  )

  if (page === 'home') {
    return (
      <HomePage
        theme={theme}
        onTheme={setTheme}
        form={session.form}
        onFormChange={session.updateField}
        onNavigate={go}
        onStartTrip={startTrip}
      />
    )
  }

  return (
    <DashboardPage
      session={session}
      theme={theme}
      onTheme={setTheme}
      onNavigate={go}
    />
  )
}
