const fs = require('node:fs')
const path = require('node:path')

async function main() {
  const email = process.argv[2]
  if (!email) throw new Error('ใช้ npm --prefix functions run bootstrap:local -- admin@example.com')
  const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).filter((line) => /^[A-Z_]+=/.test(line)).map((line) => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)] }))
  if (!env.BOOTSTRAP_SECRET) throw new Error('ไม่พบ BOOTSTRAP_SECRET ใน functions/.env')
  const webEnv = Object.fromEntries(fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).filter((line) => /^[A-Z_]+=/.test(line)).map((line) => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)] }))
  const projectId = webEnv.VITE_FIREBASE_PROJECT_ID
  if (!projectId) throw new Error('ไม่พบ VITE_FIREBASE_PROJECT_ID ใน .env.local')
  const response = await fetch(`http://127.0.0.1:5001/${projectId}/asia-southeast1/api/local/bootstrap`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bootstrap-Secret': env.BOOTSTRAP_SECRET }, body: JSON.stringify({ email }) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
  console.log(`ตั้งค่า Super Admin สำเร็จ: ${email}`)
}
main().catch((error) => { console.error(error.message); process.exitCode = 1 })
