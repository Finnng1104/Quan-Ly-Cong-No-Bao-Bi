import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { HandCoins, User, Save } from 'lucide-react'
import { useStore, customerName } from '../store/useStore'
import { balanceAt } from '../lib/debt'
import { todayISO, fmtMoney, fmtDate } from '../lib/format'
import { Card, Money, Badge, Empty, Button, Field, Input, Confirm } from '../components/ui'
import { PickerModal, PickerButton, Avatar } from '../components/pickers'
import { useToast } from '../components/Toast'

export default function PaymentsPage() {
  const [sp] = useSearchParams()
  const [customerId, setCustomerId] = useState(sp.get('khach') || '')
  const [date, setDate] = useState(todayISO())
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [custPicker, setCustPicker] = useState(false)
  const [delId, setDelId] = useState(null)
  const data = useStore()
  const toast = useToast()

  const debt = customerId ? balanceAt(customerId, data, todayISO()) : null

  const payments = useMemo(
    () =>
      data.payments
        .filter((p) => !p.deletedAt)
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.seq - a.seq))
        .slice(0, 60),
    [data],
  )

  const save = () => {
    if (!customerId) return toast.error('Vui lòng chọn khách')
    if (!Number(amount) || Number(amount) <= 0) return toast.error('Nhập số tiền thu')
    const rec = data.addPayment({ customerId, date, amount: Number(amount), note })
    toast.success(`Đã thu ${fmtMoney(rec.amount)} đ — trừ vào công nợ chung`)
    setAmount('')
    setNote('')
  }

  return (
    <div className="animate-fade-up space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Thu tiền</h1>
        <p className="text-[12px] text-slate-400">
          Tiền thu trừ thẳng vào công nợ chung — không chia theo đơn
        </p>
      </div>

      {/* form thu nhanh */}
      <Card className="space-y-3.5 p-4">
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label="Khách hàng *">
            <PickerButton onClick={() => setCustPicker(true)} placeholder="Chọn khách..." icon={User}>
              {customerId ? customerName(data, customerId) : null}
            </PickerButton>
          </Field>
          <Field label="Ngày">
            <div className="w-[136px]">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </Field>
        </div>

        {debt !== null && (
          <div className="flex items-center justify-between rounded-xl bg-amber-50 px-3.5 py-2.5 text-[13px] font-semibold">
            <span className="text-amber-700">Đang nợ</span>
            <span className="tabular-nums text-amber-700">{fmtMoney(debt)} đ</span>
          </div>
        )}

        <Field label="Số tiền thu *">
          <div className="relative">
            <Input
              inputMode="numeric"
              value={amount ? fmtMoney(amount) : ''}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="0"
              className="pr-8 text-right text-lg font-bold"
            />
            <span className="absolute right-3.5 top-1/2 -translate-y-1/2 font-semibold text-slate-400">đ</span>
          </div>
        </Field>

        {debt > 0 && (
          <div className="flex gap-2">
            {[0.25, 0.5, 1].map((r) => (
              <button
                key={r}
                onClick={() => setAmount(String(Math.round(debt * r)))}
                className="rounded-lg bg-emerald-50 px-3 py-1.5 text-[12px] font-bold text-emerald-700 active:bg-emerald-100"
              >
                {r === 1 ? 'Tất cả' : `${r * 100}%`}
              </button>
            ))}
          </div>
        )}

        <Field label="Ghi chú">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: trả đơn sáng nay..." />
        </Field>

        <Button size="lg" variant="success" icon={Save} className="w-full" onClick={save}>
          Lưu phiếu thu
        </Button>
      </Card>

      {/* lịch sử thu */}
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-bold text-slate-700">Lịch sử thu tiền</h2>
        <Badge tone="emerald">{payments.length} phiếu</Badge>
      </div>

      {payments.length === 0 ? (
        <Card>
          <Empty icon={HandCoins} title="Chưa có phiếu thu nào" />
        </Card>
      ) : (
        <Card className="divide-y divide-slate-50 overflow-hidden">
          {payments.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-500">
                <HandCoins size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold text-slate-800">
                  {customerName(data, p.customerId)}
                </p>
                <p className="truncate text-[11.5px] text-slate-400">
                  {p.code} · {fmtDate(p.date)}
                  {p.note ? ` · ${p.note}` : ''}
                </p>
              </div>
              <div className="text-right">
                <Money value={p.amount} className="text-[14px] text-emerald-600" sign />
                <button
                  onClick={() => setDelId(p.id)}
                  className="mt-0.5 block w-full text-right text-[11px] font-semibold text-slate-300 hover:text-rose-500"
                >
                  Xóa
                </button>
              </div>
            </div>
          ))}
        </Card>
      )}

      <PickerModal
        open={custPicker}
        onClose={() => setCustPicker(false)}
        title="Chọn khách hàng"
        items={data.customers}
        getKey={(c) => c.id}
        filterText={(c) => `${c.name} ${c.phone}`}
        onPick={setCustomerId}
        renderItem={(c) => (
          <>
            <Avatar name={c.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14.5px] font-semibold text-slate-800">{c.name}</p>
              <p className="text-[12px] text-slate-400">{c.phone}</p>
            </div>
          </>
        )}
      />

      <Confirm
        open={!!delId}
        onClose={() => setDelId(null)}
        onConfirm={() => {
          data.removePayment(delId)
          toast.success('Đã xóa phiếu thu')
        }}
        title="Xóa phiếu thu?"
        message="Phiếu thu sẽ bị xóa và cộng lại vào công nợ của khách."
      />
    </div>
  )
}
