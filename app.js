'use strict';
/* טעמים — הרשמה לפיילוט תלמידים. Backend: Supabase (anon insert-only; team reads via sign-in). */
const SUPABASE_URL = 'https://gpipsjqkntcyczoxnnwa.supabase.co';
const SUPABASE_KEY = 'sb_publishable_9zCWAwdh5h1euDJ67i0LuA_nSM9iW_Y';
const APP_VERSION = '1';
const TABLE = 'pilot_registrations';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { flowType: 'implicit' } });
const STATUSES = ['חדש', 'נוצר קשר', 'נשלח קישור', 'הושלם'];
const OTHER = 'אחר';

/* ---------- עזר ---------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('he-IL') + ' ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}
function statusClass(s) { return 'st-' + String(s).replace(/\s+/g, '-'); }
function showError(msg) {
  const e = document.getElementById('form-error');
  e.textContent = msg;
  e.hidden = false;
  e.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ---------- "אחר" מחייב פירוש ---------- */
function wireOtherField(select) {
  const hasOther = [...select.options].some(o => o.value === OTHER || o.text === OTHER);
  if (!hasOther) return;
  const t = document.createElement('input');
  t.type = 'text';
  t.className = 'other-text';
  t.placeholder = 'פירוט (חובה בבחירת "אחר")';
  t.hidden = true;
  const label = select.closest('label') || select.parentElement;
  label.appendChild(t);
  select.addEventListener('change', () => {
    t.hidden = select.value !== OTHER;
    t.required = select.value === OTHER;
    if (t.hidden) t.value = '';
  });
}
function selectFinalValue(select) {
  if (select.value !== OTHER) return select.value;
  const t = (select.closest('label') || select.parentElement).querySelector('.other-text');
  return t && t.value.trim() ? OTHER + ': ' + t.value.trim() : OTHER;
}

/* ---------- שליחת טופס ---------- */
async function submitForm(ev) {
  ev.preventDefault();
  const f = ev.target;
  document.getElementById('form-error').hidden = true;

  if (!f.elements.first_name.value.trim()) { showError('חסר שם פרטי.'); return; }
  if (!f.elements.last_name.value.trim()) { showError('חסר שם משפחה.'); return; }
  const noSchool = document.getElementById('no-school').checked;
  if (!noSchool && !f.elements.school_city.value.trim()) {
    showError('חסרים בית ספר ועיר של התלמיד/ה — או סמנו שהתלמיד/ה לא לומד/ת בבית ספר כרגע.'); return;
  }
  if (!f.elements.email.value.trim() || !f.elements.email.checkValidity()) {
    showError('חסרה כתובת דוא"ל תקינה — אליה נשלח את הקישור לאפליקציה.'); return;
  }
  if (!f.elements.device_type.value) { showError('בחרו את סוג המכשיר שעליו תותקן האפליקציה.'); return; }
  if (!f.elements.email_owner.value) { showError('בחרו של מי כתובת הדוא"ל.'); return; }
  for (const sel of f.querySelectorAll('select')) {
    if (sel.value === OTHER) {
      const t = (sel.closest('label') || sel.parentElement).querySelector('.other-text');
      if (!t || !t.value.trim()) { showError('בבחירת "אחר" צריך לפרט בכתב — השלימו את השדה החסר.'); return; }
    }
  }
  if (!document.getElementById('consent-check').checked) {
    showError('כדי להירשם צריך לאשר את ההסכמה.'); return;
  }

  const btn = document.getElementById('submit-btn');
  btn.disabled = true; btn.textContent = 'שולח…';
  try {
    const ins = await sb.from(TABLE).insert({
      first_name: f.elements.first_name.value.trim(),
      last_name: f.elements.last_name.value.trim(),
      school_city: noSchool ? null : f.elements.school_city.value.trim(),
      no_school: noSchool,
      grade: f.elements.grade.value || null,
      device_type: selectFinalValue(f.elements.device_type),
      email: f.elements.email.value.trim(),
      email_owner: selectFinalValue(f.elements.email_owner)
    });
    if (ins.error) throw new Error('insert: ' + ins.error.message);
    f.reset();
    document.querySelectorAll('#apply-form .other-text').forEach(t => { t.hidden = true; t.required = false; });
    document.getElementById('apply-form').hidden = true;
    document.querySelector('#view-apply .intro').hidden = true;
    document.getElementById('apply-success').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    showError('השליחה נכשלה (' + (err && err.message ? err.message : 'תקלה') + '). נסו שוב, ואם זה חוזר — צרו קשר.');
  } finally {
    btn.disabled = false; btn.textContent = 'נרשמים לפיילוט';
  }
}

/* ---------- צ'קבוקס "לא לומד בבית ספר" ---------- */
document.getElementById('no-school').addEventListener('change', ev => {
  const sc = document.getElementById('school-city');
  sc.disabled = ev.target.checked;
  if (ev.target.checked) sc.value = '';
});

/* ---------- מסך ניהול ---------- */
let adminApps = [];
async function renderAdmin() {
  const { data } = await sb.auth.getSession();
  const ok = !!data.session;
  document.getElementById('admin-gate').hidden = ok;
  document.getElementById('admin-panel').hidden = !ok;
  if (ok) refreshAdminList();
}
async function sendMagicLink() {
  const email = document.getElementById('admin-email').value.trim();
  const msg = document.getElementById('gate-msg');
  const err = document.getElementById('gate-error');
  err.hidden = true; msg.hidden = true;
  if (!email) { err.textContent = 'מלאו דוא"ל ואז בקשו קישור.'; err.hidden = false; return; }
  const redirectTo = window.location.origin + window.location.pathname + '?auth=1';
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: redirectTo } });
  if (error) {
    const code = (error && error.code) || '';
    if (error.status === 429 || code === 'over_email_send_rate_limit') {
      err.textContent = 'יותר מדי בקשות כרגע — ממתינים כמה דקות ומנסים שוב.';
    } else if (error.status === 422 || code === 'signup_disabled' || code === 'otp_disabled' || code === 'user_not_found') {
      err.textContent = 'לא הצלחנו לשלוח קישור לכתובת הזו. אם אתם אמורים להיות בצוות — פנו לצוות טעמים.';
    } else {
      err.textContent = 'שליחת הקישור נכשלה כרגע — נסו שוב בעוד כמה דקות. אם זה חוזר, פנו לצוות טעמים.';
    }
    err.hidden = false; return;
  }
  msg.textContent = 'נשלח קישור כניסה לדוא"ל. לוחצים עליו — וחוזרים לכאן מחוברים.';
  msg.hidden = false;
}
async function signOut() {
  await sb.auth.signOut();
  renderAdmin();
}
async function refreshAdminList() {
  const { data, error } = await sb
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    document.getElementById('apps-list').innerHTML =
      '<p class="error">טעינת הנרשמים נכשלה: ' + esc(error.message) + '</p>';
    return;
  }
  adminApps = data || [];
  renderStats();
  renderApps(document.getElementById('search').value.trim());
}
function renderStats() {
  const byStatus = {};
  adminApps.forEach(a => { byStatus[a.status] = (byStatus[a.status] || 0) + 1; });
  let html = '<span class="stat-chip">סך הכול: ' + adminApps.length + '</span>';
  for (const s of STATUSES) {
    if (byStatus[s]) html += '<span class="stat-chip">' + esc(s) + ': ' + byStatus[s] + '</span>';
  }
  document.getElementById('stats').innerHTML = html;
}
function field(label, val) {
  return val ? '<div class="field"><b>' + label + ':</b> ' + esc(val) + '</div>' : '';
}
function renderApps(filter) {
  const list = document.getElementById('apps-list');
  list.innerHTML = '';
  const q = (filter || '').toLowerCase();
  const shown = adminApps.filter(a =>
    !q || [a.first_name, a.last_name, a.school_city, a.grade, a.device_type, a.email, a.email_owner, a.status]
      .some(v => (v || '').toLowerCase().includes(q)));
  document.getElementById('empty-state').hidden = shown.length > 0;

  for (const a of shown) {
    const card = document.createElement('div');
    card.className = 'app-card';
    const statusOpts = STATUSES.map(s =>
      '<option' + (s === a.status ? ' selected' : '') + '>' + s + '</option>').join('');
    card.innerHTML =
      '<div class="app-head"><h3>' + esc(((a.first_name || '') + ' ' + (a.last_name || '')).trim() || '(ללא שם)') + '</h3>' +
      '<span class="app-date">' + fmtDate(a.created_at) + '</span></div>' +
      '<span class="status-chip ' + statusClass(a.status) + '">' + esc(a.status) + '</span>' +
      '<div class="fields" style="margin-top:10px">' +
      field('דוא"ל', a.email) + field('דוא"ל של', a.email_owner) + field('מכשיר', a.device_type) +
      field('בית ספר ועיר', a.no_school ? 'לא לומד/ת בבית ספר כרגע' : a.school_city) + field('כיתה', a.grade) +
      '</div>' +
      '<div class="status-row"><b>סטטוס:</b><select class="status-select">' + statusOpts + '</select></div>' +
      '<textarea class="notes-area" rows="2" placeholder="הערות צוות (לא גלוי לנרשם)">' + esc(a.reviewer_notes || '') + '</textarea>' +
      '<div class="app-actions">' +
      '<button class="btn btn-soft notes-save">שמירת הערות</button>' +
      '<button class="btn btn-danger del-btn">מחיקת רשומה</button>' +
      '</div>';
    card.querySelector('.status-select').addEventListener('change', async ev => {
      const r = await sb.from(TABLE).update({ status: ev.target.value }).eq('public_id', a.public_id);
      if (r.error) alert('עדכון הסטטוס נכשל: ' + r.error.message);
      refreshAdminList();
    });
    card.querySelector('.notes-save').addEventListener('click', async () => {
      const r = await sb.from(TABLE)
        .update({ reviewer_notes: card.querySelector('.notes-area').value }).eq('public_id', a.public_id);
      if (r.error) alert('שמירת ההערות נכשלה: ' + r.error.message);
      refreshAdminList();
    });
    card.querySelector('.del-btn').addEventListener('click', async () => {
      if (!confirm('למחוק את הרשומה של ' + (a.first_name || a.email) + '?')) return;
      const r = await sb.from(TABLE).delete().eq('public_id', a.public_id);
      if (r.error) alert('המחיקה נכשלה: ' + r.error.message);
      refreshAdminList();
    });
    list.appendChild(card);
  }
}

/* ---------- ייצוא ---------- */
function exportXlsx() {
  if (!adminApps.length) { alert('אין נרשמים לייצוא.'); return null; }
  const headers = ['שם פרטי', 'בית ספר ועיר', 'כיתה', 'דוא"ל', 'דוא"ל של',
    'סטטוס', 'הערות צוות', 'תאריך הרשמה'];
  const rows = adminApps.map(a => [
    a.first_name || '', a.school_city || '', a.grade || '', a.email, a.email_owner,
    a.status, a.reviewer_notes || '',
    new Date(a.created_at).toLocaleString('he-IL')
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = headers.map(() => ({ wch: 20 }));
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, 'נרשמים');
  return wb;
}
function downloadXlsx() {
  const wb = exportXlsx();
  if (wb) XLSX.writeFile(wb, 'taamim-pilot.xlsx');
}

/* ---------- ניתוב ---------- */
function route() {
  const isAdmin = location.hash.startsWith('#admin');
  document.getElementById('view-apply').hidden = isAdmin;
  document.getElementById('view-admin').hidden = !isAdmin;
  if (isAdmin) renderAdmin();
}

/* ---------- אתחול ---------- */
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('#apply-form select').forEach(wireOtherField);
  document.getElementById('apply-form').addEventListener('submit', submitForm);
  document.getElementById('magic-btn').addEventListener('click', sendMagicLink);
  const vb = document.getElementById('app-version');
  if (vb) vb.textContent = 'גרסה ' + APP_VERSION;
  document.getElementById('admin-email').addEventListener('keydown', e => { if (e.key === 'Enter') sendMagicLink(); });
  document.getElementById('signout-btn').addEventListener('click', signOut);
  document.getElementById('export-xlsx').addEventListener('click', downloadXlsx);
  document.getElementById('search').addEventListener('input', e => renderApps(e.target.value.trim()));
  window.addEventListener('hashchange', route);
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN' && !location.hash.startsWith('#admin')) { location.hash = '#admin'; return; }
    if (location.hash.startsWith('#admin')) renderAdmin();
  });
  route();
});
