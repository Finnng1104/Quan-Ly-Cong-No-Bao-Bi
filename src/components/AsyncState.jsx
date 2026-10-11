import { AlertTriangle, Loader2 } from 'lucide-react'
import { messageOf } from '../api/client'
import { Card, Button } from './ui'

export function LoadingCard({ label = 'Đang tải...' }) {
  return (
    <Card className="flex items-center justify-center gap-2.5 p-8 text-[14px] font-semibold text-slate-400">
      <Loader2 size={18} className="animate-spin" />
      {label}
    </Card>
  )
}

export function ErrorCard({ error, onRetry }) {
  return (
    <Card className="flex flex-col items-center gap-3 border-rose-100 bg-rose-50/60 p-6 text-center">
      <AlertTriangle size={24} className="text-rose-500" />
      <p className="text-[14px] font-semibold text-rose-600">{messageOf(error)}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Thử lại
        </Button>
      )}
    </Card>
  )
}
