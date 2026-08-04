"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      // Replace any older cached shell so dashboard layout updates are visible
      // immediately on phones that have installed CoreShift as a PWA.
      navigator.serviceWorker.getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
        .then(() => navigator.serviceWorker.register("/sw.js?v=3"))
        .catch(() => undefined);
    }
  }, []);

  return null;
}
