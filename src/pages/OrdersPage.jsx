import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CalendarDays, History, ChevronRight, User, PlusCircle } from 'lucide-react'
import { useStore } from '../store/useStore'
import { fmtMoney, fmtDate, fmtQty, todayISO } from '../lib/format'
import { Card, Money, Badge, Empty, Button } from '../components/ui'
import { PickerModal, PickerButton, Avatar } from '../components/pickers'
import { productName, unitName } from '../store/useStore'

export default function OrdersPage() {
  const navigate = useNavigate()
  const [date, setDate] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [custPicker, setCustPicker] = useState(false)
  const data = useStore()

  const orders = useMemo(() => {
    return data.orders
      .filter((o) => !o.deletedAt)
      .filter((o) => !date || o.date === date)
      .filter((o) => !customerId || o.customerId === customerId)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.seq - a.seq))
  }, [data, date, customerId])

  const dayTotal = useMemo(() => {
    const target = date || todayISO()
    return data.orders
      .filter((o) => !o.deletedAt && o.date === target)
      .reduce((s, o) => s + o.total, 0)
  }, [data, date])

  const grandTotal = orders.reduce((s, o) => s + o.total, 0)

  return (
    <div className="animate-fade-up space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">Đơn hàng</h1>
        <Button icon={PlusCircle} onClick={() => navigate('/don-moi')}>
          Tạo đơn
        </Button>
      </div>

      {/* lọc */}
      <Card className="flex flex-wrap items-center gap-2.5 p-3.5">
        <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-[13.5px] font-semibold text-slate-600">
          <CalendarDays size={15} className="text-indigo-500" />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="bg-transparent outline-none"
          />
        </label>
        <div className="min-w-[160px] flex-1">
          <PickerButton onClick={() => setCustPicker(true)} placeholder="Tất cả khách" icon={User}>
            {customerId ? data.customers.find((c) => c.id === customerId)?.name : null}
          </PickerButton>
        </div>
        {(date || customerId) && (
          <button
            onClick={() => {
              setDate('')
              setCustomerId('')
            }}
            className="rounded-xl px-3 py-2 text-[13px] font-semibold text-rose-500 hover:bg-rose-50"
          >
            Xóa lọc
          </button>
        )}
      </Card>

      <div className="flex items-center justify-between text-[13px] font-semibold">
        <span className="text-slate-500">{orders.length} đơn</span>
        <span className="text-slate-500">
          Tổng: <span className="text-indigo-700">{fmtMoney(grandTotal)} đ</span>
        </span>
      </div>

      {orders.length === 0 ? (
        <Card>
          <Empty title="Không có đơn nào" desc="Thử đổi bộ lọc hoặc tạo đơn mới" />
        </Card>
      ) : (
        <Card className="divide-y divide-slate-50 overflow-hidden">
          {orders.map((o) => {
            const c = data.customers.find((x) => x.id === o.customerId)
            return (
              <Link
                key={o.id}
                to={`/don-hang/${o.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50/70"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                  <span className="text-[11px] font-extrabold">{o.code.replace('HĐ-', '')}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-[14px] font-semibold text-slate-800">
                      {c?.name || '—'}
                    </p>
                    {o.editHistory?.length > 0 && (
                      <Badge tone="violet">
                        <History size={10} /> Đã điều chỉnh
                      </Badge>
                    )}
                  </div>
                  <p className="truncate text-[11.5px] text-slate-400">
                    {o.code} · {fmtDate(o.date)} ·{' '}
                    {o.lines
                      .slice(0, 2)
                      .map((l) => `${fmtQty(l.qty)} ${unitName(data, l.unitId)} ${productName(data, l.productId)}`)
                      .join(', ')}
                    {o.lines.length > 2 ? ` +${o.lines.length - 2} dòng` : ''}
                  </p>
                </div>
                <Money value={o.total} className="text-[14px]" />
                <ChevronRight size={15} className="shrink-0 text-slate-300" />
              </Link>
            )
          })}
        </Card>
      )}

      {/* tổng cuối ngày */}
      <Card className="flex items-center justify-between bg-gradient-to-r from-indigo-600 to-blue-600 p-4 text-white">
        <p className="text-[13.5px] font-semibold">
          Tổng đơn {date ? fmtDate(date) : 'hôm nay'}
        </p>
        <p className="text-xl font-extrabold tabular-nums">{fmtMoney(dayTotal)} đ</p>
      </Card>

      <PickerModal
        open={custPicker}
        onClose={() => setCustPicker(false)}
        title="Lọc theo khách"
        items={data.customers}
        getKey={(c) => c.id}
        filterText={(c) => `${c.name} ${c.phone}`}
        onPick={(c) => setCustomerId(c.id)}
        renderItem={(c) => (
          <>
            <Avatar name={c.name} />
            <p className="flex-1 text-[14.5px] font-semibold text-slate-800">{c.name}</p>
          </>
        )}
      />
    </div>
  )
}
