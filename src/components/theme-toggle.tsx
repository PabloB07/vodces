"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  const isDark = resolvedTheme === "dark";

  return (
    <Button
      size="icon"
      variant="outline"
      className="h-9 w-9"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label="Cambiar tema"
      title={isDark ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
