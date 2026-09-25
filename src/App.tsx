import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import './App.css'

type Product = { id: number; name: string; category: string; stock: number; minimum: number; price: number; unit: string }
type Sale = { id: number; product: string; quantity: number; total: number; time: string; server: string; createdAt?: number }
type Request = { id: number; requesterId?: number; server: string; table: string; items: string; itemsList?: { productId: number; quantity: number }[]; time: string; status: 'Pendiente' | 'Despachado' }
type User = { id: number; name: string; username: string; password: string; zone: string; active: boolean }
type Establishment = { id: string; name: string; city: string }
type Records = { products: Product[]; sales: Sale[]; requests: Request[]; users: User[] }

const initialProducts: Product[] = [
  { id: 1, name: 'Cerveza Aguila', category: 'Cervezas', stock: 46, minimum: 20, price: 8500, unit: 'botella' },
  { id: 2, name: 'Cerveza Corona', category: 'Cervezas', stock: 18, minimum: 20, price: 12000, unit: 'botella' },
  { id: 3, name: 'Gin tonic', category: 'Cocteleria', stock: 12, minimum: 8, price: 26000, unit: 'copa' },
  { id: 4, name: 'Ron Medellin 8 anos', category: 'Licores', stock: 7, minimum: 5, price: 18000, unit: 'trago' },
  { id: 5, name: 'Agua con gas', category: 'Sin alcohol', stock: 32, minimum: 12, price: 5000, unit: 'botella' },
  { id: 6, name: 'Old fashioned', category: 'Cocteleria', stock: 5, minimum: 8, price: 28000, unit: 'copa' },
]
const initialSales: Sale[] = []
const initialRequests: Request[] = []
const initialUsers: User[] = [
  { id: 1, name: 'Valentina Rojas', username: 'valentina', password: '1234', zone: 'Salón principal', active: true },
  { id: 2, name: 'Santiago Mora', username: 'santiago', password: '1234', zone: 'Terraza', active: true },
  { id: 3, name: 'Camila Perez', username: 'camila', password: '1234', zone: 'Barra', active: true },
]
const initialEstablishments: Establishment[] = [{ id: 'rincon-caribeno', name: 'Rincón Caribeño', city: 'Cartagena' }]
const emptyRecords: Records = { products: [], sales: [], requests: [], users: [] }
const initialRecords: Record<string, Records> = { 'rincon-caribeno': { products: initialProducts, sales: initialSales, requests: initialRequests, users: initialUsers } }
const recordsStorageKey = 'barflow-records-by-establishment'
const establishmentsStorageKey = 'barflow-establishments'
const money = (value: number) => `$${value.toLocaleString('es-CO')}`

function App() {
  const [session, setSession] = useState<{ role: 'admin' | 'waiter'; user?: User }>({ role: 'admin' })
  const [showLogin, setShowLogin] = useState(false)
  const [login, setLogin] = useState({ username: '', password: '' })
  const [loginError, setLoginError] = useState('')
  const [activeView, setActiveView] = useState('Resumen')
  const [establishments, setEstablishments] = useState<Establishment[]>(() => {
    try { return JSON.parse(localStorage.getItem(establishmentsStorageKey) ?? 'null') ?? initialEstablishments } catch { return initialEstablishments }
  })
  const [activeEstablishmentId, setActiveEstablishmentId] = useState(() => {
    try { return JSON.parse(localStorage.getItem(establishmentsStorageKey) ?? 'null')?.[0]?.id ?? initialEstablishments[0].id } catch { return initialEstablishments[0].id }
  })
  const [recordsByEstablishment, setRecordsByEstablishment] = useState<Record<string, Records>>(() => {
    try { return JSON.parse(localStorage.getItem(recordsStorageKey) ?? 'null') ?? initialRecords } catch { return initialRecords }
  })
  const [search, setSearch] = useState('')
  const [newUser, setNewUser] = useState({ name: '', username: '', password: '', zone: 'Salón principal' })
  const [newRequest, setNewRequest] = useState({ table: '', items: '' })
  const [waiterProductSearch, setWaiterProductSearch] = useState('')
  const [waiterCart, setWaiterCart] = useState<Record<number, number>>({})
  const [salesPeriod, setSalesPeriod] = useState<'Día' | 'Semana' | 'Trimestre' | 'Año'>('Día')
  const [newEstablishment, setNewEstablishment] = useState({ name: '', city: '' })
  const [toast, setToast] = useState('')
  const hasMounted = useRef(false)
  const records = recordsByEstablishment[activeEstablishmentId] ?? emptyRecords
  const { products, sales, requests, users } = records
  const activeEstablishment = establishments.find((establishment) => establishment.id === activeEstablishmentId) ?? establishments[0]
  const totalStock = products.reduce((total, product) => total + product.stock, 0)
  const lowStock = products.filter((product) => product.stock <= product.minimum).length
  const totalSales = sales.reduce((total, sale) => total + sale.total, 0)
  const salesInPeriod = sales.filter((sale) => {
    if (!sale.createdAt) return salesPeriod === 'Año'
    const age = Date.now() - sale.createdAt
    const periodMs = salesPeriod === 'Día' ? 24 * 60 * 60 * 1000 : salesPeriod === 'Semana' ? 7 * 24 * 60 * 60 * 1000 : salesPeriod === 'Trimestre' ? 90 * 24 * 60 * 60 * 1000 : 365 * 24 * 60 * 60 * 1000
    return age >= 0 && age <= periodMs
  })
  const periodSalesTotal = salesInPeriod.reduce((total, sale) => total + sale.total, 0)
  const periodUnits = salesInPeriod.reduce((total, sale) => total + sale.quantity, 0)
  const pendingRequests = requests.filter((request) => request.status === 'Pendiente').length
  const serverCount = users.length
  const isAdmin = session.role === 'admin'
  useEffect(() => {
    if (!hasMounted.current) { hasMounted.current = true; return }
    localStorage.setItem(recordsStorageKey, JSON.stringify(recordsByEstablishment))
  }, [recordsByEstablishment])
  useEffect(() => { if (hasMounted.current) localStorage.setItem(establishmentsStorageKey, JSON.stringify(establishments)) }, [establishments])
  useEffect(() => {
    const syncRecords = (event: StorageEvent) => {
      if (event.key === recordsStorageKey && event.newValue) setRecordsByEstablishment(JSON.parse(event.newValue))
      if (event.key === establishmentsStorageKey && event.newValue) setEstablishments(JSON.parse(event.newValue))
    }
    const syncLocalRecords = () => {
      const storedRecords = localStorage.getItem(recordsStorageKey)
      if (storedRecords) setRecordsByEstablishment(JSON.parse(storedRecords))
    }
    window.addEventListener('storage', syncRecords)
    window.addEventListener('barflow-records-updated', syncLocalRecords)
    const refreshTimer = window.setInterval(syncLocalRecords, 1000)
    return () => { window.removeEventListener('storage', syncRecords); window.removeEventListener('barflow-records-updated', syncLocalRecords); window.clearInterval(refreshTimer) }
  }, [])
  const visibleProducts = products.filter((product) => product.name.toLowerCase().includes(search.toLowerCase()) || product.category.toLowerCase().includes(search.toLowerCase()))
  const availableWaiterProducts = products.filter((product) => product.stock > 0 && (product.name.toLowerCase().includes(waiterProductSearch.toLowerCase()) || product.category.toLowerCase().includes(waiterProductSearch.toLowerCase())))
  const categories = useMemo(() => ['Todos', ...new Set(products.map((product) => product.category))], [products])
  const showToast = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2600) }
  const signIn = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (login.username === 'admin' && login.password === 'admin123') { setSession({ role: 'admin' }); setShowLogin(false); setLoginError(''); return }
    const normalizedUsername = login.username.trim().toLowerCase().replace(/\s+/g, '.')
    const user = users.find((item) => item.username === normalizedUsername && item.password === login.password)
    if (!user) { setLoginError('Usuario o contraseña incorrectos para este establecimiento'); return }
    setSession({ role: 'waiter', user }); setShowLogin(false); setActiveView('Solicitudes'); setLoginError('')
  }
  const signOut = () => { setSession({ role: 'admin' }); setLogin({ username: '', password: '' }); setActiveView('Resumen') }
  const updateRecords = (updater: (current: Records) => Records) => {
    let latest = recordsByEstablishment
    try {
      const stored = localStorage.getItem(recordsStorageKey)
      if (stored) latest = JSON.parse(stored) as Record<string, Records>
    } catch { latest = recordsByEstablishment }
    const next = { ...latest, [activeEstablishmentId]: updater(latest[activeEstablishmentId] ?? recordsByEstablishment[activeEstablishmentId] ?? emptyRecords) }
    setRecordsByEstablishment(next)
    localStorage.setItem(recordsStorageKey, JSON.stringify(next))
    window.dispatchEvent(new Event('barflow-records-updated'))
  }
  const registerSale = (product: Product) => {
    if (product.stock === 0) { showToast('No hay existencias para registrar esta venta'); return }
    updateRecords((current) => ({ ...current, products: current.products.map((item) => item.id === product.id ? { ...item, stock: item.stock - 1 } : item), sales: [{ id: Date.now(), product: product.name, quantity: 1, total: product.price, time: 'ahora', server: 'Caja', createdAt: Date.now() }, ...current.sales] }))
    showToast(`${product.name} agregado a ventas`)
  }
  const deleteProduct = (product: Product) => {
    if (!window.confirm(`¿Eliminar ${product.name} del inventario?`)) return
    updateRecords((current) => ({ ...current, products: current.products.filter((item) => item.id !== product.id) }))
    showToast(`${product.name} eliminado del inventario`)
  }
  const dispatchRequest = (requestId: number) => {
    let dispatched = false
    let insufficientStock = false
    updateRecords((current) => {
      const request = current.requests.find((item) => item.id === requestId)
      if (!request || request.status === 'Despachado') return current
      if (!request.itemsList) {
        dispatched = true
        return { ...current, requests: current.requests.map((item) => item.id === requestId ? { ...item, status: 'Despachado' } : item) }
      }
      const hasStock = request.itemsList.every((line) => (current.products.find((product) => product.id === line.productId)?.stock ?? 0) >= line.quantity)
      if (!hasStock) { insufficientStock = true; return current }
      const salesToAdd = request.itemsList.flatMap((line) => {
        const product = current.products.find((item) => item.id === line.productId)
        return product ? [{ id: Date.now() + line.productId, product: product.name, quantity: line.quantity, total: product.price * line.quantity, time: 'ahora', server: request.server, createdAt: Date.now() }] : []
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
    else if (dispatched) showToast('Pedido despachado, stock y ventas actualizados')
  }
  const refreshBarRequests = () => {
    if (!window.confirm(`¿Refrescar las solicitudes de ${activeEstablishment?.name}? Esta acción limpiará la bandeja del día.`)) return
    updateRecords((current) => ({ ...current, requests: [] }))
    showToast('Solicitudes al bar reiniciadas en cero')
  }
  const createWaiterRequest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const requestedItems = products.filter((product) => waiterCart[product.id]).map((product) => `${waiterCart[product.id]}x ${product.name}`).join(', ')
    if (!newRequest.table.trim() || !requestedItems || !session.user) { showToast('Indica la mesa y agrega al menos un producto'); return }
    const itemsList = Object.entries(waiterCart).map(([productId, quantity]) => ({ productId: Number(productId), quantity }))
    updateRecords((current) => ({ ...current, requests: [{ id: Date.now(), requesterId: session.user?.id, server: session.user?.name ?? 'Mesero', table: newRequest.table.trim(), items: requestedItems, itemsList, time: 'ahora', status: 'Pendiente' }, ...current.requests] }))
    setNewRequest({ table: '', items: '' })
    setWaiterCart({})
    setWaiterProductSearch('')
    showToast('Solicitud enviada al bar')
  }
  const addToWaiterCart = (product: Product) => setWaiterCart((current) => ({ ...current, [product.id]: Math.min((current[product.id] ?? 0) + 1, product.stock) }))
  const removeFromWaiterCart = (product: Product) => setWaiterCart((current) => { const next = { ...current }; if (!next[product.id] || next[product.id] === 1) delete next[product.id]; else next[product.id] -= 1; return next })
  const createUser = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!newUser.name.trim() || !newUser.username.trim() || !newUser.password.trim()) { showToast('Completa nombre, usuario y contraseña'); return }
    const username = newUser.username.trim().toLowerCase().replace(/\s+/g, '.')
    if (users.some((user) => user.username === username)) { showToast('Ese nombre de usuario ya existe en este establecimiento'); return }
    updateRecords((current) => current.users.some((user) => user.username === username) ? current : ({ ...current, users: [...current.users, { id: Date.now(), name: newUser.name.trim(), username, password: newUser.password.trim(), zone: newUser.zone, active: true }] }))
    setNewUser({ name: '', username: '', password: '', zone: 'Salón principal' })
    showToast('Mesero creado correctamente')
  }
  const deleteUser = (user: User) => {
    if (!window.confirm(`¿Eliminar el usuario ${user.name}?`)) return
    updateRecords((current) => ({ ...current, users: current.users.filter((item) => item.id !== user.id) }))
    showToast(`${user.name} eliminado`)
  }
  const createEstablishment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!newEstablishment.name.trim() || !newEstablishment.city.trim()) { showToast('Completa el nombre y la ciudad del establecimiento'); return }
    const id = `${newEstablishment.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`
    setEstablishments((current) => [...current, { id, name: newEstablishment.name.trim(), city: newEstablishment.city.trim() }])
    setRecordsByEstablishment((current) => ({ ...current, [id]: { ...emptyRecords, products: [], sales: [], requests: [], users: [] } }))
    setActiveEstablishmentId(id)
    setActiveView('Resumen')
    setNewEstablishment({ name: '', city: '' })
    showToast('Establecimiento creado sin registros previos')
  }

  if (showLogin) return <div className="login-screen"><div className="login-card"><div className="brand login-brand"><div className="brand-mark">B</div><div><strong>barflow</strong><span>portal de operación</span></div></div><span className="section-kicker">{activeEstablishment?.name.toUpperCase()}</span><h1>Ingresa a tu portal</h1><p className="login-copy">Accede como administrador o mesero para trabajar en este establecimiento.</p><form onSubmit={signIn} className="login-form"><label>Usuario<input autoFocus value={login.username} onChange={(event) => setLogin({ ...login, username: event.target.value })} placeholder="admin o tu usuario" /></label><label>Contraseña<input type="password" value={login.password} onChange={(event) => setLogin({ ...login, password: event.target.value })} placeholder="Tu contraseña" /></label>{loginError && <span className="login-error">{loginError}</span>}<button className="primary-button" type="submit">Ingresar al portal <span>→</span></button></form><button className="back-login" onClick={() => setShowLogin(false)}>Volver al panel administrador</button><small className="login-hint">Demo administrador: admin / admin123 · Meseros iniciales: valentina, santiago o camila / 1234</small></div></div>

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">B</div><div><strong>barflow</strong><span>operaciones</span></div></div>
      <div className="location"><span className="live-dot" /><select value={activeEstablishmentId} disabled={!isAdmin} onChange={(event) => { setActiveEstablishmentId(event.target.value); setActiveView('Resumen'); setSearch('') }}>{establishments.map((establishment) => <option value={establishment.id} key={establishment.id}>{establishment.name}</option>)}</select><span className="chevron">⌄</span></div>
      <nav className="main-nav">{(isAdmin ? ['Resumen', 'Inventario', 'Solicitudes', 'Ventas', 'Usuarios', 'Establecimientos', 'Cierre de turno'] : ['Solicitudes']).map((view) => <button className={activeView === view ? 'nav-item active' : 'nav-item'} onClick={() => setActiveView(view)} key={view}><span className="nav-icon">{view === 'Resumen' ? '⌂' : view === 'Inventario' ? '▦' : view === 'Solicitudes' ? '↗' : view === 'Ventas' ? '$' : view === 'Usuarios' ? '♙' : view === 'Establecimientos' ? '⌂' : '◷'}</span>{view}{view === 'Solicitudes' && pendingRequests > 0 && <span className="nav-badge">{pendingRequests}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="shift-card"><span>Sesión activa</span><strong>{isAdmin ? 'Administrador' : session.user?.name}</strong><small>{activeEstablishment?.name}</small></div><button className="user-button" onClick={() => isAdmin ? setShowLogin(true) : signOut()}><span className="avatar">{isAdmin ? 'JD' : session.user?.name.slice(0, 1)}</span><span><strong>{isAdmin ? 'Juan Delgado' : session.user?.name}</strong><small>{isAdmin ? 'Cambiar de usuario' : 'Cerrar sesión'}</small></span><span className="chevron">⌄</span></button></div>
    </aside>
    <main className="content">
      <header className="topbar"><div><span className="eyebrow">{activeEstablishment?.name.toUpperCase()} · VIERNES, 24 DE MAYO DE 2024</span><h1>{activeView === 'Resumen' ? 'Resumen operativo' : activeView === 'Solicitudes' ? 'Operación de sala' : activeView}</h1></div><div className="top-actions"><button className="icon-button" title="Notificaciones">♢<span className="notification-dot" /></button><div className="header-avatar">JD</div></div></header>
      {activeView === 'Resumen' && <>
        <section className="metrics-grid"><div className="metric-card coral"><span>Ventas del turno <i>↗</i></span><strong>{money(totalSales)}</strong><small><b>+12.8%</b> vs. turno anterior</small><div className="sparkline">╱╲╱╱╲╱╱╲╱</div></div><div className="metric-card mint"><span>Unidades en stock <i>↗</i></span><strong>{totalStock}</strong><small><b>+6</b> ingresadas hoy</small><div className="sparkline">╱╲╱╲╱╱╲╱</div></div><div className="metric-card yellow"><span>Por reponer <i>↗</i></span><strong>{lowStock}<em> productos</em></strong><small><b>Atención</b> requieren compra</small><div className="sparkline">╲╱╲╱╲╱╲</div></div></section>
        <section className="main-grid"><div className="panel inventory-panel"><div className="panel-heading"><div><span className="section-kicker">CONTROL DE MERCANCÍA</span><h2>Inventario en tiempo real</h2></div><button className="text-button" onClick={() => setActiveView('Inventario')}>Ver inventario completo <span>→</span></button></div><div className="stock-table"><div className="table-row table-head"><span>Producto</span><span>Categoría</span><span>Existencia</span><span>Estado</span></div>{products.slice(0, 5).map((product) => <div className="table-row" key={product.id}><span className="product-cell"><span className="product-thumb">{product.category === 'Cervezas' ? '▥' : product.category === 'Cocteleria' ? '◒' : '◉'}</span><strong>{product.name}</strong></span><span className="muted">{product.category}</span><span><strong>{product.stock}</strong> <small>{product.unit}s</small></span><span className={product.stock <= product.minimum ? 'status warning' : 'status good'}><span />{product.stock <= product.minimum ? 'Reponer pronto' : 'En stock'}</span></div>)}</div></div>
          <div className="panel requests-panel"><div className="panel-heading"><div><span className="section-kicker">COMUNICACIÓN DE SALA</span><h2>Pedidos al bar <span className="count-pill">{pendingRequests}</span></h2></div><span className="inbox-live"><span /> En vivo</span></div><div className="request-list">{requests.map((request) => <div className="request" key={request.id}><span className="request-avatar">{request.server.slice(0, 1)}</span><div className="request-info"><strong>{request.server} <small>{request.table}</small></strong><span>{request.items}</span><time>{request.time}</time></div>{request.status === 'Pendiente' ? <button className="dispatch-button" onClick={() => dispatchRequest(request.id)}>Despachar</button> : <span className="dispatched">✓ Listo</span>}</div>)}</div><button className="full-button" onClick={() => setActiveView('Solicitudes')}>Ver todas las solicitudes <span>→</span></button></div></section>
        <section className="panel activity-panel"><div className="panel-heading"><div><span className="section-kicker">MOVIMIENTOS DEL TURNO</span><h2>Últimas ventas</h2></div><button className="filter-button">Este turno <span>⌄</span></button></div><div className="sales-table"><div className="table-row table-head"><span>Producto</span><span>Mesero</span><span>Hora</span><span className="align-right">Total</span></div>{sales.slice(0, 4).map((sale) => <div className="table-row" key={sale.id}><span><strong>{sale.quantity}x {sale.product}</strong></span><span className="muted">{sale.server}</span><span className="muted">{sale.time}</span><span className="align-right"><strong>{money(sale.total)}</strong></span></div>)}</div></section>
      </>}
      {activeView === 'Establecimientos' && <section className="view-section establishments-view"><div className="view-toolbar"><div><span className="section-kicker">ADMINISTRACIÓN DE LOCALES</span><h2>Mis establecimientos</h2></div><span className="active-users"><span />{establishments.length} establecimientos</span></div><div className="users-layout"><form className="panel user-form" onSubmit={createEstablishment}><div className="panel-heading"><div><span className="section-kicker">NUEVO LOCAL</span><h2>Agregar establecimiento</h2></div><span className="form-lock">⌂</span></div><div className="form-fields"><label>Nombre del establecimiento<input value={newEstablishment.name} onChange={(event) => setNewEstablishment({ ...newEstablishment, name: event.target.value })} placeholder="Ej. Terraza Caribe" /></label><label>Ciudad o ubicación<input value={newEstablishment.city} onChange={(event) => setNewEstablishment({ ...newEstablishment, city: event.target.value })} placeholder="Ej. Cartagena" /></label><button className="primary-button" type="submit">Crear establecimiento <span>→</span></button></div></form><div className="panel users-panel"><div className="panel-heading"><div><span className="section-kicker">LOCALES REGISTRADOS</span><h2>Operación independiente</h2></div></div><div className="establishment-list">{establishments.map((establishment) => <button className={establishment.id === activeEstablishmentId ? 'establishment-row selected' : 'establishment-row'} onClick={() => { setActiveEstablishmentId(establishment.id); setActiveView('Resumen') }} key={establishment.id}><span className="establishment-mark">⌂</span><span><strong>{establishment.name}</strong><small>{establishment.city} · {recordsByEstablishment[establishment.id]?.products.length ?? 0} productos registrados</small></span><span className="establishment-arrow">→</span></button>)}</div></div></div></section>}
      {activeView === 'Usuarios' && <section className="view-section users-view"><div className="view-toolbar"><div><span className="section-kicker">ADMINISTRACIÓN DE ACCESOS</span><h2>Usuarios meseros</h2></div><span className="active-users"><span />{users.length} usuarios activos</span></div><div className="users-layout"><form className="panel user-form" onSubmit={createUser}><div className="panel-heading"><div><span className="section-kicker">NUEVO ACCESO</span><h2>Crear mesero</h2></div><span className="form-lock">♙</span></div><div className="form-fields"><label>Nombre completo<input value={newUser.name} onChange={(event) => setNewUser({ ...newUser, name: event.target.value })} placeholder="Ej. Laura Gómez" /></label><label>Nombre de usuario<input value={newUser.username} onChange={(event) => setNewUser({ ...newUser, username: event.target.value })} placeholder="Ej. laura.gomez" /></label><label>Contraseña<input type="password" value={newUser.password} onChange={(event) => setNewUser({ ...newUser, password: event.target.value })} placeholder="Crea una contraseña" /></label><label>Zona asignada<select value={newUser.zone} onChange={(event) => setNewUser({ ...newUser, zone: event.target.value })}><option>Salón principal</option><option>Terraza</option><option>Barra</option><option>Zona VIP</option></select></label><button className="primary-button" type="submit">Crear usuario <span>→</span></button></div></form><div className="panel users-panel"><div className="panel-heading"><div><span className="section-kicker">EQUIPO DE SALA</span><h2>Meseros registrados</h2></div></div><div className="users-table"><div className="user-row user-head"><span>Mesero</span><span>Usuario</span><span>Zona</span><span /></div>{users.map((user) => <div className="user-row" key={user.id}><span className="user-name"><span className="request-avatar">{user.name.slice(0, 1)}</span><strong>{user.name}</strong></span><span className="muted">@{user.username}</span><span className="user-zone">{user.zone}</span><button className="remove-user" onClick={() => deleteUser(user)} title={`Eliminar ${user.name}`}>Eliminar</button></div>)}</div></div></div></section>}
      {activeView === 'Ventas' && <section className="view-section sales-view"><div className="view-toolbar"><div><span className="section-kicker">ANÁLISIS DE INGRESOS</span><h2>Ventas por período</h2></div><div className="sales-periods">{(['Día', 'Semana', 'Trimestre', 'Año'] as const).map((period) => <button className={salesPeriod === period ? 'selected' : ''} onClick={() => setSalesPeriod(period)} key={period}>{period}</button>)}</div></div><div className="sales-summary-grid"><div className="sales-summary-card coral"><span>Total vendido</span><strong>{money(periodSalesTotal)}</strong><small>{salesPeriod.toLowerCase()} seleccionado</small></div><div className="sales-summary-card mint"><span>Unidades vendidas</span><strong>{periodUnits}</strong><small>productos despachados</small></div><div className="sales-summary-card yellow"><span>Transacciones</span><strong>{salesInPeriod.length}</strong><small>ventas registradas</small></div></div><div className="panel report-sales-panel"><div className="panel-heading"><div><span className="section-kicker">DETALLE DEL PERÍODO</span><h2>Movimientos de venta</h2></div><span className="active-users"><span />{activeEstablishment?.name}</span></div><div className="sales-table"><div className="table-row table-head"><span>Producto</span><span>Mesero / caja</span><span>Hora</span><span className="align-right">Total</span></div>{salesInPeriod.length > 0 ? salesInPeriod.map((sale) => <div className="table-row" key={sale.id}><span><strong>{sale.quantity}x {sale.product}</strong></span><span className="muted">{sale.server}</span><span className="muted">{sale.time}</span><span className="align-right"><strong>{money(sale.total)}</strong></span></div>) : <div className="empty-sales">No hay ventas registradas en este período.</div>}</div></div></section>}
      {activeView === 'Inventario' && <section className="view-section"><div className="view-toolbar"><div><span className="section-kicker">CATÁLOGO Y EXISTENCIAS</span><h2>Todos los productos</h2></div><button className="primary-button" onClick={() => showToast('Formulario de ingreso listo para conectar')}>+ Ingresar mercancía</button></div><div className="inventory-controls"><label>Buscar producto<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ej. cerveza o coctelería" /></label><div className="category-tabs">{categories.map((category) => <button key={category} onClick={() => setSearch(category === 'Todos' ? '' : category)} className={search === category || (category === 'Todos' && search === '') ? 'selected' : ''}>{category}</button>)}</div></div><div className="product-grid">{visibleProducts.map((product) => <div className="product-card" key={product.id}><div className="product-art">{product.category === 'Cervezas' ? '▥' : product.category === 'Cocteleria' ? '◒' : '◉'}</div><div className="product-card-info"><span>{product.category}</span><h3>{product.name}</h3><strong>{money(product.price)}</strong><small>{product.stock} {product.unit}s disponibles</small></div><div className="product-actions"><button onClick={() => registerSale(product)}>Registrar venta</button><button className="delete-button" onClick={() => deleteProduct(product)} title={`Eliminar ${product.name}`}>Eliminar</button></div></div>)}</div></section>}
      {activeView === 'Solicitudes' && <section className="view-section"><div className="view-toolbar requests-toolbar"><div><span className="section-kicker">OPERACIÓN DE SALA</span><h2>{isAdmin ? 'Solicitudes de meseros' : 'Pedir al bar'}</h2></div><div className="request-controls"><div className="server-counter"><strong>{serverCount}</strong><span>meseros activos</span></div>{isAdmin && <><button className="request-action" onClick={() => setActiveView('Usuarios')}>Administrar meseros <span>→</span></button><button className="request-action refresh-requests" onClick={refreshBarRequests}>↻ Refrescar solicitudes</button></>}</div></div>{!isAdmin && <form className="panel waiter-request-form" onSubmit={createWaiterRequest}><div className="form-fields"><label>Mesa o zona<input value={newRequest.table} onChange={(event) => setNewRequest({ ...newRequest, table: event.target.value })} placeholder="Ej. Mesa 12" /></label><label>Buscar bebida<input value={waiterProductSearch} onChange={(event) => setWaiterProductSearch(event.target.value)} placeholder="Filtra por nombre o categoría" /></label></div><div className="waiter-products">{availableWaiterProducts.map((product) => <button type="button" className="waiter-product" onClick={() => addToWaiterCart(product)} key={product.id}><span className="product-thumb">{product.category === 'Cervezas' ? '▥' : product.category === 'Cocteleria' ? '◒' : '◉'}</span><span><strong>{product.name}</strong><small>{product.stock} disponibles · {product.category}</small></span><b>+ {waiterCart[product.id] ?? 0}</b></button>)}{availableWaiterProducts.length === 0 && <span className="empty-products">No hay productos disponibles para ese filtro.</span>}</div><div className="waiter-cart">{Object.keys(waiterCart).length > 0 ? Object.entries(waiterCart).map(([productId, quantity]) => { const product = products.find((item) => item.id === Number(productId)); return product ? <div className="cart-line" key={product.id}><span>{quantity}x {product.name}</span><button type="button" onClick={() => removeFromWaiterCart(product)}>−</button></div> : null }) : <span>Selecciona productos para armar tu solicitud.</span>}</div><button className="primary-button" type="submit">Enviar solicitud al bar <span>→</span></button></form>}<div className="request-board">{requests.filter((request) => isAdmin || request.requesterId === session.user?.id || request.server === session.user?.name).map((request) => <div className={`board-request ${request.status === 'Despachado' ? 'done' : ''}`} key={request.id}><div className="board-top"><span className="request-avatar">{request.server.slice(0, 1)}</span><div><strong>{request.server}</strong><small>{request.table} · {request.time}</small></div><span className={request.status === 'Pendiente' ? 'status warning' : 'status good'}><span />{request.status}</span></div><p>{request.items}</p>{isAdmin && request.status === 'Pendiente' ? <button className="primary-button" onClick={() => dispatchRequest(request.id)}>Despachar pedido</button> : request.status === 'Despachado' ? <span className="done-label">✓ Pedido entregado</span> : <span className="done-label">Esperando despacho del bar</span>}</div>)}</div></section>}
      {activeView === 'Cierre de turno' && <section className="view-section close-view"><div className="close-hero"><div><span className="section-kicker">CIERRE DE OPERACIÓN</span><h2>Todo listo para cerrar</h2><p>Revisa el resumen del turno y genera un comprobante PDF para guardar o compartir.</p></div><div className="close-icon">◷</div></div><div className="close-grid"><div className="close-summary"><span>Ventas registradas</span><strong>{sales.length}</strong><small>movimientos de este turno</small></div><div className="close-summary"><span>Total vendido</span><strong>{money(totalSales)}</strong><small>ingresos brutos</small></div><div className="close-summary"><span>Unidades despachadas</span><strong>{sales.reduce((total, sale) => total + sale.quantity, 0)}</strong><small>productos vendidos</small></div></div><div className="pdf-box"><div><span className="pdf-icon">PDF</span><div><strong>Reporte de inventario y ventas</strong><small>Incluye existencias actuales, productos vendidos y solicitudes despachadas.</small></div></div><button className="primary-button" onClick={() => window.print()}>Cerrar y generar PDF <span>↗</span></button></div></section>}
      {toast && <div className="toast">✓ {toast}</div>}
    </main>
  </div>
}

export default App
