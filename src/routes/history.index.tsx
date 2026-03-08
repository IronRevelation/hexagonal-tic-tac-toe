import { createFileRoute } from '@tanstack/react-router'
import GameHistoryScreen from '../components/GameHistoryScreen'

export const Route = createFileRoute('/history/')({
  component: HistoryIndexPage,
})

function HistoryIndexPage() {
  return <GameHistoryScreen selectedGameId={null} />
}
