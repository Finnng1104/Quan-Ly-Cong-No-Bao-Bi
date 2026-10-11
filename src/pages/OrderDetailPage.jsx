import { useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { toPng } from 'html-to-image'
import {
  ArrowLeft,
  Pencil,
  Trash2,
  Printer,
  FileDown,
  ImageDown,
  History,
  RotateCcw,
  FileText,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { api } from '../api/httpApi'
import { useAsync } from '../hooks/useAsync'
import { useAction } from '../hooks/useAction'
import { fmtMoney, fmtDateTime } from '../lib/format'
import { Card, Button, Badge, Confirm, Modal, Empty } from '../components/ui'
import { ErrorCard, LoadingCard } from '../components/AsyncState'
import OrderTicket from '../components/OrderTicket'
import { useToast } from '../components/Toast'

export default function OrderDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const data = useStore()
  const toast = useToast()
  const run = useAction()
  // The order comes with the debt before/after it and its edit history, all computed by the server.
  const { data: order, loading, error, reload } = useAsync(
    () => api.orders.get(id),
    [id, data.dataVersion],
  )
  const customer = data.customers.find((c) => c.id === order?.customerId)
  const [confirmDel, setConfirmDel] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const [pageSize, setPageSize] = useState('a5')
  const [histOpen, setHistOpen] = useState(false)
  const ticketRef = useRef(null)

  const showDebt = data.settings.showDebtOnTicket

  if (!order && loading) return <LoadingCard />
  if (!order && error && error.status !== 404) return <ErrorCard error={error} onRetry={reload} />
  if (!order || !customer) {
    return (
      <Card>
        <Empty title="Không tìm thấy đơn" action={<Button onClick={() => navigate('/don-hang')}>Về danh sách</Button>} />
      </Card>
    )
  }

  const deleted = !!order.deletedAt
  const edited = order.editHistory?.length > 0

  const doPrint = (size) => {
    setPageSize(size)
    setPrintOpen(false)
    setTimeout(() => window.print(), 80)
  }

  const saveImage = async () => {
    try {
      const url = await toPng(ticketRef.current, { pixelRatio: 2.5, backgroundColor: '#ffffff' })
      const a = document.createElement('a')
      a.href = url
      a.download = `${order.code}-${order.date}.png`
      a.click()
      toast.success('Đã lưu ảnh phiếu')
    } catch {
      toast.error('Không lưu được ảnh')
    }
  }

  return (
    <div className="animate-fade-up space-y-4 pb-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-slate-800">{order.code}</h1>
            {edited && (
              <Badge tone="violet">
                <History size={10} /> Đã điều chỉnh
              </Badge>
            )}
            {order.vat?.amount > 0 && <Badge tone="cyan">VAT {order.vat.rate}%</Badge>}
            {deleted && <Badge tone="rose">Đã xóa</Badge>}
          </div>
          <Link to={`/khach/${customer.id}`} className="text-[12.5px] font-semibold text-indigo-600">
            {customer.name} →
          </Link>
        </div>
      </div>

      {deleted && (
        <Card className="flex items-center justify-between gap-3 border-rose-100 bg-rose-50/60 p-4">
          <p className="text-[13px] font-semibold text-rose-600">
            Đơn đã xóa — không tính vào công nợ
          </p>
          <Button
            variant="outline"
            size="sm"
            icon={RotateCcw}
            onClick={() =>
              run(async () => {
                await data.restoreOrder(order.id)
                toast.success('Đã khôi phục đơn')
              })
            }
          >
            Khôi phục
          </Button>
        </Card>
      )}

      {/* nút thao tác */}
      {!deleted && (
        <div className="grid grid-cols-4 gap-2">
          <Button variant="outline" size="sm" icon={Pencil} onClick={() => navigate(`/don-hang/${order.id}/sua`)}>
            Sửa đơn
          </Button>
          <Button variant="outline" size="sm" icon={Printer} onClick={() => doPrint(pageSize)}>
            In
          </Button>
          <Button variant="outline" size="sm" icon={FileDown} onClick={() => setPrintOpen(true)}>
            PDF
          </Button>
          <Button variant="outline" size="sm" icon={ImageDown} onClick={saveImage}>
            Lưu ảnh
          </Button>
        </div>
      )}

      {/* phiếu preview */}
      <Card className="overflow-hidden shadow-md">
        <OrderTicket
          ref={ticketRef}
          order={order}
          customer={customer}
          data={data}
          oldDebt={order.balanceBefore ?? 0}
          showDebt={showDebt}
          shopName={data.settings.shopName}
        />
      </Card>

      {/* vùng in — trùng phiếu, chỉ hiện khi in */}
      <div id="print-area" className={pageSize === 'a4' ? 'page-a4' : 'page-a5'}>
        <OrderTicket
          order={order}
          customer={customer}
          data={data}
          oldDebt={order.balanceBefore ?? 0}
          showDebt={showDebt}
          shopName={data.settings.shopName}
        />
      </div>

      {/* lịch sử điều chỉnh */}
      {edited && (
        <Card className="overflow-hidden">
          <button
            onClick={() => setHistOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3.5"
          >
            <span className="flex items-center gap-2 text-[14px] font-bold text-slate-700">
              <History size={16} className="text-violet-500" />
              Lịch sử điều chỉnh ({order.editHistory.length})
            </span>
            <span className="text-[12px] font-semibold text-indigo-600">
              {histOpen ? 'Thu gọn' : 'Xem'}
            </span>
          </button>
          {histOpen && (
            <div className="space-y-3 border-t border-slate-100 px-4 py-4">
              {order.editHistory
                .slice()
                .reverse()
                .map((h, i) => (
                  <div key={i} className="rounded-xl bg-violet-50/60 p-3.5">
                    <div className="flex items-center justify-between">
                      <p className="text-[12px] font-bold text-violet-700">
                        Lần {order.editHistory.length - i} · {fmtDateTime(h.editedAt)}
                      </p>
                      <p className="text-[12px] font-bold tabular-nums">
                        <span className="text-slate-400 line-through">{fmtMoney(h.oldTotal)}</span>
                        <span className="mx-1 text-slate-400">→</span>
                        <span className="text-slate-800">{fmtMoney(h.newTotal)}</span>
                        <span className={`ml-1.5 ${h.diff >= 0 ? 'text-rose-500' : 'text-emerald-600'}`}>
                          ({h.diff >= 0 ? '+' : ''}
                          {fmtMoney(h.diff)})
                        </span>
                      </p>
                    </div>
                    <ul className="mt-1.5 space-y-0.5">
                      {h.changes.map((c, j) => (
                        <li key={j} className="text-[12px] text-slate-600">
                          • {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          )}
        </Card>
      )}

      {!deleted && (
        <Button
          variant="danger"
          icon={Trash2}
          className="w-full"
          onClick={() => setConfirmDel(true)}
        >
          Xóa đơn này
        </Button>
      )}

      <Confirm
        open={confirmDel}
        onClose={() => setConfirmDel(false)}
        onConfirm={() =>
          run(async () => {
            await data.removeOrder(order.id)
            toast.success(`Đã xóa ${order.code}`)
            navigate('/don-hang')
          })
        }
        title="Xóa đơn hàng?"
        message={`Đơn ${order.code} trị giá ${fmtMoney(order.total)} đ sẽ bị xóa và trừ khỏi công nợ của ${customer.name}. Bạn có thể khôi phục sau.`}
        confirmText="Xóa đơn"
      />

      {/* chọn khổ in / PDF */}
      <Modal open={printOpen} onClose={() => setPrintOpen(false)} title="Xuất PDF">
        <p className="mb-4 text-[13.5px] text-slate-500">
          Chọn khổ giấy rồi bấm "Xuất" — trong hộp thoại in chọn "Lưu thành PDF".
        </p>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => doPrint('a5')}
            className={`flex flex-col items-center gap-2 rounded-2xl border-2 p-5 transition-all ${pageSize === 'a5' ? 'border-indigo-500 bg-indigo-50/50' : 'border-slate-200'
              }`}
          >
            <FileText size={26} className="text-indigo-600" />
            <span className="text-[14px] font-bold text-slate-700">Khổ A5</span>
            <span className="text-[11px] text-slate-400">148 × 210 mm — phiếu nhỏ</span>
          </button>
          <button
            onClick={() => doPrint('a4')}
            className={`flex flex-col items-center gap-2 rounded-2xl border-2 p-5 transition-all ${pageSize === 'a4' ? 'border-indigo-500 bg-indigo-50/50' : 'border-slate-200'
              }`}
          >
            <FileText size={30} className="text-indigo-600" />
            <span className="text-[14px] font-bold text-slate-700">Khổ A4</span>
            <span className="text-[11px] text-slate-400">210 × 297 mm</span>
          </button>
        </div>
      </Modal>
    </div>
  )
}
