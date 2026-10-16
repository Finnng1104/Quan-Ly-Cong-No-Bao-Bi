import { useEffect, useState } from 'react'
import { Cloud, CloudOff, DatabaseBackup, HardDrive, Loader2, RotateCcw, Usb } from 'lucide-react'
import { api } from '../api/httpApi'
import { request } from '../api/client'
import { useAsync } from '../hooks/useAsync'
import { useAction } from '../hooks/useAction'
import { fmtDateTime } from '../lib/format'
import { Badge, Button, Card, Confirm, Modal } from './ui'
import { useToast } from './Toast'

const TRIGGER_LABELS = {
  startup: 'Tự động',
  periodic: 'Tự động',
  manual: 'Thủ công',
  'pre-update': 'Trước khi cập nhật',
  'pre-restore': 'Trước khi khôi phục',
}

// The server restarts itself after a restore; give it time before telling the person to reload.
const RESTART_FIRST_CHECK_MS = 2500
const RESTART_CHECK_EVERY_MS = 1500
const RESTART_GIVE_UP_MS = 90_000

function formatSize(bytes) {
  if (bytes == null) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(0)} GB`
}

/** Full-screen notice shown while the app restarts onto the restored data, then reloads the page. */
function RestartingOverlay() {
  const [gaveUp, setGaveUp] = useState(false)

  useEffect(() => {
    let cancelled = false
    const startedAt = Date.now()

    const check = async () => {
      if (cancelled) return
      try {
        await request('GET', '/auth/me')
      } catch (error) {
        // 503 = still shutting down (or restarting), 0 = not listening yet. Anything else means the
        // new process answered, for example 401 because the restored data has other sessions.
        const stillRestarting = error.status === 503 || error.status === 0
        if (stillRestarting) {
          if (Date.now() - startedAt > RESTART_GIVE_UP_MS) return setGaveUp(true)
          return setTimeout(check, RESTART_CHECK_EVERY_MS)
        }
      }
      window.location.assign('/')
    }

    const timer = setTimeout(check, RESTART_FIRST_CHECK_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-white/95 p-6 text-center">
      <Loader2 size={32} className="animate-spin text-indigo-500" />
      <p className="text-[16px] font-bold text-slate-800">Đang khôi phục dữ liệu...</p>
      <p className="max-w-xs text-[14px] text-slate-500">
        Ứng dụng đang khởi động lại, vài giây nữa sẽ tự mở. Vui lòng không tắt máy.
      </p>
      {gaveUp && (
        <Button variant="outline" onClick={() => window.location.reload()}>
          Tải lại trang
        </Button>
      )}
    </div>
  )
}

const DRIVE_MODES = [
  { value: 'always', label: 'Cắm thường xuyên', hint: 'Ổ luôn cắm trong máy. Phần mềm báo nếu quá 2 ngày chưa sao lưu được.' },
  { value: 'occasional', label: 'Thỉnh thoảng mới cắm', hint: 'Cắm khi cần. Mỗi lần cắm, phần mềm tự chép các bản còn thiếu; chỉ nhắc nếu quá 14 ngày.' },
]

/** Lets the shop pick which plugged-in drive receives backups, and how it is used. */
function DrivePicker({ open, onClose, current, onSaved }) {
  const toast = useToast()
  const run = useAction()
  const { data: drives, loading, reload } = useAsync(() => (open ? api.backups.drives() : []), [open])
  const [volume, setVolume] = useState(null)
  const [mode, setMode] = useState(current?.mode ?? 'always')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setVolume(null)
      setMode(current?.mode ?? 'always')
    }
  }, [open, current])

  const canSave = volume !== null || current !== null
  const save = () =>
    run(async () => {
      setSaving(true)
      try {
        await api.backups.setDrive({ volume: volume ?? undefined, mode })
        toast.success('Đã lưu cài đặt ổ sao lưu')
        onSaved()
        onClose()
      } finally {
        setSaving(false)
      }
    })

  return (
    <Modal open={open} onClose={onClose} title="Sao lưu ra ổ cứng ngoài">
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-[13px] font-bold text-slate-700">Chọn ổ</p>
          {loading && !drives ? (
            <p className="text-[13px] text-slate-400">Đang tìm ổ...</p>
          ) : drives?.length ? (
            <ul className="space-y-2">
              {drives.map((drive) => (
                <li key={drive.name}>
                  <button
                    type="button"
                    onClick={() => setVolume(drive.name)}
                    className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition active:bg-slate-50 ${
                      volume === drive.name ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200'
                    }`}
                  >
                    <Usb size={18} className="text-slate-500" />
                    <span className="text-[14px] font-semibold text-slate-700">{drive.name}</span>
                    {drive.freeBytes != null && (
                      <span className="ml-auto text-[12px] text-slate-400">trống {formatSize(drive.freeBytes)}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-slate-500">
              Chưa thấy ổ nào. Hãy cắm ổ cứng ngoài vào máy rồi bấm "Làm mới".
            </p>
          )}
          {current && volume === null && (
            <p className="mt-2 text-[12px] text-slate-400">
              Đang dùng ổ "{current.volume}". Chọn ổ khác nếu muốn đổi.
            </p>
          )}
          <Button variant="outline" size="sm" className="mt-3" onClick={reload}>
            Làm mới
          </Button>
        </div>

        <div>
          <p className="mb-2 text-[13px] font-bold text-slate-700">Cách dùng</p>
          <div className="space-y-2">
            {DRIVE_MODES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setMode(option.value)}
                className={`w-full rounded-xl border px-3.5 py-3 text-left transition active:bg-slate-50 ${
                  mode === option.value ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200'
                }`}
              >
                <p className="text-[14px] font-semibold text-slate-700">{option.label}</p>
                <p className="mt-0.5 text-[12px] text-slate-500">{option.hint}</p>
              </button>
            ))}
          </div>
        </div>

        <Button className="w-full" disabled={!canSave || saving} onClick={save}>
          {saving ? 'Đang lưu...' : 'Lưu'}
        </Button>
      </div>
    </Modal>
  )
}

export default function BackupCard() {
  const toast = useToast()
  const run = useAction()
  const { data, error, loading, reload } = useAsync(() => api.backups.list(), [])
  const [creating, setCreating] = useState(false)
  const [pendingRestore, setPendingRestore] = useState(null)
  const [restarting, setRestarting] = useState(false)
  const [pickingDrive, setPickingDrive] = useState(false)

  // Not available (older server, or the page is served without the backup API): stay out of the way.
  if (error?.status === 404) return null

  const createBackup = () =>
    run(async () => {
      setCreating(true)
      try {
        const result = await api.backups.create()
        const waiting = []
        if (result.copiedToDrive === false) waiting.push('ổ cứng ngoài (chưa cắm)')
        if (result.uploaded === false) waiting.push('online (chưa có mạng)')
        if (waiting.length > 0) {
          toast.success(`Đã sao lưu trên máy. Chưa chép được ra ${waiting.join(' và ')}, sẽ tự chép khi sẵn sàng.`)
        } else {
          toast.success('Đã sao lưu')
        }
        reload()
      } finally {
        setCreating(false)
      }
    })

  const restore = (fileName) =>
    run(async () => {
      await api.backups.restore(fileName)
      setRestarting(true)
    })

  const cloud = data?.cloud
  const drive = data?.drive
  const driveLine = !drive
    ? null
    : `${drive.plugged ? 'đã cắm' : 'chưa cắm'} · ${drive.mode === 'always' ? 'cắm thường xuyên' : 'thỉnh thoảng cắm'}${
        drive.lastBackupAt ? ` · bản gần nhất ${fmtDateTime(drive.lastBackupAt)}` : ''
      }`
  const cloudLine = !cloud?.configured
    ? null
    : cloud.reachable
      ? `Đã bật${data.lastCloudBackupAt ? ` · bản gần nhất ${fmtDateTime(data.lastCloudBackupAt)}` : ''}`
      : 'Đã bật nhưng chưa kết nối được mạng. Bản sao lưu sẽ tự đẩy lên khi có mạng.'

  return (
    <Card className="space-y-3 p-4">
      <p className="flex items-center gap-2 text-[14px] font-bold text-slate-700">
        <DatabaseBackup size={16} className="text-indigo-500" /> Sao lưu dữ liệu
      </p>

      {loading && !data && (
        <p className="flex items-center gap-2 text-[13px] text-slate-400">
          <Loader2 size={15} className="animate-spin" /> Đang tải...
        </p>
      )}

      {data && (
        <>
          <div className="space-y-1 text-[13px] text-slate-600">
            <p className="flex items-start gap-2">
              <HardDrive size={15} className="mt-0.5 shrink-0 text-slate-400" />
              <span>
                Trên máy:{' '}
                {data.lastBackupAt ? `bản gần nhất ${fmtDateTime(data.lastBackupAt)}` : 'chưa có bản nào'}
              </span>
            </p>
            {data.drivesSupported && (
              <p className="flex items-start gap-2">
                <Usb size={15} className="mt-0.5 shrink-0 text-slate-400" />
                <span>
                  Ổ cứng ngoài:{' '}
                  {drive ? (
                    <>
                      "{drive.volume}" ({driveLine})
                    </>
                  ) : (
                    'chưa bật'
                  )}
                </span>
              </p>
            )}
            {cloud.configured && (
              <p className="flex items-start gap-2">
                {cloud.reachable ? (
                  <Cloud size={15} className="mt-0.5 shrink-0 text-slate-400" />
                ) : (
                  <CloudOff size={15} className="mt-0.5 shrink-0 text-amber-500" />
                )}
                <span>Online: {cloudLine}</span>
              </p>
            )}
          </div>

          <Button
            variant="soft"
            icon={creating ? Loader2 : DatabaseBackup}
            className="w-full"
            disabled={creating}
            onClick={createBackup}
          >
            {creating ? 'Đang sao lưu...' : 'Sao lưu ngay'}
          </Button>
          {data.drivesSupported && (
            <Button variant="outline" icon={Usb} className="w-full" onClick={() => setPickingDrive(true)}>
              {drive ? 'Đổi ổ cứng ngoài / cách dùng' : 'Bật sao lưu ra ổ cứng ngoài'}
            </Button>
          )}
          {drive && (
            <button
              type="button"
              className="text-[12px] font-semibold text-slate-400 underline active:text-slate-600"
              onClick={() =>
                run(async () => {
                  await api.backups.removeDrive()
                  toast.success('Đã tắt sao lưu ra ổ cứng ngoài. Các file đã chép trên ổ vẫn còn nguyên.')
                  reload()
                })
              }
            >
              Tắt sao lưu ra ổ cứng ngoài
            </button>
          )}
          {drive && !drive.plugged && drive.mode === 'always' && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-700">
              Chưa thấy ổ "{drive.volume}". Hãy cắm ổ vào máy, phần mềm sẽ tự chép các bản còn thiếu.
            </p>
          )}
          {!drive && !cloud.configured && (
            <p className="text-[12px] text-slate-400">
              Hiện bản sao lưu chỉ nằm trên máy này. Hãy bật sao lưu ra ổ cứng ngoài để an toàn hơn.
            </p>
          )}
          <p className="text-[12px] text-slate-400">
            Phần mềm tự sao lưu khi bật máy và vài giờ một lần khi có thay đổi.
          </p>

          <div className="border-t border-slate-100 pt-3">
            <p className="mb-2 text-[13px] font-bold text-slate-700">Các bản sao lưu</p>
            {data.items.length === 0 ? (
              <p className="text-[13px] text-slate-400">Chưa có bản sao lưu nào.</p>
            ) : (
              <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
                {data.items.map((item) => (
                  <li key={item.fileName} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-semibold text-slate-700">
                        {fmtDateTime(item.createdAt)}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-slate-400">
                        <span>{TRIGGER_LABELS[item.trigger] ?? 'Khác'}</span>
                        {item.sizeBytes != null && <span>· {formatSize(item.sizeBytes)}</span>}
                        {item.onDevice && <Badge tone="slate">Trên máy</Badge>}
                        {item.onDrive && <Badge tone="violet">Ổ ngoài</Badge>}
                        {item.online && <Badge tone="cyan">Online</Badge>}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      icon={RotateCcw}
                      onClick={() => setPendingRestore(item)}
                    >
                      Khôi phục
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {error && error.status !== 404 && (
        <p className="text-[13px] text-rose-600">Không tải được danh sách sao lưu.</p>
      )}

      <Confirm
        open={pendingRestore !== null}
        onClose={() => setPendingRestore(null)}
        title="Khôi phục dữ liệu?"
        confirmText="Khôi phục"
        message={
          pendingRestore
            ? `Dữ liệu sẽ quay về đúng thời điểm ${fmtDateTime(pendingRestore.createdAt)}. ` +
              'Mọi đơn hàng, thanh toán và thay đổi (kể cả mật khẩu) sau thời điểm đó sẽ không còn. ' +
              'Dữ liệu hiện tại được lưu lại một bản trước khi khôi phục. Ứng dụng sẽ tự khởi động lại.'
            : ''
        }
        onConfirm={() => restore(pendingRestore.fileName)}
      />

      <DrivePicker
        open={pickingDrive}
        onClose={() => setPickingDrive(false)}
        current={drive}
        onSaved={reload}
      />

      {restarting && <RestartingOverlay />}
    </Card>
  )
}
