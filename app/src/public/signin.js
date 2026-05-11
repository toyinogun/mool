const form = document.getElementById('signin-form');
const status = document.getElementById('signin-status');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value.trim();
  if (!email) return;
  status.hidden = false;
  status.textContent = 'Sending…';
  try {
    const res = await fetch('/auth/request-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (res.ok || res.status === 204) {
      status.textContent = `If a sign-in link can be sent to ${email}, you'll have it within a minute. Check your spam folder.`;
      form.querySelector('button').disabled = true;
    } else {
      status.textContent = 'Something went wrong. Please try again in a minute.';
    }
  } catch {
    status.textContent = 'Network error. Please try again.';
  }
});
