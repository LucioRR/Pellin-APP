-- ============================================================
-- SCHEMA COMPLETO - Sistema de Gestión Multi-Negocio
-- Ejecutar en: Supabase → SQL Editor → New Query
-- ============================================================

-- ── Extensiones ──────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── Negocios ─────────────────────────────────────────────────
create table negocios (
  id          uuid primary key default uuid_generate_v4(),
  nombre      text not null,
  tipo        text not null default 'generico',
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);

insert into negocios (nombre, tipo) values
  ('Heladería', 'heladeria'),
  ('Fábrica de Pastas', 'pastas');

-- ── Usuarios ─────────────────────────────────────────────────
create table usuarios (
  id              uuid primary key references auth.users(id) on delete cascade,
  nombre          text not null,
  email           text not null unique,
  avatar_url      text,
  rol             text not null default 'operario', -- 'admin' | 'operario'
  negocio_ids     uuid[] not null default '{}',
  modulos         text[] not null default '{}',
  activo          boolean not null default true,
  creado_en       timestamptz not null default now(),
  ultimo_acceso   timestamptz
);

-- ── Categorías de caja ────────────────────────────────────────
create table categorias_caja (
  id          uuid primary key default uuid_generate_v4(),
  negocio_id  uuid not null references negocios(id) on delete cascade,
  tipo        text not null check (tipo in ('ingreso','egreso')),
  nombre      text not null,
  activa      boolean not null default true
);

-- Categorías por defecto para cada negocio (se insertan vía función)
create or replace function init_categorias(p_negocio_id uuid)
returns void language plpgsql as $$
begin
  insert into categorias_caja (negocio_id, tipo, nombre) values
    (p_negocio_id, 'ingreso', 'Ventas'),
    (p_negocio_id, 'ingreso', 'Otros ingresos'),
    (p_negocio_id, 'egreso',  'Pago a Proveedor'),
    (p_negocio_id, 'egreso',  'Gastos Generales'),
    (p_negocio_id, 'egreso',  'Servicios'),
    (p_negocio_id, 'egreso',  'Sueldos'),
    (p_negocio_id, 'egreso',  'Mantenimiento'),
    (p_negocio_id, 'egreso',  'Otros gastos');
end;
$$;

-- Inicializar categorías para los negocios semilla
do $$
declare r record;
begin
  for r in select id from negocios loop
    perform init_categorias(r.id);
  end loop;
end;
$$;

-- ── Materias Primas ───────────────────────────────────────────
create table materias_primas (
  id                      uuid primary key default uuid_generate_v4(),
  negocio_id              uuid not null references negocios(id) on delete cascade,
  nombre                  text not null,
  unidad                  text not null,
  stock_actual            numeric not null default 0,
  stock_minimo            numeric not null default 0,
  precio_costo            numeric not null default 0,
  precio_actualizado_en   timestamptz,
  precio_actualizado_por  uuid references usuarios(id),
  activo                  boolean not null default true,
  creado_en               timestamptz not null default now()
);

-- ── Historial de precios ──────────────────────────────────────
create table historial_precios (
  id          uuid primary key default uuid_generate_v4(),
  mp_id       uuid not null references materias_primas(id) on delete cascade,
  precio_ant  numeric not null,
  precio_nvo  numeric not null,
  motivo      text not null default 'manual', -- 'manual' | 'factura'
  referencia  text, -- número de factura si aplica
  creado_por  uuid references usuarios(id),
  creado_en   timestamptz not null default now()
);

-- ── Proveedores ───────────────────────────────────────────────
create table proveedores (
  id          uuid primary key default uuid_generate_v4(),
  negocio_id  uuid not null references negocios(id) on delete cascade,
  nombre      text not null,
  cuit        text,
  telefono    text,
  email       text,
  notas       text,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);

-- ── Facturas ──────────────────────────────────────────────────
create table facturas (
  id                uuid primary key default uuid_generate_v4(),
  negocio_id        uuid not null references negocios(id) on delete cascade,
  numero            text not null,
  proveedor_id      uuid not null references proveedores(id),
  fecha             date not null,
  fecha_vencimiento date,
  total             numeric not null default 0,
  -- Trazabilidad
  creado_por        uuid references usuarios(id),
  creado_en         timestamptz not null default now(),
  anulada           boolean not null default false,
  anulada_por       uuid references usuarios(id),
  anulada_en        timestamptz,
  motivo_anulacion  text
);

create table factura_items (
  id              uuid primary key default uuid_generate_v4(),
  factura_id      uuid not null references facturas(id) on delete cascade,
  mp_id           uuid not null references materias_primas(id),
  mp_nombre       text not null,
  cantidad        numeric not null,
  unidad          text not null,
  precio_unitario numeric not null,
  subtotal        numeric not null
);

-- ── Pagos a proveedores ───────────────────────────────────────
create table pagos (
  id                uuid primary key default uuid_generate_v4(),
  negocio_id        uuid not null references negocios(id) on delete cascade,
  factura_id        uuid not null references facturas(id),
  proveedor_id      uuid not null references proveedores(id),
  monto             numeric not null,
  fecha             date not null,
  nota              text,
  -- Trazabilidad
  creado_por        uuid references usuarios(id),
  creado_en         timestamptz not null default now(),
  anulado           boolean not null default false,
  anulado_por       uuid references usuarios(id),
  anulado_en        timestamptz,
  motivo_anulacion  text
);

-- ── Recetas ───────────────────────────────────────────────────
create table recetas (
  id                  uuid primary key default uuid_generate_v4(),
  negocio_id          uuid not null references negocios(id) on delete cascade,
  nombre              text not null,
  rendimiento         numeric not null,
  unidad_rendimiento  text not null default 'kg',
  costo_total         numeric not null default 0,
  activo              boolean not null default true,
  creado_en           timestamptz not null default now()
);

create table receta_ingredientes (
  id          uuid primary key default uuid_generate_v4(),
  receta_id   uuid not null references recetas(id) on delete cascade,
  mp_id       uuid not null references materias_primas(id),
  mp_nombre   text not null,
  cantidad    numeric not null,
  unidad      text not null
);

-- ── Productos Terminados ──────────────────────────────────────
create table productos_terminados (
  id            uuid primary key default uuid_generate_v4(),
  negocio_id    uuid not null references negocios(id) on delete cascade,
  nombre        text not null,
  unidad        text not null default 'kg',
  stock_actual  numeric not null default 0,
  stock_minimo  numeric not null default 0,
  receta_id     uuid references recetas(id),
  activo        boolean not null default true,
  creado_en     timestamptz not null default now()
);

-- ── Lotes de producción ───────────────────────────────────────
create table lotes (
  id                  uuid primary key default uuid_generate_v4(),
  negocio_id          uuid not null references negocios(id) on delete cascade,
  receta_id           uuid not null references recetas(id),
  receta_nombre       text not null,
  producto_id         uuid references productos_terminados(id),
  fecha               date not null,
  cant_batches        integer not null default 1,
  total_producido     numeric not null,
  unidad              text not null,
  costo_total         numeric not null default 0,
  notas               text,
  -- Trazabilidad
  creado_por          uuid references usuarios(id),
  creado_en           timestamptz not null default now(),
  anulado             boolean not null default false,
  anulado_por         uuid references usuarios(id),
  anulado_en          timestamptz,
  motivo_anulacion    text
);

-- ── Salidas de producción ─────────────────────────────────────
create table salidas_produccion (
  id                uuid primary key default uuid_generate_v4(),
  negocio_id        uuid not null references negocios(id) on delete cascade,
  producto_id       uuid not null references productos_terminados(id),
  producto_nombre   text not null,
  fecha             date not null,
  cantidad          numeric not null,
  unidad            text not null,
  notas             text,
  -- Trazabilidad
  creado_por        uuid references usuarios(id),
  creado_en         timestamptz not null default now(),
  anulada           boolean not null default false,
  anulada_por       uuid references usuarios(id),
  anulada_en        timestamptz,
  motivo_anulacion  text
);

-- ── Caja ─────────────────────────────────────────────────────
create table caja (
  id                uuid primary key default uuid_generate_v4(),
  negocio_id        uuid not null references negocios(id) on delete cascade,
  fecha             date not null,
  tipo              text not null check (tipo in ('ingreso','egreso')),
  categoria_id      uuid references categorias_caja(id),
  categoria_nombre  text not null,
  descripcion       text not null,
  monto             numeric not null,
  auto              boolean not null default false,
  referencia_id     uuid,
  referencia_tipo   text,
  -- Trazabilidad
  creado_por        uuid references usuarios(id),
  creado_en         timestamptz not null default now(),
  anulado           boolean not null default false,
  anulado_por       uuid references usuarios(id),
  anulado_en        timestamptz,
  motivo_anulacion  text
);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

alter table negocios           enable row level security;
alter table usuarios           enable row level security;
alter table categorias_caja    enable row level security;
alter table materias_primas    enable row level security;
alter table historial_precios  enable row level security;
alter table proveedores        enable row level security;
alter table facturas           enable row level security;
alter table factura_items      enable row level security;
alter table pagos              enable row level security;
alter table recetas            enable row level security;
alter table receta_ingredientes enable row level security;
alter table productos_terminados enable row level security;
alter table lotes              enable row level security;
alter table salidas_produccion enable row level security;
alter table caja               enable row level security;

-- Función auxiliar: obtener negocio_ids del usuario actual
create or replace function mis_negocios()
returns uuid[] language sql stable security definer as $$
  select negocio_ids from usuarios where id = auth.uid()
$$;

-- Función auxiliar: es admin?
create or replace function es_admin()
returns boolean language sql stable security definer as $$
  select rol = 'admin' from usuarios where id = auth.uid()
$$;

-- POLÍTICAS: negocios
create policy "Ver negocios propios" on negocios
  for select using (id = any(mis_negocios()));
create policy "Admin modifica negocios" on negocios
  for all using (es_admin());

-- POLÍTICAS: usuarios
create policy "Ver propio usuario" on usuarios
  for select using (id = auth.uid() or es_admin());
create policy "Admin gestiona usuarios" on usuarios
  for all using (es_admin());
create policy "Usuario actualiza propio" on usuarios
  for update using (id = auth.uid());

-- Macro para crear políticas por negocio en tablas operativas
create or replace function make_negocio_policies(p_table text)
returns void language plpgsql as $$
begin
  execute format(
    'create policy "Select %1$s" on %1$s for select using (negocio_id = any(mis_negocios()));
     create policy "Insert %1$s" on %1$s for insert with check (negocio_id = any(mis_negocios()));
     create policy "Update %1$s" on %1$s for update using (negocio_id = any(mis_negocios()));',
    p_table
  );
end;
$$;

select make_negocio_policies('categorias_caja');
select make_negocio_policies('materias_primas');
select make_negocio_policies('proveedores');
select make_negocio_policies('facturas');
select make_negocio_policies('pagos');
select make_negocio_policies('recetas');
select make_negocio_policies('productos_terminados');
select make_negocio_policies('lotes');
select make_negocio_policies('salidas_produccion');
select make_negocio_policies('caja');

-- historial_precios: acceso por mp_id
create policy "Select historial" on historial_precios
  for select using (
    mp_id in (select id from materias_primas where negocio_id = any(mis_negocios()))
  );
create policy "Insert historial" on historial_precios
  for insert with check (
    mp_id in (select id from materias_primas where negocio_id = any(mis_negocios()))
  );

-- factura_items y receta_ingredientes: acceso por padre
create policy "Select factura_items" on factura_items
  for select using (
    factura_id in (select id from facturas where negocio_id = any(mis_negocios()))
  );
create policy "Insert factura_items" on factura_items
  for insert with check (
    factura_id in (select id from facturas where negocio_id = any(mis_negocios()))
  );
create policy "Select receta_ingredientes" on receta_ingredientes
  for select using (
    receta_id in (select id from recetas where negocio_id = any(mis_negocios()))
  );
create policy "Insert receta_ingredientes" on receta_ingredientes
  for insert with check (
    receta_id in (select id from recetas where negocio_id = any(mis_negocios()))
  );
create policy "Delete receta_ingredientes" on receta_ingredientes
  for delete using (
    receta_id in (select id from recetas where negocio_id = any(mis_negocios()))
  );

-- ============================================================
-- TRIGGER: auto-crear usuario en tabla pública al registrarse
-- ============================================================
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.usuarios (id, nombre, email, avatar_url, rol, negocio_ids, modulos)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data->>'avatar_url',
    -- El primer usuario que se registra es admin automáticamente
    case when (select count(*) from public.usuarios) = 0 then 'admin' else 'operario' end,
    -- El primer admin tiene acceso a todos los negocios
    case when (select count(*) from public.usuarios) = 0
      then (select array_agg(id) from public.negocios)
      else '{}'
    end,
    -- Módulos por defecto según rol
    case when (select count(*) from public.usuarios) = 0
      then array['dashboard','materias','proveedores','compras','produccion','productos','caja','estadisticas','configuracion']
      else array['dashboard','materias','produccion']
    end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- VISTA: estado de facturas con saldos
-- ============================================================
create or replace view v_facturas_estado as
select
  f.id,
  f.negocio_id,
  f.numero,
  f.proveedor_id,
  p.nombre as proveedor_nombre,
  f.fecha,
  f.fecha_vencimiento,
  f.total,
  f.anulada,
  coalesce(sum(pg.monto) filter (where pg.anulado = false), 0) as total_pagado,
  f.total - coalesce(sum(pg.monto) filter (where pg.anulado = false), 0) as saldo,
  case
    when f.anulada then 'anulada'
    when f.total - coalesce(sum(pg.monto) filter (where pg.anulado = false), 0) <= 0 then 'pagada'
    when f.fecha_vencimiento < current_date
      and f.total - coalesce(sum(pg.monto) filter (where pg.anulado = false), 0) > 0 then 'vencida'
    when coalesce(sum(pg.monto) filter (where pg.anulado = false), 0) > 0 then 'parcial'
    else 'pendiente'
  end as estado
from facturas f
join proveedores p on p.id = f.proveedor_id
left join pagos pg on pg.factura_id = f.id
group by f.id, p.nombre;

-- ============================================================
-- VISTA: deuda por proveedor
-- ============================================================
create or replace view v_deuda_proveedores as
select
  pr.id as proveedor_id,
  pr.negocio_id,
  pr.nombre,
  coalesce(sum(vf.saldo) filter (where not vf.anulada), 0) as deuda_total,
  coalesce(sum(vf.saldo) filter (where not vf.anulada and vf.estado = 'vencida'), 0) as deuda_vencida
from proveedores pr
left join v_facturas_estado vf on vf.proveedor_id = pr.id
group by pr.id, pr.negocio_id, pr.nombre;

-- Dar acceso a las vistas
grant select on v_facturas_estado to authenticated;
grant select on v_deuda_proveedores to authenticated;
