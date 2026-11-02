import { useState } from 'react'
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
  NotebookPen,
  Trash2,
} from 'lucide-react'
import { useStore, productName, unitName } from '../store/useStore'
import { api } from '../api/httpApi'
import { useAsync } from '../hooks/useAsync'
import { useAction } from '../hooks/useAction'
import { useCustomerPrices } from '../hooks/customerData'
import { fmtMoney, fmtDate, todayISO } from '../lib/format'
import {
  Card,
  Money,
  Badge,
  SegmentedTabs,
  Empty,
  Button,
  Modal,
  Field,
  Input,
  Confirm,
} from '../components/ui'
import { ErrorCard } from '../components/AsyncState'
import { CustomerForm } from './CustomersPage'
import { useToast } from '../components/Toast'

const LEDGER_PAGE_SIZE = 100

const kindMeta = {
  opening: { label: 'Nợ đầu kỳ', tone: 'slate' },
  order: { label: 'Đơn hàng', tone: 'indigo' },
  return: { label: 'Trả hàng', tone: 'amber' },
  payment: { label: 'Thanh toán', tone: 'emerald' },
  adjust: { label: 'Phát sinh', tone: 'cyan' },
}

const NOTE_SUGGESTIONS = ['Tiền ship', 'Tiền VAT hóa đơn số', 'Phí giao hàng', 'Bớt nợ khách quen']

function AdjustmentForm({ open, onClose, customer, data }) {
  const [dir, setDir] = useState(1) // 1 = cộng nợ, -1 = trừ nợ
  const [date, setDate] = useState(todayISO())
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const toast = useToast()
  const run = useAction()

  const save = () => {
    const amt = Number(amount)
    if (!amt || amt <= 0) return toast.error('Nhập số tiền phát sinh')
    return run(async () => {
      await data.addAdjustment({ customerId: customer.id, date, amount: amt * dir, note: note.trim() })
      toast.success(dir > 0 ? `Đã cộng ${fmtMoney(amt)} đ vào công nợ` : `Đã trừ ${fmtMoney(amt)} đ khỏi công nợ`)
      onClose()
    })
  }

  return (
    <Modal open={open} onClose={onClose} title={`Phát sinh — ${customer.name}`}>
      <div className="space-y-3.5">
        <Field label="Loại phát sinh">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setDir(1)}
              className={`h-11 rounded-xl text-[14px] font-bold transition-all ${dir === 1 ? 'bg-rose-500 text-white shadow-md shadow-rose-200' : 'bg-slate-100 text-slate-400'
                }`}
            >
              + Cộng nợ
            </button>
            <button
              onClick={() => setDir(-1)}
              className={`h-11 rounded-xl text-[14px] font-bold transition-all ${dir === -1 ? 'bg-emerald-500 text-white shadow-md shadow-emerald-200' : 'bg-slate-100 text-slate-400'
                }`}
            >
              − Trừ nợ
            </button>
          </div>
        </Field>
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label="Số tiền *">
            <Input
              inputMode="numeric"
              value={amount ? fmtMoney(amount) : ''}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="0"
              className="text-right font-bold"
            />
          </Field>
          <Field label="Ngày">
            <div className="w-[136px]">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </Field>
        </div>
        <Field label="Ghi chú">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: Tiền ship, Tiền VAT hóa đơn số..." />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {NOTE_SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setNote(s)}
              className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors ${note === s ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'
                }`}
            >
              {s}
            </button>
          ))}
        </div>
        <Button size="lg" className="w-full" icon={NotebookPen} onClick={save}>
          Lưu phát sinh
        </Button>
      </div>
    </Modal>
  )
}

export default function CustomerDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const data = useStore()
  const customer = data.customers.find((c) => c.id === id)
  const [date, setDate] = useState(todayISO())
  const [tab, setTab] = useState('ledger')
  const [editOpen, setEditOpen] = useState(false)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [delAdjust, setDelAdjust] = useState(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [ledgerLimit, setLedgerLimit] = useState(LEDGER_PAGE_SIZE)
  const toast = useToast()
  const run = useAction()
  const dataVersion = data.dataVersion

  // The server computes the balance and the running totals; only the newest rows are fetched.
  const {
    data: ledgerPage,
    error: ledgerError,
    reload: reloadLedger,
  } = useAsync(
    () => api.customers.ledger(id, { until: date, limit: ledgerLimit, offset: 0 }),
    [id, date, ledgerLimit, dataVersion],
  )
  const { data: orderPage } = useAsync(
    () => api.orders.list({ customerId: id, limit: 200 }),
    [id, dataVersion],
  )
  const { prices } = useCustomerPrices(id)

  const balance = ledgerPage?.balance ?? 0
  const ledger = ledgerPage?.items ?? []
  const orders = orderPage?.items ?? []
  const orderCount = orderPage?.total ?? 0

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
        <Button variant="outline" size="icon" onClick={() => setDeleteOpen(true)} aria-label="Xóa khách">
          <Trash2 size={17} />
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
      <div className="grid grid-cols-5 gap-2">
        <Link
          to={`/don-moi?khach=${id}`}
          className="flex flex-col items-center gap-1.5 rounded-2xl bg-indigo-600 py-3 text-white shadow-md shadow-indigo-200 active:scale-[0.97]"
        >
          <PlusCircle size={19} />
          <span className="text-[10.5px] font-semibold">Tạo đơn</span>
        </Link>
        <Link
          to={`/hang-tra?khach=${id}`}
          className="flex flex-col items-center gap-1.5 rounded-2xl bg-amber-500 py-3 text-white shadow-md shadow-amber-200 active:scale-[0.97]"
        >
          <Undo2 size={19} />
          <span className="text-[10.5px] font-semibold">Hàng trả</span>
        </Link>
        <button
          onClick={() => setAdjustOpen(true)}
          className="flex flex-col items-center gap-1.5 rounded-2xl bg-violet-600 py-3 text-white shadow-md shadow-violet-200 active:scale-[0.97]"
        >
          <NotebookPen size={19} />
          <span className="text-[10.5px] font-semibold">Phát sinh</span>
        </button>
        <Link
          to={`/thu-tien?khach=${id}`}
          className="flex flex-col items-center gap-1.5 rounded-2xl bg-emerald-500 py-3 text-white shadow-md shadow-emerald-200 active:scale-[0.97]"
        >
          <HandCoins size={19} />
          <span className="text-[10.5px] font-semibold">Thu tiền</span>
        </Link>
        <Link
          to={`/sao-ke?khach=${id}`}
          className="flex flex-col items-center gap-1.5 rounded-2xl bg-cyan-600 py-3 text-white shadow-md shadow-cyan-200 active:scale-[0.97]"
        >
          <FileText size={19} />
          <span className="text-[10.5px] font-semibold">Sao kê</span>
        </Link>
      </div>

      <SegmentedTabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'ledger', label: 'Sổ công nợ' },
          { key: 'orders', label: `Đơn hàng (${orderCount})` },
          { key: 'prices', label: `Bảng giá (${prices.length})` },
        ]}
      />

      {/* ===== Sổ công nợ ===== */}
      {tab === 'ledger' && ledgerError && !ledgerPage && (
        <ErrorCard error={ledgerError} onRetry={reloadLedger} />
      )}
      {tab === 'ledger' && (ledgerPage || !ledgerError) && (
        <Card className="divide-y divide-slate-50 overflow-hidden">
          {ledgerPage && ledger.length === 0 && (
            <Empty title="Chưa có phát sinh" desc={`Đến ${fmtDate(date)} chưa có giao dịch nào`} />
          )}
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
                  {r.edited && (
                    <Badge tone="violet">
                      <History size={10} /> Đã điều chỉnh
                    </Badge>
                  )}
                </div>
              </div>
              <div className="text-right">
                {r.up > 0 && <p className="text-[13.5px] font-bold text-rose-500 tabular-nums">+{fmtMoney(r.up)}</p>}
                {r.down > 0 && <p className="text-[13.5px] font-bold text-emerald-600 tabular-nums">-{fmtMoney(r.down)}</p>}
                <div className="flex items-center justify-end gap-1.5">
                  <p className="text-[11px] font-semibold text-slate-400 tabular-nums">
                    dư {fmtMoney(r.balance)}
                  </p>
                  {r.kind === 'adjust' && (
                    <button
                      onClick={(e) => {
                        e.preventDefault()
                        setDelAdjust(r.refId)
                      }}
                      className="text-slate-300 hover:text-rose-500"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </Card>
      )}
      {tab === 'ledger' && ledgerPage && ledgerPage.total > ledger.length && (
        <Button variant="outline" className="w-full" onClick={() => setLedgerLimit((n) => n + LEDGER_PAGE_SIZE)}>
          Xem thêm ({ledgerPage.total - ledger.length} dòng cũ hơn)
        </Button>
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
                  {o.editCount > 0 && (
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
              <span className="text-[13.5px] font-bold tabular-nums text-indigo-600">{fmtPrice(p.price)} đ</span>
            </div>
          ))}
        </Card>
      )}

      <AdjustmentForm
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        customer={customer}
        data={data}
      />

      <Confirm
        open={!!delAdjust}
        onClose={() => setDelAdjust(null)}
        onConfirm={() =>
          run(async () => {
            await data.removeAdjustment(delAdjust)
            toast.success('Đã xóa phát sinh')
          })
        }
        title="Xóa phát sinh?"
        message="Khoản phát sinh sẽ bị xóa và công nợ cập nhật lại."
      />

      <Confirm
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() =>
          run(async () => {
            await data.removeCustomer(customer.id)
            toast.success('Đã xóa khách')
            navigate('/khach', { replace: true })
          })
        }
        title={`Xóa khách ${customer.name}?`}
        message="Khách sẽ biến khỏi danh sách và không còn tính vào tổng công nợ. Đơn và thanh toán cũ vẫn được giữ trong dữ liệu."
      />

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
