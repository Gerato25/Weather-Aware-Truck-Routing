import { useTripSession } from './hooks/useTripSession'
import { DashboardPage } from './pages/DashboardPage'

export default function App() {
  const session = useTripSession()
  return <DashboardPage session={session} />
}
