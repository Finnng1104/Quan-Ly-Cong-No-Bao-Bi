import { useMemo, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { normalize } from '../lib/format'
import { Modal, Input, Empty } from './ui'

// ===== Picker modal tổng quát: danh sách có tìm kiếm, mượt với ~1000 khách =====
export function PickerModal({
  open,
  onClose,
  title,
  items,
  getKey,
  filterText,
  renderItem,
  onPick,
  searchPlaceholder = 'Tìm kiếm...',
  footer,
  pageSize = 60,
}) {
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(pageSize)

  const filtered = useMemo(() => {
    const nq = normalize(q)
    const list = nq ? items.filter((it) => normalize(filterText(it)).includes(nq)) : items
    return list
  }, [items, q, filterText])

  const shown = filtered.slice(0, limit)

  const pick = (it) => {
    setQ('')
    setLimit(pageSize)
    onPick(it)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={title} wide>
      <div className="sticky -top-5 z-10 -mx-5 mb-3 bg-white px-5 pb-3 pt-1">
        <div className="relative">
          <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setLimit(pageSize)
            }}
            placeholder={searchPlaceholder}
            className="pl-10"
          />
        </div>
      </div>
      {shown.length === 0 ? (
        <Empty title="Không tìm thấy" desc={`Không có kết quả cho "${q}"`} />
      ) : (
        <div className="max-h-[52vh] space-y-1.5 overflow-y-auto overscroll-contain">
          {shown.map((it) => (
            <button
              key={getKey(it)}
              onClick={() => pick(it)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-indigo-50/60 active:bg-indigo-50"
            >
              {renderItem(it)}
            </button>
          ))}
          {filtered.length > shown.length && (
            <button
              onClick={() => setLimit((l) => l + pageSize)}
              className="w-full rounded-xl py-2.5 text-center text-[13px] font-semibold text-indigo-600 hover:bg-indigo-50"
            >
              Xem thêm ({filtered.length - shown.length})
            </button>
          )}
        </div>
      )}
      {footer && <div className="mt-3 border-t border-slate-100 pt-3">{footer}</div>}
    </Modal>
  )
}

// ===== Nút mở picker dạng select =====
export function PickerButton({ onClick, children, placeholder, icon: Icon = ChevronDown, invalid }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-11 w-full items-center justify-between gap-2 rounded-xl border bg-white px-3.5 text-left text-[15px] outline-none transition focus:ring-2 focus:ring-indigo-100 ${invalid ? 'border-rose-300' : 'border-slate-200 focus:border-indigo-400'
        }`}
    >
      <span className={`truncate ${children ? 'text-slate-800' : 'text-slate-400'}`}>
        {children || placeholder}
      </span>
      <Icon size={17} className="shrink-0 text-slate-400" />
    </button>
  )
}

// ===== Avatar chữ cái =====
const avatarColors = [
  'bg-indigo-100 text-indigo-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-600',
  'bg-cyan-100 text-cyan-700',
  'bg-violet-100 text-violet-700',
  'bg-blue-100 text-blue-700',
  'bg-pink-100 text-pink-600',
]

export function Avatar({ name, className = 'h-10 w-10 text-sm' }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase()
  let h = 0
  for (const ch of name || '') h = (h * 31 + ch.charCodeAt(0)) % 997
  const color = avatarColors[h % avatarColors.length]
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-full font-bold ${color} ${className}`}>
      {initial}
    </div>
  )
}
