import { useEffect, useRef, useState } from 'react'
import { X, AlertTriangle, Inbox } from 'lucide-react'
import { fmtMoney } from '../lib/format'

// ---------- Card ----------
export function Card({ className = '', children, ...rest }) {
  return (
    <div className={`bg-white rounded-2xl shadow-sm border border-slate-100 ${className}`} {...rest}>
      {children}
    </div>
  )
}

// ---------- Button ----------
const btnVariants = {
  primary:
    'bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-md shadow-indigo-200 active:scale-[0.98]',
  soft: 'bg-indigo-50 text-indigo-700 active:bg-indigo-100',
  ghost: 'text-slate-600 active:bg-slate-100',
  danger: 'bg-rose-50 text-rose-600 active:bg-rose-100',
  success: 'bg-emerald-500 text-white shadow-md shadow-emerald-200 active:scale-[0.98]',
  amber: 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md shadow-amber-200 active:scale-[0.98]',
  outline: 'border border-slate-200 text-slate-700 bg-white active:bg-slate-50',
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  icon: Icon,
  children,
  ...rest
}) {
  const sizes = {
    sm: 'h-9 px-3 text-sm rounded-xl gap-1.5',
    md: 'h-11 px-4 text-sm rounded-xl gap-2',
    lg: 'h-12 px-5 text-base rounded-2xl gap-2',
    icon: 'h-11 w-11 rounded-xl',
  }
  return (
    <button
      className={`inline-flex items-center justify-center font-semibold transition-all disabled:opacity-50 disabled:pointer-events-none ${btnVariants[variant]} ${sizes[size]} ${className}`}
      {...rest}
    >
      {Icon && <Icon size={size === 'sm' ? 16 : 18} />}
      {children}
    </button>
  )
}

// ---------- Badge ----------
const badgeTones = {
  indigo: 'bg-indigo-50 text-indigo-700',
  emerald: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  rose: 'bg-rose-50 text-rose-600',
  slate: 'bg-slate-100 text-slate-600',
  cyan: 'bg-cyan-50 text-cyan-700',
  violet: 'bg-violet-50 text-violet-700',
}

export function Badge({ tone = 'slate', className = '', children }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${badgeTones[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

// ---------- Field ----------
export function Field({ label, hint, children }) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-[13px] font-semibold text-slate-600">{label}</span>}
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  )
}

export function Input({ className = '', ...rest }) {
  return (
    <input
      className={`h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-[15px] text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 ${className}`}
      {...rest}
    />
  )
}

export function Select({ className = '', children, ...rest }) {
  return (
    <select
      className={`h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-[15px] text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 ${className}`}
      {...rest}
    >
      {children}
    </select>
  )
}

export function Textarea({ className = '', ...rest }) {
  return (
    <textarea
      className={`w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[15px] text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 ${className}`}
      {...rest}
    />
  )
}

// ---------- Switch ----------
export function Switch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3"
    >
      {label && <span className="text-[15px] font-medium text-slate-700">{label}</span>}
      <span
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? 'bg-indigo-600' : 'bg-slate-300'
          }`}
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'
            }`}
        />
      </span>
    </button>
  )
}

// ---------- Modal ----------
export function Modal({ open, onClose, title, children, wide }) {
  useEffect(() => {
    if (!open) return
    const fn = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className={`animate-sheet sm:animate-fade-up relative w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'} max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl bg-white shadow-2xl`}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur">
          <h3 className="text-[17px] font-bold text-slate-800">{title}</h3>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

// ---------- Confirm dialog ----------
export function Confirm({ open, onClose, onConfirm, title, message, confirmText = 'Xóa', danger }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-500">
          <AlertTriangle size={20} />
        </div>
        <p className="text-[15px] leading-relaxed text-slate-600">{message}</p>
      </div>
      <div className="mt-5 flex gap-3">
        <Button variant="outline" className="flex-1" onClick={onClose}>
          Hủy
        </Button>
        <Button
          variant={danger === false ? 'primary' : 'danger'}
          className={`flex-1 ${danger === false ? '' : 'bg-rose-500! text-white!'}`}
          onClick={() => {
            onConfirm?.()
            onClose?.()
          }}
        >
          {confirmText}
        </Button>
      </div>
    </Modal>
  )
}

// ---------- Empty state ----------
export function Empty({ icon: Icon = Inbox, title = 'Chưa có dữ liệu', desc, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-indigo-50 to-blue-50 text-indigo-400">
        <Icon size={30} />
      </div>
      <p className="text-[15px] font-bold text-slate-700">{title}</p>
      {desc && <p className="mt-1 max-w-xs text-[13px] text-slate-400">{desc}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

// ---------- Skeleton ----------
export function Skeleton({ className = '' }) {
  return <div className={`skeleton ${className}`} />
}

export function SkeletonList({ rows = 5 }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  )
}

// ---------- Money ----------
export function Money({ value, className = '', sign }) {
  const n = Number(value) || 0
  const color = n < 0 ? 'text-emerald-600' : ''
  return (
    <span className={`font-semibold tabular-nums tracking-tight ${color} ${className}`}>
      {sign && n > 0 ? '+' : ''}
      {fmtMoney(n)}
      <span className="ml-0.5 text-[0.75em] font-medium text-slate-400">đ</span>
    </span>
  )
}

// ---------- Segmented tabs ----------
export function SegmentedTabs({ tabs, active, onChange }) {
  return (
    <div className="flex gap-1 rounded-2xl bg-slate-100 p-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`flex-1 rounded-xl px-3 py-2 text-[13px] font-semibold transition-all ${active === t.key ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500'
            }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ---------- Debounced input ----------
export function SearchInput({ value, onChange, placeholder, className = '' }) {
  const [v, setV] = useState(value || '')
  const t = useRef()
  useEffect(() => setV(value || ''), [value])
  return (
    <Input
      value={v}
      placeholder={placeholder}
      className={className}
      onChange={(e) => {
        setV(e.target.value)
        clearTimeout(t.current)
        t.current = setTimeout(() => onChange(e.target.value), 180)
      }}
    />
  )
}
