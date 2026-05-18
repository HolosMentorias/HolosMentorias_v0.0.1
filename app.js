/* ═══════════════════════════════════════════════════════════════
   HOLOS MENTORÍAS — app.js (Fase 1)
   Router por rol · Auth · Alumnos · Mentores · Usuarios
   La seguridad real vive en RLS de Postgres; este archivo
   sólo refleja el estado de permisos en la UI.
═══════════════════════════════════════════════════════════════ */

/* ───────────────────────────────────────────────────────────────
   1. CONFIGURACIÓN E INICIALIZACIÓN
─────────────────────────────────────────────────────────────── */

const CFG = window.__HOLOS_CONFIG__;
if (!CFG || !CFG.SUPABASE_URL || CFG.SUPABASE_ANON_KEY === 'REEMPLAZAR_EN_BUILD') {
  alert('Configuración faltante. Revisá la inyección de variables en build.');
}

const { createClient } = window.supabase;
const db = createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

// URL de la Edge Function para operaciones de super_admin
const EDGE_FN_URL = `${CFG.SUPABASE_URL}/functions/v1/admin-operations`;

/* ───────────────────────────────────────────────────────────────
   2. ESTADO GLOBAL
─────────────────────────────────────────────────────────────── */

const state = {
  session: null,
  profile: null,            // {id, email, rol, nombre, apellido, avatar_url, activo}
  currentView: null,        // string: la vista activa actual
  // datos cacheados por vista
  mentorAlumnos: [],
  adminAlumnos: [],
  adminMentores: [],
  superUsers: [],
  // filtros
  mentorFilter: 'all',
  mentorSearch: '',
  mentorSort: 'reciente',
  adminAlumnoFilter: 'all',
  adminAlumnoSearch: '',
  adminMentorSearch: '',
  superFilter: 'all',
  superSearch: '',
};

/* ───────────────────────────────────────────────────────────────
   3. UTILS GENERALES
─────────────────────────────────────────────────────────────── */

const $  = (id) => document.getElementById(id);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function toast(msg, type = 'ok') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast toast-${type}`;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3000);
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('es-AR');
}

function diffDays(d) {
  if (!d) return null;
  const dt = new Date(d + 'T00:00:00');
  return Math.floor((Date.now() - dt) / 86400000);
}

function fullName(p) {
  if (!p) return '—';
  const n = [p.nombre, p.apellido].filter(Boolean).join(' ').trim();
  return n || p.email || '—';
}

function initials(p) {
  if (!p) return '?';
  const a = (p.nombre || p.email || '?')[0];
  const b = (p.apellido || '')[0] || '';
  return (a + b).toUpperCase();
}

/* ───────────────────────────────────────────────────────────────
   4. COMPRESIÓN DE IMÁGENES
   Pipeline cliente: File → ImageBitmap → canvas (max 400px,
   centro recortado, círculo) → WebP q=0.78 → Blob ~50 KB.
   Si el resultado supera 200 KB, reintenta con quality menor.
─────────────────────────────────────────────────────────────── */

async function compressAvatar(file, { max = 400, mimeOut = 'image/webp', targetMaxBytes = 200_000 } = {}) {
  if (!file.type.startsWith('image/')) throw new Error('No es una imagen');
  if (file.size > 10 * 1024 * 1024)    throw new Error('Imagen demasiado grande (máx 10 MB)');

  const bitmap = await createImageBitmap(file);

  // recorte cuadrado centrado
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width  - side) / 2;
  const sy = (bitmap.height - side) / 2;

  const out = Math.min(max, side);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = out;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, out, out);
  bitmap.close?.();

  // Reintentos progresivos hasta lograr el tamaño objetivo
  for (const q of [0.82, 0.7, 0.55, 0.4]) {
    const blob = await new Promise(res => canvas.toBlob(res, mimeOut, q));
    if (!blob) continue;
    if (blob.size <= targetMaxBytes) return blob;
  }
  // Si después de todos los intentos sigue gigante, devolvemos el último
  return await new Promise(res => canvas.toBlob(res, mimeOut, 0.35));
}

/* ───────────────────────────────────────────────────────────────
   5. AUTH — login / signup / reset / logout
─────────────────────────────────────────────────────────────── */

function showScreen(id) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

function showLoginPanel(panelId) {
  ['panel-login','panel-registro','panel-reset'].forEach(p => $(p).classList.add('hidden'));
  $(panelId).classList.remove('hidden');
  ['login-error','reg-error','reg-ok','reset-error','reset-ok']
    .forEach(id => { const e = $(id); if (e) { e.classList.add('hidden'); e.textContent = ''; } });
}

$('ir-registro').onclick = () => showLoginPanel('panel-registro');
$('ir-reset').onclick    = () => showLoginPanel('panel-reset');
$('ir-login-desde-reg').onclick   = () => showLoginPanel('panel-login');
$('ir-login-desde-reset').onclick = () => showLoginPanel('panel-login');

// Toggle ojito en inputs de contraseña
$$('.btn-ojo').forEach(btn => {
  btn.onclick = () => {
    const target = $(btn.dataset.target);
    const closed = btn.querySelector('.ojo-cerrado');
    const open   = btn.querySelector('.ojo-abierto');
    if (target.type === 'password') {
      target.type = 'text';
      closed.style.display = 'none'; open.style.display = '';
    } else {
      target.type = 'password';
      closed.style.display = ''; open.style.display = 'none';
    }
  };
});

$('btn-login').onclick = async () => {
  const email = $('login-email').value.trim();
  const pass  = $('login-password').value;
  const err   = $('login-error');
  err.classList.add('hidden');

  if (!email || !pass) { err.textContent = 'Completá email y contraseña.'; err.classList.remove('hidden'); return; }

  const btn = $('btn-login'); btn.disabled = true; btn.textContent = 'Ingresando...';
  const { error } = await db.auth.signInWithPassword({ email, password: pass });
  btn.disabled = false; btn.textContent = 'Ingresar';

  if (error) { err.textContent = 'Email o contraseña incorrectos.'; err.classList.remove('hidden'); return; }
  await bootstrapSession();
};

['login-email','login-password'].forEach(id => {
  $(id).addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-login').click(); });
});

$('btn-registro').onclick = async () => {
  const email = $('reg-email').value.trim();
  const pass  = $('reg-password').value;
  const pass2 = $('reg-password2').value;
  const err = $('reg-error'); const ok = $('reg-ok');
  err.classList.add('hidden'); ok.classList.add('hidden');

  if (!email || !pass || !pass2) { err.textContent = 'Completá todos los campos.'; err.classList.remove('hidden'); return; }
  if (pass.length < 8)            { err.textContent = 'La contraseña debe tener al menos 8 caracteres.'; err.classList.remove('hidden'); return; }
  if (pass !== pass2)             { err.textContent = 'Las contraseñas no coinciden.'; err.classList.remove('hidden'); return; }

  const btn = $('btn-registro'); btn.disabled = true; btn.textContent = 'Creando...';
  const { error } = await db.auth.signUp({ email, password: pass });
  btn.disabled = false; btn.textContent = 'Crear cuenta';

  if (error) {
    err.textContent = error.message.includes('already')
      ? 'Ese email ya tiene cuenta. Iniciá sesión.'
      : 'Error al crear la cuenta.';
    err.classList.remove('hidden'); return;
  }
  ok.textContent = '✓ Cuenta creada. Revisá tu email para confirmar. Después de iniciar sesión, un administrador te asignará un rol.';
  ok.classList.remove('hidden');
  ['reg-email','reg-password','reg-password2'].forEach(id => $(id).value = '');
};

$('btn-reset').onclick = async () => {
  const email = $('reset-email').value.trim();
  const err = $('reset-error'); const ok = $('reset-ok');
  err.classList.add('hidden'); ok.classList.add('hidden');
  if (!email) { err.textContent = 'Ingresá tu email.'; err.classList.remove('hidden'); return; }

  const btn = $('btn-reset'); btn.disabled = true; btn.textContent = 'Enviando...';
  const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
  btn.disabled = false; btn.textContent = 'Enviar link de recuperación';

  if (error) { err.textContent = 'Error al enviar. Verificá el email.'; err.classList.remove('hidden'); return; }
  ok.textContent = '✓ Link enviado. Revisá tu bandeja (y spam).';
  ok.classList.remove('hidden');
  $('reset-email').value = '';
};
$('reset-email').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-reset').click(); });

$('btn-logout').onclick = async () => {
  await db.auth.signOut();
  state.session = null; state.profile = null;
  showScreen('login-screen');
  showLoginPanel('panel-login');
};
$('pending-logout').onclick = () => $('btn-logout').click();
$('pending-refresh').onclick = () => bootstrapSession();

/* ───────────────────────────────────────────────────────────────
   6. BOOTSTRAP — al cargar y al loguearse
─────────────────────────────────────────────────────────────── */

async function bootstrapSession() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) {
    showScreen('login-screen');
    showLoginPanel('panel-login');
    return;
  }
  state.session = session;

  // Cargar perfil del usuario
  const { data: prof, error } = await db
    .from('profiles')
    .select('id,email,rol,nombre,apellido,avatar_url,activo')
    .eq('id', session.user.id)
    .single();

  if (error || !prof) {
    toast('No se pudo cargar el perfil', 'error');
    return;
  }
  state.profile = prof;

  if (!prof.activo) {
    toast('Tu cuenta fue desactivada. Contactá al administrador.', 'error');
    await db.auth.signOut();
    return;
  }

  // Sin rol → pantalla "pendiente"
  if (!prof.rol) {
    $('pending-email').textContent = prof.email;
    showScreen('pending-screen');
    return;
  }

  // Con rol → renderizar app
  renderHeader();
  configureNavForRole(prof.rol);
  showScreen('app-screen');

  // Vista inicial según rol
  const defaultView = {
    super_admin: 'super-usuarios',
    admin:       'admin-alumnos',
    mentor:      'mentor-alumnos'
  }[prof.rol];
  switchView(defaultView);
}

function renderHeader() {
  $('header-user').textContent = fullName(state.profile);
  if (state.profile.avatar_url) {
    $('avatar-thumb').src = state.profile.avatar_url;
    $('avatar-thumb').classList.add('visible');
  } else {
    $('avatar-thumb').classList.remove('visible');
  }
}

/* ───────────────────────────────────────────────────────────────
   7. ROUTER POR ROL — qué pestañas se muestran y vista activa
─────────────────────────────────────────────────────────────── */

function configureNavForRole(rol) {
  $$('.nav-tab').forEach(tab => {
    const reqRole = tab.dataset.role;
    const visible =
      (rol === 'super_admin') ||                  // super ve todo
      (rol === 'admin' && reqRole === 'admin') ||
      (rol === 'mentor' && reqRole === 'mentor');
    tab.classList.toggle('visible', visible);
  });

  // Listeners de tabs
  $$('.nav-tab').forEach(tab => {
    tab.onclick = () => switchView(tab.dataset.view);
  });
}

function switchView(viewId) {
  state.currentView = viewId;
  $$('.view').forEach(v => v.classList.add('hidden'));
  $$('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.view === viewId));
  const pane = document.querySelector(`[data-view-pane="${viewId}"]`);
  if (!pane) return;
  pane.classList.remove('hidden');

  // Cargar datos de la vista
  if (viewId === 'mentor-alumnos')  loadMentorAlumnos();
  if (viewId === 'admin-alumnos')   loadAdminAlumnos();
  if (viewId === 'admin-mentores')  loadAdminMentores();
  if (viewId === 'super-usuarios')  loadSuperUsuarios();
}

/* ═══════════════════════════════════════════════════════════════
   8. VISTA MENTOR · "Mis alumnos"
   El mentor ve SOLO sus alumnos asignados (RLS lo garantiza).
═══════════════════════════════════════════════════════════════ */

async function loadMentorAlumnos() {
  const grid = $('cards-grid');
  $('loading-state')?.classList.remove('hidden');
  $('empty-state')?.classList.add('hidden');

  const { data, error } = await db
    .from('alumnos')
    .select('*')
    .order('created_at', { ascending: false });

  $('loading-state')?.classList.add('hidden');

  if (error) { toast('Error al cargar alumnos', 'error'); return; }
  state.mentorAlumnos = data || [];
  renderMentorAlumnos();
}

function renderMentorAlumnos() {
  const grid = $('cards-grid');
  // limpiar excepto loading/empty
  $$('.alumno-mentor-card', grid).forEach(n => n.remove());

  let list = state.mentorAlumnos.slice();

  // Filtros
  const f = state.mentorFilter;
  if (f === 'activa')        list = list.filter(a => a.activa && !a.baja);
  if (f === 'alerta')        list = list.filter(a => !a.baja && a.fecha_ultimo && diffDays(a.fecha_ultimo) > 14);
  if (f === 'respondio-si')  list = list.filter(a => a.respondio === 'Sí' && !a.baja);
  if (f === 'respondio-no')  list = list.filter(a => a.respondio === 'No' && !a.baja);
  if (f === 'baja')          list = list.filter(a => a.baja);
  if (f === 'all')           list = list.filter(a => !a.baja);

  // Búsqueda
  if (state.mentorSearch) {
    const q = state.mentorSearch.toLowerCase();
    list = list.filter(a =>
      [a.nombre, a.apellido, a.telefono, a.inquietudes, a.seguimiento]
        .filter(Boolean).some(v => v.toLowerCase().includes(q))
    );
  }

  // Ordenamiento
  if (state.mentorSort === 'nombre')   list.sort((a,b) => (a.nombre||'').localeCompare(b.nombre||''));
  if (state.mentorSort === 'ultimo')   list.sort((a,b) => (b.fecha_ultimo||'').localeCompare(a.fecha_ultimo||''));
  if (state.mentorSort === 'reciente') list.sort((a,b) => (b.created_at||'').localeCompare(a.created_at||''));

  // Stats
  const all = state.mentorAlumnos.filter(a => !a.baja);
  $('stat-total').textContent  = all.length;
  $('stat-activa').textContent = all.filter(a => a.activa).length;
  $('stat-alerta').textContent = all.filter(a => a.fecha_ultimo && diffDays(a.fecha_ultimo) > 14).length;
  $('stat-baja').textContent   = state.mentorAlumnos.filter(a => a.baja).length;

  if (!list.length) {
    $('empty-state').classList.remove('hidden');
    return;
  }
  $('empty-state').classList.add('hidden');

  for (const a of list) {
    grid.insertAdjacentHTML('beforeend', renderMentorCard(a));
  }
  $$('.alumno-mentor-card', grid).forEach(card => {
    card.onclick = () => openAlumnoForm(card.dataset.id);
  });
}

function renderMentorCard(a) {
  const dias = a.fecha_ultimo ? diffDays(a.fecha_ultimo) : null;
  const alerta = dias !== null && dias > 14;
  return `
    <article class="alumno-card alumno-mentor-card" data-id="${a.id}">
      <div class="alumno-card-head">
        <span class="alumno-card-name">${escapeHtml(a.nombre)} ${escapeHtml(a.apellido)}</span>
        ${a.baja
          ? '<span class="alumno-card-tag tag-baja">baja</span>'
          : a.activa
            ? '<span class="alumno-card-tag tag-asignado">activa</span>'
            : '<span class="alumno-card-tag tag-sin">pausa</span>'}
      </div>
      <div class="alumno-card-meta">
        ${a.telefono ? `📞 ${escapeHtml(a.telefono)}<br/>` : ''}
        Último contacto: <strong>${formatDate(a.fecha_ultimo)}</strong>
        ${alerta ? ' · <span style="color:#C4825A">⚠ ' + dias + ' días</span>' : ''}
        ${a.respondio ? `<br/>Respondió: <strong>${escapeHtml(a.respondio)}</strong>` : ''}
      </div>
    </article>`;
}

// Eventos de los chips y búsqueda (mentor)
$$('[data-view-pane="mentor-alumnos"] .chip').forEach(chip => {
  chip.onclick = () => {
    $$('[data-view-pane="mentor-alumnos"] .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    state.mentorFilter = chip.dataset.filter;
    renderMentorAlumnos();
  };
});
$('search-input').addEventListener('input', e => {
  state.mentorSearch = e.target.value;
  renderMentorAlumnos();
});
$('sort-select').addEventListener('change', e => {
  state.mentorSort = e.target.value;
  renderMentorAlumnos();
});

/* ═══════════════════════════════════════════════════════════════
   9. VISTA ADMIN · "Alumnos"
═══════════════════════════════════════════════════════════════ */

async function loadAdminAlumnos() {
  // Cargamos alumnos + perfiles de mentores en paralelo
  const [alRes, mRes] = await Promise.all([
    db.from('alumnos').select('*').order('created_at', { ascending: false }),
    db.from('profiles').select('id,nombre,apellido,email').eq('rol','mentor').eq('activo', true)
  ]);

  if (alRes.error) { toast('Error al cargar alumnos','error'); return; }
  state.adminAlumnos  = alRes.data || [];
  state.adminMentores = mRes.data || [];   // se usa también para el select de asignación
  renderAdminAlumnos();
}

function renderAdminAlumnos() {
  const grid = $('admin-alumnos-grid');
  grid.innerHTML = '';

  // Mapa id→mentor
  const mentorMap = new Map(state.adminMentores.map(m => [m.id, m]));

  let list = state.adminAlumnos.slice();
  const f = state.adminAlumnoFilter;
  if (f === 'asignados')   list = list.filter(a => a.mentor_id && !a.baja);
  if (f === 'sin-asignar') list = list.filter(a => !a.mentor_id && !a.baja);
  if (f === 'baja')        list = list.filter(a => a.baja);
  if (f === 'all')         list = list.filter(a => !a.baja);

  if (state.adminAlumnoSearch) {
    const q = state.adminAlumnoSearch.toLowerCase();
    list = list.filter(a => {
      const m = mentorMap.get(a.mentor_id);
      const mentorStr = m ? `${m.nombre||''} ${m.apellido||''} ${m.email||''}` : '';
      return [a.nombre,a.apellido,a.telefono,mentorStr].filter(Boolean)
        .some(v => v.toLowerCase().includes(q));
    });
  }

  // Stats
  $('adm-stat-total').textContent      = state.adminAlumnos.filter(a => !a.baja).length;
  $('adm-stat-asignados').textContent  = state.adminAlumnos.filter(a => a.mentor_id && !a.baja).length;
  $('adm-stat-sin').textContent        = state.adminAlumnos.filter(a => !a.mentor_id && !a.baja).length;
  $('adm-stat-bajas').textContent      = state.adminAlumnos.filter(a => a.baja).length;

  if (!list.length) {
    grid.innerHTML = '<div class="empty-state"><span>🌿</span><p>No hay alumnos en este filtro.</p></div>';
    return;
  }

  for (const a of list) {
    const m = mentorMap.get(a.mentor_id);
    const mentorTxt = m ? fullName(m) : 'Sin asignar';
    const tag = a.baja
      ? '<span class="alumno-card-tag tag-baja">baja</span>'
      : (a.mentor_id
          ? '<span class="alumno-card-tag tag-asignado">asignado</span>'
          : '<span class="alumno-card-tag tag-sin">sin mentor</span>');
    grid.insertAdjacentHTML('beforeend', `
      <article class="alumno-card admin-alumno-card" data-id="${a.id}">
        <div class="alumno-card-head">
          <span class="alumno-card-name">${escapeHtml(a.nombre)} ${escapeHtml(a.apellido)}</span>
          ${tag}
        </div>
        <div class="alumno-card-meta">
          Mentor: <strong>${escapeHtml(mentorTxt)}</strong>
          ${a.telefono ? '<br/>📞 ' + escapeHtml(a.telefono) : ''}
          <br/>Creado: <strong>${formatDate(a.created_at?.slice(0,10))}</strong>
        </div>
      </article>
    `);
  }

  $$('.admin-alumno-card', grid).forEach(card => {
    card.onclick = () => openAlumnoForm(card.dataset.id);
  });
}

$$('#adm-filter-chips .chip').forEach(chip => {
  chip.onclick = () => {
    $$('#adm-filter-chips .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    state.adminAlumnoFilter = chip.dataset.filter;
    renderAdminAlumnos();
  };
});
$('adm-search-alumnos').addEventListener('input', e => {
  state.adminAlumnoSearch = e.target.value;
  renderAdminAlumnos();
});
$('btn-admin-new-alumno').onclick = () => openAlumnoForm(null);

/* ═══════════════════════════════════════════════════════════════
   10. MODAL · Crear / Editar alumno (compartido admin + mentor)
       RLS decide qué puede modificar cada rol.
═══════════════════════════════════════════════════════════════ */

function openAlumnoForm(alumnoId) {
  const isMentor = state.profile.rol === 'mentor';
  const isAdmin  = state.profile.rol === 'admin' || state.profile.rol === 'super_admin';

  $('modal-form').classList.remove('hidden');
  $('form-id').value = alumnoId || '';
  $('modal-title').textContent = alumnoId ? 'Editar alumno' : 'Nuevo alumno';

  // Cargar select de mentores (visible y editable sólo para admin)
  const sel = $('form-mentor');
  sel.innerHTML = '<option value="">— Sin asignar —</option>';
  const mentoresFuente = isAdmin ? state.adminMentores : [];
  mentoresFuente.forEach(m => {
    sel.insertAdjacentHTML('beforeend',
      `<option value="${m.id}">${escapeHtml(fullName(m))}</option>`);
  });
  $('form-mentor-wrap').style.display = isAdmin ? '' : 'none';

  if (alumnoId) {
    // Buscar el alumno en estado (puede venir de cualquier vista)
    const pool = isAdmin ? state.adminAlumnos : state.mentorAlumnos;
    const a = pool.find(x => String(x.id) === String(alumnoId));
    if (!a) { toast('No se encontró el alumno','error'); return; }

    $('form-nombre').value      = a.nombre || '';
    $('form-apellido').value    = a.apellido || '';
    $('form-telefono').value    = a.telefono || '';
    $('form-email').value       = a.email || '';
    $('form-fecha-primer').value= a.fecha_primer || '';
    $('form-fecha-ultimo').value= a.fecha_ultimo || '';
    $('form-respondio').value   = a.respondio || '';
    $('form-tipo-contacto').value = a.tipo_contacto || '';
    $('form-activa').checked    = !!a.activa;
    $('form-inquietudes').value = a.inquietudes || '';
    $('form-seguimiento').value = a.seguimiento || '';
    if (isAdmin) $('form-mentor').value = a.mentor_id || '';
  } else {
    ['form-nombre','form-apellido','form-telefono','form-email',
     'form-fecha-primer','form-fecha-ultimo','form-respondio',
     'form-tipo-contacto','form-inquietudes','form-seguimiento']
      .forEach(id => $(id).value = '');
    $('form-activa').checked = true;
    $('form-mentor').value = '';
  }
}

$('modal-close').onclick = () => $('modal-form').classList.add('hidden');
$('btn-cancel').onclick  = () => $('modal-form').classList.add('hidden');

$('btn-save').onclick = async () => {
  const isAdmin = state.profile.rol === 'admin' || state.profile.rol === 'super_admin';
  const id = $('form-id').value || null;

  const payload = {
    nombre:        $('form-nombre').value.trim(),
    apellido:      $('form-apellido').value.trim(),
    telefono:      $('form-telefono').value.trim() || null,
    email:         $('form-email').value.trim()    || null,
    fecha_primer:  $('form-fecha-primer').value || null,
    fecha_ultimo:  $('form-fecha-ultimo').value || null,
    respondio:     $('form-respondio').value      || null,
    tipo_contacto: $('form-tipo-contacto').value  || null,
    activa:        $('form-activa').checked,
    inquietudes:   $('form-inquietudes').value    || null,
    seguimiento:   $('form-seguimiento').value    || null,
  };

  if (!payload.nombre || !payload.apellido) {
    toast('Nombre y apellido son obligatorios','error'); return;
  }
  if (isAdmin) {
    payload.mentor_id = $('form-mentor').value || null;
  }

  const btn = $('btn-save'); btn.disabled = true; btn.textContent = 'Guardando...';
  let resp;
  if (id) {
    resp = await db.from('alumnos').update(payload).eq('id', id);
  } else {
    payload.created_by = state.profile.id;
    resp = await db.from('alumnos').insert(payload);
  }
  btn.disabled = false; btn.textContent = 'Guardar';

  if (resp.error) {
    console.error(resp.error);
    toast('Error: ' + resp.error.message, 'error');
    return;
  }
  toast(id ? 'Alumno actualizado' : 'Alumno creado');
  $('modal-form').classList.add('hidden');

  // Refrescar la vista correspondiente
  if (state.currentView === 'mentor-alumnos') loadMentorAlumnos();
  if (state.currentView === 'admin-alumnos')  loadAdminAlumnos();
};

/* ═══════════════════════════════════════════════════════════════
   11. VISTA ADMIN · "Mentores"
═══════════════════════════════════════════════════════════════ */

async function loadAdminMentores() {
  // Mentores + conteo de alumnos por mentor
  const [mRes, aRes] = await Promise.all([
    db.from('profiles')
      .select('id,nombre,apellido,email,avatar_url,activo')
      .eq('rol','mentor')
      .order('created_at', { ascending: false }),
    db.from('alumnos').select('id, mentor_id, baja')
  ]);

  if (mRes.error) { toast('Error al cargar mentores','error'); return; }
  state.adminMentores = mRes.data || [];

  // Calcular alumnos activos por mentor
  const counts = new Map();
  (aRes.data || []).forEach(a => {
    if (!a.mentor_id || a.baja) return;
    counts.set(a.mentor_id, (counts.get(a.mentor_id) || 0) + 1);
  });

  renderAdminMentores(counts);
}

function renderAdminMentores(counts) {
  const grid = $('admin-mentores-grid');
  grid.innerHTML = '';

  let list = state.adminMentores.slice();
  if (state.adminMentorSearch) {
    const q = state.adminMentorSearch.toLowerCase();
    list = list.filter(m => [m.nombre,m.apellido,m.email]
      .filter(Boolean).some(v => v.toLowerCase().includes(q)));
  }

  if (!list.length) {
    grid.innerHTML = '<div class="empty-state"><span>🌿</span><p>No hay mentores registrados.</p></div>';
    return;
  }

  for (const m of list) {
    const count = counts.get(m.id) || 0;
    const avatarHtml = m.avatar_url
      ? `<img class="mentor-avatar" src="${escapeHtml(m.avatar_url)}" alt="" />`
      : `<div class="mentor-avatar-placeholder">${escapeHtml(initials(m))}</div>`;
    grid.insertAdjacentHTML('beforeend', `
      <article class="mentor-card" data-id="${m.id}">
        ${avatarHtml}
        <div class="mentor-card-name">${escapeHtml(fullName(m))}</div>
        <div class="mentor-card-email">${escapeHtml(m.email)}</div>
        <div class="mentor-card-stats">
          <div><strong>${count}</strong>alumnos</div>
        </div>
        <div class="mentor-card-actions">
          <button class="btn-secondary btn-pdf-mentor" data-mentor="${m.id}">Informe PDF</button>
        </div>
      </article>
    `);
  }

  $$('.btn-pdf-mentor', grid).forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      exportarInformeMentor(btn.dataset.mentor);
    };
  });
}

$('adm-search-mentores').addEventListener('input', e => {
  state.adminMentorSearch = e.target.value;
  loadAdminMentores();   // recargamos para recalcular counts (barato porque está cacheado)
});

/* ═══════════════════════════════════════════════════════════════
   12. INFORME PDF DEL MENTOR (formato actual de la app)
═══════════════════════════════════════════════════════════════ */

async function exportarInformeMentor(mentorId) {
  toast('Generando informe...');
  const [mRes, aRes] = await Promise.all([
    db.from('profiles').select('nombre,apellido,email').eq('id', mentorId).single(),
    db.from('alumnos').select('*').eq('mentor_id', mentorId).order('apellido')
  ]);
  if (mRes.error || aRes.error) { toast('Error al generar PDF','error'); return; }

  const mentor = mRes.data;
  const alumnos = aRes.data || [];

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  // Encabezado
  doc.setFont('helvetica','bold'); doc.setFontSize(18);
  doc.setTextColor('#2C2417');
  doc.text('Holos Mentorías — Informe del mentor', 40, 50);

  doc.setFont('helvetica','normal'); doc.setFontSize(11);
  doc.setTextColor('#7A6E62');
  doc.text(`Mentor: ${fullName(mentor)} (${mentor.email})`, 40, 70);
  doc.text(`Generado: ${new Date().toLocaleString('es-AR')}`, 40, 86);
  doc.text(`Alumnos asignados: ${alumnos.length}`, 40, 102);

  // Tabla resumen
  const rows = alumnos.map(a => [
    `${a.apellido}, ${a.nombre}`,
    a.telefono || '—',
    formatDate(a.fecha_primer),
    formatDate(a.fecha_ultimo),
    a.respondio || '—',
    a.activa ? 'Activa' : (a.baja ? 'Baja' : 'Pausa')
  ]);
  doc.autoTable({
    startY: 120,
    head: [['Alumno','Teléfono','1er contacto','Últ. contacto','Respondió','Estado']],
    body: rows,
    headStyles: { fillColor: [107,154,100], textColor: 255 },
    styles: { fontSize: 9, cellPadding: 5 },
    alternateRowStyles: { fillColor: [250,247,242] },
  });

  // Detalle por alumno (inquietudes + seguimiento)
  let y = doc.lastAutoTable.finalY + 30;
  doc.setFontSize(14); doc.setFont('helvetica','bold'); doc.setTextColor('#2C2417');
  doc.text('Detalle por alumno', 40, y); y += 20;

  for (const a of alumnos) {
    if (y > 740) { doc.addPage(); y = 50; }
    doc.setFontSize(12); doc.setFont('helvetica','bold'); doc.setTextColor('#4E7848');
    doc.text(`${a.apellido}, ${a.nombre}`, 40, y); y += 16;
    doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor('#2C2417');

    if (a.inquietudes) {
      doc.setFont('helvetica','bold'); doc.text('Inquietudes:', 40, y); y += 14;
      doc.setFont('helvetica','normal');
      const lines = doc.splitTextToSize(a.inquietudes, 515);
      doc.text(lines, 40, y); y += lines.length * 12 + 6;
    }
    if (a.seguimiento) {
      if (y > 740) { doc.addPage(); y = 50; }
      doc.setFont('helvetica','bold'); doc.text('Seguimiento:', 40, y); y += 14;
      doc.setFont('helvetica','normal');
      const lines = doc.splitTextToSize(a.seguimiento, 515);
      doc.text(lines, 40, y); y += lines.length * 12 + 12;
    }
    y += 6;
  }

  doc.save(`informe-${mentor.apellido || 'mentor'}-${new Date().toISOString().slice(0,10)}.pdf`);
  toast('PDF generado ✓');
}

// Botón PDF de la vista del propio mentor (informe propio)
$('btn-export-pdf').onclick = () => exportarInformeMentor(state.profile.id);

/* ═══════════════════════════════════════════════════════════════
   13. VISTA SUPER ADMIN · "Usuarios"
═══════════════════════════════════════════════════════════════ */

async function loadSuperUsuarios() {
  const { data, error } = await db
    .from('profiles')
    .select('id,email,rol,nombre,apellido,avatar_url,activo,created_at')
    .order('created_at', { ascending: false });

  if (error) { toast('Error al cargar usuarios','error'); return; }
  state.superUsers = data || [];
  renderSuperUsuarios();
}

function renderSuperUsuarios() {
  const list = $('super-users-list');
  list.innerHTML = '';

  let rows = state.superUsers.slice();
  const f = state.superFilter;
  if (f === 'super_admin') rows = rows.filter(u => u.rol === 'super_admin');
  if (f === 'admin')       rows = rows.filter(u => u.rol === 'admin');
  if (f === 'mentor')      rows = rows.filter(u => u.rol === 'mentor');
  if (f === 'sin-rol')     rows = rows.filter(u => !u.rol);

  if (state.superSearch) {
    const q = state.superSearch.toLowerCase();
    rows = rows.filter(u => [u.nombre,u.apellido,u.email]
      .filter(Boolean).some(v => v.toLowerCase().includes(q)));
  }

  // Stats
  $('sup-stat-total').textContent      = state.superUsers.length;
  $('sup-stat-admins').textContent     = state.superUsers.filter(u => u.rol === 'admin').length;
  $('sup-stat-mentores').textContent   = state.superUsers.filter(u => u.rol === 'mentor').length;
  $('sup-stat-pendientes').textContent = state.superUsers.filter(u => !u.rol).length;

  if (!rows.length) {
    list.innerHTML = '<div class="empty-state"><span>🌿</span><p>No hay usuarios en este filtro.</p></div>';
    return;
  }

  for (const u of rows) {
    const av = u.avatar_url
      ? `<img class="user-row-avatar" src="${escapeHtml(u.avatar_url)}" alt=""/>`
      : `<div class="user-row-avatar-placeholder">${escapeHtml(initials(u))}</div>`;
    const isSelf = u.id === state.profile.id;
    list.insertAdjacentHTML('beforeend', `
      <div class="user-row ${u.activo ? '' : 'inactive'}" data-id="${u.id}">
        ${av}
        <div class="user-row-info">
          <div class="user-row-name">${escapeHtml(fullName(u))}${isSelf ? ' <span class="role-badge role-super">vos</span>' : ''}</div>
          <div class="user-row-email">${escapeHtml(u.email)}</div>
        </div>
        <div class="user-row-controls">
          <select class="user-rol-select" data-id="${u.id}" ${isSelf ? 'disabled' : ''}>
            <option value=""            ${!u.rol            ? 'selected':''}>— Sin rol —</option>
            <option value="mentor"      ${u.rol==='mentor'  ? 'selected':''}>Mentor</option>
            <option value="admin"       ${u.rol==='admin'   ? 'selected':''}>Admin</option>
            <option value="super_admin" ${u.rol==='super_admin' ? 'selected':''}>Super admin</option>
          </select>
          <button class="btn-mini-danger btn-toggle-active" data-id="${u.id}" ${isSelf ? 'disabled' : ''} title="${u.activo ? 'Desactivar' : 'Activar'}">
            ${u.activo ? 'Desactivar' : 'Activar'}
          </button>
        </div>
      </div>
    `);
  }

  // Bindings
  $$('.user-rol-select', list).forEach(sel => {
    sel.onchange = () => changeRole(sel.dataset.id, sel.value || null);
  });
  $$('.btn-toggle-active', list).forEach(btn => {
    btn.onclick = () => toggleActive(btn.dataset.id);
  });
}

$$('#sup-filter-chips .chip').forEach(chip => {
  chip.onclick = () => {
    $$('#sup-filter-chips .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    state.superFilter = chip.dataset.filter;
    renderSuperUsuarios();
  };
});
$('sup-search-users').addEventListener('input', e => {
  state.superSearch = e.target.value;
  renderSuperUsuarios();
});

/** Llama a la Edge Function. Pasa el JWT actual para que valide identidad server-side. */
async function callAdminFn(payload) {
  const { data: { session } } = await db.auth.getSession();
  if (!session) throw new Error('Sin sesión');
  const res = await fetch(EDGE_FN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': CFG.SUPABASE_ANON_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

async function changeRole(userId, newRole) {
  try {
    await callAdminFn({ action: 'assign_role', user_id: userId, rol: newRole });
    toast('Rol actualizado ✓');
    loadSuperUsuarios();
  } catch (e) {
    toast('Error: ' + e.message, 'error');
    loadSuperUsuarios();  // refrescar para revertir el select visualmente
  }
}

async function toggleActive(userId) {
  const u = state.superUsers.find(x => x.id === userId);
  if (!u) return;
  if (!confirm(`¿${u.activo ? 'Desactivar' : 'Activar'} a ${fullName(u)}?`)) return;
  try {
    await callAdminFn({ action: 'set_active', user_id: userId, activo: !u.activo });
    toast('Usuario actualizado ✓');
    loadSuperUsuarios();
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
}

/* ═══════════════════════════════════════════════════════════════
   14. MODAL · Mi perfil (todos los roles)
═══════════════════════════════════════════════════════════════ */

$('btn-profile').onclick = () => {
  $('profile-nombre').value   = state.profile.nombre   || '';
  $('profile-apellido').value = state.profile.apellido || '';
  $('profile-email').value    = state.profile.email;
  $('profile-error').classList.add('hidden');
  $('profile-ok').classList.add('hidden');

  const prev = $('avatar-preview');
  prev.innerHTML = state.profile.avatar_url
    ? `<img src="${escapeHtml(state.profile.avatar_url)}" alt=""/>`
    : `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
  $('profile-avatar-remove').classList.toggle('hidden', !state.profile.avatar_url);
  $('modal-profile').classList.remove('hidden');
};
$('profile-close').onclick  = () => $('modal-profile').classList.add('hidden');
$('profile-cancel').onclick = () => $('modal-profile').classList.add('hidden');

let pendingAvatarBlob = null;
$('profile-avatar-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const blob = await compressAvatar(file);
    pendingAvatarBlob = blob;
    const dataUrl = URL.createObjectURL(blob);
    $('avatar-preview').innerHTML = `<img src="${dataUrl}" alt=""/>`;
    $('profile-ok').textContent = `Imagen lista (${Math.round(blob.size/1024)} KB)`;
    $('profile-ok').classList.remove('hidden');
  } catch (err) {
    $('profile-error').textContent = err.message;
    $('profile-error').classList.remove('hidden');
  }
});

$('profile-avatar-remove').onclick = async () => {
  if (!confirm('¿Quitar tu foto de perfil?')) return;
  // Eliminar de storage si existe
  const path = `${state.profile.id}/avatar.webp`;
  await db.storage.from('avatars').remove([path]);
  await db.from('profiles').update({ avatar_url: null }).eq('id', state.profile.id);
  state.profile.avatar_url = null;
  pendingAvatarBlob = null;
  renderHeader();
  $('avatar-preview').innerHTML = `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
  $('profile-avatar-remove').classList.add('hidden');
  toast('Foto eliminada');
};

$('profile-save').onclick = async () => {
  $('profile-error').classList.add('hidden');
  $('profile-ok').classList.add('hidden');
  const btn = $('profile-save'); btn.disabled = true; btn.textContent = 'Guardando...';

  try {
    let avatar_url = state.profile.avatar_url;

    // 1) Subir avatar si hay uno pendiente
    if (pendingAvatarBlob) {
      const path = `${state.profile.id}/avatar.webp`;
      const { error: upErr } = await db.storage
        .from('avatars')
        .upload(path, pendingAvatarBlob, {
          contentType: 'image/webp',
          upsert: true,
          cacheControl: '3600'
        });
      if (upErr) throw upErr;

      // URL pública con cache-busting para forzar refresh
      const { data: pub } = db.storage.from('avatars').getPublicUrl(path);
      avatar_url = `${pub.publicUrl}?v=${Date.now()}`;
    }

    // 2) Actualizar profile
    const { error: updErr } = await db.from('profiles').update({
      nombre:   $('profile-nombre').value.trim()   || null,
      apellido: $('profile-apellido').value.trim() || null,
      avatar_url
    }).eq('id', state.profile.id);
    if (updErr) throw updErr;

    state.profile.nombre   = $('profile-nombre').value.trim();
    state.profile.apellido = $('profile-apellido').value.trim();
    state.profile.avatar_url = avatar_url;
    pendingAvatarBlob = null;

    renderHeader();
    toast('Perfil actualizado ✓');
    $('modal-profile').classList.add('hidden');
  } catch (e) {
    $('profile-error').textContent = e.message;
    $('profile-error').classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar';
  }
};

/* ═══════════════════════════════════════════════════════════════
   15. BOOT
═══════════════════════════════════════════════════════════════ */

bootstrapSession();

// Reaccionar a cambios de sesión externos (logout en otra pestaña, etc.)
db.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') {
    state.session = null; state.profile = null;
    showScreen('login-screen');
    showLoginPanel('panel-login');
  }
});
