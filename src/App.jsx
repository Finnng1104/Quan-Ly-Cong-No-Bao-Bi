import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useStore } from './store/useStore'
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

export default function App() {
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
