import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { categoryKey, defaultCategories } from './domain'

async function main() {
  const email = process.argv[2]?.trim().toLowerCase()
  if (!email) throw new Error('ใช้คำสั่ง npm run bootstrap -- admin@example.com หลังสร้างบัญชีใน Firebase Authentication แล้ว')
  initializeApp()
  const user = await getAuth().getUserByEmail(email)
  const db = getFirestore()
  const existing = await db.collection('users').where('role', '==', 'superAdmin').limit(1).get()
  if (!existing.empty && existing.docs[0].id !== user.uid) throw new Error('มี Super Admin อยู่แล้ว')
  await getAuth().setCustomUserClaims(user.uid, { role: 'superAdmin' })
  await db.doc(`users/${user.uid}`).set({ email, role: 'superAdmin', status: 'active', createdAt: FieldValue.serverTimestamp() }, { merge: true })
  for (const name of defaultCategories) await db.doc(`categories/${categoryKey(name)}`).set({ name, createdAt: FieldValue.serverTimestamp() }, { merge: true })
  console.info(`ตั้งค่า Super Admin สำเร็จ: ${email}`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
