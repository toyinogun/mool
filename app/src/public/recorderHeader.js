const display = document.getElementById('mool-user-display');
try {
  const res = await fetch('/me', { credentials: 'same-origin' });
  if (res.status === 401) {
    location.replace('/signin');
  } else if (res.ok) {
    const me = await res.json();
    display.textContent = me.displayName;
  }
} catch {
  // Network error — leave the header blank; the recorder will surface its own errors.
}
