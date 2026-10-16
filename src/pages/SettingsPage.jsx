import { useState } from 'react'
import {
  Lock,
  Download,
  Store,
  Eye,
  LogOut,
  Percent,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { api } from '../api/httpApi'
import { useAction } from '../hooks/useAction'
import { todayISO, toCsv, downloadText } from '../lib/format'
import { Card, Button, Field, Input, Switch } from '../components/ui'
import { useToast } from '../components/Toast'
import BackupCard from '../components/BackupCard'

export default function SettingsPage() {
  const data = useStore()
  const toast = useToast()
  const run = useAction()
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [newPw2, setNewPw2] = useState('')
  const [shopName, setShopName] = useState(data.settings.shopName)
  const [vatInput, setVatInput] = useState(String(data.settings.vatRate ?? 8))

  const changePw = () => {
    if (newPw.length < 4) return toast.error('Mật khẩu mới tối thiểu 4 ký tự')
    if (newPw !== newPw2) return toast.error('Nhập lại mật khẩu không khớp')
    return run(async () => {
      await data.changePassword(oldPw, newPw)
      toast.success('Đã đổi mật khẩu')
      setOldPw('')
      setNewPw('')
      setNewPw2('')
    })
  }

  // The VAT rate is saved when the field loses focus, not on every keystroke.
  const saveVatRate = () => {
    const rate = Number(vatInput)
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      setVatInput(String(data.settings.vatRate ?? 8))
      return toast.error('Thuế suất phải từ 0 đến 100%')
    }
    if (rate === data.settings.vatRate) return
    return run(async () => {
      await data.setVatRate(rate)
      toast.success('Đã lưu thuế suất VAT')
    })
  }

  // Xuất bảng công nợ cuối của khách hàng (CSV — mở bằng Excel)
  const exportDebt = () => run(async () => {
    const date = todayISO()
    const rows = await api.reports.customerDebts(date)
    const head = [
      'STT',
      'Khách hàng',
      'SĐT',
      'Nợ đầu kỳ',
      'Tổng đơn hàng',
      'Hàng trả',
      'Đã thu',
      'Phát sinh',
      'Dư nợ cuối',
    ]
    const body = rows.map((r, i) => [
      i + 1,
      r.customer.name,
      r.customer.phone || '',
      r.opening,
      r.orders,
      r.returns,
      r.payments,
      r.adjust,
      r.end,
    ])
    const totals = [
      '',
      'TỔNG CỘNG',
      '',
      rows.reduce((s, r) => s + r.opening, 0),
      rows.reduce((s, r) => s + r.orders, 0),
      rows.reduce((s, r) => s + r.returns, 0),
      rows.reduce((s, r) => s + r.payments, 0),
      rows.reduce((s, r) => s + r.adjust, 0),
      rows.reduce((s, r) => s + r.end, 0),
    ]
    downloadText(`cong-no-khach-${date}.csv`, toCsv([head, ...body, totals]), 'text/csv;charset=utf-8')
    toast.success(`Đã xuất công nợ ${rows.length} khách`)
  })

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
              onClick={() =>
                run(async () => {
                  await data.setShopName(shopName.trim() || 'Cửa hàng')
                  toast.success('Đã lưu tên cửa hàng')
                })
              }
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
          onChange={(value) => run(() => data.setShowDebtOnTicket(value))}
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
              inputMode="decimal"
              value={vatInput}
              onChange={(e) => setVatInput(e.target.value.replace(/[^0-9.]/g, ''))}
              onBlur={saveVatRate}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.target.blur()
              }}
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
        <Button variant="outline" icon={Download} className="w-full" onClick={exportDebt}>
          Xuất công nợ khách (CSV — Excel)
        </Button>
        <p className="text-[12px] text-slate-400">
          Dữ liệu được lưu trên máy chủ của cửa hàng và sao lưu tự động.
        </p>
      </Card>

      <BackupCard />

      <Button
        variant="danger"
        icon={LogOut}
        className="w-full"
        onClick={() => run(() => data.logout())}
      >
        Đăng xuất
      </Button>
    </div>
  )
}
