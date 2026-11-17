import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getStorage } from 'firebase/storage'

export const firebaseReady = Boolean(import.meta.env.VITE_FIREBASE_API_KEY && import.meta.env.VITE_FIREBASE_PROJECT_ID)
export const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || ''
const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'missing',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'missing',
  projectId: projectId || 'missing',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'missing',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || 'missing',
})
export const auth = getAuth(app)
export const storage = getStorage(app)
