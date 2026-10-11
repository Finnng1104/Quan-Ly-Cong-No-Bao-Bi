import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Tags, User, Plus, Copy, Trash2, Package } from 'lucide-react'
import { useStore, productName, unitName, customerName } from '../store/useStore'
import { api } from '../api/httpApi'
import { useAsync } from '../hooks/useAsync'
import { useAction } from '../hooks/useAction'
import { fmtMoney } from '../lib/format'
import { Card, Empty, Button, Input, Modal, Field, Confirm } from '../components/ui'
import { ErrorCard } from '../components/AsyncState'
import { PickerModal, PickerButton, Avatar } from '../components/pickers'
import { useToast } from '../components/Toast'

function PriceRow({ entry, data, onDelete }) {
  const [v, setV] = useState(String(entry.price))
  const run = useAction()
  const dirty = String(entry.price) !== v
  return (
    <div className="flex items-center gap-2.5 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-semibold text-slate-800">
          {productName(data, entry.productId)}
        </p>
        <p className="text-[11px] font-semibold text-slate-400">{unitName(data, entry.unitId)}</p>
      </div>
      <div className="w-32">
        <Input
          inputMode="numeric"
          value={v ? fmtMoney(v) : ''}
          onChange={(e) => setV(e.target.value.replace(/[^0-9]/g, ''))}
          onBlur={() => {
            if (dirty && v) {
              run(() => data.setPrice({ ...entry, customerId: entry.customerId, price: Number(v) }))
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.target.blur()
          }}
          className="h-9 text-right text-[13.5px] font-bold"
        />
      </div>
      <button
        onClick={onDelete}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-300 hover:bg-rose-50 hover:text-rose-500"
      >
        <Trash2 size={15} />
      </button>
    </div>
  )
}

export default function PriceBookPage() {
  const [sp] = useSearchParams()
  const [customerId, setCustomerId] = useState(sp.get('khach') || '')
  const [custPicker, setCustPicker] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [copyFrom, setCopyFrom] = useState(null)
  const [delId, setDelId] = useState(null)
  const [newProd, setNewProd] = useState('')
  const [newUnit, setNewUnit] = useState('')
  const [newPrice, setNewPrice] = useState('')
  const [prodPicker, setProdPicker] = useState(false)
  const data = useStore()
  const toast = useToast()
  const run = useAction()

  const { data: priceList, error, reload } = useAsync(
    async () => (customerId ? { customerId, items: await api.customers.prices(customerId) } : null),
    [customerId, data.dataVersion],
  )

  // Prices belong to the chosen customer; keep the customer id on each entry for saving edits.
  const entries = useMemo(() => {
    if (!priceList || priceList.customerId !== customerId) return []
    return priceList.items
      .map((p) => ({ ...p, customerId }))
      .sort((a, b) =>
        productName(data, a.productId).localeCompare(productName(data, b.productId), 'vi'),
      )
  }, [priceList, customerId, data])

  // Only needed while the copy dialog is open: it shows how many prices each customer has.
  const copyOpen = copyFrom !== null
  const { data: allCustomers } = useAsync(
    () => (copyOpen ? api.customers.listAll() : null),
    [copyOpen],
  )

  const addEntry = () => {
    if (!newProd || !newUnit) return toast.error('Chọn sản phẩm và quy cách')
    return run(async () => {
      await data.setPrice({
        customerId,
        productId: newProd,
        unitId: newUnit,
        price: Number(newPrice) || 0,
      })
      toast.success('Đã thêm giá')
      setAddOpen(false)
      setNewProd('')
      setNewUnit('')
      setNewPrice('')
    })
  }

  return (
    <div className="animate-fade-up space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Bảng giá theo khách</h1>
        <p className="text-[12px] text-slate-400">
          Mỗi khách một bảng giá — khóa: khách + sản phẩm + quy cách
        </p>
      </div>

      <Card className="flex items-center gap-2.5 p-3.5">
        <div className="flex-1">
          <PickerButton onClick={() => setCustPicker(true)} placeholder="Chọn khách hàng..." icon={User}>
            {customerId ? customerName(data, customerId) : null}
          </PickerButton>
        </div>
        {customerId && (
          <Button
            variant="outline"
            size="sm"
            icon={Copy}
            onClick={() => setCopyFrom('')}
          >
            Sao chép
          </Button>
        )}
      </Card>

      {!customerId ? (
        <Card>
          <Empty icon={Tags} title="Chọn một khách" desc="Chọn khách để xem và sửa bảng giá riêng" />
        </Card>
      ) : error && !priceList ? (
        <ErrorCard error={error} onRetry={reload} />
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-semibold text-slate-500">
              {entries.length} mức giá của <b className="text-slate-700">{customerName(data, customerId)}</b>
            </p>
            <Button variant="soft" size="sm" icon={Plus} onClick={() => setAddOpen(true)}>
              Thêm giá
            </Button>
          </div>

          {entries.length === 0 ? (
            <Card>
              <Empty
                icon={Tags}
                title="Chưa có giá nào"
                desc="Thêm giá hoặc sao chép bảng giá từ khách khác"
                action={
                  <Button variant="soft" size="sm" icon={Copy} onClick={() => setCopyFrom('')}>
                    Sao chép từ khách khác
                  </Button>
                }
              />
            </Card>
          ) : (
            <Card className="divide-y divide-slate-50 overflow-hidden">
              <div className="grid grid-cols-[1fr_128px_36px] gap-2.5 bg-slate-50 px-4 py-2 text-[10.5px] font-bold uppercase tracking-wide text-slate-400">
                <span>Sản phẩm / Quy cách</span>
                <span className="text-right">Giá (đ)</span>
                <span />
              </div>
              {entries.map((e) => (
                <PriceRow key={e.id} entry={e} data={data} onDelete={() => setDelId(e.id)} />
              ))}
            </Card>
          )}
          <p className="text-center text-[11.5px] text-slate-400">
            Sửa ô giá rồi chạm ra ngoài để lưu — đơn cũ không đổi
          </p>
        </>
      )}

      {/* picker khách chính */}
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

      {/* modal thêm giá */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Thêm mức giá">
        <div className="space-y-3.5">
          <Field label="Sản phẩm *">
            <PickerButton onClick={() => setProdPicker(true)} placeholder="Chọn sản phẩm..." icon={Package}>
              {newProd ? productName(data, newProd) : null}
            </PickerButton>
          </Field>
          <Field label="Quy cách *">
            <div className="grid grid-cols-3 gap-1.5">
              {data.units.map((u) => (
                <button
                  key={u.id}
                  onClick={() => setNewUnit(u.id)}
                  className={`h-10 rounded-xl text-[13px] font-semibold transition-all ${newUnit === u.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'
                    }`}
                >
                  {u.name}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Giá (đ)">
            <Input
              inputMode="numeric"
              value={newPrice ? fmtMoney(newPrice) : ''}
              onChange={(e) => setNewPrice(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="0"
              className="text-right font-bold"
            />
          </Field>
          <Button className="w-full" size="lg" onClick={addEntry}>
            Lưu giá
          </Button>
        </div>
      </Modal>

      {/* picker sản phẩm */}
      <PickerModal
        open={prodPicker}
        onClose={() => setProdPicker(false)}
        title="Chọn sản phẩm"
        items={data.products}
        getKey={(p) => p.id}
        filterText={(p) => p.name}
        onPick={(p) => {
          setNewProd(p.id)
          // tự gợi ý giá từ khách khác nếu có? để trống
        }}
        renderItem={(p) => (
          <>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-500">
              <Package size={17} />
            </div>
            <p className="flex-1 text-[14.5px] font-semibold text-slate-800">{p.name}</p>
          </>
        )}
      />

      {/* modal sao chép bảng giá */}
      <Modal open={copyFrom !== null} onClose={() => setCopyFrom(null)} title="Sao chép bảng giá">
        <p className="mb-3 text-[13px] text-slate-500">
          Chép toàn bộ giá từ khách nguồn sang <b>{customerName(data, customerId)}</b> (ghi đè giá cũ).
        </p>
        <div className="max-h-[45vh] space-y-1.5 overflow-y-auto">
          {(allCustomers ?? data.customers)
            .filter((c) => c.id !== customerId)
            .map((c) => {
              const n = c.priceCount ?? 0
              return (
                <button
                  key={c.id}
                  onClick={() =>
                    run(async () => {
                      await data.copyPrices(c.id, customerId)
                      toast.success(`Đã chép ${n} mức giá từ ${c.name}`)
                      setCopyFrom(null)
                    })
                  }
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-indigo-50/60"
                >
                  <Avatar name={c.name} />
                  <div className="flex-1">
                    <p className="text-[14px] font-semibold text-slate-800">{c.name}</p>
                    <p className="text-[11.5px] text-slate-400">
                      {allCustomers ? `${n} mức giá` : 'Đang tải...'}
                    </p>
                  </div>
                  <Copy size={15} className="text-slate-300" />
                </button>
              )
            })}
        </div>
      </Modal>

      <Confirm
        open={!!delId}
        onClose={() => setDelId(null)}
        onConfirm={() =>
          run(async () => {
            await data.removePrice(delId)
            toast.success('Đã xóa mức giá')
          })
        }
        title="Xóa mức giá?"
        message="Giá này sẽ bị xóa khỏi bảng giá của khách. Đơn đã lập không đổi."
      />
    </div>
  )
}
