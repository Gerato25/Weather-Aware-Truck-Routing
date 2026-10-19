import { useCallback } from 'react'

import { usePage } from './hooks/usePage'
import { useTheme } from './hooks/useTheme'
import { useTripSession } from './hooks/useTripSession'
import { HomePage } from './pages/HomePage'
import { PlannerPage } from './pages/PlannerPage'
import type { TripFormValues } from './types'

export default function App() {
  const { theme, setTheme } = useTheme()
  const { page, go } = usePage()
  const session = useTripSession()
  const { setForm, runPlan, updateField, form } = session

  const startTrip = useCallback(
    (values: TripFormValues, autoPlan: boolean) => {
      setForm(values)
      go('planner')
      if (autoPlan) void runPlan(values)
    },
    [go, runPlan, setForm],
  )

  if (page === 'home') {
    return (
      <HomePage
        theme={theme}
        onTheme={setTheme}
        form={form}
        onFormChange={updateField}
        onNavigate={go}
        onStartTrip={startTrip}
      />
    )
  }

  return <PlannerPage theme={theme} onTheme={setTheme} onNavigate={go} session={session} />
}
