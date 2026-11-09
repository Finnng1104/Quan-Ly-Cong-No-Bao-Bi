import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Undo2,
  Plus,
  Trash2,
  User,
  AlertTriangle,
  Save,
} from 'lucide-react'
import { useStore, productName, unitName, customerName } from '../store/useStore'
import { api } from '../api/httpApi'
import { useAsync } from '../hooks/useAsync'
import { useAction } from '../hooks/useAction'
import { useCustomerPrices, usePurchasedReturned } from '../hooks/customerData'
import {
  todayISO,
  fmtMoney,
  fmtDate,
  fmtQty,
  dateRangeFromSearchParams,
  describeDateRange,
  formatPriceInput,
  parsePrice,
  parseQty,
  priceToInput,
  sanitizePriceInput,
  uid,
} from '../lib/format'
import {
  Card,
  Money,
  Empty,
  Button,
  Modal,
  Field,
  Input,
  Confirm,
} from '../components/ui'
import { PickerModal, PickerButton, Avatar } from '../components/pickers'
import { ErrorCard } from '../components/AsyncState'
import ProductCombo from '../components/ProductCombo'
import { useToast } from '../components/Toast'

const PAGE_SIZE = 60

const newLine = () => ({ id: uid('l'), productId: '', unitId: '', qty: '', price: '' })

function ReturnForm({ open, onClose, presetCustomer, editing = null }) {
  const data = useStore()
  const toast = useToast()
  const run = useAction()
  const [customerId, setCustomerId] = useState(editing?.customerId || presetCustomer || '')
  const [date, setDate] = useState(editing?.date || todayISO())
  const [reason, setReason] = useState(editing?.reason || '')
  const [lines, setLines] = useState(
    editing
      ? editing.lines.map((l) => ({
          id: uid('l'),
          productId: l.productId,
          unitId: l.unitId,
          qty: String(l.qty),
          price: priceToInput(l.price),
        }))
      : [newLine()],
  )
  const [custPicker, setCustPicker] = useState(false)
  const [addingUnitFor, setAddingUnitFor] = useState(null)
  const [newUnitName, setNewUnitName] = useState('')

  const { getPrice } = useCustomerPrices(customerId)
  const boughtMap = usePurchasedReturned(customerId)

  const updateLine = (lid, patch) =>
    setLines((ls) => ls.map((l) => (l.id === lid ? { ...l, ...patch } : l)))

  const pickProduct = (lid, p) => {
    const l = lines.find((x) => x.id === lid)
    const patch = { productId: p.id }
    if (l?.unitId) {
      const pr = getPrice(p.id, l.unitId)
      if (pr !== null) patch.price = priceToInput(pr)
    }
    updateLine(lid, patch)
  }

  const pickUnit = (lid, unitId) => {
    const l = lines.find((x) => x.id === lid)
    const patch = { unitId }
    if (l?.productId) {
      const pr = getPrice(l.productId, unitId)
      if (pr !== null) patch.price = priceToInput(pr)
    }
    updateLine(lid, patch)
  }

  const total = lines.reduce((s, l) => s + Math.round(parseQty(l.qty) * parsePrice(l.price)), 0)

  const createUnitFor = (lineId) =>
    run(async () => {
      const name = newUnitName.trim()
      if (!name) return
      const unit = await data.addUnit(name)
      pickUnit(lineId, unit.id)
      setAddingUnitFor(null)
      toast.success(`Đã thêm quy cách "${unit.name}"`)
    })

  // cảnh báo trả vượt (không chặn)
  const overWarnings = lines
    .filter((l) => l.productId && l.unitId && parseQty(l.qty) > 0)
    .map((l) => {
      const cur = boughtMap.get(`${l.productId}|${l.unitId}`) || { bought: 0, returned: 0 }
      const remain = cur.bought - cur.returned
      return parseQty(l.qty) > remain
        ? `${productName(data, l.productId)}: chỉ mua ${fmtQty(cur.bought)}, đã trả ${fmtQty(cur.returned)}`
        : null
    })
    .filter(Boolean)

  const save = () => {
    if (!customerId) return toast.error('Vui lòng chọn khách')
    const valid = lines.filter((l) => l.productId && l.unitId && parseQty(l.qty) > 0)
    if (valid.length === 0) return toast.error('Cần ít nhất 1 dòng hàng trả')
    const payload = {
      customerId,
      date,
      reason,
      lines: valid.map((l) => ({
        productId: l.productId,
        unitId: l.unitId,
        qty: parseQty(l.qty),
        price: parsePrice(l.price),
      })),
    }
    return run(async () => {
      if (editing) {
        const rec = await data.editReturn(editing.id, payload)
        toast.success(`Đã sửa ${rec.code} — trừ ${fmtMoney(rec.total)} đ vào công nợ`)
      } else {
        const rec = await data.addReturn(payload)
        toast.success(`Đã tạo ${rec.code} — trừ ${fmtMoney(rec.total)} đ vào công nợ`)
      }
      onClose()
    })
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? `Sửa ${editing.code}` : 'Phiếu hàng trả'} wide>
      <div className="space-y-4">
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

        {lines.map((l, idx) => (
          <div key={l.id} className="rounded-2xl border border-slate-100 bg-slate-50/50 p-3.5">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <ProductCombo
                  tone="amber"
                  value={l.productId}
                  placeholder="Tên hàng trả..."
                  onPick={(p) => (customerId ? pickProduct(l.id, p) : toast.error('Chọn khách trước'))}
                />
              </div>
              {lines.length > 1 && (
                <button
                  onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 hover:text-rose-500"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
            <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto">
              {data.units.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => pickUnit(l.id, u.id)}
                  className={`h-8 shrink-0 rounded-lg px-3 text-[12.5px] font-semibold ${l.unitId === u.id ? 'bg-amber-500 text-white' : 'bg-white text-slate-500 border border-slate-200'
                    }`}
                >
                  {u.name}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setAddingUnitFor(addingUnitFor === l.id ? null : l.id)
                  setNewUnitName('')
                }}
                className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-dashed border-slate-300 px-3 text-[12.5px] font-semibold text-slate-400"
              >
                <Plus size={12} /> Quy cách
              </button>
            </div>
            {addingUnitFor === l.id && (
              <div className="mt-2 flex gap-2">
                <Input
                  autoFocus
                  value={newUnitName}
                  onChange={(e) => setNewUnitName(e.target.value)}
                  placeholder="Tên quy cách mới..."
                  className="h-9 flex-1 text-[13px]"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') createUnitFor(l.id)
                    if (e.key === 'Escape') setAddingUnitFor(null)
                  }}
                />
                <Button size="sm" variant="amber" className="h-9" onClick={() => createUnitFor(l.id)}>
                  Thêm
                </Button>
              </div>
            )}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Input
                inputMode="decimal"
                placeholder="Số lượng"
                value={l.qty}
                onChange={(e) => updateLine(l.id, { qty: e.target.value.replace(/[^0-9.,]/g, '') })}
                className="text-center font-semibold"
              />
              <Input
                inputMode="decimal"
                placeholder="Giá lúc bán"
                value={formatPriceInput(l.price)}
                onChange={(e) => updateLine(l.id, { price: sanitizePriceInput(e.target.value) })}
                className="text-right font-semibold"
              />
            </div>
            {idx === 0 && <p className="mt-1.5 text-xs text-slate-400">Giá có đồng lẻ thì gõ dấu phẩy, ví dụ 5250,5. Thành tiền làm tròn đến đồng.</p>}
          </div>
        ))}

        <Button variant="soft" icon={Plus} className="w-full bg-amber-50! text-amber-700!" onClick={() => setLines((ls) => [...ls, newLine()])}>
          Thêm dòng
        </Button>

        {overWarnings.length > 0 && (
          <div className="flex items-start gap-2.5 rounded-2xl bg-amber-50 p-3.5 text-[12.5px] font-semibold text-amber-700">
            <AlertTriangle size={17} className="mt-0.5 shrink-0" />
            <div>
              <p>Trả vượt số lượng đã mua:</p>
              {overWarnings.map((w, i) => (
                <p key={i} className="font-medium">• {w}</p>
              ))}
              <p className="mt-1 font-medium text-amber-500">Vẫn có thể lưu phiếu.</p>
            </div>
          </div>
        )}

        <Field label="Lý do (không bắt buộc)">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="VD: hàng lỗi, đổi ý..." />
        </Field>

        <div className="flex items-center justify-between rounded-2xl bg-slate-100 px-4 py-3">
          <span className="text-[13px] font-bold text-slate-600">TỔNG TRẢ (trừ công nợ)</span>
          <span className="text-lg font-extrabold tabular-nums text-amber-600">{fmtMoney(total)} đ</span>
        </div>
        <Button size="lg" variant="amber" icon={Save} className="w-full" onClick={save}>
          {editing ? 'Lưu thay đổi' : 'Lưu phiếu trả'}
        </Button>
      </div>

      <PickerModal
        open={custPicker}
        onClose={() => setCustPicker(false)}
        title="Chọn khách hàng"
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
    </Modal>
  )
}

export default function ReturnsPage() {
  const [sp] = useSearchParams()
  const navigate = useNavigate()
  // Set when the customer's ledger sends the user here to fix one return; we go back afterwards.
  const editParam = sp.get('sua')
  const [formOpen, setFormOpen] = useState(!!sp.get('khach'))
  const [delId, setDelId] = useState(null)
  const [editing, setEditing] = useState(null)
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [range, setRange] = useState(() => dateRangeFromSearchParams(sp))
  const [showDeleted, setShowDeleted] = useState(false)
  const data = useStore()
  const toast = useToast()
  const run = useAction()

  const { data: page, error, reload } = useAsync(
    () => api.returns.list({ from: range?.from, to: range?.to, deleted: showDeleted, limit, offset: 0 }),
    [range, showDeleted, limit, data.dataVersion],
  )
  const { data: returnFromLink } = useAsync(
    () => (editParam ? api.returns.get(editParam) : null),
    [editParam],
  )
  // A return opened from the ledger link shows its form until the user closes it.
  const [linkDismissed, setLinkDismissed] = useState(false)
  const linkedReturn = linkDismissed ? null : returnFromLink
  const formVisible = formOpen || !!linkedReturn
  const formRecord = editing ?? linkedReturn

  const returns = page?.items ?? []
  const returnCount = page?.total ?? 0

  return (
    <div className="animate-fade-up space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Hàng trả</h1>
          <p className="text-[12px] text-slate-400">Hàng trả chỉ trừ công nợ — không có kho</p>
        </div>
        <Button
          icon={Plus}
          variant="amber"
          onClick={() => {
            setEditing(null)
            setFormOpen(true)
          }}
        >
          Tạo phiếu
        </Button>
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => setShowDeleted((on) => !on)}
          aria-pressed={showDeleted}
          className={`rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition-colors active:scale-[0.97] ${
            showDeleted ? 'bg-rose-50 text-rose-600' : 'text-slate-400 hover:bg-slate-50'
          }`}
        >
          Đã xóa
        </button>
      </div>

      {range && (
        <div className="flex items-center justify-between rounded-xl bg-amber-50 px-3.5 py-2.5 text-[13px] font-semibold text-amber-700">
          <span>Đang xem {describeDateRange(range)}</span>
          <button onClick={() => setRange(null)} className="font-bold active:opacity-60">
            Xem tất cả
          </button>
        </div>
      )}

      {error && !page ? (
        <ErrorCard error={error} onRetry={reload} />
      ) : returns.length === 0 ? (
        <Card>
          <Empty icon={Undo2} title={showDeleted ? 'Chưa có phiếu trả nào bị xóa' : range ? 'Không có phiếu trả trong khoảng này' : 'Chưa có phiếu trả nào'} />
        </Card>
      ) : (
        <Card className="divide-y divide-slate-50 overflow-hidden">
          {returns.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-500">
                <Undo2 size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold text-slate-800">
                  {customerName(data, r.customerId)}
                </p>
                <p className="truncate text-[11.5px] text-slate-400">
                  {r.code} · {fmtDate(r.date)} ·{' '}
                  {r.lines
                    .map((l) => `${fmtQty(l.qty)} ${unitName(data, l.unitId)} ${productName(data, l.productId)}`)
                    .join(', ')}
                  {r.reason ? ` · ${r.reason}` : ''}
                </p>
              </div>
              <div className="text-right">
                <Money value={r.total} className="text-[14px] text-amber-600" />
                <div className="mt-0.5 flex justify-end gap-3 text-[11px] font-semibold text-slate-400">
                  {showDeleted ? (
                    <button
                      onClick={() =>
                        run(async () => {
                          await data.restoreReturn(r.id)
                          toast.success(`Đã khôi phục ${r.code}`)
                        })
                      }
                      className="text-amber-600 active:opacity-60"
                    >
                      Khôi phục
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setEditing(r)
                          setFormOpen(true)
                        }}
                        className="active:text-amber-600 hover:text-amber-600"
                      >
                        Sửa
                      </button>
                      <button onClick={() => setDelId(r.id)} className="active:text-rose-500 hover:text-rose-500">
                        Xóa
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </Card>
      )}

      {returnCount > returns.length && (
        <Button variant="outline" className="w-full" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
          Xem thêm ({returnCount - returns.length} phiếu)
        </Button>
      )}

      {/* Mounted only while open so each use starts from fresh state (blank, or the record being edited). */}
      {formVisible && (
        <ReturnForm
          open
          editing={formRecord}
          onClose={() => {
            setFormOpen(false)
            setEditing(null)
            setLinkDismissed(true)
            if (editParam) navigate(-1)
          }}
          presetCustomer={sp.get('khach')}
        />
      )}

      <Confirm
        open={!!delId}
        onClose={() => setDelId(null)}
        onConfirm={() =>
          run(async () => {
            await data.removeReturn(delId)
            toast.success('Đã xóa phiếu trả')
          })
        }
        title="Xóa phiếu trả?"
        message="Phiếu trả sẽ bị xóa và cộng lại vào công nợ của khách."
      />
    </div>
  )
}
