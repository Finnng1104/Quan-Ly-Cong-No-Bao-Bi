import { useState } from 'react'
import {
  Lock,
  Download,
  Store,
  Eye,
  RefreshCcw,
  LogOut,
  Percent,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { Card, Button, Field, Input, Switch, Confirm } from '../components/ui'
import { useToast } from '../components/Toast'

export default function SettingsPage() {
  const data = useStore()
  const toast = useToast()
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [newPw2, setNewPw2] = useState('')
  const [shopName, setShopName] = useState(data.settings.shopName)
  const [resetOpen, setResetOpen] = useState(false)

  const changePw = () => {
    if (newPw.length < 4) return toast.error('Mật khẩu mới tối thiểu 4 ký tự')
    if (newPw !== newPw2) return toast.error('Nhập lại mật khẩu không khớp')
    if (data.changePassword(oldPw, newPw)) {
      toast.success('Đã đổi mật khẩu')
      setOldPw('')
      setNewPw('')
      setNewPw2('')
    } else {
      toast.error('Mật khẩu hiện tại không đúng')
    }
  }

  const exportData = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            customers: data.customers,
            products: data.products,
            units: data.units,
            priceBook: data.priceBook,
            orders: data.orders,
            returns: data.returns,
            payments: data.payments,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    )
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `congno-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    toast.success('Đã xuất dữ liệu JSON')
  }

  return (
    <div className="animate-fade-up space-y-4">
      <h1 className="text-xl font-bold text-slate-800">Cài đặt</h1>

      {/* cửa hàng */}
      <Card className="p-4">
        <p className="mb-3 flex items-center gap-2 text-[14px] font-bold text-slate-700">
          <Store size={16} className="text-indigo-500" /> Thông tin cửa hàng
        </p>
        <Field label="Tên cửa hàng (hiện trên phiếu)">
          <div className="flex gap-2">
            <Input
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              placeholder="Tên cửa hàng"
              className="flex-1"
            />
            <Button
              variant="soft"
              onClick={() => {
                data.setShopName(shopName.trim() || 'Cửa hàng')
                toast.success('Đã lưu tên cửa hàng')
              }}
            >
              Lưu
            </Button>
          </div>
        </Field>
      </Card>

      {/* hiển thị phiếu */}
      <Card className="p-4">
        <p className="mb-3 flex items-center gap-2 text-[14px] font-bold text-slate-700">
          <Eye size={16} className="text-indigo-500" /> Phiếu in / gửi khách
        </p>
        <Switch
          checked={data.settings.showDebtOnTicket}
          onChange={data.setShowDebtOnTicket}
          label="Hiển thị nợ cũ / nợ mới trên phiếu"
        />
        <p className="mt-2 text-[12px] text-slate-400">
          Tắt để phiếu gửi khách chỉ có Tổng đơn hàng.
        </p>
        <div className="mt-4 flex items-center gap-3 border-t border-slate-100 pt-3.5">
          <Percent size={15} className="text-slate-400" />
          <span className="flex-1 text-[14px] font-medium text-slate-700">
            Thuế suất VAT hóa đơn
          </span>
          <div className="flex items-center gap-1.5">
            <Input
              inputMode="numeric"
              value={data.settings.vatRate ?? 8}
              onChange={(e) => data.setVatRate(e.target.value.replace(/[^0-9.]/g, ''))}
              className="h-9 w-20 text-center font-bold"
            />
            <span className="text-[13px] font-semibold text-slate-400">%</span>
          </div>
        </div>
        <p className="mt-1.5 text-[12px] text-slate-400">
          Áp dụng khi bật "Xuất hóa đơn VAT" trong đơn — tiền VAT cộng vào công nợ khách.
        </p>
      </Card>

      {/* đổi mật khẩu */}
      <Card className="space-y-3.5 p-4">
        <p className="flex items-center gap-2 text-[14px] font-bold text-slate-700">
          <Lock size={16} className="text-indigo-500" /> Đổi mật khẩu
        </p>
        <Field label="Mật khẩu hiện tại">
          <Input
            type="password"
            value={oldPw}
            onChange={(e) => setOldPw(e.target.value)}
            placeholder="••••••"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Mật khẩu mới">
            <Input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              placeholder="Tối thiểu 4 ký tự"
            />
          </Field>
          <Field label="Nhập lại">
            <Input
              type="password"
              value={newPw2}
              onChange={(e) => setNewPw2(e.target.value)}
              placeholder="Nhập lại"
            />
          </Field>
        </div>
        <Button variant="soft" onClick={changePw}>
          Đổi mật khẩu
        </Button>
      </Card>

      {/* dữ liệu */}
      <Card className="space-y-3 p-4">
        <p className="flex items-center gap-2 text-[14px] font-bold text-slate-700">
          <Download size={16} className="text-indigo-500" /> Dữ liệu
        </p>
        <Button variant="outline" icon={Download} className="w-full" onClick={exportData}>
          Xuất toàn bộ dữ liệu (JSON)
        </Button>
        <Button variant="outline" icon={RefreshCcw} className="w-full" onClick={() => setResetOpen(true)}>
          Nạp lại dữ liệu mẫu
        </Button>
        <p className="text-[12px] text-slate-400">
          Dữ liệu lưu ngay trên máy (localStorage) — tải lại trang không mất.
        </p>
      </Card>

      <Button
        variant="danger"
        icon={LogOut}
        className="w-full"
        onClick={() => data.logout()}
      >
        Đăng xuất
      </Button>

      <Confirm
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onConfirm={() => {
          data.resetData()
          toast.success('Đã nạp lại dữ liệu mẫu')
        }}
        title="Nạp lại dữ liệu mẫu?"
        message="Toàn bộ khách, đơn, thanh toán hiện tại sẽ bị thay bằng dữ liệu mẫu ban đầu."
        confirmText="Nạp lại"
      />
    </div>
  )
}
