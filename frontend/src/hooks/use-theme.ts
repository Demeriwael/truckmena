import { useEffect, useState } from "react";

export function useTheme() {
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem("wayline-theme") === "dark";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("wayline-theme", dark ? "dark" : "light");
    } catch {
      /* Theme still works when storage is blocked. */
    }
  }, [dark]);
  return { dark, toggle: () => setDark((value) => !value) };
}
