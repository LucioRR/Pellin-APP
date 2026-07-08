# Contexto para retomar — Pellin APP

**Última actualización: 08-jul-2026** (sesión de debugging integral + hardening de seguridad)

## Qué es

Sistema de gestión para negocio de producción de alimentos (Don Raviolino + Pellin,
multi-negocio). React 18 + Vite SPA, Supabase (Postgres + Auth Google OAuth + RLS),
deploy automático en Vercel (pellin-app.vercel.app) al pushear a `main`.

- Repo: https://github.com/LucioRR/Pellin-APP
- Proyecto Supabase: `eyayblajtjscratpzopg`
- `schema_actual.sql` = referencia del esquema real (mantener sincronizado tras cada migración)
- Usuario: Lucio (luciorrivarola@gmail.com), no programador — explicar decisiones en castellano simple

## Reglas de trabajo acordadas

1. **Leer el código real antes de proponer cambios** — nunca asumir por documentos viejos.
2. Los commits llevan `Co-Authored-By: Claude ...` (Lucio lo aceptó; sin implicancia de propiedad).
3. Deploy = commit + push a `main` (Vercel hace el resto). Las migraciones DB se aplican
   directo vía MCP de Supabase y se reflejan en `schema_actual.sql`.
4. Nombres ingresados a mano (ingrediente, marca, receta, producto, cliente, proveedor)
   se guardan en MAYÚSCULA vía `upper()` de `src/lib/supabase.js` + prop `upper` en `Inp`.

## Modelo de datos (conceptos clave)

- **Materias primas**: stock + `precio_costo` (= último precio pagado, "unidad" es informativa,
  sin conversión). Campos `marca` y `proveedor_habitual_id`. Ajustes manuales de stock van a
  `ajustes_stock` con motivo obligatorio (el consumo por producción NO pasa por ahí).
- **Recetas** (cómo se fabrica: rendimiento + ingredientes) y **Productos terminados**
  (qué se stockea/vende) están SEPARADOS a propósito (caso relleno de ravioles).
  El alta combinada 1:1 existe como checkbox al crear receta.
- **Compras**: al registrar factura el stock sube siempre; el costo/marca/proveedor de la
  ficha se actualizan solo si el checkbox "actualiza costo" del ítem está tildado
  (si no, va al historial como `compra_no_aplicada`). Cargar cantidades en la unidad
  base (kg) — campo "Precio total" por ítem para cotejar contra la factura del proveedor.
- **Costeo**: lote se costea al producir (congela costo). Costo por kg de receta =
  Σ(cantidad × precio_costo MP) / rendimiento — se muestra en Recetas, modal de lote,
  Productos y Estadísticas (valorización de stock MP+PT).
- **Pedidos**: recibido → confirmado → en_preparacion → despachado. Despachar genera
  remito + salidas FIFO por lote + descuenta stock PT.
- **Permisos**: rol admin/operario + array `usuarios.modulos[]`. Clave especial
  `'ver_costos'` en ese array = permiso "Mostrar costos" (checkbox en Configuración);
  admins siempre ven costos (`puedeVerCostos` en AuthContext/useNegocio).

## Decisiones de producto explícitas (NO "corregir" sin preguntar)

- **Despacho con stock insuficiente**: se mantiene el `window.confirm` y el remito sale
  por la cantidad PEDIDA (Lucio eligió "dejar como está" el 08-jul-2026).
- **Ajustes de stock pueden dejar negativo**: permitido a propósito (señal de deuda de stock).
- Caja/Compras/Proveedores se restringen por módulo, no por `ver_costos`.

## Hardening de seguridad aplicado (08-jul-2026)

- Trigger `trg_proteger_campos_usuario`: un no-admin NO puede cambiar rol/modulos/
  negocio_ids/activo/email (cerraba escalación de privilegios vía API REST).
- Vistas `v_facturas_estado` y `v_deuda_proveedores` con `security_invoker = true`.
- Funciones con `SET search_path = 'public'`; REVOKE EXECUTE de `anon` en las
  SECURITY DEFINER; `handle_new_user` tampoco ejecutable por `authenticated`.
- UPDATE solo admin (RLS) en: caja, facturas, pagos, lotes, remitos, salidas_produccion
  (los operarios solo insertan; anular siempre fue de admin en la UI).
- Constraint de turno ampliado a 'mañana'|'tarde'|'noche' (la UI ya ofrecía noche → antes rompía).
- ~28 índices para FKs consultadas.
- Nota: funciones `tiene_modulo`/`tiene_alguno` existen en la DB pero NO se usan en
  policies todavía (quedaron de `migracion_permisos_modulos.sql`, aplicado parcialmente).

## Bugs corregidos en la última sesión

- `Pedidos.abrirDetalle`: filtraba `ordenes_produccion` por columna `anulada` inexistente
  → nunca detectaba la O.P. asociada. Ahora `.neq('estado','cancelada')`.
- `completarOrden`: producto sin receta se salteaba en silencio (orden "completada" sin
  producir). Ahora lanza error claro.
- `anularLote`: bloquea si el lote tiene salidas activas (evita stock PT negativo).
- `createOrden`: fallback de turno era `'manana'` (sin ñ) → violaba el constraint.
- Caja: monto debe ser > 0.
- `v_deuda_proveedores` ahora expone cuit/telefono/email (el CUIT no se veía en Proveedores).

## Pendientes conocidos

- **Ravioles ensamblados**: producir un producto combinando LOTES de otros productos
  (relleno + masa). Hoy las recetas solo consumen materias primas. Cambio grande, anotado.
- Presentación de compra (bulto ↔ kg) con conversión automática en Compras — Lucio prefirió
  por ahora el campo "Precio total" para cotejo visual; retomar si vuelve a pedirlo.
- Rename "operario" → "usuario" en la UI (cosmético, no urgente).
- Rediseño UX/UI responsive (pendiente histórico).
- Leaked password protection de Supabase Auth: deshabilitado; no aplica (solo Google OAuth),
  se activa desde el dashboard si algún día se habilita email/password.
- Las policies de `pedidos`/`pedido_items`/`ordenes_produccion` tienen duplicados
  permisivos (genéricas + específicas) — funciona, pero se puede limpiar.
- `handle_new_user` sigue creando cualquier cuenta Google como operario sin módulos…
  el flujo real de acceso es por `invitaciones` + `reclamar_invitacion` (usuarios sin
  invitación quedan con acceso denegado en el AuthContext). Revisar si conviene
  deshabilitar el trigger legacy.

## Documentos

- Manual de usuario: `manual_pellin_app.docx` (todos los módulos salvo Configuración).
- Memoria de Claude Code: índice en `MEMORY.md` del directorio de memoria del proyecto.
