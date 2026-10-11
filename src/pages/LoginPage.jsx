import { useState } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { Wallet, User, Lock, Eye, EyeOff } from 'lucide-react'
import { useStore } from '../store/useStore'
import { messageOf } from '../api/client'
import { Button, Input, Field } from '../components/ui'
import { useToast } from '../components/Toast'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)
  const login = useStore((s) => s.login)
  const authed = useStore((s) => s.authed)
  const navigate = useNavigate()
  const loc = useLocation()
  const toast = useToast()

  if (authed) {
    return <Navigate to={loc.state?.from || '/'} replace />
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!username.trim()) {
      toast.error('Vui lòng nhập tên đăng nhập')
      return
    }
    setBusy(true)
    try {
      await login(username.trim(), password)
      toast.success('Đăng nhập thành công')
      navigate(loc.state?.from || '/', { replace: true })
    } catch (error) {
      toast.error(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-indigo-50 via-slate-50 to-blue-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-indigo-600 to-blue-600 text-white shadow-lg shadow-indigo-200">
            <Wallet size={30} />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">Quản lý công nợ</h1>
          <p className="mt-1 text-sm text-slate-500">Đăng nhập để tiếp tục</p>
        </div>

        <form
          onSubmit={submit}
          className="space-y-4 rounded-3xl border border-slate-100 bg-white p-6 shadow-xl shadow-slate-200/60"
        >
          <Field label="Tên đăng nhập">
            <div className="relative">
              <User size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Tên đăng nhập"
                className="pl-10"
                autoComplete="username"
                autoFocus
              />
            </div>
          </Field>
          <Field label="Mật khẩu">
            <div className="relative">
              <Lock size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mật khẩu"
                className="pl-10 pr-11"
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
              >
                {showPw ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </Field>
          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy ? 'Đang đăng nhập...' : 'Đăng nhập'}
          </Button>
        </form>
      </div>
    </div>
  )
}
