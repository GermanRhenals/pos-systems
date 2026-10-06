import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import './App.css'
import { staffAuthEmail, supabase } from './supabase'

type Product = { id: number; name: string; category: string; stock: number; minimum: number; price: number; unit: string }
type Sale = { id: number; product: string; quantity: number; total: number; time: string; server: string; createdAt?: number; requestId?: number; requestedAt?: number; table?: string }
type Request = { id: number; requesterId?: number | string; server: string; table: string; items: string; itemsList?: { productId: number; quantity: number; unitPrice?: number }[]; time: string; createdAt?: number; status: 'Pendiente' | 'Despachado' }
type User = { id: number | string; name: string; username: string; zone: string; role: 'waiter' | 'bar'; active: boolean }
type Establishment = { id: string; name: string; city: string; country?: string; taxId?: string; owner_id?: string }
type Records = { products: Product[]; sales: Sale[]; requests: Request[]; users: User[] }
type TurnState = { startedAt: number; endedAt: number | null }
type SalesPeriod = 'Día' | 'Semana' | 'Mes' | 'Trimestre' | 'Año'
type SalesLedgerEntry = { id: string; orderedAt: number; dispatchedAt: number; server: string; table: string; products: string[]; total: number }
type RootEstablishment = { id: string; name: string; city: string; country: string; taxId: string }
type RootAccount = { id: string; fullName: string; email: string; createdAt: string; lastSignInAt: string | null; emailConfirmedAt: string | null; bannedUntil: string | null; establishments: RootEstablishment[] }
type RootAuditEntry = { id: number; action: string; target_user_id: string | null; details: Record<string, unknown>; created_at: string }
type MfaFlow = { factorId: string; challengeId: string; qrCode?: string; secret?: string }

const initialProducts: Product[] = [
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
const initialSales: Sale[] = []
const initialRequests: Request[] = []
const initialUsers: User[] = [
  { id: 1, name: 'Valentina Rojas', username: 'valentina', zone: 'Salón principal', role: 'waiter', active: true },
  { id: 2, name: 'Santiago Mora', username: 'santiago', zone: 'Terraza', role: 'waiter', active: true },
  { id: 3, name: 'Camila Perez', username: 'camila', zone: 'Barra', role: 'waiter', active: true },
]
const initialEstablishments: Establishment[] = [{ id: 'rincon-caribeno', name: 'Rincón Caribeño', city: 'Cartagena' }]
const taxIdExamples: Record<string, { label: string; placeholder: string }> = {
  Colombia: { label: 'NIT', placeholder: 'Ej. 900.123.456-7' },
  México: { label: 'RFC', placeholder: 'Ej. XAXX010101000' },
  España: { label: 'NIF', placeholder: 'Ej. B12345678' },
  'Estados Unidos': { label: 'EIN', placeholder: 'Ej. 12-3456789' },
  Argentina: { label: 'CUIT', placeholder: 'Ej. 30-12345678-9' },
  Chile: { label: 'RUT', placeholder: 'Ej. 76.123.456-7' },
  Perú: { label: 'RUC', placeholder: 'Ej. 20123456789' },
}
const emptyRecords: Records = { products: [], sales: [], requests: [], users: [] }
const initialRecords: Record<string, Records> = { 'rincon-caribeno': { products: initialProducts, sales: initialSales, requests: initialRequests, users: initialUsers } }
const recordsStorageKey = 'barflow-records-by-establishment'
const establishmentsStorageKey = 'barflow-establishments'
const turnsStorageKey = 'barflow-turns-by-establishment'
const money = (value: number) => `$${value.toLocaleString('es-CO')}`
const formatDateInputValue = (timestamp: number) => {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const parseDateInputValue = (value: string) => {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day).getTime()
}
const formatExactTime = (timestamp: number) => new Date(timestamp).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
const formatExactDateTime = (timestamp: number) => new Date(timestamp).toLocaleString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
const readTurnStates = (value: string | null): Record<string, TurnState> => {
  try { return JSON.parse(value ?? 'null') ?? {} } catch { return {} }
}
const initializeTurnStates = (establishmentIds: string[]) => {
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
const formatDuration = (durationMs: number) => {
  const totalSeconds = Math.floor(durationMs / 1000)
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0')
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0')
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}
const getSalesPeriodBounds = (period: SalesPeriod, timestamp: number) => {
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
const requestTotal = (request: Request, products: Product[]) => request.itemsList?.reduce((total, line) => {
  const product = products.find((item) => item.id === line.productId)
  return total + (line.unitPrice ?? product?.price ?? 0) * line.quantity
}, 0) ?? 0
const groupSalesByOrder = (sales: Sale[]) => {
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
const loadRecords = (value: string | null): Record<string, Records> => {
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
  } catch { return initialRecords }
}

function App() {
  const rootPreview = import.meta.env.DEV && new URLSearchParams(window.location.search).get('root-preview') === '1'
  const previewAccount: RootAccount = {
    id: 'preview-root-account',
    fullName: 'María Administradora (demo)',
    email: 'maria.admin@example.com',
    createdAt: '2026-10-01T14:30:00.000Z',
    lastSignInAt: '2026-10-05T15:20:00.000Z',
    emailConfirmedAt: '2026-10-01T14:35:00.000Z',
    bannedUntil: null,
    establishments: [{
      id: 'preview-establishment',
      name: 'Café de demostración',
      city: 'Cartagena',
      country: 'Colombia',
      taxId: 'NIT de ejemplo',
    }],
  }
  const [session, setSession] = useState<{ role: 'root' | 'admin' | 'waiter' | 'bar'; user?: User } | null>(rootPreview ? { role: 'root' } : null)
  const [showLogin, setShowLogin] = useState(!rootPreview)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [registration, setRegistration] = useState({ name: '', email: '', password: '' })
  const [authLoading, setAuthLoading] = useState(!rootPreview)
  const [mfaFlow, setMfaFlow] = useState<MfaFlow | null>(null)
  const [mfaCode, setMfaCode] = useState('')
  const [rootAccounts, setRootAccounts] = useState<RootAccount[]>(rootPreview ? [previewAccount] : [])
  const [rootAudit, setRootAudit] = useState<RootAuditEntry[]>(rootPreview ? [{
    id: 1,
    action: 'update_establishment',
    target_user_id: previewAccount.id,
    details: { establishmentId: 'preview-establishment', before: { city: 'Barranquilla' }, after: { city: 'Cartagena' } },
    created_at: '2026-10-05T15:10:00.000Z',
  }] : [])
  const [rootSearch, setRootSearch] = useState('')
  const [rootEdits, setRootEdits] = useState<Record<string, { fullName: string; email: string }>>({})
  const [rootEstablishmentEdits, setRootEstablishmentEdits] = useState<Record<string, RootEstablishment>>({})
  const [rootError, setRootError] = useState('')
  const [rootLoading, setRootLoading] = useState(false)
  const [login, setLogin] = useState({ username: '', password: '' })
  const [loginError, setLoginError] = useState('')
  const [activeView, setActiveView] = useState(rootPreview ? 'Consola root' : 'Resumen')
  const [establishments, setEstablishments] = useState<Establishment[]>(() => {
    try { return JSON.parse(localStorage.getItem(establishmentsStorageKey) ?? 'null') ?? initialEstablishments } catch { return initialEstablishments }
  })
  const [activeEstablishmentId, setActiveEstablishmentId] = useState(() => {
    try { return JSON.parse(localStorage.getItem(establishmentsStorageKey) ?? 'null')?.[0]?.id ?? initialEstablishments[0].id } catch { return initialEstablishments[0].id }
  })
  const [turns, setTurns] = useState(() => initializeTurnStates(establishments.map((establishment) => establishment.id)))
  const [clockNow, setClockNow] = useState(() => Date.now())
  const [recordsByEstablishment, setRecordsByEstablishment] = useState<Record<string, Records>>(() => loadRecords(localStorage.getItem(recordsStorageKey)))
  const [search, setSearch] = useState('')
  const [newUser, setNewUser] = useState<{ name: string; username: string; password: string; role: User['role']; zone: string }>({ name: '', username: '', password: '', role: 'waiter', zone: 'Salón principal' })
  const [newRequest, setNewRequest] = useState({ table: '', items: '' })
  const [waiterProductSearch, setWaiterProductSearch] = useState('')
  const [waiterCart, setWaiterCart] = useState<Record<number, number>>({})
  const [salesPeriod, setSalesPeriod] = useState<SalesPeriod>('Día')
  const [salesDate, setSalesDate] = useState(() => formatDateInputValue(Date.now()))
  const [newEstablishment, setNewEstablishment] = useState({ name: '', city: '', country: 'Colombia', taxId: '' })
  const [toast, setToast] = useState('')
  const hasMounted = useRef(false)
  const records = recordsByEstablishment[activeEstablishmentId] ?? emptyRecords
  const activeTurn = turns[activeEstablishmentId] ?? { startedAt: clockNow, endedAt: null }
  const turnDuration = Math.max(0, (activeTurn.endedAt ?? clockNow) - activeTurn.startedAt)
  const { products, sales: allSales, requests, users } = records
  const sales = allSales.filter((sale) => sale.createdAt !== undefined && sale.createdAt >= activeTurn.startedAt && sale.createdAt <= (activeTurn.endedAt ?? clockNow))
  const activeEstablishment = establishments.find((establishment) => establishment.id === activeEstablishmentId) ?? establishments[0]
  const totalStock = products.reduce((total, product) => total + product.stock, 0)
  const lowStock = products.filter((product) => product.stock <= product.minimum).length
  const totalSales = sales.reduce((total, sale) => total + sale.total, 0)
  const reportTimestamp = salesDate ? parseDateInputValue(salesDate) : clockNow
  const periodBounds = getSalesPeriodBounds(salesPeriod, reportTimestamp)
  const periodRangeLabel = `${new Date(periodBounds.start).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })} - ${new Date(periodBounds.end - 1).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}`
  const salesInPeriod = allSales.filter((sale) => sale.createdAt !== undefined && sale.createdAt >= periodBounds.start && sale.createdAt < periodBounds.end)
  const periodSalesTotal = salesInPeriod.reduce((total, sale) => total + sale.total, 0)
  const periodUnits = salesInPeriod.reduce((total, sale) => total + sale.quantity, 0)
  const salesLedger = groupSalesByOrder(salesInPeriod)
  const pendingRequests = requests.filter((request) => request.status === 'Pendiente').length
  const serverCount = users.filter((user) => user.role === 'waiter').length
  const isAdmin = session?.role === 'admin'
  const isRoot = session?.role === 'root'
  const isBar = session?.role === 'bar'
  const isWaiter = session?.role === 'waiter'
  useEffect(() => {
    if (!hasMounted.current) { hasMounted.current = true; return }
    localStorage.setItem(recordsStorageKey, JSON.stringify(recordsByEstablishment))
  }, [recordsByEstablishment])
  useEffect(() => { if (hasMounted.current) localStorage.setItem(establishmentsStorageKey, JSON.stringify(establishments)) }, [establishments])
  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    if (activeTurn.endedAt !== null) setWaiterCart({})
  }, [activeTurn.endedAt])
  useEffect(() => {
    if (rootPreview) return
    if (!supabase) {
      setAuthLoading(false)
      return
    }
    const client = supabase
    let active = true
    const hydrateSession = async (userId: string) => {
      const { data: profile, error: profileError } = await client
        .from('profiles')
        .select('id, username, full_name, role, zone, establishment_id')
        .eq('id', userId)
        .single()
      if (!active) return
      if (profileError) {
        setLoginError(`No se pudo cargar el perfil: ${profileError.message}`)
        setAuthLoading(false)
        return
      }
      const user: User | undefined = profile.role === 'admin' ? undefined : {
        id: profile.id,
        username: profile.username ?? '',
        name: profile.full_name,
        zone: profile.zone,
        role: profile.role,
        active: true,
      }
      const { data: rootAccess, error: rootAccessError } = await client
        .from('root_users')
        .select('id')
        .eq('id', userId)
        .maybeSingle()
      if (!active) return
      if (rootAccessError) {
        setLoginError(`No se pudo verificar el acceso root: ${rootAccessError.message}`)
        setAuthLoading(false)
        return
      }
      if (rootAccess) {
        const { data: assurance, error: assuranceError } = await client.auth.mfa.getAuthenticatorAssuranceLevel()
        if (assuranceError || assurance.currentLevel !== 'aal2') {
          setSession(null)
          setShowLogin(true)
          setLoginError('La cuenta root requiere verificación multifactor para continuar.')
          setAuthLoading(false)
          return
        }
        setSession({ role: 'root' })
        setActiveView('Consola root')
        setShowLogin(false)
        setAuthLoading(false)
        return
      }
      const nextSession = { role: profile.role as 'admin' | 'waiter' | 'bar', user }
      setSession(nextSession)
      setActiveView(profile.role === 'admin' ? 'Resumen' : 'Solicitudes')
      const establishmentQuery = client.from('establishments').select('id, name, city, country, tax_id, owner_id')
      const { data: establishmentRows, error: establishmentError } = profile.role === 'admin'
        ? await establishmentQuery.eq('owner_id', userId).order('created_at')
        : await establishmentQuery.eq('id', profile.establishment_id)
      if (!active) return
      if (establishmentError) {
        setLoginError(`No se pudieron cargar los establecimientos: ${establishmentError.message}`)
        setAuthLoading(false)
        return
      }
      const nextEstablishments = (establishmentRows ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        city: row.city,
        country: row.country,
        taxId: row.tax_id,
        owner_id: row.owner_id,
      }))
      setEstablishments(nextEstablishments)
      const selectedEstablishmentId = profile.role === 'admin'
        ? nextEstablishments[0]?.id
        : profile.establishment_id
      if (selectedEstablishmentId) {
        setActiveEstablishmentId(selectedEstablishmentId)
        const { data: staff, error: staffError } = await client
          .from('profiles')
          .select('id, username, full_name, role, zone')
          .eq('establishment_id', selectedEstablishmentId)
        if (!active) return
        if (staffError) setLoginError(`No se pudo cargar el equipo: ${staffError.message}`)
        setRecordsByEstablishment((current) => {
          const prior = current[selectedEstablishmentId] ?? { ...emptyRecords, products: initialProducts.map((product) => ({ ...product })) }
          return {
            ...current,
            [selectedEstablishmentId]: {
              ...prior,
              users: (staff ?? (user ? [profile] : [])).map((person) => ({
                id: person.id,
                username: person.username,
                name: person.full_name,
                role: person.role as User['role'],
                zone: person.zone,
                active: true,
              })),
            },
          }
        })
      } else {
        setActiveView('Establecimientos')
      }
      setShowLogin(false)
      setAuthLoading(false)
    }
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) setLoginError(`No se pudo verificar la sesión: ${error.message}`)
      if (data.session) void hydrateSession(data.session.user.id)
      else {
        setSession(null)
        setShowLogin(true)
        setAuthLoading(false)
      }
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, authSession) => {
      if (authSession) {
        setAuthLoading(true)
        window.setTimeout(() => { void hydrateSession(authSession.user.id) }, 0)
      } else if (active) {
        setSession(null)
        setShowLogin(true)
        setAuthLoading(false)
      }
    })
    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])
  useEffect(() => {
    if (rootPreview || !supabase || !activeEstablishmentId || !session) return
    const client = supabase
    let active = true
    const loadStaff = async () => {
      const { data, error } = await client
        .from('profiles')
        .select('id, username, full_name, role, zone')
        .eq('establishment_id', activeEstablishmentId)
      if (!active) return
      if (error) {
        setLoginError(`No se pudo cargar el equipo: ${error.message}`)
        return
      }
      setRecordsByEstablishment((current) => {
        const existing = current[activeEstablishmentId] ?? { ...emptyRecords, products: initialProducts.map((product) => ({ ...product })) }
        return {
          ...current,
          [activeEstablishmentId]: {
            ...existing,
            users: data.map((person) => ({
              id: person.id,
              username: person.username,
              name: person.full_name,
              role: person.role as User['role'],
              zone: person.zone,
              active: true,
            })),
          },
        }
      })
    }
    void loadStaff()
    return () => { active = false }
  }, [activeEstablishmentId, session])
  useEffect(() => {
    if (isRoot && !rootPreview) void loadRootConsole()
  }, [isRoot])
  useEffect(() => {
    const syncRecords = (event: StorageEvent) => {
      if (event.key === recordsStorageKey && event.newValue) setRecordsByEstablishment(loadRecords(event.newValue))
      if (event.key === establishmentsStorageKey && event.newValue) setEstablishments(JSON.parse(event.newValue))
      if (event.key === turnsStorageKey && event.newValue) setTurns(readTurnStates(event.newValue))
    }
    const syncLocalRecords = () => {
      const storedRecords = localStorage.getItem(recordsStorageKey)
      if (storedRecords) setRecordsByEstablishment(loadRecords(storedRecords))
    }
    window.addEventListener('storage', syncRecords)
    window.addEventListener('barflow-records-updated', syncLocalRecords)
    const refreshTimer = window.setInterval(syncLocalRecords, 1000)
    return () => { window.removeEventListener('storage', syncRecords); window.removeEventListener('barflow-records-updated', syncLocalRecords); window.clearInterval(refreshTimer) }
  }, [])
  const visibleProducts = products.filter((product) => product.name.toLowerCase().includes(search.toLowerCase()) || product.category.toLowerCase().includes(search.toLowerCase()))
  const availableWaiterProducts = products.filter((product) => product.name.toLowerCase().includes(waiterProductSearch.toLowerCase()) || product.category.toLowerCase().includes(waiterProductSearch.toLowerCase()))
  const waiterCartShortages = Object.entries(waiterCart).flatMap(([productId, quantity]) => {
    const product = products.find((item) => item.id === Number(productId))
    return !product || product.stock < quantity ? [`${product?.name ?? 'Producto eliminado'}: solicitaste ${quantity}, disponibles ${product?.stock ?? 0}`] : []
  })
  const categories = useMemo(() => ['Todos', ...new Set(products.map((product) => product.category))], [products])
  const showToast = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2600) }
  const loadRootConsole = async () => {
    if (rootPreview) { showToast('Vista previa local: no se consultan ni cambian datos reales'); return }
    if (!supabase) return
    setRootLoading(true)
    const { data, error } = await supabase.functions.invoke('root-console', { body: { action: 'list' } })
    if (error || data?.error) {
      setRootError(error?.message ?? data.error)
      setRootLoading(false)
      return
    }
    const accounts = data.accounts as RootAccount[]
    setRootAccounts(accounts)
    setRootAudit(data.audit as RootAuditEntry[])
    setRootEdits(Object.fromEntries(accounts.map((account) => [account.id, { fullName: account.fullName, email: account.email }])))
    setRootEstablishmentEdits(Object.fromEntries(accounts.flatMap((account) => account.establishments.map((establishment) => [establishment.id, establishment]))))
    setRootError('')
    setRootLoading(false)
  }
  const runRootAction = async (payload: Record<string, unknown>, successMessage: string) => {
    if (rootPreview) { showToast('Vista previa local: los cambios no se guardan'); return }
    if (!supabase) return
    setRootError('')
    const { data, error } = await supabase.functions.invoke('root-console', { body: payload })
    if (error || data?.error) {
      setRootError(error?.message ?? data.error)
      return
    }
    showToast(successMessage)
    await loadRootConsole()
  }
  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase) { setLoginError('Falta configurar Supabase para iniciar sesión'); return }
    const username = login.username.trim().toLowerCase().replace(/\s+/g, '.')
    const email = username.includes('@') ? username : staffAuthEmail(username)
    setAuthLoading(true)
    const { data: authResult, error } = await supabase.auth.signInWithPassword({ email, password: login.password })
    if (error) {
      setLoginError('Usuario o contraseña incorrectos')
      setAuthLoading(false)
      return
    }
    const { data: rootAccess, error: rootAccessError } = await supabase
      .from('root_users')
      .select('id')
      .eq('id', authResult.user.id)
      .maybeSingle()
    if (rootAccessError) {
      setLoginError(`No se pudo verificar el acceso root: ${rootAccessError.message}`)
      setAuthLoading(false)
      return
    }
    if (rootAccess) {
      const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (assuranceError) {
        setLoginError(`No se pudo verificar MFA: ${assuranceError.message}`)
        setAuthLoading(false)
        return
      }
      if (assurance.currentLevel !== 'aal2') {
        const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors()
        if (factorsError) {
          setLoginError(`No se pudo preparar MFA: ${factorsError.message}`)
          setAuthLoading(false)
          return
        }
        const verifiedFactor = factors.totp.find((factor) => factor.status === 'verified')
        let factorId: string
        let qrCode: string | undefined
        let secret: string | undefined
        if (verifiedFactor) {
          factorId = verifiedFactor.id
        } else {
          const { data: enrollment, error: enrollmentError } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Kuantika POS Root' })
          if (enrollmentError) {
            setLoginError(`No se pudo iniciar la configuración de MFA: ${enrollmentError.message}`)
            setAuthLoading(false)
            return
          }
          factorId = enrollment.id
          qrCode = enrollment.totp.qr_code
          secret = enrollment.totp.secret
        }
        const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId })
        if (challengeError) {
          setLoginError(`No se pudo enviar el desafío MFA: ${challengeError.message}`)
          setAuthLoading(false)
          return
        }
        setMfaFlow({ factorId, challengeId: challenge.id, qrCode, secret })
        setAuthLoading(false)
        setLoginError('')
        return
      }
    }
    setLoginError('')
  }
  const verifyRootMfa = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || !mfaFlow) return
    setAuthLoading(true)
    const { error } = await supabase.auth.mfa.verify({
      factorId: mfaFlow.factorId,
      challengeId: mfaFlow.challengeId,
      code: mfaCode.trim(),
    })
    if (error) {
      setLoginError(`Código MFA no válido: ${error.message}`)
      setAuthLoading(false)
      return
    }
    setMfaFlow(null)
    setMfaCode('')
    setLoginError('')
  }
  const signUpAdministrator = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase) { setLoginError('Falta configurar Supabase para crear una cuenta'); return }
    setAuthLoading(true)
    const { data, error } = await supabase.auth.signUp({
      email: registration.email.trim().toLowerCase(),
      password: registration.password,
      options: { data: { full_name: registration.name.trim() } },
    })
    if (error) {
      setLoginError(error.message)
      setAuthLoading(false)
      return
    }
    if (!data.session) {
      setLoginError('Cuenta creada. Revisa tu correo para confirmar el registro e iniciar sesión.')
      setAuthLoading(false)
      setAuthMode('login')
      return
    }
    setLoginError('')
  }
  const signOut = async () => {
    if (supabase) {
      const { error } = await supabase.auth.signOut()
      if (error) { showToast(`No se pudo cerrar sesión: ${error.message}`); return }
    }
    setLogin({ username: '', password: '' })
    setActiveView('Resumen')
  }
  const updateRecords = (updater: (current: Records) => Records) => {
    let latest = recordsByEstablishment
    try {
      const stored = localStorage.getItem(recordsStorageKey)
      if (stored) latest = loadRecords(stored)
    } catch { latest = recordsByEstablishment }
    const next = { ...latest, [activeEstablishmentId]: updater(latest[activeEstablishmentId] ?? recordsByEstablishment[activeEstablishmentId] ?? emptyRecords) }
    setRecordsByEstablishment(next)
    localStorage.setItem(recordsStorageKey, JSON.stringify(next))
    window.dispatchEvent(new Event('barflow-records-updated'))
  }
  const updateTurns = (updater: (current: Record<string, TurnState>) => Record<string, TurnState>) => {
    const latest = readTurnStates(localStorage.getItem(turnsStorageKey))
    const next = updater({ ...turns, ...latest })
    setTurns(next)
    localStorage.setItem(turnsStorageKey, JSON.stringify(next))
  }
  const finishTurn = () => {
    if (!isAdmin || activeTurn.endedAt !== null) return
    const endedAt = Date.now()
    updateTurns((current) => ({ ...current, [activeEstablishmentId]: { ...activeTurn, endedAt } }))
    setClockNow(endedAt)
    showToast('Turno terminado')
  }
  const startTurn = () => {
    if (!isAdmin || activeTurn.endedAt === null) return
    const startedAt = Date.now()
    updateTurns((current) => ({ ...current, [activeEstablishmentId]: { startedAt, endedAt: null } }))
    setClockNow(startedAt)
    showToast('Nuevo turno iniciado desde cero')
  }
  const registerSale = (product: Product) => {
    if (product.stock === 0) { showToast('No hay existencias para registrar esta venta'); return }
    const soldAt = Date.now()
    updateRecords((current) => ({ ...current, products: current.products.map((item) => item.id === product.id ? { ...item, stock: item.stock - 1 } : item), sales: [{ id: soldAt, product: product.name, quantity: 1, total: product.price, time: formatExactTime(soldAt), server: 'Caja', createdAt: soldAt }, ...current.sales] }))
    showToast(`${product.name} agregado a ventas`)
  }
  const deleteProduct = (product: Product) => {
    if (!window.confirm(`¿Eliminar ${product.name} del inventario?`)) return
    updateRecords((current) => ({ ...current, products: current.products.filter((item) => item.id !== product.id) }))
    showToast(`${product.name} eliminado del inventario`)
  }
  const dispatchRequest = (requestId: number) => {
    if (activeTurn.endedAt !== null) { showToast('Inicia un turno para despachar y registrar pagos'); return }
    let dispatched = false
    let insufficientStock = false
    let missingItems = false
    let dispatchedTotal = 0
    updateRecords((current) => {
      const request = current.requests.find((item) => item.id === requestId)
      if (!request || request.status === 'Despachado') return current
      if (!request.itemsList) {
        missingItems = true
        return current
      }
      const hasStock = request.itemsList.every((line) => (current.products.find((product) => product.id === line.productId)?.stock ?? 0) >= line.quantity)
      if (!hasStock) { insufficientStock = true; return current }
      dispatchedTotal = requestTotal(request, current.products)
      const dispatchedAt = Date.now()
      const requestedAt = request.createdAt ?? request.id
      const salesToAdd = request.itemsList.flatMap((line) => {
        const product = current.products.find((item) => item.id === line.productId)
        return product ? [{ id: dispatchedAt + line.productId, product: product.name, quantity: line.quantity, total: (line.unitPrice ?? product.price) * line.quantity, time: formatExactTime(dispatchedAt), server: request.server, createdAt: dispatchedAt, requestId: request.id, requestedAt, table: request.table }] : []
      })
      dispatched = true
      return {
        ...current,
        products: current.products.map((product) => {
          const line = request.itemsList?.find((item) => item.productId === product.id)
          return line ? { ...product, stock: product.stock - line.quantity } : product
        }),
        sales: [...salesToAdd, ...current.sales],
        requests: current.requests.map((item) => item.id === requestId ? { ...item, status: 'Despachado' } : item),
      }
    })
    if (insufficientStock) showToast('No hay stock suficiente para despachar este pedido')
    else if (missingItems) showToast('La solicitud no tiene detalle de productos; no se puede registrar el pago')
    else if (dispatched) showToast(`Pago de ${money(dispatchedTotal)} registrado; pedido despachado`)
  }
  const refreshBarRequests = () => {
    if (!window.confirm(`¿Refrescar las solicitudes de ${activeEstablishment?.name}? Esta acción limpiará la bandeja del día.`)) return
    updateRecords((current) => ({ ...current, requests: [] }))
    showToast('Solicitudes al bar reiniciadas en cero')
  }
  const createWaiterRequest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (activeTurn.endedAt !== null) { showToast('El turno está cerrado; solicita al administrador que lo inicie'); return }
    const latestRecords = loadRecords(localStorage.getItem(recordsStorageKey))[activeEstablishmentId] ?? records
    const requestedProducts = Object.entries(waiterCart).flatMap(([productId, quantity]) => {
      const product = latestRecords.products.find((item) => item.id === Number(productId))
      return product ? [{ product, quantity }] : []
    })
    const stockShortages = Object.entries(waiterCart).flatMap(([productId, quantity]) => {
      const product = latestRecords.products.find((item) => item.id === Number(productId))
      return !product || product.stock < quantity ? [`${product?.name ?? 'Producto eliminado'}: solicitaste ${quantity}, disponibles ${product?.stock ?? 0}`] : []
    })
    if (stockShortages.length > 0) { showToast(`Stock insuficiente: ${stockShortages.join('; ')}`); return }
    const requestedItems = requestedProducts.map(({ product, quantity }) => `${quantity}x ${product.name}`).join(', ')
    if (!newRequest.table.trim() || !requestedItems || !session?.user) { showToast('Indica la mesa y agrega al menos un producto'); return }
    const itemsList = requestedProducts.map(({ product, quantity }) => ({ productId: product.id, quantity, unitPrice: product.price }))
    const orderTotal = itemsList.reduce((total, line) => total + line.unitPrice * line.quantity, 0)
    const requestedAt = Date.now()
    updateRecords((current) => ({ ...current, requests: [{ id: requestedAt, requesterId: session.user?.id, server: session.user?.name ?? 'Mesero', table: newRequest.table.trim(), items: `${requestedItems} · Total a entregar: ${money(orderTotal)}`, itemsList, time: formatExactTime(requestedAt), createdAt: requestedAt, status: 'Pendiente' }, ...current.requests] }))
    setNewRequest({ table: '', items: '' })
    setWaiterCart({})
    setWaiterProductSearch('')
    showToast(`Solicitud enviada. Entrega ${money(orderTotal)} al bar al despachar`)
  }
  const addToWaiterCart = (product: Product) => {
    if (activeTurn.endedAt !== null) { showToast('El turno está cerrado; no puedes agregar productos al pedido'); return }
    setWaiterCart((current) => {
      if (product.stock <= (current[product.id] ?? 0)) { showToast(product.stock > 0 ? `Solo hay ${product.stock} disponibles de ${product.name}` : `${product.name} no tiene existencias`); return current }
      return { ...current, [product.id]: (current[product.id] ?? 0) + 1 }
    })
  }
  const removeFromWaiterCart = (product: Product) => setWaiterCart((current) => { const next = { ...current }; if (!next[product.id] || next[product.id] === 1) delete next[product.id]; else next[product.id] -= 1; return next })
  const createUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || !activeEstablishmentId) { showToast('Inicia sesión y selecciona un establecimiento'); return }
    const username = newUser.username.trim().toLowerCase().replace(/\s+/g, '.')
    if (!newUser.name.trim() || !username || !newUser.password.trim()) { showToast('Completa nombre, usuario y contraseña'); return }
    if (!/^[a-z0-9._-]{3,32}$/.test(username) || newUser.password.length < 8) { showToast('El usuario debe tener 3–32 caracteres y la contraseña al menos 8'); return }
    if (users.some((user) => user.username === username)) { showToast('Ese nombre de usuario ya existe en este establecimiento'); return }
    const { data, error } = await supabase.functions.invoke('manage-staff', {
      body: {
        action: 'create',
        establishmentId: activeEstablishmentId,
        name: newUser.name.trim(),
        username,
        password: newUser.password,
        role: newUser.role,
        zone: newUser.zone,
      },
    })
    if (error || data?.error) { showToast(error?.message ?? data.error); return }
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, username, full_name, role, zone')
      .eq('id', data.id)
      .single()
    if (profileError) { showToast(`Cuenta creada, pero no se pudo cargar: ${profileError.message}`); return }
    updateRecords((current) => ({ ...current, users: [...current.users, {
      id: profile.id,
      username: profile.username,
      name: profile.full_name,
      zone: profile.zone,
      role: profile.role as User['role'],
      active: true,
    }] }))
    setNewUser({ name: '', username: '', password: '', role: 'waiter', zone: 'Salón principal' })
    showToast(`${newUser.role === 'bar' ? 'Usuario de bar' : 'Mesero'} creado correctamente`)
  }
  const deleteUser = async (user: User) => {
    if (!window.confirm(`¿Eliminar el usuario ${user.name}?`)) return
    if (!supabase) { showToast('Supabase no está configurado'); return }
    const { data, error } = await supabase.functions.invoke('manage-staff', {
      body: { action: 'delete', establishmentId: activeEstablishmentId, id: user.id },
    })
    if (error || data?.error) { showToast(error?.message ?? data.error); return }
    updateRecords((current) => ({ ...current, users: current.users.filter((item) => item.id !== user.id) }))
    showToast(`${user.name} eliminado`)
  }
  const createEstablishment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || !session || !isAdmin) { showToast('Inicia sesión como administrador para crear establecimientos'); return }
    if (!newEstablishment.name.trim() || !newEstablishment.city.trim() || !newEstablishment.taxId.trim()) { showToast('Completa el nombre, ubicación e identificación fiscal del establecimiento'); return }
    void (async () => {
      const { data, error } = await supabase
        .from('establishments')
        .insert({
          owner_id: (await supabase.auth.getUser()).data.user?.id,
          name: newEstablishment.name.trim(),
          city: newEstablishment.city.trim(),
          country: newEstablishment.country,
          tax_id: newEstablishment.taxId.trim(),
        })
        .select('id, name, city, country, tax_id, owner_id')
        .single()
      if (error) { showToast(`No se pudo crear el establecimiento: ${error.message}`); return }
      const establishment: Establishment = { id: data.id, name: data.name, city: data.city, country: data.country, taxId: data.tax_id, owner_id: data.owner_id }
      setEstablishments((current) => [...current, establishment])
      setRecordsByEstablishment((current) => ({ ...current, [establishment.id]: { ...emptyRecords, products: initialProducts.map((product) => ({ ...product })) } }))
      setActiveEstablishmentId(establishment.id)
      updateTurns((current) => ({ ...current, [establishment.id]: { startedAt: Date.now(), endedAt: null } }))
      setActiveView('Resumen')
      setNewEstablishment({ name: '', city: '', country: 'Colombia', taxId: '' })
      showToast('Establecimiento creado. Los datos operativos aún se guardan localmente en este navegador.')
    })()
  }

  if (authLoading) return <div className="login-screen"><div className="login-card"><div className="brand login-brand"><div className="brand-mark">K</div><div><strong>Kuantika POS</strong><span>portal de operación</span></div></div><p className="login-copy">Conectando con Kuantika POS…</p></div></div>

  if (showLogin || !session) return <div className="login-screen"><div className="login-card"><div className="brand login-brand"><div className="brand-mark">K</div><div><strong>Kuantika POS</strong><span>portal de operación</span></div></div>      <div className="ai-disclosure-login"><strong>Aviso de inteligencia artificial y arbitraje:</strong> Esta plataforma utiliza inteligencia artificial para apoyar análisis, recomendaciones y automatización operativa. Las decisiones finales y la revisión humana siguen siendo responsabilidad del usuario o administrador. Cualquier controversia derivada del uso de la plataforma se resolverá mediante arbitraje vinculante, a menos que la ley aplicable exija otra vía, y la parte que pretenda reclamar deberá seguir este mecanismo antes de acudir a otras acciones legales.</div><div className="privacy-tag privacy-tag-login"><div className="privacy-tag-header"><span className="section-kicker">ETIQUETA DE PRIVACIDAD</span><strong>Datos que usamos o recolectamos</strong></div><ul><li>Datos de cuenta: nombre completo, correo, nombre de usuario, contraseña, rol y permisos del usuario.</li><li>Datos del negocio: nombre del establecimiento, ciudad, país, identificación fiscal, zona de trabajo y nombre del turno.</li><li>Datos operativos: inventario, precios, stock, productos, mesas, pedidos, ventas, horarios y registros de despacho.</li><li>Datos de acceso y seguridad: sesión activa, autenticación de usuarios, configuración MFA y auditoría de acciones relevantes.</li><li>Datos del navegador: almacenamiento local para mantener sesión, registros y configuración operativa del sistema en este equipo.</li><li>Contenido multimedia: esta versión no permite subir ni publicar imágenes, videos, audio u otros archivos.</li></ul><div className="copyright-note"><strong>Derechos de autor y retiro de contenido:</strong> La versión actual no admite publicaciones multimedia ni tiene un canal de reportes activo. Si esas funciones se habilitan, se exigirán los derechos correspondientes y se aplicará un proceso de revisión, retiro cuando proceda y respuesta del usuario. <a href="https://github.com/GermanRhenals/pos-systems/blob/master/POLITICA-DERECHOS-AUTOR.md" target="_blank" rel="noreferrer">Lee la política completa</a>.</div></div>{!supabase ? <><h1>Falta configurar Supabase</h1><p className="login-copy">Configura la URL y la clave pública del proyecto en el archivo local `.env.local`, aplica la migración SQL y vuelve a iniciar la aplicación.</p></> : mfaFlow ? <><span className="section-kicker">SEGURIDAD DE CUENTA ROOT</span><h1>Verificación multifactor</h1><p className="login-copy">{mfaFlow.qrCode ? 'Escanea el código con una aplicación autenticadora y escribe el código generado. Guarda la clave de configuración en un lugar seguro.' : 'Escribe el código de tu aplicación autenticadora.'}</p>{mfaFlow.qrCode && <div className="mfa-setup"><img src={mfaFlow.qrCode} alt="Código QR para configurar MFA" /><code>{mfaFlow.secret}</code></div>}<form onSubmit={verifyRootMfa} className="login-form"><label>Código de verificación<input required inputMode="numeric" autoComplete="one-time-code" value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} placeholder="Código de 6 dígitos" /></label>{loginError && <span className="login-error">{loginError}</span>}<button className="primary-button" type="submit">Verificar y continuar</button></form></> : authMode === 'register' ? <><span className="section-kicker">NUEVA CUENTA ADMINISTRADORA</span><h1>Crea tu cuenta</h1><p className="login-copy">Regístrate para administrar tus establecimientos y equipo.</p><form onSubmit={signUpAdministrator} className="login-form"><label>Nombre completo<input required autoFocus value={registration.name} onChange={(event) => setRegistration({ ...registration, name: event.target.value })} placeholder="Tu nombre" /></label><label>Correo electrónico<input required type="email" value={registration.email} onChange={(event) => setRegistration({ ...registration, email: event.target.value })} placeholder="tu@correo.com" /></label><label>Contraseña<input required type="password" minLength={8} value={registration.password} onChange={(event) => setRegistration({ ...registration, password: event.target.value })} placeholder="Mínimo 8 caracteres" /></label>{loginError && <span className="login-error">{loginError}</span>}<button className="primary-button" type="submit">Crear cuenta <span>→</span></button></form><button className="back-login" onClick={() => { setAuthMode('login'); setLoginError('') }}>Ya tengo una cuenta · Iniciar sesión</button></> : <><h1>Ingresa a tu portal</h1><p className="login-copy">Accede como administrador, mesero o usuario de bar.</p><form onSubmit={signIn} className="login-form"><label>Correo (administrador) o usuario<input required autoFocus value={login.username} onChange={(event) => setLogin({ ...login, username: event.target.value })} placeholder="Tu correo o usuario" /></label><label>Contraseña<input required type="password" value={login.password} onChange={(event) => setLogin({ ...login, password: event.target.value })} placeholder="Tu contraseña" /></label>{loginError && <span className="login-error">{loginError}</span>}<button className="primary-button" type="submit">Ingresar al portal <span>→</span></button></form><button className="back-login" onClick={() => { setAuthMode('register'); setLoginError('') }}>Crear cuenta de administrador</button></>}{session && <button className="back-login" onClick={() => setShowLogin(false)}>Volver al panel</button>}</div></div>

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">K</div><div><strong>Kuantika POS</strong><span>operaciones</span></div></div>
      {!isRoot && <div className="location"><span className="live-dot" /><select value={activeEstablishmentId} disabled={!isAdmin} onChange={(event) => { setActiveEstablishmentId(event.target.value); setActiveView('Resumen'); setSearch('') }}>{establishments.map((establishment) => <option value={establishment.id} key={establishment.id}>{establishment.name}</option>)}</select><span className="chevron">⌄</span></div>}
      <nav className="main-nav">{(isRoot ? ['Consola root'] : isAdmin ? ['Resumen', 'Inventario', 'Solicitudes', 'Ventas', 'Usuarios', 'Establecimientos', 'Cierre de turno'] : ['Solicitudes']).map((view) => <button className={activeView === view ? 'nav-item active' : 'nav-item'} onClick={() => setActiveView(view)} key={view}><span className="nav-icon">{view === 'Resumen' ? '⌂' : view === 'Inventario' ? '▦' : view === 'Solicitudes' ? '↗' : view === 'Ventas' ? '$' : view === 'Usuarios' ? '♙' : view === 'Establecimientos' ? '⌂' : view === 'Consola root' ? '◆' : '◷'}</span>{view === 'Solicitudes' && isBar ? 'Bandeja del bar' : view}{view === 'Solicitudes' && pendingRequests > 0 && <span className="nav-badge">{pendingRequests}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="shift-card"><span>Sesión activa</span><strong>{isRoot ? 'Root de soporte' : isAdmin ? 'Administrador' : session.user?.name}</strong><small>{isRoot ? 'Acceso global auditado' : isBar ? `Bar · ${activeEstablishment?.name ?? ''}` : activeEstablishment?.name}</small></div><button className="user-button" onClick={() => isAdmin ? setShowLogin(true) : void signOut()}><span className="avatar">{isRoot ? 'R' : isAdmin ? 'JD' : session.user?.name.slice(0, 1)}</span><span><strong>{isRoot ? 'Root de soporte' : isAdmin ? 'Juan Delgado' : session.user?.name}</strong><small>{isAdmin ? 'Cambiar de usuario' : 'Cerrar sesión'}</small></span><span className="chevron">⌄</span></button></div>
    </aside>
    <main className="content">
      {rootPreview && <div className="root-preview-banner" role="status"><strong>Vista previa local · datos ficticios</strong><span>Solo puedes revisar la interfaz. No se consultan ni se guardan datos reales.</span></div>}
      <div className="ai-disclosure-banner"><strong>Aviso de inteligencia artificial y arbitraje:</strong> Este sitio utiliza inteligencia artificial para apoyar análisis, recomendaciones y automatización operativa. No sustituye la revisión humana ni la responsabilidad final del operador. Cualquier controversia relacionada con el uso de la plataforma se resolverá mediante arbitraje vinculante, conforme a la ley aplicable y con previo cumplimiento de este mecanismo de solución.</div>
      <div className="privacy-tag"><div className="privacy-tag-header"><span className="section-kicker">ETIQUETA DE PRIVACIDAD</span><strong>Datos que usamos o recolectamos</strong></div><ul><li>Datos de cuenta: nombre completo, correo, nombre de usuario, contraseña, rol y permisos del usuario.</li><li>Datos del negocio: nombre del establecimiento, ciudad, país, identificación fiscal, zona de trabajo y nombre del turno.</li><li>Datos operativos: inventario, precios, stock, productos, mesas, pedidos, ventas, horarios y registros de despacho.</li><li>Datos de acceso y seguridad: sesión activa, autenticación de usuarios, configuración MFA y auditoría de acciones relevantes.</li><li>Datos del navegador: almacenamiento local para mantener sesión, registros y configuración operativa del sistema en este equipo.</li><li>Contenido multimedia: esta versión no permite subir ni publicar imágenes, videos, audio u otros archivos.</li></ul><div className="copyright-note"><strong>Derechos de autor y retiro de contenido:</strong> La versión actual no admite publicaciones multimedia ni tiene un canal de reportes activo. Si esas funciones se habilitan, se exigirán los derechos correspondientes y se aplicará un proceso de revisión, retiro cuando proceda y respuesta del usuario. <a href="https://github.com/GermanRhenals/pos-systems/blob/master/POLITICA-DERECHOS-AUTOR.md" target="_blank" rel="noreferrer">Lee la política completa</a>.</div></div>
      <header className="topbar"><div><span className="eyebrow">{isRoot ? 'KUANTIKA POS · ACCESO ROOT' : `${activeEstablishment?.name.toUpperCase() ?? 'ESTABLECIMIENTO'}`}</span><h1>{activeView === 'Resumen' ? 'Resumen operativo' : activeView === 'Solicitudes' ? isBar ? 'Bandeja del bar' : 'Operación de sala' : activeView}</h1></div><div className="top-actions"><button className="icon-button" title="Notificaciones">♢<span className="notification-dot" /></button><div className="header-avatar">{isRoot ? 'R' : isAdmin ? 'JD' : session.user?.name.slice(0, 1)}</div></div></header>
      {isRoot && activeView === 'Consola root' && <section className="view-section root-console"><div className="view-toolbar"><div><span className="section-kicker">SOPORTE Y CONTROL DE ACCESO</span><h2>Administradores y establecimientos</h2></div><button className="primary-button" onClick={() => void loadRootConsole()} disabled={rootLoading}>{rootLoading ? 'Actualizando…' : 'Actualizar datos'}</button></div><p className="root-warning">Acceso privilegiado. Las modificaciones y suspensiones quedan registradas en la auditoría. Nunca se muestran ni se modifican contraseñas.</p><label className="root-search-label">Buscar administrador<input value={rootSearch} onChange={(event) => setRootSearch(event.target.value)} placeholder="Nombre o correo" /></label>{rootError && <div className="login-error" role="alert">{rootError}</div>}{rootLoading && rootAccounts.length === 0 ? <div className="panel root-empty">Cargando cuentas…</div> : rootAccounts.filter((account) => `${account.fullName} ${account.email}`.toLowerCase().includes(rootSearch.toLowerCase())).map((account) => { const accountActive = !account.bannedUntil || Date.parse(account.bannedUntil) <= Date.now(); const edits = rootEdits[account.id] ?? { fullName: account.fullName, email: account.email }; return <article className="panel root-account" key={account.id}><div className="root-account-heading"><div><span className="section-kicker">ADMINISTRADOR · {accountActive ? 'ACTIVO' : 'SUSPENDIDO'}</span><h3>{account.fullName}</h3><span className="muted">{account.email}</span></div><button className={accountActive ? 'remove-user' : 'request-action'} onClick={() => void runRootAction({ action: 'set_status', targetUserId: account.id, active: !accountActive }, accountActive ? 'Cuenta suspendida' : 'Cuenta reactivada')}>{accountActive ? 'Suspender cuenta' : 'Reactivar cuenta'}</button></div><div className="root-metadata"><span>Registro: {new Date(account.createdAt).toLocaleString('es-CO')}</span><span>Último acceso: {account.lastSignInAt ? new Date(account.lastSignInAt).toLocaleString('es-CO') : 'Nunca'}</span><span>Correo: {account.emailConfirmedAt ? 'Confirmado' : 'Pendiente de confirmar'}</span></div><form className="root-edit-form" onSubmit={(event) => { event.preventDefault(); void runRootAction({ action: 'update_admin', targetUserId: account.id, ...edits }, 'Perfil de administrador actualizado') }}><label>Nombre<input required value={edits.fullName} onChange={(event) => setRootEdits((current) => ({ ...current, [account.id]: { ...edits, fullName: event.target.value } }))} /></label><label>Correo electrónico<input required type="email" value={edits.email} onChange={(event) => setRootEdits((current) => ({ ...current, [account.id]: { ...edits, email: event.target.value } }))} /></label><button className="primary-button" type="submit">Guardar perfil</button></form><div className="root-establishments"><h4>Establecimientos ({account.establishments.length})</h4>{account.establishments.length === 0 && <span className="muted">Sin establecimientos registrados</span>}{account.establishments.map((establishment) => { const edit = rootEstablishmentEdits[establishment.id] ?? establishment; return <form className="root-establishment-form" key={establishment.id} onSubmit={(event) => { event.preventDefault(); void runRootAction({ action: 'update_establishment', targetUserId: account.id, ...edit }, 'Establecimiento corregido') }}><div className="root-establishment-title"><strong>{establishment.name}</strong><small>ID fiscal: {establishment.taxId}</small></div><label>Nombre<input required value={edit.name} onChange={(event) => setRootEstablishmentEdits((current) => ({ ...current, [establishment.id]: { ...edit, name: event.target.value } }))} /></label><label>Ciudad<input required value={edit.city} onChange={(event) => setRootEstablishmentEdits((current) => ({ ...current, [establishment.id]: { ...edit, city: event.target.value } }))} /></label><label>País<input required value={edit.country} onChange={(event) => setRootEstablishmentEdits((current) => ({ ...current, [establishment.id]: { ...edit, country: event.target.value } }))} /></label><label>Identificación fiscal<input required value={edit.taxId} onChange={(event) => setRootEstablishmentEdits((current) => ({ ...current, [establishment.id]: { ...edit, taxId: event.target.value } }))} /></label><button className="request-action" type="submit">Guardar establecimiento</button></form>})}</div></article>})}{!rootLoading && rootAccounts.length === 0 && <div className="panel root-empty">No hay cuentas de administrador para mostrar.</div>}<div className="panel root-audit"><div className="panel-heading"><div><span className="section-kicker">TRAZABILIDAD</span><h2>Actividad root reciente</h2></div><span>{rootAudit.length} eventos</span></div>{rootAudit.length === 0 ? <p className="muted">Las acciones privilegiadas aparecerán aquí.</p> : rootAudit.map((entry) => <div className="root-audit-row" key={entry.id}><span>{new Date(entry.created_at).toLocaleString('es-CO')}</span><strong>{entry.action}</strong><span>{JSON.stringify(entry.details)}</span></div>)}</div></section>}
      {!isAdmin && activeTurn.endedAt !== null && <div className="shift-closed-notice" role="status">{isBar ? 'El turno está cerrado; no se pueden despachar pedidos.' : 'El turno está cerrado. Solo un administrador puede iniciarlo; podrás solicitar al bar cuando esté abierto.'}</div>}
      {isWaiter && activeView === 'Solicitudes' && waiterCartShortages.length > 0 && <div className="stock-shortage-notice" role="alert"><strong>Stock insuficiente para esta solicitud</strong><span>{waiterCartShortages.join(' · ')}</span></div>}
      {activeView === 'Resumen' && <>
        <section className="metrics-grid"><div className="metric-card coral"><span>Ventas del turno <i>↗</i></span><strong>{money(totalSales)}</strong><small><b>+12.8%</b> vs. turno anterior</small><div className="sparkline">╱╲╱╱╲╱╱╲╱</div></div><div className="metric-card mint"><span>Unidades en stock <i>↗</i></span><strong>{totalStock}</strong><small><b>+6</b> ingresadas hoy</small><div className="sparkline">╱╲╱╲╱╱╲╱</div></div><div className="metric-card yellow"><span>Por reponer <i>↗</i></span><strong>{lowStock}<em> productos</em></strong><small><b>Atención</b> requieren compra</small><div className="sparkline">╲╱╲╱╲╱╲</div></div></section>
        <section className="main-grid"><div className="panel inventory-panel"><div className="panel-heading"><div><span className="section-kicker">CONTROL DE MERCANCÍA</span><h2>Inventario en tiempo real</h2></div><button className="text-button" onClick={() => setActiveView('Inventario')}>Ver inventario completo <span>→</span></button></div><div className="stock-table"><div className="table-row table-head"><span>Producto</span><span>Categoría</span><span>Existencia</span><span>Estado</span></div>{products.slice(0, 5).map((product) => <div className="table-row" key={product.id}><span className="product-cell"><span className="product-thumb">{product.category === 'Cervezas' ? '▥' : product.category === 'Cocteleria' ? '◒' : '◉'}</span><strong>{product.name}</strong></span><span className="muted">{product.category}</span><span><strong>{product.stock}</strong> <small>{product.unit}s</small></span><span className={product.stock <= product.minimum ? 'status warning' : 'status good'}><span />{product.stock <= product.minimum ? 'Reponer pronto' : 'En stock'}</span></div>)}</div></div>
          <div className="panel requests-panel"><div className="panel-heading"><div><span className="section-kicker">COMUNICACIÓN DE SALA</span><h2>Pedidos al bar <span className="count-pill">{pendingRequests}</span></h2></div><span className="inbox-live"><span /> En vivo</span></div><div className="request-list">{requests.map((request) => <div className="request" key={request.id}><span className="request-avatar">{request.server.slice(0, 1)}</span><div className="request-info"><strong>{request.server} <small>{request.table}</small></strong><span>{request.items}</span><time>{request.time}</time></div>{request.status === 'Pendiente' ? <button className="dispatch-button" onClick={() => dispatchRequest(request.id)}>Despachar</button> : <span className="dispatched">✓ Listo</span>}</div>)}</div><button className="full-button" onClick={() => setActiveView('Solicitudes')}>Ver todas las solicitudes <span>→</span></button></div></section>
        <section className="panel activity-panel"><div className="panel-heading"><div><span className="section-kicker">MOVIMIENTOS DEL TURNO</span><h2>Últimas ventas</h2></div><button className="filter-button">Este turno <span>⌄</span></button></div><div className="sales-table"><div className="table-row table-head"><span>Producto</span><span>Mesero</span><span>Hora</span><span className="align-right">Total</span></div>{sales.slice(0, 4).map((sale) => <div className="table-row" key={sale.id}><span><strong>{sale.quantity}x {sale.product}</strong></span><span className="muted">{sale.server}</span><span className="muted">{sale.time}</span><span className="align-right"><strong>{money(sale.total)}</strong></span></div>)}</div></section>
      </>}
      {activeView === 'Establecimientos' && <section className="view-section establishments-view"><div className="view-toolbar"><div><span className="section-kicker">ADMINISTRACIÓN DE LOCALES</span><h2>Mis establecimientos</h2></div><span className="active-users"><span />{establishments.length} establecimientos</span></div><div className="users-layout"><form className="panel user-form" onSubmit={createEstablishment}><div className="panel-heading"><div><span className="section-kicker">NUEVO LOCAL</span><h2>Agregar establecimiento</h2></div><span className="form-lock">⌂</span></div><div className="form-fields"><label>Nombre del establecimiento<input required value={newEstablishment.name} onChange={(event) => setNewEstablishment({ ...newEstablishment, name: event.target.value })} placeholder="Ej. Terraza Caribe" /></label><label>País<select value={newEstablishment.country} onChange={(event) => setNewEstablishment({ ...newEstablishment, country: event.target.value })}>{Object.keys(taxIdExamples).map((country) => <option key={country}>{country}</option>)}</select></label><label>Ciudad o ubicación<input required value={newEstablishment.city} onChange={(event) => setNewEstablishment({ ...newEstablishment, city: event.target.value })} placeholder="Ej. Cartagena" /></label><label>{taxIdExamples[newEstablishment.country].label} del establecimiento<input required value={newEstablishment.taxId} onChange={(event) => setNewEstablishment({ ...newEstablishment, taxId: event.target.value })} placeholder={taxIdExamples[newEstablishment.country].placeholder} /></label><small className="tax-id-help">El identificador fiscal cambia según el país. Ejemplos: Colombia NIT 900.123.456-7 · México RFC XAXX010101000 · España NIF B12345678 · EE. UU. EIN 12-3456789 · Argentina CUIT 30-12345678-9 · Chile RUT 76.123.456-7 · Perú RUC 20123456789.</small><button className="primary-button" type="submit">Crear establecimiento <span>→</span></button></div></form><div className="panel users-panel"><div className="panel-heading"><div><span className="section-kicker">LOCALES REGISTRADOS</span><h2>Operación independiente</h2></div></div><div className="establishment-list">{establishments.map((establishment) => <button className={establishment.id === activeEstablishmentId ? 'establishment-row selected' : 'establishment-row'} onClick={() => { setActiveEstablishmentId(establishment.id); setActiveView('Resumen') }} key={establishment.id}><span className="establishment-mark">⌂</span><span><strong>{establishment.name}</strong><small>{establishment.city}{establishment.country ? `, ${establishment.country}` : ''} · {recordsByEstablishment[establishment.id]?.products.length ?? 0} productos registrados</small></span><span className="establishment-arrow">→</span></button>)}</div></div></div></section>}
      {activeView === 'Usuarios' && <section className="view-section users-view"><div className="view-toolbar"><div><span className="section-kicker">ADMINISTRACIÓN DE ACCESOS</span><h2>Usuarios del establecimiento</h2></div><span className="active-users"><span />{users.length} usuarios activos</span></div><div className="users-layout"><form className="panel user-form" onSubmit={createUser}><div className="panel-heading"><div><span className="section-kicker">NUEVO ACCESO</span><h2>Crear usuario</h2></div><span className="form-lock">♙</span></div><div className="form-fields"><label>Nombre completo<input required value={newUser.name} onChange={(event) => setNewUser({ ...newUser, name: event.target.value })} placeholder="Ej. Laura Gómez" /></label><label>Usuario<input required minLength={3} value={newUser.username} onChange={(event) => setNewUser({ ...newUser, username: event.target.value })} placeholder="Ej. laura.gomez" /></label>      <label>Contraseña<input required type="password" minLength={8} value={newUser.password} onChange={(event) => setNewUser({ ...newUser, password: event.target.value })} placeholder="Mínimo 8 caracteres" /></label><label>Tipo de usuario<select value={newUser.role} onChange={(event) => setNewUser({ ...newUser, role: event.target.value === 'bar' ? 'bar' : 'waiter', zone: event.target.value === 'bar' ? 'Bar' : 'Salón principal' })}><option value="waiter">Mesero</option><option value="bar">Bar</option></select></label>{newUser.role === 'waiter' && <label>Zona asignada<select value={newUser.zone} onChange={(event) => setNewUser({ ...newUser, zone: event.target.value })}><option>Salón principal</option><option>Terraza</option><option>Barra</option><option>Zona VIP</option></select></label>}<button className="primary-button" type="submit">Crear usuario <span>→</span></button></div></form><div className="panel users-panel"><div className="panel-heading"><div><span className="section-kicker">EQUIPO DEL ESTABLECIMIENTO</span><h2>Meseros y bar</h2></div></div><div className="users-table"><div className="user-row user-head"><span>Nombre</span><span>Usuario</span><span>Rol / zona</span><span /></div>{users.map((user) => <div className="user-row" key={user.id}><span className="user-name"><span className="request-avatar">{user.name.slice(0, 1)}</span><strong>{user.name}</strong></span><span className="muted">@{user.username}</span><span className="user-zone">{user.role === 'bar' ? 'Bar' : `Mesero · ${user.zone}`}</span><button className="remove-user" onClick={() => deleteUser(user)} title={`Eliminar ${user.name}`}>Eliminar</button></div>)}</div></div></div></section>}
      {activeView === 'Ventas' && <section className="view-section sales-view"><div className="view-toolbar"><div><span className="section-kicker">ANÁLISIS DE INGRESOS</span><h2>Historial de pedidos y ventas</h2></div><div className="sales-report-controls"><label className="sales-date-picker">Consultar fecha<input aria-label="Fecha de consulta" type="date" value={salesDate} onChange={(event) => { setSalesDate(event.target.value); setSalesPeriod('Día') }} /></label><div className="sales-periods">{(['Día', 'Semana', 'Mes', 'Trimestre', 'Año'] as const).map((period) => <button className={salesPeriod === period ? 'selected' : ''} onClick={() => setSalesPeriod(period)} key={period}>{period}</button>)}</div></div></div><div className="sales-summary-grid"><div className="sales-summary-card coral"><span>Total vendido</span><strong>{money(periodSalesTotal)}</strong><small>{salesPeriod.toLowerCase()} · {periodRangeLabel}</small></div><div className="sales-summary-card mint"><span>Unidades vendidas</span><strong>{periodUnits}</strong><small>productos despachados</small></div><div className="sales-summary-card yellow"><span>Pedidos despachados</span><strong>{salesLedger.length}</strong><small>órdenes registradas</small></div></div><div className="panel report-sales-panel"><div className="panel-heading"><div><span className="section-kicker">AUDITORÍA DEL PERÍODO</span><h2>Detalle por pedido</h2></div><span className="active-users"><span />{activeEstablishment?.name}</span></div><div className="sales-ledger-scroll"><div className="sales-ledger-row sales-ledger-head"><span>Pedido realizado</span><span>Despachado</span><span>Mesero</span><span>Mesa</span><span>Productos solicitados</span><span className="sales-ledger-total">Total</span></div>{salesLedger.length > 0 ? salesLedger.map((entry) => <div className="sales-ledger-row" key={entry.id}><span>{formatExactDateTime(entry.orderedAt)}</span><span>{formatExactDateTime(entry.dispatchedAt)}</span><span>{entry.server}</span><span>{entry.table}</span><span className="sales-ledger-products">{entry.products.join(', ')}</span><strong className="sales-ledger-total">{money(entry.total)}</strong></div>) : <div className="empty-sales">No hay pedidos despachados en este período.</div>}</div></div></section>}
      {activeView === 'Inventario' && <section className="view-section"><div className="view-toolbar"><div><span className="section-kicker">CATÁLOGO Y EXISTENCIAS</span><h2>Todos los productos</h2></div><button className="primary-button" onClick={() => showToast('Formulario de ingreso listo para conectar')}>+ Ingresar mercancía</button></div><div className="inventory-controls"><label>Buscar producto<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ej. cerveza o coctelería" /></label><div className="category-tabs">{categories.map((category) => <button key={category} onClick={() => setSearch(category === 'Todos' ? '' : category)} className={search === category || (category === 'Todos' && search === '') ? 'selected' : ''}>{category}</button>)}</div></div><div className="product-grid">{visibleProducts.map((product) => <div className="product-card" key={product.id}><div className="product-art">{product.category === 'Cervezas' ? '▥' : product.category === 'Cocteleria' ? '◒' : '◉'}</div><div className="product-card-info"><span>{product.category}</span><h3>{product.name}</h3><strong>{money(product.price)}</strong><small>{product.stock} {product.unit}s disponibles</small></div><div className="product-actions"><button onClick={() => registerSale(product)}>Registrar venta</button><button className="delete-button" onClick={() => deleteProduct(product)} title={`Eliminar ${product.name}`}>Eliminar</button></div></div>)}</div></section>}
      {activeView === 'Solicitudes' && <section className="view-section"><div className="view-toolbar requests-toolbar"><div><span className="section-kicker">{isBar ? 'PREPARACIÓN DE PEDIDOS' : 'OPERACIÓN DE SALA'}</span><h2>{isAdmin ? 'Solicitudes de meseros' : isBar ? 'Bandeja del bar' : 'Pedir al bar'}</h2></div><div className="request-controls">{!isBar && <div className="server-counter"><strong>{serverCount}</strong><span>meseros activos</span></div>}{isAdmin && <><button className="request-action" onClick={() => setActiveView('Usuarios')}>Administrar usuarios <span>→</span></button><button className="request-action refresh-requests" onClick={refreshBarRequests}>↻ Refrescar solicitudes</button></>}</div></div>{isWaiter && <form className="panel waiter-request-form" onSubmit={createWaiterRequest}><div className="form-fields"><label>Mesa o zona<input value={newRequest.table} onChange={(event) => setNewRequest({ ...newRequest, table: event.target.value })} placeholder="Ej. Mesa 12" /></label><label>Buscar bebida<input value={waiterProductSearch} onChange={(event) => setWaiterProductSearch(event.target.value)} placeholder="Filtra por nombre o categoría" /></label></div><div className="waiter-products">{availableWaiterProducts.map((product) => <button type="button" className="waiter-product" onClick={() => addToWaiterCart(product)} key={product.id}><span className="product-thumb">{product.category === 'Cervezas' ? '▥' : product.category === 'Cocteleria' ? '◒' : '◉'}</span><span><strong>{product.name}</strong><small>{product.stock} disponibles · {product.category}</small></span><b>+ {waiterCart[product.id] ?? 0}</b></button>)}{availableWaiterProducts.length === 0 && <span className="empty-products">No hay productos disponibles para ese filtro.</span>}</div><div className="waiter-cart">{Object.keys(waiterCart).length > 0 ? Object.entries(waiterCart).map(([productId, quantity]) => { const product = products.find((item) => item.id === Number(productId)); return product ? <div className="cart-line" key={product.id}><span>{quantity}x {product.name}</span><button type="button" onClick={() => removeFromWaiterCart(product)}>−</button></div> : null }) : <span>Selecciona productos para armar tu solicitud.</span>}</div><button className="primary-button" type="submit">Enviar solicitud al bar <span>→</span></button></form>}<div className="request-board">{requests.filter((request) => isAdmin || isBar || request.requesterId === session.user?.id || request.server === session.user?.name).map((request) => <div className={`board-request ${request.status === 'Despachado' ? 'done' : ''}`} key={request.id}><div className="board-top"><span className="request-avatar">{request.server.slice(0, 1)}</span><div><strong>{request.server}</strong><small>{request.table} · {request.time}</small></div><span className={request.status === 'Pendiente' ? 'status warning' : 'status good'}><span />{request.status}</span></div><p>{request.items}</p>{(isAdmin || isBar) && request.status === 'Pendiente' ? <button className="primary-button" onClick={() => dispatchRequest(request.id)}>Despachar pedido</button> : request.status === 'Despachado' ? <span className="done-label">✓ Pedido entregado</span> : <span className="done-label">Esperando despacho del bar</span>}</div>)}</div></section>}
      {activeView === 'Cierre de turno' && <section className="view-section close-view"><div className="close-hero"><div><span className="section-kicker">CIERRE DE OPERACIÓN</span><h2>{activeTurn.endedAt === null ? 'Turno en curso' : 'Turno finalizado'}</h2><p>El contador sigue activo aunque los usuarios salgan de la aplicación.</p></div><div className="turn-clock"><span>{activeTurn.endedAt === null ? 'Tiempo transcurrido' : 'Duración del turno'}</span><strong>{formatDuration(turnDuration)}</strong>{activeTurn.endedAt === null ? <button className="primary-button" onClick={finishTurn}>Terminar turno</button> : <button className="primary-button" onClick={startTurn}>Iniciar turno</button>}</div></div><div className="close-grid"><div className="close-summary"><span>Ventas registradas</span><strong>{sales.length}</strong><small>movimientos de este turno</small></div><div className="close-summary"><span>Total vendido</span><strong>{money(totalSales)}</strong><small>ingresos brutos</small></div><div className="close-summary"><span>Unidades despachadas</span><strong>{sales.reduce((total, sale) => total + sale.quantity, 0)}</strong><small>productos vendidos</small></div></div><div className="pdf-box"><div><span className="pdf-icon">PDF</span><div><strong>Reporte de inventario y ventas</strong><small>Incluye existencias actuales, productos vendidos y solicitudes despachadas.</small></div></div><button className="primary-button" onClick={() => window.print()}>Cerrar y generar PDF <span>↗</span></button></div></section>}
      {toast && <div className="toast">✓ {toast}</div>}
    </main>
  </div>
}

export default App
