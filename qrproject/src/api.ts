import { auth } from './firebase'

const base = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const needsAuth = path.startsWith('/admin/') || /^\/public\/invitations\/[^/]+\/accept$/.test(path)
  const token = needsAuth && auth.currentUser ? await auth.currentUser.getIdToken() : ''
  const headers = new Headers(options.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (options.body && !(options.body instanceof Blob) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  let response: Response
  try { response = await fetch(`${base}${path}`, { ...options, headers }) }
  catch { throw new Error('เชื่อมต่อ Functions ในเครื่องไม่ได้ กรุณาตรวจว่า Emulator กำลังทำงาน') }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `คำขอไม่สำเร็จ (${response.status})`)
  return data as T
}

export function json(method: 'POST' | 'PUT', body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) }
}

export const baht = (satang: number) => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(satang / 100)
export const dateTime = (value?: { seconds: number }) => value ? new Date(value.seconds * 1000).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : '—'
export const publicBase = (import.meta.env.VITE_PUBLIC_BASE_URL || window.location.origin).replace(/\/$/, '')
