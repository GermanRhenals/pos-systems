/**
 * Domain contracts shared by the point-of-sale UI and persistence layer.
 *
 * Persisted operational records deliberately keep the existing field names so
 * older browser data and the first Supabase migration can be imported safely.
 */
export type Product = { id: number; name: string; category: string; stock: number; minimum: number; price: number; unit: string }
export type Sale = { id: number; product: string; quantity: number; total: number; time: string; server: string; createdAt?: number; requestId?: number; requestedAt?: number; table?: string }
export type Request = { id: number; requesterId?: number | string; server: string; table: string; items: string; itemsList?: { productId: number; quantity: number; unitPrice?: number }[]; time: string; createdAt?: number; status: 'Pendiente' | 'Despachado' }
export type User = { id: number | string; name: string; username: string; zone: string; role: 'waiter' | 'bar'; active: boolean }
export type Establishment = { id: string; name: string; city: string; country?: string; taxId?: string; owner_id?: string }
export type Records = { products: Product[]; sales: Sale[]; requests: Request[]; users: User[] }
export type TurnState = { startedAt: number; endedAt: number | null }
export type OperationalState = Pick<Records, 'products' | 'sales' | 'requests'> & { turn: TurnState }
export type SalesPeriod = 'Día' | 'Semana' | 'Mes' | 'Trimestre' | 'Año'
export type SalesLedgerEntry = { id: string; orderedAt: number; dispatchedAt: number; server: string; table: string; products: string[]; total: number }
export type RootEstablishment = { id: string; name: string; city: string; country: string; taxId: string }
export type RootAccount = { id: string; fullName: string; email: string; createdAt: string; lastSignInAt: string | null; emailConfirmedAt: string | null; bannedUntil: string | null; establishments: RootEstablishment[] }
export type RootAuditEntry = { id: number; action: string; target_user_id: string | null; details: Record<string, unknown>; created_at: string }
export type MfaFlow = { factorId: string; challengeId: string; qrCode?: string; secret?: string }

/** Public onboarding data used only to seed a new establishment. */
export const initialProducts: Product[] = [
  { id: 1, name: 'Cerveza Aguila', category: 'Cervezas', stock: 46, minimum: 20, price: 8500, unit: 'botella' },
  { id: 2, name: 'Cerveza Corona', category: 'Cervezas', stock: 18, minimum: 20, price: 12000, unit: 'botella' },
  { id: 3, name: 'Gin tonic', category: 'Cocteleria', stock: 12, minimum: 8, price: 26000, unit: 'copa' },
  { id: 4, name: 'Ron Medellin 8 anos', category: 'Licores', stock: 7, minimum: 5, price: 18000, unit: 'trago' },
  { id: 5, name: 'Agua con gas', category: 'Sin alcohol', stock: 32, minimum: 12, price: 5000, unit: 'botella' },
  { id: 6, name: 'Old fashioned', category: 'Cocteleria', stock: 5, minimum: 8, price: 28000, unit: 'copa' },
  { id: 7, name: 'Cerveza Club Colombia', category: 'Cervezas', stock: 30, minimum: 12, price: 9500, unit: 'botella' },
  { id: 8, name: 'Cerveza Poker', category: 'Cervezas', stock: 36, minimum: 12, price: 8000, unit: 'botella' },
  { id: 9, name: 'Cerveza Heineken', category: 'Cervezas', stock: 24, minimum: 10, price: 11000, unit: 'botella' },
  { id: 10, name: 'Aguardiente Antioqueno', category: 'Licores', stock: 24, minimum: 8, price: 12000, unit: 'trago' },
  { id: 11, name: 'Ron Bacardi Carta Blanca', category: 'Licores', stock: 18, minimum: 6, price: 14000, unit: 'trago' },
  { id: 12, name: 'Whisky Old Parr 12 anos', category: 'Licores', stock: 12, minimum: 4, price: 26000, unit: 'trago' },
  { id: 13, name: 'Whisky Johnnie Walker Red', category: 'Licores', stock: 12, minimum: 4, price: 22000, unit: 'trago' },
  { id: 14, name: 'Tequila Jose Cuervo', category: 'Licores', stock: 12, minimum: 4, price: 18000, unit: 'trago' },
  { id: 15, name: 'Vodka Smirnoff', category: 'Licores', stock: 12, minimum: 4, price: 16000, unit: 'trago' },
  { id: 16, name: 'Copa de vino tinto', category: 'Vinos', stock: 15, minimum: 5, price: 18000, unit: 'copa' },
  { id: 17, name: 'Copa de vino blanco', category: 'Vinos', stock: 15, minimum: 5, price: 18000, unit: 'copa' },
  { id: 18, name: 'Agua sin gas', category: 'Sin alcohol', stock: 30, minimum: 10, price: 4500, unit: 'botella' },
  { id: 19, name: 'Gaseosa Coca-Cola', category: 'Sin alcohol', stock: 30, minimum: 10, price: 6000, unit: 'botella' },
  { id: 20, name: 'Agua tonica', category: 'Sin alcohol', stock: 18, minimum: 6, price: 7000, unit: 'botella' },
]

export const initialUsers: User[] = [
  { id: 1, name: 'Valentina Rojas', username: 'valentina', zone: 'Salón principal', role: 'waiter', active: true },
  { id: 2, name: 'Santiago Mora', username: 'santiago', zone: 'Terraza', role: 'waiter', active: true },
  { id: 3, name: 'Camila Perez', username: 'camila', zone: 'Barra', role: 'waiter', active: true },
]

export const initialEstablishments: Establishment[] = [{ id: 'rincon-caribeno', name: 'Rincón Caribeño', city: 'Cartagena' }]
export const taxIdExamples: Record<string, { label: string; placeholder: string }> = {
  Colombia: { label: 'NIT', placeholder: 'Ej. 900.123.456-7' },
  México: { label: 'RFC', placeholder: 'Ej. XAXX010101000' },
  España: { label: 'NIF', placeholder: 'Ej. B12345678' },
  'Estados Unidos': { label: 'EIN', placeholder: 'Ej. 12-3456789' },
  Argentina: { label: 'CUIT', placeholder: 'Ej. 30-12345678-9' },
  Chile: { label: 'RUT', placeholder: 'Ej. 76.123.456-7' },
  Perú: { label: 'RUC', placeholder: 'Ej. 20123456789' },
}

export const emptyRecords: Records = { products: [], sales: [], requests: [], users: [] }
const initialRecords: Record<string, Records> = {
  'rincon-caribeno': {
    products: initialProducts,
    sales: [],
    requests: [],
    users: initialUsers,
  },
}
export const recordsStorageKey = 'barflow-records-by-establishment'
export const establishmentsStorageKey = 'barflow-establishments'
export const turnsStorageKey = 'barflow-turns-by-establishment'

/** Convert UI records into the database payload, excluding profile-derived staff. */
export const operationalStateFor = (records: Records, turn: TurnState): OperationalState => ({
  products: records.products,
  sales: records.sales,
  requests: records.requests,
  turn,
})

/** Validate untrusted JSON from Supabase before putting it into application state. */
export const parseOperationalState = (value: unknown): OperationalState => {
  if (!value || typeof value !== 'object') throw new Error('El estado operativo guardado no es válido.')
  const state = value as Partial<OperationalState>
  if (!Array.isArray(state.products) || !Array.isArray(state.sales) || !Array.isArray(state.requests)
    || !state.turn || typeof state.turn.startedAt !== 'number'
    || (typeof state.turn.endedAt !== 'number' && state.turn.endedAt !== null)) {
    throw new Error('El estado operativo guardado está incompleto o dañado.')
  }
  return { products: state.products, sales: state.sales, requests: state.requests, turn: state.turn }
}

/** Currency and date helpers keep all UI formatting in the Spanish-Colombia locale. */
export const money = (value: number) => `$${value.toLocaleString('es-CO')}`
export const formatDateInputValue = (timestamp: number) => {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export const parseDateInputValue = (value: string) => {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day).getTime()
}
export const formatExactTime = (timestamp: number) => new Date(timestamp).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
export const formatExactDateTime = (timestamp: number) => new Date(timestamp).toLocaleString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
export const readTurnStates = (value: string | null): Record<string, TurnState> => {
  try { return JSON.parse(value ?? 'null') ?? {} } catch { return {} }
}

/** Initialize missing legacy turn records without changing already persisted turns. */
export const initializeTurnStates = (establishmentIds: string[]) => {
  const turns = readTurnStates(localStorage.getItem(turnsStorageKey))
  let changed = false
  establishmentIds.forEach((id) => {
    const turn = turns[id]
    if (!turn || typeof turn.startedAt !== 'number') {
      turns[id] = { startedAt: Date.now(), endedAt: null }
      changed = true
    } else if (typeof turn.endedAt !== 'number' && turn.endedAt !== null) {
      turns[id] = { ...turn, endedAt: null }
      changed = true
    }
  })
  if (changed) localStorage.setItem(turnsStorageKey, JSON.stringify(turns))
  return turns
}

export const formatDuration = (durationMs: number) => {
  const totalSeconds = Math.floor(durationMs / 1000)
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0')
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0')
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}

/** Return local-calendar boundaries for one of the sales reporting periods. */
export const getSalesPeriodBounds = (period: SalesPeriod, timestamp: number) => {
  const date = new Date(timestamp)
  let start: Date
  if (period === 'Día') start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  else if (period === 'Semana') start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - (date.getDay() + 6) % 7)
  else if (period === 'Mes') start = new Date(date.getFullYear(), date.getMonth(), 1)
  else if (period === 'Trimestre') start = new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1)
  else start = new Date(date.getFullYear(), 0, 1)
  const end = new Date(start)
  if (period === 'Día') end.setDate(end.getDate() + 1)
  else if (period === 'Semana') end.setDate(end.getDate() + 7)
  else if (period === 'Mes') end.setMonth(end.getMonth() + 1)
  else if (period === 'Trimestre') end.setMonth(end.getMonth() + 3)
  else end.setFullYear(end.getFullYear() + 1)
  return { start: start.getTime(), end: end.getTime() }
}

export const requestTotal = (request: Request, products: Product[]) => request.itemsList?.reduce((total, line) => {
  const product = products.find((item) => item.id === line.productId)
  return total + (line.unitPrice ?? product?.price ?? 0) * line.quantity
}, 0) ?? 0

/** Group line-item sales into ticket entries for the sales ledger. */
export const groupSalesByOrder = (sales: Sale[]) => {
  const entries = new Map<string, SalesLedgerEntry>()
  sales.forEach((sale) => {
    const id = sale.requestId === undefined ? `sale-${sale.id}` : `request-${sale.requestId}`
    const existing = entries.get(id)
    if (existing) {
      existing.products.push(`${sale.quantity}x ${sale.product}`)
      existing.total += sale.total
      return
    }
    const dispatchedAt = sale.createdAt ?? 0
    entries.set(id, {
      id,
      orderedAt: sale.requestedAt ?? dispatchedAt,
      dispatchedAt,
      server: sale.server,
      table: sale.table ?? 'Venta de caja',
      products: [`${sale.quantity}x ${sale.product}`],
      total: sale.total,
    })
  })
  return [...entries.values()].sort((left, right) => right.orderedAt - left.orderedAt)
}

/** Read the previous browser format and fill fields introduced by later UI versions. */
export const loadRecords = (value: string | null): Record<string, Records> => {
  try {
    const stored = JSON.parse(value ?? 'null') as Record<string, Records> | null
    if (!stored) return initialRecords
    return Object.fromEntries(Object.entries(stored).map(([id, establishmentRecords]) => [
      id,
      {
        ...establishmentRecords,
        products: establishmentRecords.products?.length ? establishmentRecords.products : initialProducts.map((product) => ({ ...product })),
        users: (establishmentRecords.users ?? []).map((user) => ({
          id: user.id,
          name: user.name,
          username: user.username,
          zone: user.zone,
          role: user.role ?? 'waiter',
          active: user.active,
        })),
      },
    ]))
  } catch {
    return initialRecords
  }
}
