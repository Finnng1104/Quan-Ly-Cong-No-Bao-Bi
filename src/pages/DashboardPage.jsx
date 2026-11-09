import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, TrendingUp, HandCoins, ReceiptText, ChevronRight } from 'lucide-react'
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useStore } from '../store/useStore'
import { api } from '../api/httpApi'
import { useAsync } from '../hooks/useAsync'
import { fmtMoney, fmtDate, todayISO } from '../lib/format'
import { Card, Money, Badge } from '../components/ui'
import { ErrorCard } from '../components/AsyncState'
import { Avatar } from '../components/pickers'

const EMPTY_DAY = { orders: 0, orderCount: 0, payments: 0, paymentCount: 0, returns: 0 }
const EMPTY_MONTH = { orders: 0, payments: 0, returns: 0, orderCount: 0 }

// Shop debts run into tens of millions; "22tr" fits the narrow axis where "22000k" was cut off.
const axisMoneyFmt = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 })
function fmtAxisMoney(value) {
  if (Math.abs(value) >= 1_000_000) return `${axisMoneyFmt.format(value / 1_000_000)}tr`
  if (value === 0) return '0'
  return `${axisMoneyFmt.format(value / 1000)}k`
}

export default function DashboardPage() {
  const [date, setDate] = useState(todayISO())
  const dataVersion = useStore((s) => s.dataVersion)
  const { data: board, error, reload } = useAsync(() => api.reports.dashboard(date), [date, dataVersion])

  // All figures come from the server; zeros are shown until the first answer arrives.
  const totalDebt = board?.totalDebt ?? 0
  const debtorCount = board?.debtorCount ?? 0
  const day = board?.day ?? EMPTY_DAY
  const month = board?.month ?? EMPTY_MONTH
  const series = board?.series ?? []
  const topDebtors = (board?.topDebtors ?? []).map((d) => ({
    id: d.customerId,
    name: d.name,
    phone: d.phone,
    debt: d.balance,
  }))

  return (
    <div className="animate-fade-up space-y-4">
      {/* chọn ngày */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">Tổng quan</h1>
        <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[14px] font-semibold text-slate-700 shadow-sm">
          <CalendarDays size={16} className="text-indigo-500" />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value || todayISO())}
            className="bg-transparent outline-none"
          />
        </label>
      </div>

      {error && !board && <ErrorCard error={error} onRetry={reload} />}

      {/* Tổng công nợ */}
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-indigo-600 via-indigo-600 to-blue-600 p-5 text-white">
          <p className="text-[13px] font-medium text-indigo-100">
            Tổng công nợ đến {fmtDate(date)}
          </p>
          <p className="mt-1 text-[34px] font-extrabold leading-none tabular-nums tracking-tight">
            {fmtMoney(totalDebt)}
            <span className="ml-1.5 text-lg font-semibold text-indigo-200">đ</span>
          </p>
          <div className="mt-3 flex items-center gap-1.5 text-[12px] font-medium text-indigo-100">
            <TrendingUp size={14} />
            {debtorCount} khách còn nợ
          </div>
        </div>
        <div className="grid grid-cols-3 divide-x divide-slate-100">
          <Link to={`/don-hang?ngay=${date}`} className="block p-3.5 text-center transition-colors active:bg-slate-100 hover:bg-slate-50">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Đơn hôm nay
            </p>
            <p className="mt-0.5 text-[15px] font-bold text-slate-800 tabular-nums">
              {fmtMoney(day.orders)}<span className="text-[11px] text-slate-400">đ</span>
            </p>
            <p className="text-[11px] text-slate-400">{day.orderCount} đơn</p>
          </Link>
          <Link to={`/thu-tien?ngay=${date}`} className="block p-3.5 text-center transition-colors active:bg-slate-100 hover:bg-slate-50">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Thu hôm nay
            </p>
            <p className="mt-0.5 text-[15px] font-bold text-emerald-600 tabular-nums">
              {fmtMoney(day.payments)}<span className="text-[11px] text-emerald-400">đ</span>
            </p>
            <p className="text-[11px] text-slate-400">{day.paymentCount} lần</p>
          </Link>
          <Link to={`/hang-tra?ngay=${date}`} className="block p-3.5 text-center transition-colors active:bg-slate-100 hover:bg-slate-50">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Trả hàng
            </p>
            <p className="mt-0.5 text-[15px] font-bold text-amber-600 tabular-nums">
              {fmtMoney(day.returns)}<span className="text-[11px] text-amber-400">đ</span>
            </p>
            <p className="text-[11px] text-slate-400">trong ngày</p>
          </Link>
        </div>
      </Card>

      {/* tháng này */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-slate-400">
            <ReceiptText size={15} />
            <p className="text-[12px] font-semibold">Đơn trong tháng</p>
          </div>
          <p className="mt-1.5 text-lg font-bold text-slate-800 tabular-nums">
            {fmtMoney(month.orders)}<span className="text-xs text-slate-400">đ</span>
          </p>
          <p className="text-[11px] text-slate-400">{month.orderCount} đơn</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-slate-400">
            <HandCoins size={15} />
            <p className="text-[12px] font-semibold">Thu trong tháng</p>
          </div>
          <p className="mt-1.5 text-lg font-bold text-emerald-600 tabular-nums">
            {fmtMoney(month.payments)}<span className="text-xs text-emerald-400">đ</span>
          </p>
          <p className="text-[11px] text-slate-400">đến {fmtDate(date)}</p>
        </Card>
      </div>

      {/* biểu đồ nợ 14 ngày */}
      <Card className="p-4">
        <p className="mb-1 text-[14px] font-bold text-slate-700">Tổng công nợ 14 ngày gần đây</p>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="debtGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#4F46E5" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#4F46E5" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tickFormatter={(v) => v.slice(8, 10)}
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={fmtAxisMoney}
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                width={38}
              />
              <Tooltip
                formatter={(v) => [`${fmtMoney(v)} đ`, 'Tổng nợ']}
                labelFormatter={(v) => fmtDate(v)}
                contentStyle={{
                  borderRadius: 12,
                  border: '1px solid #e2e8f0',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              />
              <Area
                type="monotone"
                dataKey="debt"
                stroke="#4F46E5"
                strokeWidth={2.5}
                fill="url(#debtGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* top khách nợ nhiều */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-4 pt-4">
          <p className="text-[14px] font-bold text-slate-700">Khách nợ nhiều nhất</p>
          <Badge tone="amber">đến {fmtDate(date)}</Badge>
        </div>
        <div className="mt-2 divide-y divide-slate-50">
          {topDebtors.map((c, i) => (
            <Link
              key={c.id}
              to={`/khach/${c.id}`}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50"
            >
              <span className="w-5 text-center text-[13px] font-bold text-slate-300">{i + 1}</span>
              <Avatar name={c.name} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14.5px] font-semibold text-slate-800">{c.name}</p>
                <p className="text-[12px] text-slate-400">{c.phone}</p>
              </div>
              <Money value={c.debt} className="text-[14.5px] text-amber-600" />
              <ChevronRight size={16} className="text-slate-300" />
            </Link>
          ))}
          {board && topDebtors.length === 0 && (
            <p className="px-4 py-6 text-center text-[13px] text-slate-400">
              Không có khách nào còn nợ 🎉
            </p>
          )}
        </div>
      </Card>
    </div>
  )
}
