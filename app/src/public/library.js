const data = JSON.parse(document.getElementById('library-data').textContent);
const list = document.getElementById('library-list');

function render(items) {
  list.innerHTML = '';
  for (const r of items) {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="lib-date">${new Date(r.createdAt).toLocaleString()}</span>
      <a class="lib-link" href="/v/${r.slug}">${r.slug}</a>
      <button class="lib-copy" data-slug="${r.slug}">Copy link</button>
      <button class="lib-delete" data-slug="${r.slug}">Delete</button>
    `;
    list.appendChild(li);
  }
}
render(data);

list.addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const slug = btn.dataset.slug;
  if (btn.classList.contains('lib-copy')) {
    const url = `${location.origin}/v/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = 'Copy link'; }, 1500);
    } catch {
      // Fallback for insecure contexts / permission-denied
      prompt('Copy this link:', url);
    }
  } else if (btn.classList.contains('lib-delete')) {
    if (!confirm('Delete this recording? This cannot be undone.')) return;
    const res = await fetch(`/recordings/${slug}`, { method: 'DELETE' });
    if (res.status === 204) {
      btn.closest('li').remove();
    } else {
      alert('Delete failed. Please try again.');
    }
  }
});
