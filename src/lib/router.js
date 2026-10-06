import { useEffect, useState } from 'react';

// Hash routes: #/accounts/acc_123 → { page: 'accounts', id: 'acc_123', parts: [...] }
function parse() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart = ''] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  return { page: parts[0] ?? '', id: parts[1] ?? null, parts, query: Object.fromEntries(new URLSearchParams(queryPart)) };
}

export function useRoute() {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(path, { replace = false } = {}) {
  const hash = path.startsWith('#') ? path : `#${path.startsWith('/') ? path : `/${path}`}`;
  if (replace) window.history.replaceState(null, '', hash);
  else window.location.hash = hash;
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
}
