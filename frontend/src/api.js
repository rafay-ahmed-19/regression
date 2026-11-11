import { useCallback, useEffect, useRef, useState } from "react";

const BASE = "/api";

function message(detail, status) {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((d) => `${(d.loc || []).filter((p) => p !== "body").join(".")}: ${d.msg}`).join("; ");
  }
  return `Request failed (${status})`;
}

/** Call the Hub API. `body` is sent as JSON; `form` as multipart. */
export async function api(path, { method = "GET", body, form } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  if (!res.ok) {
    let detail;
    try {
      detail = (await res.json()).detail;
    } catch {
      /* not JSON */
    }
    throw new Error(message(detail, res.status));
  }
  if (res.status === 204) return null;
  return res.json();
}

export const downloadUrl = (path) => BASE + path;

/**
 * Load `path` and keep it fresh. `interval` (ms) re-polls while it is a positive number.
 * A null path skips loading.
 */
export function useFetch(path, { interval = 0 } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: !!path });
  const current = useRef(path);
  current.current = path;

  const load = useCallback(
    async (quiet = false) => {
      if (!path) return;
      if (!quiet) setState((s) => ({ ...s, loading: true }));
      try {
        const data = await api(path);
        if (current.current === path) setState({ data, error: null, loading: false });
      } catch (e) {
        if (current.current === path) setState((s) => ({ data: quiet ? s.data : null, error: e.message, loading: false }));
      }
    },
    [path]
  );

  useEffect(() => {
    if (!path) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    load();
  }, [path, load]);

  useEffect(() => {
    if (!path || !interval) return;
    const id = setInterval(() => load(true), interval);
    return () => clearInterval(id);
  }, [path, interval, load]);

  return { ...state, reload: () => load(true) };
}

/** Read server-sent `data: {...}` events from a POST response. */
export async function streamEvents(path, onEvent, signal) {
  const res = await fetch(BASE + path, { method: "POST", signal });
  if (!res.ok || !res.body) {
    let detail;
    try {
      detail = (await res.json()).detail;
    } catch {
      /* not JSON */
    }
    throw new Error(message(detail, res.status));
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop();
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data: "));
      if (line) onEvent(JSON.parse(line.slice(6)));
    }
  }
}

// The acceptance log records a typed name until sign-in exists.
const USER_KEY = "hub.user";
export const getUser = () => localStorage.getItem(USER_KEY) || "";
export const setUser = (name) => localStorage.setItem(USER_KEY, name.trim());
