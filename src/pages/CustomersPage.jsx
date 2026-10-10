import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, UserPlus, ChevronRight, ArrowDownWideNarrow, CalendarDays, Download } from 'lucide-react'
import { useStore } from '../store/useStore'
import { debtsByCustomer, dayActivitiesByCustomer, customerDebtRows } from '../lib/debt'
import { normalize, todayISO, fmtMoney, fmtDate, toCsv, downloadText } from '../lib/format'
import { Card, Money, Empty, Modal, Button, Field, Input, Textarea } from '../components/ui'
import { Avatar } from '../components/pickers'
import { useToast } from '../components/Toast'

export function CustomerForm({ open, onClose, initial }) {
  const addCustomer = useStore((s) => s.addCustomer)
  const editCustomer = useStore((s) => s.editCustomer)
  const toast = useToast()
  const [f, setF] = useState(
    initial || { name: '', phone: '', address: '', note: '', openingAmount: '', openingDate: todayISO() },
  )

  // reset form mỗi lần mở
  useEffect(() => {
    if (open) {
      setF(
        initial || { name: '', phone: '', address: '', note: '', openingAmount: '', openingDate: todayISO() },
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const submit = () => {
    if (!f.name.trim()) {
      toast.error('Vui lòng nhập tên khách')
      return
    }
    const payload = {
      name: f.name.trim(),
      phone: f.phone,
      address: f.address,
      note: f.note,
      openingDebt: { amount: Number(f.openingAmount) || 0, date: f.openingDate },
    }
    if (initial?.id) {
      editCustomer(initial.id, payload)
      toast.success('Đã cập nhật khách')
    } else {
      addCustomer(payload)
      toast.success('Đã thêm khách mới')
    }
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={initial?.id ? 'Sửa khách hàng' : 'Thêm khách hàng'}>
      <div className="space-y-3.5">
        <Field label="Tên khách *">
          <Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="VD: Thanh Nhi" />
        </Field>
        <Field label="Số điện thoại">
          <Input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="09xx..." />
        </Field>
        <Field label="Địa chỉ">
          <Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="Địa chỉ" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nợ đầu kỳ">
            <Input inputMode="numeric" value={f.openingAmount} onChange={(e) => setF({ ...f, openingAmount: e.target.value.replace(/[^0-9]/g, '') })} placeholder="0" />
          </Field>
          <Field label="Ngày nợ đầu kỳ">
            <Input type="date" value={f.openingDate} onChange={(e) => setF({ ...f, openingDate: e.target.value })} />
          </Field>
        </div>
        <Field label="Ghi chú">
          <Textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Ghi chú thêm..." />
        </Field>
        <Button className="w-full" size="lg" onClick={submit}>
          {initial?.id ? 'Lưu thay đổi' : 'Thêm khách'}
        </Button>
      </div>
    </Modal>
  )
}

export default function CustomersPage() {
  const [q, setQ] = useState('')
  const [date, setDate] = useState(todayISO())
  const [sortDesc, setSortDesc] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [limit, setLimit] = useState(30)
  const data = useStore()

  const list = useMemo(() => {
    const debts = debtsByCustomer(data, date)
    const acts = dayActivitiesByCustomer(data, date)
    const nq = normalize(q)
    return data.customers
      .map((c) => ({ ...c, debt: debts[c.id] || 0, act: acts[c.id] || { up: 0, down: 0 } }))
      .filter((c) => !nq || normalize(c.name + ' ' + c.phone).includes(nq))
      .sort((a, b) => (sortDesc ? b.debt - a.debt : a.debt - b.debt) || a.name.localeCompare(b.name, 'vi'))
  }, [data, date, q, sortDesc])

  const shown = list.slice(0, limit)
  const totalDebt = list.reduce((s, c) => s + c.debt, 0)

  // Xuất danh sách công nợ cuối của khách hàng (CSV — mở bằng Excel)
  const exportDebt = () => {
    const rows = customerDebtRows(data, date)
    const head = [
      'STT',
      'Khách hàng',
      'SĐT',
      'Nợ đầu kỳ',
      'Tổng đơn hàng',
      'Hàng trả',
      'Đã thu',
      'Phát sinh',
      'Dư nợ cuối',
    ]
    const body = rows.map((r, i) => [
      i + 1,
      r.customer.name,
      r.customer.phone || '',
      r.opening,
      r.orders,
      r.returns,
      r.payments,
      r.adjust,
      r.end,
    ])
    const totals = [
      '',
      'TỔNG CỘNG',
      '',
      rows.reduce((s, r) => s + r.opening, 0),
      rows.reduce((s, r) => s + r.orders, 0),
      rows.reduce((s, r) => s + r.returns, 0),
      rows.reduce((s, r) => s + r.payments, 0),
      rows.reduce((s, r) => s + r.adjust, 0),
      rows.reduce((s, r) => s + r.end, 0),
    ]
    downloadText(
      `cong-no-khach-${date}.csv`,
      toCsv([head, ...body, totals]),
      'text/csv;charset=utf-8',
    )
    toast.success(`Đã xuất công nợ ${rows.length} khách đến ${fmtDate(date)}`)
  }

  return (
    <div className="animate-fade-up space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Khách hàng</h1>
          <label className="mt-0.5 flex items-center gap-1 text-[12px] font-semibold text-slate-400">
            <CalendarDays size={12} className="text-indigo-400" />
            Dư nợ đến
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value || todayISO())}
              className="w-[118px] bg-transparent text-indigo-600 outline-none"
            />
          </label>
        </div>
        <div className="flex gap-2">
          <button
            onClick={exportDebt}
            title="Xuất công nợ khách (CSV — Excel)"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-600 active:bg-emerald-100"
          >
            <Download size={18} />
          </button>
          <Button icon={UserPlus} onClick={() => setFormOpen(true)}>
            Thêm khách
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setLimit(30)
          }}
          placeholder="Tìm theo tên hoặc SĐT..."
          className="pl-10"
        />
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold text-slate-500">
          {list.length} khách · tổng nợ <span className="text-amber-600">{fmtMoney(totalDebt)} đ</span>
        </p>
        <button
          onClick={() => setSortDesc((v) => !v)}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-indigo-600 hover:bg-indigo-50"
        >
          <ArrowDownWideNarrow size={15} />
          {sortDesc ? 'Nợ giảm dần' : 'Nợ tăng dần'}
        </button>
      </div>

      {shown.length === 0 ? (
        <Card>
          <Empty title="Không tìm thấy khách" desc="Thử từ khóa khác hoặc thêm khách mới" />
        </Card>
      ) : (
        <Card className="divide-y divide-slate-50 overflow-hidden">
          {shown.map((c) => (
            <Link
              key={c.id}
              to={`/khach/${c.id}`}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50/70"
            >
              <Avatar name={c.name} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14.5px] font-semibold text-slate-800">{c.name}</p>
                <p className="truncate text-[12px] text-slate-400">
                  {c.phone || '—'} · {c.address || 'không địa chỉ'}
                </p>
              </div>
              <div className="text-right">
                <Money
                  value={c.debt}
                  className={`text-[14.5px] ${c.debt > 0 ? 'text-amber-600' : 'text-slate-400'}`}
                />
                {(c.act.up > 0 || c.act.down > 0) && (
                  <p className="text-[10.5px] font-semibold tabular-nums">
                    <span className="text-slate-400">PS </span>
                    {c.act.up > 0 && <span className="text-rose-500">+{fmtMoney(c.act.up)}</span>}
                    {c.act.up > 0 && c.act.down > 0 && <span className="text-slate-300"> · </span>}
                    {c.act.down > 0 && <span className="text-emerald-600">−{fmtMoney(c.act.down)}</span>}
                  </p>
                )}
                {c.debt <= 0 && <p className="text-[10.5px] font-semibold text-emerald-500">Hết nợ</p>}
              </div>
              <ChevronRight size={16} className="shrink-0 text-slate-300" />
            </Link>
          ))}
        </Card>
      )}

      {list.length > shown.length && (
        <Button variant="outline" className="w-full" onClick={() => setLimit((l) => l + 30)}>
          Xem thêm ({list.length - shown.length} khách)
        </Button>
      )}

      <CustomerForm open={formOpen} onClose={() => setFormOpen(false)} />
    </div>
  )
}

