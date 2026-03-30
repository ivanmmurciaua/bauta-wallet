"use client";

import { createContext, useContext, useState, useEffect } from "react";

const STORAGE_KEY = "bauta-pq-mode";

interface PQModeContextType {
  pqEnabled: boolean;
  toggle: () => void;
}

const PQModeContext = createContext<PQModeContextType>({
  pqEnabled: false,
  toggle: () => {},
});

export function PQModeProvider({ children }: { children: React.ReactNode }) {
  const [pqEnabled, setPqEnabled] = useState(false); // false on SSR, corrected after mount

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      setPqEnabled(stored === null ? false : stored === "true");
    } catch {
      /* SSR */
    }
  }, []);

  const toggle = () => {
    const next = !pqEnabled;
    setPqEnabled(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      /* SSR */
    }
  };

  return (
    <PQModeContext.Provider value={{ pqEnabled, toggle }}>
      {children}
    </PQModeContext.Provider>
  );
}

export function usePQMode() {
  return useContext(PQModeContext);
}
