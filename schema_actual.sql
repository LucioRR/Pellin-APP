


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."descontar_stock_mp"("p_mp_id" "uuid", "p_cantidad" numeric) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  UPDATE materias_primas
  SET stock_actual = stock_actual - p_cantidad
  WHERE id = p_mp_id;
END;
$$;


ALTER FUNCTION "public"."descontar_stock_mp"("p_mp_id" "uuid", "p_cantidad" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."es_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  select rol = 'admin' from usuarios where id = auth.uid()
$$;


ALTER FUNCTION "public"."es_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."init_categorias"("p_negocio_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
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


ALTER FUNCTION "public"."init_categorias"("p_negocio_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."make_negocio_policies"("p_table" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $_$
begin
  execute format(
    'create policy "Select %1$s" on %1$s for select using (negocio_id = any(mis_negocios()));
     create policy "Insert %1$s" on %1$s for insert with check (negocio_id = any(mis_negocios()));
     create policy "Update %1$s" on %1$s for update using (negocio_id = any(mis_negocios()));',
    p_table
  );
end;
$_$;


ALTER FUNCTION "public"."make_negocio_policies"("p_table" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mis_negocios"() RETURNS "uuid"[]
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  select negocio_ids from usuarios where id = auth.uid()
$$;


ALTER FUNCTION "public"."mis_negocios"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."ajustes_stock" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "negocio_id" "uuid" NOT NULL,
    "mp_id" "uuid" NOT NULL,
    "mp_nombre" "text" NOT NULL,
    "cantidad" numeric NOT NULL,
    "stock_ant" numeric NOT NULL,
    "stock_nuevo" numeric NOT NULL,
    "motivo" "text" NOT NULL,
    "creado_por" "uuid",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ajustes_stock" OWNER TO "postgres";


COMMENT ON TABLE "public"."ajustes_stock" IS 'Ajustes manuales de stock de materias primas (no incluye consumo por producción)';


CREATE TABLE IF NOT EXISTS "public"."caja" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "negocio_id" "uuid" NOT NULL,
    "fecha" "date" NOT NULL,
    "tipo" "text" NOT NULL,
    "categoria_id" "uuid",
    "categoria_nombre" "text" NOT NULL,
    "descripcion" "text" NOT NULL,
    "monto" numeric NOT NULL,
    "auto" boolean DEFAULT false NOT NULL,
    "referencia_id" "uuid",
    "referencia_tipo" "text",
    "creado_por" "uuid",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "anulado" boolean DEFAULT false NOT NULL,
    "anulado_por" "uuid",
    "anulado_en" timestamp with time zone,
    "motivo_anulacion" "text",
    CONSTRAINT "caja_tipo_check" CHECK (("tipo" = ANY (ARRAY['ingreso'::"text", 'egreso'::"text"])))
);


ALTER TABLE "public"."caja" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."categorias_caja" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "negocio_id" "uuid" NOT NULL,
    "tipo" "text" NOT NULL,
    "nombre" "text" NOT NULL,
    "activa" boolean DEFAULT true NOT NULL,
    CONSTRAINT "categorias_caja_tipo_check" CHECK (("tipo" = ANY (ARRAY['ingreso'::"text", 'egreso'::"text"])))
);


ALTER TABLE "public"."categorias_caja" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."factura_items" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "factura_id" "uuid" NOT NULL,
    "mp_id" "uuid" NOT NULL,
    "mp_nombre" "text" NOT NULL,
    "cantidad" numeric NOT NULL,
    "unidad" "text" NOT NULL,
    "precio_unitario" numeric NOT NULL,
    "subtotal" numeric NOT NULL,
    "marca" "text"
);


ALTER TABLE "public"."factura_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."facturas" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "negocio_id" "uuid" NOT NULL,
    "numero" "text" NOT NULL,
    "proveedor_id" "uuid" NOT NULL,
    "fecha" "date" NOT NULL,
    "fecha_vencimiento" "date",
    "total" numeric DEFAULT 0 NOT NULL,
    "creado_por" "uuid",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "anulada" boolean DEFAULT false NOT NULL,
    "anulada_por" "uuid",
    "anulada_en" timestamp with time zone,
    "motivo_anulacion" "text",
    "iva_monto" numeric DEFAULT 0 NOT NULL,
    "otros_cargos" numeric DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."facturas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."historial_precios" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "mp_id" "uuid" NOT NULL,
    "precio_ant" numeric NOT NULL,
    "precio_nvo" numeric NOT NULL,
    "motivo" "text" DEFAULT 'manual'::"text" NOT NULL,
    "referencia" "text",
    "creado_por" "uuid",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "proveedor_id" "uuid"
);


ALTER TABLE "public"."historial_precios" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invitaciones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "nombre" "text",
    "rol" "text" DEFAULT 'operario'::"text" NOT NULL,
    "modulos" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "negocio_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "creado_por" "uuid",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."invitaciones" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lotes" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "negocio_id" "uuid" NOT NULL,
    "receta_id" "uuid" NOT NULL,
    "receta_nombre" "text" NOT NULL,
    "producto_id" "uuid",
    "fecha" "date" NOT NULL,
    "cant_batches" integer DEFAULT 1 NOT NULL,
    "total_producido" numeric NOT NULL,
    "unidad" "text" NOT NULL,
    "costo_total" numeric DEFAULT 0 NOT NULL,
    "notas" "text",
    "creado_por" "uuid",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "anulado" boolean DEFAULT false NOT NULL,
    "anulado_por" "uuid",
    "anulado_en" timestamp with time zone,
    "motivo_anulacion" "text",
    "fecha_vencimiento" "date",
    "orden_id" "uuid"
);


ALTER TABLE "public"."lotes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."materias_primas" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "negocio_id" "uuid" NOT NULL,
    "nombre" "text" NOT NULL,
    "unidad" "text" NOT NULL,
    "stock_actual" numeric DEFAULT 0 NOT NULL,
    "stock_minimo" numeric DEFAULT 0 NOT NULL,
    "precio_costo" numeric DEFAULT 0 NOT NULL,
    "precio_actualizado_en" timestamp with time zone,
    "precio_actualizado_por" "uuid",
    "activo" boolean DEFAULT true NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "marca" "text",
    "proveedor_habitual_id" "uuid"
);


ALTER TABLE "public"."materias_primas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."negocio_ordenes" (
    "negocio_id" "uuid" NOT NULL,
    "ultimo_numero_orden" integer DEFAULT 0
);


ALTER TABLE "public"."negocio_ordenes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."negocios" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "nombre" "text" NOT NULL,
    "tipo" "text" DEFAULT 'generico'::"text" NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."negocios" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ordenes_produccion" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "negocio_id" "uuid" NOT NULL,
    "fecha_planificada" "date" NOT NULL,
    "turno" "text" DEFAULT 'mañana'::"text" NOT NULL,
    "estado" "text" DEFAULT 'planificada'::"text" NOT NULL,
    "notas" "text",
    "pedido_id" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "numero_orden" integer,
    "prioridad" "text" DEFAULT 'normal'::"text",
    CONSTRAINT "ordenes_produccion_estado_check" CHECK (("estado" = ANY (ARRAY['planificada'::"text", 'en_proceso'::"text", 'completada'::"text", 'cancelada'::"text"]))),
    CONSTRAINT "ordenes_produccion_turno_check" CHECK (("turno" = ANY (ARRAY['mañana'::"text", 'tarde'::"text"])))
);


ALTER TABLE "public"."ordenes_produccion" OWNER TO "postgres";


COMMENT ON TABLE "public"."ordenes_produccion" IS 'Órdenes de producción planificadas, opcionalmente originadas en un pedido';



COMMENT ON COLUMN "public"."ordenes_produccion"."turno" IS 'mañana | tarde';



COMMENT ON COLUMN "public"."ordenes_produccion"."estado" IS 'planificada | en_proceso | completada | cancelada';



CREATE TABLE IF NOT EXISTS "public"."ordenes_produccion_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "orden_id" "uuid" NOT NULL,
    "producto_id" "uuid" NOT NULL,
    "cantidad_planificada" numeric NOT NULL,
    "cantidad_producida" numeric DEFAULT 0 NOT NULL,
    CONSTRAINT "ordenes_produccion_items_cantidad_planificada_check" CHECK (("cantidad_planificada" > (0)::numeric)),
    CONSTRAINT "ordenes_produccion_items_cantidad_producida_check" CHECK (("cantidad_producida" >= (0)::numeric))
);


ALTER TABLE "public"."ordenes_produccion_items" OWNER TO "postgres";


COMMENT ON TABLE "public"."ordenes_produccion_items" IS 'Líneas de producto de cada orden de producción';



CREATE TABLE IF NOT EXISTS "public"."pagos" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "negocio_id" "uuid" NOT NULL,
    "factura_id" "uuid" NOT NULL,
    "proveedor_id" "uuid" NOT NULL,
    "monto" numeric NOT NULL,
    "fecha" "date" NOT NULL,
    "nota" "text",
    "creado_por" "uuid",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "anulado" boolean DEFAULT false NOT NULL,
    "anulado_por" "uuid",
    "anulado_en" timestamp with time zone,
    "motivo_anulacion" "text"
);


ALTER TABLE "public"."pagos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pedido_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pedido_id" "uuid" NOT NULL,
    "producto_id" "uuid" NOT NULL,
    "cantidad_pedida" numeric NOT NULL,
    "cantidad_despachada" numeric DEFAULT 0 NOT NULL,
    CONSTRAINT "pedido_items_cantidad_despachada_check" CHECK (("cantidad_despachada" >= (0)::numeric)),
    CONSTRAINT "pedido_items_cantidad_pedida_check" CHECK (("cantidad_pedida" > (0)::numeric))
);


ALTER TABLE "public"."pedido_items" OWNER TO "postgres";


COMMENT ON TABLE "public"."pedido_items" IS 'Líneas de producto de cada pedido mayorista';



CREATE TABLE IF NOT EXISTS "public"."pedidos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "negocio_id" "uuid" NOT NULL,
    "cliente_nombre" "text" NOT NULL,
    "fecha_pedido" "date" DEFAULT CURRENT_DATE NOT NULL,
    "fecha_entrega" "date",
    "estado" "text" DEFAULT 'recibido'::"text" NOT NULL,
    "notas" "text",
    "remito_id" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "anulado" boolean DEFAULT false NOT NULL,
    CONSTRAINT "pedidos_estado_check" CHECK (("estado" = ANY (ARRAY['recibido'::"text", 'confirmado'::"text", 'en_preparacion'::"text", 'despachado'::"text", 'cancelado'::"text"])))
);


ALTER TABLE "public"."pedidos" OWNER TO "postgres";


COMMENT ON TABLE "public"."pedidos" IS 'Pedidos mayoristas recibidos por WhatsApp u otros canales';



COMMENT ON COLUMN "public"."pedidos"."estado" IS 'recibido | confirmado | en_preparacion | despachado | cancelado';



CREATE TABLE IF NOT EXISTS "public"."productos_terminados" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "negocio_id" "uuid" NOT NULL,
    "nombre" "text" NOT NULL,
    "unidad" "text" DEFAULT 'kg'::"text" NOT NULL,
    "stock_actual" numeric DEFAULT 0 NOT NULL,
    "stock_minimo" numeric DEFAULT 0 NOT NULL,
    "receta_id" "uuid",
    "activo" boolean DEFAULT true NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "vida_util_dias" integer
);


ALTER TABLE "public"."productos_terminados" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."proveedores" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "negocio_id" "uuid" NOT NULL,
    "nombre" "text" NOT NULL,
    "cuit" "text",
    "telefono" "text",
    "email" "text",
    "notas" "text",
    "activo" boolean DEFAULT true NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."proveedores" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."receta_ingredientes" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "receta_id" "uuid" NOT NULL,
    "mp_id" "uuid" NOT NULL,
    "mp_nombre" "text" NOT NULL,
    "cantidad" numeric NOT NULL,
    "unidad" "text" NOT NULL
);


ALTER TABLE "public"."receta_ingredientes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."recetas" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "negocio_id" "uuid" NOT NULL,
    "nombre" "text" NOT NULL,
    "rendimiento" numeric NOT NULL,
    "unidad_rendimiento" "text" DEFAULT 'kg'::"text" NOT NULL,
    "costo_total" numeric DEFAULT 0 NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."recetas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."remito_items" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "remito_id" "uuid" NOT NULL,
    "producto_id" "uuid" NOT NULL,
    "producto_nombre" "text" NOT NULL,
    "cantidad" numeric NOT NULL,
    "unidad" "text" NOT NULL
);


ALTER TABLE "public"."remito_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."remito_secuencia" (
    "negocio_id" "uuid" NOT NULL,
    "ultimo" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."remito_secuencia" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."remitos" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "negocio_id" "uuid" NOT NULL,
    "numero" "text" NOT NULL,
    "destino" "text",
    "fecha" "date" NOT NULL,
    "notas" "text",
    "total_items" integer DEFAULT 0 NOT NULL,
    "creado_por" "uuid",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "anulado" boolean DEFAULT false NOT NULL,
    "anulado_por" "uuid",
    "anulado_en" timestamp with time zone,
    "motivo_anulacion" "text"
);


ALTER TABLE "public"."remitos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."salidas_produccion" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "negocio_id" "uuid" NOT NULL,
    "producto_id" "uuid" NOT NULL,
    "producto_nombre" "text" NOT NULL,
    "fecha" "date" NOT NULL,
    "cantidad" numeric NOT NULL,
    "unidad" "text" NOT NULL,
    "notas" "text",
    "creado_por" "uuid",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "anulada" boolean DEFAULT false NOT NULL,
    "anulada_por" "uuid",
    "anulada_en" timestamp with time zone,
    "motivo_anulacion" "text",
    "remito_id" "uuid",
    "lote_id" "uuid"
);


ALTER TABLE "public"."salidas_produccion" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."usuarios" (
    "id" "uuid" NOT NULL,
    "nombre" "text" NOT NULL,
    "email" "text" NOT NULL,
    "avatar_url" "text",
    "rol" "text" DEFAULT 'operario'::"text" NOT NULL,
    "negocio_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "modulos" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ultimo_acceso" timestamp with time zone
);


ALTER TABLE "public"."usuarios" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_facturas_estado" AS
SELECT
    NULL::"uuid" AS "id",
    NULL::"uuid" AS "negocio_id",
    NULL::"text" AS "numero",
    NULL::"uuid" AS "proveedor_id",
    NULL::"text" AS "proveedor_nombre",
    NULL::"date" AS "fecha",
    NULL::"date" AS "fecha_vencimiento",
    NULL::numeric AS "total",
    NULL::numeric AS "iva_monto",
    NULL::numeric AS "otros_cargos",
    NULL::boolean AS "anulada",
    NULL::numeric AS "total_pagado",
    NULL::numeric AS "saldo",
    NULL::"text" AS "estado";


ALTER VIEW "public"."v_facturas_estado" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_deuda_proveedores" AS
 SELECT "pr"."id" AS "proveedor_id",
    "pr"."negocio_id",
    "pr"."nombre",
    COALESCE("sum"("vf"."saldo") FILTER (WHERE (NOT "vf"."anulada")), (0)::numeric) AS "deuda_total",
    COALESCE("sum"("vf"."saldo") FILTER (WHERE ((NOT "vf"."anulada") AND ("vf"."estado" = 'vencida'::"text"))), (0)::numeric) AS "deuda_vencida"
   FROM ("public"."proveedores" "pr"
     LEFT JOIN "public"."v_facturas_estado" "vf" ON (("vf"."proveedor_id" = "pr"."id")))
  GROUP BY "pr"."id", "pr"."negocio_id", "pr"."nombre";


ALTER VIEW "public"."v_deuda_proveedores" OWNER TO "postgres";


ALTER TABLE ONLY "public"."ajustes_stock"
    ADD CONSTRAINT "ajustes_stock_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invitaciones"
    ADD CONSTRAINT "invitaciones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invitaciones"
    ADD CONSTRAINT "invitaciones_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."caja"
    ADD CONSTRAINT "caja_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categorias_caja"
    ADD CONSTRAINT "categorias_caja_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."factura_items"
    ADD CONSTRAINT "factura_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."facturas"
    ADD CONSTRAINT "facturas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."historial_precios"
    ADD CONSTRAINT "historial_precios_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lotes"
    ADD CONSTRAINT "lotes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."materias_primas"
    ADD CONSTRAINT "materias_primas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."negocio_ordenes"
    ADD CONSTRAINT "negocio_ordenes_pkey" PRIMARY KEY ("negocio_id");



ALTER TABLE ONLY "public"."negocios"
    ADD CONSTRAINT "negocios_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ordenes_produccion_items"
    ADD CONSTRAINT "ordenes_produccion_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ordenes_produccion"
    ADD CONSTRAINT "ordenes_produccion_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pagos"
    ADD CONSTRAINT "pagos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pedido_items"
    ADD CONSTRAINT "pedido_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pedidos"
    ADD CONSTRAINT "pedidos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."productos_terminados"
    ADD CONSTRAINT "productos_terminados_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."proveedores"
    ADD CONSTRAINT "proveedores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."receta_ingredientes"
    ADD CONSTRAINT "receta_ingredientes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recetas"
    ADD CONSTRAINT "recetas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."remito_items"
    ADD CONSTRAINT "remito_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."remito_secuencia"
    ADD CONSTRAINT "remito_secuencia_pkey" PRIMARY KEY ("negocio_id");



ALTER TABLE ONLY "public"."remitos"
    ADD CONSTRAINT "remitos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."salidas_produccion"
    ADD CONSTRAINT "salidas_produccion_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."usuarios"
    ADD CONSTRAINT "usuarios_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."usuarios"
    ADD CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_ajustes_stock_mp" ON "public"."ajustes_stock" USING "btree" ("mp_id", "creado_en" DESC);



CREATE INDEX "idx_op_estado" ON "public"."ordenes_produccion" USING "btree" ("negocio_id", "estado");



CREATE INDEX "idx_op_fecha" ON "public"."ordenes_produccion" USING "btree" ("negocio_id", "fecha_planificada") WHERE ("estado" <> ALL (ARRAY['completada'::"text", 'cancelada'::"text"]));



CREATE INDEX "idx_op_items_orden" ON "public"."ordenes_produccion_items" USING "btree" ("orden_id");



CREATE INDEX "idx_op_items_producto" ON "public"."ordenes_produccion_items" USING "btree" ("producto_id");



CREATE INDEX "idx_op_negocio" ON "public"."ordenes_produccion" USING "btree" ("negocio_id");



CREATE INDEX "idx_op_pedido" ON "public"."ordenes_produccion" USING "btree" ("pedido_id") WHERE ("pedido_id" IS NOT NULL);



CREATE INDEX "idx_ordenes_numero" ON "public"."ordenes_produccion" USING "btree" ("negocio_id", "numero_orden");



CREATE INDEX "idx_pedido_items_pedido" ON "public"."pedido_items" USING "btree" ("pedido_id");



CREATE INDEX "idx_pedido_items_producto" ON "public"."pedido_items" USING "btree" ("producto_id");



CREATE INDEX "idx_pedidos_estado" ON "public"."pedidos" USING "btree" ("negocio_id", "estado") WHERE ("anulado" = false);



CREATE INDEX "idx_pedidos_fecha_entrega" ON "public"."pedidos" USING "btree" ("negocio_id", "fecha_entrega") WHERE (("anulado" = false) AND ("estado" <> ALL (ARRAY['despachado'::"text", 'cancelado'::"text"])));



CREATE INDEX "idx_pedidos_negocio" ON "public"."pedidos" USING "btree" ("negocio_id");



CREATE OR REPLACE VIEW "public"."v_facturas_estado" AS
 SELECT "f"."id",
    "f"."negocio_id",
    "f"."numero",
    "f"."proveedor_id",
    "p"."nombre" AS "proveedor_nombre",
    "f"."fecha",
    "f"."fecha_vencimiento",
    "f"."total",
    "f"."iva_monto",
    "f"."otros_cargos",
    "f"."anulada",
    COALESCE("sum"("pg"."monto") FILTER (WHERE ("pg"."anulado" = false)), (0)::numeric) AS "total_pagado",
    ("f"."total" - COALESCE("sum"("pg"."monto") FILTER (WHERE ("pg"."anulado" = false)), (0)::numeric)) AS "saldo",
        CASE
            WHEN "f"."anulada" THEN 'anulada'::"text"
            WHEN (("f"."total" - COALESCE("sum"("pg"."monto") FILTER (WHERE ("pg"."anulado" = false)), (0)::numeric)) <= (0)::numeric) THEN 'pagada'::"text"
            WHEN (("f"."fecha_vencimiento" < CURRENT_DATE) AND (("f"."total" - COALESCE("sum"("pg"."monto") FILTER (WHERE ("pg"."anulado" = false)), (0)::numeric)) > (0)::numeric)) THEN 'vencida'::"text"
            WHEN (COALESCE("sum"("pg"."monto") FILTER (WHERE ("pg"."anulado" = false)), (0)::numeric) > (0)::numeric) THEN 'parcial'::"text"
            ELSE 'pendiente'::"text"
        END AS "estado"
   FROM (("public"."facturas" "f"
     JOIN "public"."proveedores" "p" ON (("p"."id" = "f"."proveedor_id")))
     LEFT JOIN "public"."pagos" "pg" ON (("pg"."factura_id" = "f"."id")))
  GROUP BY "f"."id", "p"."nombre";



ALTER TABLE ONLY "public"."ajustes_stock"
    ADD CONSTRAINT "ajustes_stock_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ajustes_stock"
    ADD CONSTRAINT "ajustes_stock_mp_id_fkey" FOREIGN KEY ("mp_id") REFERENCES "public"."materias_primas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ajustes_stock"
    ADD CONSTRAINT "ajustes_stock_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."invitaciones"
    ADD CONSTRAINT "invitaciones_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."materias_primas"
    ADD CONSTRAINT "materias_primas_proveedor_habitual_id_fkey" FOREIGN KEY ("proveedor_habitual_id") REFERENCES "public"."proveedores"("id");



ALTER TABLE ONLY "public"."historial_precios"
    ADD CONSTRAINT "historial_precios_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedores"("id");



ALTER TABLE ONLY "public"."caja"
    ADD CONSTRAINT "caja_anulado_por_fkey" FOREIGN KEY ("anulado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."caja"
    ADD CONSTRAINT "caja_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "public"."categorias_caja"("id");



ALTER TABLE ONLY "public"."caja"
    ADD CONSTRAINT "caja_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."caja"
    ADD CONSTRAINT "caja_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."categorias_caja"
    ADD CONSTRAINT "categorias_caja_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."factura_items"
    ADD CONSTRAINT "factura_items_factura_id_fkey" FOREIGN KEY ("factura_id") REFERENCES "public"."facturas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."factura_items"
    ADD CONSTRAINT "factura_items_mp_id_fkey" FOREIGN KEY ("mp_id") REFERENCES "public"."materias_primas"("id");



ALTER TABLE ONLY "public"."facturas"
    ADD CONSTRAINT "facturas_anulada_por_fkey" FOREIGN KEY ("anulada_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."facturas"
    ADD CONSTRAINT "facturas_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."facturas"
    ADD CONSTRAINT "facturas_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."facturas"
    ADD CONSTRAINT "facturas_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedores"("id");



ALTER TABLE ONLY "public"."historial_precios"
    ADD CONSTRAINT "historial_precios_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."historial_precios"
    ADD CONSTRAINT "historial_precios_mp_id_fkey" FOREIGN KEY ("mp_id") REFERENCES "public"."materias_primas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lotes"
    ADD CONSTRAINT "lotes_anulado_por_fkey" FOREIGN KEY ("anulado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."lotes"
    ADD CONSTRAINT "lotes_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."lotes"
    ADD CONSTRAINT "lotes_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lotes"
    ADD CONSTRAINT "lotes_orden_id_fkey" FOREIGN KEY ("orden_id") REFERENCES "public"."ordenes_produccion"("id");



ALTER TABLE ONLY "public"."lotes"
    ADD CONSTRAINT "lotes_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos_terminados"("id");



ALTER TABLE ONLY "public"."lotes"
    ADD CONSTRAINT "lotes_receta_id_fkey" FOREIGN KEY ("receta_id") REFERENCES "public"."recetas"("id");



ALTER TABLE ONLY "public"."materias_primas"
    ADD CONSTRAINT "materias_primas_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."materias_primas"
    ADD CONSTRAINT "materias_primas_precio_actualizado_por_fkey" FOREIGN KEY ("precio_actualizado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."negocio_ordenes"
    ADD CONSTRAINT "negocio_ordenes_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."ordenes_produccion"
    ADD CONSTRAINT "ordenes_produccion_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."ordenes_produccion_items"
    ADD CONSTRAINT "ordenes_produccion_items_orden_id_fkey" FOREIGN KEY ("orden_id") REFERENCES "public"."ordenes_produccion"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ordenes_produccion_items"
    ADD CONSTRAINT "ordenes_produccion_items_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos_terminados"("id");



ALTER TABLE ONLY "public"."ordenes_produccion"
    ADD CONSTRAINT "ordenes_produccion_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."ordenes_produccion"
    ADD CONSTRAINT "ordenes_produccion_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedidos"("id");



ALTER TABLE ONLY "public"."pagos"
    ADD CONSTRAINT "pagos_anulado_por_fkey" FOREIGN KEY ("anulado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."pagos"
    ADD CONSTRAINT "pagos_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."pagos"
    ADD CONSTRAINT "pagos_factura_id_fkey" FOREIGN KEY ("factura_id") REFERENCES "public"."facturas"("id");



ALTER TABLE ONLY "public"."pagos"
    ADD CONSTRAINT "pagos_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pagos"
    ADD CONSTRAINT "pagos_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedores"("id");



ALTER TABLE ONLY "public"."pedido_items"
    ADD CONSTRAINT "pedido_items_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedidos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pedido_items"
    ADD CONSTRAINT "pedido_items_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos_terminados"("id");



ALTER TABLE ONLY "public"."pedidos"
    ADD CONSTRAINT "pedidos_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."pedidos"
    ADD CONSTRAINT "pedidos_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."pedidos"
    ADD CONSTRAINT "pedidos_remito_id_fkey" FOREIGN KEY ("remito_id") REFERENCES "public"."remitos"("id");



ALTER TABLE ONLY "public"."productos_terminados"
    ADD CONSTRAINT "productos_terminados_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."productos_terminados"
    ADD CONSTRAINT "productos_terminados_receta_id_fkey" FOREIGN KEY ("receta_id") REFERENCES "public"."recetas"("id");



ALTER TABLE ONLY "public"."proveedores"
    ADD CONSTRAINT "proveedores_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."receta_ingredientes"
    ADD CONSTRAINT "receta_ingredientes_mp_id_fkey" FOREIGN KEY ("mp_id") REFERENCES "public"."materias_primas"("id");



ALTER TABLE ONLY "public"."receta_ingredientes"
    ADD CONSTRAINT "receta_ingredientes_receta_id_fkey" FOREIGN KEY ("receta_id") REFERENCES "public"."recetas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recetas"
    ADD CONSTRAINT "recetas_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."remito_items"
    ADD CONSTRAINT "remito_items_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos_terminados"("id");



ALTER TABLE ONLY "public"."remito_items"
    ADD CONSTRAINT "remito_items_remito_id_fkey" FOREIGN KEY ("remito_id") REFERENCES "public"."remitos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."remito_secuencia"
    ADD CONSTRAINT "remito_secuencia_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."remitos"
    ADD CONSTRAINT "remitos_anulado_por_fkey" FOREIGN KEY ("anulado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."remitos"
    ADD CONSTRAINT "remitos_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."remitos"
    ADD CONSTRAINT "remitos_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."salidas_produccion"
    ADD CONSTRAINT "salidas_produccion_anulada_por_fkey" FOREIGN KEY ("anulada_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."salidas_produccion"
    ADD CONSTRAINT "salidas_produccion_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."salidas_produccion"
    ADD CONSTRAINT "salidas_produccion_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "public"."lotes"("id");



ALTER TABLE ONLY "public"."salidas_produccion"
    ADD CONSTRAINT "salidas_produccion_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."salidas_produccion"
    ADD CONSTRAINT "salidas_produccion_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos_terminados"("id");



ALTER TABLE ONLY "public"."salidas_produccion"
    ADD CONSTRAINT "salidas_produccion_remito_id_fkey" FOREIGN KEY ("remito_id") REFERENCES "public"."remitos"("id");



ALTER TABLE ONLY "public"."usuarios"
    ADD CONSTRAINT "usuarios_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE "public"."ajustes_stock" ENABLE ROW LEVEL SECURITY;



CREATE POLICY "Select ajustes_stock" ON "public"."ajustes_stock" FOR SELECT USING (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Insert ajustes_stock" ON "public"."ajustes_stock" FOR INSERT WITH CHECK (("negocio_id" = ANY ("public"."mis_negocios"())));



ALTER TABLE "public"."invitaciones" ENABLE ROW LEVEL SECURITY;



CREATE POLICY "inv_admin" ON "public"."invitaciones" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios"
  WHERE (("usuarios"."id" = "auth"."uid"()) AND ("usuarios"."rol" = 'admin'::"text") AND ("usuarios"."activo" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."usuarios"
  WHERE (("usuarios"."id" = "auth"."uid"()) AND ("usuarios"."rol" = 'admin'::"text") AND ("usuarios"."activo" = true)))));



CREATE POLICY "inv_self_select" ON "public"."invitaciones" FOR SELECT TO "authenticated" USING (("email" = "auth"."email"()));



CREATE POLICY "inv_self_delete" ON "public"."invitaciones" FOR DELETE TO "authenticated" USING (("email" = "auth"."email"()));



CREATE POLICY "Admin gestiona usuarios" ON "public"."usuarios" USING ("public"."es_admin"());



CREATE POLICY "Admin modifica negocios" ON "public"."negocios" USING ("public"."es_admin"());



CREATE POLICY "Delete ordenes_produccion_items" ON "public"."ordenes_produccion_items" FOR DELETE USING (("orden_id" IN ( SELECT "ordenes_produccion"."id"
   FROM "public"."ordenes_produccion"
  WHERE ("ordenes_produccion"."negocio_id" = ANY ("public"."mis_negocios"())))));



CREATE POLICY "Delete receta_ingredientes" ON "public"."receta_ingredientes" FOR DELETE USING (("receta_id" IN ( SELECT "recetas"."id"
   FROM "public"."recetas"
  WHERE ("recetas"."negocio_id" = ANY ("public"."mis_negocios"())))));



CREATE POLICY "Insert caja" ON "public"."caja" FOR INSERT WITH CHECK (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Insert categorias_caja" ON "public"."categorias_caja" FOR INSERT WITH CHECK (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Insert factura_items" ON "public"."factura_items" FOR INSERT WITH CHECK (("factura_id" IN ( SELECT "facturas"."id"
   FROM "public"."facturas"
  WHERE ("facturas"."negocio_id" = ANY ("public"."mis_negocios"())))));



CREATE POLICY "Insert facturas" ON "public"."facturas" FOR INSERT WITH CHECK (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Insert historial" ON "public"."historial_precios" FOR INSERT WITH CHECK (("mp_id" IN ( SELECT "materias_primas"."id"
   FROM "public"."materias_primas"
  WHERE ("materias_primas"."negocio_id" = ANY ("public"."mis_negocios"())))));



CREATE POLICY "Insert lotes" ON "public"."lotes" FOR INSERT WITH CHECK (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Insert materias_primas" ON "public"."materias_primas" FOR INSERT WITH CHECK (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Insert ordenes_produccion" ON "public"."ordenes_produccion" FOR INSERT WITH CHECK (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Insert ordenes_produccion_items" ON "public"."ordenes_produccion_items" FOR INSERT WITH CHECK (("orden_id" IN ( SELECT "ordenes_produccion"."id"
   FROM "public"."ordenes_produccion"
  WHERE ("ordenes_produccion"."negocio_id" = ANY ("public"."mis_negocios"())))));



CREATE POLICY "Insert pagos" ON "public"."pagos" FOR INSERT WITH CHECK (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Insert pedido_items" ON "public"."pedido_items" FOR INSERT WITH CHECK (("pedido_id" IN ( SELECT "pedidos"."id"
   FROM "public"."pedidos"
  WHERE ("pedidos"."negocio_id" = ANY ("public"."mis_negocios"())))));



CREATE POLICY "Insert pedidos" ON "public"."pedidos" FOR INSERT WITH CHECK (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Insert productos_terminados" ON "public"."productos_terminados" FOR INSERT WITH CHECK (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Insert proveedores" ON "public"."proveedores" FOR INSERT WITH CHECK (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Insert receta_ingredientes" ON "public"."receta_ingredientes" FOR INSERT WITH CHECK (("receta_id" IN ( SELECT "recetas"."id"
   FROM "public"."recetas"
  WHERE ("recetas"."negocio_id" = ANY ("public"."mis_negocios"())))));



CREATE POLICY "Insert recetas" ON "public"."recetas" FOR INSERT WITH CHECK (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Insert remito_items" ON "public"."remito_items" FOR INSERT WITH CHECK (("remito_id" IN ( SELECT "remitos"."id"
   FROM "public"."remitos"
  WHERE ("remitos"."negocio_id" = ANY ("public"."mis_negocios"())))));



CREATE POLICY "Insert remitos" ON "public"."remitos" FOR INSERT WITH CHECK (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Insert salidas_produccion" ON "public"."salidas_produccion" FOR INSERT WITH CHECK (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Select caja" ON "public"."caja" FOR SELECT USING (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Select categorias_caja" ON "public"."categorias_caja" FOR SELECT USING (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Select factura_items" ON "public"."factura_items" FOR SELECT USING (("factura_id" IN ( SELECT "facturas"."id"
   FROM "public"."facturas"
  WHERE ("facturas"."negocio_id" = ANY ("public"."mis_negocios"())))));



CREATE POLICY "Select facturas" ON "public"."facturas" FOR SELECT USING (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Select historial" ON "public"."historial_precios" FOR SELECT USING (("mp_id" IN ( SELECT "materias_primas"."id"
   FROM "public"."materias_primas"
  WHERE ("materias_primas"."negocio_id" = ANY ("public"."mis_negocios"())))));



CREATE POLICY "Select lotes" ON "public"."lotes" FOR SELECT USING (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Select materias_primas" ON "public"."materias_primas" FOR SELECT USING (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Select ordenes_produccion" ON "public"."ordenes_produccion" FOR SELECT USING (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Select ordenes_produccion_items" ON "public"."ordenes_produccion_items" FOR SELECT USING (("orden_id" IN ( SELECT "ordenes_produccion"."id"
   FROM "public"."ordenes_produccion"
  WHERE ("ordenes_produccion"."negocio_id" = ANY ("public"."mis_negocios"())))));



CREATE POLICY "Select pagos" ON "public"."pagos" FOR SELECT USING (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Select pedido_items" ON "public"."pedido_items" FOR SELECT USING (("pedido_id" IN ( SELECT "pedidos"."id"
   FROM "public"."pedidos"
  WHERE ("pedidos"."negocio_id" = ANY ("public"."mis_negocios"())))));



CREATE POLICY "Select pedidos" ON "public"."pedidos" FOR SELECT USING (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Select productos_terminados" ON "public"."productos_terminados" FOR SELECT USING (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Select proveedores" ON "public"."proveedores" FOR SELECT USING (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Select receta_ingredientes" ON "public"."receta_ingredientes" FOR SELECT USING (("receta_id" IN ( SELECT "recetas"."id"
   FROM "public"."recetas"
  WHERE ("recetas"."negocio_id" = ANY ("public"."mis_negocios"())))));



CREATE POLICY "Select recetas" ON "public"."recetas" FOR SELECT USING (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Select remito_items" ON "public"."remito_items" FOR SELECT USING (("remito_id" IN ( SELECT "remitos"."id"
   FROM "public"."remitos"
  WHERE ("remitos"."negocio_id" = ANY ("public"."mis_negocios"())))));



CREATE POLICY "Select remito_secuencia" ON "public"."remito_secuencia" FOR SELECT USING (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Select remitos" ON "public"."remitos" FOR SELECT USING (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Select salidas_produccion" ON "public"."salidas_produccion" FOR SELECT USING (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Update caja" ON "public"."caja" FOR UPDATE USING (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Update categorias_caja" ON "public"."categorias_caja" FOR UPDATE USING (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Update facturas" ON "public"."facturas" FOR UPDATE USING (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Update lotes" ON "public"."lotes" FOR UPDATE USING (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Update materias_primas" ON "public"."materias_primas" FOR UPDATE USING (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Update ordenes_produccion" ON "public"."ordenes_produccion" FOR UPDATE USING (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Update ordenes_produccion_items" ON "public"."ordenes_produccion_items" FOR UPDATE USING (("orden_id" IN ( SELECT "ordenes_produccion"."id"
   FROM "public"."ordenes_produccion"
  WHERE ("ordenes_produccion"."negocio_id" = ANY ("public"."mis_negocios"())))));



CREATE POLICY "Update pagos" ON "public"."pagos" FOR UPDATE USING (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Update pedido_items" ON "public"."pedido_items" FOR UPDATE USING (("pedido_id" IN ( SELECT "pedidos"."id"
   FROM "public"."pedidos"
  WHERE ("pedidos"."negocio_id" = ANY ("public"."mis_negocios"())))));



CREATE POLICY "Update pedidos" ON "public"."pedidos" FOR UPDATE USING (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Update productos_terminados" ON "public"."productos_terminados" FOR UPDATE USING (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Update proveedores" ON "public"."proveedores" FOR UPDATE USING (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Update recetas" ON "public"."recetas" FOR UPDATE USING (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Update remito_secuencia" ON "public"."remito_secuencia" FOR UPDATE USING (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Update remitos" ON "public"."remitos" FOR UPDATE USING (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Update salidas_produccion" ON "public"."salidas_produccion" FOR UPDATE USING (("negocio_id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Usuario actualiza propio" ON "public"."usuarios" FOR UPDATE USING (("id" = "auth"."uid"()));



CREATE POLICY "Ver negocios propios" ON "public"."negocios" FOR SELECT USING (("id" = ANY ("public"."mis_negocios"())));



CREATE POLICY "Ver propio usuario" ON "public"."usuarios" FOR SELECT USING ((("id" = "auth"."uid"()) OR "public"."es_admin"()));



ALTER TABLE "public"."caja" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."categorias_caja" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."factura_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."facturas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."historial_precios" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lotes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."materias_primas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."negocio_ordenes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "negocio_ordenes_policy" ON "public"."negocio_ordenes" USING (("negocio_id" IN ( SELECT "unnest"("usuarios"."negocio_ids") AS "unnest"
   FROM "public"."usuarios"
  WHERE ("usuarios"."id" = "auth"."uid"()))));



ALTER TABLE "public"."negocios" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "negocios_select_authenticated" ON "public"."negocios" FOR SELECT TO "authenticated" USING (("activo" = true));



CREATE POLICY "op_delete" ON "public"."ordenes_produccion" FOR DELETE USING (("negocio_id" IN ( SELECT "ordenes_produccion"."negocio_id"
   FROM "public"."usuarios"
  WHERE (("usuarios"."id" = "auth"."uid"()) AND ("usuarios"."rol" = 'admin'::"text")))));



CREATE POLICY "op_insert" ON "public"."ordenes_produccion" FOR INSERT WITH CHECK (("negocio_id" IN ( SELECT "ordenes_produccion"."negocio_id"
   FROM "public"."usuarios"
  WHERE ("usuarios"."id" = "auth"."uid"()))));



CREATE POLICY "op_items_delete" ON "public"."ordenes_produccion_items" FOR DELETE USING (("orden_id" IN ( SELECT "ordenes_produccion"."id"
   FROM "public"."ordenes_produccion"
  WHERE ("ordenes_produccion"."negocio_id" IN ( SELECT "ordenes_produccion"."negocio_id"
           FROM "public"."usuarios"
          WHERE (("usuarios"."id" = "auth"."uid"()) AND ("usuarios"."rol" = 'admin'::"text")))))));



CREATE POLICY "op_items_insert" ON "public"."ordenes_produccion_items" FOR INSERT WITH CHECK (("orden_id" IN ( SELECT "ordenes_produccion"."id"
   FROM "public"."ordenes_produccion"
  WHERE ("ordenes_produccion"."negocio_id" IN ( SELECT "ordenes_produccion"."negocio_id"
           FROM "public"."usuarios"
          WHERE ("usuarios"."id" = "auth"."uid"()))))));



CREATE POLICY "op_items_select" ON "public"."ordenes_produccion_items" FOR SELECT USING (("orden_id" IN ( SELECT "ordenes_produccion"."id"
   FROM "public"."ordenes_produccion"
  WHERE ("ordenes_produccion"."negocio_id" IN ( SELECT "ordenes_produccion"."negocio_id"
           FROM "public"."usuarios"
          WHERE ("usuarios"."id" = "auth"."uid"()))))));



CREATE POLICY "op_items_update" ON "public"."ordenes_produccion_items" FOR UPDATE USING (("orden_id" IN ( SELECT "ordenes_produccion"."id"
   FROM "public"."ordenes_produccion"
  WHERE ("ordenes_produccion"."negocio_id" IN ( SELECT "ordenes_produccion"."negocio_id"
           FROM "public"."usuarios"
          WHERE ("usuarios"."id" = "auth"."uid"()))))));



CREATE POLICY "op_select" ON "public"."ordenes_produccion" FOR SELECT USING (("negocio_id" IN ( SELECT "ordenes_produccion"."negocio_id"
   FROM "public"."usuarios"
  WHERE ("usuarios"."id" = "auth"."uid"()))));



CREATE POLICY "op_update" ON "public"."ordenes_produccion" FOR UPDATE USING (("negocio_id" IN ( SELECT "ordenes_produccion"."negocio_id"
   FROM "public"."usuarios"
  WHERE ("usuarios"."id" = "auth"."uid"()))));



ALTER TABLE "public"."ordenes_produccion" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ordenes_produccion_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pagos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pedido_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pedido_items_delete" ON "public"."pedido_items" FOR DELETE USING (("pedido_id" IN ( SELECT "pedidos"."id"
   FROM "public"."pedidos"
  WHERE ("pedidos"."negocio_id" IN ( SELECT "pedidos"."negocio_id"
           FROM "public"."usuarios"
          WHERE (("usuarios"."id" = "auth"."uid"()) AND ("usuarios"."rol" = 'admin'::"text")))))));



CREATE POLICY "pedido_items_insert" ON "public"."pedido_items" FOR INSERT WITH CHECK (("pedido_id" IN ( SELECT "pedidos"."id"
   FROM "public"."pedidos"
  WHERE ("pedidos"."negocio_id" IN ( SELECT "pedidos"."negocio_id"
           FROM "public"."usuarios"
          WHERE ("usuarios"."id" = "auth"."uid"()))))));



CREATE POLICY "pedido_items_select" ON "public"."pedido_items" FOR SELECT USING (("pedido_id" IN ( SELECT "pedidos"."id"
   FROM "public"."pedidos"
  WHERE ("pedidos"."negocio_id" IN ( SELECT "pedidos"."negocio_id"
           FROM "public"."usuarios"
          WHERE ("usuarios"."id" = "auth"."uid"()))))));



CREATE POLICY "pedido_items_update" ON "public"."pedido_items" FOR UPDATE USING (("pedido_id" IN ( SELECT "pedidos"."id"
   FROM "public"."pedidos"
  WHERE ("pedidos"."negocio_id" IN ( SELECT "pedidos"."negocio_id"
           FROM "public"."usuarios"
          WHERE ("usuarios"."id" = "auth"."uid"()))))));



ALTER TABLE "public"."pedidos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pedidos_delete" ON "public"."pedidos" FOR DELETE USING (("negocio_id" IN ( SELECT "pedidos"."negocio_id"
   FROM "public"."usuarios"
  WHERE (("usuarios"."id" = "auth"."uid"()) AND ("usuarios"."rol" = 'admin'::"text")))));



CREATE POLICY "pedidos_insert" ON "public"."pedidos" FOR INSERT WITH CHECK (("negocio_id" IN ( SELECT "pedidos"."negocio_id"
   FROM "public"."usuarios"
  WHERE ("usuarios"."id" = "auth"."uid"()))));



CREATE POLICY "pedidos_select" ON "public"."pedidos" FOR SELECT USING (("negocio_id" IN ( SELECT "pedidos"."negocio_id"
   FROM "public"."usuarios"
  WHERE ("usuarios"."id" = "auth"."uid"()))));



CREATE POLICY "pedidos_update" ON "public"."pedidos" FOR UPDATE USING (("negocio_id" IN ( SELECT "pedidos"."negocio_id"
   FROM "public"."usuarios"
  WHERE (("usuarios"."id" = "auth"."uid"()) AND ("usuarios"."rol" = 'admin'::"text")))));



ALTER TABLE "public"."productos_terminados" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."proveedores" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."receta_ingredientes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."recetas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."remito_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."remito_secuencia" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."remitos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."salidas_produccion" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."usuarios" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "usuarios_select_own" ON "public"."usuarios" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."descontar_stock_mp"("p_mp_id" "uuid", "p_cantidad" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."descontar_stock_mp"("p_mp_id" "uuid", "p_cantidad" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."descontar_stock_mp"("p_mp_id" "uuid", "p_cantidad" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."es_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."es_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."es_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."init_categorias"("p_negocio_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."init_categorias"("p_negocio_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."init_categorias"("p_negocio_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."make_negocio_policies"("p_table" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."make_negocio_policies"("p_table" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."make_negocio_policies"("p_table" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."mis_negocios"() TO "anon";
GRANT ALL ON FUNCTION "public"."mis_negocios"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."mis_negocios"() TO "service_role";



GRANT ALL ON TABLE "public"."ajustes_stock" TO "anon";
GRANT ALL ON TABLE "public"."ajustes_stock" TO "authenticated";
GRANT ALL ON TABLE "public"."ajustes_stock" TO "service_role";



GRANT ALL ON TABLE "public"."invitaciones" TO "anon";
GRANT ALL ON TABLE "public"."invitaciones" TO "authenticated";
GRANT ALL ON TABLE "public"."invitaciones" TO "service_role";



GRANT ALL ON TABLE "public"."caja" TO "anon";
GRANT ALL ON TABLE "public"."caja" TO "authenticated";
GRANT ALL ON TABLE "public"."caja" TO "service_role";



GRANT ALL ON TABLE "public"."categorias_caja" TO "anon";
GRANT ALL ON TABLE "public"."categorias_caja" TO "authenticated";
GRANT ALL ON TABLE "public"."categorias_caja" TO "service_role";



GRANT ALL ON TABLE "public"."factura_items" TO "anon";
GRANT ALL ON TABLE "public"."factura_items" TO "authenticated";
GRANT ALL ON TABLE "public"."factura_items" TO "service_role";



GRANT ALL ON TABLE "public"."facturas" TO "anon";
GRANT ALL ON TABLE "public"."facturas" TO "authenticated";
GRANT ALL ON TABLE "public"."facturas" TO "service_role";



GRANT ALL ON TABLE "public"."historial_precios" TO "anon";
GRANT ALL ON TABLE "public"."historial_precios" TO "authenticated";
GRANT ALL ON TABLE "public"."historial_precios" TO "service_role";



GRANT ALL ON TABLE "public"."lotes" TO "anon";
GRANT ALL ON TABLE "public"."lotes" TO "authenticated";
GRANT ALL ON TABLE "public"."lotes" TO "service_role";



GRANT ALL ON TABLE "public"."materias_primas" TO "anon";
GRANT ALL ON TABLE "public"."materias_primas" TO "authenticated";
GRANT ALL ON TABLE "public"."materias_primas" TO "service_role";



GRANT ALL ON TABLE "public"."negocio_ordenes" TO "anon";
GRANT ALL ON TABLE "public"."negocio_ordenes" TO "authenticated";
GRANT ALL ON TABLE "public"."negocio_ordenes" TO "service_role";



GRANT ALL ON TABLE "public"."negocios" TO "anon";
GRANT ALL ON TABLE "public"."negocios" TO "authenticated";
GRANT ALL ON TABLE "public"."negocios" TO "service_role";



GRANT ALL ON TABLE "public"."ordenes_produccion" TO "anon";
GRANT ALL ON TABLE "public"."ordenes_produccion" TO "authenticated";
GRANT ALL ON TABLE "public"."ordenes_produccion" TO "service_role";



GRANT ALL ON TABLE "public"."ordenes_produccion_items" TO "anon";
GRANT ALL ON TABLE "public"."ordenes_produccion_items" TO "authenticated";
GRANT ALL ON TABLE "public"."ordenes_produccion_items" TO "service_role";



GRANT ALL ON TABLE "public"."pagos" TO "anon";
GRANT ALL ON TABLE "public"."pagos" TO "authenticated";
GRANT ALL ON TABLE "public"."pagos" TO "service_role";



GRANT ALL ON TABLE "public"."pedido_items" TO "anon";
GRANT ALL ON TABLE "public"."pedido_items" TO "authenticated";
GRANT ALL ON TABLE "public"."pedido_items" TO "service_role";



GRANT ALL ON TABLE "public"."pedidos" TO "anon";
GRANT ALL ON TABLE "public"."pedidos" TO "authenticated";
GRANT ALL ON TABLE "public"."pedidos" TO "service_role";



GRANT ALL ON TABLE "public"."productos_terminados" TO "anon";
GRANT ALL ON TABLE "public"."productos_terminados" TO "authenticated";
GRANT ALL ON TABLE "public"."productos_terminados" TO "service_role";



GRANT ALL ON TABLE "public"."proveedores" TO "anon";
GRANT ALL ON TABLE "public"."proveedores" TO "authenticated";
GRANT ALL ON TABLE "public"."proveedores" TO "service_role";



GRANT ALL ON TABLE "public"."receta_ingredientes" TO "anon";
GRANT ALL ON TABLE "public"."receta_ingredientes" TO "authenticated";
GRANT ALL ON TABLE "public"."receta_ingredientes" TO "service_role";



GRANT ALL ON TABLE "public"."recetas" TO "anon";
GRANT ALL ON TABLE "public"."recetas" TO "authenticated";
GRANT ALL ON TABLE "public"."recetas" TO "service_role";



GRANT ALL ON TABLE "public"."remito_items" TO "anon";
GRANT ALL ON TABLE "public"."remito_items" TO "authenticated";
GRANT ALL ON TABLE "public"."remito_items" TO "service_role";



GRANT ALL ON TABLE "public"."remito_secuencia" TO "anon";
GRANT ALL ON TABLE "public"."remito_secuencia" TO "authenticated";
GRANT ALL ON TABLE "public"."remito_secuencia" TO "service_role";



GRANT ALL ON TABLE "public"."remitos" TO "anon";
GRANT ALL ON TABLE "public"."remitos" TO "authenticated";
GRANT ALL ON TABLE "public"."remitos" TO "service_role";



GRANT ALL ON TABLE "public"."salidas_produccion" TO "anon";
GRANT ALL ON TABLE "public"."salidas_produccion" TO "authenticated";
GRANT ALL ON TABLE "public"."salidas_produccion" TO "service_role";



GRANT ALL ON TABLE "public"."usuarios" TO "anon";
GRANT ALL ON TABLE "public"."usuarios" TO "authenticated";
GRANT ALL ON TABLE "public"."usuarios" TO "service_role";



GRANT ALL ON TABLE "public"."v_facturas_estado" TO "anon";
GRANT ALL ON TABLE "public"."v_facturas_estado" TO "authenticated";
GRANT ALL ON TABLE "public"."v_facturas_estado" TO "service_role";



GRANT ALL ON TABLE "public"."v_deuda_proveedores" TO "anon";
GRANT ALL ON TABLE "public"."v_deuda_proveedores" TO "authenticated";
GRANT ALL ON TABLE "public"."v_deuda_proveedores" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







