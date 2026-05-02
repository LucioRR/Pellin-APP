// Stubs temporales — se reemplazan en Etapa 2

import { Ic } from '../components/UI'

const Stub = ({ nombre, icon }) => (
  <div style={{
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', height: '60vh', gap: 16, color: '#6C6659',
  }}>
    <Ic n={icon} s={48} c="#D8D2C7" />
    <div>
      <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 22, color: '#1A1A18', textAlign: 'center', marginBottom: 6 }}>
        {nombre}
      </h2>
      <p style={{ fontSize: 14, textAlign: 'center' }}>Este módulo se completa en la Etapa 2</p>
    </div>
  </div>
)

export const Dashboard    = () => <Stub nombre="Panel General"       icon="dash" />
export const MateriasPrimas= () => <Stub nombre="Materias Primas"   icon="box" />
export const Proveedores  = () => <Stub nombre="Proveedores"         icon="users" />
export const Compras      = () => <Stub nombre="Compras"             icon="cart" />
export const Produccion   = () => <Stub nombre="Producción"          icon="flask" />
export const Productos    = () => <Stub nombre="Productos Terminados" icon="pkg" />
export const Caja         = () => <Stub nombre="Caja"                icon="wallet" />
export const Estadisticas = () => <Stub nombre="Estadísticas"        icon="chart" />
export const Configuracion= () => <Stub nombre="Configuración"       icon="cog" />
