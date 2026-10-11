import { useState } from 'react'
import { Package, Ruler, Plus, Pencil, Trash2, Check, X } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useAction } from '../hooks/useAction'
import { Card, Empty, Button, SegmentedTabs, Input, Confirm } from '../components/ui'
import { useToast } from '../components/Toast'

function EditableRow({ name, onRename, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(name)
  return (
    <div className="flex items-center gap-2.5 px-4 py-3">
      {editing ? (
        <>
          <Input
            autoFocus
            value={v}
            onChange={(e) => setV(e.target.value)}
            className="h-9 flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && v.trim()) {
                onRename(v.trim())
                setEditing(false)
              }
              if (e.key === 'Escape') setEditing(false)
            }}
          />
          <button
            onClick={() => {
              if (v.trim()) {
                onRename(v.trim())
                setEditing(false)
              }
            }}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"
          >
            <Check size={16} />
          </button>
          <button
            onClick={() => {
              setV(name)
              setEditing(false)
            }}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-400"
          >
            <X size={16} />
          </button>
        </>
      ) : (
        <>
          <p className="flex-1 text-[14.5px] font-semibold text-slate-800">{name}</p>
          <button
            onClick={() => setEditing(true)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 hover:bg-indigo-50 hover:text-indigo-600"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={onDelete}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 hover:bg-rose-50 hover:text-rose-500"
          >
            <Trash2 size={15} />
          </button>
        </>
      )}
    </div>
  )
}

export default function ProductsPage() {
  const [tab, setTab] = useState('products')
  const [newName, setNewName] = useState('')
  const [del, setDel] = useState(null) // {type, id, name}
  const data = useStore()
  const toast = useToast()
  const run = useAction()

  const isProd = tab === 'products'
  const items = isProd ? data.products : data.units

  const add = () => {
    const name = newName.trim()
    if (!name) return
    // Clear at once so the next name can be typed while this one is being saved.
    setNewName('')
    return run(async () => {
      if (isProd) {
        await data.addProduct(name)
        toast.success('Đã thêm sản phẩm')
      } else {
        await data.addUnit(name)
        toast.success('Đã thêm quy cách')
      }
      return true
    }).then((saved) => {
      if (!saved) setNewName(name)
    })
  }

  return (
    <div className="animate-fade-up space-y-4">
      <h1 className="text-xl font-bold text-slate-800">Sản phẩm & quy cách</h1>

      <SegmentedTabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'products', label: `Sản phẩm (${data.products.length})` },
          { key: 'units', label: `Quy cách (${data.units.length})` },
        ]}
      />

      {/* thêm nhanh */}
      <Card className="flex items-center gap-2.5 p-3.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-500">
          {isProd ? <Package size={18} /> : <Ruler size={18} />}
        </div>
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={isProd ? 'Tên sản phẩm mới...' : 'Tên quy cách mới (VD: Bao, Lốc)...'}
          className="flex-1"
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <Button size="icon" icon={Plus} onClick={add} />
      </Card>

      {items.length === 0 ? (
        <Card>
          <Empty icon={isProd ? Package : Ruler} title={isProd ? 'Chưa có sản phẩm' : 'Chưa có quy cách'} />
        </Card>
      ) : (
        <Card className="divide-y divide-slate-50 overflow-hidden">
          {items.map((it) => (
            <EditableRow
              key={it.id}
              name={it.name}
              onRename={(name) =>
                run(async () => {
                  if (isProd) await data.renameProduct(it.id, name)
                  else await data.renameUnit(it.id, name)
                  toast.success('Đã đổi tên')
                })
              }
              onDelete={() => setDel({ id: it.id, name: it.name })}
            />
          ))}
        </Card>
      )}

      <Confirm
        open={!!del}
        onClose={() => setDel(null)}
        onConfirm={() =>
          run(async () => {
            if (isProd) await data.removeProduct(del.id)
            else await data.removeUnit(del.id)
            toast.success(`Đã xóa "${del.name}"`)
          })
        }
        title={isProd ? 'Xóa sản phẩm?' : 'Xóa quy cách?'}
        message={`"${del?.name}" sẽ bị xóa. Các đơn cũ vẫn giữ nguyên tên đã lưu.`}
      />
    </div>
  )
}
