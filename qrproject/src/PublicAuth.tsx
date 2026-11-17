import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { api, baht, json } from './api'
import { ErrorText, Loading, Notice, ProductImage } from './components'
import { auth } from './firebase'
import { newUuid } from './ids'
import type { Product } from './types'

const pageEvents = new Map<string, string>()

async function recordQrView(productId: string, key: string) {
  try {
    if (!pageEvents.has(key)) pageEvents.set(key, newUuid())
    await api(`/public/products/${productId}/scan`, json('POST', { eventId: pageEvents.get(key), source: 'qr' }))
  } catch { /* Scan tracking must not hide a product that loaded successfully. */ }
}

export function PublicProduct() {
  const { productId } = useParams()
  const location = useLocation()
  const [product, setProduct] = useState<Product | null>(null)
  const [state, setState] = useState<'loading' | 'active' | 'inactive' | 'missing' | 'error'>('loading')
  const [loadError, setLoadError] = useState('')
  useEffect(() => {
    if (!productId) return
    let alive = true
    api<{ status: string; product?: Product }>(`/public/products/${productId}`).then((data) => {
      if (!alive) return
      if (data.status === 'inactive') { setState('inactive'); return }
      if (!data.product) { setState('missing'); return }
      setProduct(data.product)
      setState('active')
      if (new URLSearchParams(location.search).get('source') === 'qr') {
        const key = `${location.key}:${productId}`
        void recordQrView(productId, key)
      }
    }).catch((error) => {
      if (!alive) return
      const message = error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ'
      setLoadError(message)
      setState(message === 'ไม่พบสินค้า' ? 'missing' : 'error')
    })
    return () => { alive = false }
  }, [productId, location.key, location.search])
  if (state === 'loading') return <div className="public-state"><Loading /></div>
  if (state !== 'active' || !product) return <div className="public-state"><div className="brand">LS</div><h1>{state === 'inactive' ? 'สินค้านี้ไม่เปิดเผยข้อมูลแล้ว' : state === 'missing' ? 'ไม่พบสินค้า' : 'โหลดข้อมูลสินค้าไม่สำเร็จ'}</h1><p>{state === 'error' ? loadError : 'กรุณาตรวจสอบลิงก์หรือลองใหม่อีกครั้ง'}</p><button className="button" onClick={() => window.location.reload()}>ลองใหม่</button></div>
  return <div className="public-wrap"><header className="public-header"><span className="brand">LS</span><span>PRODUCT DETAILS</span></header><article className="public-card"><div className="public-visual"><ProductImage src={product.imageUrl} alt={product.name} /></div><div className="public-copy"><p className="eyebrow">{product.category || 'PRODUCT'} · {product.sku}</p><h1>{product.name}</h1><p className="price">{baht(product.priceSatang)}</p>{product.size && <p className="size">ขนาด {product.size}</p>}<div className="divider" />{product.description && <section><h2>รายละเอียด</h2><p>{product.description}</p></section>}{product.how_to_use && <section><h2>วิธีใช้</h2><p>{product.how_to_use}</p></section>}</div></article><footer>ข้อมูลสินค้าล่าสุด · LS Product Studio</footer></div>
}

export function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try { await signInWithEmailAndPassword(auth, email, password); await auth.currentUser?.getIdToken(true); await api('/admin/me'); navigate('/admin') }
    catch (cause) { await signOut(auth).catch(() => undefined); setError(cause instanceof Error && cause.message.includes('ไม่มีสิทธิ์') ? cause.message : 'เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจสอบอีเมลและรหัสผ่าน') }
    finally { setBusy(false) }
  }
  return <div className="auth-screen"><div className="auth-aside"><span className="brand">LS</span><p>จัดการข้อมูลสินค้า<br />จากที่เดียว</p></div><form className="auth-card" onSubmit={submit}><p className="eyebrow">ADMIN ACCESS</p><h1>เข้าสู่ระบบ</h1><p className="muted">สำหรับผู้ดูแลระบบที่ได้รับเชิญเท่านั้น</p><label>อีเมล<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label><label>รหัสผ่าน<input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label><ErrorText error={error} /><button className="button primary" disabled={busy}>{busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}</button><Link to="/forgot-password" className="subtle-link">ลืมรหัสผ่าน?</Link></form></div>
}

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  async function submit(event: FormEvent) { event.preventDefault(); setError(''); try { await sendPasswordResetEmail(auth, email); setMessage('หากมีบัญชีนี้ ระบบจะส่งลิงก์ตั้งรหัสผ่านใหม่ให้') } catch { setError('ส่งคำขอไม่สำเร็จ กรุณาลองใหม่') } }
  return <div className="simple-screen"><form className="auth-card" onSubmit={submit}><Link to="/login" className="subtle-link">← กลับไปเข้าสู่ระบบ</Link><p className="eyebrow">ACCOUNT RECOVERY</p><h1>ลืมรหัสผ่าน</h1><label>อีเมล<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label><ErrorText error={error} />{message && <Notice tone="success">{message}</Notice>}<button className="button primary">ส่งลิงก์ตั้งรหัสผ่าน</button></form></div>
}

export function AcceptInvite() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const [invite, setInvite] = useState<{ email: string; status: string; expiresAt: { seconds: number } } | null>(null)
  const [error, setError] = useState('')
  const [password, setPassword] = useState('')
  const [existing, setExisting] = useState(false)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (token) api<{ email: string; status: string; expiresAt: { seconds: number } }>(`/public/invitations/${token}`).then(setInvite).catch((cause) => setError(cause.message)) }, [token])
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!invite) return
    setBusy(true); setError('')
    try {
      if (existing) await signInWithEmailAndPassword(auth, invite.email, password)
      else await createUserWithEmailAndPassword(auth, invite.email, password)
      await api(`/public/invitations/${token}/accept`, json('POST', {}))
      await auth.currentUser?.getIdToken(true)
      setDone(true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'ยอมรับคำเชิญไม่สำเร็จ') }
    finally { setBusy(false) }
  }
  const expired = invite && invite.status !== 'pending'
  return <div className="simple-screen"><div className="auth-card"><p className="eyebrow">ADMIN INVITATION</p><h1>รับคำเชิญ</h1>{done ? <><Notice tone="success">ตั้งค่าบัญชีสำเร็จ</Notice><Link className="button primary" to="/admin">ไปที่หลังบ้าน</Link></> : <>{invite && <p className="muted">สำหรับ {invite.email}</p>}{expired ? <Notice tone="error">คำเชิญหมดอายุ ถูกยกเลิก หรือใช้ไปแล้ว กรุณาขอคำเชิญใหม่</Notice> : <form onSubmit={submit}><label>{existing ? 'รหัสผ่านบัญชีเดิม' : 'ตั้งรหัสผ่าน'}<input type="password" minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} /></label><ErrorText error={token ? error : 'ไม่พบโทเคนคำเชิญ'} /><button className="button primary" disabled={!invite || busy}>{busy ? 'กำลังดำเนินการ…' : 'ยอมรับคำเชิญ'}</button><button type="button" className="text-button" onClick={() => setExisting(!existing)}>{existing ? 'สร้างบัญชีใหม่' : 'สร้างบัญชีแล้ว? เข้าสู่ระบบเพื่อยืนยันซ้ำ'}</button></form>}</>}</div></div>
}
