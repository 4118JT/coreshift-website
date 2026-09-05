"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      // Keep the existing worker alive. Unregistering it on every app visit can
      // leave a short period with no active notification provider.
      navigator.serviceWorker.register("/sw.js?v=6")
        .catch(() => undefined);
    }
  }, []);

  return null;
}
