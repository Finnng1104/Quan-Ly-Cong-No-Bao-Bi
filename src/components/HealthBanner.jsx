import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import { api } from '../api/httpApi'
import { useAsync } from '../hooks/useAsync'

// Backups run silently in the background; this banner is the only way the shop learns one is failing.
const CHECK_EVERY_MS = 30 * 60 * 1000

function warningsOf(health, error) {
  // 503 means the server is up but cannot read its database.
  if (error?.status === 503) return ['Ứng dụng không đọc được dữ liệu']
  // Other errors (server stopped, network) already show on the page itself.
  return health?.warnings ?? []
}

export default function HealthBanner() {
  const { data: health, error, reload } = useAsync(() => api.health(), [])

  useEffect(() => {
    const timer = setInterval(reload, CHECK_EVERY_MS)
    return () => clearInterval(timer)
  }, [reload])

  const warnings = warningsOf(health, error)
  if (warnings.length === 0) return null

  return (
    <div
      role="alert"
      className="mb-4 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3.5 text-amber-800"
    >
      <AlertTriangle size={19} className="mt-0.5 shrink-0 text-amber-500" />
      <div className="text-[13px] leading-relaxed">
        {warnings.map((warning) => (
          <p key={warning} className="font-semibold">
            {warning}
          </p>
        ))}
        <p>Hãy báo người hỗ trợ để kiểm tra, tránh mất dữ liệu.</p>
      </div>
    </div>
  )
}
