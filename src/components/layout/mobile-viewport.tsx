"use client";

import { useEffect } from "react";

/** Safari's virtual keyboard resizes the visual viewport rather than 100dvh. */
export function MobileViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      if (window.matchMedia("(max-width: 767px)").matches && Math.abs(viewport.scale - 1) < 0.01) {
        document.documentElement.style.setProperty("--workspace-height", `${viewport.height}px`);
      } else document.documentElement.style.removeProperty("--workspace-height");
    };
    update();
    viewport.addEventListener("resize", update);
    window.addEventListener("resize", update);
    return () => { viewport.removeEventListener("resize", update); window.removeEventListener("resize", update); document.documentElement.style.removeProperty("--workspace-height"); };
  }, []);
  return null;
}
