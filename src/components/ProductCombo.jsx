import { useEffect, useRef, useState } from 'react'
import { Package, Plus, ChevronDown } from 'lucide-react'
import { useStore, productName } from '../store/useStore'
import { useAction } from '../hooks/useAction'
import { normalize } from '../lib/format'
import { Input } from './ui'

/**
 * Ô nhập sản phẩm TỰ DO: gõ tên → gợi ý sản phẩm có sẵn,
 * chưa có thì "Tạo mới" ngay trong dòng (tự thêm vào danh mục).
 */
export default function ProductCombo({ value, onPick, placeholder = 'Tên sản phẩm...', tone = 'indigo' }) {
  const data = useStore()
  const run = useAction()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const wrapRef = useRef(null)
  const blurTimer = useRef(null)

  const suggestions = q.trim()
    ? data.products.filter((p) => normalize(p.name).includes(normalize(q)))
    : data.products
  const exact = data.products.find((p) => normalize(p.name) === normalize(q.trim()))
  const canCreate = q.trim().length > 0 && !exact

  const pick = (product) => {
    onPick(product)
    setQ('')
    setOpen(false)
  }

  const create = () =>
    run(async () => {
      const p = await data.addProduct(q.trim())
      onPick(p)
      setQ('')
      setOpen(false)
    })

  const close = () => {
    // gõ đúng tên sản phẩm có sẵn thì tự chọn
    if (q.trim() && exact) onPick(exact)
    setQ('')
    setOpen(false)
  }

  useEffect(() => {
    const fn = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) close()
    }
    document.addEventListener('pointerdown', fn)
    return () => document.removeEventListener('pointerdown', fn)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, exact])

  const display = open ? q : value ? productName(data, value) : ''

  return (
    <div ref={wrapRef} className="relative">
      <Package
        size={16}
        className={`pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 ${value ? `text-${tone}-500` : 'text-slate-300'}`}
      />
      <Input
        value={display}
        placeholder={placeholder}
        className={`pl-10 pr-8 ${value ? 'font-semibold' : ''}`}
        onFocus={(e) => {
          clearTimeout(blurTimer.current)
          setQ('')
          setOpen(true)
          e.target.select()
        }}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (canCreate) create()
            else if (suggestions.length) pick(suggestions[0])
          }
          if (e.key === 'Escape') {
            setQ('')
            setOpen(false)
          }
        }}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 140)
        }}
      />
      <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-300" />

      {open && (
        <div className="absolute inset-x-0 top-full z-40 mt-1.5 max-h-56 overflow-y-auto rounded-2xl border border-slate-100 bg-white p-1.5 shadow-xl">
          {canCreate && (
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault()
                create()
              }}
              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left font-semibold ${tone === 'amber' ? 'text-amber-700 hover:bg-amber-50' : 'text-indigo-700 hover:bg-indigo-50'
                }`}
            >
              <Plus size={16} />
              Tạo mới: “{q.trim()}”
            </button>
          )}
          {suggestions.length === 0 && !canCreate && (
            <p className="px-3 py-2.5 text-[13px] text-slate-400">Không có sản phẩm</p>
          )}
          {suggestions.map((p) => (
            <button
              key={p.id}
              type="button"
              onPointerDown={(e) => {
                e.preventDefault()
                pick(p)
              }}
              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[14px] hover:bg-slate-50 ${p.id === value ? `font-bold ${tone === 'amber' ? 'text-amber-700' : 'text-indigo-700'}` : 'font-medium text-slate-700'
                }`}
            >
              <Package size={15} className="shrink-0 text-slate-300" />
              <span className="truncate">{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
