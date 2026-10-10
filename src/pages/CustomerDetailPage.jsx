import { useMemo, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Phone,
  MapPin,
  StickyNote,
  PlusCircle,
  Undo2,
  HandCoins,
  FileText,
  CalendarDays,
  Pencil,
  History,
  ChevronRight,
} from 'lucide-react'
import { useStore, productName, unitName } from '../store/useStore'
import { balanceAt, fullLedger } from '../lib/debt'
import { fmtMoney, fmtDate, todayISO } from '../lib/format'
import { Card, Money, Badge, SegmentedTabs, Empty, Button } from '../components/ui'
import { CustomerForm } from './CustomersPage'

const kindMeta = {
  opening: { label: 'Nợ đầu kỳ', tone: 'slate' },
  order: { label: 'Đơn hàng', tone: 'indigo' },
  return: { label: 'Trả hàng', tone: 'amber' },
  payment: { label: 'Thanh toán', tone: 'emerald' },
}

export default function CustomerDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const data = useStore()
  const customer = data.customers.find((c) => c.id === id)
  const [date, setDate] = useState(todayISO())
  const [tab, setTab] = useState('ledger')
  const [editOpen, setEditOpen] = useState(false)

  const balance = useMemo(() => (customer ? balanceAt(id, data, date) : 0), [customer, id, data, date])
  const ledger = useMemo(
    () => (customer ? fullLedger(id, data, date).slice().reverse() : []),
    [customer, id, data, date],
  )
  const orders = useMemo(
    () =>
      data.orders
        .filter((o) => o.customerId === id && !o.deletedAt)
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.seq - a.seq)),
    [data, id],
  )
  const prices = useMemo(() => data.priceBook.filter((p) => p.customerId === id), [data, id])

  if (!customer) {
    return (
      <Card>
        <Empty title="Không tìm thấy khách" action={<Button onClick={() => navigate('/khach')}>Về danh sách</Button>} />
      </Card>
    )
  }

  return (
    <div className="animate-fade-up space-y-4">
      {/* header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold text-slate-800">{customer.name}</h1>
          <div className="flex items-center gap-3 text-[12px] text-slate-400">
            {customer.phone && (
              <a href={`tel:${customer.phone}`} className="flex items-center gap-1">
                <Phone size={11} /> {customer.phone}
              </a>
            )}
          </div>
        </div>
        <Button variant="outline" size="icon" onClick={() => setEditOpen(true)}>
          <Pencil size={17} />
        </Button>
      </div>

      {/* card dư nợ */}
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-amber-500 to-orange-500 p-5 text-white">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-medium text-amber-50">Dư nợ đến ngày</p>
            <label className="flex items-center gap-1.5 rounded-lg bg-white/15 px-2.5 py-1.5 text-[13px] font-semibold">
              <CalendarDays size={14} />
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value || todayISO())}
                className="w-[110px] bg-transparent text-white outline-none [color-scheme:dark]"
              />
            </label>
          </div>
          <p className="mt-1 text-[32px] font-extrabold tabular-nums tracking-tight">
            {fmtMoney(balance)} <span className="text-lg font-semibold text-amber-100">đ</span>
          </p>
          {customer.openingDebt?.amount > 0 && (
            <p className="mt-1 text-[12px] text-amber-100">
              Nợ đầu kỳ {fmtMoney(customer.openingDebt.amount)} đ từ {fmtDate(customer.openingDebt.date)}
            </p>
          )}
        </div>
        {(customer.address || customer.note) && (
          <div className="space-y-1 px-4 py-3 text-[13px] text-slate-500">
            {customer.address && (
              <p className="flex items-center gap-2">
                <MapPin size={14} className="text-slate-300" /> {customer.address}
              </p>
            )}
            {customer.note && (
              <p className="flex items-center gap-2">
                <StickyNote size={14} className="text-slate-300" /> {customer.note}
              </p>
            )}
          </div>
        )}
      </Card>

      {/* nút nhanh */}
      <div className="grid grid-cols-4 gap-2.5">
        <Link
          to={`/don-moi?khach=${id}`}
          className="flex flex-col items-center gap-1.5 rounded-2xl bg-indigo-600 py-3.5 text-white shadow-md shadow-indigo-200 active:scale-[0.97]"
        >
          <PlusCircle size={21} />
          <span className="text-[11px] font-semibold">Tạo đơn</span>
        </Link>
        <Link
          to={`/hang-tra?khach=${id}`}
          className="flex flex-col items-center gap-1.5 rounded-2xl bg-amber-500 py-3.5 text-white shadow-md shadow-amber-200 active:scale-[0.97]"
        >
          <Undo2 size={21} />
          <span className="text-[11px] font-semibold">Hàng trả</span>
        </Link>
        <Link
          to={`/thu-tien?khach=${id}`}
          className="flex flex-col items-center gap-1.5 rounded-2xl bg-emerald-500 py-3.5 text-white shadow-md shadow-emerald-200 active:scale-[0.97]"
        >
          <HandCoins size={21} />
          <span className="text-[11px] font-semibold">Thu tiền</span>
        </Link>
        <Link
          to={`/sao-ke?khach=${id}`}
          className="flex flex-col items-center gap-1.5 rounded-2xl bg-cyan-600 py-3.5 text-white shadow-md shadow-cyan-200 active:scale-[0.97]"
        >
          <FileText size={21} />
          <span className="text-[11px] font-semibold">Sao kê</span>
        </Link>
      </div>

      <SegmentedTabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'ledger', label: 'Sổ công nợ' },
          { key: 'orders', label: `Đơn hàng (${orders.length})` },
          { key: 'prices', label: `Bảng giá (${prices.length})` },
        ]}
      />

      {/* ===== Sổ công nợ ===== */}
      {tab === 'ledger' && (
        <Card className="divide-y divide-slate-50 overflow-hidden">
          {ledger.length === 0 && <Empty title="Chưa có phát sinh" desc={`Đến ${fmtDate(date)} chưa có giao dịch nào`} />}
          {ledger.map((r, i) => (
            <Link
              key={i}
              to={r.kind === 'order' ? `/don-hang/${r.refId}` : '#'}
              onClick={(e) => r.kind !== 'order' && e.preventDefault()}
              className={`flex items-center gap-3 px-4 py-3 ${r.kind === 'order' ? 'hover:bg-slate-50/70' : ''}`}
            >
              <div className="w-14 shrink-0">
                <p className="text-[13px] font-bold text-slate-700">{fmtDate(r.date).slice(0, 5)}</p>
                <p className="text-[10.5px] text-slate-400">{r.date.slice(0, 4)}</p>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-[13.5px] font-semibold text-slate-700">{r.desc}</p>
                  <Badge tone={kindMeta[r.kind].tone}>{kindMeta[r.kind].label}</Badge>
                  {r.kind === 'order' &&
                    data.orders.find((o) => o.id === r.refId)?.editHistory?.length > 0 && (
                      <Badge tone="violet">
                        <History size={10} /> Đã điều chỉnh
                      </Badge>
                    )}
                </div>
              </div>
              <div className="text-right">
                {r.up > 0 && <p className="text-[13.5px] font-bold text-rose-500 tabular-nums">+{fmtMoney(r.up)}</p>}
                {r.down > 0 && <p className="text-[13.5px] font-bold text-emerald-600 tabular-nums">-{fmtMoney(r.down)}</p>}
                <p className="text-[11px] font-semibold text-slate-400 tabular-nums">
                  dư {fmtMoney(r.balance)}
                </p>
              </div>
            </Link>
          ))}
        </Card>
      )}

      {/* ===== Đơn hàng ===== */}
      {tab === 'orders' && (
        <Card className="divide-y divide-slate-50 overflow-hidden">
          {orders.length === 0 && <Empty title="Chưa có đơn nào" />}
          {orders.map((o) => (
            <Link key={o.id} to={`/don-hang/${o.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50/70">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="text-[14px] font-bold text-slate-800">{o.code}</p>
                  {o.editHistory?.length > 0 && (
                    <Badge tone="violet">
                      <History size={10} /> Đã điều chỉnh
                    </Badge>
                  )}
                </div>
                <p className="text-[12px] text-slate-400">
                  {fmtDate(o.date)} · {o.lines.length} dòng
                </p>
              </div>
              <Money value={o.total} className="text-[14.5px]" />
              <ChevronRight size={15} className="text-slate-300" />
            </Link>
          ))}
        </Card>
      )}

      {/* ===== Bảng giá ===== */}
      {tab === 'prices' && (
        <Card className="divide-y divide-slate-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <p className="text-[13px] font-semibold text-slate-500">
              Giá riêng của {customer.name}
            </p>
            <Link to={`/bang-gia?khach=${id}`} className="text-[12.5px] font-bold text-indigo-600">
              Sửa bảng giá →
            </Link>
          </div>
          {prices.length === 0 && (
            <Empty title="Chưa có bảng giá" desc="Chưa thiết lập giá riêng cho khách này" />
          )}
          {prices.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold text-slate-700">
                  {productName(data, p.productId)}
                </p>
                <p className="text-[11.5px] text-slate-400">{unitName(data, p.unitId)}</p>
              </div>
              <Money value={p.price} className="text-[13.5px] text-indigo-600" />
            </div>
          ))}
        </Card>
      )}

      <CustomerForm
        open={editOpen}
        onClose={() => setEditOpen(false)}
        initial={{
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          address: customer.address,
          note: customer.note,
          openingAmount: String(customer.openingDebt?.amount || ''),
          openingDate: customer.openingDebt?.date || todayISO(),
        }}
      />
    </div>
  )
}
