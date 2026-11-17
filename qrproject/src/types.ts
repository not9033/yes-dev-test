export type Product = {
  id: string
  sku: string
  name: string
  category: string
  priceSatang: number
  size: string
  description: string
  how_to_use: string
  status: 'active' | 'inactive'
  imageUrl: string
  imagePath?: string
  importIssues?: string[]
  importRaw?: Record<string, string | number>
  updatedAt?: { seconds: number }
}
export type ImportRow = { rowNumber: number; status: 'valid' | 'updateReady' | 'draftReady' | 'invalid' | 'skipped' | 'imported' | 'updated' | 'importedInactive'; reason: string; product?: Product; raw?: Record<string, string | number>; productId?: string; productAction?: 'created' | 'updated' }
export type ImportJob = { id: string; fileName: string; status: string; total: number; imported: number; updated?: number; inactiveImported?: number; invalid: number; skipped: number; cursor: number; createdAt?: { seconds: number } }
export type AdminUser = { uid: string; email: string; role: string; status: string }
export type Dashboard = { productCount: number; activeCount: number; scans: number; top: { id: string; name: string; count: number }[] }
