import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, test } from 'node:test'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { ref, uploadBytes } from 'firebase/storage'

let environment
before(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-ls-product-studio',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
    storage: { rules: readFileSync('storage.rules', 'utf8'), host: '127.0.0.1', port: 9199 },
  })
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await setDoc(doc(db, 'users', 'admin'), { role: 'admin', status: 'active' })
    await setDoc(doc(db, 'users', 'owner'), { role: 'superAdmin', status: 'active' })
    await setDoc(doc(db, 'users', 'suspended'), { role: 'admin', status: 'suspended' })
    await setDoc(doc(db, 'products', 'item'), { name: 'Test', status: 'active' })
  })
})
after(async () => { await environment?.cleanup() })

test('Firestore allows active Admin reads and blocks public and suspended reads', async () => {
  const admin = environment.authenticatedContext('admin', { role: 'admin' }).firestore()
  const publicDb = environment.unauthenticatedContext().firestore()
  const suspended = environment.authenticatedContext('suspended', { role: 'admin' }).firestore()
  await assertSucceeds(getDoc(doc(admin, 'products', 'item')))
  await assertFails(getDoc(doc(publicDb, 'products', 'item')))
  await assertFails(getDoc(doc(suspended, 'products', 'item')))
  await assertSucceeds(getDoc(doc(admin, 'users', 'admin')))
  await assertFails(getDoc(doc(admin, 'users', 'owner')))
  const owner = environment.authenticatedContext('owner', { role: 'superAdmin' }).firestore()
  await assertSucceeds(getDoc(doc(owner, 'users', 'admin')))
  await assertFails(setDoc(doc(admin, 'products', 'other'), { name: 'Bypass' }))
})

test('Storage allows only active Admin uploads with valid size and MIME', async () => {
  const admin = environment.authenticatedContext('admin', { role: 'admin' }).storage()
  const publicStorage = environment.unauthenticatedContext().storage()
  const bytes = new Uint8Array([137, 80, 78, 71])
  await assertSucceeds(uploadBytes(ref(admin, 'products/item/valid'), bytes, { contentType: 'image/png' }))
  await assertFails(uploadBytes(ref(publicStorage, 'products/item/anonymous'), bytes, { contentType: 'image/png' }))
  await assertFails(uploadBytes(ref(admin, 'products/item/text'), bytes, { contentType: 'text/plain' }))
  await assertFails(uploadBytes(ref(admin, 'products/item/large'), new Uint8Array(2 * 1024 * 1024 + 1), { contentType: 'image/png' }))
  assert.ok(true)
})
