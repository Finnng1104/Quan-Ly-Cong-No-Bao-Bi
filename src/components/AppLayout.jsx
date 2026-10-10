import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  PlusCircle,
  HandCoins,
  Menu,
  ReceiptText,
  Undo2,
  Package,
  Tags,
  FileText,
  Settings,
  LogOut,
  Wallet,
  X,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { fmtMoney, todayISO } from '../lib/format'
import { totalDebtAt } from '../lib/debt'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Tổng quan', end: true },
  { to: '/khach', icon: Users, label: 'Khách hàng' },
  { to: '/don-moi', icon: PlusCircle, label: 'Tạo đơn' },
  { to: '/thu-tien', icon: HandCoins, label: 'Thu tiền' },
]

const moreItems = [
  { to: '/don-hang', icon: ReceiptText, label: 'Đơn hàng' },
  { to: '/hang-tra', icon: Undo2, label: 'Hàng trả' },
  { to: '/san-pham', icon: Package, label: 'Sản phẩm & quy cách' },
  { to: '/bang-gia', icon: Tags, label: 'Bảng giá theo khách' },
  { to: '/sao-ke', icon: FileText, label: 'Sao kê công nợ' },
  { to: '/cai-dat', icon: Settings, label: 'Cài đặt' },
]

function SidebarLink({ to, icon: Icon, label, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[14px] font-semibold transition-colors ${
          isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'
        }`
      }
    >
      <Icon size={19} />
      {label}
    </NavLink>
  )
}

export default function AppLayout() {
  const [moreOpen, setMoreOpen] = useState(false)
  const logout = useStore((s) => s.logout)
  const shopName = useStore((s) => s.settings.shopName)
  const data = useStore()
  const navigate = useNavigate()
  const totalDebt = totalDebtAt(data, todayISO())

  return (
    <div className="min-h-dvh bg-slate-50">
      {/* ===== Sidebar desktop ===== */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-100 bg-white px-4 py-6 lg:flex">
        <div className="mb-6 flex items-center gap-3 px-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-blue-600 text-white shadow-md shadow-indigo-200">
            <Wallet size={20} />
          </div>
          <div>
            <p className="text-[15px] font-bold text-slate-800">{shopName}</p>
            <p className="text-xs text-slate-400">Quản lý công nợ</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {navItems.map((it) => (
            <SidebarLink key={it.to} {...it} />
          ))}
          <div className="my-3 border-t border-slate-100" />
          {moreItems.map((it) => (
            <SidebarLink key={it.to} {...it} />
          ))}
        </nav>
        <div className="rounded-2xl bg-gradient-to-br from-indigo-600 to-blue-600 p-4 text-white">
          <p className="text-xs font-medium opacity-80">Tổng công nợ hôm nay</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{fmtMoney(totalDebt)} đ</p>
        </div>
        <button
          onClick={logout}
          className="mt-4 flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[14px] font-semibold text-slate-400 hover:bg-slate-50 hover:text-rose-500"
        >
          <LogOut size={19} /> Đăng xuất
        </button>
      </aside>

      {/* ===== Header mobile ===== */}
      <header className="sticky top-0 z-20 border-b border-slate-100 bg-white/80 backdrop-blur-lg lg:hidden">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-blue-600 text-white">
            <Wallet size={18} />
          </div>
          <div className="flex-1">
            <p className="text-[15px] font-bold leading-tight text-slate-800">{shopName}</p>
            <p className="text-[11px] leading-tight text-slate-400">Quản lý công nợ</p>
          </div>
        </div>
      </header>

      {/* ===== Content ===== */}
      <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-4 lg:ml-64 lg:max-w-5xl lg:px-8 lg:pb-10">
        <Outlet />
      </main>

      {/* ===== Bottom nav mobile ===== */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-100 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg lg:hidden">
        <div className="mx-auto flex max-w-md items-stretch justify-around">
          {navItems.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-0.5 py-2 text-[10.5px] font-semibold transition-colors ${
                  isActive ? 'text-indigo-600' : 'text-slate-400'
                }`
              }
            >
              <it.icon size={22} />
              {it.label}
            </NavLink>
          ))}
          <button
            onClick={() => setMoreOpen(true)}
            className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10.5px] font-semibold text-slate-400"
          >
            <Menu size={22} />
            Thêm
          </button>
        </div>
      </nav>

      {/* ===== Sheet "Thêm" ===== */}
      {moreOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
            onClick={() => setMoreOpen(false)}
          />
          <div className="animate-sheet absolute inset-x-0 bottom-0 rounded-t-3xl bg-white p-5 pb-8 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[16px] font-bold text-slate-800">Thêm</h3>
              <button
                onClick={() => setMoreOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"
              >
                <X size={20} />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {moreItems.map((it) => (
                <button
                  key={it.to}
                  onClick={() => {
                    setMoreOpen(false)
                    navigate(it.to)
                  }}
                  className="flex flex-col items-center gap-2 rounded-2xl border border-slate-100 bg-slate-50/60 p-4 active:bg-slate-100"
                >
                  <it.icon size={22} className="text-indigo-600" />
                  <span className="text-center text-[11.5px] font-semibold leading-tight text-slate-600">
                    {it.label}
                  </span>
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                setMoreOpen(false)
                logout()
              }}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-100 py-3 text-[14px] font-semibold text-slate-400 active:bg-slate-50"
            >
              <LogOut size={17} /> Đăng xuất
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
