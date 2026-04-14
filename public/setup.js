'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('setup-submit-btn').addEventListener('click', submitSetup);
  document.getElementById('setup-rotation-start').value = mondayOfToday();
  await loadBootstrapState();
});

async function loadBootstrapState() {
  const statusEl = document.getElementById('setup-bootstrap-status');
  try {
    const res = await fetch('api/bootstrap', { cache: 'no-store' });
    const data = await res.json();
    if (data?.bootstrap?.needs_household === false) {
      window.location.replace('.');
      return;
    }
    setStatus(statusEl, 'This install needs household profiles before the dinner planner can be used.', false, true);
  } catch {
    setStatus(statusEl, 'Could not check setup state.', true, true);
  }
}

function parseKids(value) {
  return String(value || '')
    .split(/[\n,]/)
    .map(item => item.trim())
    .filter(Boolean);
}

async function submitSetup() {
  const parent1 = document.getElementById('setup-parent-1').value.trim();
  const parent2 = document.getElementById('setup-parent-2').value.trim();
  const kids = parseKids(document.getElementById('setup-kids').value);
  const rotationStartDate = document.getElementById('setup-rotation-start').value;
  const installStarter = document.getElementById('setup-starter-content').checked;
  const btn = document.getElementById('setup-submit-btn');
  const statusEl = document.getElementById('setup-submit-status');

  const members = [];
  if (parent1) members.push({ name: parent1, role: 'parent' });
  if (parent2) members.push({ name: parent2, role: 'parent' });
  for (const kid of kids) members.push({ name: kid, role: 'kid' });

  if (!parent1) {
    setStatus(statusEl, 'Enter at least one parent/cook name.', true);
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rotationStartDate)) {
    setStatus(statusEl, 'Choose a valid rotation start date.', true);
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Creating…';
  setStatus(statusEl, 'Creating household…', false);

  try {
    const res = await fetch('api/bootstrap/household', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        members,
        rotation_start_date: rotationStartDate,
        install_starter_content: installStarter,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not initialize household');

    const firstParent = (data.created_members || []).find(member => member.role === 'parent') || data.created_members?.[0];
    if (firstParent) localStorage.setItem('fd_member', JSON.stringify(firstParent));

    setStatus(statusEl, 'Household created. Opening Family Dinner…', false);
    window.setTimeout(() => window.location.replace('.'), 250);
  } catch (err) {
    setStatus(statusEl, err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Household';
  }
}

function mondayOfToday() {
  const date = new Date();
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const dom = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${dom}`;
}

function setStatus(el, message, isError, keepVisible = false) {
  el.textContent = message;
  el.classList.remove('hidden', 'error', 'is-error');
  if (isError) el.classList.add('error');
  if (!keepVisible) el.classList.remove('hidden');
}
