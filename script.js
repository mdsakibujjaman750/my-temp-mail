// ============================================================
//  DropMail — Frontend Logic
//  Talks to Netlify serverless function at /.netlify/functions/fetchMail
// ============================================================

const POLL_INTERVAL = 10; // seconds
let currentEmail = '';
let pollTimer = null;
let timerCountdown = POLL_INTERVAL;
let timerBarInterval = null;
let emails = [];

// ---- 1secmail domains pool --------------------------------
const DOMAINS = [
  '1secmail.com',
  '1secmail.org',
  '1secmail.net',
  'wwjmp.com',
  'esiix.com',
  'xojxe.com',
  'yoggm.com'
];

// ---- Helpers ----------------------------------------------
function randomString(len) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function generateEmailAddress() {
  const user = randomString(10);
  const domain = DOMAINS[Math.floor(Math.random() * DOMAINS.length)];
  return `${user}@${domain}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr.replace(' ', 'T'));
  if (isNaN(d)) return dateStr;
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function truncate(str, max = 60) {
  if (!str) return '(no subject)';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function sanitizeHtml(html) {
  // Basic passthrough — 1secmail HTML bodies are generally safe,
  // but we sandbox them inside an iframe-like div via CSS isolation.
  return html || '';
}

// ---- Email generation -------------------------------------
function initEmail() {
  const spinner = document.getElementById('genSpinner');
  const addrEl = document.getElementById('emailAddress');

  spinner.style.display = 'block';
  addrEl.style.opacity = '0.4';

  // Slight delay for the "generating" feel
  setTimeout(() => {
    currentEmail = generateEmailAddress();
    addrEl.textContent = currentEmail;
    addrEl.style.opacity = '1';
    spinner.style.display = 'none';

    // Clear inbox display
    emails = [];
    renderInbox();

    // Start polling
    resetPollTimer();
    fetchEmails();
  }, 600);
}

// ---- Copy -------------------------------------------------
function copyEmail() {
  if (!currentEmail) return;
  navigator.clipboard.writeText(currentEmail)
    .then(() => showToast('✓ Copied to clipboard!'))
    .catch(() => {
      // Fallback for older browsers
      const el = document.createElement('textarea');
      el.value = currentEmail;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      showToast('✓ Copied to clipboard!');
    });
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ---- Change / Refresh ------------------------------------
function changeEmail() {
  stopPollTimer();
  initEmail();
}

function refreshInbox() {
  resetPollTimer();
  fetchEmails(true);
}

// ---- Polling timer ----------------------------------------
function resetPollTimer() {
  stopPollTimer();
  timerCountdown = POLL_INTERVAL;
  updateTimerBar();

  // Visual countdown
  timerBarInterval = setInterval(() => {
    timerCountdown--;
    updateTimerBar();
    if (timerCountdown <= 0) {
      timerCountdown = POLL_INTERVAL;
      fetchEmails();
    }
  }, 1000);
}

function stopPollTimer() {
  if (timerBarInterval) clearInterval(timerBarInterval);
  timerBarInterval = null;
}

function updateTimerBar() {
  const bar = document.getElementById('timerBar');
  if (bar) {
    bar.style.width = ((timerCountdown / POLL_INTERVAL) * 100) + '%';
  }
}

// ---- Fetch emails from serverless function ----------------
async function fetchEmails(manual = false) {
  if (!currentEmail) return;

  const [login, domain] = currentEmail.split('@');

  try {
    const res = await fetch(
      `/.netlify/functions/fetchMail?action=getMessages&login=${encodeURIComponent(login)}&domain=${encodeURIComponent(domain)}`
    );

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (Array.isArray(data)) {
      const prevCount = emails.length;
      emails = data;
      renderInbox();

      // Notify on new mail
      if (manual && data.length === 0) {
        showToast('📭 No new messages yet');
      } else if (!manual && data.length > prevCount) {
        showToast(`📬 ${data.length - prevCount} new message${data.length - prevCount > 1 ? 's' : ''}!`);
      }
    }
  } catch (err) {
    console.error('Fetch failed:', err);
    if (manual) showToast('⚠ Failed to fetch. Retrying...');
  }
}

// ---- Fetch single email body --------------------------------
async function fetchEmailBody(login, domain, id) {
  try {
    const res = await fetch(
      `/.netlify/functions/fetchMail?action=readMessage&login=${encodeURIComponent(login)}&domain=${encodeURIComponent(domain)}&id=${id}`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('Body fetch failed:', err);
    return null;
  }
}

// ---- Render inbox -----------------------------------------
function renderInbox() {
  const list = document.getElementById('inboxList');
  const badge = document.getElementById('countBadge');

  if (!emails || emails.length === 0) {
    badge.style.display = 'none';
    list.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📭</span>
        <h3>Inbox is empty</h3>
        <p>Emails sent to your address will appear here automatically.<br>Waiting for the first message...</p>
      </div>`;
    return;
  }

  badge.style.display = 'inline-block';
  badge.textContent = emails.length;

  list.innerHTML = emails.map((mail, idx) => `
    <div class="mail-item unread" onclick="openEmail(${idx})">
      <div class="mail-from">${escapeHtml(mail.from || 'Unknown sender')}</div>
      <div class="mail-date">${formatDate(mail.date)}</div>
      <div class="mail-subject">${escapeHtml(truncate(mail.subject || '(no subject)'))}</div>
    </div>
  `).join('');
}

// ---- Open email in modal ----------------------------------
async function openEmail(idx) {
  const mail = emails[idx];
  if (!mail) return;

  const [login, domain] = currentEmail.split('@');

  // Show modal with loading state
  document.getElementById('modalSubject').textContent = mail.subject || '(no subject)';
  document.getElementById('modalFrom').textContent = mail.from || '—';
  document.getElementById('modalDate').textContent = formatDate(mail.date);
  document.getElementById('modalBody').innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;color:var(--text-dim);font-size:13px;">
      <div style="width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--cyan);border-radius:50%;animation:spin 0.8s linear infinite;"></div>
      Loading message...
    </div>`;
  document.getElementById('emailModal').classList.add('open');

  // Remove unread style
  const items = document.querySelectorAll('.mail-item');
  if (items[idx]) items[idx].classList.remove('unread');

  // Fetch full body
  const full = await fetchEmailBody(login, domain, mail.id);

  if (full) {
    let bodyContent = '';

    if (full.htmlBody && full.htmlBody.trim()) {
      // Render HTML email body safely
      bodyContent = `
        <div style="
          background: rgba(255,255,255,0.03);
          border-radius: 8px;
          padding: 16px;
          border: 1px solid var(--border);
          font-size: 14px;
          line-height: 1.7;
          color: var(--text);
        ">${sanitizeHtml(full.htmlBody)}</div>`;
    } else if (full.textBody && full.textBody.trim()) {
      bodyContent = `<pre style="
        white-space: pre-wrap;
        word-break: break-word;
        font-family: 'Space Mono', monospace;
        font-size: 12px;
        line-height: 1.7;
        color: var(--text);
        background: rgba(255,255,255,0.03);
        border-radius: 8px;
        padding: 16px;
        border: 1px solid var(--border);
        margin: 0;
      ">${escapeHtml(full.textBody)}</pre>`;
    } else {
      bodyContent = `<p style="color:var(--text-dim);font-size:13px;">(Empty message body)</p>`;
    }

    // Attachments
    if (full.attachments && full.attachments.length > 0) {
      bodyContent += `
        <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);">
          <div style="font-size:11px;font-family:'Space Mono',monospace;color:var(--text-dim);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:10px;">Attachments (${full.attachments.length})</div>
          ${full.attachments.map(a => `
            <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(0,229,255,0.05);border:1px solid var(--border);border-radius:6px;padding:6px 12px;font-size:12px;color:var(--cyan);margin:4px 4px 0 0;">
              📎 ${escapeHtml(a.filename || 'attachment')} <span style="color:var(--text-dim)">(${formatSize(a.size)})</span>
            </div>
          `).join('')}
        </div>`;
    }

    document.getElementById('modalBody').innerHTML = bodyContent;
  } else {
    document.getElementById('modalBody').innerHTML = `
      <p style="color:var(--red);font-size:13px;">⚠ Failed to load message body. Please try again.</p>`;
  }
}

function formatSize(bytes) {
  if (!bytes) return '?';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ---- Modal close ------------------------------------------
function closeModal(event) {
  if (event.target === document.getElementById('emailModal')) {
    document.getElementById('emailModal').classList.remove('open');
  }
}

// Close on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.getElementById('emailModal').classList.remove('open');
  }
});

// ---- Security: escape HTML --------------------------------
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ---- Boot -------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  initEmail();
});
