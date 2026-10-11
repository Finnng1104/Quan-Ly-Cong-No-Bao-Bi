import { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Loader2, WifiOff } from 'lucide-react'
import { useStore } from './store/useStore'
import { Button } from './components/ui'
import AppLayout from './components/AppLayout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import CustomersPage from './pages/CustomersPage'
import CustomerDetailPage from './pages/CustomerDetailPage'
import OrderFormPage from './pages/OrderFormPage'
import OrderDetailPage from './pages/OrderDetailPage'
import OrdersPage from './pages/OrdersPage'
import ReturnsPage from './pages/ReturnsPage'
import PaymentsPage from './pages/PaymentsPage'
import ProductsPage from './pages/ProductsPage'
import PriceBookPage from './pages/PriceBookPage'
import StatementPage from './pages/StatementPage'
import SettingsPage from './pages/SettingsPage'

function RequireAuth({ children }) {
  const authed = useStore((s) => s.authed)
  const loc = useLocation()
  if (!authed) return <Navigate to="/dang-nhap" state={{ from: loc.pathname }} replace />
  return children
}

function FullPageMessage({ children }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-slate-50 p-6 text-center">
      {children}
    </div>
  )
}

export default function App() {
  const ready = useStore((s) => s.ready)
  const bootError = useStore((s) => s.bootError)
  const bootstrap = useStore((s) => s.bootstrap)

  // Find out whether a session already exists before deciding what to show.
  useEffect(() => {
    bootstrap()
  }, [bootstrap])

  if (!ready) {
    return (
      <FullPageMessage>
        <Loader2 size={28} className="animate-spin text-indigo-500" />
        <p className="text-[14px] font-semibold text-slate-500">Đang tải...</p>
      </FullPageMessage>
    )
  }

  if (bootError) {
    return (
      <FullPageMessage>
        <WifiOff size={30} className="text-rose-500" />
        <p className="max-w-xs text-[14px] font-semibold text-slate-600">{bootError}</p>
        <Button variant="outline" onClick={bootstrap}>
          Thử lại
        </Button>
      </FullPageMessage>
    )
  }

  return (
    <Routes>
      <Route path="/dang-nhap" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/khach" element={<CustomersPage />} />
        <Route path="/khach/:id" element={<CustomerDetailPage />} />
        <Route path="/don-moi" element={<OrderFormPage />} />
        <Route path="/don-hang" element={<OrdersPage />} />
        <Route path="/don-hang/:id" element={<OrderDetailPage />} />
        <Route path="/don-hang/:id/sua" element={<OrderFormPage />} />
        <Route path="/hang-tra" element={<ReturnsPage />} />
        <Route path="/thu-tien" element={<PaymentsPage />} />
        <Route path="/san-pham" element={<ProductsPage />} />
        <Route path="/bang-gia" element={<PriceBookPage />} />
        <Route path="/sao-ke" element={<StatementPage />} />
        <Route path="/cai-dat" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
