import { useEffect, useState, type FormEvent } from 'react'
import { api, json } from './api'
import { ErrorText, Notice, Page, Pill } from './components'
import type { AdminUser } from './types'

export function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  async function reload() { const data = await api<{ users: AdminUser[] }>('/admin/users'); setUsers(data.users) }
  useEffect(() => { api<{ users: AdminUser[] }>('/admin/users').then((data) => setUsers(data.users)).catch((cause) => setError(cause.message)) }, [])
  async function invite(event: FormEvent) { event.preventDefault(); setError(''); setMessage(''); try { await api('/admin/invitations', json('POST', { email })); setMessage(`สร้างคำเชิญสำหรับ ${email} แล้ว`); setEmail('') } catch (cause) { setError((cause as Error).message) } }
  async function suspend(user: AdminUser) { if (!window.confirm(`ระงับบัญชี ${user.email}?`)) return; setError(''); try { await api(`/admin/users/${user.uid}/suspend`, json('POST', {})); await reload() } catch (cause) { setError((cause as Error).message) } }
  return <Page title="ผู้ดูแลระบบ" eyebrow="TEAM ACCESS"><ErrorText error={error} />{message && <Notice tone="success">{message}</Notice>}<div className="panel"><h2>เชิญ Admin</h2><form className="invite-form" onSubmit={invite}><label>อีเมลผู้รับ<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@example.com" /></label><button className="button primary">ส่งคำเชิญ</button></form><p className="muted">คำเชิญใช้ได้ครั้งเดียวและหมดอายุภายใน 24 ชั่วโมง</p></div><div className="panel table-wrap"><table><thead><tr><th>อีเมล</th><th>บทบาท</th><th>สถานะ</th><th></th></tr></thead><tbody>{users.map((user) => <tr key={user.uid}><td>{user.email}</td><td>{user.role === 'superAdmin' ? 'Super Admin' : 'Admin'}</td><td><Pill value={user.status} /></td><td>{user.role === 'admin' && user.status === 'active' && <button className="text-button danger" onClick={() => void suspend(user)}>ระงับบัญชี</button>}</td></tr>)}</tbody></table></div></Page>
}
