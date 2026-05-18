// ═══════════════════════════════════════════════════════════════
//   HOLOS MENTORÍAS — Edge Function: admin-operations
//   Único punto del sistema que usa service_role_key.
//   El frontend NUNCA debe tener acceso a esa key.
//
//   Despliegue:
//     supabase functions deploy admin-operations --no-verify-jwt
//   (el --no-verify-jwt lo dejamos en false; verificamos a mano
//    para poder leer el JWT y decidir según rol)
//
//   Variables de entorno requeridas (las setea Supabase auto):
//     SUPABASE_URL
//     SUPABASE_SERVICE_ROLE_KEY
//     SUPABASE_ANON_KEY
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;

// Cliente con service_role: bypass de RLS. Sólo se usa después de
// verificar a mano la identidad del que llama.
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const cors = {
  "Access-Control-Allow-Origin": "*",  // ajustar en producción al dominio Cloudflare
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}

/** Verifica el JWT del header Authorization y devuelve el profile completo */
async function getCallerProfile(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);

  // Validar el JWT contra Supabase Auth
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return null;

  const { data: profile } = await admin
    .from("profiles")
    .select("id, email, rol, activo")
    .eq("id", user.id)
    .single();

  if (!profile || !profile.activo) return null;
  return profile;
}

Deno.serve(async (req) => {
  // Preflight CORS
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST")    return json({ error: "method_not_allowed" }, 405);

  let payload: { action: string; [k: string]: any };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const caller = await getCallerProfile(req);
  if (!caller) return json({ error: "unauthorized" }, 401);

  const { action } = payload;

  try {
    switch (action) {

      // ─────────────────────────────────────────────────────────
      // ASIGNAR ROL — sólo super_admin
      // ─────────────────────────────────────────────────────────
      case "assign_role": {
        if (caller.rol !== "super_admin")
          return json({ error: "forbidden" }, 403);

        const { user_id, rol } = payload;
        if (!user_id || !["super_admin","admin","mentor",null].includes(rol))
          return json({ error: "invalid_params" }, 400);

        // No permitir que un super_admin se quite el rol a sí mismo
        // (evita lockout del sistema).
        if (user_id === caller.id && rol !== "super_admin")
          return json({ error: "cannot_demote_self" }, 400);

        const { error } = await admin
          .from("profiles")
          .update({ rol })
          .eq("id", user_id);

        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      // ─────────────────────────────────────────────────────────
      // ACTIVAR / DESACTIVAR usuario — sólo super_admin
      // ─────────────────────────────────────────────────────────
      case "set_active": {
        if (caller.rol !== "super_admin")
          return json({ error: "forbidden" }, 403);

        const { user_id, activo } = payload;
        if (!user_id || typeof activo !== "boolean")
          return json({ error: "invalid_params" }, 400);

        if (user_id === caller.id && activo === false)
          return json({ error: "cannot_disable_self" }, 400);

        const { error } = await admin
          .from("profiles")
          .update({ activo })
          .eq("id", user_id);

        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      // ─────────────────────────────────────────────────────────
      // ELIMINAR usuario por completo (auth + profile cascade)
      // sólo super_admin
      // ─────────────────────────────────────────────────────────
      case "delete_user": {
        if (caller.rol !== "super_admin")
          return json({ error: "forbidden" }, 403);

        const { user_id } = payload;
        if (!user_id) return json({ error: "invalid_params" }, 400);
        if (user_id === caller.id)
          return json({ error: "cannot_delete_self" }, 400);

        const { error } = await admin.auth.admin.deleteUser(user_id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      default:
        return json({ error: "unknown_action" }, 400);
    }
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
