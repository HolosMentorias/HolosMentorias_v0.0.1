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
  mentorViewMode: 'grid',     // 'grid' | 'list'
  mentorPage: 1,
  adminAlumnoFilter: 'all',
  adminAlumnoSearch: '',
  adminAlumnoMentor: '',      // mentor id, '' = todos
  adminAlumnoSort: 'reciente',
  adminAlumnoViewMode: 'grid',
  adminAlumnoPage: 1,
  adminMentorSearch: '',
  adminUsers: [],
  adminUsersFilter: 'all',
  adminUsersSearch: '',
  superFilter: 'all',
  superSearch: '',
};

const PAGE_SIZE = 50;          // alumnos por página

/* ─── Íconos de crecimiento ──────────────────────────────────
   Nivel 0 — Sin contacto (semilla sin brotar)
   Nivel 1 — Semilla: tiene fecha de primer contacto
   Nivel 2 — Tallo: primer y último contacto son distintos (≥2 contactos)
   Nivel 3 — Árbol: hubo videollamada o llamada telefónica
   Baja    — Planta seca
─────────────────────────────────────────────────────────────── */

function getIconoCrecimiento(a) {
  // Baja — planta seca
  if (a.baja || a.eliminado) {
    return `<div class="crecimiento-icon nivel-baja" title="Dado de baja">
      <svg viewBox="0 0 40 56" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 52 Q20 38 20 28" stroke="#A89080" stroke-width="2.5" stroke-linecap="round"/>
        <path d="M20 38 Q13 36 10 40" stroke="#A89080" stroke-width="2" stroke-linecap="round"/>
        <path d="M20 32 Q27 30 29 34" stroke="#A89080" stroke-width="2" stroke-linecap="round"/>
        <path d="M10 40 Q8 44 11 46 Q12 42 10 40Z" fill="#C4B8A8" opacity=".7"/>
        <path d="M29 34 Q32 37 30 40 Q28 37 29 34Z" fill="#C4B8A8" opacity=".7"/>
        <ellipse cx="16" cy="50" rx="4" ry="2" fill="#C4B8A8" opacity=".5" transform="rotate(-15 16 50)"/>
        <ellipse cx="20" cy="52" rx="9" ry="3" fill="#BBA990" opacity=".4"/>
      </svg>
    </div>`;
  }
  // Nivel 3 — Árbol: videollamada realizada O llamada telefónica
  const tipoContacto = (a.tipo_contacto || '').toLowerCase();
  if (a.videollamada || tipoContacto.includes('videollamada') || tipoContacto.includes('llamada')) {
    return `<div class="crecimiento-icon nivel-3" title="Videollamada o llamada realizada">
      <svg viewBox="0 0 40 56" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="17" y="34" width="6" height="18" rx="2" fill="#8B6340"/>
        <ellipse cx="20" cy="34" rx="13" ry="10" fill="#4A8F3F"/>
        <ellipse cx="20" cy="24" rx="10" ry="8" fill="#5AA64D"/>
        <ellipse cx="20" cy="16" rx="7" ry="7" fill="#6BBF5E"/>
        <ellipse cx="17" cy="13" rx="2.5" ry="2" fill="#8FD97F" opacity=".6"/>
      </svg>
    </div>`;
  }
  // Nivel 2 — Tallo: tiene primer Y último contacto, y son distintos (≥2 contactos)
  if (a.fecha_primer && a.fecha_ultimo && a.fecha_primer !== a.fecha_ultimo) {
    return `<div class="crecimiento-icon nivel-2" title="Segundo contacto realizado">
      <svg viewBox="0 0 40 56" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 52 Q20 30 20 18" stroke="#6B9A64" stroke-width="2.5" stroke-linecap="round"/>
        <path d="M20 32 Q10 26 11 18 Q18 22 20 32Z" fill="#8FBF84"/>
        <path d="M20 26 Q30 20 29 12 Q22 16 20 26Z" fill="#6B9A64"/>
        <circle cx="20" cy="16" r="3.5" fill="#A8D49E"/>
      </svg>
    </div>`;
  }
  // Nivel 1 — Semilla: tiene fecha de primer contacto
  if (a.fecha_primer) {
    return `<div class="crecimiento-icon nivel-1" title="Primer contacto enviado">
      <svg viewBox="0 0 40 56" fill="none" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="20" cy="46" rx="10" ry="4" fill="#C4A882" opacity=".5"/>
        <ellipse cx="20" cy="38" rx="7" ry="9" fill="#8B6340"/>
        <path d="M20 30 Q24 35 20 40 Q16 35 20 30Z" fill="#C4925A" opacity=".7"/>
        <path d="M20 29 Q20 24 20 22" stroke="#6B9A64" stroke-width="2" stroke-linecap="round"/>
        <path d="M20 25 Q16 22 15 19" stroke="#6B9A64" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </div>`;
  }
  // Nivel 0 — Sin contacto
  return `<div class="crecimiento-icon nivel-0" title="Sin contacto iniciado">
    <svg viewBox="0 0 40 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="20" cy="46" rx="10" ry="4" fill="#D8D2C9" opacity=".4"/>
      <ellipse cx="20" cy="40" rx="6" ry="7" fill="#D8D2C9" opacity=".5"/>
    </svg>
  </div>`;
}

function getNivelLabel(a) {
  const tipoContacto = (a.tipo_contacto || '').toLowerCase();
  if (a.baja || a.eliminado) return { label: 'Baja', cls: 'nivel-baja-label' };
  if (a.videollamada || tipoContacto.includes('videollamada') || tipoContacto.includes('llamada'))
    return { label: 'Árbol · Llamada realizada', cls: 'nivel-3-label' };
  if (a.fecha_primer && a.fecha_ultimo && a.fecha_primer !== a.fecha_ultimo)
    return { label: 'Tallo · 2 contactos', cls: 'nivel-2-label' };
  if (a.fecha_primer)
    return { label: 'Semilla · Primer contacto', cls: 'nivel-1-label' };
  return { label: 'Sin contacto', cls: 'nivel-0-label' };
}

// Genera el mensaje de bienvenida con el nombre del mentor insertado.
// Si el mentor ya tiene uno guardado, lo usa; si no, genera uno default.
function getMensajeBienvenida(profile, alumno) {
  const nombreMentor = fullName(profile) || 'tu mentor/a';
  const base = profile.mensaje_bienvenida ||
    `¡Hola! 👋 Mi nombre es ${nombreMentor}, soy Counselor egresada de Holos Capital Counseling.\nMe pongo en contacto porque en esta etapa voy a acompañarte como tu mentora. 🌱\nLa mentoría es un espacio pensado para vos: para compartir dudas, orientarte en el camino y acompañarte desde la experiencia de haber transitado este mismo recorrido.\nEstoy disponible para lo que necesites, ya sea consultas académicas, orientación sobre la carrera o simplemente charlar sobre el proceso. No dudes en escribirme cuando quieras.\n¡Bienvenido/a a esta etapa! Estoy muy contenta de acompañarte. 😊\n${nombreMentor}\nCounselor — Holos Capital Counseling`;
  return base;
}

function formatPhone(tel) {
  if (!tel) return '';
  return tel.replace(/\D/g, '');
}

function encodeForWhatsApp(msg) {
  return encodeURIComponent(msg);
}

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

/** Renderiza una paginación simple: « 1 2 ... 5 ». Devuelve el slice visible. */
function paginate(list, page, containerId, onPageChange) {
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const slice = list.slice(start, start + PAGE_SIZE);

  const cont = document.getElementById(containerId);
  if (cont) {
    if (totalPages <= 1) {
      cont.innerHTML = '';
    } else {
      const btns = [];
      btns.push(`<button ${safePage === 1 ? 'disabled' : ''} data-page="${safePage-1}">‹</button>`);
      // Páginas a mostrar: siempre 1, vecinas de actual, y última
      const pages = new Set([1, totalPages, safePage, safePage-1, safePage+1]);
      const visible = [...pages].filter(p => p >= 1 && p <= totalPages).sort((a,b)=>a-b);
      let prev = 0;
      for (const p of visible) {
        if (p - prev > 1) btns.push(`<span class="pag-info">…</span>`);
        btns.push(`<button class="${p === safePage ? 'active' : ''}" data-page="${p}">${p}</button>`);
        prev = p;
      }
      btns.push(`<button ${safePage === totalPages ? 'disabled' : ''} data-page="${safePage+1}">›</button>`);
      cont.innerHTML = btns.join('');
      cont.querySelectorAll('button[data-page]').forEach(b => {
        b.onclick = () => onPageChange(parseInt(b.dataset.page, 10));
      });
    }
  }
  return { slice, safePage, totalPages };
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
  ['panel-login','panel-registro','panel-reset','panel-nueva-pass']
    .forEach(p => $(p).classList.add('hidden'));
  $(panelId).classList.remove('hidden');
  ['login-error','reg-error','reg-ok','reset-error','reset-ok','nueva-pass-error','nueva-pass-ok']
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
  const nombre   = $('reg-nombre').value.trim();
  const apellido = $('reg-apellido').value.trim();
  const email    = $('reg-email').value.trim();
  const pass     = $('reg-password').value;
  const pass2    = $('reg-password2').value;
  const err = $('reg-error'); const ok = $('reg-ok');
  err.classList.add('hidden'); ok.classList.add('hidden');

  if (!nombre || !apellido)       { err.textContent = 'Nombre y apellido son obligatorios.'; err.classList.remove('hidden'); return; }
  if (!email || !pass || !pass2)  { err.textContent = 'Completá todos los campos.'; err.classList.remove('hidden'); return; }
  if (pass.length < 8)            { err.textContent = 'La contraseña debe tener al menos 8 caracteres.'; err.classList.remove('hidden'); return; }
  if (pass !== pass2)             { err.textContent = 'Las contraseñas no coinciden.'; err.classList.remove('hidden'); return; }

  const btn = $('btn-registro'); btn.disabled = true; btn.textContent = 'Creando...';
  const { data: signUpData, error } = await db.auth.signUp({
    email, password: pass,
    options: { data: { nombre, apellido } }
  });
  btn.disabled = false; btn.textContent = 'Crear cuenta';

  // Loguear siempre para diagnosticar
  console.log('[signUp] data:', signUpData, '| error:', error);

  if (error) {
    let msg = 'Error al crear la cuenta.';
    if (error.message.includes('already registered') || error.message.includes('already'))
      msg = 'Ese email ya tiene cuenta. Iniciá sesión.';
    else if (error.message.includes('Password should'))
      msg = 'La contraseña debe tener al menos 8 caracteres.';
    else if (error.message.includes('valid email'))
      msg = 'El email no es válido.';
    else if (error.message.includes('rate limit') || error.message.includes('email rate'))
      msg = 'Demasiados intentos. Esperá unos minutos y volvé a intentar.';
    else
      msg = error.message; // mostrar el error real para debug
    err.textContent = msg; err.classList.remove('hidden'); return;
  }

  // signUpData.user puede existir incluso sin error
  if (signUpData?.user?.identities?.length === 0) {
    // Usuario ya existía (Supabase a veces no lanza error en este caso)
    err.textContent = 'Ese email ya tiene cuenta. Iniciá sesión.';
    err.classList.remove('hidden'); return;
  }

  ok.textContent = '✓ Cuenta creada correctamente. Redirigiendo...';
  ok.classList.remove('hidden');
  ['reg-nombre','reg-apellido','reg-email','reg-password','reg-password2'].forEach(id => $(id).value = '');

  // Redirigir al login después de 1.5 segundos
  setTimeout(() => {
    ok.classList.add('hidden');
    showLoginPanel('panel-login');
    // Pre-cargar el email para que no lo tenga que tipear de nuevo
    $('login-email').value = email;
    $('login-password').focus();
  }, 1500);
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
  // Cerrar todos los canales de Realtime antes de desloguear
  if (chat.globalChannel) { db.removeChannel(chat.globalChannel); chat.globalChannel = null; }
  if (chat.realtimeChannel) { db.removeChannel(chat.realtimeChannel); chat.realtimeChannel = null; }
  await db.auth.signOut();
  state.session = null; state.profile = null;
  showScreen('login-screen');
  showLoginPanel('panel-login');
};
$('pending-logout').onclick = () => $('btn-logout').click();
$('pending-refresh').onclick = () => bootstrapSession();

// Pantalla bloqueado
$('blocked-logout').onclick = () => $('btn-logout').click();

// Pantalla pausado
$('paused-logout').onclick = () => $('btn-logout').click();

/* Chat embebido en la pantalla de pausa
   Reutiliza toda la lógica de chat existente pero apunta a los
   contenedores de la pantalla paused en lugar de los de la app. */
async function initPausedChat() {
  // Cargar admins disponibles para contactar
  const [peersRes, convRes] = await Promise.all([
    db.from('profiles')
      .select('id,email,nombre,apellido,avatar_url,rol')
      .eq('activo', true)
      .eq('rol', 'admin'),
    db.from('conversations')
      .select('id, admin_id, mentor_id, last_message_at')
      .eq('is_broadcast', false)
  ]);

  chat.peers         = peersRes.data || [];
  chat.conversations = convRes.data || [];

  const sidebarList = $('paused-chat-list');
  sidebarList.innerHTML = '';

  if (!chat.peers.length) {
    sidebarList.innerHTML = '<div class="empty-state" style="padding:20px"><p>No hay administradores disponibles.</p></div>';
    return;
  }

  const convByPeerId = new Map();
  chat.conversations.forEach(c => {
    if (c.admin_id) convByPeerId.set(c.admin_id, c);
  });

  // Calcular no leídos iniciales
  await refreshGlobalUnread('mentor');

  chat.peers
    .slice()
    .sort((a, b) => fullName(a).localeCompare(fullName(b)))
    .forEach(peer => {
      const conv    = convByPeerId.get(peer.id) || null;
      const unread  = conv ? (chat.unread[conv.id] || 0) : 0;
      const av = peer.avatar_url
        ? `<img class="chat-item-avatar" src="${escapeHtml(peer.avatar_url)}" alt=""/>`
        : `<div class="chat-item-avatar-placeholder">${escapeHtml(initials(peer))}</div>`;
      sidebarList.insertAdjacentHTML('beforeend', `
        <div class="chat-item" data-peer-id="${peer.id}">
          ${av}
          <div class="chat-item-info">
            <div class="chat-item-name">${escapeHtml(fullName(peer))}</div>
            <div class="chat-item-preview">${conv?.last_message_at ? formatRelative(conv.last_message_at) : 'Sin mensajes'}</div>
          </div>
          ${unread > 0 ? `<span class="chat-item-unread">${unread}</span>` : ''}
        </div>
      `);
    });

  $$('.chat-item', sidebarList).forEach(el => {
    el.onclick = async () => {
      $$('.chat-item', sidebarList).forEach(i => i.classList.remove('active'));
      el.classList.add('active');
      await openConversationInPanel(el.dataset.peerId, 'paused-chat-main');
    };
  });

  // Realtime para notificaciones mientras está en pausa
  startGlobalNotifications('mentor');
}

/* Abre conversación en un panel específico (reutilizable para paused) */
async function openConversationInPanel(peerId, panelId) {
  const peer = chat.peers.find(p => p.id === peerId);
  if (!peer) return;

  const admin_id  = peer.id;
  const mentor_id = state.profile.id;

  const { data: convId, error } = await db.rpc('get_or_create_conversation', {
    p_admin_id:  admin_id,
    p_mentor_id: mentor_id
  });
  if (error) { toast('No se pudo abrir el chat: ' + error.message, 'error'); return; }

  chat.active = { id: convId, peer };
  if (!chat.conversations.find(c => c.id === convId)) {
    chat.conversations.push({ id: convId, admin_id, mentor_id, last_message_at: null });
  }

  await loadMessages();

  const panel = $(panelId);
  const av = peer.avatar_url
    ? `<img class="chat-header-avatar" src="${escapeHtml(peer.avatar_url)}" alt=""/>`
    : `<div class="chat-header-avatar-placeholder">${escapeHtml(initials(peer))}</div>`;
  panel.innerHTML = `
    <div class="chat-header">
      ${av}
      <div class="chat-header-info">
        <div class="chat-header-name">${escapeHtml(fullName(peer))}</div>
        <div class="chat-header-sub">${escapeHtml(peer.email)}</div>
      </div>
    </div>
    <div class="chat-messages" id="chat-messages"></div>
    <div class="chat-composer">
      <textarea id="chat-input" rows="1" placeholder="Escribí un mensaje..."></textarea>
      <button id="chat-send" title="Enviar" aria-label="Enviar">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </button>
    </div>
  `;
  renderMessages();

  const ta = $('chat-input');
  ta.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('chat-send').click(); }
  });
  ta.focus();
  $('chat-send').onclick = () => sendMessage('mentor');
}

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
    .select('id,email,rol,nombre,apellido,avatar_url,activo,puede_ver_estadisticas,mensaje_bienvenida,estado_mentor,color_mentor')
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

  // Mentor bloqueado → pantalla idéntica a "pendiente"
  if (prof.rol === 'mentor' && prof.estado_mentor === 'bloqueado') {
    $('blocked-email').textContent = prof.email;
    showScreen('blocked-screen');
    return;
  }

  // Mentor pausado → pantalla con acceso solo a mensajes
  if (prof.rol === 'mentor' && prof.estado_mentor === 'pausado') {
    showScreen('paused-screen');
    initPausedChat();
    return;
  }

  // Con rol → renderizar app
  renderHeader();
  configureNavForRole(prof.rol);
  showScreen('app-screen');

  // Presencia en tiempo real: todos los roles se "anuncian" como
  // conectados; solo el super_admin consulta esa lista para verla.
  startPresenceTracking(prof);

  // Arrancar notificaciones globales de chat (activas toda la sesión,
  // independientemente de en qué pestaña esté el usuario)
  if (prof.rol !== 'super_admin') {
    const roleForChat = prof.rol; // 'admin' o 'mentor'
    startGlobalNotifications(roleForChat);
  }

  // Vista inicial según rol
  const defaultView = {
    super_admin: 'super-usuarios',
    admin:       'admin-alumnos',
    mentor:      'mentor-alumnos'
  }[prof.rol];
  switchView(defaultView);
}

function renderHeader() {
  const rolLabel = {
    super_admin: 'Super Admin',
    admin:       'Administrador',
    mentor:      'Mentor'
  }[state.profile.rol] || '';

  $('header-user').innerHTML = `
    <span class="header-user-name">${escapeHtml(fullName(state.profile))}</span>
    ${rolLabel ? `<span class="header-user-rol">${rolLabel}</span>` : ''}
  `;

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
    let visible =
      (rol === 'super_admin') ||
      (rol === 'admin' && reqRole === 'admin') ||
      (rol === 'mentor' && reqRole === 'mentor');

    if (tab.dataset.view === 'admin-estadisticas') {
      visible = (rol === 'super_admin') ||
                (rol === 'admin' && !!state.profile.puede_ver_estadisticas);
    }
    tab.classList.toggle('visible', visible);
  });

  $$('.nav-tab').forEach(tab => {
    tab.onclick = () => switchView(tab.dataset.view);
  });

  // Poblar el drawer mobile con los mismos tabs visibles
  buildMobileDrawer();

  // Hamburguesa
  $('nav-hamburger').onclick = () => openMobileDrawer();
  $('nav-drawer-close').onclick = () => closeMobileDrawer();
  $('nav-mobile-overlay').onclick = () => closeMobileDrawer();
}

function buildMobileDrawer() {
  const links = $('nav-mobile-links');
  links.innerHTML = '';
  $$('.nav-tab.visible').forEach(tab => {
    const btn = document.createElement('button');
    btn.className = 'nav-mobile-link' + (tab.classList.contains('active') ? ' active' : '');
    btn.dataset.view = tab.dataset.view;
    btn.innerHTML = tab.innerHTML;
    btn.onclick = () => {
      switchView(tab.dataset.view);
      closeMobileDrawer();
    };
    links.appendChild(btn);
  });
}

function openMobileDrawer() {
  $('nav-mobile-overlay').classList.remove('hidden');
  $('nav-mobile-drawer').classList.remove('hidden');
  buildMobileDrawer(); // refrescar estados activos
}

function closeMobileDrawer() {
  $('nav-mobile-overlay').classList.add('hidden');
  $('nav-mobile-drawer').classList.add('hidden');
}

// Actualizar el label activo en la nav mobile
function updateNavActiveLabel(viewId) {
  const tab = document.querySelector(`.nav-tab[data-view="${viewId}"]`);
  let label = $('nav-active-label');
  if (!label) {
    label = document.createElement('span');
    label.id = 'nav-active-label';
    label.className = 'nav-active-label';
    $('nav-hamburger').insertAdjacentElement('afterend', label);
  }
  label.textContent = tab ? tab.textContent.trim().replace(/\d+$/, '').trim() : '';
}

function switchView(viewId) {
  if (state.currentView && state.currentView.endsWith('-mensajes') && viewId !== state.currentView) {
    unsubscribeRealtime();
    chat.active = null;
  }

  state.currentView = viewId;
  $$('.view').forEach(v => v.classList.add('hidden'));
  $$('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.view === viewId));
  const pane = document.querySelector(`[data-view-pane="${viewId}"]`);
  if (!pane) return;
  pane.classList.remove('hidden');

  // Actualizar label y drawer mobile
  updateNavActiveLabel(viewId);
  // Refrescar estado activo en el drawer sin abrirlo
  $$('.nav-mobile-link').forEach(l => {
    l.classList.toggle('active', l.dataset.view === viewId);
  });

  // Cargar datos de la vista
  if (viewId === 'mentor-alumnos')   loadMentorAlumnos();
  if (viewId === 'mentor-mensajes')  loadChat('mentor');
  if (viewId === 'admin-alumnos')    loadAdminAlumnos();
  if (viewId === 'admin-mentores')   loadAdminMentores();
  if (viewId === 'admin-estadisticas') loadEstadisticas();
  if (viewId === 'admin-mensajes')   loadChat('admin');
  if (viewId === 'admin-usuarios')   loadAdminUsuarios();
  if (viewId === 'super-usuarios')   loadSuperUsuarios();
  if (viewId === 'super-conectados') { renderOnlineUsers(); }
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
  // limpiar contenido (preservamos loading/empty que están como hijos)
  grid.innerHTML = '<div class="empty-state hidden" id="empty-state"><span>🌿</span><p>Aún no tenés alumnos asignados.<br/>Un administrador te los va a asignar.</p></div>';

  let list = state.mentorAlumnos.slice();

  // Filtros
  const f = state.mentorFilter;
  if (f === 'activa')        list = list.filter(a => a.activa && !a.baja);
  if (f === 'alerta')        list = list.filter(a => !a.baja && a.fecha_ultimo && diffDays(a.fecha_ultimo) > 14);
  if (f === 'respondio-si')  list = list.filter(a => a.respondio === 'Sí' && !a.baja);
  if (f === 'respondio-no')  list = list.filter(a => a.respondio === 'No' && !a.baja);
  if (f === 'baja')          list = list.filter(a => a.baja);
  // "Todos" incluye a los alumnos de baja (visibles pero marcados),
  // no los oculta — solo el resto de filtros específicos los excluye.
  if (f === 'all')           { /* sin filtro adicional: se ven todos */ }

  // Búsqueda
  if (state.mentorSearch) {
    const q = state.mentorSearch.toLowerCase();
    list = list.filter(a =>
      [a.nombre, a.apellido, a.telefono, a.inquietudes, a.seguimiento]
        .filter(Boolean).some(v => v.toLowerCase().includes(q))
    );
  }

  // Ordenamiento
  if (state.mentorSort === 'nombre')   list.sort((a,b) => (a.apellido||a.nombre||'').localeCompare(b.apellido||b.nombre||''));
  if (state.mentorSort === 'ultimo')   list.sort((a,b) => (b.fecha_ultimo||'').localeCompare(a.fecha_ultimo||''));
  if (state.mentorSort === 'reciente') list.sort((a,b) => (b.created_at||'').localeCompare(a.created_at||''));

  // Stats
  const all = state.mentorAlumnos.filter(a => !a.baja);
  $('stat-total').textContent  = all.length;
  $('stat-activa').textContent = all.filter(a => a.activa).length;
  $('stat-alerta').textContent = all.filter(a => a.fecha_ultimo && diffDays(a.fecha_ultimo) > 14).length;
  $('stat-baja').textContent   = state.mentorAlumnos.filter(a => a.baja).length;

  // Contador de resultados
  $('mnt-results-count').textContent =
    list.length === 0 ? 'Sin resultados' :
    list.length === 1 ? '1 alumno' :
    `${list.length} alumnos`;

  // Paginación
  const { slice } = paginate(list, state.mentorPage, 'mnt-pagination', (p) => {
    state.mentorPage = p; renderMentorAlumnos();
  });

  // Modo vista
  grid.classList.toggle('mode-list', state.mentorViewMode === 'list');

  if (!list.length) {
    $('empty-state').classList.remove('hidden');
    return;
  }

  for (const a of slice) {
    grid.insertAdjacentHTML('beforeend',
      state.mentorViewMode === 'list'
        ? renderMentorRow(a)
        : renderMentorCard(a));
  }
  $$('.alumno-mentor-card', grid).forEach(card => {
    card.onclick = () => openDetail(card.dataset.id);
  });
}

function renderMentorRow(a) {
  const dias = a.fecha_ultimo ? diffDays(a.fecha_ultimo) : null;
  const alerta = dias !== null && dias > 14;
  const eliminado = !!a.eliminado;
  const tag = eliminado
    ? '<span class="alumno-card-tag tag-eliminado">quitado</span>'
    : a.baja
      ? '<span class="alumno-card-tag tag-baja">baja</span>'
      : a.activa
        ? '<span class="alumno-card-tag tag-asignado">activa</span>'
        : '<span class="alumno-card-tag tag-sin">pausa</span>';
  return `
    <article class="alumno-card alumno-mentor-card ${eliminado ? 'is-eliminado' : ''}" data-id="${a.id}">
      <div style="display:flex;align-items:center;gap:6px">
        <div class="crecimiento-icon-mini">${getIconoCrecimiento(a)}</div>
        <div class="alumno-card-name">${escapeHtml(a.apellido)}, ${escapeHtml(a.nombre)}</div>
      </div>
      <div class="alumno-card-meta list-col-fecha">
        Últ. contacto: <strong>${formatDate(a.fecha_ultimo)}</strong>
        ${alerta && !eliminado ? `<span style="color:#C4825A"> · ${dias} días</span>` : ''}
      </div>
      <div class="alumno-card-meta">
        ${a.telefono ? '📞 ' + escapeHtml(a.telefono) : ''}
        ${a.respondio ? ` <span class="sep">·</span> ${escapeHtml(a.respondio)}` : ''}
      </div>
      ${tag}
    </article>`;
}

function renderMentorCard(a) {
  const dias = a.fecha_ultimo ? diffDays(a.fecha_ultimo) : null;
  const alerta = dias !== null && dias > 14;
  const eliminado = !!a.eliminado;
  const nivel = getNivelLabel(a);
  // El color es el del mentor que está logueado (sus alumnos siempre tienen su color)
  const myColor = state.profile.color_mentor;
  const cardBg = (!eliminado && myColor) ? `style="background:${myColor}55;border-top:3px solid ${myColor}"` : '';
  return `
    <article class="alumno-card alumno-mentor-card ${eliminado ? 'is-eliminado' : ''}" data-id="${a.id}" ${cardBg}>
      ${alerta && !eliminado ? `<div class="card-alerta-banner">⚠️ Sin contacto hace ${dias} día${dias === 1 ? '' : 's'}</div>` : ''}
      <div class="card-top-row">
        <div class="card-top-info">
          <div class="alumno-card-name">${escapeHtml(a.nombre)} ${escapeHtml(a.apellido)}</div>
          ${a.telefono ? `<div class="card-telefono">📞 ${escapeHtml(a.telefono)}</div>` : ''}
          <div class="alumno-card-comision">
            ${a.numero_alumno ? `<span class="badge-numero">#${a.numero_alumno}</span>` : ''}
            ${a.comision ? `<span>${escapeHtml(a.comision)}</span>` : ''}
            ${a.situacion ? `<span class="badge-situacion">${escapeHtml(a.situacion)}</span>` : ''}
          </div>
          <div class="card-nivel-label ${nivel.cls}">${nivel.label}</div>
        </div>
        <div class="card-top-right">
          ${getIconoCrecimiento(a)}
          ${eliminado
            ? '<span class="alumno-card-tag tag-eliminado">quitado</span>'
            : a.baja
              ? '<span class="alumno-card-tag tag-baja">baja</span>'
              : a.activa
                ? '<span class="card-badge-activa activa-si"><svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg> Activa</span>'
                : '<span class="card-badge-activa activa-no"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/></svg> Inactiva</span>'}
        </div>
      </div>
      <div class="alumno-card-meta">
        ${a.tipo_contacto ? `<span class="card-meta-item">📞 ${escapeHtml(a.tipo_contacto)}</span>` : ''}
        ${a.respondio ? `<span class="card-meta-item">✓ Respondió: <strong>${escapeHtml(a.respondio)}</strong></span>` : ''}
        ${a.fecha_ultimo ? `<span class="card-meta-item">📅 ${formatDate(a.fecha_ultimo)}</span>` : ''}
        ${alerta && !eliminado ? `<span style="color:#C4825A"> · ⚠ ${dias} días</span>` : ''}
      </div>
      ${eliminado ? '<div class="alumno-removed-banner">Este alumno fue quitado de las mentorías</div>' : ''}
    </article>`;
}

// Eventos de los chips y búsqueda (mentor)
$$('[data-view-pane="mentor-alumnos"] .chip').forEach(chip => {
  chip.onclick = () => {
    $$('[data-view-pane="mentor-alumnos"] .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    state.mentorFilter = chip.dataset.filter;
    state.mentorPage = 1;
    renderMentorAlumnos();
  };
});
$('search-input').addEventListener('input', e => {
  state.mentorSearch = e.target.value;
  state.mentorPage = 1;
  renderMentorAlumnos();
});
$('sort-select').addEventListener('change', e => {
  state.mentorSort = e.target.value;
  renderMentorAlumnos();
});
// Toggle de modo vista
['mnt-view-grid','mnt-view-list'].forEach(id => {
  $(id).onclick = () => {
    const mode = $(id).dataset.viewMode;
    state.mentorViewMode = mode;
    $('mnt-view-grid').classList.toggle('active', mode === 'grid');
    $('mnt-view-list').classList.toggle('active', mode === 'list');
    renderMentorAlumnos();
  };
});

/* ═══════════════════════════════════════════════════════════════
   9. VISTA ADMIN · "Alumnos"
═══════════════════════════════════════════════════════════════ */

async function loadAdminAlumnos() {
  // Cargamos alumnos + perfiles de mentores en paralelo
  const [alRes, mRes] = await Promise.all([
    db.from('alumnos').select('*').order('created_at', { ascending: false }),
    db.from('profiles').select('id,nombre,apellido,email,color_mentor').eq('rol','mentor').eq('activo', true)
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

  // Poblar select de filtro por mentor (sólo la primera vez o si cambió la lista)
  const sel = $('adm-filter-mentor');
  if (sel && sel.children.length <= 1 + state.adminMentores.length === false) {
    // Reconstruir si hay desincronía
  }
  if (sel) {
    const current = sel.value;
    sel.innerHTML = '<option value="">Todos los mentores</option><option value="__none__">— Sin asignar —</option>';
    state.adminMentores
      .slice()
      .sort((a,b) => fullName(a).localeCompare(fullName(b)))
      .forEach(m => {
        sel.insertAdjacentHTML('beforeend',
          `<option value="${m.id}">${escapeHtml(fullName(m))}</option>`);
      });
    sel.value = current || state.adminAlumnoMentor || '';
  }

  let list = state.adminAlumnos.slice();
  const f = state.adminAlumnoFilter;
  // Por defecto, todos los filtros excluyen los eliminados,
  // salvo el chip "eliminados" que los muestra exclusivamente.
  if (f === 'eliminados') {
    list = list.filter(a => a.eliminado);
  } else {
    list = list.filter(a => !a.eliminado);
    if (f === 'asignados')   list = list.filter(a => a.mentor_id && !a.baja);
    if (f === 'sin-asignar') list = list.filter(a => !a.mentor_id && !a.baja);
    if (f === 'baja')        list = list.filter(a => a.baja);
    // "Todos" incluye a los alumnos de baja (visibles pero marcados)
    if (f === 'all')         { /* sin filtro adicional */ }
  }

  // Filtro adicional por mentor
  if (state.adminAlumnoMentor === '__none__') {
    list = list.filter(a => !a.mentor_id);
  } else if (state.adminAlumnoMentor) {
    list = list.filter(a => a.mentor_id === state.adminAlumnoMentor);
  }

  // Búsqueda
  if (state.adminAlumnoSearch) {
    const q = state.adminAlumnoSearch.toLowerCase();
    list = list.filter(a => {
      const m = mentorMap.get(a.mentor_id);
      const mentorStr = m ? fullName(m) : '';
      return [a.nombre,a.apellido,a.telefono,a.email,mentorStr].filter(Boolean)
        .some(v => v.toLowerCase().includes(q));
    });
  }

  // Ordenamiento
  if (state.adminAlumnoSort === 'apellido') {
    list.sort((a,b) => (a.apellido||'').localeCompare(b.apellido||''));
  } else if (state.adminAlumnoSort === 'ultimo') {
    list.sort((a,b) => (b.fecha_ultimo||'').localeCompare(a.fecha_ultimo||''));
  } else if (state.adminAlumnoSort === 'mentor') {
    list.sort((a,b) => {
      const ma = mentorMap.get(a.mentor_id);
      const mb = mentorMap.get(b.mentor_id);
      return (ma ? fullName(ma) : 'zzz').localeCompare(mb ? fullName(mb) : 'zzz');
    });
  } else {
    list.sort((a,b) => (b.created_at||'').localeCompare(a.created_at||''));
  }

  // Stats — sólo cuentan alumnos NO eliminados
  const noElim = state.adminAlumnos.filter(a => !a.eliminado);
  $('adm-stat-total').textContent      = noElim.filter(a => !a.baja).length;
  $('adm-stat-asignados').textContent  = noElim.filter(a => a.mentor_id && !a.baja).length;
  $('adm-stat-sin').textContent        = noElim.filter(a => !a.mentor_id && !a.baja).length;
  $('adm-stat-bajas').textContent      = noElim.filter(a => a.baja).length;

  $('adm-results-count').textContent =
    list.length === 0 ? 'Sin resultados' :
    list.length === 1 ? '1 alumno' :
    `${list.length} alumnos`;

  // Paginación
  const { slice } = paginate(list, state.adminAlumnoPage, 'adm-pagination', (p) => {
    state.adminAlumnoPage = p; renderAdminAlumnos();
  });

  grid.classList.toggle('mode-list', state.adminAlumnoViewMode === 'list');

  if (!list.length) {
    grid.innerHTML = '<div class="empty-state"><span>🌿</span><p>No hay alumnos en este filtro.</p></div>';
    return;
  }

  for (const a of slice) {
    const m = mentorMap.get(a.mentor_id);
    const mentorTxt = m ? fullName(m) : 'Sin asignar';
    const eliminado = !!a.eliminado;
    const dias = a.fecha_ultimo ? diffDays(a.fecha_ultimo) : null;
    const alerta = dias !== null && dias > 14 && !eliminado && !a.baja;
    const elimClass = eliminado ? 'is-eliminado' : '';
    const nivel = getNivelLabel(a);
    // Color de fondo del grupo del mentor (pastel suave)
    const colorFondo = (!eliminado && m?.color_mentor) ? m.color_mentor + '55' : '';
    const colorBorde = (!eliminado && m?.color_mentor) ? m.color_mentor : '';

    // Badge de estado — idéntico al mentor
    const badgeEstado = eliminado
      ? '<span class="alumno-card-tag tag-eliminado">eliminado</span>'
      : a.baja
        ? '<span class="alumno-card-tag tag-baja">baja</span>'
        : a.activa
          ? '<span class="card-badge-activa activa-si"><svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg> Activa</span>'
          : '<span class="card-badge-activa activa-no"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/></svg> Inactiva</span>';

    const cardStyle = colorFondo
      ? `style="background:${colorFondo};border-top:3px solid ${colorBorde}"`
      : '';

    if (state.adminAlumnoViewMode === 'list') {
      grid.insertAdjacentHTML('beforeend', `
        <article class="alumno-card admin-alumno-card ${elimClass}" data-id="${a.id}" data-baja="${a.baja ? '1' : '0'}" ${cardStyle}>
          <div style="display:flex;align-items:center;gap:6px">
            <div class="crecimiento-icon-mini">${getIconoCrecimiento(a)}</div>
            <div class="alumno-card-name">${escapeHtml(a.apellido)}, ${escapeHtml(a.nombre)}</div>
          </div>
          <div class="alumno-card-meta list-col-mentor">${escapeHtml(mentorTxt)}</div>
          <div class="alumno-card-meta list-col-fecha">${a.telefono ? '📞 ' + escapeHtml(a.telefono) : ''}</div>
          ${badgeEstado}
        </article>
      `);
    } else {
      grid.insertAdjacentHTML('beforeend', `
        <article class="alumno-card admin-alumno-card ${elimClass}" data-id="${a.id}" data-baja="${a.baja ? '1' : '0'}" ${cardStyle}>
          ${alerta ? `<div class="card-alerta-banner">⚠️ Sin contacto hace ${dias} día${dias === 1 ? '' : 's'}</div>` : ''}
          <div class="card-top-row">
            <div class="card-top-info">
              <div class="alumno-card-name">${escapeHtml(a.nombre)} ${escapeHtml(a.apellido)}</div>
              ${a.telefono ? `<div class="card-telefono">📞 ${escapeHtml(a.telefono)}</div>` : ''}
              <div class="alumno-card-comision">
                ${a.numero_alumno ? `<span class="badge-numero">#${a.numero_alumno}</span>` : ''}
                ${a.comision ? `<span>${escapeHtml(a.comision)}</span>` : ''}
                ${a.situacion ? `<span class="badge-situacion">${escapeHtml(a.situacion)}</span>` : ''}
              </div>
              <div class="card-nivel-label ${nivel.cls}">${nivel.label}</div>
            </div>
            <div class="card-top-right">
              ${getIconoCrecimiento(a)}
              ${badgeEstado}
            </div>
          </div>
          <div class="alumno-card-meta">
            <span class="card-meta-item">👤 ${escapeHtml(mentorTxt)}</span>
            ${a.tipo_contacto ? `<span class="card-meta-item">📞 ${escapeHtml(a.tipo_contacto)}</span>` : ''}
            ${a.respondio ? `<span class="card-meta-item">✓ Respondió: <strong>${escapeHtml(a.respondio)}</strong></span>` : ''}
            ${a.fecha_ultimo ? `<span class="card-meta-item">📅 ${formatDate(a.fecha_ultimo)}</span>` : ''}
          </div>
          ${eliminado && a.eliminado_at ? `<div class="alumno-removed-banner">Eliminado el ${formatDate(a.eliminado_at.slice(0,10))}</div>` : ''}
          ${eliminado && !a.eliminado_at ? '<div class="alumno-removed-banner">Este alumno fue eliminado</div>' : ''}
        </article>
      `);
    }
  }

  $$('.admin-alumno-card', grid).forEach(card => {
    // Agregar el elemento de checkbox visual
    if (!card.querySelector('.bulk-checkbox')) {
      const cb = document.createElement('div');
      cb.className = 'bulk-checkbox';
      card.prepend(cb);
    }
    // Si ya estaba seleccionado antes de este re-render (ej: cambio de filtro
    // mientras el modo selección seguía activo), reaplicar la marca visual.
    if (bulk.active && bulk.selected.has(+card.dataset.id)) {
      card.classList.add('bulk-selected');
    }
    card.onclick = (e) => {
      if (bulk.active) {
        toggleBulkCard(card, +card.dataset.id);
      } else {
        openAlumnoForm(card.dataset.id);
      }
    };
  });

  if (bulk.active) actualizarBloqueoTarjetas();
}

$$('#adm-filter-chips .chip').forEach(chip => {
  chip.onclick = () => {
    $$('#adm-filter-chips .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    state.adminAlumnoFilter = chip.dataset.filter;
    state.adminAlumnoPage = 1;
    renderAdminAlumnos();
  };
});
$('adm-search-alumnos').addEventListener('input', e => {
  state.adminAlumnoSearch = e.target.value;
  state.adminAlumnoPage = 1;
  renderAdminAlumnos();
});
$('adm-filter-mentor').addEventListener('change', e => {
  state.adminAlumnoMentor = e.target.value;
  state.adminAlumnoPage = 1;
  renderAdminAlumnos();
});
$('adm-sort').addEventListener('change', e => {
  state.adminAlumnoSort = e.target.value;
  renderAdminAlumnos();
});
['adm-view-grid','adm-view-list'].forEach(id => {
  $(id).onclick = () => {
    const mode = $(id).dataset.viewMode;
    state.adminAlumnoViewMode = mode;
    $('adm-view-grid').classList.toggle('active', mode === 'grid');
    $('adm-view-list').classList.toggle('active', mode === 'list');
    renderAdminAlumnos();
  };
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

  // Cargar select de mentores (visible y editable sólo para admin)
  const sel = $('form-mentor');
  sel.innerHTML = '<option value="">— Sin asignar —</option>';
  const mentoresFuente = isAdmin ? state.adminMentores : [];
  mentoresFuente.forEach(m => {
    sel.insertAdjacentHTML('beforeend',
      `<option value="${m.id}">${escapeHtml(fullName(m))}</option>`);
  });
  $('form-mentor-wrap').style.display = isAdmin ? '' : 'none';

  // Reset de botones eliminar/restaurar/habilitar
  $('btn-eliminar-alumno').classList.add('hidden');
  $('btn-restaurar-alumno').classList.add('hidden');
  $('btn-habilitar-alumno').classList.add('hidden');
  $('btn-baja-alumno').classList.add('hidden');

  let estaEliminado = false;
  if (alumnoId) {
    const pool = isAdmin ? state.adminAlumnos : state.mentorAlumnos;
    const a = pool.find(x => String(x.id) === String(alumnoId));
    if (!a) { toast('No se encontró el alumno','error'); return; }
    estaEliminado = !!a.eliminado;

    $('modal-title').textContent = estaEliminado
      ? 'Alumno eliminado'
      : (isMentor ? 'Editar alumno' : 'Editar alumno');

    $('form-nombre').value        = a.nombre || '';
    $('form-apellido').value      = a.apellido || '';
    $('form-numero-alumno').value = a.numero_alumno || '';
    $('form-situacion').value     = a.situacion || '';
    $('form-comision').value      = a.comision || '';
    $('form-telefono').value      = a.telefono || '';
    $('form-email').value         = a.email || '';
    $('form-fecha-primer').value= a.fecha_primer || '';
    $('form-fecha-ultimo').value= a.fecha_ultimo || '';
    $('form-respondio').value   = a.respondio || '';
    $('form-tipo-contacto').value = a.tipo_contacto || '';
    $('form-inquietudes').value = a.inquietudes || '';
    $('form-seguimiento').value = a.seguimiento || '';
    if (isAdmin) $('form-mentor').value = a.mentor_id || '';

    // Botones de baja/eliminar/restaurar/habilitar — sólo para admin.
    // Siguen el mismo criterio que la barra de selección masiva:
    // "Baja" y "Eliminar" van siempre juntos, uno al lado del otro.
    if (isAdmin && !estaEliminado) {
      if (a.baja) {
        // Ya está de baja: mostrar "Habilitar" (para reactivar) + "Eliminar" juntos
        $('btn-habilitar-alumno').classList.remove('hidden');
        $('btn-habilitar-alumno').dataset.id = a.id;
        $('btn-eliminar-alumno').classList.remove('hidden');
        $('btn-eliminar-alumno').dataset.id = a.id;
        $('btn-eliminar-alumno').dataset.name = `${a.nombre} ${a.apellido}`;
      } else {
        // Activo: mostrar "Baja" + "Eliminar" juntos
        $('btn-baja-alumno').classList.remove('hidden');
        $('btn-baja-alumno').dataset.id = a.id;
        $('btn-eliminar-alumno').classList.remove('hidden');
        $('btn-eliminar-alumno').dataset.id = a.id;
        $('btn-eliminar-alumno').dataset.name = `${a.nombre} ${a.apellido}`;
      }
    } else if (isAdmin && estaEliminado) {
      $('btn-restaurar-alumno').classList.remove('hidden');
      $('btn-restaurar-alumno').dataset.id = a.id;
    }
    // "Baja" y "Habilitar" son exclusivos de admin/super_admin.
    // Los mentores nunca pueden dar de baja ni reactivar un alumno.
  } else {
    $('modal-title').textContent = 'Nuevo alumno';
    ['form-nombre','form-apellido','form-numero-alumno','form-situacion',
     'form-comision','form-telefono','form-email',
     'form-fecha-primer','form-fecha-ultimo','form-respondio',
     'form-tipo-contacto','form-inquietudes','form-seguimiento']
      .forEach(id => $(id).value = '');
    $('form-mentor').value = '';
  }

  // Si el alumno está eliminado: bloquear edición (sólo lectura)
  const inputs = $$('#modal-form input, #modal-form select, #modal-form textarea');
  inputs.forEach(el => {
    if (el.id === 'form-id') return;
    if (el.id === 'profile-email') return;
    el.disabled = estaEliminado;
  });
  $('btn-save').classList.toggle('hidden', estaEliminado);

  // Los mentores no pueden tocar los "Datos personales" del alumno.
  // Sólo pueden usar Seguimiento, Inquietudes y Seguimiento del mentor.
  // (defensa doble: además está bloqueado a nivel de base de datos
  // por un trigger, ver migración 16)
  const CAMPOS_DATOS_PERSONALES = [
    'form-nombre', 'form-apellido', 'form-numero-alumno',
    'form-situacion', 'form-comision', 'form-telefono', 'form-email',
  ];
  if (isMentor && !estaEliminado) {
    CAMPOS_DATOS_PERSONALES.forEach(id => {
      const el = $(id);
      if (el) el.disabled = true;
    });
  }
}

$('modal-close').onclick = () => $('modal-form').classList.add('hidden');
$('btn-cancel').onclick  = () => $('modal-form').classList.add('hidden');

$('btn-save').onclick = async () => {
  const isAdmin = state.profile.rol === 'admin' || state.profile.rol === 'super_admin';
  const id = $('form-id').value || null;

  const payload = {
    nombre:          $('form-nombre').value.trim(),
    apellido:        $('form-apellido').value.trim(),
    numero_alumno:   parseInt($('form-numero-alumno').value) || null,
    situacion:       $('form-situacion').value.trim()  || null,
    comision:        $('form-comision').value.trim()   || null,
    telefono:        $('form-telefono').value.trim()   || null,
    email:           $('form-email').value.trim()      || null,
    fecha_primer:    $('form-fecha-primer').value      || null,
    fecha_ultimo:    $('form-fecha-ultimo').value      || null,
    respondio:       $('form-respondio').value         || null,
    tipo_contacto:   $('form-tipo-contacto').value     || null,
    inquietudes:     $('form-inquietudes').value       || null,
    seguimiento:     $('form-seguimiento').value       || null,
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

/* ─── ELIMINACIÓN (soft) con doble confirmación ─── */

let pendingDeleteId = null;

$('btn-eliminar-alumno').onclick = () => {
  pendingDeleteId = $('btn-eliminar-alumno').dataset.id;
  const nombre = $('btn-eliminar-alumno').dataset.name || 'este alumno';
  // Cierro el modal de edición para no apilar overlays
  $('modal-form').classList.add('hidden');
  // Reset estado del modal confirm
  $('confirm-step-1').classList.remove('hidden');
  $('confirm-step-2').classList.add('hidden');
  $('confirm-input').value = '';
  $('confirm-error').classList.add('hidden');
  $('confirm-alumno-name').textContent = nombre;
  $('confirm-next').textContent = 'Continuar';
  $('confirm-next').disabled = false;
  $('modal-confirm-delete').classList.remove('hidden');
};

$('confirm-close').onclick  = () => $('modal-confirm-delete').classList.add('hidden');
$('confirm-cancel').onclick = () => $('modal-confirm-delete').classList.add('hidden');

$('confirm-next').onclick = async () => {
  const step1Visible = !$('confirm-step-1').classList.contains('hidden');
  if (step1Visible) {
    // Paso 1 → Paso 2
    $('confirm-step-1').classList.add('hidden');
    $('confirm-step-2').classList.remove('hidden');
    $('confirm-next').textContent = 'Eliminar definitivamente';
    setTimeout(() => $('confirm-input').focus(), 50);
    return;
  }

  // Paso 2: validar palabra clave y ejecutar
  const palabra = $('confirm-input').value.trim().toUpperCase();
  if (palabra !== 'ELIMINAR') {
    $('confirm-error').textContent = 'Tenés que escribir exactamente la palabra ELIMINAR para confirmar.';
    $('confirm-error').classList.remove('hidden');
    return;
  }
  $('confirm-error').classList.add('hidden');
  $('confirm-next').disabled = true;
  $('confirm-next').textContent = 'Eliminando...';

  const { error } = await db.rpc('admin_eliminar_alumno', { alumno_id: pendingDeleteId });
  $('confirm-next').disabled = false;
  $('confirm-next').textContent = 'Eliminar definitivamente';

  if (error) {
    console.error('admin_eliminar_alumno:', error);
    if (error.code === '42501') $('confirm-error').textContent = 'No tenés permiso para esto.';
    else                         $('confirm-error').textContent = 'Error: ' + error.message;
    $('confirm-error').classList.remove('hidden');
    return;
  }

  $('modal-confirm-delete').classList.add('hidden');
  pendingDeleteId = null;
  toast('Alumno eliminado ✓');
  if (state.currentView === 'admin-alumnos') loadAdminAlumnos();
};

// Enter en el input del paso 2 = ejecutar confirmación
$('confirm-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('confirm-next').click();
});

/* ─── RESTAURAR alumno eliminado ─── */

$('btn-restaurar-alumno').onclick = async () => {
  const id = $('btn-restaurar-alumno').dataset.id;
  if (!confirm('¿Restaurar este alumno? Volverá a estar activo en las mentorías.')) return;

  const btn = $('btn-restaurar-alumno');
  btn.disabled = true; btn.textContent = 'Restaurando...';
  const { error } = await db.rpc('admin_restaurar_alumno', { alumno_id: id });
  btn.disabled = false; btn.textContent = 'Restaurar';

  if (error) {
    console.error('admin_restaurar_alumno:', error);
    toast('Error: ' + error.message, 'error');
    return;
  }
  toast('Alumno restaurado ✓');
  $('modal-form').classList.add('hidden');
  if (state.currentView === 'admin-alumnos') loadAdminAlumnos();
};

/* ─── HABILITAR alumno de baja (solo admin/super_admin) ───
   Solo cambia el campo "baja" a false. No toca ningún otro dato:
   toda la info que el mentor ya cargó en la ficha se conserva tal
   cual estaba. */

$('btn-habilitar-alumno').onclick = async () => {
  const id = $('btn-habilitar-alumno').dataset.id;
  if (!confirm('¿Habilitar este alumno nuevamente? Vuelve a estar activo, sin perder ningún dato cargado.')) return;

  const btn = $('btn-habilitar-alumno');
  btn.disabled = true; btn.textContent = 'Habilitando...';
  const { error } = await db.from('alumnos').update({ baja: false }).eq('id', id);
  btn.disabled = false;
  btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20,6 9,17 4,12"/></svg> Habilitar';

  if (error) {
    console.error('habilitar alumno:', error);
    toast('Error: ' + error.message, 'error');
    return;
  }

  toast('Alumno habilitado ✓');
  $('modal-form').classList.add('hidden');
  if (state.currentView === 'admin-alumnos')  loadAdminAlumnos();
  if (state.currentView === 'mentor-alumnos') loadMentorAlumnos();
};

/* ─── DAR DE BAJA a un alumno individual (solo admin/super_admin) ───
   Solo cambia el campo "baja" a true. El alumno sigue existiendo
   con toda su info, sigue viéndose (marcado como de baja) tanto
   en "Todos" como en el filtro "Bajas", y se puede reactivar
   después con el botón "Habilitar" sin perder ningún dato. */

$('btn-baja-alumno').onclick = async () => {
  const id = $('btn-baja-alumno').dataset.id;
  if (!confirm('¿Dar de baja a este alumno? Va a quedar marcado como de baja y va a dejar de contar como activo, pero podés habilitarlo de nuevo cuando quieras.')) return;

  const btn = $('btn-baja-alumno');
  btn.disabled = true; btn.textContent = 'Aplicando...';
  const { error } = await db.from('alumnos').update({ baja: true }).eq('id', id);
  btn.disabled = false;
  btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg> Baja';

  if (error) {
    console.error('dar de baja alumno:', error);
    toast('Error: ' + error.message, 'error');
    return;
  }

  toast('Alumno dado de baja ✓');
  $('modal-form').classList.add('hidden');
  if (state.currentView === 'admin-alumnos') loadAdminAlumnos();
};

/* ═══════════════════════════════════════════════════════════════
   11. VISTA ADMIN · "Mentores"
═══════════════════════════════════════════════════════════════ */

async function loadAdminMentores() {
  const [mRes, aRes] = await Promise.all([
    db.from('profiles')
      .select('id,nombre,apellido,email,avatar_url,activo,estado_mentor,color_mentor')
      .eq('rol','mentor')
      .order('created_at', { ascending: false }),
    db.from('alumnos').select('id, mentor_id, baja, eliminado')
  ]);

  if (mRes.error) { toast('Error al cargar mentores','error'); return; }
  state.adminMentores = mRes.data || [];

  // Auto-asignar colores a mentores que no tienen uno todavía
  await autoAsignarColoresMentores(state.adminMentores);

  const counts = new Map();
  (aRes.data || []).forEach(a => {
    if (!a.mentor_id || a.baja || a.eliminado) return;
    counts.set(a.mentor_id, (counts.get(a.mentor_id) || 0) + 1);
  });

  renderAdminMentores(counts);
}

// Asigna colores pasteles a los mentores que aún no tienen uno
// Los asigna en orden, sin repetir con los ya usados
async function autoAsignarColoresMentores(mentores) {
  const PALETA = [
    '#FFD6D6','#FFE4B5','#FFFACD','#D4EDDA','#D6EAF8',
    '#E8DAEF','#FDEBD0','#D5F5E3','#FADBD8','#DCE4F0',
    '#A9DFBF','#AED6F1','#F9E79F','#F5CBA7','#C9DFEC'
  ];
  const sinColor = mentores.filter(m => !m.color_mentor);
  if (!sinColor.length) return;

  const usados = new Set(mentores.filter(m => m.color_mentor).map(m => m.color_mentor));
  const disponibles = PALETA.filter(c => !usados.has(c));

  for (let i = 0; i < sinColor.length; i++) {
    const color = disponibles[i % PALETA.length] || PALETA[i % PALETA.length];
    const m = sinColor[i];
    const { error } = await db.from('profiles').update({ color_mentor: color }).eq('id', m.id);
    if (!error) {
      m.color_mentor = color;
      usados.add(color);
    }
  }

  const counts = new Map();
  (aRes.data || []).forEach(a => {
    if (!a.mentor_id || a.baja || a.eliminado) return;
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
    const count  = counts.get(m.id) || 0;
    const estado = m.estado_mentor || 'activo';
    const color  = m.color_mentor || '#E8E8E8';
    const avatarHtml = m.avatar_url
      ? `<img class="mentor-avatar" src="${escapeHtml(m.avatar_url)}" alt="" />`
      : `<div class="mentor-avatar-placeholder" style="background:${color}">${escapeHtml(initials(m))}</div>`;

    const estadoBadge =
      estado === 'pausado'
        ? '<span class="mentor-estado-badge estado-pausado">⏸ Pausado</span>'
        : estado === 'bloqueado'
          ? '<span class="mentor-estado-badge estado-bloqueado">🚫 Bloqueado</span>'
          : '<span class="mentor-estado-badge estado-activo">● Activo</span>';

    const btnPausa = estado === 'pausado'
      ? `<button class="btn-estado-mentor btn-reactivar" data-mentor="${m.id}" data-nuevo="activo">Reactivar</button>`
      : `<button class="btn-estado-mentor btn-pausar" data-mentor="${m.id}" data-nuevo="pausado">Pausar</button>`;
    const btnBloqueo = estado === 'bloqueado'
      ? `<button class="btn-estado-mentor btn-reactivar" data-mentor="${m.id}" data-nuevo="activo">Desbloquear</button>`
      : `<button class="btn-estado-mentor btn-bloquear" data-mentor="${m.id}" data-nuevo="bloqueado">Bloquear</button>`;

    grid.insertAdjacentHTML('beforeend', `
      <article class="mentor-card ${estado !== 'activo' ? 'mentor-card-inactiva' : ''}" data-id="${m.id}"
               style="border-top: 4px solid ${color}">
        <div class="mentor-card-top">
          ${avatarHtml}
          <div style="display:flex;align-items:center;gap:6px">
            ${estadoBadge}
            <span class="mentor-color-dot" style="background:${color}" title="Color del grupo"></span>
          </div>
        </div>
        <div class="mentor-card-name">${escapeHtml(fullName(m))}</div>
        <div class="mentor-card-email">${escapeHtml(m.email)}</div>
        <div class="mentor-card-stats">
          <div><strong>${count}</strong>alumnos</div>
        </div>
        <div class="mentor-card-actions">
          <button class="btn-asignar-grupo" data-mentor="${m.id}" data-nombre="${escapeHtml(fullName(m))}" data-color="${color}">
            👥 Asignar grupo
          </button>
        </div>
        <div class="mentor-card-actions" style="margin-top:4px">
          <button class="btn-secondary btn-pdf-mentor" data-mentor="${m.id}" style="flex:1;font-size:11px">PDF</button>
          ${btnPausa}
          ${btnBloqueo}
        </div>
      </article>
    `);
  }

  // Bindings
  $$('.btn-pdf-mentor', grid).forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); exportarInformeMentor(btn.dataset.mentor); };
  });
  $$('.btn-estado-mentor', grid).forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      cambiarEstadoMentor(btn.dataset.mentor, btn.dataset.nuevo);
    };
  });
  $$('.btn-asignar-grupo', grid).forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      abrirAsignarGrupo(btn.dataset.mentor, btn.dataset.nombre, btn.dataset.color);
    };
  });
}

async function cambiarEstadoMentor(mentorId, nuevoEstado) {
  const mentor = state.adminMentores.find(m => m.id === mentorId);
  const nombre = mentor ? fullName(mentor) : 'este mentor';

  const mensajes = {
    pausado:   `¿Pausar la cuenta de ${nombre}? El mentor verá un aviso y solo podrá acceder a mensajes.`,
    bloqueado: `¿Bloquear a ${nombre}? El mentor no podrá acceder a nada, como si no tuviera rol asignado.`,
    activo:    `¿Reactivar la cuenta de ${nombre}? Recuperará acceso completo.`
  };
  if (!confirm(mensajes[nuevoEstado] || '¿Confirmar?')) return;

  const { error } = await db.rpc('admin_set_mentor_estado', {
    target_user: mentorId,
    nuevo_estado: nuevoEstado
  });
  if (error) {
    console.error('admin_set_mentor_estado:', error);
    toast('Error: ' + error.message, 'error');
    return;
  }
  const toastMsg = {
    pausado:   `${nombre} pausado ✓`,
    bloqueado: `${nombre} bloqueado ✓`,
    activo:    `${nombre} reactivado ✓`
  };
  toast(toastMsg[nuevoEstado] || 'Estado actualizado ✓');
  loadAdminMentores();
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

/* ─── INFORME GENERAL (admin/super_admin) ───
   Un solo PDF con TODOS los alumnos de TODOS los mentores,
   agrupados por mentor, incluyendo su estado (Activa/Baja) y el
   detalle completo de inquietudes + seguimiento que cada mentor
   fue cargando. Excluye alumnos eliminados (soft-delete).
*/
async function exportarInformeGeneral() {
  toast('Generando informe general...');

  const [aRes, mRes] = await Promise.all([
    db.from('alumnos').select('*').eq('eliminado', false).order('apellido'),
    db.from('profiles').select('id,nombre,apellido,email').eq('rol', 'mentor').order('apellido'),
  ]);

  if (aRes.error || mRes.error) { toast('Error al generar el informe', 'error'); return; }

  const alumnos  = aRes.data || [];
  const mentores = mRes.data || [];
  const mentorMap = new Map(mentores.map(m => [m.id, m]));

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  const totalBajas   = alumnos.filter(a => a.baja).length;
  const totalSinAsig = alumnos.filter(a => !a.mentor_id).length;

  // Encabezado
  doc.setFont('helvetica','bold'); doc.setFontSize(18);
  doc.setTextColor('#2C2417');
  doc.text('Holos Mentorías — Informe general', 40, 50);

  doc.setFont('helvetica','normal'); doc.setFontSize(11);
  doc.setTextColor('#7A6E62');
  doc.text(`Generado: ${new Date().toLocaleString('es-AR')}`, 40, 70);
  doc.text(`Total de alumnos: ${alumnos.length}   ·   De baja: ${totalBajas}   ·   Sin asignar: ${totalSinAsig}   ·   Mentores: ${mentores.length}`, 40, 86);

  // Tabla resumen: todos los alumnos, columna de mentor incluida
  const filasOrdenadas = [...alumnos].sort((a, b) => {
    const nombreMentorA = a.mentor_id ? fullName(mentorMap.get(a.mentor_id)) : 'zzz Sin asignar';
    const nombreMentorB = b.mentor_id ? fullName(mentorMap.get(b.mentor_id)) : 'zzz Sin asignar';
    if (nombreMentorA !== nombreMentorB) return nombreMentorA.localeCompare(nombreMentorB);
    return (a.apellido || '').localeCompare(b.apellido || '');
  });

  const rows = filasOrdenadas.map(a => [
    a.mentor_id ? fullName(mentorMap.get(a.mentor_id)) : 'Sin asignar',
    `${a.apellido}, ${a.nombre}`,
    a.telefono || '—',
    formatDate(a.fecha_ultimo),
    a.respondio || '—',
    a.baja ? 'Baja' : (a.activa ? 'Activa' : 'Pausa'),
  ]);

  doc.autoTable({
    startY: 104,
    head: [['Mentor','Alumno','Teléfono','Últ. contacto','Respondió','Estado']],
    body: rows,
    headStyles: { fillColor: [107,154,100], textColor: 255 },
    styles: { fontSize: 8.5, cellPadding: 4 },
    alternateRowStyles: { fillColor: [250,247,242] },
    didParseCell: (data) => {
      // Resaltar en la tabla las filas de alumnos de baja
      if (data.section === 'body' && data.row.raw[5] === 'Baja') {
        data.cell.styles.textColor = '#B85450';
      }
    },
  });

  // Detalle por alumno, agrupado por mentor (inquietudes + seguimiento)
  let y = doc.lastAutoTable.finalY + 30;
  let mentorActual = null;

  for (const a of filasOrdenadas) {
    const nombreMentor = a.mentor_id ? fullName(mentorMap.get(a.mentor_id)) : 'Sin asignar';

    if (nombreMentor !== mentorActual) {
      mentorActual = nombreMentor;
      if (y > 700) { doc.addPage(); y = 50; }
      doc.setFontSize(13); doc.setFont('helvetica','bold'); doc.setTextColor('#2C2417');
      doc.text(`Mentor: ${mentorActual}`, 40, y); y += 18;
    }

    if (!a.inquietudes && !a.seguimiento) continue; // sin detalle que mostrar, no ocupar espacio

    if (y > 740) { doc.addPage(); y = 50; }
    doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor('#4E7848');
    const estadoTag = a.baja ? '  [DE BAJA]' : '';
    doc.text(`${a.apellido}, ${a.nombre}${estadoTag}`, 50, y); y += 15;
    doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor('#2C2417');

    if (a.inquietudes) {
      doc.setFont('helvetica','bold'); doc.text('Inquietudes:', 50, y); y += 13;
      doc.setFont('helvetica','normal');
      const lines = doc.splitTextToSize(a.inquietudes, 500);
      doc.text(lines, 50, y); y += lines.length * 11 + 5;
    }
    if (a.seguimiento) {
      if (y > 740) { doc.addPage(); y = 50; }
      doc.setFont('helvetica','bold'); doc.text('Seguimiento:', 50, y); y += 13;
      doc.setFont('helvetica','normal');
      const lines = doc.splitTextToSize(a.seguimiento, 500);
      doc.text(lines, 50, y); y += lines.length * 11 + 10;
    }
    y += 6;
  }

  doc.save(`informe-general-holos-${new Date().toISOString().slice(0,10)}.pdf`);
  toast('Informe general generado ✓');
}

$('btn-informe-general').onclick = () => exportarInformeGeneral();

/* ═══════════════════════════════════════════════════════════════
   13. VISTA SUPER ADMIN · "Usuarios"
═══════════════════════════════════════════════════════════════ */

async function loadSuperUsuarios() {
  const { data, error } = await db
    .from('profiles')
    .select('id,email,rol,nombre,apellido,avatar_url,activo,puede_ver_estadisticas,created_at')
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

  if (state.superSearch) {
    const q = state.superSearch.toLowerCase();
    rows = rows.filter(u => [u.nombre,u.apellido,u.email]
      .filter(Boolean).some(v => v.toLowerCase().includes(q)));
  }

  // Stats (siempre sobre el total, sin filtro)
  $('sup-stat-total').textContent      = state.superUsers.length;
  $('sup-stat-admins').textContent     = state.superUsers.filter(u => u.rol === 'admin').length;
  $('sup-stat-mentores').textContent   = state.superUsers.filter(u => u.rol === 'mentor').length;
  $('sup-stat-pendientes').textContent = state.superUsers.filter(u => !u.rol).length;

  if (!rows.length) {
    list.innerHTML = '<div class="empty-state"><span>🌿</span><p>No hay usuarios en este filtro.</p></div>';
    return;
  }

  // Con filtro específico: lista plana sin encabezado
  if (f !== 'all') {
    const filtrados = rows.filter(u => {
      if (f === 'super_admin') return u.rol === 'super_admin';
      if (f === 'admin')       return u.rol === 'admin';
      if (f === 'mentor')      return u.rol === 'mentor';
      if (f === 'sin-rol')     return !u.rol;
      return true;
    });
    if (!filtrados.length) {
      list.innerHTML = '<div class="empty-state"><span>🌿</span><p>No hay usuarios en este filtro.</p></div>';
      return;
    }
    renderUserGroup(list, filtrados, 'super');
    return;
  }

  // Sin filtro: agrupar por rol con encabezados
  const grupos = [
    { label: 'Super Administradores', icon: '👑', items: rows.filter(u => u.rol === 'super_admin') },
    { label: 'Administradores',       icon: '🛡️', items: rows.filter(u => u.rol === 'admin') },
    { label: 'Mentores',              icon: '🌱', items: rows.filter(u => u.rol === 'mentor') },
    { label: 'Sin rol asignado',      icon: '⏳', items: rows.filter(u => !u.rol) },
  ];

  let hayAlgo = false;
  for (const grupo of grupos) {
    if (!grupo.items.length) continue;
    hayAlgo = true;
    list.insertAdjacentHTML('beforeend', `
      <div class="user-group-header">
        <span class="user-group-icon">${grupo.icon}</span>
        <span class="user-group-label">${grupo.label}</span>
        <span class="user-group-count">${grupo.items.length}</span>
      </div>
    `);
    renderUserGroup(list, grupo.items, 'super');
  }
  if (!hayAlgo) {
    list.innerHTML = '<div class="empty-state"><span>🌿</span><p>No hay resultados para esa búsqueda.</p></div>';
  }

  // Bindings
  $$('.user-rol-select', list).forEach(sel => {
    sel.onchange = () => changeRole(sel.dataset.id, sel.value || null);
  });
  $$('.btn-toggle-active', list).forEach(btn => {
    btn.onclick = () => toggleActive(btn.dataset.id);
  });
}

function renderUserGroup(container, users, context) {
  for (const u of users) {
    const av = u.avatar_url
      ? `<img class="user-row-avatar" src="${escapeHtml(u.avatar_url)}" alt=""/>`
      : `<div class="user-row-avatar-placeholder">${escapeHtml(initials(u))}</div>`;
    const isSelf = u.id === state.profile.id;
    const isSuperCtx = context === 'super';

    const rolSelect = isSuperCtx ? `
      <select class="user-rol-select" data-id="${u.id}" ${isSelf ? 'disabled' : ''}>
        <option value=""            ${!u.rol                ? 'selected':''}>— Sin rol —</option>
        <option value="mentor"      ${u.rol==='mentor'      ? 'selected':''}>Mentor</option>
        <option value="admin"       ${u.rol==='admin'       ? 'selected':''}>Admin</option>
        <option value="super_admin" ${u.rol==='super_admin' ? 'selected':''}>Super admin</option>
      </select>
      ${u.rol === 'admin' ? `
        <button class="toggle-stats ${u.puede_ver_estadisticas ? 'active' : ''}"
          data-id="${u.id}" data-activo="${u.puede_ver_estadisticas ? '1' : '0'}"
          title="${u.puede_ver_estadisticas ? 'Desactivar estadísticas' : 'Activar estadísticas'}">
          <span class="toggle-stats-dot"></span>
          Estadísticas
        </button>` : ''}
      <button class="btn-mini-danger btn-toggle-active" data-id="${u.id}"
        ${isSelf ? 'disabled' : ''} title="${u.activo ? 'Desactivar' : 'Activar'}">
        ${u.activo ? 'Desactivar' : 'Activar'}
      </button>` : `
      <select class="user-rol-select admU-rol-select" data-id="${u.id}">
        <option value=""       ${!u.rol           ? 'selected':''}>— Sin rol —</option>
        <option value="mentor" ${u.rol==='mentor' ? 'selected':''}>Mentor</option>
        <option value="admin"  ${u.rol==='admin'  ? 'selected':''}>Admin</option>
      </select>`;

    container.insertAdjacentHTML('beforeend', `
      <div class="user-row ${u.activo ? '' : 'inactive'}" data-id="${u.id}">
        ${av}
        <div class="user-row-info">
          <div class="user-row-name">
            ${escapeHtml(fullName(u))}
            ${isSelf ? ' <span class="role-badge role-super">vos</span>' : ''}
            ${!u.activo ? ' <span class="role-badge role-none">inactivo</span>' : ''}
          </div>
          <div class="user-row-email">${escapeHtml(u.email)}</div>
        </div>
        <div class="user-row-controls">${rolSelect}</div>
      </div>
    `);
  }

  // Bindings según contexto
  if (context === 'super') {
    $$('.user-rol-select:not(.admU-rol-select)', container).forEach(sel => {
      sel.onchange = () => changeRole(sel.dataset.id, sel.value || null);
    });
    $$('.btn-toggle-active', container).forEach(btn => {
      btn.onclick = () => toggleActive(btn.dataset.id);
    });
    $$('.toggle-stats', container).forEach(btn => {
      btn.onclick = () => {
        const activo = btn.dataset.activo === '1';
        toggleEstadisticasPermiso(btn.dataset.id, !activo);
      };
    });
  } else {
    $$('.admU-rol-select', container).forEach(sel => {
      sel.onchange = () => changeRoleAsAdmin(sel.dataset.id, sel.value || null);
    });
  }
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

/** Asignar rol vía RPC. La función SQL valida que seas super_admin. */
async function changeRole(userId, newRole) {
  const { error } = await db.rpc('admin_assign_role', {
    target_user: userId,
    new_rol: newRole
  });
  if (error) {
    console.error('admin_assign_role:', error);
    if (error.code === '42501')      toast('Sólo super_admin puede asignar roles', 'error');
    else if (error.code === '22023') toast('No podés quitarte el rol a vos mismo', 'error');
    else                              toast('Error: ' + error.message, 'error');
    loadSuperUsuarios();   // revertir el select visualmente
    return;
  }
  toast('Rol actualizado ✓');
  loadSuperUsuarios();
}

async function toggleActive(userId) {
  const u = state.superUsers.find(x => x.id === userId);
  if (!u) return;
  if (!confirm(`¿${u.activo ? 'Desactivar' : 'Activar'} a ${fullName(u)}?`)) return;

  const { error } = await db.rpc('admin_set_active', {
    target_user: userId,
    new_activo: !u.activo
  });
  if (error) {
    console.error('admin_set_active:', error);
    if (error.code === '42501')      toast('Sólo super_admin puede hacer esto', 'error');
    else if (error.code === '22023') toast('No podés desactivarte a vos mismo', 'error');
    else                              toast('Error: ' + error.message, 'error');
    return;
  }
  toast('Usuario actualizado ✓');
  loadSuperUsuarios();
}

/* ═══════════════════════════════════════════════════════════════
   VISTA ADMIN/SUPER · "Estadísticas"
   Efectividad por mentor calculada client-side sobre los datos
   ya cargados (no requiere tablas nuevas en BD).
═══════════════════════════════════════════════════════════════ */

let statsSort = 'efectividad';

async function loadEstadisticas() {
  // Verificar permiso (doble check: RLS en BD, UI aquí)
  const puedeVer = state.profile.rol === 'super_admin' || !!state.profile.puede_ver_estadisticas;
  $('stats-sin-permiso').classList.toggle('hidden', puedeVer);
  $('stats-contenido').classList.toggle('hidden', !puedeVer);
  if (!puedeVer) return;

  $('stats-mentor-list').innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Calculando estadísticas...</p></div>';

  // Cargar datos frescos siempre (no usar cache para evitar datos desactualizados)
  const [alumnosRes, mentoresRes] = await Promise.all([
    db.from('alumnos')
      .select('id,nombre,apellido,mentor_id,fecha_primer,fecha_ultimo,tipo_contacto,videollamada,respondio,activa,baja,eliminado')
      .eq('eliminado', false)
      .eq('baja', false),
    db.from('profiles')
      .select('id,nombre,apellido,email,avatar_url,rol')
      .eq('rol', 'mentor')
      .eq('activo', true)
  ]);

  if (alumnosRes.error || mentoresRes.error) {
    toast('Error al cargar estadísticas', 'error');
    return;
  }

  const todosAlumnos = alumnosRes.data || [];
  const mentores     = mentoresRes.data || [];

  // Calcular métricas por mentor
  const metricasMentor = mentores.map(mentor => {
    const alumnos = todosAlumnos.filter(a => a.mentor_id === mentor.id);
    const total   = alumnos.length;

    const conPrimer  = alumnos.filter(a => !!a.fecha_primer).length;
    const conSegundo = alumnos.filter(a =>
      a.fecha_primer && a.fecha_ultimo && a.fecha_primer !== a.fecha_ultimo
    ).length;
    const conLlamada = alumnos.filter(a => {
      const tipo = (a.tipo_contacto || '').toLowerCase();
      return a.videollamada || tipo.includes('videollamada') || tipo.includes('llamada');
    }).length;
    const sinContacto = alumnos.filter(a => !a.fecha_primer).length;
    const efectividad = total > 0 ? Math.round((conLlamada / total) * 100) : null;

    return {
      mentor,
      total,
      conPrimer,
      conSegundo,
      conLlamada,
      sinContacto,
      efectividad
    };
  });

  // KPIs globales
  const totalAlumnos  = todosAlumnos.length;
  const sinMentor     = todosAlumnos.filter(a => !a.mentor_id).length;
  const conAlumnos    = todosAlumnos.filter(a => !!a.mentor_id);
  const gConPrimer    = conAlumnos.filter(a => !!a.fecha_primer).length;
  const gConSegundo   = conAlumnos.filter(a =>
    a.fecha_primer && a.fecha_ultimo && a.fecha_primer !== a.fecha_ultimo).length;
  const gConLlamada   = conAlumnos.filter(a => {
    const tipo = (a.tipo_contacto || '').toLowerCase();
    return a.videollamada || tipo.includes('videollamada') || tipo.includes('llamada');
  }).length;
  const gSinContacto  = conAlumnos.filter(a => !a.fecha_primer).length;
  const gEfectividad  = conAlumnos.length > 0
    ? Math.round((gConLlamada / conAlumnos.length) * 100) : 0;

  $('kpi-total-alumnos').textContent  = totalAlumnos;
  $('kpi-contactados').textContent    = gConPrimer;
  $('kpi-segundo').textContent        = gConSegundo;
  $('kpi-llamada').textContent        = gConLlamada;
  $('kpi-sin-contacto').textContent   = gSinContacto;
  $('kpi-efectividad').textContent    = `${gEfectividad}%`;

  renderEstadisticasMentores(metricasMentor);

  // Listener del sort
  $('stats-sort').value = statsSort;
  $('stats-sort').onchange = (e) => {
    statsSort = e.target.value;
    renderEstadisticasMentores(metricasMentor);
  };
  $('btn-stats-refresh').onclick = () => loadEstadisticas();
}

function renderEstadisticasMentores(metricas) {
  const list = $('stats-mentor-list');

  // Ordenar
  const sorted = metricas.slice().sort((a, b) => {
    if (statsSort === 'efectividad') {
      const ea = a.efectividad ?? -1;
      const eb = b.efectividad ?? -1;
      return eb - ea;
    }
    if (statsSort === 'alumnos')      return b.total - a.total;
    if (statsSort === 'nombre')       return fullName(a.mentor).localeCompare(fullName(b.mentor));
    if (statsSort === 'sin-contacto') return b.sinContacto - a.sinContacto;
    return 0;
  });

  if (!sorted.length) {
    list.innerHTML = '<div class="empty-state"><span>🌿</span><p>No hay mentores activos con alumnos.</p></div>';
    return;
  }

  list.innerHTML = sorted.map(m => renderFilaMentor(m)).join('');
}

function renderFilaMentor({ mentor, total, conPrimer, conSegundo, conLlamada, sinContacto, efectividad }) {
  const av = mentor.avatar_url
    ? `<img class="user-row-avatar" src="${escapeHtml(mentor.avatar_url)}" alt="" style="width:40px;height:40px"/>`
    : `<div class="user-row-avatar-placeholder" style="width:40px;height:40px">${escapeHtml(initials(mentor))}</div>`;

  // Badge circular de efectividad
  let badgeCls = 'efectividad-nula';
  if (efectividad !== null) {
    if (efectividad >= 60)      badgeCls = 'efectividad-alta';
    else if (efectividad >= 30) badgeCls = 'efectividad-media';
    else                         badgeCls = 'efectividad-baja';
  }
  const efectividadTxt = efectividad !== null ? `${efectividad}%` : '—';

  // Porcentajes para las barras (sobre el total de alumnos asignados)
  const pct = (n) => total > 0 ? Math.round((n / total) * 100) : 0;
  const pPrimer   = pct(conPrimer);
  const pSegundo  = pct(conSegundo);
  const pLlamada  = pct(conLlamada);
  const pSin      = pct(sinContacto);

  return `
    <div class="stats-mentor-row">
      <!-- Info del mentor -->
      <div class="stats-mentor-info">
        ${av}
        <div>
          <div class="stats-mentor-name">${escapeHtml(fullName(mentor))}</div>
          <div class="stats-mentor-sub">${total} alumno${total !== 1 ? 's' : ''} asignado${total !== 1 ? 's' : ''}</div>
        </div>
      </div>

      <!-- Métricas + embudo -->
      <div class="stats-mentor-right">
        <!-- Números rápidos -->
        <div class="stats-nums-row">
          <div class="stats-num-item">
            <span class="stats-num-val">${total}</span>
            <span class="stats-num-label">Alumnos</span>
          </div>
          <div class="stats-num-item">
            <span class="stats-num-val">${conPrimer}</span>
            <span class="stats-num-label">1er ctcto</span>
          </div>
          <div class="stats-num-item">
            <span class="stats-num-val">${conSegundo}</span>
            <span class="stats-num-label">2do ctcto</span>
          </div>
          <div class="stats-num-item">
            <span class="stats-num-val">${conLlamada}</span>
            <span class="stats-num-label">Llamada</span>
          </div>
          <div class="stats-num-item">
            <span class="stats-num-val ${sinContacto > 0 ? 'val-warn' : ''}">${sinContacto}</span>
            <span class="stats-num-label">Sin ctcto</span>
          </div>
          <div class="stats-num-item">
            <div class="efectividad-badge ${badgeCls}">${efectividadTxt}</div>
            <span class="stats-num-label">Efect.</span>
          </div>
        </div>

        <!-- Barras del embudo -->
        <div class="stats-funnel">
          <div class="stats-funnel-row">
            <span class="stats-funnel-label">1er contacto</span>
            <div class="stats-funnel-track">
              <div class="stats-funnel-fill funnel-nivel-1" style="width:${pPrimer}%"></div>
            </div>
            <span class="stats-funnel-pct">${pPrimer}%</span>
          </div>
          <div class="stats-funnel-row">
            <span class="stats-funnel-label">2do contacto</span>
            <div class="stats-funnel-track">
              <div class="stats-funnel-fill funnel-nivel-2" style="width:${pSegundo}%"></div>
            </div>
            <span class="stats-funnel-pct">${pSegundo}%</span>
          </div>
          <div class="stats-funnel-row">
            <span class="stats-funnel-label">Llamada/Video</span>
            <div class="stats-funnel-track">
              <div class="stats-funnel-fill funnel-nivel-3" style="width:${pLlamada}%"></div>
            </div>
            <span class="stats-funnel-pct">${pLlamada}%</span>
          </div>
          ${sinContacto > 0 ? `
          <div class="stats-funnel-row">
            <span class="stats-funnel-label" style="color:#C4825A">Sin contacto</span>
            <div class="stats-funnel-track">
              <div class="stats-funnel-fill funnel-sin" style="width:${pSin}%"></div>
            </div>
            <span class="stats-funnel-pct" style="color:#C4825A">${pSin}%</span>
          </div>` : ''}
        </div>
      </div>
    </div>`;
}


/* ═══════════════════════════════════════════════════════════════
   SUPER ADMIN: toggle de permiso de estadísticas en userGroup
═══════════════════════════════════════════════════════════════ */

async function toggleEstadisticasPermiso(userId, puedeVer) {
  const { error } = await db.rpc('admin_set_estadisticas', {
    target_user: userId,
    puede: puedeVer
  });
  if (error) {
    console.error('admin_set_estadisticas:', error);
    toast('Error: ' + error.message, 'error');
    loadSuperUsuarios();
    return;
  }
  toast(puedeVer ? 'Acceso a estadísticas activado ✓' : 'Acceso a estadísticas desactivado');
  loadSuperUsuarios();
}

/* ═══════════════════════════════════════════════════════════════
   13.b VISTA ADMIN · "Usuarios" (versión restringida del super)
   Admins pueden asignar admin/mentor, no super_admin.
   No ven super_admins (la RLS los esconde).
   No pueden activar/desactivar.
═══════════════════════════════════════════════════════════════ */

async function loadAdminUsuarios() {
  // La RLS de profiles_admin_select ya filtra super_admins;
  // el admin sólo recibe lo que tiene permitido ver.
  const { data, error } = await db
    .from('profiles')
    .select('id,email,rol,nombre,apellido,avatar_url,activo,created_at')
    .order('created_at', { ascending: false });

  if (error) { toast('Error al cargar usuarios','error'); return; }
  state.adminUsers = data || [];
  renderAdminUsuarios();
}

function renderAdminUsuarios() {
  const list = $('admin-users-list');
  list.innerHTML = '';

  let rows = state.adminUsers.slice();
  const f = state.adminUsersFilter;

  if (state.adminUsersSearch) {
    const q = state.adminUsersSearch.toLowerCase();
    rows = rows.filter(u => [u.nombre,u.apellido,u.email]
      .filter(Boolean).some(v => v.toLowerCase().includes(q)));
  }

  // Stats
  $('admU-stat-total').textContent      = state.adminUsers.length;
  $('admU-stat-admins').textContent     = state.adminUsers.filter(u => u.rol === 'admin').length;
  $('admU-stat-mentores').textContent   = state.adminUsers.filter(u => u.rol === 'mentor').length;
  $('admU-stat-pendientes').textContent = state.adminUsers.filter(u => !u.rol).length;

  if (!rows.length) {
    list.innerHTML = '<div class="empty-state"><span>🌿</span><p>No hay usuarios en este filtro.</p></div>';
    return;
  }

  // Con filtro específico: lista plana
  if (f !== 'all') {
    const filtrados = rows.filter(u => {
      if (f === 'admin')   return u.rol === 'admin';
      if (f === 'mentor')  return u.rol === 'mentor';
      if (f === 'sin-rol') return !u.rol;
      return true;
    });
    if (!filtrados.length) {
      list.innerHTML = '<div class="empty-state"><span>🌿</span><p>No hay usuarios en este filtro.</p></div>';
      return;
    }
    renderUserGroup(list, filtrados, 'admin');
    return;
  }

  // Sin filtro: grupos con encabezado
  const grupos = [
    { label: 'Administradores',  icon: '🛡️', items: rows.filter(u => u.rol === 'admin') },
    { label: 'Mentores',         icon: '🌱', items: rows.filter(u => u.rol === 'mentor') },
    { label: 'Sin rol asignado', icon: '⏳', items: rows.filter(u => !u.rol) },
  ];

  let hayAlgo = false;
  for (const grupo of grupos) {
    if (!grupo.items.length) continue;
    hayAlgo = true;
    list.insertAdjacentHTML('beforeend', `
      <div class="user-group-header">
        <span class="user-group-icon">${grupo.icon}</span>
        <span class="user-group-label">${grupo.label}</span>
        <span class="user-group-count">${grupo.items.length}</span>
      </div>
    `);
    renderUserGroup(list, grupo.items, 'admin');
  }
  if (!hayAlgo) {
    list.innerHTML = '<div class="empty-state"><span>🌿</span><p>No hay resultados.</p></div>';
  }
}

async function changeRoleAsAdmin(userId, newRole) {
  // Misma RPC que usa el super: el chequeo de permisos vive en SQL.
  const { error } = await db.rpc('admin_assign_role', {
    target_user: userId,
    new_rol: newRole
  });
  if (error) {
    console.error('admin_assign_role:', error);
    if (error.code === '42501')      toast('No tenés permiso para asignar ese rol', 'error');
    else if (error.code === '22023') toast('No podés modificarte a vos mismo', 'error');
    else                              toast('Error: ' + error.message, 'error');
    loadAdminUsuarios();
    return;
  }
  toast('Rol actualizado ✓');
  loadAdminUsuarios();
}

$$('#admU-filter-chips .chip').forEach(chip => {
  chip.onclick = () => {
    $$('#admU-filter-chips .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    state.adminUsersFilter = chip.dataset.filter;
    renderAdminUsuarios();
  };
});
$('admU-search-users').addEventListener('input', e => {
  state.adminUsersSearch = e.target.value;
  renderAdminUsuarios();
});

/* ═══════════════════════════════════════════════════════════════
   13.c CHAT 1-a-1 mentor ↔ admin (Fase 4)

   Estado del chat:
   - chatRole: 'mentor' | 'admin' (según qué pestaña estamos)
   - chatConversations: lista cacheada de las conversaciones del usuario
   - chatPeers: lista de "del otro lado" (admins para el mentor,
     mentores para el admin) — sirve para crear chats nuevos
   - chatActive: la conversación abierta { id, peer }
   - chatMessages: mensajes de la conversación activa
   - realtimeChannel: canal de supabase (se desuscribe al cambiar)
   - unread: { conversationId: count } para badges
═══════════════════════════════════════════════════════════════ */

const chat = {
  conversations: [],
  peers: [],
  active: null,
  messages: [],
  realtimeChannel: null,   // canal local (sólo activo en la pestaña de mensajes)
  globalChannel: null,     // canal global (activo durante toda la sesión)
  globalConversations: [], // copia de las conversaciones para el canal global
  recentlyReadIds: new Set(), // ids marcados como leídos en el canal local
  unread: {},
  // ── Mensajes globales (broadcast) ──
  broadcastConvIds: new Set(),   // ids de conversaciones broadcast visibles (mentor)
  broadcastUnreadCount: 0,       // no leídos de broadcast (mentor)
  broadcastLastAt: null,         // última actividad de broadcasts (mentor)
  adminBroadcastConvId: null,    // id de MI propia conversación broadcast (admin)
  adminBroadcastLastAt: null,
  viewingAnuncios: false,        // mentor está viendo el feed de Administración
  viewingAdminBroadcast: false,  // admin está viendo su historial de broadcasts
  broadcastToastShown: false,    // para no repetir el toast de bienvenida varias veces
};

// Carga la lista de conversaciones del usuario + los peers disponibles.
// Para el mentor: peers = admins activos.
// Para el admin: peers = mentores activos.
async function loadChat(role) {
  const sidebarList = role === 'mentor' ? $('mnt-chat-list') : $('adm-chat-list');
  sidebarList.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Cargando...</p></div>';

  // 1) Conversaciones donde el usuario es participante
  const convQuery = db.from('conversations')
    .select('id, admin_id, mentor_id, last_message_at, created_at')
    .eq('is_broadcast', false);

  // 2) Profiles del "otro lado" (peers)
  const peersQuery = db.from('profiles')
    .select('id, email, nombre, apellido, avatar_url, rol')
    .eq('activo', true)
    .eq('rol', role === 'mentor' ? 'admin' : 'mentor');

  const [convRes, peersRes] = await Promise.all([convQuery, peersQuery]);

  if (convRes.error)  { toast('Error al cargar conversaciones', 'error'); return; }
  if (peersRes.error) { toast('Error al cargar usuarios', 'error'); return; }

  chat.conversations = convRes.data || [];
  chat.peers = peersRes.data || [];

  await refreshUnreadCounts(role);
  await loadBroadcastMeta(role);
  renderChatSidebar(role);
  subscribeRealtime(role);
}

// Carga metadata de mensajes globales: para el mentor, todas las
// conversaciones de broadcast visibles + cuántos no leyó.
// Para el admin, su propia conversación de broadcast (si existe).
async function loadBroadcastMeta(role) {
  if (role === 'mentor') {
    const { data: convs } = await db.from('conversations')
      .select('id, admin_id')
      .eq('is_broadcast', true);
    chat.broadcastConvIds = new Set((convs || []).map(c => c.id));

    // Fix: no confiar en conversations.last_message_at (podía quedar
    // desactualizado). Calculamos el preview directamente del último
    // mensaje real, visible (no eliminado).
    if (chat.broadcastConvIds.size) {
      const { data: ultimo } = await db.from('messages')
        .select('created_at')
        .in('conversation_id', [...chat.broadcastConvIds])
        .eq('eliminado', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      chat.broadcastLastAt = ultimo?.created_at || null;
    } else {
      chat.broadcastLastAt = null;
    }

    const { data: count } = await db.rpc('count_unread_broadcasts');
    chat.broadcastUnreadCount = count || 0;
  } else {
    const { data: conv } = await db.from('conversations')
      .select('id, last_message_at')
      .eq('admin_id', state.profile.id)
      .eq('is_broadcast', true)
      .maybeSingle();
    chat.adminBroadcastConvId  = conv?.id || null;

    // Mismo fix para el admin: preview desde el último mensaje propio real.
    if (chat.adminBroadcastConvId) {
      const { data: ultimo } = await db.from('messages')
        .select('created_at')
        .eq('conversation_id', chat.adminBroadcastConvId)
        .eq('eliminado', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      chat.adminBroadcastLastAt = ultimo?.created_at || null;
    } else {
      chat.adminBroadcastLastAt = null;
    }
  }
}

// Trae el conteo de mensajes no leídos por conversación (para mí).
// "no leído" = sender ≠ yo Y read_at is null
async function refreshUnreadCounts(role) {
  chat.unread = {};
  if (!chat.conversations.length) { updateBadge(role); return; }
  const ids = chat.conversations.map(c => c.id);
  const { data, error } = await db
    .from('messages')
    .select('conversation_id')
    .in('conversation_id', ids)
    .neq('sender_id', state.profile.id)
    .is('read_at', null);
  if (error) { console.error('unread:', error); return; }
  for (const m of (data || [])) {
    chat.unread[m.conversation_id] = (chat.unread[m.conversation_id] || 0) + 1;
  }
  updateBadge(role);
}

function updateBadge(role) {
  const total = Object.values(chat.unread).reduce((a,b) => a+b, 0) +
                (role === 'mentor' ? (chat.broadcastUnreadCount || 0) : 0);
  const badge = role === 'mentor' ? $('mnt-msg-badge') : $('adm-msg-badge');
  if (!badge) return;
  badge.textContent = total > 99 ? '99+' : total;
  badge.classList.toggle('hidden', total === 0);
}

function renderChatSidebar(role) {
  const sidebarList = role === 'mentor' ? $('mnt-chat-list') : $('adm-chat-list');
  sidebarList.innerHTML = '';

  // ── Pinned item de mensajes globales (siempre arriba de todo) ──
  if (role === 'mentor') {
    const unread = chat.broadcastUnreadCount || 0;
    sidebarList.insertAdjacentHTML('beforeend', `
      <div class="chat-item chat-item-pinned ${chat.viewingAnuncios ? 'active' : ''}" id="chat-item-anuncios">
        <div class="chat-item-avatar-broadcast">📢</div>
        <div class="chat-item-info">
          <div class="chat-item-name">Administración</div>
          <div class="chat-item-preview">${chat.broadcastLastAt ? 'Anuncios · ' + formatRelative(chat.broadcastLastAt) : 'Sin anuncios todavía'}</div>
        </div>
        ${unread > 0 ? `<span class="chat-item-unread">${unread > 99 ? '99+' : unread}</span>` : ''}
      </div>
    `);
  } else {
    sidebarList.insertAdjacentHTML('beforeend', `
      <div class="chat-item chat-item-pinned ${chat.viewingAdminBroadcast ? 'active' : ''}" id="chat-item-broadcast-admin">
        <div class="chat-item-avatar-broadcast">📢</div>
        <div class="chat-item-info">
          <div class="chat-item-name">Mensajes globales</div>
          <div class="chat-item-preview">${chat.adminBroadcastLastAt ? 'Enviado ' + formatRelative(chat.adminBroadcastLastAt) : 'Todavía no enviaste ninguno'}</div>
        </div>
      </div>
    `);
  }

  // Para mostrar peers: por defecto mentor ve TODOS los admins
  // (independiente de si ya hay conversación). Admin sólo ve los
  // que ya tienen conversación, y desde "Nuevo" abre el modal.
  let items;
  const convByPeerId = new Map();
  for (const c of chat.conversations) {
    const peerId = role === 'mentor' ? c.admin_id : c.mentor_id;
    if (peerId) convByPeerId.set(peerId, c);
  }

  if (role === 'mentor') {
    // listar TODOS los admins; si hay conversación, prepend
    items = chat.peers.map(p => ({ peer: p, conv: convByPeerId.get(p.id) || null }));
    items.sort((a, b) => {
      const ta = a.conv?.last_message_at || '';
      const tb = b.conv?.last_message_at || '';
      if (ta !== tb) return tb.localeCompare(ta);
      return fullName(a.peer).localeCompare(fullName(b.peer));
    });
  } else {
    // admin: sólo mentores con los que ya tengo conversación
    const peerById = new Map(chat.peers.map(p => [p.id, p]));
    items = chat.conversations
      .map(c => ({ peer: peerById.get(c.mentor_id), conv: c }))
      .filter(it => it.peer);
    // Filtro por búsqueda
    const q = ($('adm-chat-search')?.value || '').toLowerCase();
    if (q) {
      items = items.filter(it => [it.peer.nombre, it.peer.apellido, it.peer.email]
        .filter(Boolean).some(v => v.toLowerCase().includes(q)));
    }
    items.sort((a, b) => (b.conv.last_message_at || '').localeCompare(a.conv.last_message_at || ''));
  }

  if (!items.length) {
    sidebarList.insertAdjacentHTML('beforeend', role === 'mentor'
      ? '<div class="empty-state" style="padding:30px 16px"><span>🌿</span><p>No hay administradores disponibles.</p></div>'
      : '<div class="empty-state" style="padding:30px 16px"><span>💬</span><p>Aún no hay chats.<br/>Tocá "Nuevo" para empezar uno.</p></div>');
  } else {
    for (const { peer, conv } of items) {
      const unread = conv ? (chat.unread[conv.id] || 0) : 0;
      const isActive = chat.active && conv && chat.active.id === conv.id;
      const av = peer.avatar_url
        ? `<img class="chat-item-avatar" src="${escapeHtml(peer.avatar_url)}" alt=""/>`
        : `<div class="chat-item-avatar-placeholder">${escapeHtml(initials(peer))}</div>`;
      sidebarList.insertAdjacentHTML('beforeend', `
        <div class="chat-item ${isActive ? 'active' : ''}" data-peer-id="${peer.id}" data-conv-id="${conv?.id || ''}">
          ${av}
          <div class="chat-item-info">
            <div class="chat-item-name">${escapeHtml(fullName(peer))}</div>
            <div class="chat-item-preview">${conv?.last_message_at ? 'Última actividad: ' + formatRelative(conv.last_message_at) : 'Sin mensajes'}</div>
          </div>
          ${unread > 0 ? `<span class="chat-item-unread">${unread > 99 ? '99+' : unread}</span>` : ''}
          ${(role === 'admin' && conv) ? `
            <button class="chat-item-delete-btn" data-conv-id="${conv.id}" data-peer-name="${escapeHtml(fullName(peer))}" title="Eliminar conversación">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14a2,2,0,0,1-2,2H8a2,2,0,0,1-2-2L5,6"/><path d="M10,11v6"/><path d="M14,11v6"/></svg>
            </button>
          ` : ''}
        </div>
      `);
    }
  }

  $$('.chat-item:not(.chat-item-pinned)', sidebarList).forEach(el => {
    el.onclick = () => openConversation(role, el.dataset.peerId);
  });

  $$('.chat-item-delete-btn', sidebarList).forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      abrirEliminarConversacion(btn.dataset.convId, btn.dataset.peerName, role);
    };
  });

  // Bind del pinned item
  const pinnedAnuncios = document.getElementById('chat-item-anuncios');
  if (pinnedAnuncios) pinnedAnuncios.onclick = () => openAnunciosMentor();
  const pinnedBroadcastAdmin = document.getElementById('chat-item-broadcast-admin');
  if (pinnedBroadcastAdmin) pinnedBroadcastAdmin.onclick = () => openBroadcastAdminThread();
}

function formatRelative(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60)        return 'recién';
  if (diff < 3600)      return Math.floor(diff/60) + ' min';
  if (diff < 86400)     return Math.floor(diff/3600) + ' h';
  if (diff < 86400*7)   return Math.floor(diff/86400) + ' d';
  return d.toLocaleDateString('es-AR');
}

// Abre (o crea) la conversación con un peer y la muestra en el panel principal.
async function openConversation(role, peerId) {
  const peer = chat.peers.find(p => p.id === peerId);
  if (!peer) { toast('Usuario no encontrado','error'); return; }

  // Salir del modo "viendo anuncios/broadcast" si estaba activo
  chat.viewingAnuncios = false;
  chat.viewingAdminBroadcast = false;

  // Determinar admin_id y mentor_id en función del rol del que llama
  const admin_id  = role === 'mentor' ? peer.id : state.profile.id;
  const mentor_id = role === 'mentor' ? state.profile.id : peer.id;

  const { data: convId, error } = await db.rpc('get_or_create_conversation', {
    p_admin_id:  admin_id,
    p_mentor_id: mentor_id
  });
  if (error) {
    console.error('get_or_create_conversation:', error);
    toast('No se pudo abrir el chat: ' + error.message, 'error');
    return;
  }

  chat.active = { id: convId, peer };

  // Asegurar que la conversación esté en el cache local
  if (!chat.conversations.find(c => c.id === convId)) {
    chat.conversations.push({ id: convId, admin_id, mentor_id, last_message_at: null });
  }

  await loadMessages();
  renderChatMain(role);
  renderChatSidebar(role);  // refresca el "active" highlight

  // Vista mobile: ocultar sidebar, mostrar chat
  const layout = document.querySelector(`[data-chat-context="${role}"]`);
  layout?.classList.add('has-active');
}

async function loadMessages() {
  if (!chat.active) return;
  const { data, error } = await db
    .from('messages')
    .select('id, conversation_id, sender_id, body, created_at, read_at, eliminado, editado_at')
    .eq('conversation_id', chat.active.id)
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) {
    console.error('loadMessages:', error);
    return;
  }
  chat.messages = data || [];
  // Marcar como leídos los que no envié yo y no están leídos
  const unreadIds = chat.messages
    .filter(m => m.sender_id !== state.profile.id && m.read_at === null)
    .map(m => m.id);
  if (unreadIds.length) {
    await db.from('messages').update({ read_at: new Date().toISOString() }).in('id', unreadIds);
    // limpiar contador local
    chat.unread[chat.active.id] = 0;
  }
}

function renderChatMain(role) {
  const main = role === 'mentor' ? $('mnt-chat-main') : $('adm-chat-main');
  if (!chat.active) {
    main.innerHTML = role === 'mentor'
      ? '<div class="chat-empty"><span>💬</span><p>Elegí un administrador para empezar a conversar.</p></div>'
      : '<div class="chat-empty"><span>💬</span><p>Elegí un mentor de la lista o tocá "Nuevo".</p></div>';
    return;
  }
  const peer = chat.active.peer;
  const av = peer.avatar_url
    ? `<img class="chat-header-avatar" src="${escapeHtml(peer.avatar_url)}" alt=""/>`
    : `<div class="chat-header-avatar-placeholder">${escapeHtml(initials(peer))}</div>`;
  main.innerHTML = `
    <div class="chat-header">
      <button class="chat-header-back" id="chat-back" aria-label="Volver">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15,18 9,12 15,6"/></svg>
      </button>
      ${av}
      <div class="chat-header-info">
        <div class="chat-header-name">${escapeHtml(fullName(peer))}</div>
        <div class="chat-header-sub">${escapeHtml(peer.email)}</div>
      </div>
    </div>
    <div class="chat-messages" id="chat-messages"></div>
    <div class="chat-composer">
      <textarea id="chat-input" rows="1" placeholder="Escribí un mensaje..."></textarea>
      <button id="chat-send" title="Enviar" aria-label="Enviar">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </button>
    </div>
  `;

  renderMessages();

  // Auto-resize del textarea
  const ta = $('chat-input');
  ta.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('chat-send').click(); }
  });
  ta.focus();

  $('chat-send').onclick = () => sendMessage(role);
  $('chat-back').onclick = () => {
    const layout = document.querySelector(`[data-chat-context="${role}"]`);
    layout?.classList.remove('has-active');
    chat.active = null;
    renderChatMain(role);
  };
}

function renderMessages() {
  const container = $('chat-messages');
  if (!container) return;
  container.innerHTML = '';

  const visibles = chat.messages.filter(m => !m.eliminado);
  let lastDay = '';
  for (const m of visibles) {
    const d = new Date(m.created_at);
    const dayKey = d.toLocaleDateString('es-AR');
    if (dayKey !== lastDay) {
      const today = new Date().toLocaleDateString('es-AR');
      const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('es-AR');
      const label = dayKey === today ? 'Hoy' : (dayKey === yesterday ? 'Ayer' : dayKey);
      container.insertAdjacentHTML('beforeend', `<div class="chat-day-divider">${label}</div>`);
      lastDay = dayKey;
    }
    const fromMe = m.sender_id === state.profile.id;
    const hh = d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
    container.insertAdjacentHTML('beforeend', renderMsgBubbleHtml(m, fromMe, hh, 'chat'));
  }
  // scroll al final
  requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
  bindMsgActions(container, 'chat');
}

/* ── Burbuja de mensaje con soporte de editar/eliminar ──
   Reutilizada por chat 1-a-1, feed de anuncios (mentor) y el
   hilo de broadcast del admin. "context" identifica desde dónde
   se llama, para saber cómo refrescar tras editar/eliminar. */
function renderMsgBubbleHtml(m, fromMe, hh, context, extraClass = '', remitenteLabel = null) {
  // Un mensaje eliminado simplemente no se pinta: desaparece de la vista.
  if (m.eliminado) return '';

  const isEditing = msgEditingIds.has(m.id);
  const editedTag = m.editado_at ? ' <span class="msg-edited-tag">(editado)</span>' : '';
  const actions = (fromMe && !isEditing) ? `
    <div class="msg-actions">
      <button class="msg-action-btn msg-edit-btn" data-msg-id="${m.id}" data-context="${context}" title="Editar">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="msg-action-btn msg-delete-btn" data-msg-id="${m.id}" data-context="${context}" title="Eliminar">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14a2,2,0,0,1-2,2H8a2,2,0,0,1-2-2L5,6"/><path d="M10,11v6"/><path d="M14,11v6"/></svg>
      </button>
    </div>` : '';

  if (isEditing) {
    return `
      <div class="msg-bubble ${fromMe ? 'from-me' : 'from-them'} ${extraClass} msg-editing" data-msg-id="${m.id}">
        ${remitenteLabel ? `<div class="msg-broadcast-sender">📢 ${escapeHtml(remitenteLabel)}</div>` : ''}
        <textarea class="msg-edit-textarea" data-msg-id="${m.id}">${escapeHtml(m.body)}</textarea>
        <div class="msg-edit-actions">
          <button class="btn-mini-cancel msg-edit-cancel" data-msg-id="${m.id}" data-context="${context}">Cancelar</button>
          <button class="btn-mini-save msg-edit-save" data-msg-id="${m.id}" data-context="${context}">Guardar</button>
        </div>
      </div>
    `;
  }

  return `
    <div class="msg-bubble ${fromMe ? 'from-me' : 'from-them'} ${extraClass}" data-msg-id="${m.id}">
      ${actions}
      ${remitenteLabel ? `<div class="msg-broadcast-sender">📢 ${escapeHtml(remitenteLabel)}</div>` : ''}
      ${escapeHtml(m.body).replace(/\n/g, '<br/>')}
      <span class="msg-time">${hh}${editedTag}</span>
    </div>
  `;
}

// IDs de mensajes actualmente en modo edición (por instancia de app)
const msgEditingIds = new Set();

// Bindea los botones de editar/eliminar/guardar/cancelar dentro de un contenedor
function bindMsgActions(container, context) {
  $$('.msg-edit-btn', container).forEach(btn => {
    btn.onclick = () => {
      msgEditingIds.add(btn.dataset.msgId);
      refreshMsgContext(context);
    };
  });
  $$('.msg-edit-cancel', container).forEach(btn => {
    btn.onclick = () => {
      msgEditingIds.delete(btn.dataset.msgId);
      refreshMsgContext(context);
    };
  });
  $$('.msg-edit-save', container).forEach(btn => {
    btn.onclick = () => saveEditedMessage(btn.dataset.msgId, context);
  });
  $$('.msg-delete-btn', container).forEach(btn => {
    btn.onclick = () => deleteOwnMessage(btn.dataset.msgId, context);
  });
  // Enter (sin shift) guarda; Escape cancela
  $$('.msg-edit-textarea', container).forEach(ta => {
    ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEditedMessage(ta.dataset.msgId, context); }
      if (e.key === 'Escape') { msgEditingIds.delete(ta.dataset.msgId); refreshMsgContext(context); }
    });
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  });
}

// Re-renderiza el contexto correspondiente después de editar/cancelar/eliminar
function refreshMsgContext(context) {
  if (context === 'chat') { renderMessages(); return; }
  if (context === 'anuncios') { refreshAnunciosFeed(); return; }
  if (context === 'broadcast-admin') { refreshBroadcastAdminThread(); return; }
}

async function saveEditedMessage(msgId, context) {
  const ta = document.querySelector(`.msg-edit-textarea[data-msg-id="${msgId}"]`);
  if (!ta) return;
  const nuevoBody = ta.value.trim();
  if (!nuevoBody) { toast('El mensaje no puede quedar vacío', 'error'); return; }
  if (nuevoBody.length > 4000) { toast('Mensaje demasiado largo (máx 4000 caracteres)', 'error'); return; }

  const idNum = isNaN(+msgId) ? msgId : +msgId;
  const { error } = await db.from('messages')
    .update({ body: nuevoBody, editado_at: new Date().toISOString() })
    .eq('id', idNum)
    .eq('sender_id', state.profile.id); // doble seguridad además de RLS

  if (error) {
    toast('No se pudo editar: ' + error.message, 'error');
    return;
  }

  msgEditingIds.delete(msgId);

  // Actualizar cache local según contexto
  if (context === 'chat') {
    const m = chat.messages.find(x => String(x.id) === String(msgId));
    if (m) { m.body = nuevoBody; m.editado_at = new Date().toISOString(); }
  }
  refreshMsgContext(context);
}

async function deleteOwnMessage(msgId, context) {
  if (!confirm('¿Eliminar este mensaje? Esta acción no se puede deshacer.')) return;

  const idNum = isNaN(+msgId) ? msgId : +msgId;
  const { error } = await db.from('messages')
    .update({ eliminado: true, editado_at: new Date().toISOString() })
    .eq('id', idNum)
    .eq('sender_id', state.profile.id); // doble seguridad además de RLS

  if (error) {
    toast('No se pudo eliminar: ' + error.message, 'error');
    return;
  }

  if (context === 'chat') {
    const m = chat.messages.find(x => String(x.id) === String(msgId));
    if (m) m.eliminado = true;
  }
  refreshMsgContext(context);
  toast('Mensaje eliminado');
}

async function sendMessage(role) {
  const ta = $('chat-input');
  const body = ta.value.trim();
  if (!body || !chat.active) return;
  if (body.length > 4000) { toast('Mensaje demasiado largo (máx 4000 caracteres)', 'error'); return; }

  const btn = $('chat-send'); btn.disabled = true;
  // Optimistic: pintamos el mensaje al instante
  const optimistic = {
    id: 'tmp-' + Date.now(),
    conversation_id: chat.active.id,
    sender_id: state.profile.id,
    body, created_at: new Date().toISOString(), read_at: null
  };
  chat.messages.push(optimistic);
  renderMessages();
  ta.value = ''; ta.style.height = 'auto';

  const { data, error } = await db
    .from('messages')
    .insert({ conversation_id: chat.active.id, sender_id: state.profile.id, body })
    .select()
    .single();
  btn.disabled = false;

  if (error) {
    // Revertir optimistic
    chat.messages = chat.messages.filter(m => m.id !== optimistic.id);
    renderMessages();
    toast('No se pudo enviar: ' + error.message, 'error');
    return;
  }
  // Reemplazar el optimistic con el real
  const idx = chat.messages.findIndex(m => m.id === optimistic.id);
  if (idx >= 0) chat.messages[idx] = data;
  renderMessages();

  // Refrescar last_message_at en el cache local (el trigger ya lo hizo en BD)
  const conv = chat.conversations.find(c => c.id === chat.active.id);
  if (conv) conv.last_message_at = data.created_at;
  renderChatSidebar(role);
}

// Suscripción Realtime: escuchamos INSERT en messages de mis conversaciones.
// Esta función se llama desde loadChat (cuando abrís la pestaña de Mensajes)
// y gestiona el canal local que actualiza el stream de burbujas en tiempo real.
function subscribeRealtime(role) {
  // NO desuscribimos el canal global de notificaciones (chat.globalChannel).
  // Sólo manejamos el canal local de la vista de chat activa.
  if (chat.realtimeChannel) {
    db.removeChannel(chat.realtimeChannel);
    chat.realtimeChannel = null;
  }
  if (!chat.conversations.length) return;

  chat.realtimeChannel = db.channel('chat-local-' + state.profile.id)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages'
    }, async (payload) => {
      const m = payload.new;
      const conv = chat.conversations.find(c => c.id === m.conversation_id);
      if (!conv) {
        await loadChat(role);
        return;
      }

      // Si estoy mirando esa conversación: agregar burbuja + marcar leído
      if (chat.active && chat.active.id === m.conversation_id) {
        if (m.sender_id !== state.profile.id) {
          chat.messages.push(m);
          renderMessages();
          await db.from('messages').update({ read_at: new Date().toISOString() }).eq('id', m.id);
          // El canal global también habría disparado este mensaje; ignorarlo ahí
          chat.recentlyReadIds = chat.recentlyReadIds || new Set();
          chat.recentlyReadIds.add(m.id);
        }
      } else if (m.sender_id !== state.profile.id) {
        // En otra conversación del chat → sumar badge local
        chat.unread[m.conversation_id] = (chat.unread[m.conversation_id] || 0) + 1;
        updateBadge(role);
      }

      conv.last_message_at = m.created_at;
      renderChatSidebar(role);
    })
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'messages'
    }, async (payload) => {
      const m = payload.new;

      // Chat 1-a-1 actualmente abierto: parchear el mensaje editado/eliminado
      if (chat.active && chat.active.id === m.conversation_id) {
        const idx = chat.messages.findIndex(x => x.id === m.id);
        if (idx >= 0) {
          chat.messages[idx] = { ...chat.messages[idx], ...m };
          renderMessages();
        }
        return;
      }

      // Mentor mirando el feed de anuncios: refrescar si es un broadcast
      if (chat.viewingAnuncios && chat.broadcastConvIds.has(m.conversation_id)) {
        refreshAnunciosFeed();
        return;
      }

      // Admin mirando su propio hilo de broadcasts
      if (chat.viewingAdminBroadcast && m.conversation_id === chat.adminBroadcastConvId) {
        refreshBroadcastAdminThread();
        return;
      }
    })
    .subscribe();
}

function unsubscribeRealtime() {
  // Sólo cancela el canal local de la vista de chat.
  // El canal global (chat.globalChannel) se mantiene activo siempre.
  if (chat.realtimeChannel) {
    db.removeChannel(chat.realtimeChannel);
    chat.realtimeChannel = null;
  }
}

/* ──────────────────────────────────────────────────────────────
   CANAL GLOBAL DE NOTIFICACIONES
   Se inicia al loguear y permanece activo toda la sesión.
   Muestra toasts y actualiza badges sin importar en qué
   pestaña esté el usuario.
────────────────────────────────────────────────────────────── */

async function startGlobalNotifications(role) {
  // Limpiar canal anterior si existía (por ejemplo, al re-loguearse)
  if (chat.globalChannel) {
    db.removeChannel(chat.globalChannel);
    chat.globalChannel = null;
  }

  // Cargar conversaciones iniciales para saber cuáles son "mías"
  // y calcular el badge al entrar.
  await refreshGlobalUnread(role);

  // Mentor: si ya había anuncios sin leer al momento de loguear,
  // mostrar el cartel de aviso una vez (no repetir en cada cambio de pestaña).
  if (role === 'mentor' && chat.broadcastUnreadCount > 0 && !chat.broadcastToastShown) {
    chat.broadcastToastShown = true;
    showBroadcastToast();
  }

  chat.globalChannel = db.channel('chat-global-' + state.profile.id)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages'
    }, async (payload) => {
      const m = payload.new;

      // Ignorar mensajes propios
      if (m.sender_id === state.profile.id) return;

      // Ignorar mensajes que ya marcamos como leídos desde la vista de chat
      if (chat.recentlyReadIds?.has(m.id)) {
        chat.recentlyReadIds.delete(m.id);
        return;
      }

      // ── ¿Es un mensaje GLOBAL (broadcast)? Sólo aplica a mentores. ──
      if (role === 'mentor') {
        let esBroadcast = chat.broadcastConvIds.has(m.conversation_id);

        // Si no la conocíamos, puede ser un broadcast nuevo (primera vez
        // que un admin manda uno, o uno de un admin distinto) — verificar.
        if (!esBroadcast && !chat.globalConversations?.find(c => c.id === m.conversation_id)) {
          const { data: convCheck } = await db.from('conversations')
            .select('id, is_broadcast').eq('id', m.conversation_id).maybeSingle();
          if (convCheck?.is_broadcast) {
            chat.broadcastConvIds.add(convCheck.id);
            esBroadcast = true;
          }
        }

        if (esBroadcast) {
          chat.broadcastLastAt = m.created_at;
          const viendoAnuncios = state.currentView === 'mentor-mensajes' && chat.viewingAnuncios;
          if (viendoAnuncios) {
            // Ya está mirando el feed → refrescarlo en vivo en vez de
            // sólo actualizar el badge (si no, el mensaje no aparecería
            // hasta salir y volver a entrar).
            openAnunciosMentor();
          } else {
            chat.broadcastUnreadCount = (chat.broadcastUnreadCount || 0) + 1;
            updateBadge('mentor');
            showBroadcastToast();
          }
          if (state.currentView === 'mentor-mensajes' && !viendoAnuncios) renderChatSidebar('mentor');
          return; // no seguir tratándolo como mensaje 1-a-1
        }
      }

      // ¿Es de una conversación mía (1-a-1)?
      let conv = chat.globalConversations?.find(c => c.id === m.conversation_id);

      if (!conv) {
        // Conversación nueva iniciada por el otro — refrescar lista
        const { data } = await db
          .from('conversations')
          .select('id, admin_id, mentor_id, last_message_at')
          .eq('is_broadcast', false);
        chat.globalConversations = data || [];
        conv = chat.globalConversations.find(c => c.id === m.conversation_id);
        if (!conv) return; // no es mía
      }

      // Si el usuario está en la pestaña de mensajes mirando esta conversación
      // y el canal local ya la procesó, no duplicar
      const enChatActivo = state.currentView?.endsWith('-mensajes') &&
                           chat.active?.id === m.conversation_id;
      if (enChatActivo) return;

      // Actualizar badge
      chat.unread[m.conversation_id] = (chat.unread[m.conversation_id] || 0) + 1;
      updateBadge(role);

      // Si el usuario está en la pestaña de mensajes pero en OTRA conversación,
      // refrescar el sidebar (el canal local también lo hará, pero es rápido)
      if (state.currentView?.endsWith('-mensajes')) {
        conv.last_message_at = m.created_at;
        if (chat.conversations.length) renderChatSidebar(role);
      }

      // Toast de notificación con el nombre del remitente
      const sender = await getSenderName(m.sender_id);
      const preview = m.body.length > 50 ? m.body.slice(0, 50) + '…' : m.body;
      showNotifToast(sender, preview, role);
    })
    .subscribe();
}

// Cache de nombres de remitentes para no hacer una query por cada mensaje
const senderCache = new Map();
async function getSenderName(userId) {
  if (senderCache.has(userId)) return senderCache.get(userId);
  const { data } = await db.from('profiles')
    .select('nombre, apellido, email').eq('id', userId).single();
  const name = data ? fullName(data) : 'Alguien';
  senderCache.set(userId, name);
  return name;
}

// Carga el conteo inicial de no leídos al entrar (para el badge desde el arranque)
async function refreshGlobalUnread(role) {
  const { data: convData } = await db
    .from('conversations')
    .select('id, admin_id, mentor_id, last_message_at')
    .eq('is_broadcast', false);
  chat.globalConversations = convData || [];

  chat.unread = {};
  if (chat.globalConversations.length) {
    const ids = chat.globalConversations.map(c => c.id);
    const { data: unreadData } = await db
      .from('messages')
      .select('conversation_id')
      .in('conversation_id', ids)
      .neq('sender_id', state.profile.id)
      .is('read_at', null);

    for (const m of (unreadData || [])) {
      chat.unread[m.conversation_id] = (chat.unread[m.conversation_id] || 0) + 1;
    }
  }

  // Metadata de mensajes globales (broadcast) — sólo aplica a mentores.
  if (role === 'mentor') {
    const { data: bConvs } = await db.from('conversations')
      .select('id').eq('is_broadcast', true);
    chat.broadcastConvIds = new Set((bConvs || []).map(c => c.id));
    const { data: count } = await db.rpc('count_unread_broadcasts');
    chat.broadcastUnreadCount = count || 0;
  }

  updateBadge(role);
}

// Toast de notificación de mensaje nuevo — distinto al toast genérico,
// más discreto y con acción de "ir a mensajes"
function showNotifToast(sender, preview, role) {
  // Crear o reusar el elemento de notif-toast
  let nt = document.getElementById('notif-toast');
  if (!nt) {
    nt = document.createElement('div');
    nt.id = 'notif-toast';
    document.body.appendChild(nt);
  }

  nt.innerHTML = `
    <div class="notif-toast-inner">
      <div class="notif-toast-icon">💬</div>
      <div class="notif-toast-body">
        <div class="notif-toast-sender">${escapeHtml(sender)}</div>
        <div class="notif-toast-preview">${escapeHtml(preview)}</div>
      </div>
      <button class="notif-toast-action">Ver</button>
      <button class="notif-toast-close" aria-label="Cerrar">✕</button>
    </div>
  `;

  nt.className = 'notif-toast notif-toast-enter';

  // "Ver" → ir a la pestaña de mensajes
  nt.querySelector('.notif-toast-action').onclick = () => {
    nt.className = 'notif-toast notif-toast-exit';
    const view = role === 'mentor' ? 'mentor-mensajes' : 'admin-mensajes';
    switchView(view);
    $$('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  };

  // Cerrar manual
  nt.querySelector('.notif-toast-close').onclick = () => {
    nt.className = 'notif-toast notif-toast-exit';
  };

  // Auto-cerrar después de 6 segundos
  clearTimeout(nt._timer);
  nt._timer = setTimeout(() => {
    nt.className = 'notif-toast notif-toast-exit';
  }, 6000);
}

/* ═══════════════════════════════════════════════════════════════
   MENSAJES GLOBALES (broadcast) — admin → todos los mentores

   Modelo: una conversación is_broadcast=true por admin
   (mentor_id = null). Los mentores ven TODAS las conversaciones
   de broadcast (de cualquier admin) combinadas en un único feed
   de sólo lectura llamado "Administración".

   Lectura: como messages.read_at es una sola columna compartida
   (no sirve para 1-a-muchos), se usa la tabla broadcast_reads
   que registra la lectura POR MENTOR, vía las RPCs
   count_unread_broadcasts() y mark_all_broadcasts_read().
═══════════════════════════════════════════════════════════════ */

// Toast específico de mensaje global — siempre esquina inferior derecha,
// con la leyenda fija pedida, independiente del toast de chat 1-a-1.
function showBroadcastToast() {
  let nt = document.getElementById('broadcast-toast');
  if (!nt) {
    nt = document.createElement('div');
    nt.id = 'broadcast-toast';
    document.body.appendChild(nt);
  }
  nt.innerHTML = `
    <div class="notif-toast-inner">
      <div class="notif-toast-icon">📢</div>
      <div class="notif-toast-body">
        <div class="notif-toast-sender">Tienes un nuevo mensaje</div>
        <div class="notif-toast-preview">Administración envió un anuncio</div>
      </div>
      <button class="notif-toast-action">Ver</button>
      <button class="notif-toast-close" aria-label="Cerrar">✕</button>
    </div>
  `;
  nt.className = 'notif-toast notif-toast-broadcast notif-toast-enter';

  nt.querySelector('.notif-toast-action').onclick = () => {
    nt.className = 'notif-toast notif-toast-broadcast notif-toast-exit';
    switchView('mentor-mensajes');
    $$('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.view === 'mentor-mensajes'));
    setTimeout(() => openAnunciosMentor(), 150);
  };
  nt.querySelector('.notif-toast-close').onclick = () => {
    nt.className = 'notif-toast notif-toast-broadcast notif-toast-exit';
  };

  clearTimeout(nt._timer);
  nt._timer = setTimeout(() => {
    nt.className = 'notif-toast notif-toast-broadcast notif-toast-exit';
  }, 7000);
}

/* ── MENTOR: feed de anuncios (sólo lectura) ── */

async function openAnunciosMentor() {
  chat.active = null;
  chat.viewingAnuncios = true;
  chat.viewingAdminBroadcast = false;
  renderChatSidebar('mentor');

  const main = $('mnt-chat-main');
  main.innerHTML = `
    <div class="chat-header">
      <button class="chat-header-back" id="chat-back" aria-label="Volver">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15,18 9,12 15,6"/></svg>
      </button>
      <div class="chat-header-avatar-placeholder chat-item-avatar-broadcast">📢</div>
      <div class="chat-header-info">
        <div class="chat-header-name">Administración</div>
        <div class="chat-header-sub">Anuncios para todos los mentores</div>
      </div>
    </div>
    <div class="chat-messages" id="chat-messages">
      <div class="loading-state"><div class="spinner"></div><p>Cargando anuncios...</p></div>
    </div>
    <div class="broadcast-readonly-note">📨 Este es un mensaje informativo. Para responder, escribile directamente a un administrador desde la lista.</div>
  `;
  $('chat-back').onclick = () => {
    document.querySelector('[data-chat-context="mentor"]')?.classList.remove('has-active');
    chat.viewingAnuncios = false;
    renderChatMain('mentor');
  };

  document.querySelector('[data-chat-context="mentor"]')?.classList.add('has-active');

  const ids = [...chat.broadcastConvIds];
  if (!ids.length) {
    $('chat-messages').innerHTML = '<div class="empty-state" style="padding:30px"><span>📢</span><p>Todavía no hay anuncios.</p></div>';
    return;
  }

  const { data: msgs, error } = await db.from('messages')
    .select('id, conversation_id, sender_id, body, created_at, remitente_label, eliminado, editado_at')
    .in('conversation_id', ids)
    .order('created_at', { ascending: true })
    .limit(300);

  if (error) {
    $('chat-messages').innerHTML = '<div class="empty-state" style="padding:30px"><p>Error al cargar anuncios.</p></div>';
    return;
  }

  // Fallback de nombre si el mensaje no tiene remitente_label guardado
  const senderIds = [...new Set((msgs || []).map(m => m.sender_id))];
  let senderMap = new Map();
  if (senderIds.length) {
    const { data: senders } = await db.from('profiles')
      .select('id,nombre,apellido,email').in('id', senderIds);
    senderMap = new Map((senders || []).map(s => [s.id, s]));
  }

  renderAnunciosFeed(msgs || [], senderMap);

  // Fix: mantener el preview del sidebar ("Anuncios · hace X") sincronizado
  // con el mensaje visible más reciente (ignorando eliminados), en vez de
  // depender de conversations.last_message_at que puede no estar sincronizado.
  const visiblesOrdenados = (msgs || []).filter(m => !m.eliminado);
  if (visiblesOrdenados.length) {
    chat.broadcastLastAt = visiblesOrdenados[visiblesOrdenados.length - 1].created_at;
  }

  // Marcar todos como leídos de una — más eficiente que uno por uno
  await db.rpc('mark_all_broadcasts_read');
  chat.broadcastUnreadCount = 0;
  updateBadge('mentor');
  renderChatSidebar('mentor');
}

function renderAnunciosFeed(msgs, senderMap) {
  const cont = $('chat-messages');
  if (!cont) return;
  const visibles = (msgs || []).filter(m => !m.eliminado);
  if (!visibles.length) {
    cont.innerHTML = '<div class="empty-state" style="padding:30px"><span>📢</span><p>Todavía no hay anuncios.</p></div>';
    return;
  }
  cont.innerHTML = '';
  let lastDay = '';
  for (const m of visibles) {
    const d = new Date(m.created_at);
    const dayKey = d.toLocaleDateString('es-AR');
    if (dayKey !== lastDay) {
      const today = new Date().toLocaleDateString('es-AR');
      const yest  = new Date(Date.now() - 86400000).toLocaleDateString('es-AR');
      const label = dayKey === today ? 'Hoy' : (dayKey === yest ? 'Ayer' : dayKey);
      cont.insertAdjacentHTML('beforeend', `<div class="chat-day-divider">${label}</div>`);
      lastDay = dayKey;
    }
    const hh = d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
    const remitente = m.remitente_label || fullName(senderMap.get(m.sender_id)) || 'Administración';
    // fromMe siempre false acá: el mentor nunca es remitente de un broadcast, así que nunca ve controles.
    cont.insertAdjacentHTML('beforeend', renderMsgBubbleHtml(m, false, hh, 'anuncios', 'msg-bubble-broadcast', remitente));
  }
  requestAnimationFrame(() => { cont.scrollTop = cont.scrollHeight; });
}

// Vuelve a pedir y renderizar el feed de anuncios (usado tras un evento
// realtime de UPDATE mientras el mentor está mirando esta pestaña)
async function refreshAnunciosFeed() {
  const ids = [...chat.broadcastConvIds];
  if (!ids.length) return;
  const { data: msgs } = await db.from('messages')
    .select('id, conversation_id, sender_id, body, created_at, remitente_label, eliminado, editado_at')
    .in('conversation_id', ids)
    .order('created_at', { ascending: true })
    .limit(300);
  const senderIds = [...new Set((msgs || []).map(m => m.sender_id))];
  let senderMap = new Map();
  if (senderIds.length) {
    const { data: senders } = await db.from('profiles')
      .select('id,nombre,apellido,email').in('id', senderIds);
    senderMap = new Map((senders || []).map(s => [s.id, s]));
  }
  renderAnunciosFeed(msgs || [], senderMap);

  const visibles = (msgs || []).filter(m => !m.eliminado);
  chat.broadcastLastAt = visibles.length ? visibles[visibles.length - 1].created_at : null;
  renderChatSidebar('mentor');
}

/* ── ADMIN: historial de mis propios mensajes globales ── */

async function openBroadcastAdminThread() {
  chat.active = null;
  chat.viewingAdminBroadcast = true;
  renderChatSidebar('admin');

  const main = $('adm-chat-main');
  main.innerHTML = `
    <div class="chat-header">
      <button class="chat-header-back" id="chat-back" aria-label="Volver">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15,18 9,12 15,6"/></svg>
      </button>
      <div class="chat-header-avatar-placeholder chat-item-avatar-broadcast">📢</div>
      <div class="chat-header-info">
        <div class="chat-header-name">Mensajes globales</div>
        <div class="chat-header-sub">Visible para todos los mentores activos</div>
      </div>
    </div>
    <div class="chat-messages" id="chat-messages">
      <div class="loading-state"><div class="spinner"></div><p>Cargando...</p></div>
    </div>
    <button class="btn-primary btn-new-broadcast-inline" id="btn-broadcast-inline">
      📢 Nuevo mensaje global
    </button>
  `;
  $('chat-back').onclick = () => {
    document.querySelector('[data-chat-context="admin"]')?.classList.remove('has-active');
    chat.viewingAdminBroadcast = false;
    renderChatMain('admin');
  };
  $('btn-broadcast-inline').onclick = () => openBroadcastComposeModal();

  document.querySelector('[data-chat-context="admin"]')?.classList.add('has-active');

  if (chat.adminBroadcastConvId) {
    const { data } = await db.from('messages')
      .select('id, sender_id, body, created_at, remitente_label, eliminado, editado_at')
      .eq('conversation_id', chat.adminBroadcastConvId)
      .order('created_at', { ascending: true });
    renderBroadcastAdminMessages(data || []);
  } else {
    $('chat-messages').innerHTML = '<div class="empty-state" style="padding:30px"><span>📢</span><p>Todavía no enviaste ningún mensaje global.</p></div>';
  }
}

function renderBroadcastAdminMessages(msgs) {
  const cont = $('chat-messages');
  if (!cont) return;
  const visibles = (msgs || []).filter(m => !m.eliminado);
  if (!visibles.length) {
    cont.innerHTML = '<div class="empty-state" style="padding:30px"><span>📢</span><p>Todavía no enviaste ningún mensaje global.</p></div>';
    return;
  }
  cont.innerHTML = '';
  let lastDay = '';
  for (const m of visibles) {
    const d = new Date(m.created_at);
    const dayKey = d.toLocaleDateString('es-AR');
    if (dayKey !== lastDay) {
      const today = new Date().toLocaleDateString('es-AR');
      const yest  = new Date(Date.now() - 86400000).toLocaleDateString('es-AR');
      cont.insertAdjacentHTML('beforeend',
        `<div class="chat-day-divider">${dayKey === today ? 'Hoy' : (dayKey === yest ? 'Ayer' : dayKey)}</div>`);
      lastDay = dayKey;
    }
    const hh = d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
    // fromMe siempre true acá: es el propio historial de broadcasts del admin.
    cont.insertAdjacentHTML('beforeend', renderMsgBubbleHtml(m, true, hh, 'broadcast-admin', 'msg-bubble-broadcast', m.remitente_label || 'Administración'));
  }
  requestAnimationFrame(() => { cont.scrollTop = cont.scrollHeight; });
  bindMsgActions(cont, 'broadcast-admin');
}

// Vuelve a pedir y renderizar el hilo de broadcasts del admin (usado tras
// un evento realtime de UPDATE mientras está mirando esta pestaña)
async function refreshBroadcastAdminThread() {
  if (!chat.adminBroadcastConvId) return;
  const { data } = await db.from('messages')
    .select('id, sender_id, body, created_at, remitente_label, eliminado, editado_at')
    .eq('conversation_id', chat.adminBroadcastConvId)
    .order('created_at', { ascending: true });
  renderBroadcastAdminMessages(data || []);
}

/* ── ADMIN: modal de composición del mensaje global ── */

function openBroadcastComposeModal() {
  $('broadcast-texto').value = '';
  $('broadcast-error').classList.add('hidden');

  const sel = $('broadcast-remitente');
  sel.innerHTML = `
    <option value="Administración">Administración</option>
    <option value="${escapeHtml(fullName(state.profile))}">${escapeHtml(fullName(state.profile))}</option>
  `;

  $('modal-broadcast').classList.remove('hidden');
  setTimeout(() => $('broadcast-texto').focus(), 50);
}

$('adm-chat-broadcast').onclick = () => openBroadcastComposeModal();
$('broadcast-close').onclick    = () => $('modal-broadcast').classList.add('hidden');
$('broadcast-cancel').onclick   = () => $('modal-broadcast').classList.add('hidden');

$('broadcast-send').onclick = async () => {
  const body = $('broadcast-texto').value.trim();
  const remitente = $('broadcast-remitente').value;
  const err = $('broadcast-error');
  err.classList.add('hidden');

  if (!body) {
    err.textContent = 'Escribí un mensaje.';
    err.classList.remove('hidden'); return;
  }
  if (body.length > 4000) {
    err.textContent = 'El mensaje es demasiado largo (máx 4000 caracteres).';
    err.classList.remove('hidden'); return;
  }

  const btn = $('broadcast-send');
  btn.disabled = true; btn.textContent = 'Enviando...';

  // 1) Obtener (o crear) mi conversación de broadcast
  const { data: convId, error: convErr } = await db.rpc('get_or_create_broadcast', {
    p_admin_id: state.profile.id
  });
  if (convErr) {
    console.error('get_or_create_broadcast:', convErr);
    err.textContent = 'Error: ' + convErr.message;
    err.classList.remove('hidden');
    btn.disabled = false; btn.textContent = 'Enviar a todos';
    return;
  }
  chat.adminBroadcastConvId = convId;

  // 2) Insertar el mensaje
  const { data, error } = await db.from('messages')
    .insert({
      conversation_id: convId,
      sender_id: state.profile.id,
      body,
      remitente_label: remitente
    })
    .select()
    .single();

  btn.disabled = false; btn.textContent = 'Enviar a todos';

  if (error) {
    console.error('broadcast insert:', error);
    err.textContent = 'Error al enviar: ' + error.message;
    err.classList.remove('hidden');
    return;
  }

  chat.adminBroadcastLastAt = data.created_at;
  $('modal-broadcast').classList.add('hidden');
  toast('Mensaje enviado a todos los mentores ✓');

  // Si estoy viendo el thread de broadcast, refrescarlo
  if (chat.viewingAdminBroadcast) {
    const { data: msgs } = await db.from('messages')
      .select('id, sender_id, body, created_at, remitente_label, eliminado, editado_at')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true });
    renderBroadcastAdminMessages(msgs || []);
  }
  renderChatSidebar('admin');
};

$('broadcast-texto').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('broadcast-send').click();
});

// Listeners propios del admin (búsqueda y "Nuevo")
$('adm-chat-search')?.addEventListener('input', () => renderChatSidebar('admin'));

$('adm-chat-new').onclick = () => {
  const modal = $('modal-pick-mentor');
  const list = $('pick-mentor-list');
  $('pick-mentor-search').value = '';

  const render = (q = '') => {
    let items = chat.peers.slice();
    const qq = q.toLowerCase();
    if (qq) items = items.filter(p => [p.nombre,p.apellido,p.email]
      .filter(Boolean).some(v => v.toLowerCase().includes(qq)));
    items.sort((a,b) => fullName(a).localeCompare(fullName(b)));
    if (!items.length) {
      list.innerHTML = '<div class="empty-state" style="padding:20px"><p>No hay mentores.</p></div>';
      return;
    }
    list.innerHTML = items.map(p => {
      const av = p.avatar_url
        ? `<img class="chat-item-avatar" src="${escapeHtml(p.avatar_url)}" alt=""/>`
        : `<div class="chat-item-avatar-placeholder">${escapeHtml(initials(p))}</div>`;
      return `
        <div class="pick-item" data-id="${p.id}">
          ${av}
          <div class="chat-item-info">
            <div class="chat-item-name">${escapeHtml(fullName(p))}</div>
            <div class="chat-item-preview">${escapeHtml(p.email)}</div>
          </div>
        </div>`;
    }).join('');
    list.querySelectorAll('.pick-item').forEach(el => {
      el.onclick = () => {
        modal.classList.add('hidden');
        openConversation('admin', el.dataset.id);
      };
    });
  };
  render();
  $('pick-mentor-search').oninput = (e) => render(e.target.value);
  modal.classList.remove('hidden');
  setTimeout(() => $('pick-mentor-search').focus(), 50);
};
$('pick-mentor-close').onclick = () => $('modal-pick-mentor').classList.add('hidden');

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
   MODAL DETALLE ALUMNO (mentor) — Calendario + WhatsApp
═══════════════════════════════════════════════════════════════ */

function buildMiniCalendario(a) {
  const hoy   = new Date();
  const año   = hoy.getFullYear();
  const mes   = hoy.getMonth();
  const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const DIAS  = ['Do','Lu','Ma','Mi','Ju','Vi','Sa'];

  // Fechas con contacto registrado
  const fechasContacto = new Set();
  const addFecha = (d) => {
    if (!d) return;
    const f = new Date(d + 'T12:00:00');
    if (f.getFullYear() === año && f.getMonth() === mes) fechasContacto.add(f.getDate());
  };
  addFecha(a.fecha_primer);
  addFecha(a.fecha_ultimo);
  // Entradas del seguimiento [dd/mm/yyyy ...]
  const regex = /\[(\d{2})\/(\d{2})\/(\d{4})/g;
  let match;
  while ((match = regex.exec(a.seguimiento || '')) !== null) {
    const d = +match[1], mo = +match[2]-1, y = +match[3];
    if (y === año && mo === mes) fechasContacto.add(d);
  }

  // Próximo contacto sugerido (7 días después del último)
  let proximoContacto = null;
  const refFecha = a.fecha_ultimo || a.fecha_primer;
  if (refFecha) {
    const prox = new Date(refFecha + 'T12:00:00');
    prox.setDate(prox.getDate() + 7);
    if (prox.getFullYear() === año && prox.getMonth() === mes && prox > hoy)
      proximoContacto = prox.getDate();
  }

  const primerDia = new Date(año, mes, 1).getDay();
  const totalDias = new Date(año, mes+1, 0).getDate();

  let celdas = '';
  for (let i = 0; i < primerDia; i++) celdas += `<div class="cal-cell empty"></div>`;
  for (let d = 1; d <= totalDias; d++) {
    let cls = 'cal-cell';
    if (d === hoy.getDate()) cls += ' cal-hoy';
    if (fechasContacto.has(d)) cls += ' cal-contacto';
    if (d === proximoContacto) cls += ' cal-proximo';
    const title = fechasContacto.has(d) ? 'Contacto realizado' : d === proximoContacto ? 'Próximo contacto sugerido' : '';
    celdas += `<div class="${cls}" title="${escapeHtml(title)}">${d}</div>`;
  }

  return `
    <div class="mini-calendario">
      <div class="cal-header"><span class="cal-mes">${MESES[mes]} ${año}</span></div>
      <div class="cal-grid-header">${DIAS.map(d => `<div class="cal-day-name">${d}</div>`).join('')}</div>
      <div class="cal-grid">${celdas}</div>
      <div class="cal-leyenda">
        <span class="cal-ley-item"><span class="cal-dot cal-dot-contacto"></span>Contacto</span>
        <span class="cal-ley-item"><span class="cal-dot cal-dot-proximo"></span>Próximo sugerido</span>
        <span class="cal-ley-item"><span class="cal-dot cal-dot-hoy"></span>Hoy</span>
      </div>
      ${proximoContacto ? `<p class="cal-sugerencia">💬 Próximo contacto sugerido: día ${proximoContacto}</p>` : ''}
    </div>`;
}

function openDetail(alumnoId) {
  const a = state.mentorAlumnos.find(x => String(x.id) === String(alumnoId));
  if (!a) { toast('No se encontró el alumno','error'); return; }

  $('detail-nombre').textContent = `${a.nombre} ${a.apellido}`;
  const val = (v) => v ? `<span>${escapeHtml(v)}</span>` : `<span class="empty-val">—</span>`;
  const mensaje = getMensajeBienvenida(state.profile, a);
  const telefono = formatPhone(a.telefono);

  $('detail-body').innerHTML = `
    <!-- Crecimiento + estado -->
    <div class="detail-crecimiento-row">
      <div class="detail-crecimiento-visual">
        ${getIconoCrecimiento(a)}
        <div class="detail-crecimiento-label ${getNivelLabel(a).cls}">
          ${getNivelLabel(a).label}
        </div>
      </div>
      <div class="detail-activa-badge ${a.activa && !a.baja ? 'activa-si' : 'activa-no'}">
        ${a.baja
          ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg> Baja`
          : a.activa
            ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg> Activa`
            : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/></svg> Inactiva`}
      </div>
    </div>

    <!-- Mini Calendario -->
    <div class="detail-section">
      <div class="detail-section-title">Calendario de contactos</div>
      ${buildMiniCalendario(a)}
    </div>

    <!-- Mensaje de bienvenida + WhatsApp -->
    <div class="detail-section">
      <div class="detail-section-title-row">
        <span class="detail-section-title" style="margin-bottom:0">Mensaje de primer contacto</span>
        <button class="btn-copy-msg" id="btn-copy-msg">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          Copiar
        </button>
      </div>
      <div class="detail-text-block" id="detail-msg-text" style="margin-top:10px">${escapeHtml(mensaje)}</div>
      ${telefono
        ? `<button class="btn-whatsapp" id="btn-whatsapp" data-phone="${escapeHtml(telefono)}" data-msg="${escapeHtml(mensaje)}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
              Enviar por WhatsApp
            </button>`
        : `<div class="btn-whatsapp-disabled">Sin número de teléfono cargado</div>`}
    </div>

    <!-- Datos de contacto -->
    <div class="detail-section">
      <div class="detail-section-title">Contacto</div>
      <div class="detail-row">
        <div class="detail-item"><label>Teléfono</label>${val(a.telefono)}</div>
        <div class="detail-item"><label>Respondió</label>${val(a.respondio)}</div>
      </div>
      <div class="detail-row">
        <div class="detail-item"><label>Primer contacto</label>${val(formatDate(a.fecha_primer))}</div>
        <div class="detail-item"><label>Último contacto</label>${val(formatDate(a.fecha_ultimo))}</div>
      </div>
      <div class="detail-item"><label>Tipo de contacto</label>${val(a.tipo_contacto)}</div>
    </div>

    <!-- Inquietudes -->
    <div class="detail-section">
      <div class="detail-section-title">Inquietudes del estudiante</div>
      ${a.inquietudes?.trim()
        ? `<div class="detail-text-block">${escapeHtml(a.inquietudes.trim())}</div>`
        : `<span class="empty-val">Sin registrar</span>`}
    </div>

    <!-- Seguimiento -->
    <div class="detail-section">
      <div class="detail-section-title">Seguimiento</div>
      ${a.seguimiento?.trim()
        ? `<div class="detail-text-block">${escapeHtml(a.seguimiento.trim())}</div>`
        : `<span class="empty-val">Sin registrar</span>`}
    </div>
  `;

  $('modal-detail').classList.remove('hidden');

  // Copiar mensaje
  $('btn-copy-msg').onclick = async () => {
    try {
      await navigator.clipboard.writeText(mensaje);
      const btn = $('btn-copy-msg');
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20,6 9,17 4,12"/></svg> ¡Copiado!`;
      btn.style.borderColor = 'var(--accent)'; btn.style.color = 'var(--accent-dark)';
      setTimeout(() => {
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copiar`;
        btn.style.borderColor = ''; btn.style.color = '';
      }, 2000);
    } catch { toast('No se pudo copiar','error'); }
  };

  // WhatsApp
  const btnWA = $('btn-whatsapp');
  if (btnWA) {
    btnWA.onclick = () => {
      const url = `https://wa.me/${btnWA.dataset.phone}?text=${encodeForWhatsApp(btnWA.dataset.msg)}`;
      window.open(url, '_blank', 'noopener');
    };
  }

  // Botón editar del footer
  $('detail-btn-edit').onclick = () => {
    $('modal-detail').classList.add('hidden');
    openAlumnoForm(alumnoId);
  };
}

$('detail-close').onclick    = () => $('modal-detail').classList.add('hidden');
$('detail-btn-close').onclick = () => $('modal-detail').classList.add('hidden');
$('modal-detail').onclick = (e) => { if (e.target === $('modal-detail')) $('modal-detail').classList.add('hidden'); };

/* ═══════════════════════════════════════════════════════════════
   MODAL CONFIGURAR MENSAJE DE BIENVENIDA (mentor)
═══════════════════════════════════════════════════════════════ */

function getMensajeDefault() {
  const nombre = fullName(state.profile) || 'tu mentor/a';
  return `¡Hola! 👋 Mi nombre es ${nombre}, soy Counselor egresada de Holos Capital Counseling.\nMe pongo en contacto porque en esta etapa voy a acompañarte como tu mentora. 🌱\nLa mentoría es un espacio pensado para vos: para compartir dudas, orientarte en el camino y acompañarte desde la experiencia de haber transitado este mismo recorrido.\nEstoy disponible para lo que necesites, ya sea consultas académicas, orientación sobre la carrera o simplemente charlar sobre el proceso. No dudes en escribirme cuando quieras.\n¡Bienvenido/a a esta etapa! Estoy muy contenta de acompañarte. 😊\n${nombre}\nCounselor — Holos Capital Counseling`;
}

$('btn-config-mensaje').onclick = () => {
  $('config-msg-texto').value = state.profile.mensaje_bienvenida || getMensajeDefault();
  $('config-msg-error').classList.add('hidden');
  $('config-msg-ok').classList.add('hidden');
  $('modal-config-msg').classList.remove('hidden');
};

$('config-msg-close').onclick  = () => $('modal-config-msg').classList.add('hidden');
$('config-msg-cancel').onclick = () => $('modal-config-msg').classList.add('hidden');
$('config-msg-reset').onclick  = () => { $('config-msg-texto').value = getMensajeDefault(); };

$('config-msg-save').onclick = async () => {
  const texto = $('config-msg-texto').value.trim();
  $('config-msg-error').classList.add('hidden');
  $('config-msg-ok').classList.add('hidden');

  if (!texto) {
    $('config-msg-error').textContent = 'El mensaje no puede estar vacío.';
    $('config-msg-error').classList.remove('hidden'); return;
  }

  const btn = $('config-msg-save');
  btn.disabled = true; btn.textContent = 'Guardando...';

  const { error } = await db.from('profiles')
    .update({ mensaje_bienvenida: texto })
    .eq('id', state.profile.id);

  btn.disabled = false; btn.textContent = 'Guardar mensaje';

  if (error) {
    $('config-msg-error').textContent = 'Error: ' + error.message;
    $('config-msg-error').classList.remove('hidden'); return;
  }

  state.profile.mensaje_bienvenida = texto;
  $('config-msg-ok').textContent = '✓ Mensaje actualizado para todos tus alumnos.';
  $('config-msg-ok').classList.remove('hidden');
  setTimeout(() => $('modal-config-msg').classList.add('hidden'), 1500);
  toast('Mensaje de bienvenida actualizado ✓');
};

/* ═══════════════════════════════════════════════════════════════
   ASIGNACIÓN DE GRUPO MENTOR
   El admin selecciona alumnos para un mentor específico.
   Los alumnos ya asignados a otro mentor son visibles pero
   aparecen en una sección diferente con aviso.
═══════════════════════════════════════════════════════════════ */

const grupoState = {
  mentorId:   null,
  mentorName: null,
  color:      null,
  todos:      [],        // todos los alumnos activos
  seleccionados: new Set(), // ids de alumnos seleccionados
};

async function abrirAsignarGrupo(mentorId, mentorName, color) {
  grupoState.mentorId   = mentorId;
  grupoState.mentorName = mentorName;
  grupoState.color      = color;
  grupoState.seleccionados = new Set();

  // Header con color del mentor
  const header = $('grupo-modal-header');
  header.style.background = `linear-gradient(135deg, ${color}99, ${color}44)`;

  const av = $('grupo-avatar');
  av.style.background = color;
  av.textContent = mentorName.split(' ').map(p => p[0]).join('').slice(0,2).toUpperCase();

  $('grupo-mentor-name').textContent = mentorName;
  $('grupo-color-badge').textContent = `GRUPO DE MENTOR · ${mentorName.split(' ')[0].toUpperCase()}`;
  $('grupo-color-badge').style.background = `${color}99`;

  // Mostrar paso 1
  $('grupo-step-1').classList.remove('hidden');
  $('grupo-step-2').classList.add('hidden');
  $('grupo-search').value = '';
  $('grupo-alumno-list').innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Cargando alumnos...</p></div>';
  $('modal-asignar-grupo').classList.remove('hidden');

  // Cargar todos los alumnos activos
  const { data, error } = await db.from('alumnos')
    .select('id, nombre, apellido, numero_alumno, comision, mentor_id')
    .eq('baja', false)
    .eq('eliminado', false)
    .order('apellido');

  if (error) { toast('Error al cargar alumnos','error'); return; }
  grupoState.todos = data || [];

  // Pre-seleccionar los alumnos ya asignados a ESTE mentor
  grupoState.todos
    .filter(a => a.mentor_id === mentorId)
    .forEach(a => grupoState.seleccionados.add(a.id));

  renderGrupoList();
}

function renderGrupoList(filtro = '') {
  const list = $('grupo-alumno-list');
  list.innerHTML = '';

  // Separar en 3 grupos
  const mios       = grupoState.todos.filter(a => a.mentor_id === grupoState.mentorId);
  const libres     = grupoState.todos.filter(a => !a.mentor_id);
  const deOtro     = grupoState.todos.filter(a => a.mentor_id && a.mentor_id !== grupoState.mentorId);

  // Mapa de colores de otros mentores para mostrar su grupo
  const mentorColorMap = new Map(state.adminMentores.map(m => [m.id, { color: m.color_mentor, name: fullName(m) }]));

  const renderItem = (a, tipo) => {
    const nombre = `${a.apellido}, ${a.nombre}`;
    if (filtro && !nombre.toLowerCase().includes(filtro.toLowerCase())) return '';
    const checked = grupoState.seleccionados.has(a.id) ? 'checked' : '';
    const esOtro  = tipo === 'otro';
    const otroMentor = esOtro ? mentorColorMap.get(a.mentor_id) : null;
    const tag = tipo === 'mio'
      ? '<span class="grupo-alumno-tag tag-mine">Mi grupo</span>'
      : tipo === 'libre'
        ? '<span class="grupo-alumno-tag tag-free">Sin asignar</span>'
        : `<span class="grupo-alumno-tag tag-otro" style="background:${otroMentor?.color || '#FDF3DC'}44">${otroMentor?.name.split(' ')[0] || 'Otro'}</span>`;
    return `
      <div class="grupo-alumno-item ${checked} ${esOtro ? 'is-otro' : ''}" data-id="${a.id}">
        <div class="grupo-checkbox"></div>
        <div class="grupo-alumno-info">
          <div class="grupo-alumno-name">${escapeHtml(nombre)}</div>
          ${a.comision ? `<div class="grupo-alumno-sub">${escapeHtml(a.comision)}</div>` : ''}
        </div>
        ${tag}
      </div>`;
  };

  const secciones = [
    { label: `✅ Ya en este grupo (${mios.length})`, items: mios, tipo: 'mio' },
    { label: `⚪ Sin asignar (${libres.length})`, items: libres, tipo: 'libre' },
    { label: `🔶 Asignados a otro mentor (${deOtro.length})`, items: deOtro, tipo: 'otro' },
  ];

  let hayAlgo = false;
  for (const sec of secciones) {
    const html = sec.items.map(a => renderItem(a, sec.tipo)).join('');
    if (!html && filtro) continue;
    if (!sec.items.length && !filtro) {
      list.insertAdjacentHTML('beforeend', `<div class="grupo-section-label">${sec.label}</div>`);
      continue;
    }
    list.insertAdjacentHTML('beforeend', `<div class="grupo-section-label">${sec.label}</div>${html}`);
    hayAlgo = true;
  }

  if (!hayAlgo && filtro) {
    list.innerHTML = '<div class="empty-state" style="padding:24px"><span>🔍</span><p>Sin resultados para esa búsqueda.</p></div>';
  }

  // Bindings de checkboxes
  $$('.grupo-alumno-item', list).forEach(el => {
    el.onclick = () => {
      const id = parseInt(el.dataset.id);
      if (grupoState.seleccionados.has(id)) {
        grupoState.seleccionados.delete(id);
        el.classList.remove('checked');
      } else {
        grupoState.seleccionados.add(id);
        el.classList.add('checked');
      }
      actualizarContadorGrupo();
    };
  });

  actualizarContadorGrupo();
}

function actualizarContadorGrupo() {
  const n = grupoState.seleccionados.size;
  $('grupo-counter').textContent = `${n} alumno${n !== 1 ? 's' : ''} seleccionado${n !== 1 ? 's' : ''}`;
}

// Búsqueda en tiempo real
$('grupo-search').addEventListener('input', e => {
  renderGrupoList(e.target.value);
});

// Botón Aplicar → paso de confirmación
$('grupo-aplicar').onclick = () => {
  const sel = [...grupoState.seleccionados];
  const prev = grupoState.todos.filter(a => a.mentor_id === grupoState.mentorId).map(a => a.id);

  const agregados    = sel.filter(id => !prev.includes(id));
  const quitados     = prev.filter(id => !sel.includes(id));
  const reasignados  = agregados.filter(id => {
    const a = grupoState.todos.find(x => x.id === id);
    return a && a.mentor_id && a.mentor_id !== grupoState.mentorId;
  });

  const color = grupoState.color;
  $('grupo-confirm-content').innerHTML = `
    <div class="grupo-confirm-icon">👥</div>
    <p class="grupo-confirm-title">¿Confirmar asignación?</p>
    <p class="grupo-confirm-sub">El grupo quedará asignado como:</p>
    <span class="grupo-confirm-name" style="background:${color}77;color:#2C2417">
      GRUPO DE MENTOR · ${escapeHtml(grupoState.mentorName.toUpperCase())}
    </span>
    <div class="grupo-confirm-stats">
      <div class="grupo-confirm-stat"><strong>${sel.length}</strong>total asignados</div>
      ${agregados.length ? `<div class="grupo-confirm-stat"><strong>+${agregados.length}</strong>se agregan</div>` : ''}
      ${quitados.length  ? `<div class="grupo-confirm-stat"><strong>−${quitados.length}</strong>se quitan</div>` : ''}
      ${reasignados.length ? `<div class="grupo-confirm-stat"><strong>${reasignados.length}</strong>reasignados de otro mentor</div>` : ''}
    </div>
    ${reasignados.length ? `<p style="font-size:12px;color:#C4825A;margin-top:12px">⚠️ ${reasignados.length} alumno${reasignados.length > 1 ? 's' : ''} van a ser reasignados desde otro mentor.</p>` : ''}
  `;

  $('grupo-step-1').classList.add('hidden');
  $('grupo-step-2').classList.remove('hidden');
};

$('grupo-confirm-back').onclick = () => {
  $('grupo-step-2').classList.add('hidden');
  $('grupo-step-1').classList.remove('hidden');
};

// Ejecutar la asignación
$('grupo-confirm-ok').onclick = async () => {
  $('grupo-confirm-ok').disabled = true;
  $('grupo-confirm-ok').textContent = 'Aplicando...';

  const selArr = [...grupoState.seleccionados];
  const prev   = grupoState.todos.filter(a => a.mentor_id === grupoState.mentorId).map(a => a.id);
  const quitar = prev.filter(id => !selArr.includes(id));

  let errores = 0;

  // Asignar los seleccionados a este mentor
  if (selArr.length) {
    const { error } = await db.from('alumnos')
      .update({ mentor_id: grupoState.mentorId })
      .in('id', selArr);
    if (error) { console.error('asignar:', error); errores++; }
  }

  // Quitar de este mentor los que se deseleccionaron
  if (quitar.length) {
    const { error } = await db.from('alumnos')
      .update({ mentor_id: null })
      .in('id', quitar);
    if (error) { console.error('quitar:', error); errores++; }
  }

  $('grupo-confirm-ok').disabled = false;
  $('grupo-confirm-ok').textContent = 'Confirmar';
  $('modal-asignar-grupo').classList.add('hidden');

  if (errores) {
    toast('Algunos cambios no se pudieron aplicar', 'error');
  } else {
    toast(`✓ Grupo de ${escapeHtml(grupoState.mentorName)} actualizado`);
  }

  // Refrescar datos
  loadAdminAlumnos();
  loadAdminMentores();
};

$('grupo-close').onclick  = () => $('modal-asignar-grupo').classList.add('hidden');
$('grupo-cancel').onclick = () => $('modal-asignar-grupo').classList.add('hidden');

/* ═══════════════════════════════════════════════════════════════
   ACCIONES MASIVAS SOBRE ALUMNOS (admin)
   Permite seleccionar uno, varios o todos los alumnos visibles y
   dar de baja / habilitar / eliminar en bloque.

   Regla de homogeneidad: una misma selección sólo puede contener
   alumnos TODOS activos o TODOS de baja, nunca mezclados — porque
   la acción "Baja"/"Habilitar" es opuesta según el estado. Al
   seleccionar el primer alumno, los del otro grupo quedan
   bloqueados (grisados, no clickeables) hasta vaciar la selección.
═══════════════════════════════════════════════════════════════ */

const bulk = {
  active:  false,          // modo selección activo
  selected: new Set(),     // IDs de alumnos seleccionados
  action:  null,           // 'baja' | 'habilitar' | 'delete'
};

/* Determina el "modo" de la selección actual mirando el estado real
   (data-baja) de las tarjetas seleccionadas:
   - null        → no hay nada seleccionado
   - 'baja'      → todos los seleccionados están ACTIVOS (la acción los pondría de baja)
   - 'habilitar' → todos los seleccionados están DE BAJA (la acción los habilitaría) */
function getBulkSelectionMode() {
  if (!bulk.selected.size) return null;
  const grid = $('admin-alumnos-grid');
  if (!grid) return null;
  let hayActivos = false, hayBaja = false;
  bulk.selected.forEach(id => {
    const card = grid.querySelector(`.alumno-card[data-id="${id}"]`);
    if (!card) return;
    if (card.dataset.baja === '1') hayBaja = true; else hayActivos = true;
  });
  if (hayBaja && !hayActivos) return 'habilitar';
  return 'baja'; // todos activos (o mezcla imposible por la validación al seleccionar)
}

/* ── Activar/desactivar modo selección ── */
$('btn-bulk-toggle').onclick = () => {
  bulk.active = !bulk.active;
  bulk.selected.clear();
  $('btn-bulk-toggle').classList.toggle('active', bulk.active);
  $('btn-bulk-toggle').innerHTML = bulk.active
    ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Cancelar`
    : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9,11 12,14 22,4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> Seleccionar`;

  // Activar/desactivar clase bulk-mode en el grid
  const grid = $('admin-alumnos-grid');
  if (grid) grid.classList.toggle('bulk-mode', bulk.active);

  actualizarBulkBar();
  actualizarBloqueoTarjetas();
};

$('btn-bulk-cancel').onclick = () => {
  bulk.active = false;
  bulk.selected.clear();
  $('btn-bulk-toggle').classList.remove('active');
  $('btn-bulk-toggle').innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9,11 12,14 22,4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2h11"/></svg> Seleccionar`;
  const grid = $('admin-alumnos-grid');
  if (grid) {
    grid.classList.remove('bulk-mode');
    $$('.alumno-card', grid).forEach(c => {
      c.classList.remove('bulk-selected');
      c.classList.remove('bulk-locked');
    });
  }
  actualizarBulkBar();
};

/* ── Seleccionar / deseleccionar un alumno ── */
function toggleBulkCard(cardEl, id) {
  if (!bulk.active) return;
  if (cardEl.classList.contains('bulk-locked')) return; // bloqueado por homogeneidad

  const cardEsBaja = cardEl.dataset.baja === '1';

  if (bulk.selected.has(id)) {
    bulk.selected.delete(id);
    cardEl.classList.remove('bulk-selected');
  } else {
    // Validar homogeneidad: no se puede mezclar activos con de baja
    const modoActual = getBulkSelectionMode(); // null | 'baja' | 'habilitar'
    if (modoActual === 'baja' && cardEsBaja) {
      toast('No podés mezclar alumnos activos y de baja en la misma selección', 'error');
      return;
    }
    if (modoActual === 'habilitar' && !cardEsBaja) {
      toast('No podés mezclar alumnos activos y de baja en la misma selección', 'error');
      return;
    }
    bulk.selected.add(id);
    cardEl.classList.add('bulk-selected');
  }
  actualizarBulkBar();
  actualizarBloqueoTarjetas();
}

/* Grisa y bloquea las tarjetas del grupo opuesto al de la selección
   actual, para que sea imposible tocarlas mientras haya algo
   seleccionado del otro estado. */
function actualizarBloqueoTarjetas() {
  const grid = $('admin-alumnos-grid');
  if (!grid) return;
  const modo = getBulkSelectionMode(); // null | 'baja' | 'habilitar'

  $$('.alumno-card:not(.is-eliminado)', grid).forEach(card => {
    const esBaja = card.dataset.baja === '1';
    const id = +card.dataset.id;
    let bloquear = false;
    if (modo === 'baja')      bloquear = esBaja;   // selección = activos → bloquear los de baja
    if (modo === 'habilitar') bloquear = !esBaja;  // selección = de baja → bloquear los activos
    card.classList.toggle('bulk-locked', bloquear && !bulk.selected.has(id));
  });
}

/* ── Seleccionar todos ── */
$('bulk-select-all').onclick = () => {
  const grid = $('admin-alumnos-grid');
  if (!grid) return;

  // "Seleccionar todos" respeta la homogeneidad: si ya hay algo
  // seleccionado, sólo suma los del mismo grupo (activos o de baja).
  const modo = getBulkSelectionMode();
  let cards = $$('.alumno-card:not(.is-eliminado)', grid);
  if (modo === 'baja')      cards = cards.filter(c => c.dataset.baja !== '1');
  if (modo === 'habilitar') cards = cards.filter(c => c.dataset.baja === '1');

  const todosSeleccionados = cards.every(c => bulk.selected.has(+c.dataset.id));

  if (todosSeleccionados) {
    cards.forEach(c => { bulk.selected.delete(+c.dataset.id); c.classList.remove('bulk-selected'); });
    $('bulk-select-all').textContent = 'Seleccionar todos';
  } else {
    cards.forEach(c => { bulk.selected.add(+c.dataset.id); c.classList.add('bulk-selected'); });
    $('bulk-select-all').textContent = 'Deseleccionar todos';
  }
  actualizarBulkBar();
  actualizarBloqueoTarjetas();
};

/* ── Actualizar la barra, el contador y el botón dinámico Baja/Habilitar ── */
function actualizarBulkBar() {
  const n = bulk.selected.size;
  $('bulk-bar').classList.toggle('hidden', !bulk.active);
  $('bulk-count').textContent = `${n} alumno${n !== 1 ? 's' : ''} seleccionado${n !== 1 ? 's' : ''}`;

  // El botón cambia de "Baja" a "Habilitar" según qué tipo de
  // alumnos hay seleccionados en este momento.
  const modo = getBulkSelectionMode(); // null | 'baja' | 'habilitar'
  const btnBaja = $('btn-bulk-disable');
  if (modo === 'habilitar') {
    btnBaja.classList.add('btn-bulk-habilitar-mode');
    btnBaja.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20,6 9,17 4,12"/></svg> Habilitar`;
  } else {
    btnBaja.classList.remove('btn-bulk-habilitar-mode');
    btnBaja.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg> Baja`;
  }

  btnBaja.disabled = n === 0;
  $('btn-bulk-delete').disabled = n === 0;
}

/* ── Abrir modal de confirmación ── */
$('btn-bulk-disable').onclick = () => {
  const modo = getBulkSelectionMode(); // 'baja' o 'habilitar' según la selección actual
  abrirBulkConfirm(modo === 'habilitar' ? 'habilitar' : 'baja');
};
$('btn-bulk-delete').onclick  = () => abrirBulkConfirm('delete');

function abrirBulkConfirm(action) {
  if (!bulk.selected.size) return;
  bulk.action = action;
  const n = bulk.selected.size;
  const isDelete = action === 'delete';
  const isHabilitar = action === 'habilitar';

  $('bulk-confirm-title').textContent = isDelete
    ? `Eliminar ${n} alumno${n > 1 ? 's' : ''}`
    : isHabilitar
      ? `Habilitar ${n} alumno${n > 1 ? 's' : ''}`
      : `Dar de baja ${n} alumno${n > 1 ? 's' : ''}`;

  $('bulk-confirm-desc').innerHTML = isDelete
    ? `Esta acción <strong>no tiene vuelta atrás fácil</strong>. Los ${n} alumno${n > 1 ? 's' : ''} seleccionado${n > 1 ? 's' : ''} quedar${n > 1 ? 'á' : 'án'} eliminado${n > 1 ? 's' : ''} y dejar${n > 1 ? 'án' : 'á'} de aparecer en los listados de todos los mentores.`
    : isHabilitar
      ? `Los ${n} alumno${n > 1 ? 's' : ''} seleccionado${n > 1 ? 's' : ''} vuelven a estar activos, sin perder ningún dato cargado.`
      : `Los ${n} alumno${n > 1 ? 's' : ''} seleccionado${n > 1 ? 's' : ''} quedar${n > 1 ? 'án' : 'á'} marcado${n > 1 ? 's' : ''} como <strong>de baja</strong>. Van a seguir viéndose en el listado del mentor (marcados como de baja) y en el filtro "Bajas". Podés habilitarlo${n > 1 ? 's' : ''} de nuevo más adelante, sin perder ningún dato cargado.`;

  // La palabra ELIMINAR solo se pide para borrado
  $('bulk-confirm-word-wrap').classList.toggle('hidden', !isDelete);
  if (isDelete) {
    $('bulk-confirm-word').value = '';
    setTimeout(() => $('bulk-confirm-word').focus(), 50);
  }

  $('bulk-confirm-error').classList.add('hidden');
  $('bulk-confirm-ok').style.background = isDelete ? '#B85450' : (isHabilitar ? '#6B9A64' : '#C4825A');
  $('bulk-confirm-ok').textContent = isDelete ? 'Sí, eliminar' : (isHabilitar ? 'Sí, habilitar' : 'Sí, dar de baja');
  $('modal-bulk-confirm').classList.remove('hidden');
}

$('bulk-confirm-close').onclick      = () => $('modal-bulk-confirm').classList.add('hidden');
$('bulk-confirm-cancel-btn').onclick = () => $('modal-bulk-confirm').classList.add('hidden');

/* Confirmar con Enter si ya escribió ELIMINAR */
$('bulk-confirm-word').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('bulk-confirm-ok').click();
});

/* ── Ejecutar la acción masiva ── */
$('bulk-confirm-ok').onclick = async () => {
  const isDelete     = bulk.action === 'delete';
  const isHabilitar  = bulk.action === 'habilitar';
  const err = $('bulk-confirm-error');
  err.classList.add('hidden');

  // Validar la palabra ELIMINAR
  if (isDelete) {
    const palabra = ($('bulk-confirm-word').value || '').trim().toUpperCase();
    if (palabra !== 'ELIMINAR') {
      err.textContent = 'Escribí la palabra ELIMINAR para confirmar.';
      err.classList.remove('hidden');
      $('bulk-confirm-word').focus();
      return;
    }
  }

  const ids = [...bulk.selected];
  const btn = $('bulk-confirm-ok');
  btn.disabled = true;
  btn.textContent = 'Aplicando...';

  const payload = isDelete
    ? { eliminado: true, mentor_id: null }
    : isHabilitar
      ? { baja: false }
      : { baja: true };

  const { error } = await db.from('alumnos')
    .update(payload)
    .in('id', ids);

  btn.disabled = false;
  btn.textContent = isDelete ? 'Sí, eliminar' : (isHabilitar ? 'Sí, habilitar' : 'Sí, dar de baja');

  if (error) {
    console.error('bulk action:', error);
    err.textContent = 'Error: ' + error.message;
    err.classList.remove('hidden');
    return;
  }

  $('modal-bulk-confirm').classList.add('hidden');

  const n = ids.length;
  toast(isDelete
    ? `✓ ${n} alumno${n > 1 ? 's' : ''} eliminado${n > 1 ? 's' : ''}`
    : isHabilitar
      ? `✓ ${n} alumno${n > 1 ? 's' : ''} habilitado${n > 1 ? 's' : ''}`
      : `✓ ${n} alumno${n > 1 ? 's' : ''} dado${n > 1 ? 's' : ''} de baja`
  );

  // Salir del modo selección y refrescar
  $('btn-bulk-cancel').click();
  loadAdminAlumnos();
};

/* ═══════════════════════════════════════════════════════════════
   IMPORTACIÓN DE ALUMNOS DESDE EXCEL (v0.0.2)
   Flujo:
   1. Admin selecciona / arrastra un .xlsx
   2. SheetJS lo procesa client-side (sin subir nada al servidor)
   3. Se consultan los numero_alumno existentes en BD
   4. Se clasifica cada fila del Excel como "nuevo" o "existe"
   5. Si hay existentes, se pregunta: pisar o agregar sólo faltantes
   6. Se insertan/actualizan de a lotes de 50 con barra de progreso
═══════════════════════════════════════════════════════════════ */

// Estado local de la importación
const importState = {
  rows: [],        // filas parseadas del Excel [{numero, apellido, nombre, ...}]
  existing: new Map(), // numero_alumno → id de alumno existente en BD
  mode: 'merge',   // 'merge' | 'skip'
};

function openImportModal() {
  // Reset al paso 1
  $('import-step-1').classList.remove('hidden');
  $('import-step-2').classList.add('hidden');
  $('import-step-3').classList.add('hidden');
  $('import-step-4').classList.add('hidden');
  $('import-error').classList.add('hidden');
  $('import-error').textContent = '';
  $('import-confirm').classList.add('hidden');
  $('import-done').classList.add('hidden');
  $('import-change-file').classList.add('hidden');
  $('import-cancel').classList.remove('hidden');
  $('import-file-input').value = '';
  importState.rows = [];
  importState.existing = new Map();
  $('modal-import').classList.remove('hidden');
}

$('btn-import-excel').onclick = () => openImportModal();
$('import-close').onclick   = () => $('modal-import').classList.add('hidden');
$('import-cancel').onclick  = () => $('modal-import').classList.add('hidden');
$('import-change-file').onclick = () => openImportModal();

// Dropzone click → abrir file picker
$('import-dropzone').onclick = () => $('import-file-input').click();

// Drag & drop
$('import-dropzone').addEventListener('dragover', e => {
  e.preventDefault();
  $('import-dropzone').classList.add('drag-over');
});
$('import-dropzone').addEventListener('dragleave', () => {
  $('import-dropzone').classList.remove('drag-over');
});
$('import-dropzone').addEventListener('drop', e => {
  e.preventDefault();
  $('import-dropzone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleImportFile(file);
});

$('import-file-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) handleImportFile(file);
});

// Leer y parsear el Excel con SheetJS
async function handleImportFile(file) {
  const err = $('import-error');
  err.classList.add('hidden');

  if (!file.name.match(/\.(xlsx|xls)$/i)) {
    err.textContent = 'El archivo debe ser .xlsx o .xls';
    err.classList.remove('hidden'); return;
  }

  try {
    const buf  = await file.arrayBuffer();
    const wb   = XLSX.read(buf, { type: 'array' });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    // La primera fila del Excel es un encabezado de título (Quinttos...),
    // la segunda es la cabecera real (#, Apellido, etc.)
    // Usamos defval:'' para que las celdas vacías sean strings vacíos
    const raw  = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // Encontrar la fila que tiene '#' como primera celda → esa es la cabecera
    const headerIdx = raw.findIndex(r =>
      String(r[0]).trim() === '#' || String(r[0]).trim().toLowerCase() === '#'
    );
    if (headerIdx === -1) {
      err.textContent = 'No se encontró la fila de cabecera con "#, Apellido, Nombre...". Verificá el formato del archivo.';
      err.classList.remove('hidden'); return;
    }

    const headers = raw[headerIdx].map(h => String(h).trim().toLowerCase());
    const dataRows = raw.slice(headerIdx + 1).filter(r => r[0] !== '' && r[0] !== null);

    const col = (name) => {
      const aliases = {
        'numero':   ['#', 'numero', 'nro', 'n°', 'num'],
        'apellido': ['apellido'],
        'nombre':   ['nombre'],
        'comision': ['comisión', 'comision'],
        'situacion':['situación', 'situacion'],
        'email':    ['mail', 'email', 'correo'],
        'celular':  ['celular'],
      };
      const alts = aliases[name] || [name];
      for (const alt of alts) {
        const idx = headers.findIndex(h => h.includes(alt));
        if (idx !== -1) return idx;
      }
      return -1;
    };

    const idx = {
      numero:    col('numero'),
      apellido:  col('apellido'),
      nombre:    col('nombre'),
      comision:  col('comision'),
      situacion: col('situacion'),
      email:     col('email'),
      celular:   col('celular'),
    };

    // Parsear filas
    importState.rows = dataRows.map(r => {
      const celular = String(r[idx.celular] ?? '').replace(/^'/, '').trim(); // quitar el ' inicial que a veces pone Excel
      const numero  = parseInt(r[idx.numero]);
      return {
        numero_alumno: isNaN(numero) ? null : numero,
        apellido:      String(r[idx.apellido] ?? '').trim(),
        nombre:        String(r[idx.nombre]   ?? '').trim(),
        comision:      idx.comision  >= 0 ? String(r[idx.comision]  ?? '').trim() : '',
        situacion:     idx.situacion >= 0 ? String(r[idx.situacion] ?? '').trim() : '',
        email:         idx.email     >= 0 ? String(r[idx.email]     ?? '').trim() : '',
        telefono:      celular,
      };
    }).filter(r => r.apellido || r.nombre); // filtrar filas vacías

    if (!importState.rows.length) {
      err.textContent = 'No se encontraron alumnos en el archivo.';
      err.classList.remove('hidden'); return;
    }

    // ── Filtrar solo las comisiones permitidas ──────────────────
    // Solo se importan alumnos cuya Comisión sea exactamente una
    // de las 8 comisiones definidas para Holos Mentorías.
    const COMISIONES_PERMITIDAS = new Set([
      '1° 1° TS TDH (Agosto)',
      '1° 1° TS TDH (Marzo)',
      '1° 1° TM TDH (Agosto)',
      '1° 1° TM TDH (Marzo)',
      '1° 1° TT TDH (Agosto)',
      '1° 1° TT TDH (Marzo)',
      '1° 1° TN TDH (Agosto)',
      '1° 1° TN TDH (Marzo)',
    ]);

    const totalEnExcel = importState.rows.length;
    importState.rows = importState.rows.filter(r => COMISIONES_PERMITIDAS.has(r.comision));
    const descartados = totalEnExcel - importState.rows.length;

    if (!importState.rows.length) {
      err.textContent = `El archivo no contiene alumnos de las comisiones habilitadas. Se encontraron ${totalEnExcel} filas pero ninguna corresponde a una comisión Holos.`;
      err.classList.remove('hidden'); return;
    }

    // Informar cuántos se descartaron (no es un error, es informativo)
    if (descartados > 0) {
      const infoEl = document.createElement('p');
      infoEl.style.cssText = 'font-size:12px;color:var(--text-secondary);margin-top:8px;text-align:center';
      infoEl.textContent = `ℹ️ ${descartados} fila${descartados > 1 ? 's' : ''} de otras comisiones no se va${descartados > 1 ? 'n' : ''} a importar.`;
      $('import-step-1').appendChild(infoEl);
    }

    await buildImportPreview();

  } catch (e) {
    console.error('handleImportFile:', e);
    err.textContent = 'Error al leer el archivo: ' + e.message;
    err.classList.remove('hidden');
  }
}

async function buildImportPreview() {
  // Consultar qué numero_alumno ya existen en BD
  const numeros = importState.rows
    .map(r => r.numero_alumno)
    .filter(n => n !== null);

  importState.existing = new Map();

  if (numeros.length) {
    const { data } = await db.from('alumnos')
      .select('id, numero_alumno')
      .in('numero_alumno', numeros)
      .eq('eliminado', false);
    (data || []).forEach(a => importState.existing.set(a.numero_alumno, a.id));
  }

  const totalNew      = importState.rows.filter(r => !importState.existing.has(r.numero_alumno)).length;
  const totalExisting = importState.rows.filter(r =>  importState.existing.has(r.numero_alumno)).length;

  $('import-count-total').textContent    = importState.rows.length;
  $('import-count-new').textContent      = totalNew;
  $('import-count-existing').textContent = totalExisting;

  // Mostrar/ocultar opciones de modo
  $('import-mode-wrap').classList.toggle('hidden', totalExisting === 0);

  // Llenar tabla de preview (máximo 100 filas para no frenar el browser)
  const tbody = $('import-table-body');
  tbody.innerHTML = '';
  const preview = importState.rows.slice(0, 100);
  for (const r of preview) {
    const exists = importState.existing.has(r.numero_alumno);
    const tr = document.createElement('tr');
    tr.className = exists ? 'row-exists' : 'row-new';
    tr.innerHTML = `
      <td>${r.numero_alumno ?? '—'}</td>
      <td>${escapeHtml(r.apellido)}</td>
      <td>${escapeHtml(r.nombre)}</td>
      <td title="${escapeHtml(r.comision)}">${escapeHtml(r.comision.slice(0, 28))}${r.comision.length > 28 ? '…' : ''}</td>
      <td>${escapeHtml(r.situacion)}</td>
      <td><span class="import-badge ${exists ? 'import-badge-exists' : 'import-badge-new'}">${exists ? 'existe' : 'nuevo'}</span></td>
    `;
    tbody.appendChild(tr);
  }
  if (importState.rows.length > 100) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="6" style="text-align:center;color:var(--text-secondary);padding:10px">…y ${importState.rows.length - 100} más</td>`;
    tbody.appendChild(tr);
  }

  // Pasar al paso 2
  $('import-step-1').classList.add('hidden');
  $('import-step-2').classList.remove('hidden');
  $('import-confirm').classList.remove('hidden');
  $('import-change-file').classList.remove('hidden');
  $('import-cancel').classList.remove('hidden');
}

// Modo de importación
$$('input[name="import-mode"]').forEach(r => {
  r.addEventListener('change', () => {
    importState.mode = document.querySelector('input[name="import-mode"]:checked').value;
  });
});

// Ejecutar la importación
$('import-confirm').onclick = async () => {
  importState.mode = document.querySelector('input[name="import-mode"]:checked')?.value || 'merge';

  // Filtrar según el modo
  const toProcess = importState.mode === 'skip'
    ? importState.rows.filter(r => !importState.existing.has(r.numero_alumno))
    : importState.rows;

  if (!toProcess.length) {
    toast('No hay alumnos nuevos para importar con este modo.'); return;
  }

  // Paso 3: progreso
  $('import-step-2').classList.add('hidden');
  $('import-step-3').classList.remove('hidden');
  $('import-confirm').classList.add('hidden');
  $('import-change-file').classList.add('hidden');
  $('import-cancel').classList.add('hidden');

  const BATCH = 50;
  let insertados = 0, actualizados = 0, errores = 0;
  const total = toProcess.length;

  for (let i = 0; i < total; i += BATCH) {
    const batch = toProcess.slice(i, i + BATCH);

    for (const r of batch) {
      const alumnoData = {
        numero_alumno: r.numero_alumno,
        apellido:      r.apellido || '',
        nombre:        r.nombre   || '',
        comision:      r.comision  || null,
        situacion:     r.situacion || null,
        email:         r.email     || null,
        telefono:      r.telefono  || null,
        activa:        true,
      };

      const existingId = importState.existing.get(r.numero_alumno);

      if (existingId && importState.mode === 'merge') {
        // Actualizar
        const { error } = await db.from('alumnos').update(alumnoData).eq('id', existingId);
        if (error) { console.error('update:', error); errores++; } else actualizados++;
      } else if (!existingId) {
        // Insertar
        alumnoData.created_by = state.profile.id;
        const { error } = await db.from('alumnos').insert(alumnoData);
        if (error) { console.error('insert:', error); errores++; } else insertados++;
      }
    }

    // Actualizar barra de progreso
    const pct = Math.round(((i + batch.length) / total) * 100);
    $('import-progress-bar').style.width = pct + '%';
    $('import-progress-text').textContent = `Importando... ${i + batch.length} de ${total}`;
    // Yield al browser para que no se congele la UI
    await new Promise(r => setTimeout(r, 0));
  }

  // Paso 4: resultado
  $('import-step-3').classList.add('hidden');
  $('import-step-4').classList.remove('hidden');
  $('import-done').classList.remove('hidden');

  const todoOk = errores === 0;
  $('import-result-content').innerHTML = `
    <div class="import-result">
      <div class="import-result-icon">${todoOk ? '✅' : '⚠️'}</div>
      <h3>${todoOk ? '¡Importación completada!' : 'Importación con advertencias'}</h3>
      <p>${todoOk ? 'Todos los alumnos fueron procesados correctamente.' : `${errores} registro${errores > 1 ? 's' : ''} no se pudo${errores > 1 ? 'n' : ''} importar.`}</p>
      <div class="import-result-stats">
        ${insertados  > 0 ? `<div class="import-result-stat"><strong>${insertados}</strong> agregados</div>` : ''}
        ${actualizados> 0 ? `<div class="import-result-stat"><strong>${actualizados}</strong> actualizados</div>` : ''}
        ${errores     > 0 ? `<div class="import-result-stat"><strong>${errores}</strong> con error</div>` : ''}
      </div>
    </div>
  `;

  // Refrescar la lista de alumnos
  loadAdminAlumnos();
};

$('import-done').onclick = () => {
  $('modal-import').classList.add('hidden');
};

/* ═══════════════════════════════════════════════════════════════
   BACKUP COMPLETO (super_admin) — exportar / importar

   Exporta: profiles (todos los roles), alumnos (todos, incluidos
   eliminados/bajas), conversations, messages, broadcast_reads.

   Importar es SIEMPRE modo "combinar": nunca borra nada. Usa
   upsert por id. Orden de importación respeta las dependencias
   de foreign key:
     1. profiles   (mentores nuevos entran como 'pausado')
     2. alumnos    (si el mentor_id no se pudo restaurar, se
                    guarda el alumno igual pero sin mentor)
     3. conversations
     4. messages
     5. broadcast_reads
═══════════════════════════════════════════════════════════════ */

const BACKUP_VERSION = 1;

$('btn-backup-export').onclick = async () => {
  const btn = $('btn-backup-export');
  const status = $('backup-export-status');
  btn.disabled = true;
  btn.textContent = 'Generando backup...';
  status.textContent = '';

  try {
    const [profiles, alumnos, conversations, messages, broadcastReads] = await Promise.all([
      db.from('profiles').select('*'),
      db.from('alumnos').select('*'),
      db.from('conversations').select('*'),
      db.from('messages').select('*'),
      db.from('broadcast_reads').select('*'),
    ]);

    const errores = [profiles, alumnos, conversations, messages, broadcastReads]
      .filter(r => r.error);
    if (errores.length) {
      console.error('Errores al exportar:', errores);
      status.textContent = '❌ Error al leer algunos datos. Ver consola.';
      btn.disabled = false;
      btn.textContent = 'Exportar backup completo';
      return;
    }

    const backup = {
      backup_version: BACKUP_VERSION,
      exported_at: new Date().toISOString(),
      exported_by: state.profile.email,
      counts: {
        profiles: profiles.data.length,
        alumnos: alumnos.data.length,
        conversations: conversations.data.length,
        messages: messages.data.length,
        broadcast_reads: broadcastReads.data.length,
      },
      data: {
        profiles: profiles.data,
        alumnos: alumnos.data,
        conversations: conversations.data,
        messages: messages.data,
        broadcast_reads: broadcastReads.data,
      },
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const fecha = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `holos-backup-${fecha}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    status.textContent = `✓ Backup generado: ${backup.counts.profiles} usuarios, ${backup.counts.alumnos} alumnos, ${backup.counts.messages} mensajes.`;
  } catch (e) {
    console.error('exportBackup:', e);
    status.textContent = '❌ Error inesperado al generar el backup.';
  }

  btn.disabled = false;
  btn.textContent = 'Exportar backup completo';
};

/* ── Importar backup ── */

const backupImport = {
  parsed: null, // el JSON completo parseado
};

function openBackupImportModal() {
  backupImport.parsed = null;
  $('backup-import-step-1').classList.remove('hidden');
  $('backup-import-step-2').classList.add('hidden');
  $('backup-import-step-3').classList.add('hidden');
  $('backup-import-step-4').classList.add('hidden');
  $('backup-import-error').classList.add('hidden');
  $('backup-import-confirm').classList.add('hidden');
  $('backup-import-done').classList.add('hidden');
  $('backup-import-cancel').classList.remove('hidden');
  $('backup-import-file-input').value = '';
  $('modal-backup-import').classList.remove('hidden');
}

$('btn-backup-import').onclick = () => openBackupImportModal();
$('backup-import-close').onclick  = () => $('modal-backup-import').classList.add('hidden');
$('backup-import-cancel').onclick = () => $('modal-backup-import').classList.add('hidden');

$('backup-import-dropzone').onclick = () => $('backup-import-file-input').click();
$('backup-import-dropzone').addEventListener('dragover', e => {
  e.preventDefault();
  $('backup-import-dropzone').classList.add('drag-over');
});
$('backup-import-dropzone').addEventListener('dragleave', () => {
  $('backup-import-dropzone').classList.remove('drag-over');
});
$('backup-import-dropzone').addEventListener('drop', e => {
  e.preventDefault();
  $('backup-import-dropzone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleBackupFile(file);
});
$('backup-import-file-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) handleBackupFile(file);
});

async function handleBackupFile(file) {
  const err = $('backup-import-error');
  err.classList.add('hidden');

  if (!file.name.endsWith('.json')) {
    err.textContent = 'El archivo debe ser .json';
    err.classList.remove('hidden'); return;
  }

  try {
    const text = await file.text();
    const json = JSON.parse(text);

    if (!json.data || !json.backup_version) {
      err.textContent = 'Este archivo no parece ser un backup válido de Holos Mentorías.';
      err.classList.remove('hidden'); return;
    }

    backupImport.parsed = json;

    $('backup-import-fecha').textContent = json.exported_at
      ? new Date(json.exported_at).toLocaleString('es-AR')
      : 'fecha desconocida';

    const c = json.counts || {
      profiles: (json.data.profiles || []).length,
      alumnos: (json.data.alumnos || []).length,
      conversations: (json.data.conversations || []).length,
      messages: (json.data.messages || []).length,
      broadcast_reads: (json.data.broadcast_reads || []).length,
    };

    $('backup-cat-count-profiles').textContent = `${c.profiles} en el backup`;
    $('backup-cat-count-alumnos').textContent = `${c.alumnos} en el backup`;
    $('backup-cat-count-conversations').textContent = `${c.conversations} en el backup`;
    $('backup-cat-count-messages').textContent = `${c.messages} en el backup`;
    $('backup-cat-count-broadcast_reads').textContent = `${c.broadcast_reads} en el backup`;

    // Re-marcar todas las categorías por defecto cada vez que se carga un archivo nuevo
    $$('#backup-category-list input[type="checkbox"]').forEach(cb => cb.checked = true);

    $('backup-import-step-1').classList.add('hidden');
    $('backup-import-step-2').classList.remove('hidden');
    $('backup-import-confirm').classList.remove('hidden');

  } catch (e) {
    console.error('handleBackupFile:', e);
    err.textContent = 'No se pudo leer el archivo. ¿Es un JSON válido?';
    err.classList.remove('hidden');
  }
}

$('backup-import-confirm').onclick = async () => {
  const json = backupImport.parsed;
  if (!json) return;

  // Leer qué categorías el super_admin quiere restaurar
  const categoriasSeleccionadas = new Set();
  $$('#backup-category-list input[type="checkbox"]:checked').forEach(cb => {
    categoriasSeleccionadas.add(cb.dataset.category);
  });

  $('backup-import-step-2').classList.add('hidden');
  $('backup-import-step-3').classList.remove('hidden');
  $('backup-import-confirm').classList.add('hidden');
  $('backup-import-cancel').classList.add('hidden');

  const setProgress = (pct, text) => {
    $('backup-import-progress-bar').style.width = pct + '%';
    $('backup-import-progress-text').textContent = text;
  };

  const resultado = {
    profiles:   { ok: 0, err: 0 },
    alumnos:    { ok: 0, err: 0, sinMentor: 0 },
    conversations: { ok: 0, err: 0 },
    messages:   { ok: 0, err: 0 },
    broadcast_reads: { ok: 0, err: 0 },
    mentoresNuevosPausados: 0,
  };

  // ── 1. PROFILES ──────────────────────────────────────────────
  // Se consultan los IDs existentes SIEMPRE (esté marcada la
  // categoría o no), porque alumnos/conversaciones/mensajes
  // necesitan saber qué perfiles son válidos para no romper
  // ninguna referencia, incluso si "Usuarios" no se restaura.
  setProgress(5, 'Verificando usuarios existentes...');
  const profilesData = categoriasSeleccionadas.has('profiles') ? (json.data.profiles || []) : [];
  const profileIdsExistentesAntes = new Set();
  {
    const { data: existentes } = await db.from('profiles').select('id');
    (existentes || []).forEach(p => profileIdsExistentesAntes.add(p.id));
  }
  const profileIdsRestaurados = new Set();

  if (categoriasSeleccionadas.has('profiles')) {
    setProgress(5, 'Restaurando usuarios...');
    for (let i = 0; i < profilesData.length; i++) {
      const p = { ...profilesData[i] };
      const esNuevo = !profileIdsExistentesAntes.has(p.id);

      // Mentor nuevo restaurado → entra pausado (transparente) hasta
      // que el super_admin lo reactive manualmente.
      if (esNuevo && p.rol === 'mentor') {
        p.estado_mentor = 'pausado';
        resultado.mentoresNuevosPausados++;
      }

      const { error } = await db.from('profiles').upsert(p, { onConflict: 'id' });
      if (error) {
        console.warn('profile no restaurado:', p.id, p.email, error.message);
        resultado.profiles.err++;
      } else {
        resultado.profiles.ok++;
        profileIdsRestaurados.add(p.id);
      }

      if (i % 5 === 0) setProgress(5 + Math.round((i / Math.max(profilesData.length,1)) * 20), `Restaurando usuarios... ${i + 1}/${profilesData.length}`);
    }
  }
  // Los que ya existían antes también cuentan como "restaurados" para las FK de alumnos/conversations,
  // aunque "Usuarios" no se haya tildado para importar.
  profileIdsExistentesAntes.forEach(id => profileIdsRestaurados.add(id));

  // ── 2. ALUMNOS ───────────────────────────────────────────────
  const alumnosData = categoriasSeleccionadas.has('alumnos') ? (json.data.alumnos || []) : [];
  const BATCH = 50;
  if (categoriasSeleccionadas.has('alumnos')) {
    setProgress(25, 'Restaurando alumnos...');
    for (let i = 0; i < alumnosData.length; i += BATCH) {
      const batch = alumnosData.slice(i, i + BATCH).map(a => {
        const alumno = { ...a };
        // Si el mentor asignado no se pudo restaurar, no bloquear el
        // alumno por una FK rota: lo dejamos sin mentor.
        if (alumno.mentor_id && !profileIdsRestaurados.has(alumno.mentor_id)) {
          alumno.mentor_id = null;
          resultado.alumnos.sinMentor++;
        }
        return alumno;
      });

      const { error } = await db.from('alumnos').upsert(batch, { onConflict: 'id' });
      if (error) {
        console.warn('batch alumnos falló, reintentando 1 a 1:', error.message);
        // Fallback: insertar de a uno para no perder todo el batch
        for (const alumno of batch) {
          const { error: e2 } = await db.from('alumnos').upsert(alumno, { onConflict: 'id' });
          if (e2) resultado.alumnos.err++; else resultado.alumnos.ok++;
        }
      } else {
        resultado.alumnos.ok += batch.length;
      }

      setProgress(25 + Math.round(((i + batch.length) / Math.max(alumnosData.length,1)) * 30), `Restaurando alumnos... ${Math.min(i + batch.length, alumnosData.length)}/${alumnosData.length}`);
      await new Promise(r => setTimeout(r, 0));
    }
  }

  // ── 3. CONVERSATIONS ─────────────────────────────────────────
  const convData = categoriasSeleccionadas.has('conversations') ? (json.data.conversations || []) : [];
  const convIdsRestauradas = new Set();
  {
    const { data: convExistentes } = await db.from('conversations').select('id');
    (convExistentes || []).forEach(c => convIdsRestauradas.add(c.id));
  }
  if (categoriasSeleccionadas.has('conversations')) {
    setProgress(55, 'Restaurando conversaciones...');
    for (const c of convData) {
      // Si admin_id o mentor_id no existen, se salta (no se puede
      // crear una conversación sin sus participantes válidos).
      if (c.admin_id && !profileIdsRestaurados.has(c.admin_id)) { resultado.conversations.err++; continue; }
      if (c.mentor_id && !profileIdsRestaurados.has(c.mentor_id)) { resultado.conversations.err++; continue; }
      const { error } = await db.from('conversations').upsert(c, { onConflict: 'id' });
      if (error) resultado.conversations.err++;
      else { resultado.conversations.ok++; convIdsRestauradas.add(c.id); }
    }
  }

  // ── 4. MESSAGES ───────────────────────────────────────────────
  const msgsData = categoriasSeleccionadas.has('messages') ? (json.data.messages || []) : [];
  if (categoriasSeleccionadas.has('messages')) {
    setProgress(75, 'Restaurando mensajes...');
    for (let i = 0; i < msgsData.length; i += BATCH) {
      const batch = msgsData.slice(i, i + BATCH).filter(m =>
        convIdsRestauradas.has(m.conversation_id) && profileIdsRestaurados.has(m.sender_id)
      );
      const saltados = msgsData.slice(i, i + BATCH).length - batch.length;
      resultado.messages.err += saltados;

      if (batch.length) {
        const { error } = await db.from('messages').upsert(batch, { onConflict: 'id' });
        if (error) {
          for (const m of batch) {
            const { error: e2 } = await db.from('messages').upsert(m, { onConflict: 'id' });
            if (e2) resultado.messages.err++; else resultado.messages.ok++;
          }
        } else {
          resultado.messages.ok += batch.length;
        }
      }
      setProgress(75 + Math.round(((i + BATCH) / Math.max(msgsData.length,1)) * 15), `Restaurando mensajes... ${Math.min(i + BATCH, msgsData.length)}/${msgsData.length}`);
      await new Promise(r => setTimeout(r, 0));
    }
  }

  // ── 5. BROADCAST_READS ───────────────────────────────────────
  const brData = categoriasSeleccionadas.has('broadcast_reads') ? (json.data.broadcast_reads || []) : [];
  if (categoriasSeleccionadas.has('broadcast_reads')) {
    setProgress(92, 'Restaurando marcas de lectura...');
    for (const br of brData) {
      if (!profileIdsRestaurados.has(br.mentor_id)) { resultado.broadcast_reads.err++; continue; }
      const { error } = await db.from('broadcast_reads')
        .upsert(br, { onConflict: 'message_id,mentor_id' });
      if (error) resultado.broadcast_reads.err++;
      else resultado.broadcast_reads.ok++;
    }
  }

  setProgress(100, 'Listo');

  // ── Resultado final ──────────────────────────────────────────
  $('backup-import-step-3').classList.add('hidden');
  $('backup-import-step-4').classList.remove('hidden');
  $('backup-import-done').classList.remove('hidden');

  const totalErrores = resultado.profiles.err + resultado.alumnos.err +
    resultado.conversations.err + resultado.messages.err + resultado.broadcast_reads.err;

  $('backup-import-result-content').innerHTML = `
    <div class="import-result">
      <div class="import-result-icon">${totalErrores === 0 ? '✅' : '⚠️'}</div>
      <h3>${totalErrores === 0 ? '¡Backup restaurado!' : 'Restaurado con advertencias'}</h3>
      <p>Los datos se combinaron con lo que ya tenías. Nada existente fue borrado.</p>
      <div class="import-result-stats">
        <div class="import-result-stat"><strong>${resultado.profiles.ok}</strong>usuarios</div>
        <div class="import-result-stat"><strong>${resultado.alumnos.ok}</strong>alumnos</div>
        <div class="import-result-stat"><strong>${resultado.conversations.ok}</strong>conversaciones</div>
        <div class="import-result-stat"><strong>${resultado.messages.ok}</strong>mensajes</div>
        ${resultado.mentoresNuevosPausados > 0 ? `<div class="import-result-stat"><strong>${resultado.mentoresNuevosPausados}</strong>mentores nuevos (pausados)</div>` : ''}
        ${resultado.alumnos.sinMentor > 0 ? `<div class="import-result-stat"><strong>${resultado.alumnos.sinMentor}</strong>alumnos sin mentor</div>` : ''}
        ${totalErrores > 0 ? `<div class="import-result-stat"><strong>${totalErrores}</strong>con error</div>` : ''}
      </div>
      ${resultado.mentoresNuevosPausados > 0 ? `<p style="font-size:12px;color:#8B6F00;margin-top:14px">⏸ Los mentores nuevos quedaron <strong>pausados</strong>. Andá a "Mentores" y reactivalos manualmente después de verificar que su acceso sigue siendo válido.</p>` : ''}
    </div>
  `;

  // Refrescar vistas relevantes si están cargadas
  if (typeof loadAdminAlumnos === 'function') loadAdminAlumnos();
  if (typeof loadAdminMentores === 'function') loadAdminMentores();
};

$('backup-import-done').onclick = () => {
  $('modal-backup-import').classList.add('hidden');
};

/* ═══════════════════════════════════════════════════════════════
   PRESENCIA EN TIEMPO REAL (usuarios conectados)

   Usa Supabase Realtime Presence: un canal compartido donde cada
   sesión activa (admin, mentor, super_admin) se "anuncia" con
   .track(). No se guarda nada en la base de datos — es puramente
   en memoria mientras dura la conexión websocket.

   Todos los roles se anuncian (para que el super_admin los vea),
   pero solo el super_admin renderiza esa información en pantalla.
═══════════════════════════════════════════════════════════════ */

const presence = {
  channel: null,
  online: new Map(), // id → { nombre, apellido, rol, email, avatar_url, online_at }
};

function startPresenceTracking(profile) {
  if (presence.channel) {
    db.removeChannel(presence.channel);
    presence.channel = null;
  }

  presence.channel = db.channel('holos-presence', {
    config: { presence: { key: profile.id } }
  });

  presence.channel
    .on('presence', { event: 'sync' }, () => {
      const state_ = presence.channel.presenceState();
      presence.online = new Map();
      for (const key in state_) {
        const entries = state_[key];
        if (entries && entries.length) {
          presence.online.set(key, entries[0]); // primera entrada (una por usuario)
        }
      }
      // Si el super_admin está mirando la pestaña de conectados, refrescar
      if (state.profile?.rol === 'super_admin') {
        renderOnlineUsers();
        renderOnlineDots();
      }
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await presence.channel.track({
          nombre: profile.nombre,
          apellido: profile.apellido,
          rol: profile.rol,
          email: profile.email,
          avatar_url: profile.avatar_url || null,
          online_at: new Date().toISOString(),
        });
      }
    });
}

/* ── Panel "Conectados" (super_admin) ── */

function renderOnlineUsers() {
  const list = $('online-users-list');
  if (!list) return;

  // Excluir al propio super_admin de la lista (no tiene sentido verse a sí mismo)
  const otros = [...presence.online.entries()].filter(([id]) => id !== state.profile.id);

  const admins   = otros.filter(([,u]) => u.rol === 'admin');
  const mentores = otros.filter(([,u]) => u.rol === 'mentor');

  $('online-stat-total').textContent    = otros.length;
  $('online-stat-admins').textContent   = admins.length;
  $('online-stat-mentores').textContent = mentores.length;

  const badge = $('sup-online-badge');
  if (badge) {
    badge.textContent = otros.length;
    badge.classList.toggle('hidden', otros.length === 0);
  }

  if (!otros.length) {
    list.innerHTML = '<div class="empty-state"><span>💤</span><p>No hay nadie más conectado en este momento.</p></div>';
    return;
  }

  // Ordenar: admins primero, después mentores, por nombre
  const ordenados = [...admins, ...mentores].sort((a, b) => {
    if (a[1].rol !== b[1].rol) return a[1].rol === 'admin' ? -1 : 1;
    return fullName(a[1]).localeCompare(fullName(b[1]));
  });

  list.innerHTML = ordenados.map(([id, u]) => {
    const rolLabel = { admin: 'Admin', mentor: 'Mentor', super_admin: 'Super admin' }[u.rol] || u.rol;
    const av = u.avatar_url
      ? `<img class="online-user-avatar" src="${escapeHtml(u.avatar_url)}" alt=""/><span class="online-dot pulse"></span>`
      : `<div class="online-user-avatar-placeholder">${escapeHtml(initials(u))}<span class="online-dot pulse"></span></div>`;
    const desde = u.online_at ? formatRelative(u.online_at) : '';
    return `
      <div class="online-user-row">
        ${av}
        <div class="online-user-info">
          <div class="online-user-name">${escapeHtml(fullName(u))}</div>
          <div class="online-user-meta">
            <span class="online-role-badge online-role-${u.rol}">${rolLabel}</span>
            ${desde ? `<span>conectado ${desde}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/* ── Punto verde en las listas de Usuarios (super-usuarios / admin-usuarios) ── */

function renderOnlineDots() {
  $$('.user-row').forEach(row => {
    const id = row.dataset.id;
    const avatarEl = row.querySelector('.user-row-avatar, .user-row-avatar-placeholder');
    if (!avatarEl) return;

    // Quitar punto previo si existía
    const prevDot = avatarEl.querySelector('.online-dot');
    if (prevDot) prevDot.remove();

    if (id !== state.profile.id && presence.online.has(id)) {
      avatarEl.insertAdjacentHTML('beforeend', '<span class="online-dot pulse"></span>');
    }
  });
}

// Actualizar los puntos verdes cada vez que se re-renderiza la lista de usuarios
// (renderSuperUsuarios / renderAdminUsuarios ya existen; enganchamos después de
// que el DOM se actualice, con un pequeño delay para asegurar que ya se pintó)
const _origRenderSuperUsuarios = renderSuperUsuarios;
renderSuperUsuarios = function(...args) {
  _origRenderSuperUsuarios.apply(this, args);
  if (presence.channel) setTimeout(renderOnlineDots, 0);
};

/* ═══════════════════════════════════════════════════════════════
   ELIMINAR CONVERSACIÓN (chat 1-a-1) — solo admin/super_admin
   Doble paso de confirmación, igual criterio que eliminar alumno.
   Borra la conversación y sus mensajes de forma PERMANENTE en
   Supabase (no es soft-delete, a diferencia del resto de la app).
═══════════════════════════════════════════════════════════════ */

const chatDeleteState = { convId: null, role: null };

function abrirEliminarConversacion(convId, peerName, role) {
  chatDeleteState.convId = convId;
  chatDeleteState.role = role;

  $('chatdel-peer-name').textContent = peerName;
  $('chatdel-step-1').classList.remove('hidden');
  $('chatdel-step-2').classList.add('hidden');
  $('chatdel-input').value = '';
  $('chatdel-error').classList.add('hidden');
  $('chatdel-next').textContent = 'Continuar';
  $('modal-confirm-delete-chat').classList.remove('hidden');
}

$('chatdel-close').onclick  = () => $('modal-confirm-delete-chat').classList.add('hidden');
$('chatdel-cancel').onclick = () => $('modal-confirm-delete-chat').classList.add('hidden');

$('chatdel-next').onclick = async () => {
  // Paso 1 → paso 2
  if ($('chatdel-step-1').classList.contains('hidden') === false) {
    $('chatdel-step-1').classList.add('hidden');
    $('chatdel-step-2').classList.remove('hidden');
    $('chatdel-next').textContent = 'Eliminar definitivamente';
    setTimeout(() => $('chatdel-input').focus(), 50);
    return;
  }

  // Paso 2 → validar palabra y ejecutar
  const palabra = ($('chatdel-input').value || '').trim().toUpperCase();
  const err = $('chatdel-error');
  if (palabra !== 'ELIMINAR') {
    err.textContent = 'Escribí la palabra ELIMINAR para confirmar.';
    err.classList.remove('hidden');
    $('chatdel-input').focus();
    return;
  }
  err.classList.add('hidden');

  const btn = $('chatdel-next');
  btn.disabled = true;
  btn.textContent = 'Eliminando...';

  const convId = chatDeleteState.convId;
  const { error } = await db.from('conversations').delete().eq('id', convId);

  btn.disabled = false;
  btn.textContent = 'Eliminar definitivamente';

  if (error) {
    err.textContent = 'Error al eliminar: ' + error.message;
    err.classList.remove('hidden');
    return;
  }

  $('modal-confirm-delete-chat').classList.add('hidden');
  toast('✓ Conversación eliminada');

  const role = chatDeleteState.role;

  // Limpiar estado local
  chat.conversations = chat.conversations.filter(c => String(c.id) !== String(convId));
  delete chat.unread[convId];
  if (chat.active && String(chat.active.id) === String(convId)) {
    chat.active = null;
    renderChatMain(role);
    document.querySelector(`[data-chat-context="${role}"]`)?.classList.remove('has-active');
  }
  updateBadge(role);
  renderChatSidebar(role);
};

/* ═══════════════════════════════════════════════════════════════
   15. BOOT
═══════════════════════════════════════════════════════════════ */

// ── Detectar recovery en el hash ANTES del boot ──────────────
// Supabase pone el token en el hash: #access_token=...&type=recovery
// Si lo detectamos, NO arrancamos bootstrapSession todavía —
// esperamos a que onAuthStateChange dispare PASSWORD_RECOVERY
// con la sesión ya establecida por Supabase.
const _hashParams  = new URLSearchParams(window.location.hash.slice(1));
const _isRecovery  = _hashParams.get('type') === 'recovery';

if (_isRecovery) {
  // Mostrar pantalla de login vacía mientras Supabase procesa el token
  // (onAuthStateChange con PASSWORD_RECOVERY la va a completar en ~300ms)
  showScreen('login-screen');
  showLoginPanel('panel-login'); // panel base por si tarda
} else {
  bootstrapSession();
}

// ── Reaccionar a cambios de sesión ─────────────────────────────
db.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    // Supabase ya procesó el token y la sesión está activa.
    // Ahora sí es seguro llamar a updateUser().
    window.__HOLOS_RECOVERY__ = true;
    // Limpiar el hash de la URL
    window.history.replaceState(null, '', window.location.pathname);
    showScreen('login-screen');
    showLoginPanel('panel-nueva-pass');
    $('nueva-pass-1').focus();
    return;
  }

  if (event === 'SIGNED_IN' && !window.__HOLOS_RECOVERY__) {
    // Login normal — si no tenemos perfil cargado, arrancamos
    if (!state.profile) bootstrapSession();
    return;
  }

  if (event === 'USER_UPDATED') {
    // Se disparó después de updateUser() exitoso — limpiar flag
    window.__HOLOS_RECOVERY__ = false;
    return;
  }

  if (event === 'SIGNED_OUT') {
    window.__HOLOS_RECOVERY__ = false;
    state.session = null;
    state.profile = null;
    showScreen('login-screen');
    showLoginPanel('panel-login');
  }
});

// ── Panel: guardar nueva contraseña ───────────────────────────
$('btn-nueva-pass').onclick = async () => {
  const pass1 = $('nueva-pass-1').value;
  const pass2 = $('nueva-pass-2').value;
  const err   = $('nueva-pass-error');
  const ok    = $('nueva-pass-ok');
  err.classList.add('hidden');
  ok.classList.add('hidden');

  if (!pass1 || !pass2) {
    err.textContent = 'Completá ambos campos.';
    err.classList.remove('hidden'); return;
  }
  if (pass1.length < 8) {
    err.textContent = 'La contraseña debe tener al menos 8 caracteres.';
    err.classList.remove('hidden'); return;
  }
  if (pass1 !== pass2) {
    err.textContent = 'Las contraseñas no coinciden.';
    err.classList.remove('hidden'); return;
  }

  const btn = $('btn-nueva-pass');
  btn.disabled = true; btn.textContent = 'Guardando...';

  const { error } = await db.auth.updateUser({ password: pass1 });

  btn.disabled = false; btn.textContent = 'Guardar nueva contraseña';

  if (error) {
    console.error('updateUser:', error);
    const msg = error.message;
    if (msg.includes('same password') || msg.includes('different from the old password')) {
      err.textContent = 'La nueva contraseña no puede ser igual a la anterior. Elegí una diferente.';
    } else if (msg.includes('weak') || msg.includes('too short')) {
      err.textContent = 'La contraseña es demasiado débil. Usá al menos 8 caracteres.';
    } else {
      err.textContent = 'Error al actualizar la contraseña. Intentá nuevamente.';
    }
    err.classList.remove('hidden'); return;
  }

  ok.textContent = '✓ Contraseña actualizada. Redirigiendo...';
  ok.classList.remove('hidden');
  $('nueva-pass-1').value = '';
  $('nueva-pass-2').value = '';

  // Cerrar sesión y volver al login después de 2 segundos
  // (fuerza un login limpio con la nueva contraseña)
  setTimeout(async () => {
    await db.auth.signOut();
    showLoginPanel('panel-login');
    toast('Contraseña actualizada. Iniciá sesión con tu nueva contraseña ✓');
  }, 2000);
};

['nueva-pass-1','nueva-pass-2'].forEach(id => {
  $(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') $('btn-nueva-pass').click();
  });
});
