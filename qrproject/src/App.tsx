import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { auth, firebaseReady } from './firebase'
import { Loading } from './components'
import { PublicProduct, Login, ForgotPassword, AcceptInvite } from './PublicAuth'
import { AdminLayout } from './Admin'
import './App.css'

function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  useEffect(() => onAuthStateChanged(auth, setUser), [])
  if (!firebaseReady) return <div className="simple-screen"><div className="auth-card"><p className="eyebrow">SETUP REQUIRED</p><h1>ยังไม่ตั้งค่า Firebase</h1><p>คัดลอก <code>.env.example</code> เป็น <code>.env.local</code> แล้วใส่ค่า Firebase project สำหรับพัฒนา</p></div></div>
  if (user === undefined) return <Loading />
  return <BrowserRouter><Routes>
    <Route path="/products/:productId" element={<PublicProduct />} />
    <Route path="/login" element={user ? <Navigate to="/admin" /> : <Login />} />
    <Route path="/forgot-password" element={<ForgotPassword />} />
    <Route path="/accept-invite" element={<AcceptInvite />} />
    <Route path="/admin/*" element={user ? <AdminLayout user={user} /> : <Navigate to="/login" />} />
    <Route path="*" element={<Navigate to={user ? '/admin' : '/login'} />} />
  </Routes></BrowserRouter>
}
export default App
