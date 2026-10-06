import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

// One EventSource for the whole app. The server sends the names of collections
// that changed; hooks refetch when one of their topics is in the list.
const listeners = new Set();
let source = null;
let connected = false;
const statusListeners = new Set();

function setConnected(value) {
  if (connected === value) return;
  connected = value;
  for (const fn of statusListeners) fn(value);
}

function ensureSource() {
  if (source || typeof EventSource === 'undefined') return;
  source = new EventSource('/api/events');
  let dropped = false;
  source.addEventListener('open', () => {
    setConnected(true);
    // After a reconnect, refetch everything: changes may have been missed.
    if (dropped) for (const fn of listeners) fn(['*']);
    dropped = false;
  });
  source.addEventListener('error', () => {
    dropped = true;
    setConnected(false);
  });
  source.addEventListener('change', (e) => {
    let topics = [];
    try {
      topics = JSON.parse(e.data);
    } catch {
      return;
    }
    for (const fn of listeners) fn(topics);
  });
}

export function onTopics(topics, fn) {
  ensureSource();
  const wanted = new Set(topics);
  const listener = (changed) => {
    if (changed.includes('*') || changed.some((t) => wanted.has(t))) fn(changed);
  };
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLiveStatus() {
  const [value, setValue] = useState(connected);
  useEffect(() => {
    ensureSource();
    statusListeners.add(setValue);
    return () => statusListeners.delete(setValue);
  }, []);
  return value;
}

/**
 * Fetch `path` and keep it fresh while any of `topics` change on the server.
 * Returns { data, error, loading, refresh, setData }.
 */
export function useResource(path, topics = [], { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: !!path && enabled });
  const pathRef = useRef(path);
  pathRef.current = path;
  const seq = useRef(0);

  const load = useCallback(async () => {
    const current = pathRef.current;
    if (!current) return;
    const id = ++seq.current;
    try {
      const data = await api.get(current);
      if (id === seq.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (id === seq.current) setState((s) => ({ data: s.data, error, loading: false }));
    }
  }, []);

  useEffect(() => {
    if (!path || !enabled) return undefined;
    setState((s) => ({ data: s.data && pathRef.current === path ? s.data : null, error: null, loading: true }));
    load();
    if (!topics.length) return undefined;
    let timer = null;
    const off = onTopics(topics, () => {
      clearTimeout(timer);
      timer = setTimeout(load, 120);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, enabled, topics.join(',')]);

  const setData = useCallback((updater) => {
    setState((s) => ({ ...s, data: typeof updater === 'function' ? updater(s.data) : updater }));
  }, []);

  return { ...state, refresh: load, setData };
}

// Re-render on an interval so relative times ("2 min ago") stay current.
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
