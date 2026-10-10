import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  Plus,
  Trash2,
  User,
  BadgeDollarSign,
  Save,
  Undo2,
  AlertTriangle,
  BadgePercent,
} from 'lucide-react'
import { useStore, customerName } from '../store/useStore'
import { purchasedReturned } from '../lib/debt'
import { todayISO, fmtMoney, fmtQty, uid } from '../lib/format'
import { Card, Button, Field, Input, Switch, Textarea } from '../components/ui'
import { PickerModal, PickerButton, Avatar } from '../components/pickers'
import ProductCombo from '../components/ProductCombo'
import { useToast } from '../components/Toast'

const newLine = (type = 'sell') => ({ id: uid('l'), type, productId: '', unitId: '', qty: '', price: '' })

export default function OrderFormPage() {
  const { id: orderId } = useParams() // có = sửa đơn
  const [sp] = useSearchParams()
  const navigate = useNavigate()
  const data = useStore()
  const toast = useToast()
  const { saveOrder, setOrderDraft, clearOrderDraft, setPrice } = data

  const editing = orderId ? data.orders.find((o) => o.id === orderId) : null

  const [customerId, setCustomerId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [vatEnabled, setVatEnabled] = useState(false)
  const [vatManual, setVatManual] = useState('') // tiền VAT nhập tay (để trống = tự tính)
  const [note, setNote] = useState('')
  const [lines, setLines] = useState([newLine()])
  const [custPicker, setCustPicker] = useState(false)
  const [addingUnitFor, setAddingUnitFor] = useState(null) // lineId đang thêm quy cách
  const [newUnitName, setNewUnitName] = useState('')
  const hydrated = useRef(false)

  // nạp đơn sửa hoặc nháp
  useEffect(() => {
    if (hydrated.current) return
    hydrated.current = true
    if (editing) {
      setCustomerId(editing.customerId)
      setDate(editing.date)
      setVatEnabled(!!editing.vat)
      setVatManual(editing.vat?.manual ? String(editing.vat.amount) : '')
      setNote(editing.note || '')
      setLines(
        editing.lines.map((l) => ({
          id: l.id,
          type: l.type || 'sell',
          productId: l.productId,
          unitId: l.unitId,
          qty: String(l.qty),
          price: String(l.price),
        })),
      )
    } else if (data.orderDraft && !sp.get('khach')) {
      setCustomerId(data.orderDraft.customerId || '')
      setDate(data.orderDraft.date || todayISO())
      setVatEnabled(!!data.orderDraft.vatEnabled)
      setVatManual(data.orderDraft.vatManual || '')
      setNote(data.orderDraft.note || '')
      setLines(data.orderDraft.lines?.length ? data.orderDraft.lines : [newLine()])
      if (data.orderDraft.customerId) toast.info('Đã khôi phục đơn đang nhập dở')
    } else if (sp.get('khach')) {
      setCustomerId(sp.get('khach'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // lưu nháp (chỉ khi tạo mới)
  useEffect(() => {
    if (editing || !hydrated.current) return
    const t = setTimeout(() => {
      if (customerId || lines.some((l) => l.productId)) {
        setOrderDraft({ customerId, date, lines, vatEnabled, vatManual, note })
      }
    }, 400)
    return () => clearTimeout(t)
  }, [customerId, date, lines, vatEnabled, vatManual, note, editing, setOrderDraft])

  const lineAmount = (l) => Math.round((Number(l.qty) || 0) * (Number(l.price) || 0))
  const signedAmount = (l) => (l.type === 'return' ? -lineAmount(l) : lineAmount(l))
  const goodsTotal = lines.reduce((s, l) => s + signedAmount(l), 0)
  const sellTotal = lines.reduce(
    (s, l) => s + (l.type === 'return' ? 0 : lineAmount(l)),
    0,
  )
  const totalReturn = lines.reduce(
    (s, l) => s + (l.type === 'return' ? lineAmount(l) : 0),
    0,
  )
  const vatRate = data.settings.vatRate ?? 8
  const vatAuto = Math.round(sellTotal * (vatRate / 100))
  const vatAmount = vatEnabled ? (vatManual !== '' ? Number(vatManual) || 0 : vatAuto) : 0
  const total = goodsTotal + vatAmount

  const updateLine = (lid, patch) =>
    setLines((ls) => ls.map((l) => (l.id === lid ? { ...l, ...patch } : l)))

  const pickProduct = (lid, product) => {
    const l = lines.find((x) => x.id === lid)
    const unitId = l?.unitId || ''
    // nếu đã chọn quy cách thì tự điền giá
    const patch = { productId: product.id }
    if (unitId) {
      const p = data.getPrice(customerId, product.id, unitId)
      if (p !== null) patch.price = String(p)
    }
    updateLine(lid, patch)
  }

  const boughtMap = useMemo(
    () => (customerId ? purchasedReturned(customerId, data) : new Map()),
    [customerId, data],
  )

  const pickUnit = (lid, unitId) => {
    const l = lines.find((x) => x.id === lid)
    const patch = { unitId }
    if (l?.productId) {
      const p = data.getPrice(customerId, l.productId, unitId)
      if (p !== null) patch.price = String(p)
    }
    updateLine(lid, patch)
  }

  const save = () => {
    if (!customerId) {
      toast.error('Vui lòng chọn khách hàng')
      return
    }
    const valid = lines.filter((l) => l.productId && l.unitId && Number(l.qty) > 0)
    if (valid.length === 0) {
      toast.error('Đơn cần ít nhất 1 dòng hàng hợp lệ')
      return
    }
    const saved = saveOrder(
      {
        customerId,
        date,
        lines: valid.map((l) => ({ ...l, qty: Number(l.qty), price: Number(l.price) || 0 })),
        vat: vatEnabled,
        vatRate,
        vatAmount: vatManual !== '' ? Number(vatManual) || 0 : undefined,
        note: note.trim(),
      },
      editing?.id,
    )
    clearOrderDraft()
    toast.success(editing ? `Đã cập nhật ${saved.code}` : `Đã tạo ${saved.code}`)
    navigate(`/don-hang/${saved.id}`, { replace: true })
  }

  return (
    <div className="animate-fade-up space-y-4 pb-24">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold text-slate-800">
            {editing ? `Sửa ${editing.code}` : 'Hóa đơn bán lẻ'}
          </h1>
          {editing && <p className="text-[11.5px] text-violet-500">Sửa xong công nợ tự cập nhật</p>}
        </div>
        <div className="w-[136px] shrink-0">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      {/* chọn khách */}
      <Card className="p-4">
        <Field label="Khách hàng *">
          <PickerButton onClick={() => setCustPicker(true)} placeholder="Chọn khách hàng..." icon={User}>
            {customerId ? customerName(data, customerId) : null}
          </PickerButton>
        </Field>
      </Card>

      {/* dòng hàng */}
      <div className="space-y-3">
        {lines.map((l, idx) => {
          const isReturn = l.type === 'return'
          const bookPrice =
            l.productId && l.unitId ? data.getPrice(customerId, l.productId, l.unitId) : null
          const priceDiffers =
            l.productId && l.unitId && l.price !== '' && Number(l.price) !== bookPrice
          // cảnh báo trả vượt đã mua (không chặn)
          const pr = l.productId && l.unitId ? boughtMap.get(`${l.productId}|${l.unitId}`) : null
          const overReturn =
            isReturn && pr && Number(l.qty) > 0 && Number(l.qty) > pr.bought - pr.returned
          return (
            <Card key={l.id} className={`p-4 ${isReturn ? 'border-amber-200 bg-amber-50/40' : ''}`}>
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-bold ${isReturn ? 'bg-amber-100 text-amber-600' : 'bg-indigo-50 text-indigo-600'
                      }`}
                  >
                    {idx + 1}
                  </span>
                  {/* toggle Bán / Trả — gộp hàng trả chung phiếu */}
                  <div className="flex rounded-xl bg-slate-100 p-0.5">
                    <button
                      type="button"
                      onClick={() => updateLine(l.id, { type: 'sell' })}
                      className={`h-7 rounded-[10px] px-3 text-[12px] font-bold transition-all ${!isReturn ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-400'
                        }`}
                    >
                      Bán
                    </button>
                    <button
                      type="button"
                      onClick={() => updateLine(l.id, { type: 'return' })}
                      className={`flex h-7 items-center gap-1 rounded-[10px] px-3 text-[12px] font-bold transition-all ${isReturn ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-400'
                        }`}
                    >
                      <Undo2 size={12} />
                      Trả
                    </button>
                  </div>
                </div>
                {lines.length > 1 && (
                  <button
                    onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:bg-rose-50 hover:text-rose-500"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>

              {/* sản phẩm — nhập tự do + gợi ý + tạo nhanh */}
              <ProductCombo
                value={l.productId}
                tone={isReturn ? 'amber' : 'indigo'}
                placeholder={isReturn ? 'Tên hàng trả...' : 'Tên sản phẩm...'}
                onPick={(p) => pickProduct(l.id, p)}
              />

              {/* quy cách — chips chọn nhanh + thêm mới tại chỗ */}
              <div className="no-scrollbar mt-2.5 flex gap-1.5 overflow-x-auto">
                {data.units.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => pickUnit(l.id, u.id)}
                    className={`h-9 shrink-0 rounded-xl px-3.5 text-[13px] font-semibold transition-all ${l.unitId === u.id
                      ? isReturn
                        ? 'bg-amber-500 text-white shadow-sm shadow-amber-200'
                        : 'bg-indigo-600 text-white shadow-sm shadow-indigo-200'
                      : 'bg-slate-100 text-slate-500 active:bg-slate-200'
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
                  className="flex h-9 shrink-0 items-center gap-1 rounded-xl border border-dashed border-slate-300 px-3 text-[13px] font-semibold text-slate-400 active:bg-slate-50"
                >
                  <Plus size={13} /> Quy cách
                </button>
              </div>
              {addingUnitFor === l.id && (
                <div className="mt-2 flex gap-2">
                  <Input
                    autoFocus
                    value={newUnitName}
                    onChange={(e) => setNewUnitName(e.target.value)}
                    placeholder="Tên quy cách mới (VD: Bao, Lốc)..."
                    className="h-9 flex-1 text-[13px]"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newUnitName.trim()) {
                        const u = data.addUnit(newUnitName.trim())
                        pickUnit(l.id, u.id)
                        setAddingUnitFor(null)
                        toast.success(`Đã thêm quy cách "${u.name}"`)
                      }
                      if (e.key === 'Escape') setAddingUnitFor(null)
                    }}
                  />
                  <Button
                    size="sm"
                    className="h-9"
                    onClick={() => {
                      if (!newUnitName.trim()) return
                      const u = data.addUnit(newUnitName.trim())
                      pickUnit(l.id, u.id)
                      setAddingUnitFor(null)
                      toast.success(`Đã thêm quy cách "${u.name}"`)
                    }}
                  >
                    Thêm
                  </Button>
                </div>
              )}

              {/* SL + giá + thành tiền */}
              <div className="mt-2.5 grid grid-cols-[1fr_1fr_auto] items-end gap-2.5">
                <Field label="Số lượng">
                  <Input
                    inputMode="decimal"
                    value={l.qty}
                    onChange={(e) => updateLine(l.id, { qty: e.target.value.replace(/[^0-9.,]/g, '') })}
                    placeholder="0"
                    className="text-center font-semibold"
                  />
                </Field>
                <Field label="Giá">
                  <Input
                    inputMode="numeric"
                    value={l.price}
                    onChange={(e) => updateLine(l.id, { price: e.target.value.replace(/[^0-9]/g, '') })}
                    placeholder="0"
                    className="text-right font-semibold"
                  />
                </Field>
                <div className="pb-1 text-right">
                  <p className="text-[10.5px] font-semibold uppercase text-slate-400">Thành tiền</p>
                  <p
                    className={`text-[16px] font-bold tabular-nums ${isReturn ? 'text-amber-600' : 'text-slate-800'
                      }`}
                  >
                    {isReturn && lineAmount(l) > 0 ? '-' : ''}
                    {fmtMoney(lineAmount(l))}
                  </p>
                </div>
              </div>

              {/* gợi ý lưu bảng giá */}
              {priceDiffers && customerId && (
                <button
                  onClick={() => {
                    setPrice({
                      customerId,
                      productId: l.productId,
                      unitId: l.unitId,
                      price: Number(l.price),
                    })
                    toast.success(
                      bookPrice === null ? 'Đã lưu giá cho khách này' : 'Đã cập nhật bảng giá',
                    )
                  }}
                  className="mt-2 flex items-center gap-1.5 rounded-lg bg-cyan-50 px-2.5 py-1.5 text-[12px] font-semibold text-cyan-700"
                >
                  <BadgeDollarSign size={14} />
                  {bookPrice === null
                    ? 'Lưu làm giá của khách này'
                    : `Cập nhật bảng giá (${fmtMoney(bookPrice)} → ${fmtMoney(l.price)})`}
                </button>
              )}
              {l.productId && l.unitId && bookPrice === null && l.price === '' && (
                <p className="mt-2 text-[11.5px] text-amber-500">
                  Chưa có giá trong bảng giá — nhập tay rồi có thể lưu lại
                </p>
              )}
              {overReturn && (
                <p className="mt-2 flex items-center gap-1.5 text-[11.5px] font-semibold text-amber-600">
                  <AlertTriangle size={13} />
                  Trả vượt đã mua (mua {fmtQty(pr.bought)}, đã trả {fmtQty(pr.returned)}) — vẫn lưu được
                </p>
              )}
            </Card>
          )
        })}
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <Button
          variant="soft"
          icon={Plus}
          onClick={() => setLines((ls) => [...ls, newLine('sell')])}
        >
          Thêm hàng bán
        </Button>
        <Button
          variant="soft"
          icon={Undo2}
          className="bg-amber-50! text-amber-700!"
          onClick={() => setLines((ls) => [...ls, newLine('return')])}
        >
          Thêm hàng trả
        </Button>
      </div>

      {/* VAT hóa đơn — cộng vào công nợ khách */}
      <Card className="p-4">
        <Switch
          checked={vatEnabled}
          onChange={setVatEnabled}
          label={`Xuất hóa đơn — thu tiền VAT ${vatRate}%`}
        />
        {vatEnabled && (
          <div className="mt-2.5 space-y-2 rounded-xl bg-indigo-50/60 px-3.5 py-2.5">
            <div className="flex justify-between text-[13px] font-semibold text-slate-500">
              <span>Tổng hàng bán</span>
              <span className="tabular-nums">{fmtMoney(sellTotal)} đ</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="flex flex-1 items-center gap-1.5 text-[13px] font-semibold text-indigo-700">
                <BadgePercent size={14} /> Tiền VAT hóa đơn
              </span>
              <div className="relative w-36">
                <Input
                  inputMode="numeric"
                  value={vatManual !== '' ? fmtMoney(vatManual) : fmtMoney(vatAuto)}
                  onChange={(e) => setVatManual(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder={fmtMoney(vatAuto)}
                  className={`h-9 pr-7 text-right text-[13.5px] font-bold ${vatManual !== '' ? 'border-indigo-400 bg-white' : ''
                    }`}
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] font-semibold text-slate-400">
                  đ
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between text-[11px] font-medium text-slate-400">
              <span>
                {vatManual !== ''
                  ? `Đang nhập tay (tự tính ${vatRate}% = ${fmtMoney(vatAuto)} đ)`
                  : `Tự tính ${vatRate}% — chạm để nhập tay`}
              </span>
              {vatManual !== '' && (
                <button
                  onClick={() => setVatManual('')}
                  className="font-bold text-indigo-600"
                >
                  Về tự tính
                </button>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* ghi chú phiếu */}
      <Card className="p-4">
        <Field label="Ghi chú (hiện trên phiếu)">
          <Textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="VD: giao trước 5h chiều, thiếu 2 cây giao sau..."
          />
        </Field>
      </Card>

      {/* thanh tổng cố định */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-100 bg-white/95 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Tổng đơn hàng
            </p>
            <p className="text-[22px] font-extrabold tabular-nums leading-tight text-indigo-700">
              {fmtMoney(total)} <span className="text-sm font-semibold text-indigo-300">đ</span>
            </p>
            <div className="flex gap-2 text-[11px] font-semibold">
              {totalReturn > 0 && (
                <span className="text-amber-600">trừ trả {fmtMoney(totalReturn)}đ</span>
              )}
              {vatAmount > 0 && (
                <span className="text-indigo-500">+VAT {fmtMoney(vatAmount)}đ</span>
              )}
            </div>
          </div>
          <Button size="lg" icon={Save} className="min-w-[140px]" onClick={save}>
            {editing ? 'Lưu sửa' : 'Lưu đơn'}
          </Button>
        </div>
      </div>

      {/* picker khách */}
      <PickerModal
        open={custPicker}
        onClose={() => setCustPicker(false)}
        title="Chọn khách hàng"
        items={data.customers}
        getKey={(c) => c.id}
        filterText={(c) => `${c.name} ${c.phone}`}
        searchPlaceholder="Tìm theo tên hoặc SĐT..."
        onPick={(c) => setCustomerId(c.id)}
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

    </div>
  )
}
