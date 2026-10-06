/**
 * Shared privacy and copyright notice displayed before and after sign-in.
 * Keep the content in one place so both entry points present the same disclosure.
 */
export function PrivacyNotice({ isLogin = false }: { isLogin?: boolean }) {
  return (
    <div className={isLogin ? 'privacy-tag privacy-tag-login' : 'privacy-tag'}>
      <div className="privacy-tag-header">
        <span className="section-kicker">ETIQUETA DE PRIVACIDAD</span>
        <strong>Datos que usamos o recolectamos</strong>
      </div>
      <ul>
        <li>Datos de cuenta: nombre completo, correo, nombre de usuario, contraseña, rol y permisos del usuario.</li>
        <li>Datos del negocio: nombre del establecimiento, ciudad, país, identificación fiscal, zona de trabajo y nombre del turno.</li>
        <li>Datos operativos: inventario, precios, stock, productos, mesas, pedidos, ventas, horarios y registros de despacho. Se guardan en Supabase asociados al establecimiento.</li>
        <li>Datos de acceso y seguridad: sesión activa, autenticación de usuarios, configuración MFA y auditoría de acciones relevantes.</li>
        <li>Datos del navegador: sesión autenticada y preferencias temporales de interfaz; los registros operativos persistentes se guardan en Supabase.</li>
        <li>Contenido multimedia: esta versión no permite subir ni publicar imágenes, videos, audio u otros archivos.</li>
      </ul>
      <div className="copyright-note">
        <strong>Derechos de autor y retiro de contenido:</strong> La versión actual no admite publicaciones multimedia ni tiene un canal de reportes activo. Si esas funciones se habilitan, se exigirán los derechos correspondientes y se aplicará un proceso de revisión, retiro cuando proceda y respuesta del usuario.{' '}
        <a href="https://github.com/GermanRhenals/pos-systems/blob/master/POLITICA-DERECHOS-AUTOR.md" target="_blank" rel="noreferrer">
          Lee la política completa
        </a>.
      </div>
    </div>
  )
}
