import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  Plus,
  Trash2,
  User,
  Package,
  BadgeDollarSign,
  Save,
} from 'lucide-react'
import { useStore, productName, customerName } from '../store/useStore'
import { todayISO, fmtMoney, uid } from '../lib/format'
import { Card, Button, Field, Input } from '../components/ui'
import { PickerModal, PickerButton, Avatar } from '../components/pickers'
import { useToast } from '../components/Toast'

const newLine = () => ({ id: uid('l'), productId: '', unitId: '', qty: '', price: '' })

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
  const [lines, setLines] = useState([newLine()])
  const [custPicker, setCustPicker] = useState(false)
  const [prodPickerFor, setProdPickerFor] = useState(null) // lineId
  const hydrated = useRef(false)

  // nạp đơn sửa hoặc nháp
  useEffect(() => {
    if (hydrated.current) return
    hydrated.current = true
    if (editing) {
      setCustomerId(editing.customerId)
      setDate(editing.date)
      setLines(
        editing.lines.map((l) => ({
          id: l.id,
          productId: l.productId,
          unitId: l.unitId,
          qty: String(l.qty),
          price: String(l.price),
        })),
      )
    } else if (data.orderDraft && !sp.get('khach')) {
      setCustomerId(data.orderDraft.customerId || '')
      setDate(data.orderDraft.date || todayISO())
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
        setOrderDraft({ customerId, date, lines })
      }
    }, 400)
    return () => clearTimeout(t)
  }, [customerId, date, lines, editing, setOrderDraft])

  const lineAmount = (l) => Math.round((Number(l.qty) || 0) * (Number(l.price) || 0))
  const total = lines.reduce((s, l) => s + lineAmount(l), 0)

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
          const bookPrice =
            l.productId && l.unitId ? data.getPrice(customerId, l.productId, l.unitId) : null
          const priceDiffers =
            l.productId && l.unitId && l.price !== '' && Number(l.price) !== bookPrice
          return (
            <Card key={l.id} className="p-4">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-50 text-[12px] font-bold text-indigo-600">
                  {idx + 1}
                </span>
                {lines.length > 1 && (
                  <button
                    onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:bg-rose-50 hover:text-rose-500"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>

              {/* sản phẩm */}
              <PickerButton
                onClick={() => customerId ? setProdPickerFor(l.id) : toast.error('Chọn khách trước')}
                placeholder="Chọn sản phẩm..."
                icon={Package}
              >
                {l.productId ? productName(data, l.productId) : null}
              </PickerButton>

              {/* quy cách — chips chọn nhanh */}
              <div className="no-scrollbar mt-2.5 flex gap-1.5 overflow-x-auto">
                {data.units.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => pickUnit(l.id, u.id)}
                    className={`h-9 shrink-0 rounded-xl px-3.5 text-[13px] font-semibold transition-all ${l.unitId === u.id
                      ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-200'
                      : 'bg-slate-100 text-slate-500 active:bg-slate-200'
                      }`}
                  >
                    {u.name}
                  </button>
                ))}
              </div>

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
                  <p className="text-[16px] font-bold tabular-nums text-slate-800">
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
            </Card>
          )
        })}
      </div>

      <Button
        variant="soft"
        icon={Plus}
        className="w-full"
        onClick={() => setLines((ls) => [...ls, newLine()])}
      >
        Thêm dòng
      </Button>

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

      {/* picker sản phẩm */}
      <PickerModal
        open={!!prodPickerFor}
        onClose={() => setProdPickerFor(null)}
        title="Chọn sản phẩm"
        items={data.products}
        getKey={(p) => p.id}
        filterText={(p) => p.name}
        searchPlaceholder="Tìm sản phẩm..."
        onPick={(p) => pickProduct(prodPickerFor, p)}
        renderItem={(p) => (
          <>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-500">
              <Package size={17} />
            </div>
            <p className="flex-1 text-[14.5px] font-semibold text-slate-800">{p.name}</p>
          </>
        )}
      />
    </div>
  )
}
